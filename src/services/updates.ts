/* ============================================================================
   HOMURA · GitHub Releases
   ----------------------------------------------------------------------------
   更新检查只读取公开的稳定版Release。网络请求与Markdown清洗留在本模块，
   组件只消费结构化版本、说明和当前平台安装包，避免把不可信发布内容交给
   v-html或被误当作外链。
   ========================================================================== */

import { isAndroid } from './platform.ts';
import type { Release } from '../types.ts';

export const REPOSITORY_URL = 'https://github.com/Leon-Ning-san/HomuraReader';
export const RELEASES_PAGE_URL = `${REPOSITORY_URL}/releases`;
export const LICENSE_PAGE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;

const RELEASES_API_URL = 'https://api.github.com/repos/Leon-Ning-san/HomuraReader/releases?per_page=10';
const RELEASES_CACHE_KEY = 'homura_releases_cache_v1';
const REQUEST_TIMEOUT = 12000;
const CACHE_TTL = 5 * 60 * 1000;
const RATE_LIMIT_RETRY_DELAY = 60 * 1000;

/** 清洗后的发布说明分组 */
interface ReleaseNotesGroup {
  title: string;
  items: string[];
}

/** 清洗后的发布说明（不含任何 HTML，组件可直接渲染） */
interface ReleaseNotes {
  intro: string;
  groups: ReleaseNotesGroup[];
  itemCount: number;
}

/** 归一化后的安装包；url 供内部下载使用，browser_download_url 满足公开 Release 契约 */
type NormalizedAsset = {
  name: string;
  url: string;
  browser_download_url: string;
  size: number;
  downloadCount: number;
  [key: string]: unknown;
};

/** 归一化后的一条稳定版发布记录（结构化超集，可赋给公开 Release） */
export type NormalizedRelease = {
  id: unknown;
  version: string;
  tag: string;
  title: string;
  publishedAt: string;
  dateLabel: string;
  htmlUrl: string;
  notes: ReleaseNotes;
  assets: NormalizedAsset[];
  [key: string]: unknown;
};

/** 解析出的语义化版本号 */
interface ParsedVersion {
  core: number[];
  prerelease: string;
}

let cachedReleases: NormalizedRelease[] = [];
let cachedAt = 0;
let cachedEtag = '';
let pendingRequest: Promise<NormalizedRelease[]> | null = null;
let rateLimitUntil = 0;

const GROUP_LABELS: [RegExp, string][] = [
  [/新功能|新增|features?/i, '新增'],
  [/问题修复|修复|bug|fixes?/i, '修复'],
  [/改进|优化|improve/i, '改进'],
  [/重构|refactor/i, '重构'],
  [/文档|docs?/i, '文档'],
  [/构建|ci|build/i, '构建'],
  [/其他|chore|other/i, '其他']
];

function cleanInlineMarkdown(value: unknown) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanListItem(value: unknown) {
  return cleanInlineMarkdown(value)
    .replace(/\s*[（(]\s*[0-9a-f]{7,40}\s*[）)]\s*$/i, '')
    .trim();
}

function cleanHeading(value: unknown) {
  return cleanInlineMarkdown(value)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
}

function normalizeGroupTitle(value: unknown) {
  const title = cleanHeading(value);
  const match = GROUP_LABELS.find(([pattern]) => pattern.test(title));
  return match ? match[1] : title || '更新';
}

export function parseReleaseNotes(body: unknown): ReleaseNotes {
  const markdown = String(body || '').replace(/\r\n?/g, '\n');
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => /^##\s+.*更新日志/.test(line));

  if (start < 0) {
    return { intro: '', groups: [], itemCount: 0 };
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const groups: { title: string; items: string[] }[] = [];
  const introLines: string[] = [];
  let currentGroup: { title: string; items: string[] } | null = null;

  for (const rawLine of lines.slice(start + 1, end)) {
    const line = rawLine.trim();
    if (!line || /^---+$/.test(line)) continue;

    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      const proposed = {
        title: normalizeGroupTitle(heading[1]),
        items: [] as string[]
      };
      const existing = groups.find(group => group.title === proposed.title);
      if (existing) currentGroup = existing;
      else {
        groups.push(proposed);
        currentGroup = proposed;
      }
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      const item = cleanListItem(bullet[1]);
      if (!item) continue;
      if (currentGroup) {
        currentGroup.items.push(item);
      } else {
        let fallback = groups.find(group => group.title === '更新');
        if (!fallback) {
          fallback = { title: '更新', items: [] };
          groups.push(fallback);
        }
        fallback.items.push(item);
      }
      continue;
    }

    if (!currentGroup && !/完整对比/.test(line)) {
      const text = cleanListItem(line);
      if (text) introLines.push(text);
    }
  }

  const visibleGroups = groups.filter(group => group.items.length > 0);
  const itemCount = visibleGroups.reduce((total, group) => total + group.items.length, 0);
  return {
    intro: cleanInlineMarkdown(introLines.join(' ')),
    groups: visibleGroups,
    itemCount
  };
}

function parseVersion(value: unknown): ParsedVersion | null {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || ''
  };
}

export function normalizeVersion(value: unknown) {
  const parsed = parseVersion(value);
  if (!parsed) return String(value || '').trim().replace(/^v/i, '');
  return parsed.core.join('.') + (parsed.prerelease ? `-${parsed.prerelease}` : '');
}

export function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }

  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

export function isVersionNewer(candidate: unknown, current: unknown) {
  return compareVersions(String(candidate ?? ''), String(current ?? '')) > 0;
}

export function formatReleaseDate(value: unknown) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '日期未知';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAllowedReleaseUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    const repositoryPath = '/Leon-Ning-san/HomuraReader';
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && (url.pathname === repositoryPath || url.pathname.startsWith(`${repositoryPath}/`));
  } catch (error) {
    return false;
  }
}

function normalizeAsset(asset: unknown): NormalizedAsset | null {
  const source = (asset || {}) as { name?: unknown; browser_download_url?: unknown; size?: unknown; download_count?: unknown };
  const name = String(source.name || '').trim();
  const url = typeof source.browser_download_url === 'string' ? source.browser_download_url : '';
  if (!name || !isAllowedReleaseUrl(url)) return null;
  return {
    name,
    url,
    browser_download_url: url,
    size: Number(source.size) || 0,
    downloadCount: Number(source.download_count) || 0
  };
}

/** GitHub Releases API 原始条目（未校验） */
interface RawRelease {
  id?: unknown;
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown[];
}

export function normalizeReleases(payload: unknown): NormalizedRelease[] {
  if (!Array.isArray(payload)) throw new Error('GitHub 返回了无法识别的发布数据。');

  const seen = new Set<string>();
  return (payload as RawRelease[])
    .filter((release): release is RawRelease => !!release && !release.draft && !release.prerelease)
    .map((release): NormalizedRelease | null => {
      const version = normalizeVersion(release.tag_name);
      if (!parseVersion(version) || seen.has(version)) return null;
      seen.add(version);
      return {
        id: release.id,
        version,
        tag: (typeof release.tag_name === 'string' && release.tag_name) || `v${version}`,
        title: cleanInlineMarkdown(release.name) || `HOMURA v${version}`,
        publishedAt: (release.published_at || release.created_at || '') as string,
        dateLabel: formatReleaseDate(release.published_at || release.created_at),
        htmlUrl: isAllowedReleaseUrl(release.html_url) && typeof release.html_url === 'string' ? release.html_url : RELEASES_PAGE_URL,
        notes: parseReleaseNotes(release.body),
        assets: (Array.isArray(release.assets) ? release.assets : []).map(normalizeAsset).filter((asset): asset is NormalizedAsset => asset !== null)
      };
    })
    .filter((release): release is NormalizedRelease => release !== null)
    .sort((left, right) => compareVersions(right.version, left.version));
}

export function detectUpdatePlatform() {
  if (isAndroid) return 'android';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const nav = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { userAgentData?: { platform?: string } })
    : null;
  const platform = nav ? nav.userAgentData?.platform || nav.platform || '' : '';
  const descriptor = `${platform} ${userAgent}`;

  if (/Win/i.test(descriptor)) return 'windows';
  if (/Mac|iPhone|iPad|iPod/i.test(descriptor)) return 'macos';
  if (/Linux|X11/i.test(descriptor)) return 'linux';
  return 'unknown';
}

function assetScore(asset: NormalizedAsset, platform: string) {
  const name = asset.name.toLowerCase();
  if (platform === 'android' && /\.apk$/.test(name)) {
    return /arm64/.test(name) ? 30 : 20;
  }
  if (platform === 'macos' && /\.dmg$/.test(name)) return 30;
  if (platform === 'windows') {
    if (/\.exe$/.test(name)) return /setup/.test(name) ? 32 : 30;
    if (/\.msi$/.test(name)) return 24;
  }
  if (platform === 'linux') {
    if (/\.deb$/.test(name)) return 32;
    if (/\.rpm$/.test(name)) return 30;
    if (/\.appimage$/.test(name)) return 24;
  }
  return 0;
}

function platformPackageCopy(asset: NormalizedAsset, platform: string) {
  if (platform === 'android') {
    return {
      label: 'Android · arm64 APK',
      note: '适用于当前 Android 设备'
    };
  }
  if (platform === 'macos') {
    return {
      label: 'macOS · Universal DMG',
      note: 'Apple Silicon 与 Intel 通用'
    };
  }
  if (platform === 'windows') {
    const label = /\.msi$/i.test(asset.name) ? 'Windows · MSI 安装包' : 'Windows · NSIS 安装包';
    return { label, note: asset.name };
  }
  if (platform === 'linux') {
    if (/\.deb$/i.test(asset.name)) return { label: 'Linux · DEB 安装包', note: 'Debian / Ubuntu 等发行版' };
    if (/\.rpm$/i.test(asset.name)) return { label: 'Linux · RPM 安装包', note: 'Fedora / openSUSE 等发行版' };
    return { label: 'Linux · AppImage', note: '无需安装，直接运行' };
  }
  return { label: 'GitHub Releases', note: '选择适合当前系统的安装包' };
}

export function selectReleaseAsset(release: Release | null | undefined, platform = detectUpdatePlatform()) {
  const assets: NormalizedAsset[] = release && Array.isArray(release.assets)
    ? (release.assets as NormalizedAsset[])
    : [];
  const selected = assets
    .map((asset) => ({ asset, score: assetScore(asset, platform) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.asset;

  if (!selected) {
    return {
      platform,
      label: 'GitHub Releases',
      note: '选择适合当前系统的安装包',
      url: (release && typeof release.htmlUrl === 'string' && release.htmlUrl) || RELEASES_PAGE_URL,
      asset: null
    };
  }

  return {
    platform,
    ...platformPackageCopy(selected, platform),
    url: selected.url,
    asset: selected
  };
}

function updateError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function getUpdateErrorMessage(error: unknown) {
  const detail = error as { name?: unknown; code?: unknown; message?: unknown } | null | undefined;
  if (detail && detail.name === 'AbortError') return '连接 GitHub 超时，请检查网络后重试。';
  if (detail && detail.code === 'RATE_LIMIT') return 'GitHub 暂时限制了更新查询，请稍后再试。';
  if (detail && detail.code === 'NO_RELEASES') return '目前没有可用的稳定版本记录。';
  if (detail && detail.code === 'HTTP_ERROR' && typeof detail.message === 'string') return detail.message;
  return '无法连接 GitHub，请检查网络后重试。';
}

async function checkRateLimit(response: Response) {
  if (response.status !== 403 && response.status !== 429) return;

  const remaining = response.headers.get('x-ratelimit-remaining');
  const retryAfter = response.headers.get('retry-after');
  if (response.status === 403 && remaining !== '0' && !retryAfter) {
    const body = await response.text();
    if (!/rate limit/i.test(body)) return;
  }

  const now = Date.now();
  const retryTime = retryAfter && /^\d+$/.test(retryAfter)
    ? now + Number(retryAfter) * 1000
    : Date.parse(retryAfter ?? '');
  const resetTime = remaining === '0'
    ? Number(response.headers.get('x-ratelimit-reset')) * 1000
    : 0;
  rateLimitUntil = Math.max(retryTime || 0, resetTime || 0);
  if (rateLimitUntil <= now || !Number.isFinite(rateLimitUntil)) {
    rateLimitUntil = now + RATE_LIMIT_RETRY_DELAY;
  }
  throw updateError('RATE_LIMIT', 'GitHub API rate limit reached');
}

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.__TAURI__;
  if (!bridge || !bridge.core || typeof bridge.core.invoke !== 'function') return null;
  return bridge.core.invoke as TauriInvoke;
}

interface PersistedReleasesCache {
  cachedAt: number;
  etag: string;
  releases: NormalizedRelease[];
}

function readPersistedCache(): PersistedReleasesCache | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RELEASES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedReleasesCache> | null;
    if (!parsed || !Array.isArray(parsed.releases) || parsed.releases.length === 0) return null;
    if (!Number.isFinite(parsed.cachedAt)) return null;
    return {
      cachedAt: Number(parsed.cachedAt),
      etag: typeof parsed.etag === 'string' ? parsed.etag : '',
      releases: parsed.releases
    };
  } catch {
    return null;
  }
}

function writePersistedCache(releases: NormalizedRelease[], etag: string, timestamp: number) {
  if (typeof localStorage === 'undefined' || releases.length === 0) return;
  try {
    localStorage.setItem(RELEASES_CACHE_KEY, JSON.stringify({
      cachedAt: timestamp,
      etag,
      releases
    }));
  } catch {
    // 忽略存储配额限制，保留内存缓存即可
  }
}

function hydrateMemoryCacheFromStorage() {
  if (cachedReleases.length > 0) return;
  const persisted = readPersistedCache();
  if (!persisted) return;
  cachedReleases = persisted.releases;
  cachedAt = persisted.cachedAt;
  cachedEtag = persisted.etag;
}

export function resetReleasesCache({ preserveStorage = false } = {}) {
  cachedReleases = [];
  cachedAt = 0;
  cachedEtag = '';
  rateLimitUntil = 0;
  if (!preserveStorage && typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(RELEASES_CACHE_KEY);
    } catch {
      // 忽略清理异常
    }
  }
}

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'amp') return '&';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return '\'';
    if (lower === 'nbsp') return ' ';
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function atomHtmlToMarkdown(rawContent: string) {
  // Atom <content type="html"> 把 HTML 实体编码了一层；先还原成 HTML 标签再转换成等价 Markdown 行。
  const html = decodeEntities(rawContent).replace(/\r\n?/g, '\n');
  const markdown = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${inner}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner}\n`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => `\n${inner}\n`)
    .replace(/<[^>]+>/g, '');
  return decodeEntities(markdown);
}

function readXmlTag(block: string, tagName: string) {
  const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractAtomLinkHref(entryXml: string) {
  const linkTags = entryXml.match(/<link\b[^>]*>/gi) || [];
  let fallbackHref = '';
  for (const tag of linkTags) {
    const hrefMatch = tag.match(/\bhref=(?:"([^"]+)"|'([^']+)')/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1] || hrefMatch[2] || '');
    if (/\brel=(?:"alternate"|'alternate')/i.test(tag)) return href;
    if (!fallbackHref) fallbackHref = href;
  }
  return fallbackHref;
}

export function parseAtomReleases(xml: string): NormalizedRelease[] {
  const entries = String(xml || '').match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  const seen = new Set<string>();

  return entries
    .map((entryXml): NormalizedRelease | null => {
      const id = decodeEntities(readXmlTag(entryXml, 'id'));
      const rawUrl = extractAtomLinkHref(entryXml);
      const htmlUrl = isAllowedReleaseUrl(rawUrl) ? rawUrl : RELEASES_PAGE_URL;
      const tagFromUrl = htmlUrl.match(/\/releases\/tag\/([^/?#]+)/)?.[1];
      const tagFromId = id.split('/').pop();
      let rawTag = tagFromUrl || tagFromId || '';
      try {
        rawTag = decodeURIComponent(rawTag);
      } catch {
        // 保留原始 tag 字符串，交由 parseVersion 校验
      }

      const parsed = parseVersion(rawTag);
      if (!parsed || parsed.prerelease) return null;

      const version = normalizeVersion(rawTag);
      if (seen.has(version)) return null;
      seen.add(version);

      const publishedAt = decodeEntities(readXmlTag(entryXml, 'updated') || readXmlTag(entryXml, 'published'));
      const rawTitle = decodeEntities(readXmlTag(entryXml, 'title'));
      const rawContent = readXmlTag(entryXml, 'content');

      return {
        id: id || rawTag,
        version,
        tag: rawTag.startsWith('v') ? rawTag : `v${version}`,
        title: cleanInlineMarkdown(rawTitle) || `HOMURA v${version}`,
        publishedAt,
        dateLabel: formatReleaseDate(publishedAt),
        htmlUrl,
        notes: parseReleaseNotes(atomHtmlToMarkdown(rawContent)),
        assets: []
      };
    })
    .filter((release): release is NormalizedRelease => release !== null)
    .sort((left, right) => compareVersions(right.version, left.version));
}

export function parseExpandedAssetsHtml(html: string): NormalizedAsset[] {
  const anchors = String(html || '').match(/<a\b[^>]*\bhref=(?:"[^"]+"|'[^']+')[^>]*>/gi) || [];
  const seen = new Set<string>();
  const assets: NormalizedAsset[] = [];

  for (const anchor of anchors) {
    const hrefMatch = anchor.match(/\bhref=(?:"([^"]+)"|'([^']+)')/i);
    const rawHref = decodeEntities(hrefMatch?.[1] || hrefMatch?.[2] || '');
    if (!rawHref) continue;

    let urlObj: URL;
    try {
      urlObj = new URL(rawHref, 'https://github.com');
    } catch {
      continue;
    }

    const fullUrl = urlObj.toString();
    if (!isAllowedReleaseUrl(fullUrl)) continue;
    if (!urlObj.pathname.startsWith('/Leon-Ning-san/HomuraReader/releases/download/')) continue;

    let name = urlObj.pathname.split('/').pop() || '';
    try {
      name = decodeURIComponent(name);
    } catch {
      // 保留原始文件名
    }
    name = name.trim();
    if (!name || seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    assets.push({
      name,
      url: fullUrl,
      browser_download_url: fullUrl,
      size: 0,
      downloadCount: 0
    });
  }

  return assets;
}

async function fetchReleasesFromNative(invoke: TauriInvoke): Promise<{ releases: NormalizedRelease[]; etag: string }> {
  const xml = await invoke('fetch_release_feed');
  const releases = parseAtomReleases(String(xml || ''));
  if (releases.length === 0) throw updateError('NO_RELEASES', 'No stable releases');

  const latest = releases[0];
  if (latest?.tag) {
    try {
      const assetsHtml = await invoke('fetch_release_assets', { tag: latest.tag });
      latest.assets = parseExpandedAssetsHtml(String(assetsHtml || ''));
    } catch (error) {
      console.warn('读取最新 Release 安装包列表失败，将回退到打开发布页', error);
    }
  }

  return { releases, etag: '' };
}

async function requestReleases(force: boolean): Promise<{ releases: NormalizedRelease[]; etag: string }> {
  if (typeof fetch !== 'function') throw updateError('NETWORK', '当前环境不支持网络请求。');

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (cachedEtag && cachedReleases.length > 0) {
    headers['If-None-Match'] = cachedEtag;
  }

  try {
    const response = await fetch(RELEASES_API_URL, {
      headers,
      cache: force ? 'no-cache' : 'default',
      signal: controller.signal
    });

    if (response.status === 304 && cachedReleases.length > 0) {
      return { releases: cachedReleases, etag: cachedEtag };
    }

    await checkRateLimit(response);
    if (!response.ok) throw updateError('HTTP_ERROR', `GitHub 返回了 ${response.status}。`);

    const releases = normalizeReleases(await response.json());
    if (releases.length === 0) throw updateError('NO_RELEASES', 'No stable releases');
    const etag = response.headers.get('etag') || '';
    return { releases, etag };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function shouldFallbackToNative(error: unknown) {
  const detail = error as { name?: unknown; code?: unknown } | null | undefined;
  if (!detail) return true;
  if (detail.code === 'NO_RELEASES') return false;
  if (detail.name === 'AbortError') return false;
  return true;
}

async function requestReleasesWithFallback(force: boolean): Promise<{ releases: NormalizedRelease[]; etag: string }> {
  const invoke = getTauriInvoke();
  if (Date.now() < rateLimitUntil) {
    if (invoke) return fetchReleasesFromNative(invoke);
    throw updateError('RATE_LIMIT', 'GitHub API rate limit reached');
  }

  try {
    return await requestReleases(force);
  } catch (error) {
    if (invoke && shouldFallbackToNative(error)) {
      return fetchReleasesFromNative(invoke);
    }
    throw error;
  }
}

export async function fetchStableReleases({ force = false }: { force?: boolean } = {}): Promise<NormalizedRelease[]> {
  hydrateMemoryCacheFromStorage();
  const now = Date.now();
  if (!force && cachedReleases.length > 0 && now - cachedAt < CACHE_TTL) {
    return cachedReleases;
  }
  if (pendingRequest) return pendingRequest;
  if (now < rateLimitUntil && !getTauriInvoke()) {
    throw updateError('RATE_LIMIT', 'GitHub API rate limit reached');
  }

  pendingRequest = requestReleasesWithFallback(force)
    .then(({ releases, etag }) => {
      const updatedAt = Date.now();
      cachedReleases = releases;
      cachedAt = updatedAt;
      cachedEtag = etag;
      writePersistedCache(releases, etag, updatedAt);
      return releases;
    })
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}
