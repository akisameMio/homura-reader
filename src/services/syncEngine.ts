/* ============================================================================
   HOMURA · 离线优先元数据同步引擎
   ----------------------------------------------------------------------------
   本地持久数据与比较基线的差异就是待发送变更，进程中断不会丢掉内存队列。
   按字段使用逻辑版本合并；网络写入使用 ETag，提交本地时再次核对并发编辑。
   ========================================================================== */

import type { BookSource, Collection, ReadingProgress } from '../types.ts';
import { mergeSyncDocuments, syncRecordKey, validateSyncDocument, type SyncDocument, type SyncKind, type SyncRecord } from './syncModel.ts';
import { localSnapshotSignature, portableProgress, replacePortableProgress, type SyncLocalSnapshot } from './syncSnapshot.ts';

interface Baseline {
  favorites: Record<string, boolean>;
  progress: Record<string, Record<string, number> | null>;
  memberships: Record<string, string | null>;
  collections: Record<string, { title: string; createdAt: number }>;
}

interface UnmatchedEdits {
  favorite?: boolean;
  progress?: Record<string, number> | null;
  membership?: string | null;
}

export interface SyncEngineState {
  id: string;
  revision: number;
  deviceId: string;
  document: SyncDocument;
  baseline: Baseline;
  identities: Record<string, string>;
  identitySignatures?: Record<string, string>;
  unmatchedEdits?: Record<string, UnmatchedEdits>;
  uploaded: string;
  lastSyncAt: number | null;
}

export interface SyncStats {
  pendingCount: number;
  matchedCount: number;
  unmatchedCount: number;
  remoteOnlyCount: number;
  lastSyncAt: number | null;
}

export interface SyncEngineDependencies {
  profileId: string;
  deviceId: string;
  loadState(): Promise<SyncEngineState | null>;
  saveState(state: SyncEngineState, previousRevision: number): Promise<void>;
  readSnapshot(): Promise<SyncLocalSnapshot>;
  getSource(id: string): Promise<BookSource | undefined>;
  prepareIdentity?(source: BookSource): Promise<{ source: BookSource; signature: string | null }>;
  fingerprint(source: BookSource): Promise<string>;
  applySnapshot(expected: SyncLocalSnapshot, next: SyncLocalSnapshot): Promise<void>;
  activeBookId?(): string | null;
  isCurrent?(): boolean;
  now?(): number;
}

interface SyncTransport {
  read(): Promise<{ document: unknown | null; etag: string | null }>;
  write(document: SyncDocument, etag: string | null): Promise<void>;
}

const emptyDocument = (): SyncDocument => ({ schemaVersion: 1, records: [] });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const emptyBaseline = (): Baseline => ({
  favorites: dictionary(), progress: dictionary(), memberships: dictionary(), collections: dictionary()
});

function project(snapshot: SyncLocalSnapshot): Baseline {
  const baseline = emptyBaseline();
  const memberships = new Map<string, string>();
  for (const item of snapshot.collections) {
    baseline.collections[item.id] = { title: item.title || item.name || '未命名书库', createdAt: item.createdAt || 0 };
    for (const id of item.bookIds) if (!memberships.has(id)) memberships.set(id, item.id);
  }
  const progress = new Map(snapshot.progress.map(item => [String(item.id), item]));
  for (const book of snapshot.books) {
    baseline.favorites[book.id] = !!book.favorite;
    baseline.progress[book.id] = portableProgress(progress.get(book.id));
    baseline.memberships[book.id] = memberships.get(book.id) || null;
  }
  return baseline;
}

function stats(state: SyncEngineState, snapshot: SyncLocalSnapshot, unavailable: ReadonlySet<string>): SyncStats {
  const currentIds = new Set(snapshot.books.map(book => book.id));
  const fingerprints = new Set(Object.entries(state.identities).filter(([id]) => currentIds.has(id) && !unavailable.has(id)).map(([, key]) => key));
  const remoteKeys = new Set(state.document.records.filter(record => record.kind !== 'collection' && !record.deleted).map(record => record.key));
  let uploaded: SyncDocument;
  try { uploaded = state.uploaded ? validateSyncDocument(JSON.parse(state.uploaded)) : emptyDocument(); } catch { uploaded = emptyDocument(); }
  const prior = new Map(uploaded.records.map(record => [syncRecordKey(record), record]));
  return {
    pendingCount: state.document.records.filter(record => !equal(prior.get(syncRecordKey(record)), record)).length
      + Object.values(state.unmatchedEdits || {}).reduce((sum, edits) => sum + Object.keys(edits).length, 0),
    matchedCount: snapshot.books.filter(book => !!state.identities[book.id] && !unavailable.has(book.id)).length,
    unmatchedCount: snapshot.books.filter(book => !state.identities[book.id] || unavailable.has(book.id)).length,
    remoteOnlyCount: [...remoteKeys].filter(key => !fingerprints.has(key)).length,
    lastSyncAt: state.lastSyncAt
  };
}

export function createSyncEngine(deps: SyncEngineDependencies) {
  let tail = Promise.resolve<unknown>(undefined);
  const unavailable = new Set<string>();
  const identityFor = (state: SyncEngineState, id: string) => unavailable.has(id) ? undefined : state.identities[id];
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  const checkCurrent = () => {
    if (deps.isCurrent && !deps.isCurrent()) throw new Error('同步配置已改变，请重试');
  };
  const load = async (): Promise<SyncEngineState> => (await deps.loadState()) || {
    id: deps.profileId, revision: 0, deviceId: deps.deviceId, document: emptyDocument(),
    baseline: emptyBaseline(), identities: {}, uploaded: '', lastSyncAt: null
  };
  async function save(state: SyncEngineState) {
    checkCurrent();
    const revision = state.revision;
    state.revision++;
    await deps.saveState(state, revision);
  }

  async function observe(state: SyncEngineState, snapshot: SyncLocalSnapshot) {
    checkCurrent();
    const previous = state.baseline;
    const baseline = project(snapshot);
    const unmatchedEdits = state.unmatchedEdits ||= dictionary();
    const signatures = state.identitySignatures ||= dictionary();
    const currentIds = new Set(snapshot.books.map(book => book.id));
    for (const id of Object.keys(unmatchedEdits)) {
      if (!currentIds.has(id)) delete unmatchedEdits[id];
    }
    for (const id of Object.keys(state.identities)) {
      if (!currentIds.has(id)) delete state.identities[id];
    }
    for (const id of Object.keys(signatures)) {
      if (!currentIds.has(id)) delete signatures[id];
    }
    unavailable.clear();
    const changedIdentities = new Set<string>();
    for (const book of snapshot.books) {
      const oldKey = state.identities[book.id];
      if (oldKey && !deps.prepareIdentity) continue;
      try {
        const source = await deps.getSource(book.id);
        if (!source) throw new Error('原文件来源不存在');
        const prepared = deps.prepareIdentity ? await deps.prepareIdentity(source) : { source, signature: null };
        if (oldKey && (prepared.signature ?? undefined) === signatures[book.id]) continue;
        const key = await deps.fingerprint(prepared.source);
        if (oldKey && oldKey !== key) changedIdentities.add(book.id);
        state.identities[book.id] = key;
        if (prepared.signature === null) delete signatures[book.id];
        else signatures[book.id] = prepared.signature;
      } catch {
        // 保留上次已知身份用于恢复比较，但本轮不拿它应用或发布书籍编辑。
        unavailable.add(book.id);
      }
    }
    checkCurrent();
    let counter = state.document.records.reduce((maximum, record) => Math.max(maximum, record.version.counter), 0);
    const records = new Map(state.document.records.map(record => [syncRecordKey(record), record]));
    const put = (kind: SyncKind, key: string, value: unknown, deleted = false) => {
      const old = records.get(`${kind}:${key}`);
      if (old && !!old.deleted === deleted && equal(old.value, value)) return;
      if (counter >= Number.MAX_SAFE_INTEGER - 2) throw new Error('同步版本计数已达上限');
      const record: SyncRecord = { kind, key, value, version: { counter: ++counter, deviceId: state.deviceId } };
      if (deleted) record.deleted = true;
      records.set(syncRecordKey(record), record);
    };
    for (const [id, value] of Object.entries(baseline.collections)) {
      if (!equal(previous.collections[id], value)) put('collection', id, value);
    }
    for (const id of Object.keys(previous.collections)) {
      if (!baseline.collections[id]) put('collection', id, null, true);
    }
    for (const book of snapshot.books) {
      const key = identityFor(state, book.id);
      const firstSeen = !(book.id in previous.favorites);
      const initial = firstSeen || changedIdentities.has(book.id);
      const favorite = baseline.favorites[book.id];
      const progress = baseline.progress[book.id];
      const membership = baseline.memberships[book.id];
      if (!key) {
        const edits = unmatchedEdits[book.id] ||= {};
        if (firstSeen ? favorite : favorite !== previous.favorites[book.id]) edits.favorite = favorite;
        if (firstSeen ? progress !== null : !equal(progress, previous.progress[book.id])) edits.progress = progress;
        if (firstSeen ? membership !== null : membership !== previous.memberships[book.id]) edits.membership = membership;
        if (!Object.keys(edits).length) delete unmatchedEdits[book.id];
        continue;
      }
      // 尚未取得指纹时的取消/清空也是编辑意图，不能误当作首次导入的默认值。
      const edits = unmatchedEdits[book.id] || {};
      if ('favorite' in edits || (initial ? favorite : favorite !== previous.favorites[book.id])) put('favorite', key, favorite);
      if ('progress' in edits || (initial ? progress !== null : !equal(progress, previous.progress[book.id]))) put('progress', key, progress, progress === null);
      if ('membership' in edits || (initial ? membership !== null : membership !== previous.memberships[book.id])) put('membership', key, membership);
      delete unmatchedEdits[book.id];
    }
    state.document = validateSyncDocument({ schemaVersion: 1, records: [...records.values()] });
    state.baseline = baseline;
    return state;
  }

  function materialize(state: SyncEngineState, snapshot: SyncLocalSnapshot): SyncLocalSnapshot {
    const records = new Map(state.document.records.map(record => [syncRecordKey(record), record]));
    const books = snapshot.books.map(book => {
      const favorite = records.get(`favorite:${identityFor(state, book.id)}`);
      return favorite ? { ...book, favorite: !favorite.deleted && favorite.value === true } : book;
    });
    const progress = new Map(snapshot.progress.map(record => [String(record.id), record]));
    for (const book of books) {
      if (book.id === deps.activeBookId?.()) continue;
      const record = records.get(`progress:${identityFor(state, book.id)}`);
      if (!record) continue;
      const next = replacePortableProgress(progress.get(book.id), record.deleted ? null : record.value as ReadingProgress);
      if (next) progress.set(book.id, { ...next, id: book.id });
      else progress.delete(book.id);
    }
    const collections = new Map<string, Collection>();
    for (const item of snapshot.collections) collections.set(item.id, { ...item, bookIds: [] });
    for (const record of state.document.records.filter(item => item.kind === 'collection')) {
      if (record.deleted) collections.delete(record.key);
      else collections.set(record.key, { id: record.key, ...(record.value as { title: string; createdAt: number }), bookIds: [] });
    }
    for (const book of books) {
      const record = records.get(`membership:${identityFor(state, book.id)}`);
      const target = record ? (!record.deleted ? record.value : null) : state.baseline.memberships[book.id];
      if (typeof target === 'string') collections.get(target)?.bookIds.push(book.id);
    }
    for (const item of collections.values()) {
      const members = new Set(item.bookIds);
      const previousOrder = snapshot.collections.find(previous => previous.id === item.id)?.bookIds || [];
      const retained = previousOrder.filter(id => members.delete(id));
      item.bookIds = retained.concat([...members]);
    }
    return { books, progress: [...progress.values()], collections: [...collections.values()] };
  }

  async function capture() {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const state = await load();
        const snapshot = await deps.readSnapshot();
        await observe(state, snapshot);
        await save(state);
        return stats(state, snapshot, unavailable);
      } catch (error) {
        if ((error as Error).message !== 'SYNC_STATE_CHANGED' || attempt === 3) throw error;
      }
    }
    throw new Error('同步状态保存失败');
  }

  async function synchronize(transport: SyncTransport) {
    await capture();
    for (let attempt = 0; attempt < 5; attempt++) {
      checkCurrent();
      const remote = await transport.read();
      const remoteDocument = remote.document === null ? emptyDocument() : validateSyncDocument(remote.document);
      try {
        let state = await load();
        // 先观察离线期间的本地差异，再合并远端；没有本地记录的作品不会覆盖远端默认值。
        let snapshot = await deps.readSnapshot();
        await observe(state, snapshot);
        state.document = mergeSyncDocuments(state.document, remoteDocument);
        await save(state);
        for (let localAttempt = 0; localAttempt < 5; localAttempt++) {
          checkCurrent();
          snapshot = await deps.readSnapshot();
          await observe(state, snapshot);
          const next = materialize(state, snapshot);
          try {
            if (localSnapshotSignature(next) !== localSnapshotSignature(snapshot)) await deps.applySnapshot(snapshot, next);
            state.baseline = project(next);
            await save(state);
            break;
          } catch (error) {
            if ((error as Error).message !== 'SYNC_LOCAL_CHANGED' || localAttempt === 4) throw error;
          }
        }
        checkCurrent();
        await transport.write(state.document, remote.etag);
        state.uploaded = JSON.stringify(state.document);
        state.lastSyncAt = (deps.now || Date.now)();
        await save(state);
        return stats(state, await deps.readSnapshot(), unavailable);
      } catch (error) {
        const detail = error as { message?: string; code?: string };
        if (detail.code !== 'CONFLICT' && detail.message !== 'SYNC_STATE_CHANGED') throw error;
      }
    }
    throw new Error('同步冲突频繁，请稍后重试');
  }

  return {
    capture: () => run(capture),
    sync: (transport: SyncTransport) => run(() => synchronize(transport))
  };
}
