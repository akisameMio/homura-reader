/* ============================================================================
   HOMURA · 原文件内容指纹
   ----------------------------------------------------------------------------
   文件逐块计算 SHA-256，既不依赖导入时生成的本机 id，也不把大书整本读入内存。
   图片文件夹对相对路径与文件摘要排序后计算摘要；顶层文件夹改名不改变身份。
   ========================================================================== */

import { getFile } from './opfs.ts';
import { canUseNativeBridge, invokeNativeCommand, NativeErrorCode } from './nativeRuntime.ts';
import type { BookSource } from '../types.ts';
import { fingerprintNativeReference } from './nativeReference.ts';

const BLOCK_READ_BYTES = 1024 * 1024;
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotate(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

class Sha256 {
  private state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private buffer = new Uint8Array(64);
  private words = new Uint32Array(64);
  private buffered = 0;
  private length = 0;

  private block(bytes: Uint8Array, offset: number) {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      w[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + ROUND_CONSTANTS[i] + w[i]) | 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) this.state[i] += next[i];
  }

  update(bytes: Uint8Array) {
    this.length += bytes.length;
    let offset = 0;
    if (this.buffered) {
      const count = Math.min(bytes.length, 64 - this.buffered);
      this.buffer.set(bytes.subarray(0, count), this.buffered);
      this.buffered += count;
      offset = count;
      if (this.buffered === 64) {
        this.block(this.buffer, 0);
        this.buffered = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this.block(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.length) {
      this.buffer.set(bytes.subarray(offset), 0);
      this.buffered = bytes.length - offset;
    }
  }

  digest() {
    const bitLength = this.length * 8;
    const padding = new Uint8Array(this.buffered < 56 ? 64 - this.buffered : 128 - this.buffered);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(padding.length - 8, Math.floor(bitLength / 0x1_0000_0000));
    view.setUint32(padding.length - 4, bitLength >>> 0);
    this.update(padding);
    return [...this.state].map(value => value.toString(16).padStart(8, '0')).join('');
  }
}

async function hashBlob(blob: Blob) {
  const hash = new Sha256();
  for (let offset = 0; offset < blob.size; offset += BLOCK_READ_BYTES) {
    hash.update(new Uint8Array(await blob.slice(offset, offset + BLOCK_READ_BYTES).arrayBuffer()));
  }
  return hash.digest();
}

function isSecurityError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === NativeErrorCode.SECURITY_LIMIT || code === NativeErrorCode.LIMIT_EXCEEDED;
}

async function nativeFingerprint(source: unknown) {
  const result = await invokeNativeCommand(null, 'sync_fingerprint_source', { source });
  if (typeof result !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(result)) throw new Error('原生内容指纹无效');
  return result;
}

async function fileFingerprint(source: BookSource): Promise<string> {
  if (source.nativeReference) return fingerprintNativeReference(source.nativeReference);
  if (source.kind === 'managed' && /^sha256:[a-f0-9]{64}$/.test(source.contentFingerprint || '')) {
    return source.contentFingerprint!;
  }
  let lastError: unknown;
  if (source.nativePath && canUseNativeBridge()) {
    try {
      return await nativeFingerprint({ kind: 'file', nativePath: source.nativePath });
    } catch (error) {
      if (isSecurityError(error)) throw error;
      lastError = error;
    }
  }
  if (source.handle) {
    try {
      if (source.handle.queryPermission && await source.handle.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('原文件读取权限未授予');
      return `sha256:${await hashBlob(await source.handle.getFile())}`;
    } catch (error) { lastError = error; }
  }
  if (source.opfsPath) {
    try { return `sha256:${await hashBlob(await getFile(source.opfsPath))}`; }
    catch (error) { lastError = error; }
  }
  if (source.blob) return `sha256:${await hashBlob(source.blob)}`;
  throw lastError || new Error('找不到可读取的原文件，无法匹配同步书籍');
}

function relativePath(source: BookSource, entry: BookSource) {
  const name = String(source.name || '').replace(/\\/g, '/').replace(/\/$/, '');
  let path = String(entry.path || entry.name || '').replace(/\\/g, '/');
  if (name && path.startsWith(`${name}/`)) path = path.slice(name.length + 1);
  if (!path || path.startsWith('/') || path.split('/').some(segment => !segment || segment === '.' || segment === '..') || /[\u0000-\u001f]/.test(path)) throw new Error('图片文件夹的相对路径无效');
  return path;
}

export interface PreparedSyncIdentity {
  source: BookSource;
  signature: string | null;
}

// 句柄指向用户可修改的文件；签名与摘要必须来自同一个 File 快照。
// AppData、OPFS 和 Blob 是应用管理的副本，可以继续复用内容指纹。
export async function prepareSourceIdentity(source: BookSource): Promise<PreparedSyncIdentity> {
  if (source.kind === 'folder') {
    if (!source.entries?.some(entry => !!entry.handle || !!entry.nativeReference)) {
      return { source, signature: null };
    }
    if (source.entries.length > 20_000) throw new Error('图片文件夹条目无效或过多');
    const prepared: PreparedSyncIdentity[] = [];
    for (const entry of source.entries) prepared.push(await prepareSourceIdentity(entry));
    const manifest = prepared.map((entry, index) => [relativePath(source, source.entries![index]), entry.signature] as const);
    manifest.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    return {
      source: { ...source, entries: prepared.map(entry => entry.source) },
      signature: `folder:v1:${JSON.stringify(manifest)}`
    };
  }
  if (source.nativeReference) {
    const fingerprint = await fingerprintNativeReference(source.nativeReference);
    if (source.contentFingerprint && fingerprint !== source.contentFingerprint) throw new Error('原文件内容已变更');
    return {
      source: { kind: 'managed', name: source.name, path: source.path, contentFingerprint: fingerprint },
      signature: fingerprint
    };
  }
  if (!source.handle) return { source, signature: null };
  const nativePrimary = !!source.nativePath && canUseNativeBridge();
  let file: File;
  try {
    if (source.handle.queryPermission && await source.handle.queryPermission({ mode: 'read' }) !== 'granted') {
      throw new Error('原文件读取权限未授予');
    }
    file = await source.handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !Number.isFinite(file.lastModified) || file.lastModified < 0) {
      throw new Error('原文件属性无效，无法检查同步身份');
    }
  } catch (error) {
    if (!nativePrimary && !source.opfsPath && !source.blob) throw error;
    // 句柄失效不阻断私有副本；移除它，避免摘要回退时重新请求失效句柄。
    return { source: { ...source, handle: null }, signature: null };
  }
  return {
    source: { ...source, handle: null, nativePath: nativePrimary ? source.nativePath : undefined, opfsPath: undefined, blob: file },
    signature: `handle:v1:${file.size}:${file.lastModified}`
  };
}

export async function fingerprintSource(source: BookSource): Promise<string> {
  if (source.kind !== 'folder') return fileFingerprint(source);
  const entries = source.entries;
  if (!Array.isArray(entries) || !entries.length || entries.length > 20_000) throw new Error('图片文件夹条目无效或过多');
  const paths = entries.map(entry => relativePath(source, entry));
  if (new Set(paths).size !== paths.length) throw new Error('图片文件夹包含重复路径');
  if (entries.every(entry => !!entry.nativePath && !entry.nativeReference) && canUseNativeBridge()) {
    try {
      return await nativeFingerprint({ kind: 'folder', entries: entries.map((entry, index) => ({ relativePath: paths[index], nativePath: entry.nativePath })) });
    } catch (error) {
      if (isSecurityError(error)) throw error;
    }
  }
  const manifest: [string, string][] = [];
  for (let i = 0; i < entries.length; i++) manifest.push([paths[i], (await fileFingerprint(entries[i])).slice(7)]);
  manifest.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const hash = new Sha256();
  hash.update(new TextEncoder().encode(JSON.stringify(manifest)));
  return `sha256:${hash.digest()}`;
}
