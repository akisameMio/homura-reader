/* ============================================================================
   HOMURA · 远程 ZIP 随机读取
   ----------------------------------------------------------------------------
   先读中央目录，再按条目读取压缩数据。JSZip 仅解压单个有界条目并校验 CRC，
   不加载整个远端压缩包。支持 ZIP64，拒绝多卷、加密和越界条目。
   ========================================================================== */
import JSZip from 'jszip';
import type { RangeSource } from './webdavBooks.ts';

export interface RemoteZipEntry {
  name: string;
  dir: boolean;
  async(type: 'blob'): Promise<Blob>;
  async(type: 'text'): Promise<string>;
}
export interface RemoteZip {
  entries: RemoteZipEntry[];
  file(path: string): RemoteZipEntry | null;
}
const MAX_ENTRIES = 20_000;
const MAX_DIRECTORY = 16 * 1024 * 1024;
const MAX_COMPRESSED = 64 * 1024 * 1024;
const MAX_IMAGE = 256 * 1024 * 1024;
const MAX_TEXT = 8 * 1024 * 1024;
const fail = () => new Error('远端压缩包无效、已加密或超过安全限制');
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function u64(bytes: DataView, offset: number) {
  const value = bytes.getUint32(offset, true) + bytes.getUint32(offset + 4, true) * 2 ** 32;
  if (!Number.isSafeInteger(value)) throw fail();
  return value;
}
async function read(source: RangeSource, start: number, length: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > source.size) throw fail();
  const result = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 1024 * 1024) {
    const size = Math.min(1024 * 1024, length - offset);
    const chunk = await source.read(start + offset, start + offset + size);
    if (chunk.length !== size) throw fail();
    result.set(chunk, offset);
  }
  return result;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

async function unpack(item: JSZip.JSZipObject, expected: number, crc: number, type: 'blob' | 'text') {
  return new Promise<Blob | string>((resolve, reject) => {
    const stream = (item as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
    const chunks: Uint8Array[] = [];
    let total = 0;
    let checksum = 0xffffffff;
    stream.on('data', (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > expected) { stream.pause(); chunks.length = 0; reject(fail()); return; }
      for (const byte of chunk) checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (total !== expected || ((checksum ^ 0xffffffff) >>> 0) !== crc) { reject(fail()); return; }
      const blob = new Blob(chunks as BlobPart[]);
      if (type === 'blob') resolve(blob);
      else void blob.text().then(resolve, reject);
    });
    stream.resume();
  });
}

export async function openRemoteZip(source: RangeSource): Promise<RemoteZip> {
  if (source.size < 22) throw fail();
  let tail = await read(source, source.size - 22, 22);
  let tailStart = source.size - 22;
  let end = 0;
  if (view(tail).getUint32(0, true) !== 0x06054b50 || view(tail).getUint16(20, true) !== 0) {
    tailStart = Math.max(0, source.size - 65_557);
    tail = await read(source, tailStart, source.size - tailStart);
    end = -1;
    const data = view(tail);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (data.getUint32(i, true) === 0x06054b50 && i + 22 + data.getUint16(i + 20, true) === tail.length) { end = i; break; }
    }
    if (end < 0) throw fail();
  }
  const footer = view(tail);
  if (footer.getUint16(end + 4, true) !== 0 || footer.getUint16(end + 6, true) !== 0 || footer.getUint16(end + 8, true) !== footer.getUint16(end + 10, true)) throw fail();
  let count = footer.getUint16(end + 10, true);
  let length = footer.getUint32(end + 12, true);
  let offset = footer.getUint32(end + 16, true);
  let directoryEnd = tailStart + end;
  if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    const locator = view(await read(source, directoryEnd - 20, 20));
    if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) throw fail();
    const zip64Offset = u64(locator, 8);
    const zip64 = view(await read(source, zip64Offset, 56));
    if (zip64.getUint32(0, true) !== 0x06064b50 || u64(zip64, 4) < 44 || zip64.getUint32(16, true) !== 0 || zip64.getUint32(20, true) !== 0 || u64(zip64, 24) !== u64(zip64, 32)) throw fail();
    count = u64(zip64, 32); length = u64(zip64, 40); offset = u64(zip64, 48);
    directoryEnd = zip64Offset;
  }
  if (!count || count > MAX_ENTRIES || length > MAX_DIRECTORY || offset + length > directoryEnd || count * 46 > length) throw fail();
  const central = await read(source, offset, length);
  const data = view(central);
  const entries: RemoteZipEntry[] = [];
  const byName = new Map<string, RemoteZipEntry>();
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > length || data.getUint32(cursor, true) !== 0x02014b50) throw fail();
    const flags = data.getUint16(cursor + 8, true);
    const method = data.getUint16(cursor + 10, true);
    const crc = data.getUint32(cursor + 16, true);
    let compressed = data.getUint32(cursor + 20, true);
    let uncompressed = data.getUint32(cursor + 24, true);
    const nameLength = data.getUint16(cursor + 28, true);
    const extraLength = data.getUint16(cursor + 30, true);
    const commentLength = data.getUint16(cursor + 32, true);
    let disk = data.getUint16(cursor + 34, true);
    let localOffset = data.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > length || !nameLength || nameLength > 4096 || (flags & 1) || ![0, 8].includes(method)) throw fail();
    const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength);
    // UTF-8 为标准路径；历史非 UTF-8 包用浏览器支持的 GB18030 解码。
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(rawName); } catch {
      if (flags & 0x800) throw fail();
      name = new TextDecoder('gb18030', { fatal: true }).decode(rawName);
    }
    const parts = name.replace(/\/$/, '').split('/');
    if (name.startsWith('/') || /[\\\u0000-\u001f]/.test(name) || parts.some(part => !part || part === '.' || part === '..') || byName.has(name)) throw fail();
    let extra = cursor + 46 + nameLength;
    const extraEnd = extra + extraLength;
    let hasZip64 = false;
    while (extra + 4 <= extraEnd) {
      const tag = data.getUint16(extra, true);
      const size = data.getUint16(extra + 2, true);
      extra += 4;
      if (extra + size > extraEnd) throw fail();
      if (tag === 1) {
        hasZip64 = true;
        let field = extra;
        const number = () => { if (field + 8 > extra + size) throw fail(); const result = u64(data, field); field += 8; return result; };
        if (uncompressed === 0xffffffff) uncompressed = number();
        if (compressed === 0xffffffff) compressed = number();
        if (localOffset === 0xffffffff) localOffset = number();
        if (disk === 0xffff) { if (field + 4 > extra + size) throw fail(); disk = data.getUint32(field, true); }
      }
      extra += size;
    }
    if ((!hasZip64 && [compressed, uncompressed, localOffset].includes(0xffffffff)) || disk !== 0 || localOffset + 30 > offset || compressed > MAX_COMPRESSED || uncompressed > MAX_IMAGE) throw fail();
    const entry: RemoteZipEntry = {
      name, dir: name.endsWith('/'),
      async: (async (type: 'blob' | 'text') => {
        if (type === 'text' && uncompressed > MAX_TEXT) throw fail();
        const header = view(await read(source, localOffset, 30));
        if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== method || (header.getUint16(6, true) & 1)) throw fail();
        const start = localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        if (start + compressed > offset) throw fail();
        const packed = await read(source, start, compressed);
        // 将单个条目封装为最小 ZIP，让现有 JSZip 执行解压与 CRC 校验。
        const archive = new Uint8Array(30 + 5 + compressed + 46 + 5 + 22);
        const synthetic = view(archive);
        synthetic.setUint32(0, 0x04034b50, true);
        synthetic.setUint16(4, 20, true); synthetic.setUint16(8, method, true);
        synthetic.setUint32(14, crc, true); synthetic.setUint32(18, compressed, true); synthetic.setUint32(22, uncompressed, true); synthetic.setUint16(26, 5, true);
        archive.set(new TextEncoder().encode('entry'), 30); archive.set(packed, 35);
        const c = 35 + compressed;
        synthetic.setUint32(c, 0x02014b50, true); synthetic.setUint16(c + 4, 20, true); synthetic.setUint16(c + 6, 20, true); synthetic.setUint16(c + 10, method, true);
        synthetic.setUint32(c + 16, crc, true); synthetic.setUint32(c + 20, compressed, true); synthetic.setUint32(c + 24, uncompressed, true); synthetic.setUint16(c + 28, 5, true);
        archive.set(new TextEncoder().encode('entry'), c + 46);
        const e = c + 51;
        synthetic.setUint32(e, 0x06054b50, true); synthetic.setUint16(e + 8, 1, true); synthetic.setUint16(e + 10, 1, true); synthetic.setUint32(e + 12, 51, true); synthetic.setUint32(e + 16, c, true);
        const zip = await JSZip.loadAsync(archive);
        const item = zip.file('entry');
        if (!item) throw fail();
        const unpacked = await unpack(item, uncompressed, crc, type);
        if (source.closed) throw new Error('远程读取已取消');
        return unpacked;
      }) as RemoteZipEntry['async']
    };
    byName.set(name, entry); entries.push(entry); cursor = next;
  }
  return { entries, file: path => byName.get(path) || null };
}
