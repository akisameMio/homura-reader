import type { BookSource } from '../types.ts';
import { nativeImportMime } from './nativeImport.ts';
import { invokeNativeCommand, NativeBridgeError, NativeErrorCode } from './nativeRuntime.ts';
import { isAndroid } from './platform.ts';
import type { RangeSource } from './webdavBooks.ts';

const CHUNK_BYTES = 1024 * 1024;
const MAX_BLOB_BYTES = 128 * CHUNK_BYTES;
const FEATURE = { feature: 'native-reference' };
const BOOK_EXTENSIONS = /\.(epub|cbz|zip|pdf|mobi|prc|azw|txt|md)$/i;

export type NativeReferenceFile = File & {
  nativePath: string;
  nativeReference: string;
  customRelativePath?: string;
};

interface ReferenceInfo {
  size: number;
  modifiedMs?: number;
  lastModified?: number;
  changed?: boolean;
  stale?: boolean;
  seekable?: boolean;
}

function unsupported(message: string) {
  return new NativeBridgeError(NativeErrorCode.UNSUPPORTED, message, FEATURE);
}

export async function pickNativeReferenceFiles(multiple = true): Promise<NativeReferenceFile[]> {
  const result = isAndroid
    ? await invokeNativeCommand('android-archive', 'pickImportUris', { multiple, persistReadAccess: true }, FEATURE)
    : await invokeNativeCommand(null, 'pickNativeReference', { multiple }, FEATURE);
  const entries = isAndroid ? result?.references || [] : (Array.isArray(result) ? result : result ? [result] : []);
  const files: NativeReferenceFile[] = [];
  try {
    for (const entry of entries) {
      const reference = isAndroid ? entry.referenceToken : entry.token;
      const name = isAndroid ? entry.name : entry.fileName;
      if (!reference || !BOOK_EXTENSIONS.test(name || '')) {
        throw unsupported('所选来源无法作为书籍引用保存');
      }
      const info = await inspectNativeReference(reference);
      files.push({
        name,
        size: info.size,
        lastModified: info.modifiedMs ?? info.lastModified ?? 0,
        type: nativeImportMime(name),
        nativePath: `homura-reference:${reference}`,
        nativeReference: reference
      } as NativeReferenceFile);
    }
  } catch (error) {
    await releaseRejectedSelection(entries);
    throw error;
  }
  return files;
}

export async function pickNativeReferenceFolder() {
  const result = isAndroid
    ? await invokeNativeCommand('android-archive', 'pickImportFolder', { persistReadAccess: true }, FEATURE)
    : await invokeNativeCommand(null, 'pickNativeReferenceFolder', {}, FEATURE);
  if (!result) return null;
  const files: NativeReferenceFile[] = [];
  for (const entry of result.files || []) {
    const reference = isAndroid ? entry.referenceToken : entry.token;
    const name = isAndroid ? entry.name : entry.fileName;
    if (!reference || !name || !entry.relativePath) {
      await releaseRejectedSelection(result.files);
      throw unsupported('文件夹中部分文件无法原位置入库');
    }
    files.push({
      name,
      size: Number(entry.size) || 0,
      lastModified: Number(entry.modifiedMs ?? entry.lastModified) || 0,
      type: nativeImportMime(name),
      customRelativePath: isAndroid ? entry.relativePath : `${result.folderName}/${entry.relativePath}`,
      nativePath: `homura-reference:${reference}`,
      nativeReference: reference
    } as NativeReferenceFile);
  }
  return { files, key: typeof result.folderKey === 'string' ? result.folderKey : '' };
}

async function releaseRejectedSelection(entries: Array<{ referenceToken?: string; token?: string }>) {
  const tokens = entries.flatMap(entry => {
    const token = isAndroid ? entry.referenceToken : entry.token;
    return token ? [token] : [];
  });
  await releaseNativeReferences(tokens).catch(error => console.warn('[HOMURA] 释放未使用的导入授权失败', error));
}

async function inspectNativeReference(reference: string): Promise<ReferenceInfo> {
  const info = (isAndroid
    ? await invokeNativeCommand('android-archive', 'resolveReference', { referenceToken: reference }, FEATURE)
    : await invokeNativeCommand(null, 'inspectNativeReference', { token: reference }, FEATURE)) as ReferenceInfo;
  if (info.changed || info.stale || info.seekable === false || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw unsupported('原文件已变更或文件来源不支持随机读取');
  }
  return info;
}

export async function openNativeReferenceSource(reference: string, expected?: BookSource): Promise<RangeSource> {
  const info = await inspectNativeReference(reference);
  const lastModified = info.modifiedMs ?? info.lastModified;
  if ((expected?.size && expected.size !== info.size)
    || (expected?.lastModified && lastModified && lastModified !== expected.lastModified)) {
    throw unsupported('原文件已变更，请重新定位');
  }
  return {
    size: info.size,
    async read(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > info.size) {
        throw unsupported('引用读取范围无效');
      }
      const bytes = new Uint8Array(end - start);
      for (let offset = start; offset < end; offset += CHUNK_BYTES) {
        const length = Math.min(CHUNK_BYTES, end - offset);
        const response = isAndroid
          ? await invokeNativeCommand('android-archive', 'readReference', { referenceToken: reference, offset, length }, FEATURE)
          : await invokeNativeCommand(null, 'readNativeReferenceRange', { token: reference, offset, length }, FEATURE);
        const chunk = isAndroid
          ? Uint8Array.from(atob(response.data), char => char.charCodeAt(0))
          : new Uint8Array(response);
        if (chunk.byteLength !== length) throw unsupported('原文件读取不完整');
        bytes.set(chunk, offset - start);
      }
      return bytes;
    }
  };
}

export async function readNativeReferenceFile(reference: string, expected: BookSource) {
  const source = await openNativeReferenceSource(reference, expected);
  if (source.size > MAX_BLOB_BYTES) throw unsupported('此格式的引用文件过大，请复制到 HOMURA');
  return new File([await source.read(0, source.size) as BlobPart], expected.name || 'source', {
    lastModified: expected.lastModified,
    type: nativeImportMime(expected.name)
  });
}

export async function fingerprintNativeReference(reference: string) {
  const response = isAndroid
    ? await invokeNativeCommand('android-archive', 'hashReference', { referenceToken: reference }, FEATURE)
    : await invokeNativeCommand(null, 'hashNativeReference', { token: reference }, FEATURE);
  if (response?.stale || typeof response?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(response.sha256)) {
    throw unsupported('无法校验原文件内容');
  }
  return `sha256:${response.sha256}`;
}

export async function releaseNativeReferences(tokens: string[]) {
  if (!tokens.length) return;
  return isAndroid
    ? invokeNativeCommand('android-archive', 'releaseReference', { referenceTokens: tokens }, FEATURE)
    : invokeNativeCommand(null, 'forgetNativeReference', { tokens }, FEATURE);
}

export function nativeReferencesOf(source: BookSource | null | undefined): string[] {
  if (!source) return [];
  if (source.entries) return source.entries.flatMap(nativeReferencesOf);
  return source.nativeReference ? [source.nativeReference] : [];
}
