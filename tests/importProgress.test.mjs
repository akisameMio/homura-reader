import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import {
  estimateImportEtaSeconds,
  formatEta,
  formatImportBytes,
  importFailureReason,
  importPercent,
  importPhaseLabel,
  useImportProgressStore
} from '../src/stores/importProgress.js';

function createStore() {
  setActivePinia(createPinia());
  return useImportProgressStore();
}

test('导入进度 begin / task / finish 维护任务数与字节数', () => {
  const store = createStore();
  const first = {};
  const second = {};

  store.begin({ total: 2, bytesTotal: 2048, targetLabel: '全部作品' });
  assert.equal(store.status, 'running');
  assert.equal(store.expanded, true);

  store.taskStarted(first, '第一卷.epub');
  store.taskSettled(first, 1024);
  assert.equal(store.done, 1);
  assert.equal(store.bytesDone, 1024);
  assert.equal(store.currentName, '第一卷.epub');

  store.taskStarted(second, '第二卷.epub');
  store.addSaved(1);
  store.taskSettled(second, 1024);
  store.addSaved(1);
  store.finish();

  assert.equal(store.done, 2);
  assert.equal(store.saved, 2);
  assert.equal(store.percent, 100);
  assert.equal(store.status, 'done');
  assert.ok(store.finishedAt > 0);
});

test('running 阶段百分比封顶 99，finish 后才到 100', () => {
  assert.equal(importPercent({ status: 'running', total: 40, done: 39 }), 97);
  assert.equal(importPercent({ status: 'running', total: 40, done: 40 }), 99);
  assert.equal(importPercent({ status: 'done', total: 40, done: 40 }), 100);
  assert.equal(importPercent({ status: 'cancelled', total: 40, done: 40 }), 100);
  assert.equal(importPercent({ status: 'cancelled', total: 40, done: 20 }), 50);
});

test('ETA 按整批吞吐估算，自动折算并发，done 小于 2 时不显示', () => {
  assert.equal(estimateImportEtaSeconds({ total: 20, done: 1, elapsedMs: 1000 }), null);
  assert.equal(estimateImportEtaSeconds({ total: 20, done: 5, elapsedMs: 5000 }), 15);
  assert.equal(estimateImportEtaSeconds({ total: 20, done: 5, elapsedMs: 0 }), null);
  assert.equal(formatEta(15), '约 15 秒');
  assert.equal(formatEta(125), '约 2 分 5 秒');
  assert.equal(formatImportBytes(90_596_966), '86.4 MB');
});

test('取消门闩只标记请求，finish 落为 cancelled', () => {
  const store = createStore();
  store.begin({ total: 4 });
  store.taskStarted({}, 'a.epub');
  store.taskSettled({}, 10);
  store.requestCancel();

  assert.equal(store.cancelRequested, true);
  assert.equal(store.status, 'running');
  assert.equal(store.percent, 25);

  store.finish();
  assert.equal(store.status, 'cancelled');
  assert.equal(store.saved, 0);
  assert.equal(store.done, 1);
});

test('失败记录汇总原因并收集整组重试文件', () => {
  const store = createStore();
  const pageOne = { name: '01.jpg' };
  const pageTwo = { name: '02.jpg' };
  store.begin({ total: 5 });
  store.recordFailure({
    name: '图片目录',
    reason: '目录内有损坏图片',
    kind: 'images',
    files: [pageOne, pageTwo]
  });

  assert.equal(store.failed, 1);
  assert.equal(store.failures[0].reason, '目录内有损坏图片');
  assert.deepEqual(store.retryFiles, [pageOne, pageTwo]);
  assert.equal(store.canRetry, true);
});

test('phase 文案覆盖读取、解析、封面、保存与确认', () => {
  assert.equal(importPhaseLabel('read'), '读取');
  assert.equal(importPhaseLabel('parse'), '解析');
  assert.equal(importPhaseLabel('cover'), '生成封面');
  assert.equal(importPhaseLabel('save'), '保存');
  assert.equal(importPhaseLabel('confirm'), '等待确认');
  assert.equal(importPhaseLabel('unknown'), '读取');
});

test('失败原因把常见压缩包错误转成中文短句', () => {
  assert.equal(
    importFailureReason(new Error("Can't find end of central directory : is this a zip file ?")),
    '文件不是有效的 EPUB 压缩包'
  );
  assert.equal(importFailureReason({ code: 'NATIVE_SECURITY_LIMIT' }), '文件触发原生安全限制');
});

test('dismiss 只能在完成或取消后清空状态', () => {
  const store = createStore();
  store.begin({ total: 3 });
  store.dismiss();
  assert.equal(store.status, 'running');

  store.finish();
  store.dismiss();
  assert.equal(store.status, 'idle');
  assert.equal(store.total, 0);
  assert.equal(store.expanded, false);
  assert.equal(store.failures.length, 0);
});
