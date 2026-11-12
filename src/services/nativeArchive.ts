/* ============================================================================
   HOMURA · 原生压缩包通道
   ----------------------------------------------------------------------------
   处理 Android WebView 上最费内存的 CBZ/ZIP 与 EPUB 文档：Kotlin 通过
   ZipFile 随机读取条目；桌面端由 Rust 从 AppData 读取 ZIP 中央目录。
   图片写入有上限的页面缓存，文本批量返回给 JS。原生通道不可用或允许恢复
   的普通失败可以回退 JSZip，安全限制与超限错误必须原样抛出。
   ========================================================================== */

import { isAndroid } from './platform.ts';
import {
  NativeErrorCode,
  canUseNativeBridge,
  invokeNativeCommand,
  normalizeNativeError
} from './nativeRuntime.ts';

// 大于 4 GiB 的 ZIP 不能交给 JSZip 整包载入 WebView 内存。
export const NATIVE_ONLY_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;

const openArchives = new Set<string>();
const lifecycleQueues = new Map<string, Promise<unknown>>();
const ensureTasks = new Map<string, Promise<boolean>>();

/** 原生页面/文本读取返回的最小字段结构 */
interface NativeFileResult {
  path?: string;
  width?: number;
  height?: number;
  mime?: string;
  size?: number;
}

/** 页项最小结构（用于回退查找 nativeArchiveId/Path） */
interface PageItemLike {
  nativeArchiveId?: string;
  nativeArchivePath?: string;
  nativeArchiveMode?: string;
}

/** 会话所需的书本字段 */
interface ArchiveSessionBook {
  nativeArchiveId?: string | null;
  nativeArchivePath?: string | null;
  nativeArchiveMode?: string | null;
  pageItems?: PageItemLike[] | null;
}

export function canUseNativeArchive() {
  return canUseNativeBridge();
}

async function invokeNative(command: string, args: Record<string, unknown> = {}) {
  return invokeNativeCommand(isAndroid ? 'android-archive' : null, command, args, {
    feature: 'archive'
  });
}

// 只有普通后端失败和“能力不存在 / 格式暂不支持”允许改走 JSZip。
// 路径越界、条目过多、解压过大等限制必须由原生后端终止本次解析。
const ARCHIVE_FALLBACK_CODES: Set<string> = new Set([
  NativeErrorCode.UNAVAILABLE,
  NativeErrorCode.UNSUPPORTED,
  NativeErrorCode.DISABLED,
  NativeErrorCode.COMMAND_FAILED,
  NativeErrorCode.INVALID_DATA
]);

export function shouldFallbackNativeArchive(error: unknown) {
  const normalized = normalizeNativeError(error, { feature: 'archive' });
  return ARCHIVE_FALLBACK_CODES.has(normalized.code);
}

// open / close 必须按压缩包串行，避免快速切书时 close 晚于下一轮 open 执行。
function enqueueLifecycle<T>(archiveId: string, operation: () => Promise<T>): Promise<T> {
  const previous = lifecycleQueues.get(archiveId) || Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  lifecycleQueues.set(archiveId, task);
  task.then(
    () => {
      if (lifecycleQueues.get(archiveId) === task) lifecycleQueues.delete(archiveId);
    },
    () => {
      if (lifecycleQueues.get(archiveId) === task) lifecycleQueues.delete(archiveId);
    }
  );
  return task;
}

function nativeArchiveIdFor(book: ArchiveSessionBook | null | undefined) {
  return book?.nativeArchiveId
    || (book?.pageItems || []).find((item) => item?.nativeArchiveId)?.nativeArchiveId
    || null;
}

function nativeArchivePathFor(book: ArchiveSessionBook | null | undefined) {
  return book?.nativeArchivePath
    || (book?.pageItems || []).find((item) => item?.nativeArchivePath)?.nativeArchivePath
    || '';
}

function nativeArchiveModeFor(book: ArchiveSessionBook | null | undefined) {
  // 旧存档没有模式字段时按 EPUB 文档处理，保持升级前的行为；
  // CBZ 的书籍与页项都会显式写 'pages'。
  return book?.nativeArchiveMode
    || (book?.pageItems || []).find((item) => item?.nativeArchiveMode)?.nativeArchiveMode
    || 'document';
}

// 漫画压缩包按图片条目顺序打开；EPUB 文档需要全部条目与路径索引。
export function openNativeArchive(archiveId: string, path: string, options: { scanDimensions?: boolean } = {}) {
  return enqueueLifecycle(archiveId, async () => {
    const args: Record<string, unknown> = { archiveId, path };
    if (isAndroid) args.scanDimensions = options.scanDimensions !== false;
    const result = await invokeNative('open', args);
    openArchives.add(archiveId);
    return result;
  });
}

export function openNativeDocument(archiveId: string, path: string, options: { scanDimensions?: boolean; includeEntries?: boolean; [key: string]: unknown } = {}) {
  return enqueueLifecycle(archiveId, async () => {
    // 已持久化页清单时只需要恢复 ZipFile 会话，不再扫描全部图片尺寸或
    // 把几千条 ZIP 元数据经 IPC 送回 WebView。
    const args: Record<string, unknown> = { archiveId, path };
    if (isAndroid) {
      args.scanDimensions = options.scanDimensions !== false;
      args.includeEntries = options.includeEntries !== false;
    }
    const result = await invokeNative('openDocument', args);
    openArchives.add(archiveId);
    return result;
  });
}

export function extractNativePage(archiveId: string, index: number) {
  return invokeNative('extract', { archiveId, index });
}

export function extractNativeEntry(archiveId: string, index: number) {
  return extractNativePage(archiveId, index);
}

export async function readNativeTextBatch(archiveId: string, paths: string[] | unknown) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  if (!openArchives.has(archiveId)) throw new Error('原生压缩包会话尚未打开');
  const result = await invokeNative('readTextBatch', {
    archiveId,
    pathsJson: JSON.stringify(paths)
  });
  return Array.isArray(result?.texts) ? result.texts : [];
}

export function closeNativeArchive(archiveId: string) {
  // 立即从可用集合移除；真正的 close 与后续 open 由同一条队列排序。
  openArchives.delete(archiveId);
  return enqueueLifecycle(archiveId, async () => {
    try {
      return await invokeNative('close', { archiveId });
    } finally {
      openArchives.delete(archiveId);
    }
  });
}

export function clearNativeArchiveBookCache(bookId: string) {
  openArchives.delete(bookId);
  ensureTasks.delete(bookId);
  return enqueueLifecycle(bookId, () => invokeNative('clearBook', { bookId }));
}

export async function clearNativeArchiveCache() {
  try {
    return await invokeNative('clearAll');
  } finally {
    openArchives.clear();
    ensureTasks.clear();
  }
}

export function isNativeArchiveSessionOpen(archiveId: string | null | undefined) {
  return !!archiveId && openArchives.has(archiveId);
}

// 关闭阅读器后页面项仍然保留，重新打开时按需恢复 ZipFile 句柄。
export function ensureNativeArchiveSession(book: ArchiveSessionBook | null | undefined) {
  const archiveId = nativeArchiveIdFor(book);
  if (!archiveId) return Promise.resolve(false);
  if (openArchives.has(archiveId)) return Promise.resolve(true);
  if (ensureTasks.has(archiveId)) return ensureTasks.get(archiveId);

  const path = nativeArchivePathFor(book);
  if (!path) return Promise.reject(new Error('原生压缩包路径缺失'));

  const openTask = nativeArchiveModeFor(book) === 'document'
    ? openNativeDocument(archiveId, path, {
      scanDimensions: false,
      includeEntries: false
    })
    : openNativeArchive(archiveId, path, { scanDimensions: false });
  const task = openTask
    .then(() => true)
    .finally(() => {
      if (ensureTasks.get(archiveId) === task) ensureTasks.delete(archiveId);
    });
  ensureTasks.set(archiveId, task);
  return task;
}

// 只释放 ZipFile 句柄，保留已解压的页面缓存，方便快速重开同一本书。
export function releaseNativeArchiveSession(book: ArchiveSessionBook | null | undefined) {
  const archiveId = nativeArchiveIdFor(book);
  if (!archiveId) return Promise.resolve();
  return closeNativeArchive(archiveId).catch(() => {});
}

// 缓存文件位于 AppCache；读取路径由 plugin-fs 的 appcache 递归读权限覆盖。
export async function ensureNativePageAsset(archiveId: string, index: number) {
  if (!Number.isInteger(index)) return null;
  const file = await extractNativePage(archiveId, index) as NativeFileResult | null | undefined;
  if (!file?.path) return null;
  const convertFileSrc = typeof window !== 'undefined'
    ? window.__TAURI__?.core?.convertFileSrc
    : null;
  if (typeof convertFileSrc !== 'function') return null;
  return {
    url: convertFileSrc(file.path),
    width: file.width || 0,
    height: file.height || 0,
    mime: file.mime || 'image/webp'
  };
}

export async function readNativePageBlob(archiveId: string, index: number) {
  const file = await extractNativePage(archiveId, index) as NativeFileResult;
  if (!file?.path) throw new Error('原生页面缓存路径为空');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(file.path);
  return {
    path: file.path,
    mime: file.mime || 'image/jpeg',
    size: file.size,
    blob: new Blob([bytes], { type: file.mime || 'image/jpeg' })
  };
}
