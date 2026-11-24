import type { Book, BookSource } from '../types.ts';
import { runShelfMutation } from './mutationQueue.ts';
import { fingerprintNativeReference, nativeReferencesOf, openNativeReferenceSource, pickNativeReferenceFiles, readNativeReferenceFile, releaseNativeReferences } from './nativeReference.ts';
import { removeNativeBookDir } from './nativeStorage.ts';
import { removeBookDir } from './opfs.ts';
import { loadSmartArchive, forgetSmartArchive } from './smartStorageRuntime.ts';
import { makeManagedNovelSource } from './managedBook.ts';
import { HomuraStore } from './storage.ts';
import { fingerprintSource } from './syncIdentity.ts';
import { canUseNativeArchive } from './nativeArchive.ts';
import { parseEpubNativeArchive } from './epubParser.ts';
import { discardParsedBook, parseCbzNativeArchive, parseMarkdownFile, parseMobiFileLazy, parseTxtFile } from './parsers.ts';
import { isAndroid } from './platform.ts';
import { parseRangeBook } from './rangeBook.ts';

export async function releaseUnusedReferences(tokens: Iterable<string>) {
  const requested = new Set(tokens);
  if (!requested.size) return;
  const remaining = await HomuraStore.listNativeReferences();
  await releaseNativeReferences([...requested].filter(token => !remaining.has(token)));
}

async function validateReplacementSource(source: BookSource & { nativeReference: string; nativePath: string }) {
  const input = await openNativeReferenceSource(source.nativeReference, source);
  const name = source.name || '';
  const id = `verify_${crypto.randomUUID()}`;
  let preview: Book | null;
  if (!isAndroid && canUseNativeArchive() && /\.(epub|cbz|zip)$/i.test(name)) {
    preview = /\.epub$/i.test(name)
      ? await parseEpubNativeArchive(source.nativePath, { id, name }) as Book | null
      : await parseCbzNativeArchive(source.nativePath, { id, name });
  } else if (/\.(epub|cbz|zip|pdf)$/i.test(name)) {
    preview = await parseRangeBook(input, name, id, { metadataOnly: /\.pdf$/i.test(name) });
  } else {
    const file = await readNativeReferenceFile(source.nativeReference, source);
    const parser = /\.md$/i.test(name) ? parseMarkdownFile : /\.txt$/i.test(name) ? parseTxtFile : parseMobiFileLazy;
    preview = await parser(file) as Book | null;
  }
  if (!preview) throw new Error('选中的原文件无法打开');
  await discardParsedBook(preview);
}

export async function relinkBookSource(book: Book) {
  const [file] = await pickNativeReferenceFiles(false);
  if (!file) return false;
  return runShelfMutation(async () => {
    let replaced = false;
    try {
      const previous = await HomuraStore.getSource(book.id) as BookSource | null;
      if (!previous || previous.kind === 'folder' || previous.kind === 'webdav') {
        throw new Error('此书不支持重新定位单个文件');
      }
      const expected = previous.contentFingerprint || await fingerprintSource(previous);
      const contentFingerprint = await fingerprintNativeReference(file.nativeReference);
      if (contentFingerprint !== expected) throw new Error('选中的文件与书架中的原书内容不同');
      const next = {
        kind: 'file',
        // 用已有名称保留格式判定，即使用户改了同一份文件的文件名。
        name: previous.name || file.name,
        size: file.size,
        lastModified: file.lastModified,
        nativePath: file.nativePath,
        nativeReference: file.nativeReference,
        contentFingerprint
      };
      await validateReplacementSource(next);
      await HomuraStore.replaceBookSource(book.id, next);
      replaced = true;
      book.restored = true;
      book.openedFromSmartArchive = false;
      await Promise.allSettled([
        forgetSmartArchive(book.id),
        removeNativeBookDir(book.id),
        removeBookDir(book.id),
        releaseUnusedReferences(nativeReferencesOf(previous))
      ]);
      return true;
    } finally {
      if (!replaced) await releaseNativeReferences([file.nativeReference]).catch(error => {
        console.warn('[HOMURA] 释放未使用的重新定位授权失败', error);
      });
    }
  });
}

export async function keepSmartArchive(book: Book) {
  return runShelfMutation(async () => {
    const previous = await HomuraStore.getSource(book.id) as BookSource | null;
    if (!previous) return false;
    const archive = await loadSmartArchive(book.id, previous);
    if (!archive) return false;
    await HomuraStore.replaceBookSource(book.id, makeManagedNovelSource(previous, archive));
    await forgetSmartArchive(book.id).catch(error => console.warn('[HOMURA] 回收临时阅读存档失败', error));
    await releaseUnusedReferences(nativeReferencesOf(previous)).catch(error => console.warn('[HOMURA] 释放导入授权失败', error));
    book.restored = true;
    book.openedFromSmartArchive = false;
    return true;
  });
}
