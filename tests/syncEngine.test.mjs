import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../src/services/syncEngine.ts';
import { mergeSyncDocuments } from '../src/services/syncModel.ts';
import { localSnapshotSignature } from '../src/services/syncSnapshot.ts';

const key = 'sha256:' + 'a'.repeat(64);
const clone = value => structuredClone(value);
const snapshot = (id = 'book-a') => ({ books: [{ id, favorite: false }], progress: [], collections: [] });

function client(id, initial = snapshot()) {
  let local = clone(initial);
  let stored = null;
  let active = null;
  let beforeApply = null;
  const deps = {
    profileId: 'profile',
    deviceId: id,
    loadState: async () => clone(stored),
    saveState: async (state, revision) => {
      assert.equal(stored?.revision || 0, revision);
      stored = clone(state);
    },
    readSnapshot: async () => clone(local),
    getSource: async () => ({ blob: new Blob(['book bytes']) }),
    fingerprint: async () => key,
    applySnapshot: async (expected, next) => {
      if (beforeApply) { const action = beforeApply; beforeApply = null; action(); }
      if (localSnapshotSignature(expected) !== localSnapshotSignature(local)) throw new Error('SYNC_LOCAL_CHANGED');
      local = clone(next);
    },
    activeBookId: () => active,
    now: () => 12345
  };
  let engine = createSyncEngine(deps);
  return {
    get local() { return local; },
    set local(value) { local = value; },
    get state() { return stored; },
    get engine() { return engine; },
    restart() { engine = createSyncEngine(deps); },
    set active(value) { active = value; },
    set beforeApply(value) { beforeApply = value; }
  };
}

function server() {
  let document = null;
  let version = 0;
  let conflict = null;
  let unavailable = false;
  const transport = {
    async read() {
      if (unavailable) throw new Error('offline');
      return { document: clone(document), etag: document ? `"${version}"` : null };
    },
    async write(next, etag) {
      if (conflict) { const action = conflict; conflict = null; document = action(document); version++; }
      if (etag !== (document ? `"${version}"` : null)) throw Object.assign(new Error('changed'), { code: 'CONFLICT' });
      document = clone(next);
      version++;
    }
  };
  return {
    transport,
    get document() { return document; },
    set document(value) { document = value; version++; },
    set conflict(value) { conflict = value; },
    set unavailable(value) { unavailable = value; }
  };
}

test('相同内容不同本地 ID 同步收藏、定位和唯一书库归属，不上传源文件与设备排版', async () => {
  const a = client('device-a');
  const b = client('device-b', snapshot('book-b'));
  const remote = server();
  a.local.books[0].favorite = true;
  a.local.progress = [{ id: 'book-a', index: 4, total: 10, ratio: 4 / 9, chapterIndex: 1, chapterRatio: .25, updatedAt: 99, layout: { spread: 2, fontSize: 28 }, nativePath: '/secret' }];
  a.local.collections = [{ id: 'collection-1', title: '小说', createdAt: 1, bookIds: ['book-a'] }];
  b.local.progress = [];
  await a.engine.sync(remote.transport);
  const result = await b.engine.sync(remote.transport);
  assert.equal(b.local.books[0].favorite, true);
  assert.equal(b.local.progress[0].id, 'book-b');
  assert.equal(b.local.progress[0].chapterRatio, .25);
  assert.equal(b.local.progress[0].layout, undefined);
  assert.deepEqual(b.local.collections[0].bookIds, ['book-b']);
  assert.equal(result.pendingCount, 0);
  const serialized = JSON.stringify(remote.document);
  for (const forbidden of ['nativePath', '/secret', '"layout"', 'book-a', 'book-b', 'blob']) assert.equal(serialized.includes(forbidden), false);
});

test('离线改收藏、回看前文、删除书库与清空进度跨重启保留，旧设备不能复活墓碑', async () => {
  const a = client('device-a');
  const b = client('device-b', snapshot('book-b'));
  const remote = server();
  a.local.books[0].favorite = true;
  a.local.progress = [{ id: 'book-a', index: 8, total: 10, ratio: 8 / 9, updatedAt: 10 }];
  a.local.collections = [{ id: 'collection-1', title: '小说', createdAt: 1, bookIds: ['book-a'] }];
  await a.engine.sync(remote.transport);
  await b.engine.sync(remote.transport);
  remote.unavailable = true;
  a.local.books[0].favorite = false;
  a.local.progress = [{ id: 'book-a', index: 2, total: 10, ratio: 2 / 9, updatedAt: 20 }];
  await assert.rejects(a.engine.sync(remote.transport), /offline/);
  a.restart();
  remote.unavailable = false;
  await a.engine.sync(remote.transport);
  await b.engine.sync(remote.transport);
  assert.equal(b.local.progress[0].index, 2, '回看允许进度变小');
  assert.equal(b.local.books[0].favorite, false);
  a.local.progress = [];
  a.local.collections = [];
  a.restart();
  await a.engine.sync(remote.transport);
  await b.engine.sync(remote.transport);
  assert.deepEqual(b.local.collections, []);
  assert.deepEqual(b.local.progress, []);
  assert.ok(remote.document.records.some(record => record.kind === 'progress' && record.deleted));
  assert.ok(remote.document.records.some(record => record.kind === 'collection' && record.deleted));
});

test('远端没有源文件时只保留记录，之后导入可匹配且默认未收藏不覆盖远端', async () => {
  const a = client('device-a');
  const b = client('device-b', { books: [], progress: [], collections: [] });
  const remote = server();
  a.local.books[0].favorite = true;
  a.local.progress = [{ id: 'book-a', index: 3, total: 10, ratio: 1 / 3 }];
  await a.engine.sync(remote.transport);
  const unmatched = await b.engine.sync(remote.transport);
  assert.equal(unmatched.remoteOnlyCount, 1);
  assert.deepEqual(b.local.books, []);
  assert.deepEqual(b.local.progress, []);
  b.local = snapshot('later-import');
  await b.engine.sync(remote.transport);
  assert.equal(b.local.books[0].favorite, true);
  assert.equal(b.local.progress[0].index, 3);
});

test('远端更新正在阅读的书时不跳页，退出后才能恢复远端位置并保留本机排版', async () => {
  const a = client('device-a');
  const b = client('device-b', snapshot('book-b'));
  const remote = server();
  await b.engine.sync(remote.transport);
  b.local.progress = [{ id: 'book-b', index: 1, total: 10, ratio: 1 / 9, layout: { spread: 1, fontSize: 18 } }];
  await b.engine.sync(remote.transport);
  await a.engine.sync(remote.transport);
  a.local.progress[0] = { ...a.local.progress[0], index: 7, ratio: 7 / 9 };
  await a.engine.sync(remote.transport);
  b.active = 'book-b';
  await b.engine.sync(remote.transport);
  assert.equal(b.local.progress[0].index, 1);
  b.active = null;
  await b.engine.sync(remote.transport);
  assert.equal(b.local.progress[0].index, 7);
  assert.deepEqual(b.local.progress[0].layout, { spread: 1, fontSize: 18 });
});

test('ETag 竞争时重新拉取合并，保留另一个客户端写入的独立字段', async () => {
  const a = client('device-a');
  const remote = server();
  a.local.books[0].favorite = true;
  remote.conflict = document => mergeSyncDocuments(document || { schemaVersion: 1, records: [] }, {
    schemaVersion: 1,
    records: [{ kind: 'collection', key: 'remote-collection', value: { title: '漫画', createdAt: 1 }, version: { counter: 3, deviceId: 'device-b' } }]
  });
  await a.engine.sync(remote.transport);
  assert.ok(remote.document.records.some(record => record.kind === 'favorite' && record.value));
  assert.equal(a.local.collections[0].title, '漫画');
});

test('提交前发生本地编辑时重试，防止同步覆盖网络等待期间的修改', async () => {
  const a = client('device-a');
  const remote = server();
  await a.engine.sync(remote.transport);
  remote.document = {
    schemaVersion: 1,
    records: [{ kind: 'progress', key, value: { index: 3, total: 10, ratio: 1 / 3 }, version: { counter: 10, deviceId: 'device-b' } }]
  };
  a.beforeApply = () => {
    a.local.books[0].favorite = true;
    a.local.collections = [{ id: 'new-collection', title: '刚建的书库', createdAt: 2, bookIds: ['book-a'] }];
  };
  await a.engine.sync(remote.transport);
  assert.equal(a.local.books[0].favorite, true);
  assert.equal(a.local.collections[0].title, '刚建的书库');
  assert.ok(remote.document.records.some(record => record.kind === 'favorite' && record.value));
});

test('损坏或含不允许字段的远端文档不会应用到本地，待发送修改仍可恢复', async () => {
  const a = client('device-a');
  const remote = server();
  a.local.books[0].favorite = true;
  remote.document = { schemaVersion: 999, records: [] };
  await assert.rejects(a.engine.sync(remote.transport), /格式无效/);
  assert.equal(a.local.books[0].favorite, true);
  assert.ok((await a.engine.capture()).pendingCount > 0);
  assert.equal(a.state.lastSyncAt, null);
});

test('云端引用不参与本地文件指纹匹配，元数据同步保留云端书的本机收藏与书库归属', async () => {
  const cloud = { id: 'webdav_test', remote: true, favorite: true };
  const device = client('device-cloud', { books: [cloud], progress: [{ id: cloud.id, index: 2, total: 10 }], collections: [{ id: 'cloud-shelf', title: '在线书库', createdAt: 1, bookIds: [cloud.id] }] });
  const remote = server();
  const stats = await device.engine.sync(remote.transport);
  assert.equal(stats.matchedCount, 0);
  assert.equal(stats.unmatchedCount, 0);
  assert.equal(device.local.books[0].favorite, true);
  assert.deepEqual(device.local.collections[0].bookIds, [cloud.id]);
  assert.ok(!device.state.document.records.some(record => record.kind !== 'collection'));
});

test('同步保留本机书库层级，V1 文档继续同步书库名称和归属', async () => {
  const a = client('device-a');
  const b = client('device-b', snapshot('book-b'));
  const remote = server();
  a.local.collections = [
    { id: 'root', title: '漫画', bookIds: [], createdAt: 1 },
    { id: 'child', title: '作者', parentId: 'root', importFolderKey: 'private-location', bookIds: ['book-a'], createdAt: 2 }
  ];
  await a.engine.sync(remote.transport);
  await b.engine.sync(remote.transport);
  const localChild = b.local.collections.find(item => item.id === 'child');
  assert.equal(localChild.parentId, undefined);
  assert.equal(localChild.importFolderKey, undefined);
  assert.deepEqual(localChild.bookIds, ['book-b']);
  localChild.title = '改名';
  await b.engine.sync(remote.transport);
  await a.engine.sync(remote.transport);
  assert.deepEqual(a.local.collections.find(item => item.id === 'child'), {
    id: 'child', title: '改名', parentId: 'root', importFolderKey: 'private-location', bookIds: ['book-a'], createdAt: 2
  });
  assert.doesNotMatch(JSON.stringify(remote.document), /parentId|importFolderKey|private-location/);
});
