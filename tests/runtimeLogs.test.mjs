import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('运行日志按等级捕获、截断消息、限制条数并持久化', async () => {
  const dom = new JSDOM('', { url: 'http://localhost/' });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stopCapture = null;

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: dom.window.localStorage
    });

    const logs = await import('../src/services/runtimeLogs.ts');
    logs.clearRuntimeLogs();
    logs.configureRuntimeLogs({ capture: true, level: 'info' });

    logs.logRuntime('info', '应用启动', 'APP');
    logs.logRuntime('warning', '封面回退', 'console');
    logs.logRuntime('error', '元数据写入失败', 'console', 'Error: database is locked');
    assert.deepEqual(logs.getRuntimeLogs().map(entry => entry.level), ['info', 'warning', 'error']);
    assert.equal(logs.getRuntimeLogs()[2].detail, 'Error: database is locked');

    logs.configureRuntimeLogs({ level: 'error' });
    logs.logRuntime('info', '不会记录');
    logs.logRuntime('warning', '也不会记录');
    logs.logRuntime('error', '会记录');
    assert.equal(logs.getRuntimeLogs().at(-1).message, '会记录');
    assert.equal(logs.getRuntimeLogs().length, 4);

    logs.configureRuntimeLogs({ level: 'info' });
    stopCapture = logs.installRuntimeLogCapture();
    console.warn('捕获到的警告');
    console.error('捕获到的错误');
    assert.equal(logs.getRuntimeLogs().at(-1).level, 'error');
    assert.equal(logs.getRuntimeLogs().at(-2).level, 'warning');
    stopCapture();
    stopCapture = null;

    for (let index = 0; index < logs.RUNTIME_LOG_LIMIT + 5; index += 1) {
      logs.logRuntime('info', `条目 ${index}`);
    }
    assert.equal(logs.getRuntimeLogs().length, logs.RUNTIME_LOG_LIMIT);
    assert.equal(logs.getRuntimeLogs()[0].message, '条目 5');

    await new Promise(resolve => setTimeout(resolve, 300));
    const persisted = JSON.parse(globalThis.localStorage.getItem(logs.RUNTIME_LOG_STORAGE_KEY));
    assert.equal(persisted.length, logs.RUNTIME_LOG_LIMIT);

    logs.clearRuntimeLogs();
    assert.deepEqual(logs.getRuntimeLogs(), []);
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(logs.RUNTIME_LOG_STORAGE_KEY)), []);
  } finally {
    stopCapture?.();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    dom.window.close();
  }
});

test('日志搜索覆盖消息、来源与堆栈，导出文本保留时间与明细', async () => {
  const dom = new JSDOM('', { url: 'http://localhost/' });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window
    });
    const logs = await import('../src/services/runtimeLogs.ts');
    const exporter = await import('../src/services/runtimeLogExport.ts');
    const entry = {
      id: 'log-1',
      at: new Date(2026, 10, 15, 23, 49, 37).getTime(),
      level: 'error',
      message: '原生元数据写入失败：SQLITE_BUSY',
      source: 'console',
      detail: 'Error: database is locked'
    };

    assert.equal(logs.matchesRuntimeLogQuery(entry, ''), true);
    assert.equal(logs.matchesRuntimeLogQuery(entry, 'sqlite_busy'), true);
    assert.equal(logs.matchesRuntimeLogQuery(entry, 'console'), true);
    assert.equal(logs.matchesRuntimeLogQuery(entry, 'database is locked'), true);
    assert.equal(logs.matchesRuntimeLogQuery(entry, 'metadata'), false);

    const text = exporter.formatRuntimeLogEntries([entry]);
    assert.ok(text.includes('2026-11-15 23:49:37  [error]  APP · console'));
    assert.ok(text.includes('原生元数据写入失败：SQLITE_BUSY'));
    assert.ok(text.includes('  Error: database is locked'));
    assert.equal(
      exporter.runtimeLogExportFileName(new Date(2026, 10, 15, 23, 49, 37)),
      'homura-logs-20261115-234937.txt'
    );
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    dom.window.close();
  }
});
