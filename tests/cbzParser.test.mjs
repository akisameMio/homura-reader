import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

const { parseCbzFileLazy } = await import('../src/services/cbzParser.ts');

test('超过 4 GiB 的压缩包不回退到 JSZip 整包读取', async () => {
  let fallbackCalled = false;
  await assert.rejects(
    parseCbzFileLazy({ name: '大合集.cbz', size: 4 * 1024 ** 3 + 1 }, {
      loadFallbackFile: () => {
        fallbackCalled = true;
        return null;
      }
    }),
    /需要原生读取/
  );
  assert.equal(fallbackCalled, false);
});

async function makeCbz(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'blob' });
}

test('CBZ 回退 JSZip 时按自然序排列图片并过滤系统残留', async () => {
  const blob = await makeCbz({
    'chapter/10.png': 'page-10',
    'chapter/2.png': 'page-2',
    'chapter/1.png': 'page-1',
    'chapter/notes.txt': 'ignore',
    '__MACOSX/chapter/1.png': 'junk',
    'chapter/._1.png': 'junk'
  });
  const file = new File([blob], '示例漫画.cbz', { type: 'application/vnd.comicbook+zip' });

  const book = await parseCbzFileLazy(file);
  assert.equal(book.type, 'manga');
  assert.equal(book.format, 'cbz');
  assert.equal(book.title, '示例漫画');
  assert.equal(book.pageCount, 3);
  assert.deepEqual(book.pageItems.map(item => item.zipEntry.name), [
    'chapter/1.png',
    'chapter/2.png',
    'chapter/10.png'
  ]);
  assert.equal(book.cover, book.pageItems[0].url);
  assert.ok(book.cover.startsWith('blob:'));
});

test('没有图片的 ZIP 不会被当成漫画导入', async () => {
  const blob = await makeCbz({ 'readme.txt': 'no image' });
  const file = new File([blob], '空.zip', { type: 'application/zip' });
  assert.equal(await parseCbzFileLazy(file), null);
});
