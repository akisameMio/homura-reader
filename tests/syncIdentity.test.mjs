import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fingerprintSource, prepareSourceIdentity } from '../src/services/syncIdentity.ts';

const digest = value => createHash('sha256').update(value).digest('hex');
afterEach(() => { delete globalThis.window; });

test('外部句柄失去权限时仍可用 IndexedDB Blob 副本识别同步内容', async () => {
  const prepared = await prepareSourceIdentity({
    kind: 'file',
    blob: new Blob(['private-backup']),
    handle: {
      async queryPermission() { return 'prompt'; },
      async getFile() { throw new Error('不应重新请求失效句柄'); }
    }
  });
  assert.equal(prepared.signature, null);
  assert.equal(prepared.source.handle, null);
  assert.equal(await fingerprintSource(prepared.source), `sha256:${digest('private-backup')}`);
});

test('文件指纹匹配 SHA256 标准向量和填充边界，同字节不同文件名保持身份', async () => {
  for (const size of [0, 3, 55, 56, 63, 64, 65, 127, 128, 1_000_000, 1024 * 1024 + 65]) {
    const bytes = size === 3 ? Buffer.from('abc') : Buffer.alloc(size, 97);
    const source = { kind: 'file', name: 'original.epub', blob: new Blob([bytes]) };
    const expected = `sha256:${digest(bytes)}`;
    assert.equal(await fingerprintSource(source), expected, `size ${size}`);
    if (size === 3) assert.equal(await fingerprintSource({ ...source, name: 'renamed.epub' }), expected);
  }
});

test('分块读取不会把整个大文件读进内存', async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 42);
  const blob = new Blob([bytes]);
  const slices = [];
  const source = {
    kind: 'file',
    blob: {
      size: blob.size,
      arrayBuffer() { throw new Error('禁止整本读取'); },
      slice(start, end) { slices.push([start, end]); return blob.slice(start, end); }
    }
  };
  assert.equal(await fingerprintSource(source), `sha256:${digest(bytes)}`);
  assert.equal(slices.length, 3);
  assert.ok(slices.every(([start, end]) => end - start <= 1024 * 1024));
});

test('文件夹使用稳定相对路径和字节摘要，去掉顶层名字并保留次级路径', async () => {
  const source = {
    kind: 'folder', name: '漫画',
    entries: [
      { path: '漫画/后篇/002.jpg', blob: new Blob(['second']) },
      { path: '漫画/001.jpg', blob: new Blob(['first']) }
    ]
  };
  const manifest = [['001.jpg', digest('first')], ['后篇/002.jpg', digest('second')]];
  const expected = `sha256:${digest(JSON.stringify(manifest))}`;
  assert.equal(await fingerprintSource(source), expected);
  assert.equal(await fingerprintSource({ ...source, name: 'renamed', entries: source.entries.slice().reverse().map(entry => ({ ...entry, path: entry.path.replace('漫画/', 'renamed/') })) }), expected);
  assert.notEqual(await fingerprintSource({ ...source, entries: source.entries.map(entry => ({ ...entry, blob: new Blob(['changed']) })) }), expected);
});

test('文件夹拒绝重复路径、空目录和路径穿越', async () => {
  for (const paths of [[], ['book/a.jpg', 'book/a.jpg'], ['book/../escape.jpg'], ['book//a.jpg'], ['/a.jpg']]) {
    await assert.rejects(fingerprintSource({ kind: 'folder', name: 'book', entries: paths.map(path => ({ path, blob: new Blob(['a']) })) }));
  }
});

test('文件夹 Unicode 排序与 JSON 转义具有跨语言稳定摘要', async () => {
  const files = [['😀.jpg', 'emoji'], ['\uE000.jpg', 'private'], ['中".jpg', 'quote'], ['a.jpg', 'ascii']];
  assert.equal(await fingerprintSource({
    kind: 'folder', name: 'book', entries: files.map(([path, content]) => ({ path: `book/${path}`, blob: new Blob([content]) }))
  }), 'sha256:6c30f67403dfc095959141db9301f36212cdd503f3bc35dd57d818af96b46c1b');
});

test('原生文件和文件夹使用受限原生描述，不跨 IPC 传书籍内容', async () => {
  const calls = [];
  const expected = `sha256:${'a'.repeat(64)}`;
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => { calls.push({ command, args }); return expected; } } } };
  assert.equal(await fingerprintSource({ kind: 'file', nativePath: 'homura-native-sources/1/source.epub' }), expected);
  assert.equal(await fingerprintSource({ kind: 'folder', name: '漫画', entries: [{ path: '漫画/a.jpg', nativePath: 'homura-native-sources/2/a.jpg' }] }), expected);
  assert.deepEqual(calls, [
    { command: 'sync_fingerprint_source', args: { source: { kind: 'file', nativePath: 'homura-native-sources/1/source.epub' } } },
    { command: 'sync_fingerprint_source', args: { source: { kind: 'folder', entries: [{ relativePath: 'a.jpg', nativePath: 'homura-native-sources/2/a.jpg' }] } } }
  ]);
});

test('原生安全限制不可回退；普通原生故障可用独立 Blob 备份', async () => {
  let calls = 0;
  globalThis.window = { __TAURI__: { core: { invoke: async () => { calls++; throw 'NATIVE_SECURITY_LIMIT source outside root'; } } } };
  await assert.rejects(fingerprintSource({ nativePath: '/private/secret', blob: new Blob(['backup']) }), error => error.code === 'NATIVE_SECURITY_LIMIT');
  assert.equal(calls, 1);
  globalThis.window.__TAURI__.core.invoke = async () => { throw 'NATIVE_COMMAND_FAILED file missing'; };
  assert.equal(await fingerprintSource({ nativePath: 'homura-native-sources/missing', blob: new Blob(['backup']) }), `sha256:${digest('backup')}`);
});

test('句柄缺少读取授权时保留独立 Blob 兜底，不弹出权限对话框', async () => {
  const source = {
    handle: { queryPermission: async () => 'prompt', getFile: async () => { throw new Error('不可调用'); } },
    blob: new Blob(['backup'])
  };
  assert.equal(await fingerprintSource(source), `sha256:${digest('backup')}`);
  await assert.rejects(fingerprintSource({ handle: source.handle }), /读取权限未授予/);
});

test('原生私有副本的备用外部句柄失效时不阻断不可变身份缓存', async () => {
  globalThis.window = { __TAURI__: { core: { invoke: async () => { throw new Error('此步不应调用原生摘要'); } } } };
  const source = {
    nativePath: 'homura-native-sources/book/source.epub',
    blob: new Blob(['immutable-backup']),
    handle: { getFile: async () => { throw new Error('备用句柄已失效'); } }
  };
  assert.deepEqual(await prepareSourceIdentity(source), { source: { ...source, handle: null }, signature: null });
});

test('图片文件夹的可变句柄顺序读取，签名不受条目顺序与顶层文件夹名影响', async () => {
  let reading = false;
  const handle = (content, lastModified) => ({
    async getFile() {
      assert.equal(reading, false, '不能同时打开整批图片句柄');
      reading = true;
      await Promise.resolve();
      reading = false;
      return new File([content], 'page.jpg', { lastModified });
    }
  });
  const source = {
    kind: 'folder', name: 'book',
    entries: [
      { path: 'book/02.jpg', handle: handle('second', 2) },
      { path: 'book/01.jpg', handle: handle('first', 1) }
    ]
  };
  const prepared = await prepareSourceIdentity(source);
  const reordered = await prepareSourceIdentity({
    ...source, name: 'renamed',
    entries: source.entries.slice().reverse().map(entry => ({ ...entry, path: entry.path.replace('book/', 'renamed/') }))
  });
  assert.equal(prepared.signature, reordered.signature);
  const expected = `sha256:${digest(JSON.stringify([['01.jpg', digest('first')], ['02.jpg', digest('second')]]))}`;
  assert.equal(await fingerprintSource(prepared.source), expected);
  assert.equal(await fingerprintSource(reordered.source), expected);
});
