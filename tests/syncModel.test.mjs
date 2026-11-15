import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSyncVersions, mergeSyncDocuments, validateSyncDocument } from '../src/services/syncModel.ts';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const document = (...records) => ({ schemaVersion: 1, records });
const record = (kind, value, counter = 1, deviceId = 'phone', extra = {}) => ({
  kind,
  key: kind === 'collection' ? 'collection_1' : fingerprint,
  version: { counter, deviceId },
  value,
  ...extra
});

test('逻辑版本不依赖时钟，回读较前位置也可以成为新进度', () => {
  const old = document(record('progress', { index: 90, total: 100, ratio: 0.9, updatedAt: 999_999 }));
  const reread = document(record('progress', { index: 10, total: 100, ratio: 0.1, updatedAt: 1 }, 2));
  assert.equal(mergeSyncDocuments(old, reread).records[0].value.index, 10);
  assert.equal(compareSyncVersions({ counter: 2, deviceId: 'a' }, { counter: 1, deviceId: 'z' }), 1);
});

test('并发收藏和书库修改确定性收敛，合并满足交换、结合与幂等', () => {
  const a = document(record('favorite', true, 2, 'a'), record('collection', { title: '小说', createdAt: 1 }, 1, 'a'));
  const b = document(record('favorite', false, 2, 'b'), record('membership', 'collection_1', 3, 'b'));
  const c = document(record('collection', { title: '我的小说', createdAt: 1 }, 3, 'c'));
  assert.deepEqual(mergeSyncDocuments(a, b), mergeSyncDocuments(b, a));
  assert.deepEqual(mergeSyncDocuments(mergeSyncDocuments(a, b), c), mergeSyncDocuments(a, mergeSyncDocuments(b, c)));
  assert.deepEqual(mergeSyncDocuments(a, a), validateSyncDocument(a));
  assert.equal(mergeSyncDocuments(a, b).records.find(item => item.kind === 'favorite').value, false);
});

test('墓碑阻止离线旧记录复活，同版本不同内容也能收敛', () => {
  const old = document(record('collection', { title: '旧书库', createdAt: 1 }));
  const deleted = document(record('collection', null, 2, 'phone', { deleted: true }));
  assert.deepEqual(mergeSyncDocuments(deleted, old), validateSyncDocument(deleted));
  const conflict = document(record('collection', { title: '并发写入', createdAt: 1 }, 2));
  assert.deepEqual(mergeSyncDocuments(deleted, conflict), mergeSyncDocuments(conflict, deleted));
  assert.equal(mergeSyncDocuments(deleted, conflict).records[0].deleted, true);
  const sameVersionA = document(record('favorite', true));
  const sameVersionB = document(record('favorite', false));
  assert.deepEqual(mergeSyncDocuments(sameVersionA, sameVersionB), mergeSyncDocuments(sameVersionB, sameVersionA));
});

test('远程文档拒绝路径、未知字段、非法数值、越界排版和重复记录', () => {
  const invalid = [
    { schemaVersion: 2, records: [] },
    { schemaVersion: 1, records: [], nativePath: '/private/file' },
    document(record('favorite', true, -1)),
    document(record('favorite', true, Number.MAX_SAFE_INTEGER)),
    document(record('favorite', 'yes')),
    document(record('progress', { index: 0, total: 5, ratio: Infinity })),
    document(record('progress', { index: 5, total: 5 })),
    document(record('progress', { ratio: 0.5, nativePath: '/tmp/book' })),
    document(record('progress', { ratio: 0.5, layout: { fontSize: 99 } })),
    document(record('progress', { ratio: 0.5, layout: { fontFamily: 'url(https://example.com)' } })),
    document(record('collection', { title: 'a'.repeat(81), createdAt: 0 })),
    document(record('membership', '../collection')),
    document(record('favorite', true, 1, '../device')),
    document(record('favorite', true, 1, 'phone', { key: 'local-book-id' })),
    document(record('favorite', true), record('favorite', false)),
    document(record('favorite', true, 1, 'phone', { deleted: true })),
    document(record('favorite', true, 1, 'phone', { version: { counter: 1, deviceId: 'phone', token: 'secret' } })),
    document(JSON.parse('{"kind":"favorite","key":"' + fingerprint + '","version":{"counter":1,"deviceId":"phone"},"value":true,"__proto__":{}}'))
  ];
  for (const value of invalid) assert.throws(() => validateSyncDocument(value), /同步数据格式无效/);
});

test('校验生成独立便携快照，不保留可变对象引用', () => {
  const input = document(record('progress', { ratio: 0.5, chapterIndex: 1, chapterRatio: 0.2, layout: { direction: 'rtl', fontSize: 18 } }));
  const output = validateSyncDocument(input);
  input.records[0].version.counter = 5;
  input.records[0].value.layout.fontSize = 28;
  assert.equal(output.records[0].version.counter, 1);
  assert.equal(output.records[0].value.layout.fontSize, 18);
});
