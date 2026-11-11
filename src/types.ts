// 全局领域类型定义：集中收纳 Book / Source / Page / ReaderConfig 等核心结构，
// 供 services、stores、composables、components 复用，避免散落各处的显式 any。

/** 书籍类型：漫画（图片流）或小说（文本流） */
export type BookType = 'manga' | 'novel';

/** 书籍来源格式 */
export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'txt' | 'markdown' | 'images' | 'cbz';

/** 阅读页：漫画为图片页，小说为分页后的文本片段，EPUB 为章节片段 */
export interface ReaderPage {
  type?: 'image' | 'text' | 'html' | string;
  title?: string;
  src?: string;
  url?: string;
  html?: string;
  htmlContent?: string;
  chapterIndex?: number;
  chapterTitle?: string;
  index?: number;
  pageNumber?: number;
  itemRef?: unknown;
  imageWidth?: number;
  imageHeight?: number;
  [key: string]: unknown;
}

/** PDF 页项：交给 PDF 渲染管道按页懒渲染 */
export interface PdfPageItem {
  render?: () => Promise<unknown>;
  url?: string;
  imageWidth?: number;
  imageHeight?: number;
  [key: string]: unknown;
}

/** 一章（EPUB / 小说）或一个漫画页条目 */
export interface ChapterItem {
  title?: string;
  html?: string;
  htmlContent?: string;
  imagesResolved?: boolean;
  [key: string]: unknown;
}

/** 书目元数据（IndexedDB / SQLite 镜像 / 内存 library 共用） */
export interface Book {
  id: string;
  title?: string;
  type?: BookType | string;
  format?: BookFormat | string;
  cover?: string | null;
  coverBlob?: Blob | null;
  author?: string;
  path?: string;
  name?: string;
  size?: number;
  pageCount?: number;
  pageItems?: PdfPageItem[] | null;
  chapters?: ChapterItem[] | null;
  pdfDoc?: unknown;
  pdfRange?: unknown;
  nativePath?: string;
  nativeArchiveId?: string;
  nativeArchivePath?: string | null;
  nativeArchiveMode?: string | null;
  nativeArchive?: unknown;
  nativeArchiveStaged?: boolean;
  collectionId?: string | null;
  isFavorite?: boolean;
  addedAt?: number;
  updatedAt?: number;
  lastReadAt?: number;
  coverThumb?: unknown;
  [key: string]: unknown;
}

/** 文件系统句柄（Structrual：浏览器 FileSystemFileHandle 的子集） */
export interface SourceFileHandle {
  getFile(): Promise<File>;
  queryPermission?(descriptor: { mode: string }): Promise<string>;
  requestPermission?(descriptor: { mode: string }): Promise<string>;
}

/** 原文件来源：File / FileSystemFileHandle / OPFS / Blob / 原生路径 / 文件夹 */
export interface BookSource {
  kind?: 'file' | 'folder' | string;
  name?: string;
  size?: number;
  lastModified?: number;
  blob?: Blob;
  handle?: SourceFileHandle | null;
  entries?: BookSource[];
  nativePath?: string;
  nativePageManifest?: unknown;
  opfsPath?: string;
  preStaged?: boolean;
  [key: string]: unknown;
}

/** 已导入的书（book + 来源组合的持久化入参） */
export interface ImportEntry {
  book: Book;
  source: BookSource;
  [key: string]: unknown;
}

/** 书库（收藏夹） */
export interface Collection {
  id: string;
  name?: string;
  title?: string;
  bookIds: string[];
  createdAt?: number;
  [key: string]: unknown;
}

/** 阅读排版配置 */
export interface ReaderLayoutConfig {
  direction?: 'horizontal' | 'vertical' | string;
  spread?: number | string;
  fontSize?: number | string;
  fontFamily?: string;
  lineHeight?: number | string;
  pageMargin?: number | string;
  coverOffset?: boolean;
  [key: string]: unknown;
}

/** 阅读进度 */
export interface ReadingProgress {
  page?: number;
  index?: number;
  direction?: string;
  spread?: number;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  pageMargin?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

/** 应用更新：一条 Release */
export interface Release {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: Array<{ name: string; browser_download_url: string; size: number; [key: string]: unknown }>;
  [key: string]: unknown;
}
