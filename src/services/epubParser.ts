/* ============================================================================
   HOMURA · EPUB 解析核心
   ----------------------------------------------------------------------------
   JSZip 与原生 ZIP 通道只负责提供文本和 Blob，这里统一处理
   container、OPF、spine、漫画判定及正文清洗，保证两条存储后端行为一致。
   ========================================================================== */

import JSZip from 'jszip';
import type { Book } from '../types.ts';
import { sanitizeEpubHtml } from './sanitize.ts';
import { shouldReadEpubAsManga, TEXT_CHAPTER_MIN_LENGTH } from './epubType.ts';
import {
  clearNativeArchiveBookCache,
  closeNativeArchive,
  openNativeDocument,
  NATIVE_ONLY_ARCHIVE_BYTES,
  readNativePageBlob,
  readNativeTextBatch,
  shouldFallbackNativeArchive
} from './nativeArchive.ts';

const NATIVE_TEXT_BATCH_SIZE = 128;
// 导入时只抽样 spine 与封面；采样贴近判型阈值时再回退全量解析。
const METADATA_SAMPLE_LIMIT = 10;
const METADATA_MIN_SAMPLE = 8;
const METADATA_COVER_SCAN_PAGES = 4;

/** EPUB 存档适配层：JSZip 与原生 ZIP 同构 */
interface EpubArchive {
  kind: 'jszip' | 'native';
  zipContent?: JSZip;
  archiveId?: string;
  nativeArchivePath?: string;
  entryIndexByPath?: Map<string, number>;
  hasPath(path: string): boolean;
  resolvePath(candidates: string[]): string | null;
  readTexts(paths: string[]): Promise<(string | null)[]>;
  readBlobByPath(path: string): Promise<Blob | null>;
  makePageItem(path: string, url: string | null): Record<string, unknown>;
  bookFields(): Record<string, unknown>;
}

/** 解析出的 OPF 包信息 */
interface EpubPackage {
  parser: DOMParser;
  opfDoc: Document;
  opfPath: string;
  opfDir: string;
  manifest: Record<string, { id: string | null; href: string | null; mediaType: string; properties: string; path?: string }>;
  spine: Array<{ id: string | null; href: string | null; path: string }>;
  bookTitle: string;
}

/** 原生 ZIP 条目 */
interface NativeZipEntry {
  path?: string;
  name?: string;
  index?: number;
  width?: number;
  height?: number;
}

/** 封面字段 */
interface EpubCoverFields {
  cover: string | null;
  coverBlob: Blob | null;
  coverNative: { archivePath?: string; entryPath?: string } | null;
}

function resolveRelativePath(basePath: string, relativePath: string) {
  const baseDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/') + 1) : '';
  const stack = baseDir.split('/').filter(Boolean);
  const parts = relativePath.split('/');
  for (const part of parts) {
    if (part === '..') stack.pop();
    else if (part !== '.' && part !== '') stack.push(part);
  }
  return stack.join('/');
}

function safeDecodePath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch (err) {
    return path;
  }
}

export function makeEpubId() {
  return 'epub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

export function epubTitleFromFileName(name: unknown) {
  return String(name || 'book.epub').replace(/(\.kepub)?\.epub$/i, '');
}

const NATIVE_MANGA_MANIFEST_VERSION = 1;

// EPUB 漫画的页序与图片尺寸在导入时已经完整解析过，顺手存成轻量清单。
// 首次打开只按 ZIP 条目索引取图，不再重新解析全书 XHTML、扫描图片头。
export function createNativeMangaManifest(book: Book | null | undefined) {
  if (book?.type !== 'manga' || (book?.format !== 'epub' && book?.format !== 'cbz')) return null;
  const items: { index: number; width: number; height: number }[] = [];
  for (const item of (book.pageItems || []) as Array<{ nativeIndex?: number; imageWidth?: number; imageHeight?: number }>) {
    if (!Number.isInteger(item?.nativeIndex)) return null;
    items.push({
      index: item.nativeIndex as number,
      width: Math.max(0, Number(item.imageWidth) || 0),
      height: Math.max(0, Number(item.imageHeight) || 0)
    });
  }
  if (items.length === 0) return null;
  return {
    version: NATIVE_MANGA_MANIFEST_VERSION,
    pageCount: items.length,
    items
  };
}

export function isNativeMangaManifestValid(manifest: unknown) {
  const m = manifest as { version?: number; items?: Array<{ index?: number }> } | null | undefined;
  return m?.version === NATIVE_MANGA_MANIFEST_VERSION
    && Array.isArray(m.items)
    && m.items.length > 0
    && m.items.every((item) => Number.isInteger(item?.index) && (item.index as number) >= 0);
}

async function readNativeTexts(archiveId: string, paths: string[], entryIndexByPath: Map<string, number>) {
  const textByPath = new Map<string, string>();
  const validPaths = paths.filter((path) => entryIndexByPath.has(path));

  const readBatch = async (batch: string[]) => {
    if (batch.length === 0) return;
    const entries = await readNativeTextBatch(archiveId, batch);
    for (const entry of entries) {
      if (entry?.path) textByPath.set(entry.path, entry.text);
    }
    const missing = batch.filter((path) => !textByPath.has(path));
    // Kotlin 单次最多返回 32MB 文本；被总量截断时递归拆批补读，
    // 单个条目仍读不到才视为缺失，避免长篇小说后半段静默消失。
    if (missing.length === 0 || batch.length === 1) return;
    const middle = Math.ceil(missing.length / 2);
    await readBatch(missing.slice(0, middle));
    await readBatch(missing.slice(middle));
  };

  for (let start = 0; start < validPaths.length; start += NATIVE_TEXT_BATCH_SIZE) {
    await readBatch(validPaths.slice(start, start + NATIVE_TEXT_BATCH_SIZE));
  }
  return paths.map((path: string) => textByPath.has(path) ? (textByPath.get(path) ?? null) : null);
}

export async function createJsZipEpubArchive(file: Blob): Promise<EpubArchive> {
  const zip = new JSZip();
  const zipContent = await zip.loadAsync(file);

  return {
    kind: 'jszip',
    zipContent,
    hasPath(path: string) {
      return !!zipContent.file(path);
    },
    resolvePath(candidates: string[]) {
      return candidates.find((path) => !!zipContent.file(path)) || null;
    },
    async readTexts(paths: string[]) {
      const texts: (string | null)[] = [];
      for (const path of paths) {
        const entry = zipContent.file(path);
        if (!entry) {
          texts.push(null);
          continue;
        }
        try {
          texts.push(await entry.async('text'));
        } catch (err) {
          texts.push(null);
        }
      }
      return texts;
    },
    async readBlobByPath(path: string) {
      const entry = zipContent.file(path);
      return entry ? entry.async('blob') : null;
    },
    makePageItem(path: string, url: string | null) {
      return {
        zipEntry: zipContent.file(path),
        url
      };
    },
    bookFields() {
      return { zipContent };
    }
  };
}

interface EpubParseOptions {
  id?: string;
  name?: string;
  archiveSize?: number;
  fallbackTitle?: string;
  metadataOnly?: boolean;
  nativePath?: string;
  loadFallbackFile?: () => unknown | Promise<unknown>;
  markZipPaths?: boolean;
  [key: string]: unknown;
}

export async function createNativeEpubArchive(nativePath: string, options: EpubParseOptions = {}): Promise<EpubArchive> {
  const archiveId = options.id;
  if (!archiveId) throw new Error('原生 EPUB 缺少书籍 ID');

  const opened = await openNativeDocument(archiveId, nativePath);
  const entries = Array.isArray(opened?.entries) ? (opened.entries as NativeZipEntry[]) : [];
  if (entries.length === 0) throw new Error('原生 EPUB 没有可读取的条目');

  const entryIndexByPath = new Map<string, number>();
  const entryByPath = new Map<string, NativeZipEntry>();
  for (const entry of entries) {
    const path = entry?.path || entry?.name;
    if (!path) continue;
    entryByPath.set(path, entry);
    if (Number.isInteger(entry.index) && typeof entry.index === 'number') entryIndexByPath.set(path, entry.index);
  }

  const hasPath = (path: string) => entryIndexByPath.has(path);

  return {
    kind: 'native',
    archiveId,
    nativeArchivePath: nativePath,
    entryIndexByPath,
    hasPath,
    resolvePath(candidates: string[]) {
      return candidates.find(hasPath) || null;
    },
    async readTexts(paths: string[]) {
      return readNativeTexts(archiveId, paths, entryIndexByPath);
    },
    async readBlobByPath(path: string) {
      const index = entryIndexByPath.get(path);
      if (!Number.isInteger(index) || typeof index !== 'number') return null;
      const page = await readNativePageBlob(archiveId, index);
      return page.blob;
    },
    makePageItem(path: string, url: string | null) {
      const index = entryIndexByPath.get(path);
      const entry = entryByPath.get(path);
      if (!Number.isInteger(index) || typeof index !== 'number') throw new Error('原生 EPUB 图片索引缺失');
      const item: {
        nativeArchiveId: string;
        nativeArchivePath: string;
        nativeArchiveMode: string;
        nativeIndex: number;
        url: string | null;
        imageWidth?: number;
        imageHeight?: number;
      } = {
        nativeArchiveId: archiveId,
        nativeArchivePath: nativePath,
        nativeArchiveMode: 'document',
        nativeIndex: index,
        url
      };
      if (entry && (entry.width as number) > 0 && (entry.height as number) > 0) {
        item.imageWidth = entry.width;
        item.imageHeight = entry.height;
      }
      return item;
    },
    bookFields() {
      return {
        nativeArchiveId: archiveId,
        nativeArchivePath: nativePath,
        nativeArchiveMode: 'document',
        nativeEntryIndexByPath: entryIndexByPath
      };
    }
  };
}

async function readEpubCover(archive: EpubArchive, path: string | null): Promise<EpubCoverFields> {
  if (!path) return { cover: null, coverBlob: null, coverNative: null };
  const coverBlob = await archive.readBlobByPath(path);
  if (!coverBlob) throw new Error('无法读取 EPUB 封面图');
  return {
    cover: URL.createObjectURL(coverBlob),
    coverBlob,
    coverNative: archive.kind === 'native' && archive.nativeArchivePath && path
      ? { archivePath: archive.nativeArchivePath, entryPath: path }
      : null
  };
}

function parseEpubXml(parser: DOMParser, xml: string, label: string): Document {
  const doc = parser.parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${label}格式无效`);
  return doc;
}

async function readEpubPackage(archive: EpubArchive, fallbackTitle: string): Promise<EpubPackage> {
  const parser = new DOMParser();

  const [containerXml] = await archive.readTexts(['META-INF/container.xml']);
  if (!containerXml) throw new Error('缺少 META-INF/container.xml');

  const containerDoc = parseEpubXml(parser, containerXml, 'EPUB container');
  const rootfileEl = containerDoc.querySelector('rootfile');
  const declaredOpfPath = rootfileEl?.getAttribute('full-path') || 'content.opf';
  const opfCandidates = [declaredOpfPath];
  try {
    const decodedOpfPath = decodeURIComponent(declaredOpfPath);
    if (decodedOpfPath !== declaredOpfPath) opfCandidates.push(decodedOpfPath);
  } catch (err) {}
  const opfPath = archive.resolvePath(opfCandidates);
  if (!opfPath) throw new Error('未找到 OPF 配置文件');

  const [opfText] = await archive.readTexts([opfPath]);
  if (!opfText) throw new Error('无法读取 OPF 配置文件');
  const opfDoc = parseEpubXml(parser, opfText, 'EPUB OPF');
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const titleEl = opfDoc.getElementsByTagNameNS(
    'http://purl.org/dc/elements/1.1/',
    'title'
  )[0]
    || opfDoc.getElementsByTagName('dc:title')[0]
    || opfDoc.querySelector('title');
  const parsedTitle = titleEl?.textContent?.trim();

  const manifest: EpubPackage['manifest'] = {};
  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    const itemId = item.getAttribute('id');
    if (!itemId) return;
    manifest[itemId] = {
      id: itemId,
      href: item.getAttribute('href'),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || ''
    };
  });

  const spine: Array<{ id: string | null; href: string | null; path: string }> = [];
  opfDoc.querySelectorAll('spine > itemref').forEach((ref) => {
    const itemId = ref.getAttribute('idref');
    const item = itemId ? manifest[itemId] : undefined;
    if (!item?.href) return;
    const fullPath = opfDir + safeDecodePath(item.href.split('#')[0]);
    const path = archive.resolvePath([fullPath, item.href, item.href.split('#')[0]]);
    if (path) spine.push({ id: itemId, href: item.href, path });
  });

  return {
    parser,
    opfDoc,
    opfPath,
    opfDir,
    manifest,
    spine,
    bookTitle: parsedTitle || fallbackTitle
  };
}

function manifestPath(archive: EpubArchive, opfDir: string, item: { href?: string | null } | null | undefined) {
  if (!item?.href) return null;
  const href = (item.href as string).split('#')[0];
  return archive.resolvePath([opfDir + safeDecodePath(href), item.href, href]);
}

function isImageItem(item: { mediaType?: string } | null | undefined, path = '') {
  return /^image\//i.test(item?.mediaType || '')
    || /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(path);
}

function extractPageImages(archive: EpubArchive, parser: DOMParser, rawHtml: string, pagePath: string, options: EpubParseOptions = {}) {
  const htmlDoc = parser.parseFromString(rawHtml, 'text/html');
  const imgs = htmlDoc.querySelectorAll('img, image');
  const imagePaths: string[] = [];
  const seenInCurrentPage = new Set<string>();

  for (const img of imgs) {
    const srcAttr = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href');
    if (!srcAttr || srcAttr.startsWith('http') || srcAttr.startsWith('data:')) continue;

    const cleanSrc = safeDecodePath(srcAttr.split('#')[0]);
    const resolved = resolveRelativePath(pagePath, cleanSrc);
    const imagePath = archive.resolvePath([resolved, cleanSrc]);
    if (!imagePath) continue;

    if (options.markZipPaths) img.setAttribute('data-zip-path', imagePath);
    if (!seenInCurrentPage.has(imagePath)) {
      seenInCurrentPage.add(imagePath);
      imagePaths.push(imagePath);
    }
  }

  return {
    htmlDoc,
    plainText: (htmlDoc.body?.textContent || '').trim(),
    imagePaths
  };
}

function selectSampleIndices(length: number, limit: number) {
  if (length <= 0) return [];
  if (length <= limit) return Array.from({ length }, (_, index) => index);

  const indices = new Set([0, Math.floor((length - 1) / 2), length - 1]);
  for (let index = 0; index < limit; index++) {
    indices.add(Math.round(index * (length - 1) / (limit - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

async function readOpfCoverPath(archive: EpubArchive, pkg: EpubPackage) {
  const candidates: Array<{ path?: string; mediaType?: string; href?: string | null; id?: string | null; properties?: string }> = [];
  const entries = Object.values(pkg.manifest) as Array<{ properties?: string } & Record<string, unknown>>;
  const coverImage = entries.find(item => (
    /(?:^|\s)cover-image(?:\s|$)/i.test(item.properties || '')
    && isImageItem(item as { mediaType?: string })
  ));
  if (coverImage) candidates.push(coverImage);

  const coverMeta = [...pkg.opfDoc.querySelectorAll('meta')]
    .find(meta => (meta.getAttribute('name') || '').toLowerCase() === 'cover');
  const metaId = coverMeta?.getAttribute('content');
  if (metaId && pkg.manifest[metaId]) candidates.push(pkg.manifest[metaId]);

  const guideCover = [...pkg.opfDoc.querySelectorAll('guide > reference')]
    .find(ref => (ref.getAttribute('type') || '').toLowerCase() === 'cover');
  const guideHref = guideCover?.getAttribute('href');
  if (guideHref) {
    const rawHref = guideHref.split('#')[0];
    const cleanHref = safeDecodePath(rawHref);
    const fullPath = resolveRelativePath(pkg.opfPath, cleanHref);
    const path = archive.resolvePath([fullPath, rawHref, cleanHref]);
    if (path) candidates.push({ path, mediaType: '' });
  }

  for (const candidate of candidates) {
    const path = candidate.path || manifestPath(archive, pkg.opfDir, candidate);
    if (!path) continue;
    if (isImageItem(candidate, path)) return path;

    const [html] = await archive.readTexts([path]);
    if (!html) continue;
    const { imagePaths } = extractPageImages(archive, pkg.parser, html, path);
    if (imagePaths.length > 0) return imagePaths[0];
  }
  return null;
}

function metadataSampleNeedsFullParse({
  spineCount,
  sampledCount,
  missingCount,
  chapterCount,
  textChapterCount,
  imageHeavyChapterCount,
  imageCount
}: { spineCount: number; sampledCount: number; missingCount: number; chapterCount: number; textChapterCount: number; imageHeavyChapterCount: number; imageCount: number }) {
  if (chapterCount === 0 || missingCount > 0) return true;
  if (sampledCount < Math.min(METADATA_MIN_SAMPLE, spineCount)) return true;

  const textRatio = textChapterCount / chapterCount;
  const imageRatio = imageHeavyChapterCount / chapterCount;
  const isManga = shouldReadEpubAsManga({
    chapterCount,
    textChapterCount,
    imageHeavyChapterCount,
    imageCount
  });

  // 采样比例贴近判型阈值时，宁可多解析一次，也不要让轻小说只剩彩插。
  if (textRatio >= 0.08 && textRatio <= 0.22 && imageRatio >= 0.30 && imageRatio <= 0.60) {
    return true;
  }
  if (isManga && textRatio >= 0.06 && imageRatio <= 0.55) return true;
  if (!isManga && textRatio <= 0.22) return true;
  return false;
}

async function parseEpubMetadata(archive: EpubArchive, pkg: EpubPackage, id: string) {
  const sampleIndices = selectSampleIndices(pkg.spine.length, METADATA_SAMPLE_LIMIT);
  const coverIndices = Array.from(
    { length: Math.min(METADATA_COVER_SCAN_PAGES, pkg.spine.length) },
    (_, index) => index
  );
  const readIndices = [...new Set([...coverIndices, ...sampleIndices])].sort((a, b) => a - b);
  const rawHtmls = await archive.readTexts(readIndices.map(index => pkg.spine[index].path));
  const rawByIndex = new Map(readIndices.map((index, position) => [index, rawHtmls[position]]));

  let sampledCount = 0;
  let missingCount = 0;
  let chapterCount = 0;
  let textChapterCount = 0;
  let imageHeavyChapterCount = 0;
  let sampledImageTotal = 0;
  const sampledImagePaths = new Set<string>();

  for (const index of sampleIndices) {
    const rawHtml = rawByIndex.get(index);
    if (rawHtml === null || rawHtml === undefined) {
      missingCount++;
      continue;
    }
    sampledCount++;
    const page = extractPageImages(archive, pkg.parser, rawHtml, pkg.spine[index].path);
    const bodyHtml = page.htmlDoc.body ? page.htmlDoc.body.innerHTML : rawHtml;
    if (bodyHtml.trim().length === 0) continue;
    chapterCount++;
    if (page.plainText.length >= TEXT_CHAPTER_MIN_LENGTH) textChapterCount++;
    if (page.imagePaths.length > 0 && page.plainText.length < TEXT_CHAPTER_MIN_LENGTH) {
      imageHeavyChapterCount++;
      sampledImageTotal += page.imagePaths.length;
      page.imagePaths.forEach(path => sampledImagePaths.add(path));
    }
  }

  if (metadataSampleNeedsFullParse({
    spineCount: pkg.spine.length,
    sampledCount,
    missingCount,
    chapterCount,
    textChapterCount,
    imageHeavyChapterCount,
    imageCount: sampledImagePaths.size
  })) {
    return {
      id,
      title: pkg.bookTitle,
      metadataOnly: true,
      needsFullParse: true
    };
  }

  const isManga = shouldReadEpubAsManga({
    chapterCount,
    textChapterCount,
    imageHeavyChapterCount,
    imageCount: sampledImagePaths.size
  });
  const manifestImageCount = Object.values(pkg.manifest).filter(item => isImageItem(item)).length;
  const sampledImageRatio = imageHeavyChapterCount > 0
    ? sampledImageTotal / imageHeavyChapterCount
    : 0;
  const estimatedMangaPages = Math.round(sampledImageRatio * pkg.spine.length);

  let coverPath = await readOpfCoverPath(archive, pkg);
  let fallbackCoverPath: string | null = null;
  for (const index of coverIndices) {
    const rawHtml = rawByIndex.get(index);
    if (!rawHtml) continue;
    const page = extractPageImages(archive, pkg.parser, rawHtml, pkg.spine[index].path);
    if (page.imagePaths.length > 0) {
      fallbackCoverPath = page.imagePaths[0];
      break;
    }
  }
  if (!coverPath) coverPath = fallbackCoverPath;

  let coverFields: EpubCoverFields = { cover: null, coverBlob: null, coverNative: null };
  if (coverPath) {
    try {
      coverFields = await readEpubCover(archive, coverPath);
    } catch (err) {
      console.warn('[HOMURA] OPF 封面读取失败，尝试首个页面图片', err);
      if (fallbackCoverPath && fallbackCoverPath !== coverPath) {
        try {
          coverFields = await readEpubCover(archive, fallbackCoverPath);
        } catch (fallbackError) {
          console.warn('[HOMURA] EPUB 封面读取失败', fallbackError);
        }
      }
    }
  }

  return {
    id,
    type: isManga ? 'manga' : 'epub',
    format: 'epub',
    title: pkg.bookTitle,
    ...coverFields,
    chapters: null,
    pageItems: null,
    pageCount: isManga
      ? Math.max(1, manifestImageCount, estimatedMangaPages)
      : Math.max(1, pkg.spine.length),
    metadataOnly: true,
    ...archive.bookFields()
  };
}

async function parseEpubFull(archive: EpubArchive, pkg: EpubPackage, id: string) {
  const { parser, spine } = pkg;
  const rawHtmls = await archive.readTexts(spine.map((item) => item.path));
  const lazyMangaPaths: string[] = [];
  const seenGlobalPaths = new Set<string>();
  const chapters: Array<{ title: string; htmlContent: string }> = [];
  let imageHeavyCount = 0;
  let textChapterCount = 0;

  for (let index = 0; index < spine.length; index++) {
    const item = spine[index];
    const rawHtml = rawHtmls[index];
    if (!rawHtml) continue;

    const { htmlDoc, plainText, imagePaths: foundPathsInPage } = extractPageImages(
      archive,
      parser,
      rawHtml,
      item.path,
      { markZipPaths: true }
    );
    if (plainText.length >= TEXT_CHAPTER_MIN_LENGTH) textChapterCount++;
    if (foundPathsInPage.length > 0 && plainText.length < TEXT_CHAPTER_MIN_LENGTH) {
      imageHeavyCount++;
      foundPathsInPage.forEach(path => {
        if (seenGlobalPaths.has(path)) return;
        seenGlobalPaths.add(path);
        lazyMangaPaths.push(path);
      });
    }

    const chapterHeading = htmlDoc.body?.querySelector('h1, h2, h3')?.textContent?.trim()
      || htmlDoc.querySelector('title')?.textContent?.trim()
      || (item.href as string).split('/').pop()!.replace(/\.[^.]+$/, '');
    const bodyHtml = sanitizeEpubHtml(htmlDoc.body ? htmlDoc.body.innerHTML : rawHtml);
    if (bodyHtml.length > 0) {
      chapters.push({
        title: chapterHeading,
        htmlContent: bodyHtml
      });
    }
  }

  const isMangaEpub = shouldReadEpubAsManga({
    chapterCount: chapters.length,
    textChapterCount,
    imageHeavyChapterCount: imageHeavyCount,
    imageCount: lazyMangaPaths.length
  });

  if (isMangaEpub && lazyMangaPaths.length > 0) {
    const { cover, coverBlob, coverNative } = await readEpubCover(archive, lazyMangaPaths[0]);
    const pageItems = lazyMangaPaths.map((path, index) => (
      archive.makePageItem(path, index === 0 ? cover : null)
    ));

    return {
      id,
      type: 'manga',
      format: 'epub',
      title: pkg.bookTitle,
      cover,
      coverBlob,
      coverNative,
      pageItems,
      pageCount: pageItems.length,
      ...archive.bookFields()
    };
  }

  if (chapters.length === 0) throw new Error('未能提取出有效章节内容');

  const { cover, coverBlob, coverNative } = await readEpubCover(archive, lazyMangaPaths[0]);
  return {
    id,
    type: 'epub',
    format: 'epub',
    title: pkg.bookTitle,
    cover,
    coverBlob,
    coverNative,
    chapters,
    pageCount: chapters.length,
    ...archive.bookFields()
  };
}

export async function parseEpubArchive(archive: EpubArchive, options: EpubParseOptions = {}) {
  const id = options.id;
  if (!id) throw new Error('EPUB 解析缺少书籍 ID');
  const fallbackTitle = options.fallbackTitle || '未命名 EPUB';
  const pkg = await readEpubPackage(archive, fallbackTitle);
  if (options.metadataOnly) return parseEpubMetadata(archive, pkg, id);
  return parseEpubFull(archive, pkg, id);
}

export async function parseEpubNativeArchive(nativePath: string, options: EpubParseOptions = {}) {
  const id = options.id || makeEpubId();
  const fallbackTitle = epubTitleFromFileName(options.name || 'book.epub');
  try {
    const archive = await createNativeEpubArchive(nativePath, { id });
    const book = await parseEpubArchive(archive, {
      id,
      fallbackTitle,
      metadataOnly: options.metadataOnly
    });
    if ((book as { needsFullParse?: boolean } | null)?.needsFullParse) {
      await closeNativeArchive(id).catch(() => {});
    }
    return book;
  } catch (err) {
    await closeNativeArchive(id).catch(() => {});
    await clearNativeArchiveBookCache(id).catch(() => {});
    throw err;
  }
}

// 原生环境优先从 AppData 里的原文件随机读取；允许恢复的失败再回落到 JSZip。
export async function parseEpubFile(file: Blob & { name?: string }, options: EpubParseOptions = {}) {
  const id = options.id || makeEpubId();
  const fallbackTitle = epubTitleFromFileName(options.name || file?.name);
  const archiveSize = Math.max(file?.size || 0, options.archiveSize || 0);

  if (options.nativePath) {
    try {
      return await parseEpubNativeArchive(options.nativePath, {
        id,
        name: options.name || file?.name,
        metadataOnly: options.metadataOnly
      });
    } catch (err) {
      if (archiveSize > NATIVE_ONLY_ARCHIVE_BYTES || !shouldFallbackNativeArchive(err)) throw err;
      console.warn('[HOMURA] 原生 EPUB 解析失败，回退 JSZip', err);
    }
  }

  if (archiveSize > NATIVE_ONLY_ARCHIVE_BYTES) {
    throw new Error('超过 4 GiB 的 EPUB 需要原生读取');
  }

  const fallbackFile = typeof options.loadFallbackFile === 'function'
    ? await options.loadFallbackFile()
    : file;
  const archive = await createJsZipEpubArchive(fallbackFile as Blob);
  return parseEpubArchive(archive, {
    id,
    fallbackTitle,
    metadataOnly: options.metadataOnly
  });
}
