import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.document = dom.window.document;

const { sanitizeEpubHtml } = await import('../src/services/sanitize.ts');
const { applyManagedNovel } = await import('../src/services/managedBook.ts');
const { assertValidNativeSourcePath } = await import('../src/services/nativeStorage.ts');
const { openGitHubUrl, openReadingUrl } = await import('../src/services/external.ts');
const { redactSensitiveText } = await import('../src/services/runtimeLogs.ts');
const { parseReleaseNotes } = await import('../src/services/updates.ts');

test('SVG url() 换行绕过与外部 marker 引用会被拦截，内部 #id 引用保留', () => {
  const bypassed = sanitizeEpubHtml('<svg><rect fill="url(\nhttps://evil.example/leak.svg#a)" marker-end="url(https://evil.example/m#b)"/></svg>');
  assert.ok(!/evil\.example/i.test(bypassed), `不应残留外部 SVG url：${bypassed}`);
  const safe = sanitizeEpubHtml('<svg><defs><linearGradient id="g1"></linearGradient></defs><rect fill="url(#g1)"/></svg>');
  assert.ok(safe.includes('fill="url(#g1)"'), `内部渐变引用应保留：${safe}`);
});

test('伪造的 data-zip-path 路径穿越与保留应用 DOM ID 会被清除', () => {
  const out = sanitizeEpubHtml('<div id="homura-splash"><span id="novelPaginationMeasurer">x</span></div><img data-zip-path="../../etc/passwd"><img data-zip-path="images/01.jpg">');
  assert.ok(!out.includes('homura-splash'));
  assert.ok(!out.includes('novelPaginationMeasurer'));
  assert.ok(!out.includes('../../etc/passwd'));
  assert.ok(out.includes('data-zip-path="images/01.jpg"'));
});

test('HTML 命名空间下的 <title> 与 <desc> 不会残留为 mXSS 载体，SVG 内保留', () => {
  const htmlTitle = sanitizeEpubHtml('<title><img src=x onerror=alert(1)></title><p>ok</p>');
  assert.ok(!/<title/i.test(htmlTitle));
  assert.ok(!/onerror/i.test(htmlTitle));
  assert.ok(htmlTitle.includes('<p>ok</p>'));
});

test('applyManagedNovel 对 text 章节进行转义并对 html 章节重新净化', () => {
  const book = { id: 'b1', title: 't', type: 'novel', format: 'txt', pageCount: 0 };
  applyManagedNovel(book, {
    kind: 'homura-managed-novel',
    schemaVersion: 1,
    serializerVersion: 1,
    format: 'txt',
    sourceFingerprint: 'sha256:' + 'a'.repeat(64),
    title: 't',
    chapters: [
      { title: 'c1', contentKind: 'text', content: '<script>alert(1)</script>纯文本' },
      { title: 'c2', contentKind: 'html', content: '<p onclick="alert(1)">正文</p><script>bad()</script>' }
    ],
    assets: [],
    bytes: 128,
    createdAt: Date.now()
  });
  assert.ok(book.chapters[0].htmlContent.includes('&lt;script&gt;'));
  assert.ok(!book.chapters[1].htmlContent.includes('onclick'));
  assert.ok(!book.chapters[1].htmlContent.includes('<script'));
});

test('assertValidNativeSourcePath 拒绝跳出 homura-native-sources 的路径穿越', () => {
  assert.equal(
    assertValidNativeSourcePath('homura-native-sources/book_1/source/a.pdf'),
    'homura-native-sources/book_1/source/a.pdf'
  );
  for (const bad of [
    'homura-metadata/homura.sqlite3',
    'homura-native-sources/../homura-metadata/homura.sqlite3',
    'homura-native-sources/book\\a.pdf',
    'homura-native-sources/./a.pdf',
    '/etc/passwd'
  ]) {
    assert.throws(() => assertValidNativeSourcePath(bad), /越界|非法/);
  }
});

test('Tauri fs:scope 明确拒绝前端直接读写 SQLite 元数据目录', () => {
  const cap = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  const scopeDeny = cap.permissions.find(item => typeof item === 'object' && item?.identifier === 'fs:scope');
  assert.ok(scopeDeny?.deny?.includes('$APPDATA/homura-metadata'));
  assert.ok(scopeDeny?.deny?.includes('$APPDATA/homura-metadata/**'));
});

test('external.ts 拒绝带内嵌凭据、控制字符或非标准端口的外链', async () => {
  await assert.rejects(openGitHubUrl('https://evil:pass@github.com/Leon-Ning-san/HomuraReader'), /拒绝/);
  await assert.rejects(openGitHubUrl('https://github.com:8443/Leon-Ning-san/HomuraReader'), /拒绝/);
  await assert.rejects(openReadingUrl('https://user:secret@example.com/book'), /内嵌凭据/);
  await assert.rejects(openReadingUrl('https://example.com/\r\nSet-Cookie:a=1'), /控制字符/);
});

test('运行日志自动脱敏认证头、URL 凭据与密码字段', () => {
  const raw = 'GET https://alice:s3cr3t@dav.example.com/file failed Authorization: Basic QWxpY2U6c2VjcmV0 {"password":"mypwd","token":"tok123"}';
  const cleaned = redactSensitiveText(raw);
  assert.ok(!cleaned.includes('s3cr3t'));
  assert.ok(!cleaned.includes('QWxpY2U6c2VjcmV0'));
  assert.ok(!cleaned.includes('mypwd'));
  assert.ok(!cleaned.includes('tok123'));
  assert.ok(cleaned.includes('[REDACTED]'));
});

test('parseReleaseNotes 会彻底清除嵌套构造的 HTML 标签，不残留尖括号', () => {
  const notes = parseReleaseNotes('## 更新日志\n### 修复\n- 清除 <<script>script>alert(1)<</script>/script> 文本');
  const item = notes.groups[0]?.items[0] || '';
  assert.ok(!item.includes('<') && !item.includes('>'), `不应残留尖括号：${item}`);
  assert.ok(!/<script/i.test(item));
});
