import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let sessionOpen = false;

Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 15; PJX110) AppleWebKit/537.36' },
  configurable: true
});

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        const name = command.split('|').pop();
        await new Promise(resolve => setTimeout(resolve, name === 'openDocument' ? 20 : 5));
        calls.push({ name, args });
        if (name === 'openDocument') sessionOpen = true;
        if (name === 'close') sessionOpen = false;
        if (name === 'openDocument') return { archiveId: args.archiveId, entries: [], images: [] };
        if (name === 'readTextBatch') {
          const paths = JSON.parse(args.pathsJson);
          return {
            texts: paths
              .filter(path => path === 'OEBPS/chapter.xhtml')
              .map(path => ({ path, text: '<p>正文</p>', size: 12 }))
          };
        }
        if (name === 'extract') {
          return { path: '/cache/page.jpg', mime: 'image/jpeg', size: 123 };
        }
        return null;
      }
    }
  }
};

const {
  ensureNativeArchiveSession,
  extractNativeEntry,
  isNativeArchiveSessionOpen,
  openNativeDocument,
  readNativeTextBatch,
  releaseNativeArchiveSession
} = await import('../src/services/nativeArchive.ts');

test('关闭阅读器后按保存的路径懒重开 ZipFile 会话', async () => {
  const book = {
    nativeArchiveId: 'book-reopen',
    nativeArchivePath: 'homura-native-sources/book-reopen/source/book.epub'
  };

  await openNativeDocument(book.nativeArchiveId, book.nativeArchivePath);
  assert.equal(isNativeArchiveSessionOpen(book.nativeArchiveId), true);

  await releaseNativeArchiveSession(book);
  assert.equal(isNativeArchiveSessionOpen(book.nativeArchiveId), false);

  assert.equal(await ensureNativeArchiveSession(book), true);
  assert.equal(isNativeArchiveSessionOpen(book.nativeArchiveId), true);
  assert.deepEqual(
    calls.filter(call => call.args.archiveId === book.nativeArchiveId).map(call => call.name),
    ['openDocument', 'close', 'openDocument']
  );
  const reopenCall = calls.filter(call => (
    call.name === 'openDocument' && call.args.archiveId === book.nativeArchiveId
  )).at(-1);
  assert.equal(reopenCall.args.scanDimensions, false);
  assert.equal(reopenCall.args.includeEntries, false);
});

test('快速切书时 close 与后续 openDocument 按压缩包串行执行', async () => {
  const book = {
    nativeArchiveId: 'book-race',
    nativeArchivePath: 'homura-native-sources/book-race/source/book.epub'
  };

  const initialOpen = openNativeDocument(book.nativeArchiveId, book.nativeArchivePath);
  const close = releaseNativeArchiveSession(book);
  const reopen = ensureNativeArchiveSession(book);
  await Promise.all([initialOpen, close, reopen]);

  assert.equal(sessionOpen, true);
  assert.deepEqual(
    calls.filter(call => call.args.archiveId === book.nativeArchiveId).map(call => call.name),
    ['openDocument', 'close', 'openDocument']
  );
});

test('原生文档会话支持批量取文本和按索引取图', async () => {
  const archiveId = 'document-1';
  const path = 'homura-native-sources/document-1/source/book.epub';

  const archive = await openNativeDocument(archiveId, path);
  assert.equal(archive.archiveId, archiveId);
  assert.equal(isNativeArchiveSessionOpen(archiveId), true);

  const texts = await readNativeTextBatch(archiveId, [
    'OEBPS/chapter.xhtml',
    'OEBPS/missing.xhtml'
  ]);
  assert.deepEqual(texts, [{
    path: 'OEBPS/chapter.xhtml',
    text: '<p>正文</p>',
    size: 12
  }]);

  const extracted = await extractNativeEntry(archiveId, 3);
  assert.deepEqual(extracted, { path: '/cache/page.jpg', mime: 'image/jpeg', size: 123 });
  await releaseNativeArchiveSession({ nativeArchiveId: archiveId, nativeArchivePath: path });
});
