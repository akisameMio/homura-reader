import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldFallbackNativeArchive } from '../src/services/nativeArchive.js';
import { nativeFilePath } from '../src/services/nativeStorage.js';

test('原生归档兜底白名单不包含安全限制和超限错误', () => {
  assert.equal(
    shouldFallbackNativeArchive({ code: 'NATIVE_COMMAND_FAILED', message: '普通失败' }),
    true
  );
  assert.equal(
    shouldFallbackNativeArchive({ code: 'NATIVE_INVALID_DATA', message: '损坏' }),
    true
  );
  assert.equal(
    shouldFallbackNativeArchive({ code: 'NATIVE_SECURITY_LIMIT', message: '越界' }),
    false
  );
  assert.equal(
    shouldFallbackNativeArchive({ code: 'NATIVE_LIMIT_EXCEEDED', message: '超限' }),
    false
  );
});

test('原生存档路径不会保留 . 或 .. 目录段', () => {
  assert.equal(nativeFilePath('..', 'source/book.epub'), 'homura-native-sources/source/source/book.epub');
  assert.equal(nativeFilePath('book-1', '../source/book.epub'), 'homura-native-sources/book-1/source/source/book.epub');
});
