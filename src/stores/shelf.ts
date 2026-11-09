/* ============================================================================
   HOMURA · 书架 Store
   ----------------------------------------------------------------------------
   library / progressMap，增删清空、进度查询、示例书与 IndexedDB 恢复。
   书籍对象内含 zipContent / File 等重对象，library 用 shallowRef 持有，
   书籍内部字段的变更通过替换数组或显式触发来驱动视图更新。
   ========================================================================== */

import { defineStore } from 'pinia';
import { shallowRef, ref } from 'vue';
import { collectionNameError, moveCollectionBooks, restoreCollections } from '../services/collections.ts';
import { sortShelfBooks } from '../services/bookTitles.ts';
import { HomuraStore } from '../services/storage.ts';
import { restoreLibrary, persistBook, persistBooks } from '../services/restore.ts';
import { loadProgressMap } from '../services/progress.ts';
import { createDemoManga, createDemoNovel } from '../services/demo.ts';
import { prepareBookCover } from '../services/bookCover.ts';
import { createCoverThumbnail } from '../services/coverThumb.ts';
import { runShelfMutation } from '../services/mutationQueue.ts';
import type { Book, BookSource, Collection, ImportEntry, ReadingProgress } from '../types.ts';

export const useShelfStore = defineStore('shelf', () => {
  const library = shallowRef<Book[]>([]);
  const progressMap = shallowRef<Record<string, ReadingProgress>>({});
  const collections = shallowRef<Collection[]>([]);
  const activeCollectionId = ref<string | null>(null);
  const sortKey = ref('title');
  const error = ref('');
  let collectionQueue: Promise<unknown> = Promise.resolve();
  let favoriteQueue: Promise<unknown> = Promise.resolve();
  let coverOptimizationQueued = false;

  function booksInCollection(id: string) {
    const collection = collections.value.find(item => item.id === id);
    if (!collection) return [];
    const ids = new Set(collection.bookIds);
    return sortShelfBooks(library.value.filter(book => ids.has(book.id)), sortKey.value, progressMap.value);
  }

  function updateCollections(change: (current: Collection[]) => Collection[]) {
    const task = collectionQueue.then(async () => {
      const next = change(collections.value);
      await HomuraStore.saveCollections(next);
      collections.value = next;
      error.value = '';
    });
    collectionQueue = task.catch(err => {
      error.value = err.message || '书库保存失败，请重试';
      console.warn('[HOMURA] 书库保存失败', err);
    });
    return task;
  }

  async function createCollection(title: string) {
    const item = { id: `collection_${crypto.randomUUID()}`, title: title.trim(), createdAt: Date.now(), bookIds: [] };
    await updateCollections((current: Collection[]) => {
      const message = collectionNameError(title, current);
      if (message) throw new Error(message);
      return [...current, item];
    });
    return item;
  }

  function renameCollection(id: string, title: string) {
    return updateCollections((current: Collection[]) => {
      const message = collectionNameError(title, current, id);
      if (message) throw new Error(message);
      return current.map((item: Collection) => item.id === id ? { ...item, title: title.trim() } : item);
    });
  }

  async function deleteCollection(id: string) {
    await updateCollections((current: Collection[]) => current.filter((item: Collection) => item.id !== id));
    if (activeCollectionId.value === id) activeCollectionId.value = null;
  }

  function moveBooks(ids: string[], targetId: string | null = null) {
    const existing = new Set(library.value.map(book => book.id));
    return updateCollections((current: Collection[]) => moveCollectionBooks(current, ids.filter((id: string) => existing.has(id)), targetId));
  }

  function unshiftBook(book: Book) {
    library.value = [book, ...library.value];
  }

  // 新增书籍并落盘；写入失败由导入层汇总记录
  async function addBook(book: Book, source: BookSource, options: { onSaved?: (book: Book) => unknown | Promise<unknown>; [key: string]: unknown } = {}) {
    if (!source) throw new Error('缺少原文件来源');
    try {
      const result = await persistBook(book, source, options);
      if (options.onSaved) {
        try {
          await options.onSaved(book);
        } catch (err) {
          console.warn('[HOMURA] 书本入架前释放资源失败', err);
        }
      }
      // 只有元数据与原文件都提交成功后才公开这本书，避免失败导入留下无法恢复的幽灵书。
      unshiftBook(book);
      return result;
    } catch (err) {
      console.error('[HOMURA] 本地存档写入失败', err);
      throw err;
    }
  }

  // 批量导入：整批落盘成功后只替换一次 library，避免每加一本就重排整架。
  async function addBooks(items: ImportEntry[], options: { onSaved?: (book: Book) => unknown | Promise<unknown>; [key: string]: unknown } = {}) {
    if (!items.length) return { saved: [], failed: [] };
    try {
      const result = await persistBooks(items, options);
      if (options.onSaved) {
        for (const book of result.saved) {
          try {
            await options.onSaved(book);
          } catch (err) {
            console.warn('[HOMURA] 书本入架前释放资源失败', err);
          }
        }
      }
      if (result.saved.length) {
        // 与逐本 unshift 的最终顺序保持一致：后导入的排在前面。
        library.value = [...result.saved.slice().reverse(), ...library.value];
      }
      return result;
    } catch (err) {
      console.error('[HOMURA] 本地存档批量写入失败', err);
      throw err;
    }
  }

  async function removeBook(id: string) {
    try {
      await HomuraStore.deleteBook(id);
    } catch (err) {
      error.value = (err as Error).message || '移除书本失败，请重试';
      console.error('[HOMURA] 移除书本失败', err);
      throw err;
    }
    library.value = library.value.filter(b => b.id !== id);
    if (progressMap.value[id]) {
      const next = { ...progressMap.value };
      delete next[id];
      progressMap.value = next;
    }
    if (collections.value.some(item => item.bookIds.includes(id))) {
      try {
        await updateCollections((current: Collection[]) => moveCollectionBooks(current, [id], null));
      } catch (err) {
        console.warn('[HOMURA] 书本已移除，但书库归属清理失败', err);
      }
    }
  }

  async function clearShelf() {
    return runShelfMutation(async () => {
      // 清空与导入共用互斥队列；清空完成后才允许下一批文件写入存储。
      await collectionQueue.catch(() => {});
      await HomuraStore.clear();
      library.value = [];
      progressMap.value = {};
      collections.value = [];
      activeCollectionId.value = null;
      error.value = '';
    }).catch(err => {
      error.value = err.message || '清空书架失败，请重试';
      console.warn('[HOMURA] 清空书架失败', err);
      throw err;
    });
  }

  async function clearProgress() {
    try {
      await HomuraStore.clearProgress();
      progressMap.value = {};
    } catch (err) {
      console.error('[HOMURA] 清空阅读进度失败', err);
      throw err;
    }
  }

  // hydrateBook 会就地改写 book 字段，调用后触发一次浅刷新让卡片更新
  function touchBook(book: Book) {
    const idx = library.value.findIndex(b => b.id === book.id);
    if (idx === -1) return;
    const next = library.value.slice();
    next[idx] = Object.assign({}, book);
    library.value = next;
  }

  function setProgressRecord(record: ReadingProgress & { id: string }) {
    progressMap.value = Object.assign({}, progressMap.value, { [record.id]: record });
  }

  async function setBookCover(id: string, file: File | null) {
    let book = library.value.find(item => item.id === id);
    if (!book) throw new Error('书本已从书架移除');
    const blob = file ? await prepareBookCover(file) : null;
    // 示例内容没有原始文件存档，封面随本次示例一起保留在内存中。
    if (!id.startsWith('demo_')) await HomuraStore.updateBookCover(id, blob as Blob | null);
    book = library.value.find(item => item.id === id);
    if (!book) return null;
    if (!book.customCoverBlob) book.originalCover = book.cover;
    const previous = book.cover;
    book.customCoverBlob = blob;
    book.cover = blob ? URL.createObjectURL(blob as Blob) : ((book.originalCover as string | undefined) || (book.coverBlob ? URL.createObjectURL(book.coverBlob as Blob) : null));
    if (previous?.startsWith('blob:') && previous !== book.originalCover && previous !== book.cover) URL.revokeObjectURL(previous);
    touchBook(book);
    return book;
  }

  function updateFavorite(id: string, change: (favorite: boolean) => boolean) {
    const task = favoriteQueue.then(async () => {
      const book = library.value.find(item => item.id === id);
      if (!book) throw new Error('书本已从书架移除');
      const favorite = change(!!book.favorite);
      if (favorite === !!book.favorite) return favorite;
      if (!id.startsWith('demo_')) await HomuraStore.updateBookFavorite(id, favorite);
      library.value = library.value.map(item => item.id === id ? { ...item, favorite } : item);
      return favorite;
    });
    favoriteQueue = task.catch(() => {});
    return task;
  }

  function toggleFavorite(id: string) { return updateFavorite(id, (favorite: boolean) => !favorite); }
  function setFavorite(id: string, favorite: boolean) { return updateFavorite(id, () => !!favorite); }

  // 书架展示用：无记录或仍在第一页时不显示，避免满屏「读至 0%」
  function progressInfoFor(bookId: string): { percent: number; index: number; total: number; updatedAt: number } | null {
    const rec = progressMap.value[bookId];
    if (!rec) return null;
    const ratio = typeof rec.ratio === 'number' ? rec.ratio : 0;
    const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
    if (percent <= 0) return null;
    return {
      percent,
      index: typeof rec.index === 'number' ? rec.index : 0,
      total: typeof rec.total === 'number' ? rec.total : 0,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : 0
    };
  }

  // 启动初始化：恢复书架 + 进度表；第一次使用时放示例书
  async function optimizeStoredCover(book: Book) {
    const patch: Record<string, unknown> = {};
    if (book.coverBlob) {
      const thumb = await createCoverThumbnail(book.coverBlob);
      if (thumb && thumb !== book.coverBlob) patch.coverBlob = thumb;
    }
    if (book.customCoverBlob) {
      const thumb = await createCoverThumbnail(book.customCoverBlob as Blob);
      if (thumb && thumb !== book.customCoverBlob) patch.customCoverBlob = thumb;
    }
    if (!Object.keys(patch).length) return;

    await HomuraStore.updateBookMeta(book.id, patch);
    const current = library.value.find(item => item.id === book.id);
    if (!current) return;
    Object.assign(current, patch);
    const source = current.customCoverBlob || current.coverBlob;
    const previous = current.cover;
    if (source) current.cover = URL.createObjectURL(source as Blob);
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    touchBook(current);
  }

  const COVER_THUMB_VERSION_KEY = 'homura-cover-thumb-version';
  const COVER_THUMB_VERSION = '2';

  // 旧版本把原图直接存进书架。启动后利用空闲时间逐本换成长边 480px 的封面，
  // 避免一次性解码整库封面把启动和滚动拖慢；迁移完成后记版本号，后续只处理大图。
  function scheduleCoverOptimization(books: Book[]) {
    if (coverOptimizationQueued) return;
    let needsMigration = false;
    try {
      needsMigration = localStorage.getItem(COVER_THUMB_VERSION_KEY) !== COVER_THUMB_VERSION;
    } catch (err) {
      needsMigration = false;
    }
    if (!needsMigration) return;
    const candidates = books.filter((book: Book) => book.restored
      && !book.id.startsWith('demo_')
      && (book.coverBlob || book.customCoverBlob));
    if (!candidates.length) {
      if (needsMigration) {
        try { localStorage.setItem(COVER_THUMB_VERSION_KEY, COVER_THUMB_VERSION); } catch (err) {}
      }
      return;
    }
    coverOptimizationQueued = true;
    let index = 0;

    const run = async () => {
      if (index >= candidates.length) {
        if (needsMigration) {
          try { localStorage.setItem(COVER_THUMB_VERSION_KEY, COVER_THUMB_VERSION); } catch (err) {}
        }
        return;
      }
      if (document.visibilityState === 'hidden' || document.documentElement.classList.contains('reader-active')) {
        setTimeout(scheduleNext, 1800);
        return;
      }
      const book = candidates[index++];
      try {
        await optimizeStoredCover(book);
      } catch (err) {
        console.warn('[HOMURA] 封面缩略图生成失败', err);
      }
      scheduleNext();
    };

    const scheduleNext = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 4000 });
      } else {
        setTimeout(run, 900);
      }
    };
    setTimeout(scheduleNext, 2200);
  }

  async function loadLibrary() {
    const restored = await restoreLibrary();
    progressMap.value = await loadProgressMap();
    if (restored === null) return false;
    library.value = restored as Book[];
    scheduleCoverOptimization(restored as Book[]);
    collections.value = restoreCollections(await HomuraStore.listCollections(), restored as Book[]);
    if (restored.length === 0 && collections.value.length === 0) {
      unshiftBook(createDemoNovel() as Book);
      unshiftBook(createDemoManga() as Book);
    }
    return restored.length > 0;
  }

  return {
    library,
    progressMap,
    collections,
    activeCollectionId,
    sortKey,
    booksInCollection,
    error,
    createCollection,
    renameCollection,
    deleteCollection,
    moveBooks,
    addBook,
    addBooks,
    unshiftBook,
    removeBook,
    clearShelf,
    clearProgress,
    touchBook,
    setBookCover,
    toggleFavorite,
    setFavorite,
    setProgressRecord,
    progressInfoFor,
    loadLibrary
  };
});
