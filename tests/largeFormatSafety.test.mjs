import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) {
      return {
        url: 'data:text/javascript,' + encodeURIComponent('export default "fake-worker.mjs";'),
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.document = dom.window.document;

const { parseMobiBuffer, parseMobiRangeSource } = await import('../src/services/mobi.ts');
const { parseTxtFile, parseMarkdownFile } = await import('../src/services/parsers.ts');

function buildSyntheticMobiComic({ imageCount = 8, imageBodySize = 64 * 1024 } = {}) {
  const html = `<html><body>${Array.from({ length: imageCount }, (_, i) => `<img recindex="${i + 1}" alt="P${i + 1}"/>`).join('<mbp:pagebreak/>')}</body></html>`;
  const textBytes = new TextEncoder().encode(html);

  const rec0 = new Uint8Array(256);
  const view0 = new DataView(rec0.buffer);
  view0.setUint16(0, 1); // compression = 1 (uncompressed)
  view0.setUint32(4, textBytes.length);
  view0.setUint16(8, 1); // textRecordCount = 1
  view0.setUint16(10, Math.max(4096, textBytes.length));
  view0.setUint16(12, 0); // encryption = 0
  rec0.set(new TextEncoder().encode('MOBI'), 16);
  view0.setUint32(20, 232); // mobiLength
  view0.setUint32(28, 65001); // utf-8
  view0.setUint32(0x6c, 2); // firstImage = record 2

  // 2 + imageCount 条记录：0=MOBI头，1=正文，2..=JPEG 图片
  const totalRecords = 2 + imageCount;
  const headerSize = 78 + totalRecords * 8;
  const records = [rec0, textBytes];
  for (let i = 0; i < imageCount; i++) {
    const img = new Uint8Array(imageBodySize);
    img[0] = 0xff;
    img[1] = 0xd8;
    img[2] = 0xff;
    img[3] = 0xe0;
    img[4] = i & 0xff;
    records.push(img);
  }

  let offset = headerSize;
  const starts = [];
  for (const rec of records) {
    starts.push(offset);
    offset += rec.length;
  }

  const file = new Uint8Array(offset);
  const view = new DataView(file.buffer);
  view.setUint16(76, totalRecords);
  for (let i = 0; i < totalRecords; i++) {
    view.setUint32(78 + i * 8, starts[i]);
  }
  for (let i = 0; i < totalRecords; i++) {
    file.set(records[i], starts[i]);
  }
  return { file, starts };
}

test('Tauri capabilities 包含 AppData 递归读权限以支持大文件按需 Range 读取', () => {
  const cap = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  assert.ok(cap.permissions.includes('fs:allow-appdata-read-recursive'));
  const scopeDeny = cap.permissions.find(item => typeof item === 'object' && item?.identifier === 'fs:scope');
  assert.ok(scopeDeny?.deny?.includes('$APPDATA/homura-native-references.json'));
});

test('损坏或截断的 MOBI 记录表与畸形压缩流不会越界或崩溃', () => {
  const truncated = new Uint8Array(100);
  new DataView(truncated.buffer).setUint16(76, 5000); // 声明 5000 条记录但文件只有 100 字节
  assert.throws(() => parseMobiBuffer(truncated), /记录表超出文件范围/);

  const badRec0 = new Uint8Array(120);
  const view = new DataView(badRec0.buffer);
  view.setUint16(76, 1);
  view.setUint32(78, 110); // rec0 超出文件尾部
  assert.throws(() => parseMobiBuffer(badRec0), /文件头超出文件范围/);
});

test('parseMobiRangeSource 解析大 MOBI 漫画时只读取头/正文/魔数与封面，不整本读入图片体', async () => {
  const { file } = buildSyntheticMobiComic({ imageCount: 8, imageBodySize: 128 * 1024 });
  let totalReadBytes = 0;
  const source = {
    size: file.length,
    async read(start, end) {
      totalReadBytes += end - start;
      return file.slice(start, end);
    }
  };

  const parsed = await parseMobiRangeSource(source, 'test-comic');
  assert.equal(parsed.type, 'manga');
  assert.equal(parsed.pages.length, 8);
  assert.ok(parsed.coverBlob && parsed.coverBlob.size === 128 * 1024);
  // 总文件 > 1 MiB，但解析只读头+正文+8*8B魔数+1张封面（约 130 KB），远小于整本大小
  assert.ok(totalReadBytes < file.length * 0.25, `不应读取整本 MOBI，实际读取 ${totalReadBytes} / ${file.length}`);
});

test('超长无换行 TXT 单行会被拆分，避免分页器测量卡死', async () => {
  const hugeLine = '这是一段没有换行的超长正文。'.repeat(2000); // > 26000 chars
  const file = new File([hugeLine], 'huge.txt', { type: 'text/plain' });
  const parsed = await parseTxtFile(file);
  assert.ok(parsed && parsed.chapters.length >= 1);
  const paragraphCount = (parsed.chapters[0].htmlContent.match(/<p>/g) || []).length;
  assert.ok(paragraphCount >= 2, '超长单行应被安全拆分为多个段落');
});

test('parseMarkdownFile 支持 GB18030 编码并正常切章', async () => {
  // GBK/GB18030 字节："# 第一章\n\n测试中文"
  const gbkBytes = new Uint8Array([
    0x23, 0x20, 0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0x0a,
    0xb2, 0xe2, 0xca, 0xd4, 0xd6, 0xd0, 0xce, 0xc4
  ]);
  const file = new File([gbkBytes], 'gbk-note.md', { type: 'text/markdown' });
  const parsed = await parseMarkdownFile(file);
  assert.ok(parsed && parsed.chapters.length === 1);
  assert.equal(parsed.chapters[0].title, '第一章');
  assert.ok(parsed.chapters[0].htmlContent.includes('测试中文'));
});
