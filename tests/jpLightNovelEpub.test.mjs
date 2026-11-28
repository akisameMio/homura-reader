import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;

const { shouldReadEpubAsManga } = await import('../src/services/epubType.ts');
const { parseEpubFile } = await import('../src/services/epubParser.ts');
const { collectNovelBlocks, splitLongParagraph, buildActivePages } = await import('../src/services/pagination.ts');
const { parseMobiBuffer } = await import('../src/services/mobi.ts');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg7sAAAAASUVORK5CYII=',
  'base64'
);

const TINY_WEBP = Buffer.from('524946461a00000057454250565038200e0000003001009d012a0100010001000000', 'hex');

test('日轻 EPUB 含大量单页彩插/黑白插画且正文集中在少数大章节时，不会误判成漫画丢掉正文', () => {
  // 模拟角川/电击文库：18 个插图页 + 2 个超长正文页（正文页占比 2/20 = 10% <= 15%，但正文长达数万字）
  assert.equal(shouldReadEpubAsManga({
    chapterCount: 20,
    textChapterCount: 2,
    imageHeavyChapterCount: 18,
    imageCount: 18,
    totalTextLength: 48000,
    maxChapterTextLength: 26000
  }), false);
});

test('日轻 EPUB：带命名空间前缀的 OPF、../ 相对路径、大小写不一致插图与 XHTML 自闭合标签均不缺页缺图', async () => {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="item/standard.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);

  const illusCount = 12;
  const manifestItems = [
    '<opf:item id="cover-img" href="../images/cover.png" media-type="image/png" properties="cover-image"/>',
    '<opf:item id="ch1" href="../xhtml/p-text-1.xhtml" media-type="application/xhtml+xml"/>',
    '<opf:item id="ch2" href="../xhtml/p-text-2.xhtml" media-type="application/xhtml+xml"/>'
  ];
  const spineItems = [
    '<opf:itemref idref="ch1"/>',
    '<opf:itemref idref="ch2"/>'
  ];
  zip.file('images/cover.png', TINY_PNG);

  for (let i = 1; i <= illusCount; i++) {
    const id = `ill-${i}`;
    manifestItems.push(`<opf:item id="${id}-img" href="../images/i-${i}.png" media-type="image/png"/>`);
    manifestItems.push(`<opf:item id="${id}" href="../xhtml/p-i-${i}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<opf:itemref idref="${id}"/>`);
    zip.file(`images/i-${i}.png`, TINY_PNG);
    // 故意使用大小写不一致的路径（../Images/I-x.PNG）和 SVG <image xlink:href>
    zip.file(`xhtml/p-i-${i}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>插图 ${i}</title></head>
        <body><svg viewBox="0 0 800 1200"><image width="800" height="1200" xlink:href="../Images/I-${i}.PNG"/></svg></body>
      </html>`);
  }

  const longProse = '「これはテスト用のライトノベル本文です。」'.repeat(120);
  // 故意包含日轻常见 XHTML 自闭合锚点与空 div：<a id="p-001"/>、<div class="spacer"/>
  zip.file('xhtml/p-text-1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>第一章</title></head>
      <body>
        <a id="p-001"/><div class="spacer"/>
        <h1>第一章 始まり</h1>
        <p>${longProse}</p>
      </body>
    </html>`);
  zip.file('xhtml/p-text-2.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>第二章</title></head>
      <body><h1>第二章 続き</h1><p>${longProse}</p></body>
    </html>`);

  zip.file('item/standard.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
      <opf:metadata><dc:title>テスト軽小説</dc:title></opf:metadata>
      <opf:manifest>${manifestItems.join('')}</opf:manifest>
      <opf:spine>${spineItems.join('')}</opf:spine>
    </opf:package>`);

  const blob = await zip.generateAsync({ type: 'blob' });
  const book = await parseEpubFile(blob, { name: 'ln.epub' });

  assert.equal(book.type, 'epub', '大量插画的日轻仍应识别为小说而非纯图漫画');
  assert.equal(book.chapters.length, 2 + illusCount, '所有 ../ 相对路径正文与插图章节都应保留');
  assert.ok(book.chapters[0].htmlContent.includes('第一章 始まり'), '自闭合 <a/> / <div/> 不应吞掉后续正文');
  assert.ok(!/<a[^>]*>(?:(?!<\/a>)[\s\S])*第一章/.test(book.chapters[0].htmlContent), '自闭合 <a id="p-001"/> 不应包裹后续章节标题');
  // 大小写不一致的 SVG 插图路径也必须成功绑定 data-zip-path
  for (let i = 0; i < illusCount; i++) {
    const ch = book.chapters[2 + i];
    assert.ok(ch.htmlContent.includes(`data-zip-path="images/i-${i + 1}.png"`), `第 ${i + 1} 张大小写不一致插图不应丢失`);
  }
  if (book.cover?.startsWith('blob:')) URL.revokeObjectURL(book.cover);
});

test('collectNovelBlocks 展开含直属文本与块级子元素混排的 div，避免整章被裁成一页', () => {
  const html = '<div class="main">开场旁白<p>第一段正文</p><p>第二段正文</p></div>';
  const blocks = collectNovelBlocks(html);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].text, '开场旁白');
  assert.equal(blocks[1].text, '第一段正文');
  assert.equal(blocks[2].text, '第二段正文');
});

test('splitLongParagraph 支持拆分超长 div 且不把日文 <ruby> 振假名从中间劈断', () => {
  const measurer = document.createElement('div');
  Object.defineProperty(measurer, 'scrollHeight', {
    get() {
      return this.textContent.length * 10;
    }
  });
  const html = `<div>${'<ruby>漢字<rt>かんじ</rt></ruby>'.repeat(12)}</div>`;
  const parts = splitLongParagraph(html, measurer, 150);
  assert.ok(parts.length > 1, '超长 div 应拆成多页避免底部裁切缺页');
  for (const part of parts) {
    const box = document.createElement('div');
    box.innerHTML = part;
    for (const ruby of box.querySelectorAll('ruby')) {
      assert.equal(ruby.textContent, '漢字かんじ', '每个 <ruby> 振假名都应保持完整不跨页断裂');
    }
  }
});

test('标题内嵌插图的纯图章节不会在过滤标题时把插图误删', () => {
  const measurer = document.createElement('div');
  Object.defineProperty(measurer, 'scrollHeight', { value: 200 });
  const pages = buildActivePages(
    {
      id: 'b_ill',
      type: 'epub',
      format: 'epub',
      title: 'test',
      chapters: [{ title: '插图', htmlContent: '<h1><img src="blob:fake-1" alt="彩插"/></h1>' }]
    },
    { direction: 'ltr', spread: 1, fontSize: 18, verticalText: false },
    measurer
  );
  assert.equal(pages.length, 1);
  assert.ok(pages[0].html.includes('blob:fake-1'), '标题内的插图不应被过滤掉');
});

test('MOBI 轻小说支持 WebP 与 mediarecindex 插图，且多图时不会误判漫画丢掉正文', () => {
  const prose = '这是一段很长的轻小说正文内容。'.repeat(120);
  const imgs = Array.from({ length: 8 }, (_, i) => `<img mediarecindex="${i + 1}"/>`).join('<mbp:pagebreak/>');
  const html = `<p>${prose}</p><mbp:pagebreak/>${imgs}`;
  const body = Buffer.from(html);
  const header = Buffer.alloc(248);
  header.writeUInt16BE(1, 0);
  header.writeUInt32BE(body.length, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(Math.max(4096, body.length), 10);
  header.write('MOBI', 16);
  header.writeUInt32BE(232, 20);
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(2, 108);
  const records = [header, body, ...Array.from({ length: 8 }, () => TINY_WEBP)];
  const pdb = Buffer.alloc(78 + records.length * 8 + 2);
  pdb.writeUInt16BE(records.length, 76);
  let offset = pdb.length;
  records.forEach((rec, i) => {
    pdb.writeUInt32BE(offset, 78 + i * 8);
    offset += rec.length;
  });
  const parsed = parseMobiBuffer(new Uint8Array(Buffer.concat([pdb, ...records])));
  assert.equal(parsed.type, 'novel', '有大段正文的 MOBI 不应误判为漫画');
  assert.ok(parsed.resourceUrls.length === 8, `8 张 WebP mediarecindex 插图应全部保留，实际 ${parsed.resourceUrls.length}`);
  for (const url of parsed.resourceUrls) URL.revokeObjectURL(url);
});
