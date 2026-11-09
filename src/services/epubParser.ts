/* ============================================================================
   HOMURA · EPUB 解析核心
   ----------------------------------------------------------------------------
   JSZip 与原生 ZIP 通道只负责提供文本和 Blob，这里统一处理
   container、OPF、spine、漫画判定及正文清洗，保证两条存储后端行为一致。
   ========================================================================== */

import JSZip from 'jszip';
import { sanitizeEpubHtml } from './sanitize.ts';
import { shouldReadEpubAsManga, TEXT_CHAPTER_MIN_LENGTH } from './epubType.ts';
import {
  clearNativeArchiveBookCache,
  closeNativeArchive,
  openNativeDocument,
  readNativePageBlob,
  readNativeTextBatch,
  shouldFallbackNativeArchive
} from './nativeArchive.ts';

const NATIVE_TEXT_BATCH_SIZE = 128;
// 导入时只抽样 spine 与封面；采样贴近判型阈值时再回退全量解析。
const METADATA_SAMPLE_LIMIT = 10;
const METADATA_MIN_SAMPLE = 8;
const METADATA_COVER_SCAN_PAGES = 4;

function resolveRelativePath(basePath, relativePath) {
  const baseDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/') + 1) : '';
  const stack = baseDir.split('/').filter(Boolean);
  const parts = relativePath.split('/');
  for (const part of parts) {
    if (part === '..') stack.pop();
    else if (part !== '.' && part !== '') stack.push(part);
  }
  return stack.join('/');
}

function safeDecodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch (err) {
    return path;
  }
}

export function makeEpubId() {
  return 'epub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

export function epubTitleFromFileName(name) {
  return String(name || 'book.epub').replace(/(\.kepub)?\.epub$/i, '');
}

const NATIVE_MANGA_MANIFEST_VERSION = 1;

// EPUB 漫画的页序与图片尺寸在导入时已经完整解析过，顺手存成轻量清单。
// 首次打开只按 ZIP 条目索引取图，不再重新解析全书 XHTML、扫描图片头。
export function createNativeMangaManifest(book) {
  if (book?.type !== 'manga' || book?.format !== 'epub') return null;
  const items: { index: number; width: number; height: number }[] = [];
  for (const item of book.pageItems || []) {
    if (!Number.isInteger(item?.nativeIndex)) return null;
    items.push({
      index: item.nativeIndex,
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

export function isNativeMangaManifestValid(manifest) {
  return manifest?.version === NATIVE_MANGA_MANIFEST_VERSION
    && Array.isArray(manifest.items)
    && manifest.items.length > 0
    && manifest.items.every(item => Number.isInteger(item?.index) && item.index >= 0);
}

async function readNativeTexts(archiveId, paths, entryIndexByPath) {
  const textByPath = new Map<string, any>();
  const validPaths = paths.filter(path => entryIndexByPath.has(path));

  const readBatch = async batch => {
    if (batch.length === 0) return;
    const entries = await readNativeTextBatch(archiveId, batch);
    for (const entry of entries) {
      if (entry?.path) textByPath.set(entry.path, entry.text);
    }
    const missing = batch.filter(path => !textByPath.has(path));
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
  return paths.map((path: string) => textByPath.has(path) ? textByPath.get(path) : null);
}

export async function createJsZipEpubArchive(file) {
  const zip = new JSZip();
  const zipContent = await zip.loadAsync(file);

  return {
    kind: 'jszip',
    zipContent,
    hasPath(path) {
      return !!zipContent.file(path);
    },
    resolvePath(candidates) {
      return candidates.find(path => !!zipContent.file(path)) || null;
    },
    async readTexts(paths) {
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
    async readBlobByPath(path) {
      const entry = zipContent.file(path);
      return entry ? entry.async('blob') : null;
    },
    makePageItem(path, url) {
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
  fallbackTitle?: string;
  metadataOnly?: boolean;
  nativePath?: string;
  loadFallbackFile?: () => unknown | Promise<unknown>;
  markZipPaths?: boolean;
  [key: string]: unknown;
}

export async function createNativeEpubArchive(nativePath: string, options: EpubParseOptions = {}) {
  const archiveId = options.id;
  if (!archiveId) throw new Error('原生 EPUB 缺少书籍 ID');

  const opened = await openNativeDocument(archiveId, nativePath);
  const entries = Array.isArray(opened?.entries) ? opened.entries : [];
  if (entries.length === 0) throw new Error('原生 EPUB 没有可读取的条目');

  const entryIndexByPath = new Map();
  const entryByPath = new Map();
  for (const entry of entries) {
    const path = entry?.path || entry?.name;
    if (!path) continue;
    entryByPath.set(path, entry);
    if (Number.isInteger(entry.index)) entryIndexByPath.set(path, entry.index);
  }

  const hasPath = path => entryIndexByPath.has(path);

  return {
    kind: 'native',
    archiveId,
    nativeArchivePath: nativePath,
    entryIndexByPath,
    hasPath,
    resolvePath(candidates) {
      return candidates.find(hasPath) || null;
    },
    async readTexts(paths) {
      return readNativeTexts(archiveId, paths, entryIndexByPath);
    },
    async readBlobByPath(path) {
      const index = entryIndexByPath.get(path);
      if (!Number.isInteger(index)) return null;
      const page = await readNativePageBlob(archiveId, index);
      return page.blob;
    },
    makePageItem(path, url) {
      const index = entryIndexByPath.get(path);
      const entry = entryByPath.get(path);
      if (!Number.isInteger(index)) throw new Error('原生 EPUB 图片索引缺失');
      const item: {
        nativeArchiveId: string;
        nativeArchivePath: string;
        nativeIndex: number;
        url: string;
        imageWidth?: number;
        imageHeight?: number;
      } = {
        nativeArchiveId: archiveId,
        nativeArchivePath: nativePath,
        nativeIndex: index,
        url
      };
      if (entry?.width > 0 && entry?.height > 0) {
        item.imageWidth = entry.width;
        item.imageHeight = entry.height;
      }
      return item;
    },
    bookFields() {
      return {
        nativeArchiveId: archiveId,
        nativeArchivePath: nativePath,
        nativeEntryIndexByPath: entryIndexByPath
      };
    }
  };
}

async function readEpubCover(archive, path) {
  if (!path) return { cover: null, coverBlob: null, coverNative: null };
  const coverBlob = await archive.readBlobByPath(path);
  if (!coverBlob) throw new Error('无法读取 EPUB 封面图');
  return {
    cover: URL.createObjectURL(coverBlob),
    coverBlob,
    coverNative: archive.kind === 'native' && archive.nativeArchivePath
      ? { archivePath: archive.nativeArchivePath, entryPath: path }
      : null
  };
}

function parseEpubXml(parser, xml, label) {
  const doc = parser.parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${label}格式无效`);
  return doc;
}

async function readEpubPackage(archive, fallbackTitle) {
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
  const bookTitle = parsedTitle || fallbackTitle;

  const manifest: any = {};
  opfDoc.querySelectorAll('manifest > item').forEach(item => {
    manifest[item.getAttribute('id')] = {
      id: item.getAttribute('id'),
      href: item.getAttribute('href'),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || ''
    };
  });

  const spine: { id: any; href: any; path: any }[] = [];
  opfDoc.querySelectorAll('spine > itemref').forEach(ref => {
    const itemId = ref.getAttribute('idref');
    const item = manifest[itemId];
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

function manifestPath(archive, opfDir, item) {
  if (!item?.href) return null;
  const href = item.href.split('#')[0];
  return archive.resolvePath([opfDir + safeDecodePath(href), item.href, href]);
}

function isImageItem(item, path = '') {
  return /^image\//i.test(item?.mediaType || '')
    || /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(path);
}

function extractPageImages(archive: any, parser: any, rawHtml: string, pagePath: string, options: EpubParseOptions = {}) {
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

function selectSampleIndices(length, limit) {
  if (length <= 0) return [];
  if (length <= limit) return Array.from({ length }, (_, index) => index);

  const indices = new Set([0, Math.floor((length - 1) / 2), length - 1]);
  for (let index = 0; index < limit; index++) {
    indices.add(Math.round(index * (length - 1) / (limit - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

async function readOpfCoverPath(archive: any, pkg: any) {
  const candidates: any[] = [];
  const entries = Object.values(pkg.manifest) as Array<{ properties?: string } & Record<string, unknown>>;
  const coverImage = entries.find(item => (
    /(?:^|\s)cover-image(?:\s|$)/i.test(item.properties || '')
    && isImageItem(item)
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
}) {
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

async function parseEpubMetadata(archive, pkg, id) {
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
  const sampledImagePaths = new Set();

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

  let coverFields: { cover: any; coverBlob: any; coverNative: any } = { cover: null, coverBlob: null, coverNative: null };
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

async function parseEpubFull(archive, pkg, id) {
  const { parser, spine } = pkg;
  const rawHtmls = await archive.readTexts(spine.map(item => item.path));
  const lazyMangaPaths: string[] = [];
  const seenGlobalPaths = new Set();
  const chapters: { title: any; htmlContent: string }[] = [];
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
      || item.href.split('/').pop().replace(/\.[^.]+$/, '');
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

export async function parseEpubArchive(archive: any, options: EpubParseOptions = {}) {
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
    if (book?.needsFullParse) {
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
export async function parseEpubFile(file: any, options: EpubParseOptions = {}) {
  const id = options.id || makeEpubId();
  const fallbackTitle = epubTitleFromFileName(options.name || file?.name);

  if (options.nativePath) {
    try {
      return await parseEpubNativeArchive(options.nativePath, {
        id,
        name: options.name || file?.name,
        metadataOnly: options.metadataOnly
      });
    } catch (err) {
      if (!shouldFallbackNativeArchive(err)) throw err;
      console.warn('[HOMURA] 原生 EPUB 解析失败，回退 JSZip', err);
    }
  }

  const fallbackFile = typeof options.loadFallbackFile === 'function'
    ? await options.loadFallbackFile()
    : file;
  const archive = await createJsZipEpubArchive(fallbackFile);
  return parseEpubArchive(archive, {
    id,
    fallbackTitle,
    metadataOnly: options.metadataOnly
  });
}
