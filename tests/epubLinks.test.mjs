import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolveEpubLink, findEpubLinkPage, epubLinkAtPoint } from '../src/services/epubLinks.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
const chapters = [{ sourcePath: 'OPS/Text/正文.xhtml' }, { sourcePath: 'OPS/Notes/注释.xhtml' }];

test('书内链接以源章解析相对路径、中文编码与同章锚点', () => {
  assert.deepEqual(resolveEpubLink('../Notes/%E6%B3%A8%E9%87%8A.xhtml#%E6%B3%A8%E4%B8%80', chapters[0], chapters), { chapterIndex: 1, fragment: '注一' });
  assert.deepEqual(resolveEpubLink('#ref', chapters[0], chapters), { chapterIndex: 0, fragment: 'ref' });
  assert.deepEqual(resolveEpubLink('../Text/正文.xhtml', chapters[1], chapters), { chapterIndex: 0, fragment: '' });
  assert.deepEqual(resolveEpubLink('#old', {}, [{}]), null);
  const old = {};
  assert.deepEqual(resolveEpubLink('#old', old, [old]), { chapterIndex: 0, fragment: 'old' });
});

test('书内链接拒绝外部协议、损坏编码和不存在的章节', () => {
  for (const href of ['javascript:alert(1)', 'file:///etc/passwd', 'https://example.com', '//example.com/path', 'missing.xhtml#note', '#%ZZ', '\\evil.xhtml']) {
    assert.equal(resolveEpubLink(href, chapters[0], chapters), null, href);
  }
});

test('锚点只在目标章节匹配，特殊字符不作为 CSS 选择器执行', () => {
  const pages = [
    { chapterIndex: 0, html: '<p id="note:1">正文</p>' },
    { chapterIndex: 1, html: '<p>注释开头</p>' },
    { chapterIndex: 1, html: '<p id="note:1">目标脚注</p>' }
  ];
  assert.equal(findEpubLinkPage(pages, 1, 'note:1'), 2);
  assert.equal(findEpubLinkPage(pages, 1, ''), 1);
  assert.equal(findEpubLinkPage(pages, 1, 'missing'), -1);
});

test('透明手势层只命中链接实际行框，行间空隙不跳转', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div class="epub-content"><a href="#note">跨行脚注</a></div>';
  const link = root.querySelector('a');
  link.getClientRects = () => [{ left: 10, right: 90, top: 10, bottom: 25 }, { left: 10, right: 50, top: 35, bottom: 50 }];
  assert.equal(epubLinkAtPoint(root, 20, 15), link);
  assert.equal(epubLinkAtPoint(root, 20, 30), null);
  assert.equal(epubLinkAtPoint(root, 60, 40), null);
});
