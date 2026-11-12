/* ============================================================================
   HOMURA · 漫画压缩包解析
   ----------------------------------------------------------------------------
   CBZ / ZIP 优先使用原生会话按需解页；原生不可用或普通失败时再回退 JSZip。
   安全限制与资源超限错误不会触发回退。
   ========================================================================== */

import JSZip from 'jszip';
import type { Book } from '../types.ts';
import {
  canUseNativeArchive,
  clearNativeArchiveBookCache,
  closeNativeArchive,
  openNativeArchive,
  NATIVE_ONLY_ARCHIVE_BYTES,
  readNativePageBlob,
  shouldFallbackNativeArchive
} from './nativeArchive.ts';

const IMAGE_ENTRY = /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i;

// macOS 打包残留不是页面，提前剔掉免得白读内存。
function isJunkArchivePath(path: string) {
  return path
    .split(/[\\/]/)
    .some(segment => segment === '__MACOSX' || segment === '.DS_Store' || segment.startsWith('._'));
}

interface CbzOptions {
  id?: string;
  name?: string;
  nativePath?: string;
  archiveSize?: number;
  staged?: boolean;
  loadFallbackFile?: () => Promise<Blob | null>;
  [key: string]: unknown;
}

interface NativeArchiveEntry {
  path?: string;
  width?: number;
  height?: number;
}

function makeCbzId() {
  return `cbz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// 原生快速路径：压缩包只打开一次，页面按需解出到 AppCache。
export async function parseCbzNativeArchive(nativePath: string, options: CbzOptions = {}) {
  if (!canUseNativeArchive() || !nativePath) return null;
  const archiveId = options.id || makeCbzId();
  const name = options.name || 'book.cbz';
  let coverUrl: string | null = null;

  try {
    const archive = await openNativeArchive(archiveId, nativePath) as {
      entries?: NativeArchiveEntry[];
    } | null;
    const entries = archive?.entries || [];
    if (!entries.length) throw new Error('压缩包内未找到图片');

    const first = await readNativePageBlob(archiveId, 0);
    coverUrl = URL.createObjectURL(first.blob);
    const pageItems = entries.map((entry, index) => ({
      nativeArchiveId: archiveId,
      nativeArchivePath: nativePath,
      nativeArchiveMode: 'pages',
      nativeIndex: index,
      imageWidth: entry.width || 0,
      imageHeight: entry.height || 0,
      url: index === 0 ? coverUrl : null
    }));

    return {
      id: archiveId,
      type: 'manga',
      format: 'cbz',
      title: name.replace(/\.(cbz|zip)$/i, ''),
      cover: coverUrl,
      coverBlob: first.blob,
      coverNative: entries[0]?.path
        ? { archivePath: nativePath, entryPath: entries[0].path }
        : null,
      pageItems,
      pageCount: pageItems.length,
      nativeArchiveId: archiveId,
      nativeArchivePath: nativePath,
      nativeArchiveMode: 'pages',
      nativeArchiveStaged: !!options.staged
    } as unknown as Book;
  } catch (err) {
    if (coverUrl?.startsWith('blob:')) URL.revokeObjectURL(coverUrl);
    await closeNativeArchive(archiveId).catch(() => {});
    await clearNativeArchiveBookCache(archiveId).catch(() => {});
    throw err;
  }
}

export async function parseCbzFileLazy(file: File | null | undefined, options: CbzOptions = {}) {
  const id = options.id || makeCbzId();
  const name = options.name || file?.name || 'book.cbz';
  const archiveSize = Math.max(file?.size || 0, options.archiveSize || 0);

  if (options.nativePath && canUseNativeArchive()) {
    try {
      return await parseCbzNativeArchive(options.nativePath, {
        ...options,
        id,
        name
      });
    } catch (err) {
      if (archiveSize > NATIVE_ONLY_ARCHIVE_BYTES || !shouldFallbackNativeArchive(err)) throw err;
      console.warn('[HOMURA] 原生压缩包解析失败，回退 JSZip', err);
    }
  }
  if (archiveSize > NATIVE_ONLY_ARCHIVE_BYTES) {
    throw new Error('超过 4 GiB 的压缩包需要原生读取');
  }
  const fallbackFile = typeof options.loadFallbackFile === 'function'
    ? await options.loadFallbackFile()
    : file;
  if (!fallbackFile) return null;

  try {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(fallbackFile);
    const imgEntries: { name: string; entry: { async(type: 'blob'): Promise<Blob> } }[] = [];

    zipContent.forEach((relPath, entry) => {
      if (!entry.dir && IMAGE_ENTRY.test(relPath) && !isJunkArchivePath(relPath)) {
        imgEntries.push({ name: relPath, entry });
      }
    });

    imgEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (imgEntries.length === 0) throw new Error('压缩包内未找到图片');

    const firstBlob = await imgEntries[0].entry.async('blob');
    const firstUrl = URL.createObjectURL(firstBlob);

    const pageItems = imgEntries.map((item, idx) => ({
      zipEntry: item.entry,
      url: idx === 0 ? firstUrl : null
    }));

    return {
      id,
      type: 'manga',
      format: 'cbz',
      title: name.replace(/\.(cbz|zip)$/i, ''),
      cover: firstUrl,
      coverBlob: firstBlob,
      pageItems,
      pageCount: pageItems.length,
      nativeArchiveStaged: !!options.staged
    } as unknown as Book;
  } catch (err) {
    console.error(err);
    return null;
  }
}
