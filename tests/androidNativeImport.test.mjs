import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 14; PJX110)' }
});

const calls = [];
let pickerResult = { files: [] };
let pickerError = null;
let inspectResult = { files: [] };
let inspectError = null;
let stageResult = null;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === 'plugin:android-archive|pickImportUris') {
          if (pickerError) throw pickerError;
          return pickerResult;
        }
        if (command === 'plugin:android-archive|inspectImportUris') {
          if (inspectError) throw inspectError;
          return inspectResult;
        }
        if (command === 'plugin:android-archive|stageImportUri') return stageResult;
        throw new Error(`未模拟原生命令：${command}`);
      }
    }
  }
};

const {
  pickNativeUriImportFiles,
  shouldFallbackNativeImport,
  stageNativeImportUri
} = await import('../src/services/nativeImport.js');

test('Android URI 选择器返回 MOBI/EPUB，并把 inspect 结果变成轻量文件', async () => {
  calls.length = 0;
  pickerResult = { files: [
    'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmanga%2Fbook.epub',
    'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmanga%2Fbook.mobi'
  ] };
  inspectResult = {
    files: [
      {
        uri: pickerResult.files[0],
        name: 'book.epub',
        size: 128,
        mime: 'application/epub+zip',
        modifiedMs: 10
      },
      {
        uri: pickerResult.files[1],
        name: 'book.mobi',
        size: 256,
        mime: 'application/x-mobipocket-ebook',
        modifiedMs: 20
      }
    ]
  };

  const files = await pickNativeUriImportFiles({ multiple: true });

  assert.equal(files.length, 2);
  assert.equal(files[0].nativePath, pickerResult.files[0]);
  assert.equal(files[0].name, 'book.epub');
  assert.equal(files[0].type, 'application/epub+zip');
  assert.equal(files[1].name, 'book.mobi');

  assert.equal(calls[0].command, 'plugin:android-archive|pickImportUris');
  assert.equal(calls[0].args.multiple, true);
  assert.equal(calls[1].command, 'plugin:android-archive|inspectImportUris');
  assert.deepEqual(calls[1].args.uris, pickerResult.files);
});

test('URI 暂存调用 Android 插件并保留书名参数', async () => {
  calls.length = 0;
  stageResult = {
    nativePath: 'homura-native-sources/book-1/source/book.epub',
    name: 'book.epub',
    size: 128,
    modifiedMs: 10
  };

  const staged = await stageNativeImportUri(
    'book-1',
    'content://downloads/42',
    'book.epub'
  );

  assert.equal(staged.nativePath, stageResult.nativePath);
  assert.equal(calls[0].command, 'plugin:android-archive|stageImportUri');
  assert.deepEqual(calls[0].args, {
    bookId: 'book-1',
    uri: 'content://downloads/42',
    name: 'book.epub'
  });
});

test('选择器取消返回空结果，不冒泡成导入失败', async () => {
  pickerError = new Error('NATIVE_CANCELLED: 用户取消选择');
  const files = await pickNativeUriImportFiles();
  assert.equal(files, null);
  pickerError = null;
});

test('普通复制失败允许回退，安全与超限错误不回退', () => {
  assert.equal(shouldFallbackNativeImport({
    code: 'NATIVE_COMMAND_FAILED',
    message: '复制失败'
  }), true);
  assert.equal(shouldFallbackNativeImport({
    code: 'NATIVE_SECURITY_LIMIT',
    message: '没有读取权限'
  }), false);
  assert.equal(shouldFallbackNativeImport({
    code: 'NATIVE_LIMIT_EXCEEDED',
    message: '超过 4GB'
  }), false);
});

test('inspect 的安全错误原样抛出，不静默变成空选择', async () => {
  pickerResult = { files: ['content://downloads/blocked'] };
  inspectError = new Error('NATIVE_SECURITY_LIMIT: 没有读取权限');
  await assert.rejects(
    pickNativeUriImportFiles(),
    error => error.code === 'NATIVE_SECURITY_LIMIT'
  );
  inspectError = null;
});
