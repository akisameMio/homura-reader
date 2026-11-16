/* ============================================================================
   HOMURA · WebDAV 远程书籍
   ----------------------------------------------------------------------------
   目录只读；压缩包与 PDF 用严格 HTTP Range 按需读取，不将原文件写入本地。
   凭据只存在当前客户端实例中，不进入书籍元数据或阅读进度。
   ========================================================================== */

import { canUseNativeBridge, invokeNativeCommand, NativeBridgeError, NativeErrorCode } from './nativeRuntime.ts';
import { WebDavClient, WebDavError, normalizeWebDavUrl, type WebDavConfig } from './webdav.ts';

export interface DavEntry {
  href: string;
  name: string;
  directory: boolean;
  size: number | null;
  etag: string | null;
}
export interface RangeSource {
  size: number;
  readonly closed?: boolean;
  read(start: number, end: number): Promise<Uint8Array>;
}
const MAX_RESPONSE = 8 * 1024 * 1024;
const PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>';

function invalid() { return new WebDavError('INVALID_DATA', '远端目录或文件响应无效'); }

// 对解码后的段逐一验证，防止编码分隔符、反斜杠和目录穿越绕过根目录限制。
export function scopedDavUrl(root: string, href: string, base = root): string {
  const normalizedRoot = normalizeWebDavUrl(root);
  let url: URL;
  try { url = new URL(href, base); } catch { throw invalid(); }
  const rootUrl = new URL(normalizedRoot);
  if (url.origin !== rootUrl.origin || url.username || url.password || url.search || url.hash
    || !url.pathname.startsWith(rootUrl.pathname) || url.href.length > 4096) throw invalid();
  for (const part of url.pathname.split('/')) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw invalid(); }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) throw invalid();
  }
  return url.href;
}

export function parseDavDirectory(xml: string, root: string, directory: string): DavEntry[] {
  if (new TextEncoder().encode(xml).length > MAX_RESPONSE || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.namespaceURI !== 'DAV:' || doc.documentElement.localName !== 'multistatus') throw invalid();
  const children = (el: Element, name: string) => Array.from(el.children).filter(child => child.namespaceURI === 'DAV:' && child.localName === name);
  const text = (el: Element, name: string) => children(el, name)[0]?.textContent?.trim() || '';
  const current = scopedDavUrl(root, directory);
  const currentUrl = new URL(current);
  const responses = children(doc.documentElement, 'response');
  if (responses.length > 20_001) throw new WebDavError('LIMIT_EXCEEDED', '远端目录条目过多');
  const entries = new Map<string, DavEntry>();
  for (const response of responses) {
    const raw = text(response, 'href');
    if (!raw) continue;
    let href: string;
    try { href = scopedDavUrl(root, raw, current); } catch { continue; }
    const url = new URL(href);
    if (url.pathname.replace(/\/$/, '') === currentUrl.pathname.replace(/\/$/, '')) continue;
    const suffix = url.pathname.slice(currentUrl.pathname.length).replace(/\/$/, '');
    if (!url.pathname.startsWith(currentUrl.pathname) || !suffix || suffix.includes('/')) continue;
    const props = children(response, 'propstat').filter(stat => /^HTTP\/\S+ 2\d\d(?:\s|$)/.test(text(stat, 'status'))).flatMap(stat => children(stat, 'prop'));
    const resource = props.flatMap(prop => children(prop, 'resourcetype'));
    if (!resource.length) continue;
    const directory = resource.some(type => children(type, 'collection').length > 0);
    if (directory && !href.endsWith('/')) href += '/';
    const name = decodeURIComponent(suffix);
    if (name.startsWith('.') || name === '__MACOSX') continue;
    if (!directory && !/\.(epub|cbz|zip|pdf|txt|md|mobi|prc|azw)$/i.test(name)) continue;
    const rawSize = props.map(prop => text(prop, 'getcontentlength')).find(Boolean) || '';
    const size = /^\d+$/.test(rawSize) && Number.isSafeInteger(Number(rawSize)) ? Number(rawSize) : null;
    entries.set(href, { href, name, directory, size, etag: props.map(prop => text(prop, 'getetag')).find(Boolean) || null });
  }
  return [...entries.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

interface ReadResponse {
  status: number;
  body: Uint8Array;
  contentRange: string | null;
  etag: string | null;
  lastModified: string | null;
}

export class WebDavBooksClient {
  readonly root: string;
  private config: WebDavConfig;
  private controller = new AbortController();

  constructor(config: WebDavConfig) {
    // 复用同步客户端的账号、密码和 HTTPS 校验。
    new WebDavClient(config);
    this.root = normalizeWebDavUrl(config.url);
    this.config = { ...config, url: this.root };
  }

  close() { this.controller.abort(); this.config.password = ''; }

  private async request(href: string, method: 'PROPFIND' | 'GET', range: string | null = null, validator: string | null = null, modified: string | null = null): Promise<ReadResponse> {
    if (this.controller.signal.aborted) throw new WebDavError('CANCELLED', '远程读取已取消');
    const url = scopedDavUrl(this.root, href);
    try {
      let result: ReadResponse;
      if (canUseNativeBridge()) {
        const response = await invokeNativeCommand(null, 'webdav_read', {
          root: this.root, url, username: this.config.username, password: this.config.password,
          method, range, validator, modified
        }) as { status: number; body: string; contentRange: string | null; etag: string | null; lastModified: string | null };
        const binary = atob(response.body);
        result = { ...response, body: Uint8Array.from(binary, char => char.charCodeAt(0)) };
      } else {
        const controller = new AbortController();
        const abort = () => controller.abort();
        this.controller.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 30_000);
        try {
          const headers: Record<string, string> = {};
          if (this.config.username || this.config.password) {
            const bytes = new TextEncoder().encode(`${this.config.username}:${this.config.password}`);
            headers.Authorization = `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`;
          }
          if (method === 'PROPFIND') { headers.Depth = '1'; headers['Content-Type'] = 'application/xml; charset=utf-8'; }
          if (range) headers.Range = range;
          if (validator) headers['If-Match'] = validator;
          else if (modified) headers['If-Unmodified-Since'] = modified;
          const response = await fetch(url, { method, headers, body: method === 'PROPFIND' ? PROPFIND : null,
            signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
          // Range 不可用时立即停止，绝不悄悄接收整本书。
          if (range && response.status === 200) { await response.body?.cancel(); throw new WebDavError('UNSUPPORTED', '服务器不支持按需读取（HTTP Range）'); }
          if (Number(response.headers.get('content-length')) > MAX_RESPONSE) { await response.body?.cancel(); throw new WebDavError('LIMIT_EXCEEDED', '单次远程读取超过 8 MiB 上限'); }
          const chunks: Uint8Array[] = [];
          let length = 0;
          const reader = response.body?.getReader();
          if (reader) try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > MAX_RESPONSE) { await reader.cancel(); throw new WebDavError('LIMIT_EXCEEDED', '单次远程读取超过 8 MiB 上限'); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
          const body = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
          result = { status: response.status, body, contentRange: response.headers.get('content-range'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
        } finally {
          clearTimeout(timer);
          this.controller.signal.removeEventListener('abort', abort);
        }
      }
      if (this.controller.signal.aborted) throw new WebDavError('CANCELLED', '远程读取已取消');
      if (result.status === 401 || result.status === 403) throw new WebDavError('AUTH', 'WebDAV 认证失败或没有访问权限');
      if (result.status === 412) throw new WebDavError('CHANGED', '远端书籍已变化，请重新打开');
      if (range && result.status === 200) throw new WebDavError('UNSUPPORTED', '服务器不支持按需读取（HTTP Range）');
      if (result.status < 200 || result.status >= 300) throw new WebDavError('HTTP', '远端读取失败，请检查文件是否存在及访问权限');
      return result;
    } catch (error) {
      if (error instanceof WebDavError) throw error;
      if (error instanceof NativeBridgeError && error.code === NativeErrorCode.LIMIT_EXCEEDED) {
        throw new WebDavError('LIMIT_EXCEEDED', '单次远程读取超过 8 MiB 上限');
      }
      if (this.controller.signal.aborted) throw new WebDavError('CANCELLED', '远程读取已取消');
      throw new WebDavError('NETWORK', '无法读取 WebDAV，请检查网络、地址和跨域配置');
    }
  }

  async list(directory = this.root): Promise<DavEntry[]> {
    const url = scopedDavUrl(this.root, directory);
    if (!url.endsWith('/')) throw invalid();
    const response = await this.request(url, 'PROPFIND');
    if (response.status !== 207) throw invalid();
    return parseDavDirectory(new TextDecoder('utf-8', { fatal: true }).decode(response.body), this.root, url);
  }

  async open(entry: DavEntry): Promise<RangeSource> {
    if (entry.directory) throw invalid();
    const probe = await this.request(entry.href, 'GET', 'bytes=0-0');
    const match = probe.contentRange?.match(/^bytes 0-0\/(\d+)$/);
    const size = match ? Number(match[1]) : 0;
    if (probe.status !== 206 || !Number.isSafeInteger(size) || size < 1 || size > 16 * 1024 ** 3 || probe.body.length !== 1) throw invalid();
    const etag = probe.etag && /^"[^"\r\n]*"$/.test(probe.etag) ? probe.etag : null;
    const modified = probe.lastModified && Number.isFinite(Date.parse(probe.lastModified)) ? probe.lastModified : null;
    const signal = this.controller.signal;
    return {
      size,
      get closed() { return signal.aborted; },
      read: async (start, end) => {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > size || end - start > MAX_RESPONSE) throw invalid();
        const response = await this.request(entry.href, 'GET', `bytes=${start}-${end - 1}`, etag, modified);
        if (response.status !== 206 || response.contentRange !== `bytes ${start}-${end - 1}/${size}` || response.body.length !== end - start
          || (etag && response.etag && response.etag !== etag)) throw new WebDavError('CHANGED', '远端书籍已变化，请重新打开');
        return response.body;
      }
    };
  }
}
