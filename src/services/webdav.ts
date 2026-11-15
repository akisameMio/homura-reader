/* ============================================================================
   HOMURA · WebDAV 同步传输
   ----------------------------------------------------------------------------
   只读写用户指定目录中的同步文档；已有文件必须提供强 ETag，再以条件写入
   防止并发覆盖。Tauri 走原生网络，不在原生失败后静默切换浏览器通道。
   ========================================================================== */

import { canUseNativeBridge, invokeNativeCommand, NativeBridgeError, NativeErrorCode } from './nativeRuntime.ts';

export interface WebDavConfig { url: string; username: string; password: string; }

export class WebDavError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WebDavError';
    this.code = code;
  }
}

const DOCUMENT_NAME = 'homura-sync-v1.json';
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

interface DavResponse { status: number; etag: string | null; body: string; }

function strongEtag(value: string | null): value is string {
  return value !== null && value.length <= 1024 && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

export function normalizeWebDavUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch {
    throw new WebDavError('INVALID_CONFIG', '请输入完整的 WebDAV 文件夹地址');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.href.length > 4096 || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash) {
    throw new WebDavError('INVALID_CONFIG', 'WebDAV 地址须使用 HTTPS，且不包含账号、查询参数或片段');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function checkStatus(status: number) {
  if (status === 401 || status === 403) throw new WebDavError('AUTH', 'WebDAV 认证失败或没有访问权限');
  if (status === 409 || status === 412) throw new WebDavError('CONFLICT', '远端数据已变化，请重新合并后同步');
  if (status >= 300 && status < 400) throw new WebDavError('REDIRECT', 'WebDAV 地址发生重定向，请填写最终文件夹地址');
  if (status < 200 || status >= 300) throw new WebDavError('HTTP', `WebDAV 请求失败（HTTP ${status}）`);
}

function basicAuthorization(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

async function boundedResponseText(response: Response) {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_BYTES) {
    await response.body?.cancel();
    throw new WebDavError('LIMIT_EXCEEDED', '远端同步文档超过 8 MiB 上限');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new WebDavError('LIMIT_EXCEEDED', '远端同步文档超过 8 MiB 上限');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export class WebDavClient {
  private config: WebDavConfig;
  private endpoint: string;

  constructor(config: WebDavConfig) {
    const url = normalizeWebDavUrl(config.url);
    if (config.username.length > 512 || config.password.length > 8192
      || /[:\r\n\0]/.test(config.username) || /[\r\n\0]/.test(config.password)) {
      throw new WebDavError('INVALID_CONFIG', 'WebDAV 账号或密码格式无效');
    }
    this.config = { ...config, url };
    this.endpoint = new URL(DOCUMENT_NAME, url).href;
  }

  private async request(method: 'GET' | 'PUT', body: string | null = null, etag: string | null = null): Promise<DavResponse> {
    if (body !== null && new TextEncoder().encode(body).byteLength > MAX_BYTES) {
      throw new WebDavError('LIMIT_EXCEEDED', '同步文档超过 8 MiB 上限');
    }
    try {
      if (canUseNativeBridge()) {
        return await invokeNativeCommand(null, 'sync_webdav_request', {
          url: this.endpoint, username: this.config.username, password: this.config.password,
          method, body, etag
        }) as DavResponse;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.config.username || this.config.password) headers.Authorization = basicAuthorization(this.config.username, this.config.password);
        if (method === 'PUT') {
          headers['Content-Type'] = 'application/json; charset=utf-8';
          headers[etag === null ? 'If-None-Match' : 'If-Match'] = etag ?? '*';
        }
        const response = await fetch(this.endpoint, {
          method, headers, body, signal: controller.signal,
          redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
        });
        return { status: response.status, etag: response.headers.get('etag'), body: await boundedResponseText(response) };
      } finally { clearTimeout(timer); }
    } catch (error) {
      if (error instanceof WebDavError) throw error;
      if (error instanceof NativeBridgeError && error.code === NativeErrorCode.LIMIT_EXCEEDED) {
        throw new WebDavError('LIMIT_EXCEEDED', '远端同步文档超过 8 MiB 上限');
      }
      throw new WebDavError('NETWORK', '无法连接 WebDAV，请检查网络、地址和浏览器跨域配置');
    }
  }

  async read(): Promise<{ document: unknown | null; etag: string | null }> {
    const response = await this.request('GET');
    if (response.status === 404) return { document: null, etag: null };
    checkStatus(response.status);
    if (!strongEtag(response.etag)) throw new WebDavError('UNSUPPORTED', 'WebDAV 未提供强 ETag，无法安全同步；浏览器端请检查 ETag 跨域暴露配置');
    try {
      const document: unknown = JSON.parse(response.body);
      // null 只表示 HTTP 404，不能把已存在的损坏文档当成首次同步。
      if (document === null) throw new Error();
      return { document, etag: response.etag };
    } catch {
      throw new WebDavError('INVALID_DATA', '远端同步文档不是有效的 JSON，已停止同步');
    }
  }

  async write(document: unknown, etag: string | null): Promise<void> {
    if (etag !== null && !strongEtag(etag)) throw new WebDavError('INVALID_DATA', '同步文档版本标识无效');
    let body: string;
    try {
      body = JSON.stringify(document);
      if (typeof body !== 'string') throw new Error();
    } catch { throw new WebDavError('INVALID_DATA', '同步文档无法序列化'); }
    checkStatus((await this.request('PUT', body, etag)).status);
  }

  async testConnection(): Promise<void> { await this.read(); }
}
