/* ============================================================================
   HOMURA · 原生导入
   ----------------------------------------------------------------------------
   桌面 Tauri 用系统选择器拿真实路径，Android 用系统文件选择器拿 content:// URI，
   再交给原生侧直接复制到 AppData。原文件全程不经过 WebView Blob，
   其它格式只在解析时按需读成 File。
   ========================================================================== */

import { readFile } from '@tauri-apps/plugin-fs';
import { getNativeFile } from './nativeStorage.ts';
import {
  NativeErrorCode,
  canUseNativeBridge,
  invokeNativeCommand,
  normalizeNativeError
} from './nativeRuntime.ts';
import { isAndroid } from './platform.ts';

const IMPORT_FILTER_EXTENSIONS = [
  'epub',
  'pdf',
  'mobi',
  'prc',
  'azw',
  'txt',
  'md',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'bmp'
];

const MIME_BY_EXTENSION = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  prc: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  txt: 'text/plain',
  md: 'text/markdown',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp'
};

/** 原生导入文件条目 */
interface NativeImportEntry {
  name?: string;
  size?: number;
  modifiedMs?: number;
  path?: string;
  uri?: string;
  relativePath?: string;
  mime?: string;
  [key: string]: unknown;
}

/** 带相对路径/原生路径的类 File 对象 */
interface NativeImportFile {
  name: string;
  size: number;
  lastModified: number;
  type: string;
  nativePath?: string;
  customRelativePath?: string;
  [key: string]: unknown;
}

const NATIVE_IMPORT_FALLBACK_CODES: Set<string> = new Set([
  NativeErrorCode.UNAVAILABLE,
  NativeErrorCode.UNSUPPORTED,
  NativeErrorCode.DISABLED,
  NativeErrorCode.COMMAND_FAILED,
  NativeErrorCode.INVALID_DATA
]);

export function canUseNativeImport() {
  return canUseNativeBridge();
}

export function nativeImportMime(name: unknown) {
  const extension = String(name || '').split('.').pop()?.toLowerCase() || '';
  return (MIME_BY_EXTENSION as Record<string, string>)[extension] || '';
}

function withRelativePath<T extends object>(file: T, relativePath: string | undefined): T {
  if (!relativePath) return file;
  try {
    Object.defineProperty(file, 'customRelativePath', {
      value: relativePath,
      writable: false
    });
  } catch (err) {
    (file as { customRelativePath?: string }).customRelativePath = relativePath;
  }
  return file;
}

export function makeNativeImportFile(entry: NativeImportEntry): NativeImportFile {
  const file: NativeImportFile = {
    name: entry.name || 'source',
    size: entry.size || 0,
    lastModified: entry.modifiedMs || Date.now(),
    type: nativeImportMime(entry.name),
    nativePath: entry.path
  };
  return withRelativePath(file, entry.relativePath);
}

export function isNativeImportFile(file: { nativePath?: string } | Blob | File | null | undefined): boolean {
  return !!(file as { nativePath?: string })?.nativePath && !(typeof Blob !== 'undefined' && file instanceof Blob);
}

export function isAndroidContentUri(path: unknown) {
  return isAndroid && typeof path === 'string' && path.startsWith('content://');
}

export function shouldFallbackNativeImport(error: unknown) {
  const normalized = normalizeNativeError(error, { feature: 'native-import' });
  return NATIVE_IMPORT_FALLBACK_CODES.has(normalized.code);
}

export function isNativeImportCancelled(error: unknown) {
  return normalizeNativeError(error, { feature: 'native-import' }).code
    === NativeErrorCode.CANCELLED;
}

function fileFromBytes(bytes: ArrayBuffer | Uint8Array | Blob, file: NativeImportFile): NativeImportFile {
  try {
    return withRelativePath(new File([bytes as BlobPart], file.name, {
      type: file.type || nativeImportMime(file.name),
      lastModified: file.lastModified || Date.now()
    }) as unknown as NativeImportFile, file.customRelativePath);
  } catch (err) {
    const blob = new Blob([bytes as BlobPart], { type: file.type || nativeImportMime(file.name) });
    try {
      Object.defineProperty(blob, 'name', { value: file.name, writable: false });
      Object.defineProperty(blob, 'lastModified', {
        value: file.lastModified || Date.now(),
        writable: false
      });
    } catch (defineError) {}
    return withRelativePath(blob as unknown as NativeImportFile, file.customRelativePath);
  }
}

/** 原生导入函数接受的最小文件结构（File 与 NativeImportFile 都满足） */
interface NativeFileLike {
  name: string;
  lastModified?: number;
  type?: string;
  nativePath?: string;
  customRelativePath?: string;
}

export async function materializeNativeImportFile<T extends NativeFileLike>(file: T): Promise<T> {
  if (!isNativeImportFile(file)) return file;
  const bytes = await readFile(file.nativePath as string);
  return fileFromBytes(bytes, file as unknown as NativeImportFile) as unknown as T;
}

export async function materializeStagedNativeImportFile<T extends NativeFileLike>(file: T, nativePath: string): Promise<T> {
  const blob = await getNativeFile(nativePath);
  return fileFromBytes(blob, file as unknown as NativeImportFile) as unknown as T;
}

export async function pickNativeImportPaths({ directory = false, multiple = false, title = '导入作品' } = {}) {
  const result = await invokeNativeCommand('dialog', 'open', {
    options: {
      title,
      directory,
      multiple,
      recursive: directory,
      filters: directory
        ? []
        : [{ name: '书籍与漫画', extensions: IMPORT_FILTER_EXTENSIONS }]
    }
  }, {
    feature: 'native-import-dialog'
  });
  if (result === null || result === undefined) return null;
  const paths = Array.isArray(result)
    ? result
    : Array.isArray(result.files)
      ? result.files
      : [result];
  return paths
    .map((entry: unknown) => typeof entry === 'string' ? entry : (entry as { path?: string })?.path)
    .filter((path: unknown) => typeof path === 'string' && path.length > 0);
}

export async function inspectNativeImportUris(uris: unknown[]) {
  if (!Array.isArray(uris) || uris.length === 0) return [];
  const result = await invokeNativeCommand('android-archive', 'inspectImportUris', { uris }, {
    feature: 'native-import'
  });
  const entries: unknown[] = Array.isArray(result)
    ? result
    : Array.isArray(result?.files)
      ? result.files
      : [];
  return entries
    .map((raw) => {
      const entry = raw as { uri?: string; path?: string; name?: string; size?: unknown; modifiedMs?: unknown; mime?: string };
      const path = entry.uri || entry.path;
      const name = entry.name || String(path || '').split('/').pop() || 'source';
      return {
        name,
        path,
        size: Number(entry.size) || 0,
        modifiedMs: Number(entry.modifiedMs) || 0,
        mime: entry.mime || nativeImportMime(name)
      };
    })
    .filter((entry) => typeof entry.path === 'string' && entry.path.length > 0);
}

export async function pickNativeUriImportFiles({ multiple = true } = {}) {
  let paths = null;
  try {
    const result = await invokeNativeCommand('android-archive', 'pickImportUris', {
      multiple
    }, {
      feature: 'native-import-dialog'
    });
    paths = Array.isArray(result?.files) ? result.files : [];
  } catch (error) {
    if (isNativeImportCancelled(error)) return null;
    throw error;
  }
  if (!paths || (paths as string[]).length === 0) return null;
  const entries = await inspectNativeImportUris(paths);
  return entries.map(makeNativeImportFile);
}

export async function scanNativeImportPaths(paths: unknown[]) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const result = await invokeNativeCommand(null, 'scanImportPaths', { paths }, {
    feature: 'native-import'
  });
  return Array.isArray(result?.files) ? result.files : [];
}

export async function stageNativeImportPath(bookId: string, sourcePath: string) {
  return invokeNativeCommand(null, 'stageImportPath', {
    bookId,
    sourcePath
  }, {
    feature: 'native-import'
  });
}

export async function stageNativeImportUri(bookId: string, uri: string, name = '') {
  const args: Record<string, unknown> = { bookId, uri };
  if (name) args.name = name;
  return invokeNativeCommand('android-archive', 'stageImportUri', args, {
    feature: 'native-import'
  });
}
