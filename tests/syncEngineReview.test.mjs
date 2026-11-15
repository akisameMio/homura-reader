import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../src/services/syncEngine.ts';
import { localSnapshotSignature } from '../src/services/syncSnapshot.ts';

const key = `sha256:${'1'.repeat(64)}`;
const secondKey = `sha256:${'2'.repeat(64)}`;
const copy = value => structuredClone(value);
const emptySnapshot = () => ({ books: [], progress: [], collections: [] });
const record = (kind, value, counter = 50, extra = {}) => ({
  kind, key: kind === 'collection' ? 'collection_remote' : key,
  value, version: { counter, deviceId: 'remote' }, ...extra
});

function remote(records = []) {
  let document = { schemaVersion: 1, records: copy(records) };
  let revision = 1;
  let writes = 0;
  return {
    read: async () => ({ document: copy(document), etag: `"${revision}"` }),
    write: async (next, etag) => {
      if (etag !== `"${revision}"`) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
      document = copy(next);
      revision++;
      writes++;
    },
    get document() { return copy(document); },
    get writes() { return writes; }
  };
}

function device(initial = emptySnapshot(), identities = { local: key }) {
  let snapshot = copy(initial);
  let state = null;
  let activeId = null;
  let saves = 0;
  let failSave = -1;
  let beforeApply = null;
  const blocked = new Set();
  const deps = {
    profileId: 'profile', deviceId: 'local',
    async loadState() { return copy(state); },
    async saveState(next, previousRevision) {
      saves++;
      if (saves === failSave) throw new Error('进程退出');
      if ((state?.revision || 0) !== previousRevision) throw new Error('SYNC_STATE_CHANGED');
      state = copy(next);
    },
    async readSnapshot() { return copy(snapshot); },
    async getSource(id) {
      if (blocked.has(id)) throw new Error('原文件暂不可读');
      return identities[id] ? { fingerprint: identities[id] } : undefined;
    },
    async fingerprint(source) { return source.fingerprint; },
    async applySnapshot(expected, next) {
      if (beforeApply) { const task = beforeApply; beforeApply = null; task(); }
      if (localSnapshotSignature(expected) !== localSnapshotSignature(snapshot)) throw new Error('SYNC_LOCAL_CHANGED');
      snapshot = copy(next);
    },
    activeBookId() { return activeId; },
    now() { return 1234; }
  };
  return {
    engine: createSyncEngine(deps), blocked,
    restart() { this.engine = createSyncEngine(deps); },
    get snapshot() { return snapshot; },
    set snapshot(next) { snapshot = copy(next); },
    get state() { return copy(state); },
    set activeId(next) { activeId = next; },
    set failSave(next) { failSave = next; },
    set beforeApply(task) { beforeApply = task; }
  };
}

test('首次识别同源文件时保留远端收藏与进度，用本地 ID 应用，不创建无源作品', async () => {
  const server = remote([
    record('favorite', true),
    record('progress', { index: 70, total: 100, ratio: 0.7 }),
    record('favorite', true, 51, { key: secondKey })
  ]);
  const client = device({ books: [{ id: 'local', favorite: false }], progress: [], collections: [] });
  const stats = await client.engine.sync(server);
  assert.equal(client.snapshot.books[0].favorite, true);
  assert.equal(client.snapshot.progress[0].id, 'local');
  assert.equal(client.snapshot.progress[0].index, 70);
  assert.equal(client.snapshot.books.length, 1);
  assert.equal(stats.remoteOnlyCount, 1);
});

test('正在阅读时不替换定位，关闭后下次同步可接受远端进度，保留本机排版', async () => {
  const server = remote([record('progress', { index: 70, total: 100, ratio: 0.7 })]);
  const client = device({
    books: [{ id: 'local' }],
    progress: [{ id: 'local', index: 10, total: 100, ratio: 0.1, layout: { fontSize: 28, direction: 'rtl' } }],
    collections: []
  });
  client.activeId = 'local';
  await client.engine.sync(server);
  assert.equal(client.snapshot.progress[0].index, 10);
  client.activeId = null;
  await client.engine.sync(server);
  assert.equal(client.snapshot.progress[0].index, 70);
  assert.deepEqual(client.snapshot.progress[0].layout, { fontSize: 28, direction: 'rtl' });
});

test('清空进度生成墓碑，重启及相同文件换本地 ID 重导入都不恢复旧进度', async () => {
  const server = remote([record('progress', { index: 70, total: 100, ratio: 0.7 })]);
  const client = device({ books: [{ id: 'local' }], progress: [], collections: [] }, { local: key, reimported: key });
  await client.engine.sync(server);
  client.snapshot = { ...client.snapshot, progress: [] };
  await client.engine.capture();
  client.restart();
  await client.engine.sync(server);
  assert.equal(server.document.records.find(item => item.kind === 'progress').deleted, true);
  client.snapshot = { books: [{ id: 'reimported' }], progress: [], collections: [] };
  await client.engine.sync(server);
  assert.deepEqual(client.snapshot.progress, []);
});

test('并发移动使用一个归属寄存器，同源文件在不同设备 ID 下只属于一个书库', async () => {
  const server = remote([
    record('collection', { title: '远端书库', createdAt: 1 }),
    record('membership', 'collection_remote')
  ]);
  const client = device({
    books: [{ id: 'local' }], progress: [],
    collections: [{ id: 'collection_local', title: '本机书库', createdAt: 2, bookIds: ['local'] }]
  });
  await client.engine.sync(server);
  assert.equal(client.snapshot.collections.filter(item => item.bookIds.includes('local')).length, 1);
  assert.equal(client.snapshot.collections.find(item => item.id === 'collection_remote').bookIds[0], 'local');
});

test('网络等待期间本地继续阅读时重试，保存本地新位置并使用更高逻辑版本', async () => {
  const server = remote([record('progress', { index: 70, total: 100, ratio: 0.7 })]);
  const client = device({
    books: [{ id: 'local' }], progress: [{ id: 'local', index: 10, total: 100, ratio: 0.1 }], collections: []
  });
  client.beforeApply = () => { client.snapshot.progress[0] = { id: 'local', index: 20, total: 100, ratio: 0.2 }; };
  await client.engine.sync(server);
  assert.equal(client.snapshot.progress[0].index, 20);
  const saved = server.document.records.find(item => item.kind === 'progress');
  assert.equal(saved.value.index, 20);
  assert.ok(saved.version.counter > 50);
});

test('本地应用成功但比较基线保存前退出，重启后可恢复同步且不会回滚', async () => {
  const server = remote([record('favorite', true)]);
  const client = device({ books: [{ id: 'local', favorite: false }], progress: [], collections: [] });
  client.failSave = 3;
  await assert.rejects(client.engine.sync(server), /进程退出/);
  assert.equal(client.snapshot.books[0].favorite, true);
  client.restart();
  await client.engine.sync(server);
  assert.equal(client.snapshot.books[0].favorite, true);
  assert.equal(server.document.records.find(item => item.kind === 'favorite').value, true);
});

test('一个原文件无法读取时不阻断其它书籍，并在后续重新识别', async () => {
  const client = device({
    books: [{ id: 'local', favorite: true }, { id: 'other', favorite: true }], progress: [], collections: []
  }, { local: key, other: secondKey });
  client.blocked.add('local');
  let stats = await client.engine.capture();
  assert.equal(stats.matchedCount, 1);
  assert.equal(stats.unmatchedCount, 1);
  assert.equal(client.state.document.records.find(item => item.kind === 'favorite').key, secondKey);
  client.blocked.clear();
  stats = await client.engine.capture();
  assert.equal(stats.matchedCount, 2);
  assert.equal(client.state.document.records.filter(item => item.kind === 'favorite').length, 2);
});

test('原文件暂不可读期间的显式清除应在恢复识别后保留，不被远端旧值复活', async () => {
  const server = remote([
    record('favorite', true),
    record('progress', { index: 70, total: 100, ratio: 0.7 }),
    record('collection', { title: '书库', createdAt: 1 }),
    record('membership', 'collection_remote')
  ]);
  const client = device({
    books: [{ id: 'local', favorite: true }],
    progress: [{ id: 'local', index: 10, total: 100, ratio: 0.1 }],
    collections: [{ id: 'collection_remote', title: '书库', createdAt: 1, bookIds: ['local'] }]
  });
  client.blocked.add('local');
  await client.engine.sync(server);
  client.snapshot = {
    books: [{ id: 'local', favorite: false }], progress: [],
    collections: [{ id: 'collection_remote', title: '书库', createdAt: 1, bookIds: [] }]
  };
  await client.engine.capture();
  client.blocked.clear();
  await client.engine.sync(server);
  assert.equal(client.snapshot.books[0].favorite, false);
  assert.deepEqual(client.snapshot.progress, []);
  assert.deepEqual(client.snapshot.collections.find(item => item.id === 'collection_remote').bookIds, []);
});

test('没有书库编辑时同步保留本机书库顺序，不按书架顺序重排连读', async () => {
  const client = device({
    books: [{ id: 'local' }, { id: 'other' }], progress: [],
    collections: [{ id: 'collection_remote', title: '系列', createdAt: 1, bookIds: ['other', 'local'] }]
  }, { local: key, other: secondKey });
  await client.engine.sync(remote());
  assert.deepEqual(client.snapshot.collections[0].bookIds, ['other', 'local']);
});

test('远端定位缺少章节锚点时替换旧定位字段，避免继承本机旧章，同时保留排版', async () => {
  const server = remote([record('progress', { ratio: 0.7, updatedAt: 2 })]);
  const client = device({
    books: [{ id: 'local' }],
    progress: [{
      id: 'local', type: 'novel', index: 10, total: 100, ratio: 0.1,
      chapterIndex: 1, chapterRatio: 0.2, updatedAt: 1, layout: { fontSize: 28 }
    }],
    collections: []
  });
  await client.engine.sync(server);
  assert.equal(client.snapshot.progress[0].ratio, 0.7);
  assert.equal(client.snapshot.progress[0].chapterIndex, undefined);
  assert.equal(client.snapshot.progress[0].chapterRatio, undefined);
  assert.equal(client.snapshot.progress[0].index, undefined);
  assert.equal(client.snapshot.progress[0].total, undefined);
  assert.deepEqual(client.snapshot.progress[0].layout, { fontSize: 28 });
  assert.equal(client.snapshot.progress[0].type, 'novel');
});

test('远端清除定位墓碑保留本机排版，不把设备阅读偏好一起删除', async () => {
  const server = remote([record('progress', null, 50, { deleted: true })]);
  const client = device({
    books: [{ id: 'local' }],
    progress: [{ id: 'local', index: 10, total: 100, ratio: 0.1, chapterIndex: 1, chapterRatio: 0.2, layout: { fontSize: 28, spread: 1 } }],
    collections: []
  });
  await client.engine.sync(server);
  assert.deepEqual(client.snapshot.progress, [{ id: 'local', layout: { fontSize: 28, spread: 1 } }]);
  assert.equal(server.document.records.find(item => item.kind === 'progress').deleted, true);
  await client.engine.capture();
  assert.equal(client.state.document.records.find(item => item.kind === 'progress').deleted, true);
});

test('同步重建 SQLite 镜像时不覆盖读取快照之后保存的新收藏', { timeout: 5000 }, async t => {
  const originalWindow = globalThis.window;
  const originalIndexedDB = globalThis.indexedDB;
  const { resetNativeRuntimeState } = await import('../src/services/nativeRuntime.ts');
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDB;
    resetNativeRuntimeState();
  });
  const initial = {
    books: [{ id: 'local', type: 'novel', title: '作品', favorite: false, pageCount: 100, addedAt: 1 }],
    progress: [], collections: []
  };
  const data = copy({ ...initial, sources: [] });
  let nativeBooks = copy(initial.books);
  let syncCommitted = false;
  let snapshotHeld = false;
  let releaseSnapshot;
  let snapshotReached;
  let favoriteCommitted;
  const snapshotReady = new Promise(resolve => { snapshotReached = resolve; });
  const favoriteReady = new Promise(resolve => { favoriteCommitted = resolve; });

  // 暂停同步后续的书库读取：此事务只锁书库，收藏的 books 写入可以先提交。
  const database = {
    transaction(storeNames, mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const requests = [];
      const tx = {
        objectStore(name) {
          const request = result => {
            const item = { result: copy(result) };
            requests.push(item);
            return item;
          };
          return {
            getAll: () => request(data[name]),
            get: id => request(data[name].find(item => item.id === id)),
            put(value) {
              data[name] = data[name].filter(item => item.id !== value.id).concat(copy(value));
              return request(value.id);
            },
            clear() { data[name] = []; return request(undefined); }
          };
        },
        abort() { tx.aborted = true; queueMicrotask(() => tx.onabort?.()); }
      };
      queueMicrotask(() => {
        while (requests.length) requests.shift().onsuccess?.();
        if (tx.aborted) return;
        const complete = () => {
          if (mode === 'readwrite' && names.length > 1) syncCommitted = true;
          tx.oncomplete?.();
          if (mode === 'readwrite' && names.length === 1 && names[0] === 'books') favoriteCommitted();
        };
        if (syncCommitted && !snapshotHeld && mode === 'readonly' && names.includes('collections')) {
          snapshotHeld = true;
          releaseSnapshot = complete;
          snapshotReached();
        } else complete();
      });
      return tx;
    }
  };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => { request.result = database; request.onsuccess?.(); });
      return request;
    }
  };
  globalThis.indexedDB = indexedDB;
  globalThis.window = {
    indexedDB,
    __TAURI__: {
      core: {
        async invoke(command, args) {
          if (command === 'metadata_replace_all') nativeBooks = copy(args.snapshot.books);
          else if (command === 'metadata_upsert_book') {
            nativeBooks = nativeBooks.filter(book => book.id !== args.book.id).concat(copy(args.book));
          } else throw new Error(`意外原生命令：${command}`);
          return null;
        }
      }
    }
  };
  resetNativeRuntimeState();
  const { HomuraStore } = await import('../src/services/storage.ts');
  const syncing = HomuraStore.applySyncMetadata(copy(initial), copy(initial));
  await snapshotReady;
  const favorite = HomuraStore.updateBookFavorite('local', true);
  await favoriteReady;
  await new Promise(resolve => setImmediate(resolve));
  releaseSnapshot();
  await Promise.all([syncing, favorite]);
  assert.equal(data.books[0].favorite, true);
  assert.equal(nativeBooks[0].favorite, true, 'SQLite 完整替换不能让较早快照覆盖后提交的收藏');
});
