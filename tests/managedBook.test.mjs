import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readArchiveBlobByPath } from '../src/services/archiveAccess.ts';
import { applyManagedNovel, buildManagedNovel, makeManagedNovelSource } from '../src/services/managedBook.ts';

const fingerprint = `sha256:${'a'.repeat(64)}`;

test('可重排 EPUB 自有存档恢复章节路径、脚注引用和内嵌图像', async () => {
  const dom = new JSDOM();
  const previousParser = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser;
  try {
    const imagePath = 'OEBPS/img/page.png';
    const sourceImage = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const book = {
      id: 'import',
      type: 'epub',
      format: 'epub',
      chapters: [
        {
          title: '第一章',
          sourcePath: 'OEBPS/main.xhtml',
          htmlContent: `<p><a href="notes.xhtml#one">脚注</a></p><img data-zip-path="${imagePath}"><img data-zip-path="${imagePath}">`
        },
        { title: '注释', sourcePath: 'OEBPS/notes.xhtml', htmlContent: '<p id="one">注释正文</p>' }
      ],
      zipContent: { file: path => path === imagePath ? { async: async () => sourceImage } : null }
    };
    const archive = await buildManagedNovel(book, fingerprint);
    assert.equal(archive.assets.length, 1);
    const stored = makeManagedNovelSource({ name: 'fixture.epub', nativePath: 'original' }, archive);
    assert.equal(stored.nativePath, undefined);
    const reopened = { id: 'new', restored: true };
    applyManagedNovel(reopened, structuredClone(stored.managedArchive));
    assert.equal(reopened.restored, false);
    assert.equal(reopened.type, 'epub');
    assert.equal(reopened.chapters[0].sourcePath, 'OEBPS/main.xhtml');
    assert.match(reopened.chapters[0].htmlContent, /notes\.xhtml#one/);
    assert.match(reopened.chapters[0].htmlContent, /data-zip-path="assets\/0"/);
    assert.equal(reopened.chapters[1].htmlContent, '<p id="one">注释正文</p>');
    assert.deepEqual([...new Uint8Array(await (await readArchiveBlobByPath(reopened, 'assets/0')).arrayBuffer())], [1, 2, 3]);
    assert.equal(await buildManagedNovel({ ...book, epubFixedLayout: true }, fingerprint), null);
  } finally {
    globalThis.DOMParser = previousParser;
    dom.window.close();
  }
});
