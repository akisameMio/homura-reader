import { resolveBookFormat } from './utils.ts';
import type { Book } from '../types.ts';

export function bookShelfCategory(book: Book) {
  const format = resolveBookFormat(book);
  if (format === 'pdf') return 'other';
  if (book.type === 'manga') return 'manga';
  if (['epub', 'txt', 'markdown', 'mobi'].includes(format as string) || ['novel', 'epub'].includes(book.type as string)) return 'novel';
  return 'other';
}

export function groupShelfBooks(books: Book[]) {
  return [{ key: 'novel', title: '小说' }, { key: 'manga', title: '漫画' }, { key: 'other', title: '其他' }]
    .map(section => ({ ...section, books: books.filter(book => bookShelfCategory(book) === section.key) }))
    .filter(section => section.books.length);
}
