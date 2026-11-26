/* ============================================================================
   HOMURA · 远程书籍会话
   ----------------------------------------------------------------------------
   在线阅读创建内存中的 Book；云端书架仅保存引用与封面，原文件不入本地存档。
   关闭阅读器后中止网络并释放远程会话与位图。
   ========================================================================== */
import type { Book } from '../types.ts';
import { type DavEntry, WebDavBooksClient } from './webdavBooks.ts';
import { openRemoteZip } from './remoteZip.ts';
import { parseEpubArchive, type EpubArchive } from './epubParser.ts';
import { parseTxtFile, parseMarkdownFile } from './parsers.ts';
import { makeRemoteBookSource, remoteBookId, type RemoteBookSource } from './remoteBookSource.ts';
import { createCoverThumbnail } from './coverThumb.ts';
import { createPdfPageItems, openRemotePdfDocument, renderPdfCoverBlob } from './pdf.ts';
import { readPdfOutline } from './pdfOutline.ts';

export function canReadRemote(entry: DavEntry) {
  return !entry.directory && /\.(epub|cbz|zip|pdf|txt|md)$/i.test(entry.name);
}

export async function openRemoteBook(client: WebDavBooksClient, entry: DavEntry, username: string, onError?: (message: string) => void): Promise<Book> {
  const sourceRef = makeRemoteBookSource({ url: client.root, username, password: '' }, entry);
  const id = await remoteBookId(sourceRef);
  let book: Book | null = null;
  let destroyPdf: (() => void) | undefined;
  try {
    if (!canReadRemote(entry)) throw new Error('此格式暂不支持远程阅读');
    const original = await client.open(entry);
    const source: typeof original = {
      size: original.size,
      get closed() { return original.closed; },
      async read(start, end) {
        try { return await original.read(start, end); } catch (error) {
          if (!original.closed) onError?.(error instanceof Error ? error.message : '无法读取远程目录');
          throw error;
        }
      }
    };
    if (/\.pdf$/i.test(entry.name)) {
      const pdf = await openRemotePdfDocument(source);
      destroyPdf = () => { void pdf.destroy().catch(() => {}); };
      const outline = await readPdfOutline(pdf.document);
      book = { id, type: 'manga', format: 'pdf', title: entry.name.replace(/\.pdf$/i, ''), pdfDoc: pdf.document, outline, pageItems: createPdfPageItems(pdf.document, pdf.document.numPages), pageCount: pdf.document.numPages };
    } else if (/\.(txt|md)$/i.test(entry.name)) {
      // 文本格式需完整正文才能分页，只进内存，不保存原文件；避免超大文本耗尽 WebView。
      if (source.size > 8 * 1024 * 1024) throw new Error('远程文本超过 8 MiB 上限');
      const bytes = await source.read(0, source.size);
      const file = new File([bytes as BlobPart], entry.name);
      book = await (/\.md$/i.test(entry.name) ? parseMarkdownFile(file) : parseTxtFile(file)) as Book | null;
    } else {
      const zip = await openRemoteZip(source);
      if (/\.epub$/i.test(entry.name)) {
        const archive: EpubArchive = {
          kind: 'remote', zipContent: zip,
          hasPath: path => !!zip.file(path),
          resolvePath: paths => paths.find(path => !!zip.file(path)) || null,
          readTexts: async paths => {
            let total = 0;
            const texts: (string | null)[] = [];
            for (const path of paths) {
              const text = await zip.file(path)?.async('text') ?? null;
              total += text ? new TextEncoder().encode(text).length : 0;
              if (total > 32 * 1024 * 1024) throw new Error('远端压缩包无效、已加密或超过安全限制');
              texts.push(text);
            }
            return texts;
          },
          readBlobByPath: async path => await zip.file(path)?.async('blob') ?? null,
          makePageItem: (path, url) => ({ zipEntry: zip.file(path), url }),
          bookFields: () => ({ zipContent: zip })
        };
        book = await parseEpubArchive(archive, { id, fallbackTitle: entry.name.replace(/(\.kepub)?\.epub$/i, '') }) as Book | null;
      } else {
        const entries = zip.entries.filter(item => !item.dir && /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i.test(item.name)
          && !item.name.split('/').some(part => part === '__MACOSX' || part.startsWith('.')))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        if (!entries.length) throw new Error('压缩包内未找到图片');
        book = { id, type: 'manga', format: 'cbz', title: entry.name.replace(/\.(cbz|zip)$/i, ''), pageItems: entries.map(zipEntry => ({ zipEntry, url: '' })), pageCount: entries.length };
      }
    }
    if (!book) throw new Error('无法解析远程书籍');
    book.id = id;
    book.remote = true;
    book.remoteDispose = () => {
      client.close();
      destroyPdf?.();
      for (const url of [book?.cover, ...((book?.resourceUrls || []) as string[])]) {
        if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
    };
    return book;
  } catch (error) {
    client.close(); destroyPdf?.();
    throw error;
  }
}

// 入架时只保留轻量书目和封面缩略图，解析会话在返回前释放。
export async function prepareRemoteShelfBook(client: WebDavBooksClient, entry: DavEntry, username: string): Promise<{ book: Book; source: RemoteBookSource }> {
  let parsed: Book | null = null;
  try {
    const source = makeRemoteBookSource({ url: client.root, username, password: '' }, entry);
    parsed = await openRemoteBook(client, entry, username);
    let cover = parsed.coverBlob;
    if (!cover && parsed.format === 'pdf') cover = await renderPdfCoverBlob(parsed.pdfDoc as Parameters<typeof renderPdfCoverBlob>[0]);
    if (!cover && parsed.type === 'manga') {
      const first = parsed.pageItems?.[0] as { zipEntry?: { async(type: 'blob'): Promise<Blob> } } | undefined;
      cover = await first?.zipEntry?.async('blob');
    }
    const coverBlob = cover ? await createCoverThumbnail(cover) : null;
    return {
      source,
      book: {
        id: parsed.id, type: parsed.type, format: parsed.format, title: parsed.title,
        pageCount: parsed.pageCount, remote: true, remoteShelf: true, restored: true,
        coverBlob, cover: coverBlob ? URL.createObjectURL(coverBlob) : null
      }
    };
  } finally {
    if (typeof parsed?.remoteDispose === 'function') parsed.remoteDispose();
    else client.close();
  }
}
