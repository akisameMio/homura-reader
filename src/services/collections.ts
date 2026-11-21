/* ============================================================================
   HOMURA · 书库与目录导入规划
   ========================================================================== */

import { normalizeBookTitle } from './bookTitles.ts';
import type { Collection, Book } from '../types.ts';

/** 书库校验用的最小结构：id + 可参与重名比较的标题（兼容 title / name 字段）。 */
interface CollectionLike {
  id: string;
  title?: string;
  name?: string;
  parentId?: string;
  [key: string]: unknown;
}

/** 目录导入规划用的文件输入（File 或带相对路径的自定义条目）。 */
interface ImportFileLike {
  name: string;
  webkitRelativePath?: string;
  customRelativePath?: string;
}

export function collectionNameError(title: unknown, collections: CollectionLike[], exceptId: string | null = null, parentId?: string) {
  const name = String(title || '').trim();
  if (!name) return '请输入书库名称';
  if (name.length > 80) return '书库名称最多 80 个字符';
  if (collections.some(item => item.id !== exceptId && item.parentId === parentId && normalizeBookTitle(item.title ?? item.name) === normalizeBookTitle(name))) {
    return '已有同名书库，请换一个名称';
  }
  return '';
}

export function moveCollectionBooks<T extends CollectionLike & { bookIds: string[] }>(collections: T[], bookIds: string[], targetId: string | null): T[] {
  if (targetId && !collections.some(item => item.id === targetId)) throw new Error('目标书库不存在');
  const ids = new Set(bookIds);
  return collections.map(item => ({
    ...item,
    bookIds: [...item.bookIds.filter((id: string) => !ids.has(id)), ...(item.id === targetId ? ids : [])]
  }));
}

export function restoreCollections(records: unknown[], books: Book[]) {
  const valid = new Set(books.map(book => book.id));
  const assigned = new Set<string>();
  const collectionIds = new Set<string>();
  const restored: Collection[] = [];
  for (const raw of records) {
    const item = raw as Partial<Collection>;
    if (!item || typeof item.id !== 'string' || collectionIds.has(item.id)) continue;
    collectionIds.add(item.id);
    const bookIds: string[] = [];
    for (const id of Array.isArray(item.bookIds) ? item.bookIds : []) {
      if (typeof id !== 'string' || !valid.has(id) || assigned.has(id)) continue;
      assigned.add(id);
      bookIds.push(id);
    }
    restored.push({
      id: item.id, title: String(item.title || item.name || '未命名书库'), createdAt: Number(item.createdAt) || 0, bookIds,
      ...(typeof item.parentId === 'string' && item.parentId ? { parentId: item.parentId } : {}),
      ...(typeof item.importFolderKey === 'string' && item.importFolderKey ? { importFolderKey: item.importFolderKey } : {})
    });
  }
  return normalizeCollectionParents(restored);
}

export function normalizeCollectionParents(collections: Collection[]) {
  const byId = new Map(collections.map(item => [item.id, item]));
  const checked = new Set<string>();
  for (const item of collections) {
    const trail = new Set<string>();
    let current = item;
    while (current.parentId && !checked.has(current.id)) {
      trail.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent || trail.has(parent.id)) {
        const { parentId: _parentId, ...root } = current;
        byId.set(root.id, root);
        break;
      }
      current = parent;
    }
    for (const id of trail) checked.add(id);
  }
  return [...byId.values()];
}

export function collectionPath(item: Collection, byId: ReadonlyMap<string, Collection>) {
  const names = [item.title || item.name || ''];
  for (let parentId = item.parentId; parentId;) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.push(parent.title || parent.name || '');
    parentId = parent.parentId;
  }
  return names.reverse().join(' / ');
}

export function availableCollectionName(title: unknown, collections: CollectionLike[], parentId?: string) {
  const base = String(title || '新建书库').trim().slice(0, 70) || '新建书库';
  let name = base;
  let suffix = 2;
  while (collectionNameError(name, collections, null, parentId)) name = `${base} (${suffix++})`;
  return name;
}

const BOOK_FILE = /\.(epub|pdf|cbz|zip|mobi|prc|azw|md|txt)$/i;
const IMAGE_FILE = /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i;

interface FolderGroup<T extends ImportFileLike = ImportFileLike> {
  path: string;
  title: string;
  files: T[];
  bookCount: number;
}

export function planFolderCollections<T extends ImportFileLike>(files: T[]) {
  const groups = new Map<string, FolderGroup<T>>();
  const imageFolders = new Set<string>();
  let hasDirectories = false;
  for (const file of files) {
    const parts = folderFileParts(file);
    if (parts.some(part => part.startsWith('.') || part === '__MACOSX')) continue;
    const isImage = IMAGE_FILE.test(file.name);
    if (!isImage && !BOOK_FILE.test(file.name)) continue;
    hasDirectories ||= parts.length > 1;
    const directory = parts.slice(0, -1);
    // 按直接所在目录统计作品；同目录散装图片合为一本漫画。
    const path = directory.join('/');
    if (!groups.has(path)) groups.set(path, { path, title: path.split('/').pop() || '导入书库', files: [], bookCount: 0 });
    const group = groups.get(path)!;
    group.files.push(file);
    const imagePath = directory.join('/');
    if (!isImage || !imageFolders.has(imagePath)) group.bookCount++;
    if (isImage) imageFolders.add(imagePath);
  }
  return { groups: [...groups.values()], hasDirectories, bookCount: [...groups.values()].reduce((sum, group) => sum + group.bookCount, 0) };
}


function folderFileParts(file: ImportFileLike) {
  return String(file.customRelativePath || file.webkitRelativePath || file.name).replace(/\\/g, '/').split('/').filter(Boolean);
}

export function importFolderPath(file: ImportFileLike) {
  return folderFileParts(file).slice(0, -1).join('/');
}

export interface ImportFolder {
  path: string;
  parentPath: string;
  title: string;
  depth: number;
  bookCount: number;
}

export function planImportFolders(groups: FolderGroup[]) {
  const folders = new Map<string, ImportFolder>();
  for (const group of groups) {
    const parts = group.path.split('/').filter(Boolean);
    // 所选根目录对应书架首页。完整路径仍用于归档和匹配此前导入的子书库。
    let parentPath = '';
    let path = parts[0];
    for (let index = 1; index < parts.length; index++) {
      const title = parts[index];
      path += '/' + title;
      if (!folders.has(path)) folders.set(path, { path, parentPath, title, depth: index - 1, bookCount: 0 });
      parentPath = path;
    }
    const folder = folders.get(group.path);
    if (folder) folder.bookCount += group.bookCount;
  }
  const children = new Map<string, ImportFolder[]>();
  for (const folder of folders.values()) {
    const siblings = children.get(folder.parentPath) ?? [];
    siblings.push(folder);
    children.set(folder.parentPath, siblings);
  }
  const ordered: ImportFolder[] = [];
  const pending = [...(children.get('') ?? [])].reverse();
  while (pending.length) {
    const folder = pending.pop()!;
    ordered.push(folder);
    const items = children.get(folder.path);
    if (items) for (let index = items.length - 1; index >= 0; index--) pending.push(items[index]);
  }
  return ordered;
}

export function assignImportedFolders(
  collections: Collection[],
  folders: ImportFolder[],
  booksByPath: ReadonlyMap<string, string[]>,
  sourceKey: string,
  createdAt: number,
  createId: () => string
) {
  const paths = new Map(folders.map(folder => [folder.path, folder]));
  const required = new Set<string>();
  for (const [path, ids] of booksByPath) {
    if (!ids.length) continue;
    for (let folder = paths.get(path); folder && !required.has(folder.path); folder = paths.get(folder.parentPath)) {
      required.add(folder.path);
    }
  }
  const next = [...collections];
  const foldersByKey = new Map<string, Collection>();
  const siblings = new Map<string | undefined, Collection[]>();
  for (const item of next) {
    if (item.importFolderKey) foldersByKey.set(item.importFolderKey, item);
    const items = siblings.get(item.parentId) ?? [];
    if (!siblings.has(item.parentId)) siblings.set(item.parentId, items);
    items.push(item);
  }
  const idsByPath = new Map<string, string>();
  const additions = new Map<string, string[]>();
  for (const folder of folders) {
    if (!required.has(folder.path)) continue;
    const parentId = idsByPath.get(folder.parentPath);
    const importFolderKey = JSON.stringify([sourceKey, folder.path]);
    let item = foldersByKey.get(importFolderKey);
    if (item && item.parentId !== parentId) {
      const items = siblings.get(parentId) ?? [];
      const title = availableCollectionName(item.title, items, parentId);
      const restored = { ...item, parentId, title };
      next[next.indexOf(item)] = restored;
      items.push(restored);
      siblings.set(parentId, items);
      item = restored;
    }
    if (!item) {
      const items = siblings.get(parentId) ?? [];
      item = {
        id: createId(), title: availableCollectionName(folder.title, items, parentId), createdAt, bookIds: [],
        ...(parentId ? { parentId } : {}),
        importFolderKey
      };
      items.push(item);
      siblings.set(parentId, items);
      next.push(item);
    }
    idsByPath.set(folder.path, item.id);
    const ids = booksByPath.get(folder.path);
    if (ids?.length) additions.set(item.id, ids);
  }
  const assigned = new Set([...additions.values()].flat());
  return next.map(item => ({
    ...item,
    bookIds: [...item.bookIds.filter(id => !assigned.has(id)), ...(additions.get(item.id) ?? [])]
  }));
}
