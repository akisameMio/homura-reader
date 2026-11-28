/* ============================================================================
   HOMURA · 格式解析
   ----------------------------------------------------------------------------
   EPUB / CBZ / ZIP / TXT / Markdown / PDF 的懒加载解析，统一输出书架可用的
   书籍对象；以及把散装图片按文件夹分组生成漫画书的 buildImageFolderBooks。
   ========================================================================== */

import type { Book } from '../types.ts';
import { escapeHtml } from './utils.ts';
import { decodeTxtBytesAsync } from './textEncoding.ts';
import { splitMarkdownChapters } from './markdown.ts';
import { parseMobiFileData, parseMobiRangeSource } from './mobi.ts';
import type { RangeSource } from './webdavBooks.ts';
import { openPdfDocument, createPdfPageItems, renderPdfCoverBlob, destroyPdfDocument } from './pdf.ts';
import { readPdfOutline } from './pdfOutline.ts';
import { parseEpubFile } from './epubParser.ts';
import {
  clearNativeArchiveBookCache,
  closeNativeArchive
} from './nativeArchive.ts';
import { removeNativeBookDir } from './nativeStorage.ts';

export { parseCbzFileLazy, parseCbzNativeArchive } from './cbzParser.ts';

// 同名书被跳过时还未入架，及时释放解析阶段创建的位图 URL 与 PDF worker。
export async function discardParsedBook(book: Book) {
  const urls = new Set<unknown>([book.cover, ...((book.resourceUrls as unknown[]) || []), ...((book.pageItems as unknown[]) || []).map((item) => (item as { url?: unknown }).url)]);
  for (const url of urls) {
    if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
  if (book.nativeArchiveId) {
    await closeNativeArchive(book.nativeArchiveId).catch(() => {});
    await clearNativeArchiveBookCache(book.nativeArchiveId).catch(() => {});
  }
  if (book.nativeArchiveStaged) {
    await removeNativeBookDir(book.id).catch(() => {});
  }
  try {
    await destroyPdfDocument(book.pdfDoc);
  } catch (err) {
    console.warn('[HOMURA] 释放跳过的 PDF 失败', err);
  }
}

// ---- EPUB 解析：章节正文 + 图片型 EPUB 自动转漫画 ----
// ---- CBZ / ZIP 解析：压缩包内图片按自然序排列 ----
// ---- TXT / Markdown 解析：按章节标题切分 ----

export async function parseEpubFileLazy(file: File, options: Record<string, unknown> = {}) {
  try {
    return await parseEpubFile(file, options);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ---- PDF：每页按需渲染成位图，直接复用漫画渲染管道 ----

export async function parsePdfFileLazy(file: File) {
  let pdfDoc: Awaited<ReturnType<typeof openPdfDocument>> | null = null;
  let coverUrl: string | null = null;
  try {
    pdfDoc = await openPdfDocument(file);
    const pageCount = pdfDoc.numPages || 0;
    if (pageCount === 0) throw new Error('PDF 中没有可显示的页面');

    const coverBlob = await renderPdfCoverBlob(pdfDoc);
    coverUrl = URL.createObjectURL(coverBlob as Blob);
    const outline = await readPdfOutline(pdfDoc);

    return {
      id: 'pdf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'manga',
      format: 'pdf',
      title: file.name.replace(/\.pdf$/i, ''),
      cover: coverUrl,
      coverBlob: coverBlob,
      pdfDoc: pdfDoc,
      outline,
      pageItems: createPdfPageItems(pdfDoc, pageCount),
      pageCount: pageCount
    };
  } catch (err) {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    if (pdfDoc) await destroyPdfDocument(pdfDoc).catch(() => {});
    console.error(err);
    return null;
  }
}

const MAX_TXT_SINGLE_LINE_CHARS = 16_000;

function splitOversizedLine(line: string): string[] {
  if (line.length <= MAX_TXT_SINGLE_LINE_CHARS) return [line];
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    let end = Math.min(cursor + MAX_TXT_SINGLE_LINE_CHARS, line.length);
    if (end < line.length) {
      const slice = line.slice(cursor, end);
      const breakAt = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
      if (breakAt > MAX_TXT_SINGLE_LINE_CHARS * 0.5) end = cursor + breakAt + 1;
    }
    const piece = line.slice(cursor, end).trim();
    if (piece) parts.push(piece);
    cursor = end;
  }
  return parts;
}

export async function parseTxtFile(txtFile: File) {
  try {
    const rawText = await decodeTxtBytesAsync(await txtFile.arrayBuffer());
    const lines = rawText.split(/\r\n?|\n/).map((l) => l.trim()).filter(Boolean).flatMap(splitOversizedLine);
    const title = txtFile.name.replace(/\.[^.]+$/, '');
    const chapters: { title: string; htmlContent: string }[] = [];
    let currentChapTitle = '开始';
    let currentParagraphs: string[] = [];
    const chapterRegex = /^(第[0-9零一二三四五六七八九十百千万]+[章节卷回话]|Chapter\s*\d+|序[章言]?|楔子|终章|尾声)/i;

    for (const line of lines) {
      if (line.length < 40 && chapterRegex.test(line)) {
        if (currentParagraphs.length > 0) {
          chapters.push({ title: currentChapTitle, htmlContent: currentParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('') });
          currentParagraphs = [];
        }
        currentChapTitle = line;
      } else {
        currentParagraphs.push(line);
        if (currentParagraphs.length >= 60) {
          chapters.push({ title: currentChapTitle, htmlContent: currentParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('') });
          currentParagraphs = [];
        }
      }
    }
    if (currentParagraphs.length > 0) {
      chapters.push({ title: currentChapTitle, htmlContent: currentParagraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('') });
    }
    if (chapters.length === 0) chapters.push({ title, htmlContent: '<p>（空文件）</p>' });

    return {
      id: 'txt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'novel',
      format: 'txt',
      title,
      cover: null,
      coverBlob: null,
      chapters,
      pageCount: chapters.length
    };
  } catch (err) {
    console.warn('[HOMURA] TXT 文件读取失败', err);
    return null;
  }
}

// ---- Markdown：按一/二级标题切章，正文交给 marked 转 HTML ----

export async function parseMarkdownFile(mdFile: File) {
  try {
    const rawText = (await decodeTxtBytesAsync(await mdFile.arrayBuffer())).replace(/\r\n?/g, '\n');
    const title = mdFile.name.replace(/\.[^.]+$/, '');
    const chapters = splitMarkdownChapters(rawText, title);

    return {
      id: 'md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'novel',
      format: 'markdown',
      title: title,
      cover: null,
      coverBlob: null,
      chapters: chapters,
      pageCount: chapters.length
    };
  } catch (err) {
    console.warn('[HOMURA] Markdown 文件读取失败', err);
    return null;
  }
}

// ---- MOBI：PalmDOC 解压 + 正文净化，输出小说管道可用的章节 ----

export async function parseMobiRangeLazy(source: RangeSource, fileName: string) {
  try {
    const fallbackTitle = fileName.replace(/\.(mobi|prc|azw)$/i, '');
    const data = await parseMobiRangeSource(source, fallbackTitle);
    let coverBlob = data.coverBlob;
    if (!coverBlob && data.type === 'manga') {
      const first = data.pages.find(page => page.start != null && page.end != null);
      if (first && first.start != null && first.end != null) {
        coverBlob = new Blob([await source.read(first.start, first.end) as BlobPart], { type: first.mime || '' });
      }
    }
    const coverUrl = coverBlob ? URL.createObjectURL(coverBlob) : null;

    if (data.type === 'manga' && data.pages.length > 0) {
      const pageItems = data.pages.map(page => ({
        zipEntry: page.start != null && page.end != null
          ? {
            async: async () => new Blob(
              [await source.read(page.start as number, page.end as number) as BlobPart],
              { type: page.mime || '' }
            )
          }
          : null,
        alt: page.alt || '',
        url: null
      }));
      return {
        id: 'mobi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'manga',
        format: 'mobi',
        title: data.title,
        cover: coverUrl,
        coverBlob,
        pageItems,
        pageCount: pageItems.length,
        readingDirection: data.readingDirection,
        resourceUrls: []
      };
    }

    return {
      id: 'mobi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'novel',
      format: 'mobi',
      title: data.title,
      cover: coverUrl,
      coverBlob,
      chapters: data.chapters,
      resourceUrls: data.resourceUrls,
      pageCount: data.chapters.length
    };
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function parseMobiFileLazy(file: File) {
  try {
    const fallbackTitle = file.name.replace(/\.(mobi|prc|azw)$/i, '');
    const data = await parseMobiFileData(file, fallbackTitle);
    let coverBlob = data.coverBlob;
    if (!coverBlob && data.type === 'manga') {
      const first = data.pages.find(page => page.start != null);
      if (first && first.start != null && first.end != null) coverBlob = file.slice(first.start, first.end, first.mime || '');
    }
    const coverUrl = coverBlob ? URL.createObjectURL(coverBlob) : null;

    if (data.type === 'manga' && data.pages.length > 0) {
      const pageItems = data.pages.map(page => ({
        mobiFile: file,
        mobiRange: page.start == null ? null : [page.start, page.end],
        mobiMime: page.mime || '',
        alt: page.alt || '',
        url: null
      }));
      return {
        id: 'mobi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'manga',
        format: 'mobi',
        title: data.title,
        cover: coverUrl,
        coverBlob,
        pageItems,
        pageCount: pageItems.length,
        readingDirection: data.readingDirection,
        resourceUrls: []
      };
    }

    return {
      id: 'mobi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'novel',
      format: 'mobi',
      title: data.title,
      cover: coverUrl,
      coverBlob,
      chapters: data.chapters,
      resourceUrls: data.resourceUrls,
      pageCount: data.chapters.length
    };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// macOS 打包/压缩留下的元数据目录，里面的 “图片” 不是真正的页面。
// 拖拽目录、文件夹句柄和旧存档都从这里进，必须在分组前统一滤掉。
export function isJunkImagePath(path: unknown) {
  return String(path || '')
    .split(/[\\/]/)
    .some(segment => segment === '__MACOSX' || segment === '.DS_Store' || segment.startsWith('._'));
}

// 把散装图片按所在文件夹分组，每组生成一本书
/** 散装图片文件（File 及导入链路附加的相对路径字段） */
interface EpubImageFile extends Blob {
  name: string;
  webkitRelativePath?: string;
  customRelativePath?: string;
}

export function buildImageFolderBooks(imgFiles: EpubImageFile[]) {
  if (!imgFiles || imgFiles.length === 0) return [];
  const folderGroups = new Map<string, { folderName: string; files: EpubImageFile[] }>();
  imgFiles.forEach((f) => {
    const rel = f.customRelativePath || f.webkitRelativePath || '';
    if (isJunkImagePath(rel)) return;
    const parts = rel.split('/').filter(Boolean);
    let groupName = '本地漫画图集';
    if (parts.length >= 2) {
      groupName = parts[parts.length - 2];
    } else if (imgFiles.length === 1) {
      groupName = f.name.replace(/\.[^.]+$/, '');
    }
    const folderPath = parts.length >= 2 ? parts.slice(0, -1).join('/') : groupName;
    if (!folderGroups.has(folderPath)) folderGroups.set(folderPath, { folderName: groupName, files: [] });
    folderGroups.get(folderPath)!.files.push(f);
  });

  return [...folderGroups.values()].map(({ folderName, files: groupImgs }) => {
    groupImgs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const coverBlob = typeof Blob !== 'undefined' && groupImgs[0] instanceof Blob
      ? groupImgs[0]
      : null;
    const firstCoverUrl = coverBlob ? URL.createObjectURL(coverBlob) : null;
    const pageItems = groupImgs.map((fileObj, idx) => ({
      file: fileObj,
      url: idx === 0 ? firstCoverUrl : null
    }));
    return {
      folderName,
      files: groupImgs,
      book: {
        id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        type: 'manga',
        format: 'images',
        title: folderName,
        cover: firstCoverUrl,
        coverBlob,
        pageItems: pageItems,
        pageCount: pageItems.length
      }
    };
  });
}
