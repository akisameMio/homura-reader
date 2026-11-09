/* ============================================================================
   HOMURA · 原生元数据后端
   ----------------------------------------------------------------------------
   桌面与 Android 的 Tauri 包把书目、书库与阅读进度镜像到 SQLite；封面仍以
   Blob 形式随记录一起写入。IndexedDB 始终是完整兜底，这里只负责数据形状
   转换与原生命令调用，不决定何时回退。
   ========================================================================== */

import {
  NativeBridgeError,
  NativeErrorCode,
  bytesToBase64,
  canUseNativeBridge,
  invokeNativeCommand,
  isNativeFeatureAvailable
} from './nativeRuntime.ts';
import type { Book, Collection } from '../types.ts';

const FEATURE = 'metadata';
const MAX_COVER_BYTES = 24 * 1024 * 1024;

function invalidResponse(message: string) {
  return new NativeBridgeError(NativeErrorCode.INVALID_DATA, message, { feature: FEATURE });
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(`原生元数据缺少 ${label}`);
  return value;
}

export function canUseNativeMetadata() {
  return canUseNativeBridge() && isNativeFeatureAvailable(FEATURE);
}

async function blobToBase64(blob: Blob | null | undefined) {
  if (!blob || typeof blob.arrayBuffer !== 'function' || typeof blob.size !== 'number') return null;
  if (blob.size > MAX_COVER_BYTES) {
    throw new NativeBridgeError(
      NativeErrorCode.LIMIT_EXCEEDED,
      '封面数据过大，未写入 SQLite',
      { feature: FEATURE, command: 'metadata' }
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const encoded = bytesToBase64(bytes);
  if (encoded === null) throw invalidResponse('当前环境无法编码封面数据');
  return encoded;
}

function base64ToBlob(value: unknown, mime: unknown) {
  if (typeof value !== 'string' || !value) return null;
  let binary;
  try {
    binary = atob(value);
  } catch (err) {
    throw invalidResponse('SQLite 中的封面数据不是有效 Base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: typeof mime === 'string' ? mime : '' });
}

function normalizeBook(record: unknown) {
  if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') throw invalidResponse('SQLite 中存在无效书目');
  const rec = record as Record<string, unknown>;
  return {
    id: rec.id,
    type: rec.type || 'novel',
    format: rec.format || null,
    title: rec.title || '',
    favorite: !!rec.favorite,
    pageCount: Number(rec.pageCount) || 0,
    addedAt: Number(rec.addedAt) || 0,
    coverBlob: base64ToBlob(rec.coverBase64, rec.coverMime),
    customCoverBlob: base64ToBlob(rec.customCoverBase64, rec.customCoverMime)
  };
}

function normalizeCollection(record: unknown) {
  if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') throw invalidResponse('SQLite 中存在无效书库');
  const rec = record as Record<string, unknown>;
  return {
    id: rec.id,
    title: String(rec.title || ''),
    createdAt: Number(rec.createdAt) || 0,
    bookIds: Array.isArray(rec.bookIds) ? rec.bookIds.filter((id): id is string => typeof id === 'string') : []
  };
}

async function serializeBook(book: Book): Promise<Record<string, unknown>> {
  return {
    id: String(book.id || ''),
    type: String(book.type || 'novel'),
    format: book.format || null,
    title: String(book.title || ''),
    favorite: !!book.favorite,
    pageCount: Number(book.pageCount) || 0,
    addedAt: Number(book.addedAt) || 0,
    coverBase64: await blobToBase64(book.coverBlob instanceof Blob ? book.coverBlob : null),
    coverMime: book.coverBlob instanceof Blob ? book.coverBlob.type || null : null,
    customCoverBase64: await blobToBase64(book.customCoverBlob instanceof Blob ? book.customCoverBlob : null),
    customCoverMime: book.customCoverBlob instanceof Blob ? book.customCoverBlob.type || null : null
  };
}

async function serializeSnapshot(snapshot: { books?: Book[]; collections?: Collection[]; progress?: unknown[] }) {
  const books: Promise<Record<string, unknown>>[] = [];
  for (const book of snapshot.books || []) {
    books.push(serializeBook(book));
  }
  return {
    books: await Promise.all(books),
    collections: (snapshot.collections || []).map((item: Collection) => ({
      id: item.id,
      title: item.title,
      createdAt: Number(item.createdAt) || 0,
      bookIds: Array.isArray(item.bookIds) ? item.bookIds : []
    })),
    progress: snapshot.progress || []
  };
}

export async function loadNativeMetadata() {
  const result = await invokeNativeCommand(null, 'metadata_load', {}, { feature: FEATURE });
  if (!result || typeof result !== 'object') throw invalidResponse('原生元数据响应无效');
  return {
    initialized: !!result.initialized,
    books: requireArray(result.books, '书目').map(normalizeBook),
    collections: requireArray(result.collections, '书库').map(normalizeCollection),
    progress: requireArray(result.progress, '阅读进度')
  };
}

export async function replaceNativeMetadata(snapshot: { books?: Book[]; collections?: Collection[]; progress?: unknown[] }) {
  const payload = await serializeSnapshot(snapshot);
  await invokeNativeCommand(null, 'metadata_replace_all', { snapshot: payload }, { feature: FEATURE });
}

export async function upsertNativeBook(book: Book) {
  await invokeNativeCommand(
    null,
    'metadata_upsert_book',
    { book: await serializeBook(book) },
    { feature: FEATURE }
  );
}

export async function upsertNativeBooks(books: Book[] | null | undefined) {
  if (!Array.isArray(books) || books.length === 0) return;
  const payload: Promise<Record<string, unknown>>[] = [];
  for (const book of books) {
    payload.push(serializeBook(book));
  }
  await invokeNativeCommand(
    null,
    'metadata_upsert_books',
    { books: await Promise.all(payload) },
    { feature: FEATURE }
  );
}

export async function saveNativeCollections(collections: Collection[] | null | undefined) {
  await invokeNativeCommand(
    null,
    'metadata_save_collections',
    {
      collections: (collections || []).map((item: Collection) => ({
        id: item.id,
        title: item.title,
        createdAt: Number(item.createdAt) || 0,
        bookIds: Array.isArray(item.bookIds) ? item.bookIds : []
      }))
    },
    { feature: FEATURE }
  );
}

export async function saveNativeProgress(record: unknown) {
  await invokeNativeCommand(null, 'metadata_save_progress', { record }, { feature: FEATURE });
}

export async function deleteNativeBook(bookId: string) {
  await invokeNativeCommand(null, 'metadata_delete_book', { bookId }, { feature: FEATURE });
}

export async function clearNativeProgress() {
  await invokeNativeCommand(null, 'metadata_clear_progress', {}, { feature: FEATURE });
}

export async function clearNativeMetadata() {
  await invokeNativeCommand(null, 'metadata_clear_all', {}, { feature: FEATURE });
}
