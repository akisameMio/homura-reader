import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { WebDavBooksClient, parseDavDirectory, scopedDavUrl } from '../src/services/webdavBooks.ts';

const originalFetch = globalThis.fetch;
const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser;
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.window; });
const root = 'https://example.com/dav/';
const config = { url: root, username: '鱼', password: 'secret' };
const listing = entries => `<multistatus xmlns="DAV:">${entries.map(([href, type = '', status = '200 OK']) => `<response><href>${href}</href><propstat><status>HTTP/1.1 ${status}</status><prop><resourcetype>${type}</resourcetype><getcontentlength>123</getcontentlength></prop></propstat></response>`).join('')}</multistatus>`;

test('远程目录只列出直属子目录和支持的书籍，兼容命名空间、中文、空格与无 ETag', () => {
  const xml = listing([
    ['/dav/', '<collection/>'], ['/dav/%E4%B9%A6%20A.epub'], ['/dav/folder', '<collection/>'], ['/dav/a.exe'],
    ['/dav/nested/book.pdf'], ['https://evil.example/dav/book.pdf'], ['/outside/book.pdf'], ['/dav/forbidden.pdf', '', '403 Forbidden'],
    ['/dav/%2fescape.cbz'], ['/dav/.hidden.txt'], ['/dav/书%23名.md']
  ]);
  const entries = parseDavDirectory(xml, root, root);
  assert.deepEqual(entries.map(entry => [entry.name, entry.directory]), [['folder', true], ['书 A.epub', false], ['书#名.md', false]]);
  assert.equal(entries[0].href, root + 'folder/');
  assert.equal(entries[1].size, 123);
  assert.equal(entries[1].etag, null);
  assert.equal(parseDavDirectory(xml.replaceAll('multistatus', 'd:multistatus').replace('xmlns="DAV:"', 'xmlns="DAV:" xmlns:d="DAV:"'), root, root).length, 3);
});

test('目录拒绝外部实体、HTML、损坏 XML；路径拒绝跨域、越界与编码分隔符', () => {
  for (const xml of ['<html/>', '<multistatus xmlns="DAV:">', '<!DOCTYPE a><multistatus xmlns="DAV:"/>']) assert.throws(() => parseDavDirectory(xml, root, root));
  for (const href of ['https://evil.example/dav/a', '/dav2/a', '/dav/%2fsecret', '/dav/%5csecret', '/dav/%252e%252e/a', '/dav/a?q=1', '/dav/a#x']) assert.throws(() => scopedDavUrl(root, href));
  assert.equal(scopedDavUrl(root, '子目录/a%20b.epub'), root + '%E5%AD%90%E7%9B%AE%E5%BD%95/a%20b.epub');
});

test('目录仅发只读 PROPFIND，带 Depth 1；Range 读取锁定版本且不需要同步开关或强 ETag', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'PROPFIND') return new Response(listing([['/dav/book.cbz']]), { status: 207 });
    const match = options.headers.Range.match(/bytes=(\d+)-(\d+)/);
    const start = Number(match[1]), end = Number(match[2]);
    return new Response(new Uint8Array(end - start + 1).fill(42), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/1000`, ETag: '"v1"' } });
  };
  const client = new WebDavBooksClient(config);
  const [entry] = await client.list();
  const file = await client.open(entry);
  assert.equal(file.size, 1000);
  assert.deepEqual([...await file.read(20, 23)], [42, 42, 42]);
  assert.equal(calls[0].headers.Depth, '1');
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('鱼:secret').toString('base64')}`);
  assert.equal(calls[2].headers['If-Match'], '"v1"');
  assert.ok(calls.every(call => call.redirect === 'error' && call.credentials === 'omit'));
  assert.ok(calls.every(call => ['PROPFIND', 'GET'].includes(call.method)));
  client.close();
  await assert.rejects(file.read(30, 40), error => error.code === 'CANCELLED');
  assert.equal(calls.length, 3);
});

test('服务器忽略 Range 时立即取消响应，不接收整本；坏范围、版本变化与流式超限停止读取', async () => {
  const entry = { href: root + 'book.cbz', name: 'book.cbz', directory: false };
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(new WebDavBooksClient(config).open(entry), error => error.code === 'UNSUPPORTED');
  assert.equal(cancelled, true);
  for (const [status, range, bytes] of [[206, 'bytes 1-1/100', 1], [206, 'bytes 0-0/100', 2], [412, null, 0], [401, null, 0]]) {
    globalThis.fetch = async () => new Response(new Uint8Array(bytes), { status, headers: range ? { 'Content-Range': range } : {} });
    await assert.rejects(new WebDavBooksClient(config).open(entry));
  }
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); } }), { status: 207 });
  await assert.rejects(new WebDavBooksClient(config).list(), error => error.code === 'LIMIT_EXCEEDED');
});

test('原生 Range 通过有界命令读取，失败不回退浏览器；不向请求发送磁盘路径', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push({ command, args });
    return { status: 206, body: Buffer.from([1]).toString('base64'), contentRange: 'bytes 0-0/100', etag: null, lastModified: null };
  } } } };
  globalThis.fetch = async () => { throw new Error('不允许回退'); };
  const source = await new WebDavBooksClient(config).open({ href: root + 'book.pdf', directory: false });
  assert.equal(source.size, 100);
  assert.equal(calls[0].command, 'webdav_read');
  assert.equal(calls[0].args.range, 'bytes=0-0');
  assert.equal(calls[0].args.root, root);
  globalThis.window.__TAURI__.core.invoke = async () => { throw new Error('NATIVE_SECURITY_LIMIT: forbidden'); };
  await assert.rejects(source.read(1, 2), error => error.code === 'NETWORK');
});
