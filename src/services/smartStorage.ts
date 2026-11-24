/* ============================================================================
   HOMURA · 智能转存与小说持久化
   ----------------------------------------------------------------------------
   主 sources 记录通过 serializeManagedNovelSource 保存可迁移的规范化内容；
   高频冷打开的自动存档和活动样本单独写入 homura_smart_storage。
   这里只定义有界的数据与策略原语，不持有阅读器状态或原文件副本。
   ========================================================================== */

const DAY_MS = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;

export const SMART_STORAGE_DEFAULTS = Object.freeze({
  activityWindowDays: 14,
  requiredReadingDateCount: 3,
  requiredColdOpenSampleCount: 2,
  slowColdOpenMs: 2_000,
  defaultBudgetBytes: 512 * MIB,
  idleDays: 30,
  minReadingSessionMs: 60_000
});

export const SMART_STORAGE_LIMITS = Object.freeze({
  activityRetentionDays: 90,
  maxColdOpenSamples: 30,
  archiveSchemaVersion: 1,
  serializerVersion: 1,
  databaseVersion: 2,
  databaseName: 'homura_smart_storage',
  activityStoreName: 'activity',
  archiveStoreName: 'archives',
  archiveSummaryStoreName: 'archiveSummaries'
});

export type ManagedNovelFormat = 'txt' | 'markdown' | 'epub' | 'mobi';

export interface ManagedNovelChapter {
  title?: string;
  content: string;
  contentKind: 'text' | 'html';
  sourcePath?: string;
}

export interface ManagedNovelAsset {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ManagedNovelSourceInput {
  format: ManagedNovelFormat;
  sourceFingerprint: string;
  title?: string;
  chapters: ManagedNovelChapter[];
  assets?: ManagedNovelAsset[];
  createdAt?: number;
}

export interface ManagedNovelSourcePayloadV1 {
  kind: 'homura-managed-novel';
  schemaVersion: 1;
  serializerVersion: 1;
  format: ManagedNovelFormat;
  sourceFingerprint: string;
  title: string | null;
  chapters: ManagedNovelChapter[];
  assets: ManagedNovelAsset[];
  bytes: number;
  createdAt: number;
}

export interface ReadingSessionSnapshot {
  bookId: string;
  openedAt: number;
  closedAt: number;
  activeMs: number;
  progressed: boolean;
  coldOpenMs?: number;
  /** 命中本地缓存时的实际打开耗时，用于校准自动存档收益。 */
  cachedOpenMs?: number;
  /** 阅读所在本地日，格式 YYYY-MM-DD；不传时按 closedAt 的本地日期计算。 */
  readingDay?: string;
}

export interface ReadingActivityCommit {
  bookId: string;
  at: number;
  activeMs: number;
  progressed: boolean;
  readingDay: string | null;
  coldOpenMs: number | null;
  cachedOpenMs?: number;
}

export interface ColdOpenSample {
  at: number;
  durationMs: number;
}

export interface SmartReadingActivity {
  bookId: string;
  readingDates: string[];
  coldOpenSamples: ColdOpenSample[];
  /** 新增字段；旧活动记录没有时按空样本处理。 */
  cachedOpenSamples?: ColdOpenSample[];
  lastReadAt: number | null;
  updatedAt: number;
}

export type SmartTransferReason =
  | 'insufficient-reading-dates'
  | 'insufficient-cold-open-samples'
  | 'cold-open-not-slow-enough'
  | 'source-unavailable'
  | 'missing-archive-size';

export interface SmartTransferEvaluationInput {
  activity: SmartReadingActivity;
  archiveBytes: number;
  sourceAvailable: boolean;
  now?: number;
}

export interface SmartTransferEvaluation {
  bookId: string;
  eligible: boolean;
  reasons: SmartTransferReason[];
  readingDateCount: number;
  coldOpenSampleCount: number;
  medianColdOpenMs: number | null;
  cachedOpenSampleCount: number;
  medianCachedOpenMs: number | null;
  archiveBytes: number;
}

export interface SmartTransferCandidate extends SmartTransferEvaluation {
  expectedColdOpens: number;
  savingsPerOpenMs: number;
  projectedSavingsMs: number;
  efficiency: number;
}

export interface SmartTransferCapacityPlan {
  ranked: SmartTransferCandidate[];
  selected: SmartTransferCandidate[];
  deferred: SmartTransferCandidate[];
  selectedBytes: number;
  budgetBytes: number;
}

export interface AutoNovelArchiveRecord {
  bookId: string;
  mode: 'auto';
  archive: ManagedNovelSourcePayloadV1;
  bytes: number;
  createdAt: number;
  lastUsedAt: number;
}

export type AutoNovelArchiveSummary = Pick<AutoNovelArchiveRecord, 'bookId' | 'mode' | 'bytes' | 'createdAt' | 'lastUsedAt'>;

export interface SmartStorageRepository {
  loadActivity(bookId: string): Promise<SmartReadingActivity | null>;
  listActivities(): Promise<SmartReadingActivity[]>;
  recordActivity(commit: ReadingActivityCommit): Promise<SmartReadingActivity>;
  saveAutoArchive(bookId: string, archive: ManagedNovelSourcePayloadV1, at?: number): Promise<void>;
  loadAutoArchive(bookId: string): Promise<AutoNovelArchiveRecord | null>;
  listAutoArchives(): Promise<AutoNovelArchiveRecord[]>;
  listAutoArchiveSummaries(): Promise<AutoNovelArchiveSummary[]>;
  deleteAutoArchive(bookId: string): Promise<void>;
  deleteBookLearning(id: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function localDayKey(timestamp: number) {
  const parts = dayFormatter.formatToParts(new Date(timestamp));
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('无法计算阅读日期');
  return `${year}-${month}-${day}`;
}

function dayNumber(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const value = Date.UTC(year, month - 1, date);
  const check = new Date(value);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return Math.floor(value / DAY_MS);
}

function recentActivityDay(day: string, today: number, days: number) {
  const value = dayNumber(day);
  return value !== null && value <= today && today - value < days;
}

function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`);
  return value;
}

function copyBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error('资源 bytes 必须是 Uint8Array');
  return new Uint8Array(value);
}

function normalizedChapter(chapter: ManagedNovelChapter): ManagedNovelChapter {
  if (!chapter || typeof chapter !== 'object') throw new Error('章节格式无效');
  if (chapter.contentKind !== 'text' && chapter.contentKind !== 'html') throw new Error('章节内容类型无效');
  if (typeof chapter.content !== 'string') throw new Error('章节内容必须是字符串');
  if (chapter.title !== undefined && typeof chapter.title !== 'string') throw new Error('章节标题必须是字符串');
  if (chapter.sourcePath !== undefined && typeof chapter.sourcePath !== 'string') throw new Error('章节来源路径必须是字符串');
  return {
    ...(chapter.title !== undefined ? { title: chapter.title } : {}),
    content: chapter.content,
    contentKind: chapter.contentKind,
    ...(chapter.sourcePath !== undefined ? { sourcePath: chapter.sourcePath } : {})
  };
}

function normalizedAsset(asset: ManagedNovelAsset): ManagedNovelAsset {
  if (!asset || typeof asset !== 'object') throw new Error('资源格式无效');
  return {
    path: normalizeText(asset.path, '资源路径'),
    mediaType: normalizeText(asset.mediaType, '资源 MIME 类型'),
    bytes: copyBytes(asset.bytes)
  };
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * 生成可直接并入 sources 主记录的持久化对象。
 * EPUB / MOBI 只接收已完成解析、资源已纳入 assets 的简单书籍，不复制原压缩包。
 */
export function serializeManagedNovelSource(input: ManagedNovelSourceInput, now = Date.now()): ManagedNovelSourcePayloadV1 {
  if (!input || typeof input !== 'object') throw new Error('小说存档格式无效');
  if (!['txt', 'markdown', 'epub', 'mobi'].includes(input.format)) throw new Error('不支持的小说格式');
  const sourceFingerprint = normalizeText(input.sourceFingerprint, '内容指纹');
  if (!Array.isArray(input.chapters) || input.chapters.length === 0) throw new Error('小说至少需要一个章节');
  const chapters = input.chapters.map(normalizedChapter);
  const assets = (input.assets || []).map(normalizedAsset);
  const createdAt = input.createdAt ?? now;
  if (!validDuration(createdAt)) throw new Error('创建时间无效');
  const serializedChapters = JSON.stringify(chapters);
  const assetBytes = assets.reduce((sum, asset) => sum + asset.bytes.byteLength
    + utf8Bytes(JSON.stringify({ path: asset.path, mediaType: asset.mediaType })), 0);
  return {
    kind: 'homura-managed-novel',
    schemaVersion: 1,
    serializerVersion: 1,
    format: input.format,
    sourceFingerprint,
    title: typeof input.title === 'string' && input.title.trim() ? input.title : null,
    chapters,
    assets,
    bytes: utf8Bytes(serializedChapters) + assetBytes,
    createdAt
  };
}

function assertManagedNovelSource(value: unknown): ManagedNovelSourcePayloadV1 {
  if (!value || typeof value !== 'object') throw new Error('小说存档格式无效');
  const archive = value as Partial<ManagedNovelSourcePayloadV1>;
  if (archive.kind !== 'homura-managed-novel' || archive.schemaVersion !== 1 || archive.serializerVersion !== 1) {
    throw new Error('小说存档版本不受支持');
  }
  if (!['txt', 'markdown', 'epub', 'mobi'].includes(String(archive.format))) throw new Error('小说存档格式无效');
  if (typeof archive.sourceFingerprint !== 'string' || !archive.sourceFingerprint.trim()) throw new Error('小说存档缺少内容指纹');
  if (!Array.isArray(archive.chapters) || archive.chapters.length === 0) throw new Error('小说存档缺少章节');
  if (!Array.isArray(archive.assets)) throw new Error('小说存档资源列表无效');
  if (!validDuration(archive.bytes) || !validDuration(archive.createdAt)) throw new Error('小说存档元数据无效');
  return {
    kind: 'homura-managed-novel',
    schemaVersion: 1,
    serializerVersion: 1,
    format: archive.format as ManagedNovelFormat,
    sourceFingerprint: archive.sourceFingerprint,
    title: typeof archive.title === 'string' && archive.title.trim() ? archive.title : null,
    chapters: archive.chapters.map(normalizedChapter),
    assets: archive.assets.map(normalizedAsset),
    bytes: archive.bytes,
    createdAt: archive.createdAt
  };
}

export function deserializeManagedNovelSource(value: unknown) {
  return assertManagedNovelSource(value);
}

export function reconcileReadingSession(session: ReadingSessionSnapshot): ReadingActivityCommit {
  if (!session || typeof session !== 'object') throw new Error('阅读活动格式无效');
  const bookId = normalizeText(session.bookId, '书籍 ID');
  if (!validDuration(session.openedAt) || !validDuration(session.closedAt) || session.closedAt < session.openedAt) {
    throw new Error('阅读活动时间无效');
  }
  if (!validDuration(session.activeMs)) throw new Error('有效阅读时长无效');
  const qualifies = session.activeMs >= SMART_STORAGE_DEFAULTS.minReadingSessionMs || session.progressed === true;
  const readingDay = session.readingDay ?? localDayKey(session.closedAt);
  if (readingDay !== null && dayNumber(readingDay) === null) throw new Error('阅读日期无效');
  const coldOpenMs = session.coldOpenMs === undefined ? null : session.coldOpenMs;
  if (coldOpenMs !== null && !validDuration(coldOpenMs)) throw new Error('冷打开耗时无效');
  const cachedOpenMs = session.cachedOpenMs;
  if (cachedOpenMs !== undefined && !validDuration(cachedOpenMs)) throw new Error('缓存打开耗时无效');
  return {
    bookId,
    at: session.closedAt,
    activeMs: session.activeMs,
    progressed: session.progressed === true,
    readingDay: qualifies ? readingDay : null,
    coldOpenMs,
    ...(cachedOpenMs !== undefined ? { cachedOpenMs } : {})
  };
}

export function mergeReadingActivity(
  previous: SmartReadingActivity | null,
  commit: ReadingActivityCommit
): SmartReadingActivity {
  if (!commit || typeof commit.bookId !== 'string' || !commit.bookId.trim()) throw new Error('活动提交缺少书籍 ID');
  if (!validDuration(commit.at)) throw new Error('活动提交时间无效');
  if (commit.readingDay !== null && dayNumber(commit.readingDay) === null) throw new Error('阅读日期无效');
  if (commit.coldOpenMs !== null && !validDuration(commit.coldOpenMs)) throw new Error('冷打开耗时无效');
  if (commit.cachedOpenMs !== undefined && !validDuration(commit.cachedOpenMs)) throw new Error('缓存打开耗时无效');
  const readingDates = new Set(previous?.readingDates || []);
  if (commit.readingDay) readingDates.add(commit.readingDay);
  const today = dayNumber(localDayKey(commit.at));
  if (today === null) throw new Error('无法计算活动日期');
  const retainedDates = [...readingDates]
    .filter(day => recentActivityDay(day, today, SMART_STORAGE_LIMITS.activityRetentionDays))
    .sort();
  const samples = [...(previous?.coldOpenSamples || [])];
  if (commit.coldOpenMs !== null) samples.push({ at: commit.at, durationMs: commit.coldOpenMs });
  samples.sort((left, right) => left.at - right.at);
  const cachedSamples = [...(previous?.cachedOpenSamples || [])];
  if (commit.cachedOpenMs !== undefined) cachedSamples.push({ at: commit.at, durationMs: commit.cachedOpenMs });
  cachedSamples.sort((left, right) => left.at - right.at);
  return {
    bookId: commit.bookId,
    readingDates: retainedDates,
    coldOpenSamples: samples.slice(-SMART_STORAGE_LIMITS.maxColdOpenSamples),
    cachedOpenSamples: cachedSamples.slice(-SMART_STORAGE_LIMITS.maxColdOpenSamples),
    lastReadAt: commit.readingDay ? commit.at : previous?.lastReadAt ?? null,
    updatedAt: commit.at
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateSmartTransferEligibility(input: SmartTransferEvaluationInput): SmartTransferEvaluation {
  const now = input.now ?? Date.now();
  if (!validDuration(now)) throw new Error('当前时间无效');
  const today = dayNumber(localDayKey(now));
  if (today === null) throw new Error('无法计算当前日期');
  const readingDateCount = new Set(
    input.activity.readingDates.filter(day => recentActivityDay(day, today, SMART_STORAGE_DEFAULTS.activityWindowDays))
  ).size;
  const recentSamples = input.activity.coldOpenSamples
    .filter(sample => validDuration(sample.at) && validDuration(sample.durationMs) && sample.at <= now && now - sample.at < SMART_STORAGE_DEFAULTS.activityWindowDays * DAY_MS)
    .map(sample => sample.durationMs);
  const medianColdOpenMs = median(recentSamples);
  const recentCachedSamples = (input.activity.cachedOpenSamples || [])
    .filter(sample => validDuration(sample.at) && validDuration(sample.durationMs) && sample.at <= now && now - sample.at < SMART_STORAGE_DEFAULTS.activityWindowDays * DAY_MS)
    .map(sample => sample.durationMs);
  const medianCachedOpenMs = median(recentCachedSamples);
  const reasons: SmartTransferReason[] = [];
  if (readingDateCount < SMART_STORAGE_DEFAULTS.requiredReadingDateCount) reasons.push('insufficient-reading-dates');
  if (recentSamples.length < SMART_STORAGE_DEFAULTS.requiredColdOpenSampleCount) reasons.push('insufficient-cold-open-samples');
  if (medianColdOpenMs === null || medianColdOpenMs < SMART_STORAGE_DEFAULTS.slowColdOpenMs) reasons.push('cold-open-not-slow-enough');
  if (!input.sourceAvailable) reasons.push('source-unavailable');
  if (!validDuration(input.archiveBytes) || input.archiveBytes <= 0) reasons.push('missing-archive-size');
  return {
    bookId: input.activity.bookId,
    eligible: reasons.length === 0,
    reasons,
    readingDateCount,
    coldOpenSampleCount: recentSamples.length,
    medianColdOpenMs,
    cachedOpenSampleCount: recentCachedSamples.length,
    medianCachedOpenMs,
    archiveBytes: input.archiveBytes
  };
}

export function rankSmartTransferCandidates(
  evaluations: SmartTransferEvaluation[],
  budgetBytes = SMART_STORAGE_DEFAULTS.defaultBudgetBytes
): SmartTransferCapacityPlan {
  if (!validDuration(budgetBytes)) throw new Error('转存容量预算无效');
  const ranked = evaluations
    .filter(evaluation => evaluation.eligible)
    .map(evaluation => {
      const expectedColdOpens = evaluation.readingDateCount;
      const savingsPerOpenMs = Math.max(0, (evaluation.medianColdOpenMs || 0) - (evaluation.medianCachedOpenMs || 0));
      const projectedSavingsMs = expectedColdOpens * savingsPerOpenMs;
      return {
        ...evaluation,
        expectedColdOpens,
        savingsPerOpenMs,
        projectedSavingsMs,
        efficiency: projectedSavingsMs / evaluation.archiveBytes
      };
    })
    .sort((left, right) => right.efficiency - left.efficiency || left.bookId.localeCompare(right.bookId));
  const selected: SmartTransferCandidate[] = [];
  const deferred: SmartTransferCandidate[] = [];
  let selectedBytes = 0;
  for (const candidate of ranked) {
    if (candidate.projectedSavingsMs > 0 && selectedBytes + candidate.archiveBytes <= budgetBytes) {
      selected.push(candidate);
      selectedBytes += candidate.archiveBytes;
    } else {
      deferred.push(candidate);
    }
  }
  return { ranked, selected, deferred, selectedBytes, budgetBytes };
}

export function findReclaimableAutoArchives(
  activities: SmartReadingActivity[],
  archives: AutoNovelArchiveSummary[],
  now = Date.now(),
  idleDays = SMART_STORAGE_DEFAULTS.idleDays
): string[] {
  if (!validDuration(now) || !validDuration(idleDays)) throw new Error('自动存档回收参数无效');
  const activityById = new Map(activities.map(activity => [activity.bookId, activity]));
  const idleMs = idleDays * DAY_MS;
  return archives
    .filter(archive => {
      const lastReadAt = activityById.get(archive.bookId)?.lastReadAt;
      return now - (lastReadAt ?? archive.createdAt) >= idleMs;
    })
    .map(archive => archive.bookId)
    .sort();
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务已取消'));
  });
}

function autoArchiveSummary(record: AutoNovelArchiveRecord): AutoNovelArchiveSummary {
  return {
    bookId: record.bookId,
    mode: record.mode,
    bytes: record.bytes,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt
  };
}

function openDatabase(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(SMART_STORAGE_LIMITS.databaseName, SMART_STORAGE_LIMITS.databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!database.objectStoreNames.contains(SMART_STORAGE_LIMITS.activityStoreName)) {
        database.createObjectStore(SMART_STORAGE_LIMITS.activityStoreName, { keyPath: 'bookId' });
      }
      if (!database.objectStoreNames.contains(SMART_STORAGE_LIMITS.archiveStoreName)) {
        database.createObjectStore(SMART_STORAGE_LIMITS.archiveStoreName, { keyPath: 'bookId' });
      }
      if (!database.objectStoreNames.contains(SMART_STORAGE_LIMITS.archiveSummaryStoreName)) {
        database.createObjectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName, { keyPath: 'bookId' });
      }
      if (transaction) {
        const archives = transaction.objectStore(SMART_STORAGE_LIMITS.archiveStoreName);
        const summaries = transaction.objectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName);
        // v1 升级时只逐条游标回填摘要，不把全部正文存档聚合进内存。
        const cursorRequest = archives.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          summaries.put(autoArchiveSummary(cursor.value as AutoNovelArchiveRecord));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('智能存储数据库打开失败'));
    request.onblocked = () => console.warn('[SmartStorage] IndexedDB 升级等待其它页面关闭旧连接');
  });
}

export function createSmartStorageRepository(factory?: IDBFactory): SmartStorageRepository {
  const indexed = factory || globalThis.indexedDB;
  if (!indexed) throw new Error('IndexedDB 不可用');
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = () => {
    if (!databasePromise) {
      databasePromise = openDatabase(indexed).then(database => {
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        return database;
      }).catch(error => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };

  return {
    async loadActivity(bookId) {
      const db = await database();
      const tx = db.transaction(SMART_STORAGE_LIMITS.activityStoreName, 'readonly');
      return (await requestResult(tx.objectStore(SMART_STORAGE_LIMITS.activityStoreName).get(bookId))) || null;
    },
    async listActivities() {
      const db = await database();
      const tx = db.transaction(SMART_STORAGE_LIMITS.activityStoreName, 'readonly');
      const rows = await requestResult(tx.objectStore(SMART_STORAGE_LIMITS.activityStoreName).getAll());
      return (rows || []) as SmartReadingActivity[];
    },
    async recordActivity(commit) {
      const db = await database();
      return new Promise<SmartReadingActivity>((resolve, reject) => {
        const tx = db.transaction(SMART_STORAGE_LIMITS.activityStoreName, 'readwrite');
        const store = tx.objectStore(SMART_STORAGE_LIMITS.activityStoreName);
        let next: SmartReadingActivity | null = null;
        tx.oncomplete = () => {
          if (next) resolve(next);
          else reject(new Error('阅读活动未写入'));
        };
        tx.onerror = () => reject(tx.error || new Error('阅读活动保存失败'));
        tx.onabort = () => reject(tx.error || new Error('阅读活动事务已取消'));
        const request = store.get(commit.bookId);
        request.onsuccess = () => {
          try {
            next = mergeReadingActivity((request.result as SmartReadingActivity | undefined) || null, commit);
            store.put(next);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        };
        request.onerror = () => reject(request.error || new Error('阅读活动读取失败'));
      });
    },
    async saveAutoArchive(bookId, archive, at = Date.now()) {
      const normalizedBookId = normalizeText(bookId, '书籍 ID');
      const normalizedArchive = assertManagedNovelSource(archive);
      if (!validDuration(at)) throw new Error('自动存档时间无效');
      const record: AutoNovelArchiveRecord = {
        bookId: normalizedBookId,
        mode: 'auto',
        archive: normalizedArchive,
        bytes: normalizedArchive.bytes,
        createdAt: at,
        lastUsedAt: at
      };
      const db = await database();
      const tx = db.transaction(
        [SMART_STORAGE_LIMITS.archiveStoreName, SMART_STORAGE_LIMITS.archiveSummaryStoreName],
        'readwrite'
      );
      const done = transactionDone(tx);
      tx.objectStore(SMART_STORAGE_LIMITS.archiveStoreName).put(record);
      tx.objectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName).put(autoArchiveSummary(record));
      await done;
    },
    async loadAutoArchive(bookId) {
      const db = await database();
      const tx = db.transaction(SMART_STORAGE_LIMITS.archiveStoreName, 'readonly');
      return (await requestResult(tx.objectStore(SMART_STORAGE_LIMITS.archiveStoreName).get(bookId))) || null;
    },
    async listAutoArchives() {
      const db = await database();
      const tx = db.transaction(SMART_STORAGE_LIMITS.archiveStoreName, 'readonly');
      const rows = await requestResult(tx.objectStore(SMART_STORAGE_LIMITS.archiveStoreName).getAll());
      return (rows || []) as AutoNovelArchiveRecord[];
    },
    async listAutoArchiveSummaries() {
      const db = await database();
      const tx = db.transaction(SMART_STORAGE_LIMITS.archiveSummaryStoreName, 'readonly');
      return (await requestResult(tx.objectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName).getAll()) || []) as AutoNovelArchiveSummary[];
    },
    async deleteAutoArchive(bookId) {
      const db = await database();
      const tx = db.transaction(
        [SMART_STORAGE_LIMITS.archiveStoreName, SMART_STORAGE_LIMITS.archiveSummaryStoreName],
        'readwrite'
      );
      const done = transactionDone(tx);
      tx.objectStore(SMART_STORAGE_LIMITS.archiveStoreName).delete(bookId);
      tx.objectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName).delete(bookId);
      await done;
    },
    async deleteBookLearning(id) {
      const normalizedBookId = normalizeText(id, '书籍 ID');
      const db = await database();
      const tx = db.transaction(
        [
          SMART_STORAGE_LIMITS.activityStoreName,
          SMART_STORAGE_LIMITS.archiveStoreName,
          SMART_STORAGE_LIMITS.archiveSummaryStoreName
        ],
        'readwrite'
      );
      const done = transactionDone(tx);
      tx.objectStore(SMART_STORAGE_LIMITS.activityStoreName).delete(normalizedBookId);
      tx.objectStore(SMART_STORAGE_LIMITS.archiveStoreName).delete(normalizedBookId);
      tx.objectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName).delete(normalizedBookId);
      await done;
    },
    async clear() {
      const db = await database();
      const tx = db.transaction(
        [
          SMART_STORAGE_LIMITS.activityStoreName,
          SMART_STORAGE_LIMITS.archiveStoreName,
          SMART_STORAGE_LIMITS.archiveSummaryStoreName
        ],
        'readwrite'
      );
      const done = transactionDone(tx);
      tx.objectStore(SMART_STORAGE_LIMITS.activityStoreName).clear();
      tx.objectStore(SMART_STORAGE_LIMITS.archiveStoreName).clear();
      tx.objectStore(SMART_STORAGE_LIMITS.archiveSummaryStoreName).clear();
      await done;
    },
    close() {
      if (databasePromise) databasePromise.then(db => db.close()).catch(() => {});
      databasePromise = null;
    }
  };
}
