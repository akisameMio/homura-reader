import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { openRemoteZip } from '../src/services/remoteZip.ts';

function source(bytes) {
  const calls = [];
  return { calls, size: bytes.length, async read(start, end) { calls.push([start, end]); assert.ok(start >= 0 && end <= bytes.length); return bytes.slice(start, end); } };
}
async function fixture(compression = 'DEFLATE', comment = '') {
  const zip = new JSZip();
  zip.file('第一章.txt', '遥远的书架。'.repeat(50));
  // 不可压缩数据让测试能分辨是否读取了另一页。
  zip.file('pages/002.jpg', Uint8Array.from({ length: 300_000 }, (_, i) => (i * 131 + (i >>> 8)) & 255), { compression: 'STORE' });
  zip.file('pages/003.jpg', new Uint8Array(500_000).fill(17), { compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression, comment });
}

test('ZIP 只取中央目录和指定条目，不加载整包或其它页，支持存储和 Deflate', async () => {
  for (const compression of ['STORE', 'DEFLATE']) {
    const bytes = await fixture(compression);
    const remote = source(bytes);
    const zip = await openRemoteZip(remote);
    const initialBytes = remote.calls.reduce((sum, [a, b]) => sum + b - a, 0);
    assert.ok(initialBytes < 2048);
    assert.equal(await zip.file('第一章.txt').async('text'), '遥远的书架。'.repeat(50));
    assert.equal(zip.file('missing'), null);
    const readBytes = remote.calls.reduce((sum, [a, b]) => sum + b - a, 0);
    assert.ok(readBytes < 4096, `实际读取 ${readBytes} 字节`);
    const image = await zip.file('pages/002.jpg').async('blob');
    assert.equal(image.size, 300_000);
    assert.ok(remote.calls.reduce((sum, [a, b]) => sum + b - a, 0) < bytes.length / 2);
  }
});

test('带注释 ZIP 可读取，损坏尾部、多卷、目录穿越、加密、CRC 错误均拒绝', async () => {
  const bytes = await fixture('DEFLATE', 'comment');
  const zip = await openRemoteZip(source(bytes));
  assert.equal((await zip.file('第一章.txt').async('text')).length, 300);
  await assert.rejects(openRemoteZip(source(bytes.slice(0, -1))));
  const stored = await fixture('STORE');
  for (const mutate of [
    data => { new DataView(data.buffer).setUint16(data.length - 18, 1, true); },
    data => { const offset = new DataView(data.buffer).getUint32(data.length - 6, true); new DataView(data.buffer).setUint16(offset + 8, 1, true); },
    data => { const offset = new DataView(data.buffer).getUint32(data.length - 6, true); data.set(new TextEncoder().encode('../evil.txt'), offset + 46); }
  ]) {
    const bad = stored.slice(); mutate(bad);
    await assert.rejects(openRemoteZip(source(bad)));
  }
  const bad = stored.slice();
  const local = new DataView(bad.buffer);
  bad[30 + local.getUint16(26, true) + local.getUint16(28, true)] ^= 127;
  const corrupted = await openRemoteZip(source(bad));
  await assert.rejects(corrupted.file('第一章.txt').async('text'));
});

test('伪造条目解压大小不会绕过流式上限', async () => {
  const bytes = await fixture();
  const offset = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
  new DataView(bytes.buffer).setUint32(offset + 24, 1, true);
  const zip = await openRemoteZip(source(bytes));
  await assert.rejects(zip.file('第一章.txt').async('text'));
});

test('ZIP64 尾部定位支持安全整数范围，不依赖完整文件载入', async () => {
  const bytes = await fixture('STORE');
  const end = bytes.length - 22;
  const normal = new DataView(bytes.buffer);
  const centralSize = normal.getUint32(end + 12, true);
  const centralOffset = normal.getUint32(end + 16, true);
  const count = normal.getUint16(end + 10, true);
  const result = new Uint8Array(bytes.length + 76);
  result.set(bytes.subarray(0, end));
  const view = new DataView(result.buffer);
  view.setUint32(end, 0x06064b50, true); view.setBigUint64(end + 4, 44n, true);
  view.setUint16(end + 12, 45, true); view.setUint16(end + 14, 45, true);
  view.setBigUint64(end + 24, BigInt(count), true); view.setBigUint64(end + 32, BigInt(count), true);
  view.setBigUint64(end + 40, BigInt(centralSize), true); view.setBigUint64(end + 48, BigInt(centralOffset), true);
  view.setUint32(end + 56, 0x07064b50, true); view.setBigUint64(end + 64, BigInt(end), true); view.setUint32(end + 72, 1, true);
  result.set(bytes.subarray(end), end + 76);
  view.setUint16(end + 76 + 8, 0xffff, true); view.setUint16(end + 76 + 10, 0xffff, true);
  view.setUint32(end + 76 + 12, 0xffffffff, true); view.setUint32(end + 76 + 16, 0xffffffff, true);
  const zip = await openRemoteZip(source(result));
  assert.equal(await zip.file('第一章.txt').async('text'), '遥远的书架。'.repeat(50));
  view.setBigUint64(end + 64, 2n ** 54n, true);
  await assert.rejects(openRemoteZip(source(result)));
});
