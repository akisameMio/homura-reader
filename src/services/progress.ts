/* ============================================================================
   HOMURA · 阅读进度记忆
   ----------------------------------------------------------------------------
   把每本书的当前位置按比例写进 IndexedDB，重开时按新分页结果换算出页码。
   写盘做了 350ms 防抖，避免连续翻页刷盘。
   本模块不持有状态：reader / shelf store 由调用方传入。
   ========================================================================== */

import { HomuraStore } from './storage.ts';
import type { Book, ReaderPage, ReadingProgress } from '../types.ts';

const SAVE_DEBOUNCE_MS = 350;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 进度记录追加的排版字段（webtoonFit 不在基础 ReadingProgress 里）。 */
interface ProgressLayout {
  direction?: string;
  pagedDirection?: string;
  verticalText?: boolean;
  spread?: number;
  coverOffset?: boolean;
  fontSize?: number;
  webtoonFit?: unknown;
  fontFamily?: string | unknown;
  lineHeight?: number | unknown;
  pageMargin?: number | unknown;
}

interface ProgressRecord extends ReadingProgress {
  layout?: ProgressLayout;
  chapterIndex?: number;
  chapterRatio?: number;
  total?: number;
  ratio?: number;
  type?: string;
}

/** reader store 里进度计算所需的最小结构。 */
interface ReaderLike {
  currentBook: Book | null;
  activePages: ReaderPage[];
  currentIndex: number;
  layoutConfig: ProgressLayout;
}

/** shelf store 里进度回写所需的最小结构。 */
interface ShelfLike {
  setProgressRecord(record: ProgressRecord): void;
}


function makeRecord(reader: ReaderLike) {
  const book = reader.currentBook;
  const total = reader.activePages.length;
  if (!book || total === 0) return null;
  const lastIdx = Math.max(0, total - 1);
  const index = Math.min(lastIdx, Math.max(0, reader.currentIndex));
  const currentPage = reader.activePages[index];
  const chapterIndex = currentPage && typeof currentPage.chapterIndex === 'number' ? currentPage.chapterIndex : 0;
  // 章内比例用于增量分页恢复：整本页数尚未补齐时也能命中同一章里的相近位置。
  let chapterStart = index;
  let chapterEnd = index;
  while (chapterStart > 0 && reader.activePages[chapterStart - 1]?.chapterIndex === chapterIndex) chapterStart--;
  while (chapterEnd < lastIdx && reader.activePages[chapterEnd + 1]?.chapterIndex === chapterIndex) chapterEnd++;
  return {
    id: book.id,
    type: book.type,
    index,
    total,
    ratio: lastIdx > 0 ? index / lastIdx : 0,
    chapterIndex,
    chapterRatio: chapterEnd > chapterStart ? (index - chapterStart) / (chapterEnd - chapterStart) : 0,
    // 每本书自己的排版：方向 / 单双页 / 首页单排 / 字号 / 条漫尺寸
    layout: {
      direction: reader.layoutConfig.direction,
      pagedDirection: reader.layoutConfig.pagedDirection,
      verticalText: reader.layoutConfig.verticalText,
      spread: reader.layoutConfig.spread,
      coverOffset: reader.layoutConfig.coverOffset,
      fontSize: reader.layoutConfig.fontSize,
      webtoonFit: reader.layoutConfig.webtoonFit,
      fontFamily: reader.layoutConfig.fontFamily,
      lineHeight: reader.layoutConfig.lineHeight,
      pageMargin: reader.layoutConfig.pageMargin
    },
    updatedAt: Date.now()
  };
}

function writeCurrentProgress(reader: ReaderLike, shelf: ShelfLike) {
  const record = makeRecord(reader);
  if (!record) return Promise.resolve();
  // 先同步更新内存表，书架重绘时能立刻读到最新百分比
  shelf.setProgressRecord(record);
  return HomuraStore.saveProgress(record).catch(() => {});
}

// 启动时把整张进度表读进内存，书架渲染可以直接同步读取
export async function loadProgressMap() {
  try {
    const list = await HomuraStore.listProgress();
    const map: Record<string, ProgressRecord> = {};
    list.forEach((rec: ProgressRecord) => {
      const id = typeof rec?.id === 'string' ? rec.id : null;
      if (rec && id) map[id] = rec;
    });
    return map;
  } catch (err) {
    return {};
  }
}

// 在 buildActivePages() 之后调用：按比例换算出新分页下的位置；返回 -1 表示无记录
export function applyRestoredProgress(book: Book | null | undefined, activePages: ReaderPage[], progressMap: Record<string, ProgressRecord>) {
  const rec = book && progressMap[book.id];
  if (!rec || activePages.length === 0) return -1;
  const lastIdx = Math.max(0, activePages.length - 1);
  const ratio = typeof rec.ratio === 'number' ? rec.ratio : 0;
  return Math.min(lastIdx, Math.max(0, Math.round(ratio * lastIdx)));
}

export function scheduleProgressSave(reader: ReaderLike, shelf: ShelfLike) {
  if (!reader.currentBook) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeCurrentProgress(reader, shelf);
  }, SAVE_DEBOUNCE_MS);
}

export function flushProgress(reader: ReaderLike, shelf: ShelfLike) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  return writeCurrentProgress(reader, shelf);
}

// 关窗 / 切后台时兜底刷写，防止防抖窗口内的最后一次翻页丢失
export function installProgressFlushHooks(reader: ReaderLike, shelf: ShelfLike) {
  window.addEventListener('beforeunload', () => { flushProgress(reader, shelf); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushProgress(reader, shelf);
  });
}
