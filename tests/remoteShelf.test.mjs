import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?url')) return { url: 'data:text/javascript,export default "fake-worker.mjs"', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { makeRemoteBookSource, normalizeRemoteBookSource, remoteBookId, setRemoteBookCredentialsProvider, resolveRemoteBookConfig, resetRemoteBookRuntime } = await import('../src/services/remoteBookSource.ts');
const { persistBook, restoreLibrary, hydrateBook } = await import('../src/services/restore.ts');
const { HomuraStore } = await import('../src/services/storage.ts');
const { createPinia, setActivePinia } = await import('pinia');
const { useShelfStore } = await import('../src/stores/shelf.ts');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.window; });
const config = { url: 'https://example.com/books/', username: 'reader', password: 'session-only' };
const entry = { href: config.url + 'book.txt', name: 'book.txt', size: 42, directory: false, etag: null };
function stub(t, values) {
  for (const [key, value] of Object.entries(values)) { const original = HomuraStore[key]; HomuraStore[key] = value; t.after(() => { HomuraStore[key] = original; }); }
}

test('云端来源只保存引用，过滤密码、原文件和本机路径；身份与临时在线阅读保持一致', async () => {
  const source = makeRemoteBookSource(config, entry);
  assert.equal(source.kind, 'webdav');
  assert.equal(JSON.stringify(source).includes(config.password), false);
  const clean = normalizeRemoteBookSource({ ...source, password: 'not-saved', blob: new Blob(['book']), nativePath: '/secret/local', opfsPath: 'local' });
  assert.deepEqual(clean, source);
  assert.equal(await remoteBookId(clean), await remoteBookId(source));
  assert.notEqual(await remoteBookId({ ...source, username: 'another' }), await remoteBookId(source));
  assert.throws(() => normalizeRemoteBookSource({ ...source, href: 'https://other.example/book.txt' }));
});

test('云端书入架只提交元数据与引用，不调用原生或 OPFS 原文件写入', async t => {
  globalThis.window = { __TAURI__: { core: { invoke() { throw new Error('不应写原文件'); } } } };
  const source = makeRemoteBookSource(config, entry);
  let written;
  stub(t, { requestPersistence: async () => null, saveBook: async (meta, reference) => { written = structuredClone({ meta, reference }); } });
  const book = { id: await remoteBookId(source), title: '云端小说', type: 'novel', format: 'txt', remote: true, coverBlob: null };
  await persistBook(book, { ...source, password: config.password, blob: new Blob(['must-not-save']) }, { coverThumb: null });
  assert.equal(written.meta.remote, true);
  assert.deepEqual(written.reference, { id: book.id, ...source });
  assert.equal(JSON.stringify(written).includes(config.password), false);
});

test('从不携带云端字段的 SQLite 镜像恢复书架，仍依据 IndexedDB 来源显示云端', async t => {
  const source = makeRemoteBookSource(config, entry);
  const id = await remoteBookId(source);
  stub(t, { listBooks: async () => [{ id, title: 'cloud', favorite: true }, { id: 'local', title: 'local' }], getSource: async key => key === id ? source : null });
  const shelf = await restoreLibrary();
  assert.equal(shelf.find(book => book.id === id).remote, true);
  assert.equal(shelf.find(book => book.id === id).remoteShelf, true);
  assert.equal(shelf.find(book => book.id === id).restored, true);
  assert.equal(shelf.find(book => book.id === 'local').remote, undefined);
});

test('重开云端书使用当前会话密码，并在关闭后恢复为可重新连接状态', async t => {
  const source = makeRemoteBookSource(config, entry);
  const id = await remoteBookId(source);
  const bytes = new TextEncoder().encode('第一章\n远端正文，不写入原文件。');
  setRemoteBookCredentialsProvider(() => config);
  stub(t, { getSource: async () => source });
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init);
    const range = init.headers.Range.match(/bytes=(\d+)-(\d+)/);
    const start = Number(range[1]), end = Number(range[2]);
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"v1"' } });
  };
  const book = { id, title: '云端书', remote: true, remoteShelf: true, restored: true, favorite: true };
  assert.equal(await hydrateBook(book), true);
  assert.equal(book.favorite, true);
  assert.ok(book.chapters.length > 0);
  assert.equal(book.restored, false);
  book.remoteDispose();
  assert.equal(book.restored, true);
  assert.equal(book.chapters, null);
  assert.equal(await hydrateBook(book), true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.headers.Authorization === `Basic ${Buffer.from('reader:session-only').toString('base64')}`));
  book.remoteDispose();
});

test('更换服务器后不会把旧书的凭据发给新连接；失效会话错误保留可操作提示', async () => {
  const source = makeRemoteBookSource(config, entry);
  setRemoteBookCredentialsProvider(() => ({ ...config, url: 'https://other.example/' }));
  await assert.rejects(resolveRemoteBookConfig(source), /连接此云端书籍的服务器/);
  setRemoteBookCredentialsProvider(() => { throw new Error('请在 WebDAV 设置中重新填写并保存本次会话密码'); });
  await assert.rejects(resolveRemoteBookConfig(source), /会话密码/);
});

test('并发重复添加云端书只写一次，取消排队的添加不写入', async t => {
  setActivePinia(createPinia());
  const shelf = useShelfStore();
  const source = makeRemoteBookSource(config, entry);
  const id = await remoteBookId(source);
  let writes = 0;
  stub(t, { requestPersistence: async () => null, saveBook: async () => { writes++; } });
  const book = { id, title: 'cloud', remote: true, remoteShelf: true, restored: true };
  await Promise.all([shelf.addRemoteBook({ ...book }, source), shelf.addRemoteBook({ ...book }, source)]);
  assert.equal(writes, 1);
  assert.equal(shelf.library.length, 1);
  const another = { ...source, href: source.root + 'other.txt' };
  await shelf.addRemoteBook({ ...book, id: await remoteBookId(another) }, another, () => false);
  assert.equal(writes, 1);
  const runtime = { ...book, pageItems: [{}], chapters: [{}], zipContent: {}, resourceUrls: [] };
  resetRemoteBookRuntime(runtime);
  assert.equal(runtime.pageItems, null);
  assert.equal(runtime.restored, true);
});
