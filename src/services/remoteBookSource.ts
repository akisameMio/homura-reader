/* ============================================================================
   HOMURA · 云端书籍引用
   ----------------------------------------------------------------------------
   只持久化远端定位信息；密码由当前 WebDAV 会话提供，永不进入书籍来源。
   ========================================================================== */
import type { Book, BookSource } from '../types.ts';
import { normalizeWebDavUrl, WebDavClient, type WebDavConfig } from './webdav.ts';
import { scopedDavUrl, type DavEntry } from './webdavBooks.ts';

export interface RemoteBookSource extends BookSource {
  kind: 'webdav';
  name: string;
  root: string;
  username: string;
  href: string;
  size?: number;
}
let credentialsProvider: (() => WebDavConfig | Promise<WebDavConfig>) | null = null;

export function setRemoteBookCredentialsProvider(provider: () => WebDavConfig | Promise<WebDavConfig>) {
  credentialsProvider = provider;
}

export function makeRemoteBookSource(config: WebDavConfig, entry: DavEntry): RemoteBookSource {
  new WebDavClient(config);
  const root = normalizeWebDavUrl(config.url);
  const href = scopedDavUrl(root, entry.href);
  if (entry.directory || !/\.(epub|cbz|zip|pdf|txt|md)$/i.test(entry.name) || href.endsWith('/')
    || !entry.name || /[\\/\u0000-\u001f]/.test(entry.name)) throw new Error('云端书籍引用无效');
  return {
    kind: 'webdav', root, username: config.username, href, name: entry.name,
    ...(Number.isSafeInteger(entry.size) && (entry.size as number) >= 0 ? { size: entry.size as number } : {})
  };
}

// 按字段重建，调用方即使传入含密码、Blob 或本机路径的对象也不会写盘。
export function normalizeRemoteBookSource(source: BookSource): RemoteBookSource {
  if (source.kind !== 'webdav' || typeof source.root !== 'string' || typeof source.username !== 'string'
    || typeof source.href !== 'string' || typeof source.name !== 'string') throw new Error('云端书籍引用无效');
  return makeRemoteBookSource({ url: source.root, username: source.username, password: '' }, {
    href: source.href, name: source.name, directory: false, size: source.size ?? null, etag: null
  });
}

export async function remoteBookId(source: Pick<RemoteBookSource, 'root' | 'username' | 'href'>): Promise<string> {
  const identity = new TextEncoder().encode(JSON.stringify([source.root, source.username, source.href]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', identity));
  return 'webdav_' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function resolveRemoteBookConfig(source: RemoteBookSource): Promise<WebDavConfig> {
  if (!credentialsProvider) throw new Error('请在 WebDAV 设置中连接此云端书籍的服务器');
  const config = await credentialsProvider();
  if (normalizeWebDavUrl(config.url) !== source.root || config.username !== source.username) {
    throw new Error('请在 WebDAV 设置中连接此云端书籍的服务器');
  }
  return { url: source.root, username: source.username, password: config.password };
}

export function resetRemoteBookRuntime(book: Book) {
  if (!book.remoteShelf) return;
  for (const url of (book.resourceUrls || []) as string[]) {
    if (url.startsWith('blob:') && url !== book.cover) URL.revokeObjectURL(url);
  }
  book.pageItems = null; book.chapters = null; book.zipContent = null; book.pdfDoc = null;
  book.outline = null;
  book.epubImageUrls = null; book.epubImageDecodes = null; book.resourceUrls = null;
  book.restored = true; book.remoteDispose = null; book.remoteReadError = null;
}
