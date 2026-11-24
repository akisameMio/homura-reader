import type { Book, BookSource } from '../types.ts';
import {
  deserializeManagedNovelSource,
  serializeManagedNovelSource,
  type ManagedNovelAsset,
  type ManagedNovelFormat,
  type ManagedNovelSourcePayloadV1
} from './smartStorage.ts';
import { readArchiveBlobByPath } from './archiveAccess.ts';

const MAX_EMBEDDED_ASSET_BYTES = 64 * 1024 * 1024;

export function canStoreManagedNovel(book: Book) {
  return (book.format === 'txt' || book.format === 'markdown' || book.format === 'mobi' || book.format === 'epub')
    && (book.type === 'novel' || book.type === 'epub')
    && book.epubFixedLayout !== true
    && !!book.chapters?.length;
}

export async function buildManagedNovel(book: Book, fingerprint: string | undefined) {
  if (!fingerprint || !canStoreManagedNovel(book)) return null;
  const assets = new Map<string, ManagedNovelAsset>();
  const uriPaths = new Map<string, string>();
  let assetBytes = 0;
  const chapters = [];
  for (const chapter of book.chapters || []) {
    let content = chapter.htmlContent || '';
    if ((book.format === 'epub' || book.format === 'mobi') && /\b(?:data-zip-path\s*=|blob:)/i.test(content)) {
      const document = new DOMParser().parseFromString(content, 'text/html');
      for (const image of document.querySelectorAll('img, svg image')) {
        const originalPath = image.getAttribute('data-zip-path');
        const attribute = image.localName === 'image' ? 'href' : 'src';
        const url = image.getAttribute(attribute) || image.getAttribute('xlink:href');
        if (!originalPath && !url?.startsWith('blob:')) continue;
        const key = originalPath || url!;
        let path = uriPaths.get(key);
        if (!path) {
          const blob = originalPath
            ? await readArchiveBlobByPath(book, originalPath)
            : await fetch(url!).then(response => response.ok ? response.blob() : null);
          if (!blob || blob.size === 0 || assetBytes + blob.size > MAX_EMBEDDED_ASSET_BYTES) return null;
          assetBytes += blob.size;
          path = `assets/${assets.size}`;
          uriPaths.set(key, path);
          assets.set(path, { path, mediaType: blob.type || 'application/octet-stream', bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        image.setAttribute('data-zip-path', path);
        image.removeAttribute(attribute);
        image.removeAttribute('xlink:href');
      }
      content = document.body.innerHTML;
      if (/\bblob:/i.test(content)) return null;
    }
    chapters.push({ title: chapter.title, content, contentKind: 'html' as const, sourcePath: chapter.sourcePath });
  }
  return serializeManagedNovelSource({
    format: book.format as ManagedNovelFormat,
    sourceFingerprint: fingerprint,
    title: book.title,
    chapters,
    assets: [...assets.values()]
  });
}

export function applyManagedNovel(book: Book, value: unknown): ManagedNovelSourcePayloadV1 {
  const archive = deserializeManagedNovelSource(value);
  book.type = archive.format === 'epub' ? 'epub' : 'novel';
  book.format = archive.format;
  book.chapters = archive.chapters.map(chapter => ({
    title: chapter.title,
    htmlContent: chapter.content,
    sourcePath: chapter.sourcePath
  }));
  const assets = new Map(archive.assets.map(asset => [asset.path, new Blob([asset.bytes as BlobPart], { type: asset.mediaType })]));
  book.zipContent = assets.size ? {
    file(path: string) {
      const blob = assets.get(path);
      return blob ? { async: (type: 'blob' | 'text') => type === 'text' ? blob.text() : Promise.resolve(blob) } : null;
    }
  } : null;
  book.nativeArchiveId = undefined;
  book.nativeArchivePath = null;
  book.nativeEntryIndexByPath = null;
  book.epubImageUrls = null;
  book.resourceUrls = [];
  book.pageCount = book.chapters.length;
  book.restored = false;
  return archive;
}

export function makeManagedNovelSource(source: BookSource, archive: ManagedNovelSourcePayloadV1): BookSource {
  return {
    kind: 'managed',
    name: source.name,
    size: source.size,
    lastModified: source.lastModified,
    contentFingerprint: archive.sourceFingerprint,
    managedStorageVersion: 1,
    managedArchive: archive
  };
}
