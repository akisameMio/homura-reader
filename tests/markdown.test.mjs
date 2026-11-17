import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown, splitMarkdownChapters } from '../src/services/markdown.ts';

const { window } = new JSDOM('');
globalThis.DOMParser = window.DOMParser;
const parse = (source) => new window.DOMParser().parseFromString(renderMarkdown(source), 'text/html');
const split = (source) => splitMarkdownChapters(source, '文件名');

test('普通单换行是软换行，空行才分段', () => {
  const doc = parse('第一行\n第二行\n\n第三行');
  assert.equal(doc.querySelectorAll('p').length, 2);
  assert.equal(doc.querySelectorAll('br').length, 0);
  assert.equal(doc.querySelector('p').textContent, '第一行\n第二行');
});

test('行尾双空格和反斜杠保留标准硬换行', () => {
  for (const separator of ['  \n', '\\\n']) {
    assert.equal(parse(`第一行${separator}第二行`).querySelectorAll('br').length, 1);
  }
});

test('强调、转义、代码、嵌套列表与引用沿用标准解析', () => {
  const doc = parse('**粗体** *斜体* \\*原样\\* `a < b`\n\n3. 第三项\n   - 子项\n\n> 引用\n>\n> 第二段');
  assert.equal(doc.querySelector('strong').textContent, '粗体');
  assert.equal(doc.querySelector('em').textContent, '斜体');
  assert.ok(doc.body.textContent.includes('*原样*'));
  assert.equal(doc.querySelector('code').textContent, 'a < b');
  assert.equal(doc.querySelector('ol').getAttribute('start'), '3');
  assert.equal(doc.querySelector('ol ul li').textContent, '子项');
  assert.equal(doc.querySelectorAll('blockquote p').length, 2);
});

test('继续支持 GFM 表格、删除线和只读任务列表', () => {
  const doc = parse('| 列 |\n| --- |\n| 值 |\n\n~~删除~~\n\n- [x] 完成\n- [ ] 待办');
  assert.equal(doc.querySelector('td').textContent, '值');
  assert.equal(doc.querySelector('del').textContent, '删除');
  const inputs = [...doc.querySelectorAll('input')];
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(input => input.disabled && input.type === 'checkbox'));
  assert.deepEqual(inputs.map(input => input.checked), [true, false]);
});

test('图片保留标题、纯文本 alt 和带空格的路径编码', () => {
  const doc = parse('![*插图* & 作者](<images/my picture.png> "图片标题")\n\n[链接](<docs/my file.md> "链接标题")');
  const image = doc.querySelector('img');
  assert.equal(image.getAttribute('alt'), '插图 & 作者');
  assert.equal(image.getAttribute('title'), '图片标题');
  assert.equal(image.getAttribute('src'), 'images/my%20picture.png');
  assert.equal(doc.querySelector('a').getAttribute('href'), 'docs/my%20file.md');
});

test('ATX 与 Setext 一级/二级标题统一切章，三级标题留在正文', () => {
  const chapters = split('前言\n\n   # **第一章** &amp; [链接](https://example.com)\n正文\n\n第二章\n---\n\n### 小节\n内容');
  assert.deepEqual(chapters.map(chapter => chapter.title), ['开始', '第一章 & 链接', '第二章']);
  assert.ok(chapters[2].htmlContent.includes('<h3>小节</h3>'));
  assert.ok(chapters[1].htmlContent.includes('<p>正文</p>'));
});

test('较短围栏与带尾随文本的围栏不提前结束代码块', () => {
  const chapters = split('# 正文\n\n````md\n```\n# 代码内标题\n```` trailing\n## 仍在代码里\n````\n\n## 下一章\n结束');
  assert.deepEqual(chapters.map(chapter => chapter.title), ['正文', '下一章']);
  assert.ok(chapters[0].htmlContent.includes('# 代码内标题'));
  assert.ok(chapters[0].htmlContent.includes('## 仍在代码里'));
});

test('缩进代码、列表和引用中的标题不会切成新章节', () => {
  const chapters = split('# 章节\n\n    # 缩进代码\n\n> # 引用标题\n\n- 列表\n\n  ## 列表内标题\n\n正文');
  assert.equal(chapters.length, 1);
  assert.ok(chapters[0].htmlContent.includes('<code># 缩进代码'));
  assert.ok(chapters[0].htmlContent.includes('<blockquote>'));
  assert.ok(chapters[0].htmlContent.includes('<h2>列表内标题</h2>'));
});

test('全文引用链接和图片定义在切章后仍有效', () => {
  const chapters = split('# 第一章\n\n[站点][site]\n\n## 第二章\n\n![封面][cover]\n\n[site]: https://example.com "站点标题"\n[cover]: cover.png "封面标题"');
  assert.equal(chapters.length, 2);
  assert.ok(chapters[0].htmlContent.includes('href="https://example.com" title="站点标题"'));
  assert.ok(chapters[1].htmlContent.includes('src="cover.png" alt="封面" title="封面标题"'));
});

test('连续标题、空标题、只有标题的文档与空文件不会丢章', () => {
  assert.deepEqual(split('# 第一章\n\n## 第二章').map(chapter => chapter.title), ['第一章', '第二章']);
  assert.equal(split('#')[0].title, '文件名');
  assert.equal(split('# 唯一标题')[0].title, '唯一标题');
  assert.deepEqual(split(' \n\n'), [{ title: '文件名', htmlContent: '<p>（空文件）</p>' }]);
});

test('引用式危险链接与图片、图片属性注入仍被阻止', () => {
  const chapters = split('# 第一章\n\n[危险][bad] ![危险][bad]\n\n## 第二章\n\n[bad]: javascript:alert(1)');
  assert.ok(!chapters[0].htmlContent.includes('javascript:'));
  const doc = parse('![alt](image.png "\\\" onerror=alert(1)")');
  assert.equal(doc.querySelector('[onerror]'), null);
});
