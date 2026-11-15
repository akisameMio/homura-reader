/* ============================================================================
   HOMURA · 可同步的本地元数据投影
   ----------------------------------------------------------------------------
   只导出阅读位置、收藏与书库；路径、原文件、封面和设备排版不进入远端文档。
   ========================================================================== */

import type { Book, Collection, ReadingProgress } from '../types.ts';

export interface SyncLocalSnapshot {
  books: Book[];
  progress: ReadingProgress[];
  collections: Collection[];
}

const POSITION_KEYS = ['index', 'total', 'ratio', 'chapterIndex', 'chapterRatio', 'updatedAt'] as const;

export function portableProgress(record: ReadingProgress | undefined | null): Record<string, number> | null {
  if (!record) return null;
  const value: Record<string, number> = {};
  for (const key of POSITION_KEYS) {
    const item = record[key];
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) value[key] = item;
  }
  return Object.keys(value).length ? value : null;
}

export function replacePortableProgress(previous: ReadingProgress | undefined, position: ReadingProgress | null): ReadingProgress | null {
  const next = { ...previous };
  for (const key of POSITION_KEYS) delete next[key];
  Object.assign(next, portableProgress(position));
  return Object.keys(next).some(key => key !== 'id') ? next : null;
}

export function localSnapshotSignature(snapshot: SyncLocalSnapshot): string {
  const sort = <T extends { id: string }>(items: T[]) => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.stringify({
    books: sort(snapshot.books.map(book => ({ id: book.id, favorite: !!book.favorite }))),
    progress: sort(snapshot.progress.map(record => ({ id: String(record.id), value: portableProgress(record) }))),
    collections: sort(snapshot.collections.map(item => ({
      id: item.id, title: item.title || item.name || '', createdAt: item.createdAt || 0, bookIds: item.bookIds
    })))
  });
}
