import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSyncEngine } from '../src/services/syncEngine.ts';
import { fingerprintSource, prepareSourceIdentity } from '../src/services/syncIdentity.ts';
import { localSnapshotSignature } from '../src/services/syncSnapshot.ts';

const clone = value => structuredClone(value);
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const initial = () => ({
  books: [{ id: 'local', favorite: true }],
  progress: [{ id: 'local', index: 1, total: 10, ratio: 0.1 }],
  collections: []
});

function client(source = null) {
  let bytes = 'book-one';
  let modified = 10;
  let denied = false;
  let failedHash = false;
  let local = initial();
  let state = null;
  let hashes = 0;
  let reads = 0;
  let applies = 0;
  const handle = {
    async queryPermission() { return denied ? 'prompt' : 'granted'; },
    async getFile() {
      reads++;
      return new File([bytes], 'book.txt', { lastModified: modified });
    }
  };
  const deps = {
    profileId: 'profile', deviceId: 'local',
    async loadState() { return clone(state); },
    async saveState(next, revision) {
      assert.equal(state?.revision || 0, revision);
      state = clone(next);
    },
    async readSnapshot() { return clone(local); },
    async getSource() { return source || { kind: 'file', handle, size: 1, lastModified: 1 }; },
    prepareIdentity: prepareSourceIdentity,
    async fingerprint(prepared) {
      hashes++;
      if (failedHash) throw new Error('文件读取中断');
      return fingerprintSource(prepared);
    },
    async applySnapshot(expected, next) {
      assert.equal(localSnapshotSignature(local), localSnapshotSignature(expected));
      applies++;
      local = clone(next);
    }
  };
  let engine = createSyncEngine(deps);
  return {
    get engine() { return engine; },
    get state() { return clone(state); },
    set state(next) { state = clone(next); },
    get local() { return local; },
    get hashes() { return hashes; },
    get reads() { return reads; },
    get applies() { return applies; },
    set denied(next) { denied = next; },
    set failedHash(next) { failedHash = next; },
    change(next, timestamp = modified + 1) { bytes = next; modified = timestamp; },
    restart() { engine = createSyncEngine(deps); }
  };
}

function remote(records = []) {
  let document = { schemaVersion: 1, records: clone(records) };
  let revision = 1;
  return {
    async read() { return { document: clone(document), etag: `"${revision}"` }; },
    async write(next, etag) {
      assert.equal(etag, `"${revision}"`);
      revision++;
      document = clone(next);
    },
    get document() { return clone(document); }
  };
}

const remoteRecord = (kind, value, key = digest('book-one')) => ({
  kind, key, value, version: { counter: 100, deviceId: 'remote' }
});

test('句柄签名与摘要读取同一个 File 快照，不再打开可能已经被修改的句柄', async () => {
  let calls = 0;
  const source = {
    kind: 'file', size: 999, lastModified: 999,
    handle: {
      async getFile() {
        calls++;
        return new File([calls === 1 ? 'first' : 'second'], 'book.txt', { lastModified: calls });
      }
    }
  };
  const prepared = await prepareSourceIdentity(source);
  assert.equal(prepared.signature, 'handle:v1:5:1');
  assert.equal(await fingerprintSource(prepared.source), digest('first'));
  assert.equal(calls, 1);
});

test('不变的句柄签名跨重启复用指纹，修改时间或大小改变才重新哈希', async () => {
  const reader = client();
  await reader.engine.capture();
  const first = reader.state.document;
  reader.restart();
  await reader.engine.capture();
  assert.equal(reader.hashes, 1);
  assert.equal(reader.reads, 2);
  reader.change('book-one', 20);
  await reader.engine.capture();
  assert.equal(reader.hashes, 2);
  assert.deepEqual(reader.state.document, first, '只有修改时间改变而内容相同时不制造新版本');
  reader.change('longer-content', 20);
  await reader.engine.capture();
  assert.equal(reader.hashes, 3);
  assert.equal(reader.state.identities.local, digest('longer-content'));
  for (const record of first.records) {
    assert.deepEqual(reader.state.document.records.find(item => item.kind === record.kind && item.key === record.key), record);
  }
});

test('同大小文件原地改写后使用新内容身份，旧内容的同步记录保留', async () => {
  const reader = client();
  await reader.engine.capture();
  const first = reader.state.document;
  reader.change('book-two', 20);
  await reader.engine.capture();
  assert.equal(reader.state.identities.local, digest('book-two'));
  assert.equal(reader.hashes, 2);
  for (const old of first.records) {
    assert.deepEqual(reader.state.document.records.find(item => item.kind === old.kind && item.key === old.key), old);
    assert.deepEqual(reader.state.document.records.find(item => item.kind === old.kind && item.key === digest('book-two')).value, old.value);
  }
});

test('不可读的已缓存句柄不应用远端值，恢复后未编辑的旧进度不会覆盖远端新版本', async () => {
  const reader = client();
  await reader.engine.capture();
  reader.denied = true;
  const server = remote([
    remoteRecord('favorite', false),
    remoteRecord('progress', { index: 8, total: 10, ratio: 0.8 })
  ]);
  const stats = await reader.engine.sync(server);
  assert.equal(stats.matchedCount, 0);
  assert.equal(stats.unmatchedCount, 1);
  assert.equal(reader.local.books[0].favorite, true);
  assert.equal(reader.local.progress[0].index, 1);
  assert.equal(reader.applies, 0);
  reader.denied = false;
  reader.restart();
  await reader.engine.sync(server);
  assert.equal(reader.local.books[0].favorite, false);
  assert.equal(reader.local.progress[0].index, 8);
  assert.equal(server.document.records.find(item => item.kind === 'favorite').version.counter, 100);
  assert.equal(server.document.records.find(item => item.kind === 'progress').version.counter, 100);
  assert.equal(reader.hashes, 1);
});

test('不可读期间的显式取消与清空跨重启保留，恢复后发布到原内容身份', async () => {
  const reader = client();
  const server = remote();
  await reader.engine.sync(server);
  reader.denied = true;
  reader.local.books[0].favorite = false;
  reader.local.progress = [];
  await reader.engine.capture();
  reader.restart();
  reader.denied = false;
  await reader.engine.sync(server);
  assert.equal(server.document.records.find(item => item.kind === 'favorite').value, false);
  assert.equal(server.document.records.find(item => item.kind === 'progress').deleted, true);
  assert.equal(reader.local.books[0].favorite, false);
  assert.deepEqual(reader.local.progress, []);
});

test('旧缓存缺少句柄签名时重新核验一次，不把未编辑的旧位置当新编辑', async () => {
  const reader = client();
  await reader.engine.capture();
  reader.denied = true;
  const server = remote([remoteRecord('progress', { index: 8, total: 10, ratio: 0.8 })]);
  await reader.engine.sync(server);
  const legacy = reader.state;
  delete legacy.identitySignatures;
  reader.state = legacy;
  reader.denied = false;
  reader.restart();
  await reader.engine.sync(server);
  assert.equal(reader.hashes, 2);
  assert.equal(reader.local.progress[0].index, 8);
  assert.equal(server.document.records.find(item => item.kind === 'progress').version.counter, 100);
  await reader.engine.capture();
  assert.equal(reader.hashes, 2);
});

test('签名改变但重算摘要失败时暂不拿旧身份应用，重试后识别新内容', async () => {
  const reader = client();
  await reader.engine.capture();
  reader.change('book-two', 20);
  reader.failedHash = true;
  const server = remote([remoteRecord('favorite', false)]);
  const stats = await reader.engine.sync(server);
  assert.equal(stats.unmatchedCount, 1);
  assert.equal(reader.local.books[0].favorite, true);
  assert.equal(reader.applies, 0);
  reader.failedHash = false;
  await reader.engine.sync(server);
  assert.equal(reader.state.identities.local, digest('book-two'));
  assert.equal(reader.local.books[0].favorite, true);
  assert.equal(server.document.records.find(item => item.kind === 'favorite' && item.key === digest('book-one')).value, false);
  assert.equal(server.document.records.find(item => item.kind === 'favorite' && item.key === digest('book-two')).value, true);
});

test('不可变来源复用缓存，内容没有变化的同步不重写本地元数据', async () => {
  const reader = client({ kind: 'file', blob: new Blob(['book-one']) });
  const server = remote();
  await reader.engine.sync(server);
  reader.restart();
  await reader.engine.sync(server);
  assert.equal(reader.hashes, 1);
  assert.equal(reader.applies, 0);
});

test('原生普通失败后使用同一份备用句柄快照，外部改写使回退摘要缓存失效', async t => {
  const originalWindow = globalThis.window;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  let content = 'backup-one';
  let modified = 1;
  let nativeCalls = 0;
  let handleReads = 0;
  globalThis.window = { __TAURI__: { core: { async invoke() {
    nativeCalls++;
    throw new Error('NATIVE_COMMAND_FAILED 原生副本暂不可读');
  } } } };
  const reader = client({
    kind: 'file', nativePath: 'homura-native-sources/book/source.txt',
    handle: {
      async getFile() {
        handleReads++;
        return new File([content], 'backup.txt', { lastModified: modified });
      }
    }
  });
  await reader.engine.capture();
  assert.equal(reader.state.identities.local, digest('backup-one'));
  content = 'backup-two';
  modified++;
  await reader.engine.capture();
  assert.equal(reader.state.identities.local, digest('backup-two'));
  assert.equal(reader.hashes, 2);
  assert.equal(nativeCalls, 2, '仍然先尝试原生摘要');
  assert.equal(handleReads, 2, '每次签名检查只打开一次真实句柄');
  assert.ok(reader.state.document.records.some(record => record.key === digest('backup-one')));
});

test('备用句柄签名变化只触发原生重新核验，内容身份不变时不发布新版本', async t => {
  const originalWindow = globalThis.window;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  let readable = true;
  let modified = 1;
  let nativeCalls = 0;
  globalThis.window = { __TAURI__: { core: { async invoke() {
    nativeCalls++;
    return digest('native-copy');
  } } } };
  const reader = client({
    kind: 'file', nativePath: 'homura-native-sources/book/source.txt',
    handle: {
      async queryPermission() { return readable ? 'granted' : 'prompt'; },
      async getFile() { return new File(['backup'], 'backup.txt', { lastModified: modified }); }
    }
  });
  await reader.engine.capture();
  const original = reader.state.document;
  modified++;
  await reader.engine.capture();
  readable = false;
  assert.equal((await reader.engine.capture()).matchedCount, 1);
  await reader.engine.capture();
  assert.equal(nativeCalls, 3, '备用句柄不可读后以不可变来源缓存原生身份');
  readable = true;
  await reader.engine.capture();
  assert.equal(nativeCalls, 4, '备用句柄恢复时重新检查摘要');
  assert.equal(reader.state.identities.local, digest('native-copy'));
  assert.deepEqual(reader.state.document, original);
});
