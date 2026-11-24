/* ============================================================================
   HOMURA · RangeSource 本地书籍解析
   ----------------------------------------------------------------------------
   SAF 等本地来源通过有界随机读取解析 EPUB、CBZ/ZIP 和 PDF。Book 中的 ZIP
   条目与 PDF 页渲染闭包继续持有 RangeSource，解析阶段不复制原文件或落盘。
   ========================================================================== */

import type { Book } from '../types.ts';
import { createCoverThumbnail } from './coverThumb.ts';
import { parseEpubArchive, type EpubArchive } from './epubParser.ts';
import { createPdfPageItems, openRemotePdfDocument, renderPdfCoverBlob } from './pdf.ts';
import { openRemoteZip, type RemoteZip, type RemoteZipEntry } from './remoteZip.ts';
import type { RangeSource } from './webdavBooks.ts';

const IMAGE_ENTRY = /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i;
const MAX_EPUB_TEXT_BYTES = 32 * 1024 * 1024;

function isJunkPath(path: string) {
  return path
    .split(/[\\/]/)
    .some(segment => segment === '__MACOSX' || segment === '.DS_Store' || segment.startsWith('._'));
}

function validName(name: string) {
  return typeof name === 'string'
    && !!name.trim()
    && !/[\\/\u0000-\u001f]/.test(name);
}

function createRangeEpubArchive(zip: RemoteZip): EpubArchive {
  return {
    kind: 'remote',
    zipContent: zip,
    hasPath: path => !!zip.file(path),
    resolvePath: paths => paths.find(path => !!zip.file(path)) || null,
    readTexts: async paths => {
      let total = 0;
      const texts: Array<string | null> = [];
      for (const path of paths) {
        const text = await zip.file(path)?.async('text') ?? null;
        total += text ? new TextEncoder().encode(text).byteLength : 0;
        if (total > MAX_EPUB_TEXT_BYTES) throw new Error('EPUB 文本超过 32 MiB 安全上限');
        texts.push(text);
      }
      return texts;
    },
    readBlobByPath: async path => await zip.file(path)?.async('blob') ?? null,
    makePageItem: (path, url) => ({ zipEntry: zip.file(path), url }),
    bookFields: () => ({ zipContent: zip })
  };
}

function imageEntries(zip: RemoteZip): RemoteZipEntry[] {
  return zip.entries
    .filter(entry => !entry.dir && IMAGE_ENTRY.test(entry.name) && !isJunkPath(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
}

async function parseRangeEpub(
  source: RangeSource,
  name: string,
  id: string,
  metadataOnly: boolean
): Promise<Book | null> {
  const zip = await openRemoteZip(source);
  const archive = createRangeEpubArchive(zip);
  const fallbackTitle = name.replace(/(\.kepub)?\.epub$/i, '');
  if (!metadataOnly) return await parseEpubArchive(archive, { id, fallbackTitle });

  const metadata = await parseEpubArchive(archive, { id, fallbackTitle, metadataOnly: true });
  if (!(metadata as Book & { needsFullParse?: boolean }).needsFullParse) return metadata;
  return await parseEpubArchive(archive, { id, fallbackTitle });
}

async function parseRangeCbz(source: RangeSource, name: string, id: string): Promise<Book | null> {
  const zip = await openRemoteZip(source);
  const entries = imageEntries(zip);
  if (entries.length === 0) throw new Error('压缩包内未找到图片');

  const firstImage = await entries[0].async('blob');
  const coverBlob = await createCoverThumbnail(firstImage) || firstImage;
  const cover = URL.createObjectURL(coverBlob);
  try {
    return {
      id,
      type: 'manga',
      format: 'cbz',
      title: name.replace(/\.(cbz|zip)$/i, ''),
      cover,
      coverBlob,
      pageItems: entries.map(entry => ({ zipEntry: entry, url: '' })),
      pageCount: entries.length,
      zipContent: zip
    };
  } catch (error) {
    URL.revokeObjectURL(cover);
    throw error;
  }
}

async function parseRangePdf(source: RangeSource, name: string, id: string, metadataOnly: boolean): Promise<Book | null> {
  const pdf = await openRemotePdfDocument(source);
  let cover: string | null = null;
  try {
    const pageCount = pdf.document.numPages || 0;
    if (pageCount <= 0) throw new Error('PDF 中没有可显示的页面');
    let coverBlob: Blob | null = null;
    if (!metadataOnly) {
      coverBlob = await renderPdfCoverBlob(pdf.document);
      cover = URL.createObjectURL(coverBlob);
    }
    return {
      id,
      type: 'manga',
      format: 'pdf',
      title: name.replace(/\.pdf$/i, ''),
      cover,
      coverBlob,
      pdfDoc: pdf.document,
      pageItems: createPdfPageItems(pdf.document, pageCount),
      pageCount
    };
  } catch (error) {
    if (cover) URL.revokeObjectURL(cover);
    await pdf.destroy().catch(() => {});
    throw error;
  }
}

export async function parseRangeBook(
  source: RangeSource,
  name: string,
  id: string,
  options: { metadataOnly?: boolean } = {}
): Promise<Book | null> {
  if (!source || !Number.isSafeInteger(source.size) || source.size < 1) throw new Error('书籍文件大小无效');
  if (!validName(name) || typeof id !== 'string' || !id.trim()) throw new Error('书籍名称或 ID 无效');
  const cleanName = name.trim();
  const cleanId = id.trim();

  if (/\.epub$/i.test(cleanName)) return await parseRangeEpub(source, cleanName, cleanId, options.metadataOnly === true);
  if (/\.(cbz|zip)$/i.test(cleanName)) return await parseRangeCbz(source, cleanName, cleanId);
  if (/\.pdf$/i.test(cleanName)) return await parseRangePdf(source, cleanName, cleanId, options.metadataOnly === true);
  return null;
}
