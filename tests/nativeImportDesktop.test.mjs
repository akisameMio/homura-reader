import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36' }
});

const calls = [];

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === 'plugin:dialog|open') return ['/tmp/books/book.epub'];
        throw new Error(`未模拟原生命令：${command}`);
      }
    }
  }
};

const {
  canUseNativeImport,
  isAndroidContentUri,
  pickNativeImportPaths
} = await import('../src/services/nativeImport.ts');

test('桌面保持 dialog open 路径并携带原有格式过滤器', async () => {
  assert.equal(canUseNativeImport(), true);
  assert.equal(isAndroidContentUri('content://downloads/42'), false);

  const paths = await pickNativeImportPaths({ directory: false, multiple: true });

  assert.deepEqual(paths, ['/tmp/books/book.epub']);
  assert.equal(calls[0].command, 'plugin:dialog|open');
  assert.equal(calls[0].args.options.directory, false);
  assert.equal(calls[0].args.options.multiple, true);
  const extensions = calls[0].args.options.filters[0].extensions;
  assert.ok(extensions.includes('epub'));
  assert.ok(extensions.includes('mobi'));
  assert.equal(
    calls.some(call => call.command === 'plugin:android-archive|pickImportUris'),
    false
  );
});
