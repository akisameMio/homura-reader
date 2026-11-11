import test from 'node:test';
import assert from 'node:assert/strict';

const { buildStorageSegments } = await import('../src/services/storageStats.ts');

const GB = 1024 ** 3;

test('磁盘三段按已用空间拆出本应用与其他应用', () => {
  const segments = buildStorageSegments({
    totalBytes: 512 * GB,
    freeBytes: 132 * GB,
    appBytes: 42 * GB
  });

  assert.equal(segments.totalBytes, 512 * GB);
  assert.equal(segments.freeBytes, 132 * GB);
  assert.equal(segments.appBytes, 42 * GB);
  assert.equal(segments.otherBytes, 338 * GB);
  assert.ok(Math.abs(segments.appRatio - 42 / 512) < 1e-9);
  assert.ok(Math.abs(segments.appRatio + segments.otherRatio + segments.freeRatio - 1) < 1e-9);
});

test('应用占用超过已用空间时按已用空间截断', () => {
  const segments = buildStorageSegments({
    totalBytes: 100,
    freeBytes: 60,
    appBytes: 90
  });

  assert.equal(segments.appBytes, 40);
  assert.equal(segments.otherBytes, 0);
  assert.equal(segments.freeBytes, 60);
});

test('剩余空间超过总量或为负数时不会产生负比例', () => {
  const segments = buildStorageSegments({
    totalBytes: 100,
    freeBytes: 140,
    appBytes: -10
  });

  assert.equal(segments.freeBytes, 100);
  assert.equal(segments.appBytes, 0);
  assert.equal(segments.otherBytes, 0);
  assert.equal(segments.appRatio, 0);
  assert.equal(segments.freeRatio, 1);
});

test('总量为 0 时所有比例归零', () => {
  const segments = buildStorageSegments({ totalBytes: 0, freeBytes: 0, appBytes: 0 });

  assert.equal(segments.appRatio, 0);
  assert.equal(segments.otherRatio, 0);
  assert.equal(segments.freeRatio, 0);
});
