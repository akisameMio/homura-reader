/* ============================================================================
   HOMURA · 原生文件存档
   ----------------------------------------------------------------------------
   Android WebView 的 IndexedDB Blob / OPFS 在部分机型上无法跨进程可靠恢复；
   桌面端原生 ZIP 会话也需要一个 Rust 可访问的稳定路径。Tauri 包把原文件
   写进应用私有 AppData，只把相对路径存进 IndexedDB。
   ========================================================================== */

import { BaseDirectory, SeekMode, mkdir, open, readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs';
import { canUseNativeBridge } from './nativeRuntime.ts';
import { clearNativeArchiveBookCache, clearNativeArchiveCache } from './nativeArchive.ts';
import type { RangeSource } from './webdavBooks.ts';

const ROOT_DIR = 'homura-native-sources';
const BASE_DIR = BaseDirectory.AppData;
const RANGE_CHUNK_BYTES = 1024 * 1024;

export function canUseNativeStorage() {
  return canUseNativeBridge();
}

function safeSegment(name: unknown) {
  const segment = String(name || 'source').replace(/[\\/:*?"<>|]/g, '_').slice(0, 160);
  return !segment || segment === '.' || segment === '..' ? 'source' : segment;
}

function dirname(path: string) {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : ROOT_DIR;
}

export function nativeFilePath(bookId: unknown, relativePath: unknown) {
  const bookDir = safeSegment(bookId);
  const segments = String(relativePath || 'source')
    .split('/')
    .filter(Boolean)
    .map(safeSegment);
  return [ROOT_DIR, bookDir, ...segments].join('/');
}

export async function putNativeFile(path: string, blob: Blob) {
  if (!canUseNativeStorage()) throw new Error('原生文件存档不可用');
  if (!(blob instanceof Blob)) throw new Error('原文件不是 Blob');

  await mkdir(dirname(path), { baseDir: BASE_DIR, recursive: true });
  // 用流分块写，避免把整本漫画一次性序列化成巨大的 IPC 字节数组。
  await writeFile(path, blob.stream(), { baseDir: BASE_DIR });
  const info = await stat(path, { baseDir: BASE_DIR });
  if (info.size !== blob.size) {
    await remove(path, { baseDir: BASE_DIR }).catch(() => {});
    throw new Error(`原生存档回读大小不一致：${info.size} / ${blob.size}`);
  }
  return path;
}

export async function getNativeFile(path: string) {
  const bytes = await readFile(path, { baseDir: BASE_DIR });
  return new Blob([bytes]);
}

// 按字节区间读取原生存档文件（供大型 PDF 等格式按需加载，不把整本文件经 IPC 搬进 WebView）
export async function openNativeStorageRangeSource(path: string, expectedSize?: number): Promise<RangeSource> {
  if (!canUseNativeStorage()) throw new Error('原生文件存档不可用');
  const info = await stat(path, { baseDir: BASE_DIR });
  const size = Number(info.size);
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error('原生存档文件大小无效');
  }
  if (typeof expectedSize === 'number' && expectedSize > 0 && size !== expectedSize) {
    throw new Error(`原生存档文件大小不一致：${size} / ${expectedSize}`);
  }
  return {
    size,
    async read(start: number, end: number) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > size) {
        throw new Error('原生存档读取范围无效');
      }
      const total = end - start;
      if (total === 0) return new Uint8Array(0);
      const output = new Uint8Array(total);
      const handle = await open(path, { read: true, baseDir: BASE_DIR });
      try {
        await handle.seek(start, SeekMode.Start);
        let written = 0;
        while (written < total) {
          const chunkLen = Math.min(RANGE_CHUNK_BYTES, total - written);
          const buf = new Uint8Array(chunkLen);
          const n = await handle.read(buf);
          if (n === null || n <= 0) throw new Error('原生存档读取不完整');
          output.set(buf.subarray(0, n), written);
          written += n;
        }
        return output;
      } finally {
        await handle.close().catch(() => {});
      }
    }
  };
}

export async function removeNativeFile(path: string) {
  await remove(path, { baseDir: BASE_DIR }).catch(() => {});
}

export async function removeNativeBookDir(bookId: string | null | undefined) {
  if (!canUseNativeStorage() || !bookId) return;
  await clearNativeArchiveBookCache(bookId).catch(() => {});
  await remove(`${ROOT_DIR}/${safeSegment(bookId)}`, {
    baseDir: BASE_DIR,
    recursive: true
  }).catch(() => {});
}

export async function clearNativeSources() {
  if (!canUseNativeStorage()) return;
  await clearNativeArchiveCache().catch(() => {});
  await remove(ROOT_DIR, { baseDir: BASE_DIR, recursive: true }).catch(() => {});
}
