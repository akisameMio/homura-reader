/* ============================================================================
   HOMURA · 阅读器 Store
   ----------------------------------------------------------------------------
   当前书籍 / 页码 / 双缓冲槽位 / 排版配置，以及全部翻页与排版动作。
   注意：含 DOM 引用、Animation、timer、zipContent 的字段一律 shallowRef，
   避免 Vue 深度代理拖慢动画帧、避免 Animation 对象被代理后 cancel 异常。
   渲染本体在 PaginatedView.vue / WebtoonView.vue 内直操作 ref DOM，
   二者挂载时把渲染 / 滚动函数注册到本 store（renderFn / webtoonScrollBy /
   webtoonScrollTo），store 动作只负责状态流转后触发对应函数。
   ========================================================================== */

import { t } from '../composables/useI18n.ts';
import { defineStore } from 'pinia';
import { ref, shallowRef, reactive, computed, nextTick } from 'vue';
import { useShelfStore } from './shelf.ts';
import { useSettingsStore } from './settings.ts';
import { TRANSITION_OPTIONS, useThemeStore } from './theme.ts';
import { hydrateBook } from '../services/restore.ts';
import { buildActivePages, createNovelPaginator, getNovelPaginationKey, ensureBookImagesResolved, releaseBookPageUrls } from '../services/pagination.ts';
import {
  READER_FONT_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  READER_MARGIN_OPTIONS,
  resolveFontValue,
  resolveReaderMetrics
} from '../services/readerLayout.ts';
import { applyRestoredProgress, scheduleProgressSave, flushProgress } from '../services/progress.ts';
import { collectionReadingOrder, adjacentCollectionBook, spreadBounds } from '../services/collectionReading.ts';
import { hasArchiveSource } from '../services/archiveAccess.ts';
import { ensureNativeArchiveSession, releaseNativeArchiveSession } from '../services/nativeArchive.ts';
import type { Book, ReaderPage } from '../types.ts';

/** 长篇小说增量分页任务对象（内部仅 reader store 使用） */
interface NovelPaginationJob {
  bookId: string;
  paginator: import('../services/pagination.ts').NovelPaginatorBase;
  order: number[];
  cursor: number;
  idle: number | null;
  timer: number | null;
}

/** 排版配置（local，比 ReaderLayoutConfig 更贴合运行时的字符串档位） */
interface ReaderLayout {
  direction: string;
  pagedDirection: string;
  verticalText: boolean;
  spread: number;
  coverOffset: boolean;
  fontSize: number;
  webtoonFit: string;
  fontFamily: string;
  lineHeight: number | string;
  pageMargin: number | string;
  rtlInvertButtons?: boolean;
  [key: string]: unknown;
}

const LAYOUT_DIRECTIONS = ['ltr', 'rtl', 'vertical'];
const WEBTOON_FITS = ['screen', 'medium', 'wide'];
const LINE_HEIGHTS = READER_LINE_HEIGHT_OPTIONS.map(option => option.value);
const PAGE_MARGINS = READER_MARGIN_OPTIONS.map(option => option.value);
export const WEBTOON_FIT_LABELS = { screen: '完整单张', medium: '适中宽幅', wide: '超宽满屏' };
export const NOVEL_FONT_MIN = 14;
export const NOVEL_FONT_MAX = 28;
export const NOVEL_FONT_STEP = 2;

// 字号只提供 14–28px 的偶数档；旧记录里的奇数先归一到最近偶数。
function clampNovelFontSize(value: number) {
  return Math.min(NOVEL_FONT_MAX, Math.max(NOVEL_FONT_MIN, Math.round(value / NOVEL_FONT_STEP) * NOVEL_FONT_STEP));
}

const NOVEL_INCREMENTAL_MIN_CHAPTERS = 6;
const NOVEL_INCREMENTAL_MIN_CHARS = 60000;
const NOVEL_PAGINATION_SLICE_MS = 6;

export const useReaderStore = defineStore('reader', () => {
  const settings = useSettingsStore();
  const theme = useThemeStore();
  const currentBook = shallowRef<Book | null>(null);
  const shelf = useShelfStore();
  const openingBook = ref(false);
  const openError = ref('');
  const readingCollectionId = ref<string | null>(null);
  const collectionOrderIds = shallowRef<string[]>([]);
  const webtoonBounds = shallowRef({ atStart: true, atEnd: false });
  let openRequestToken = 0;
  const currentIndex = ref(0);
  // 「回到上次位置」：目录跳读前记下起点（锚点 + 页码），左下角出现 ↺ 页码 圆钮，
  // 点击回到跳读前的那一屏。锚点让字号 / 窗口重排后也能落回原章节位置。
  const previousLocation = shallowRef<{ index: number; anchor: { chapterIndex: number; ratio: number } | null; pageNumber: number } | null>(null);
  const activePages = shallowRef<ReaderPage[]>([]);
  const renderToken = ref(0);
  const webtoonObserver = shallowRef<ResizeObserver | null>(null);
  const lastWheelTurnTime = ref(0);

  // Double-Buffer State for 60fps / 120fps Hardware-Accelerated Page Turning
  const currentStageModeKey = ref('');
  const activeBufferSlot = ref(0); // 0 = Buffer A, 1 = Buffer B
  const activeTransitionAnims = shallowRef<Animation[]>([]);
  const preloadTimer = ref<number | null>(null);
  const resizeTimer = ref<number | null>(null);
  let fontPaginationTimer = 0;
  // 长篇小说在后台按章节增量补页；补页期间不把当前页判定成全书末页。
  const paginationPending = ref(false);
  let novelPaginationJob: NovelPaginationJob | null = null;
  // 已测出的分页尺寸；阅读器刚挂载时的 ResizeObserver 不应重复跑同一套分页。
  let activeNovelPaginationKey = '';
  // App.vue 的 #novelPaginationMeasurer 隐藏 div，供智能分页实测 scrollHeight
  const measurerEl = shallowRef<HTMLElement | null>(null);

  // 组件挂载时注册的渲染 / 滚动入口（PaginatedView / WebtoonView）
  const renderFn = shallowRef<((transitionDir: string) => void) | null>(null);
  const webtoonScrollBy = shallowRef<((direction: number) => void) | null>(null);
  const webtoonScrollTo = shallowRef<((index: number) => void) | null>(null);

  // 底栏页码与滑条位置由渲染函数回写，BottomBar 响应式读取
  const pageIndicator = ref('1 / 1');
  const sliderValue = ref(0);
  // 窄屏（<768）强制按单页渲染：双页并排在小屏上不可读
  const effectiveDouble = ref(false);

  const DOUBLE_SPREAD_MIN_WIDTH = 768;

  // 排版配置（纯数据，可安全响应式）
  const layoutConfig = reactive({
    ...settings.readerDefaults,
    rtlInvertButtons: true     // 日漫右→左模式下默认「左边是下一页」
  });
  const transitionStyle = computed(() => layoutConfig.direction === 'vertical' ? 'scroll' : theme.transitionStyle);

  const currentCollection = computed(() => currentBook.value ? shelf.collections.find(item => item.bookIds.includes(currentBook.value?.id ?? '')) || null : null);
  const collectionBooks = computed(() => {
    const collection = currentCollection.value;
    if (!collection) return [];
    const books = shelf.booksInCollection(collection.id);
    return collectionReadingOrder(books, (readingCollectionId.value === collection.id ? collectionOrderIds.value : []) as never[]);
  });
  const previousCollectionBook = computed(() => adjacentCollectionBook(collectionBooks.value, currentBook.value?.id ?? '', -1));
  const nextCollectionBook = computed(() => adjacentCollectionBook(collectionBooks.value, currentBook.value?.id ?? '', 1));
  const atFirstPage = computed(() => layoutConfig.direction === 'vertical' ? webtoonBounds.value.atStart : spreadBounds(currentIndex.value, activePages.value.length, effectiveDouble.value, layoutConfig.coverOffset).start === 0);
  const atLastPage = computed(() => {
    if (paginationPending.value) return false;
    return layoutConfig.direction === 'vertical'
      ? webtoonBounds.value.atEnd
      : activePages.value.length > 0 && spreadBounds(currentIndex.value, activePages.value.length, effectiveDouble.value, layoutConfig.coverOffset).end === activePages.value.length - 1;
  });

  // 跳读后才有返回目标；已经回到原来的那一屏（单双页同屏）时按钮自动消失
  const canReturnToPreviousLocation = computed(() => {
    const target = previousLocation.value;
    if (!target || !currentBook.value || layoutConfig.direction === 'vertical') return false;
    const total = activePages.value.length;
    if (!total) return false;
    const from = spreadBounds(target.index, total, effectiveDouble.value, layoutConfig.coverOffset).start;
    const now = spreadBounds(currentIndex.value, total, effectiveDouble.value, layoutConfig.coverOffset).start;
    return from !== now;
  });

  // ---- 纯派生逻辑（原 reader.js 的查询函数） ----

  function canUseDoubleSpread() {
    if (layoutConfig.spread !== 2) return false;
    if (typeof window === 'undefined') return true;
    if (currentBook.value?.type === 'manga') return window.innerWidth >= DOUBLE_SPREAD_MIN_WIDTH;
    const stage = document.querySelector<HTMLElement>('[data-reader-stage]');
    return resolveReaderMetrics({
      width: stage?.clientWidth || window.innerWidth,
      height: stage?.clientHeight || window.innerHeight,
      layout: layoutConfig,
      compact: window.innerWidth < 900
    }).isDouble;
  }

  // 同步「当前实际是否双页」，供顶栏状态与窗口尺寸变化判断复用
  function syncEffectiveSpread() {
    effectiveDouble.value = canUseDoubleSpread();
    return effectiveDouble.value;
  }

  function getSpreadPair(index: number) {
    const bounds = spreadBounds(index, activePages.value.length, syncEffectiveSpread(), layoutConfig.coverOffset);
    return activePages.value.slice(bounds.start, bounds.end + 1);
  }

  function getStepSizeForNext() {
    if (!syncEffectiveSpread()) return 1;
    if (layoutConfig.coverOffset && currentIndex.value === 0) return 1;
    return 2;
  }

  function getStepSizeForPrev() {
    if (!syncEffectiveSpread()) return 1;
    if (layoutConfig.coverOffset && currentIndex.value === 1) return 1;
    return 2;
  }

  function isNavigationInverted() {
    return layoutConfig.direction === 'rtl' && layoutConfig.rtlInvertButtons;
  }

  // ---- 渲染触发：条漫模式由 WebtoonView 响应式自渲染，翻页模式调注册函数 ----

  function requestRender(transitionDir = 'fade') {
    if (layoutConfig.direction === 'vertical') return;
    const fn = renderFn.value;
    if (fn) fn(transitionDir);
  }

  // progress service 需要 reader 形状的对象；store 内部动作传快照，避免依赖 this
  function progressSnapshot() {
    return {
      currentBook: currentBook.value,
      activePages: activePages.value,
      currentIndex: currentIndex.value,
      layoutConfig
    };
  }

  function touchProgress() {
    const shelf = useShelfStore();
    scheduleProgressSave(progressSnapshot(), shelf);
  }

  // ---- 打开 / 关闭 ----

  // 打开书籍时先套用设置页默认值，再用这本书自己的排版记录覆盖
  function applyLayoutForBook(book: Book) {
    const shelf = useShelfStore();
    const rec = shelf.progressMap[book.id];
    const saved = (rec && rec.layout) as ReaderLayout | undefined | null;
    const next: ReaderLayout = { ...settings.readerDefaults } as ReaderLayout;
    // PDF 版式固定、字号小，双页并排会挤成一团：首次打开默认单页
    if (!saved) {
      if (book.format === 'pdf') next.spread = 1;
      // MOBI 漫画的 EXTH 会标出原生翻页方向；不覆盖用户主动选的 RTL / 条漫。
      if (book.type === 'manga' && book.readingDirection === 'rtl' && next.direction === 'ltr') {
        next.direction = 'rtl';
      }
      if (next.direction !== 'vertical') next.pagedDirection = next.direction;
      return next;
    }

    if (LAYOUT_DIRECTIONS.includes(saved.direction)) next.direction = saved.direction;
    if (typeof saved.verticalText === 'boolean') next.verticalText = saved.verticalText;
    if (saved.spread === 1 || saved.spread === 2) next.spread = saved.spread;
    if (typeof saved.coverOffset === 'boolean') next.coverOffset = saved.coverOffset;
    if (Number.isFinite(saved.fontSize)) next.fontSize = clampNovelFontSize(saved.fontSize);
    if (WEBTOON_FITS.includes(saved.webtoonFit)) next.webtoonFit = saved.webtoonFit;
    if (saved.fontFamily) next.fontFamily = resolveFontValue(saved.fontFamily);
    if (LINE_HEIGHTS.includes(saved.lineHeight as string)) next.lineHeight = saved.lineHeight;
    if (PAGE_MARGINS.includes(saved.pageMargin as string)) next.pageMargin = saved.pageMargin;
    // 旧版把 comic MOBI 当小说读过，ltr 只是当时的默认值；转成漫画后按书里的方向来。
    if (book.type === 'manga' && book.readingDirection === 'rtl' && next.direction === 'ltr' && rec.type !== 'manga') {
      next.direction = 'rtl';
    }
    next.pagedDirection = next.direction !== 'vertical' ? next.direction
      : saved.pagedDirection === 'ltr' || saved.pagedDirection === 'rtl' ? saved.pagedDirection : next.pagedDirection;
    return next;
  }

  function applyReaderDefaults() {
    Object.assign(layoutConfig, settings.readerDefaults);
  }

  // ---- 长篇小说增量分页 ----
  // 先同步测出当前章节，首屏马上可读；其余章节用 idle 时间片补齐。
  // 补页期间用「整章一页」占位，目录、滑条和章节导航始终有效。

  function shouldUseIncrementalNovelPagination(book: Book, layout: ReaderLayout) {
    if (book.type === 'manga' || layout.direction === 'vertical') return false;
    const chapters = book.chapters || [];
    if (chapters.length >= NOVEL_INCREMENTAL_MIN_CHAPTERS) return true;
    let chars = 0;
    for (const chap of chapters) {
      chars += chap?.htmlContent?.length || 0;
      if (chars >= NOVEL_INCREMENTAL_MIN_CHARS) return true;
    }
    return false;
  }

  function cancelNovelPagination() {
    const job = novelPaginationJob;
    novelPaginationJob = null;
    paginationPending.value = false;
    if (job) {
      if (job.idle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(job.idle);
      if (job.timer) window.clearTimeout(job.timer);
    }
    if (measurerEl.value) measurerEl.value.innerHTML = '';
  }

  function chapterPageRange(pages: ReaderPage[], index: number) {
    const page = pages[index];
    if (!page || typeof page.chapterIndex !== 'number') return null;
    let start = index;
    let end = index;
    while (start > 0 && pages[start - 1]?.chapterIndex === page.chapterIndex) start--;
    while (end < pages.length - 1 && pages[end + 1]?.chapterIndex === page.chapterIndex) end++;
    return { chapterIndex: page.chapterIndex, start, end };
  }

  function novelAnchorFromPages(pages: ReaderPage[], index: number) {
    const range = chapterPageRange(pages, index);
    if (!range) return null;
    return {
      chapterIndex: range.chapterIndex,
      ratio: range.end > range.start ? (index - range.start) / (range.end - range.start) : 0
    };
  }

  function novelAnchorFromProgress(book: Book) {
    const rec = shelf.progressMap[book.id];
    if (!rec) return null;
    const chapters = book.chapters || [];
    if (!chapters.length) return null;
    const savedChapterIndex = rec.chapterIndex;
    let chapterIndex = Number.isInteger(savedChapterIndex) ? (savedChapterIndex as number) : -1;
    if (chapterIndex < 0 || chapterIndex >= chapters.length) {
      chapterIndex = Math.min(chapters.length - 1, Math.max(0, Math.floor((Number(rec.ratio) || 0) * chapters.length)));
    }
    const chapterRatio = Number(rec.chapterRatio);
    return {
      chapterIndex,
      ratio: Number.isFinite(chapterRatio) ? Math.min(1, Math.max(0, chapterRatio)) : 0
    };
  }

  function findAnchorIndex(pages: ReaderPage[], anchor: { chapterIndex: number; ratio: number } | null) {
    if (!anchor) return -1;
    const indexes: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].chapterIndex !== anchor.chapterIndex) continue;
      if (!pages[i].provisional) indexes.push(i);
    }
    if (!indexes.length) {
      return pages.findIndex((page: ReaderPage) => page.chapterIndex === anchor.chapterIndex);
    }
    const ratio = Math.min(1, Math.max(0, anchor.ratio || 0));
    return indexes[Math.round(ratio * (indexes.length - 1))];
  }

  function planNovelPages(book: Book, layout: ReaderLayout, anchorOverride: { chapterIndex: number; ratio: number } | undefined = undefined): { pages: ReaderPage[]; incremental: boolean; job: NovelPaginationJob | null; restoredIndex: number; key: string } {
    cancelNovelPagination();
    const key = getNovelPaginationKey(layout);
    if (!shouldUseIncrementalNovelPagination(book, layout)) {
      return { pages: buildActivePages(book, layout, measurerEl.value as HTMLElement), incremental: false, job: null, restoredIndex: -1, key };
    }

    const chapters = book.chapters || [];
    const anchor = anchorOverride === undefined ? novelAnchorFromProgress(book) : anchorOverride;
    const paginator = createNovelPaginator(book, layout, measurerEl.value as HTMLElement);
    if (paginator.complete) {
      return { pages: (paginator.pages || []) as unknown as ReaderPage[], incremental: false, job: null, restoredIndex: -1, key };
    }

    const targetChapter = Math.min(chapters.length - 1, Math.max(0, anchor?.chapterIndex ?? 0));
    paginator.paginateChapter(targetChapter);
    const pages = paginator.buildPages({ provisional: true }) as unknown as ReaderPage[];
    const restoredIndex = findAnchorIndex(pages, { chapterIndex: targetChapter, ratio: anchor?.ratio ?? 0 });
    const order: number[] = [];
    for (let distance = 1; distance < chapters.length; distance++) {
      if (targetChapter + distance < chapters.length) order.push(targetChapter + distance);
      if (targetChapter - distance >= 0) order.push(targetChapter - distance);
    }

    return {
      pages,
      incremental: true,
      restoredIndex: Math.max(0, restoredIndex),
      key,
      job: { bookId: book.id, paginator, order, cursor: 0, idle: null, timer: null }
    };
  }

  function updatePendingPageIndicator(pages: ReaderPage[]) {
    if (!pages.length || layoutConfig.direction === 'vertical') return;
    const bounds = spreadBounds(currentIndex.value, pages.length, effectiveDouble.value, layoutConfig.coverOffset);
    const visible: number[] = [];
    for (let i = bounds.start; i <= bounds.end; i++) {
      if (pages[i]) visible.push(pages[i].pageNumber as number);
    }
    pageIndicator.value = `${visible.join('-')} / ${pages.length}`;
  }

  function applyNovelPaginationBatch(pages: ReaderPage[], done: boolean) {
    const oldPages = activePages.value;
    const anchor = novelAnchorFromPages(oldPages, currentIndex.value);
    const wasProvisional = !!oldPages[currentIndex.value]?.provisional;
    const nextIndex = findAnchorIndex(pages, anchor);
    activePages.value = pages;
    if (nextIndex >= 0) currentIndex.value = Math.min(pages.length - 1, nextIndex);
    else currentIndex.value = Math.min(currentIndex.value, Math.max(0, pages.length - 1));
    sliderValue.value = currentIndex.value;
    updatePendingPageIndicator(pages);
    // 当前章从整章占位换成正式分页时重绘一次；其它切片只改页码，不动 DOM。
    if (!done && wasProvisional && !pages[currentIndex.value]?.provisional) requestRender('none');
  }

  function scheduleNovelPagination() {
    const job = novelPaginationJob;
    if (!job) return;
    if (typeof requestIdleCallback === 'function') {
      job.idle = requestIdleCallback(deadline => {
        job.idle = null;
        runNovelPaginationSlice(job, deadline);
      }, { timeout: 220 });
    } else {
      job.timer = window.setTimeout(() => {
        job.timer = null;
        runNovelPaginationSlice(job, null);
      }, 16);
    }
  }

  function runNovelPaginationSlice(job: NovelPaginationJob, deadline: IdleDeadline | null) {
    if (novelPaginationJob !== job) return;
    if (!currentBook.value || currentBook.value.id !== job.bookId) {
      cancelNovelPagination();
      return;
    }
    const started = performance.now();
    while (job.cursor < job.order.length) {
      job.paginator.paginateChapter(job.order[job.cursor++]);
      if (performance.now() - started >= NOVEL_PAGINATION_SLICE_MS) break;
      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() <= 1) break;
    }
    const done = job.paginator.isComplete();
    applyNovelPaginationBatch(job.paginator.buildPages({ provisional: !done }) as unknown as ReaderPage[], done);
    if (!done) {
      scheduleNovelPagination();
      return;
    }
    job.paginator.commitCache();
    novelPaginationJob = null;
    paginationPending.value = false;
    if (measurerEl.value) measurerEl.value.innerHTML = '';
    requestRender('none');
    touchProgress();
  }

  function beginNovelPagination(job: NovelPaginationJob | null) {
    if (!job) return;
    novelPaginationJob = job;
    paginationPending.value = true;
    scheduleNovelPagination();
  }

  async function openBook(id: string, options: { preserveCollectionOrder?: boolean; position?: 'start' | 'end' | string; finishCurrent?: boolean; [key: string]: unknown } = {}) {
    const book = shelf.library.find((b: Book) => b.id === id);
    if (!book) return false;
    const previousBook = currentBook.value;
    const token = ++openRequestToken;
    openingBook.value = true;
    openError.value = '';
    try {
      if (book.restored) {
        if (!(await hydrateBook(book))) throw new Error(t('本地存档无法读取，请重新导入'));
        if (token !== openRequestToken) return false;
        shelf.touchBook(book);
      }
      // CBZ 页面项只持有压缩包 id；关书会释放 ZipFile，再开时在这里恢复句柄。
      if (book.nativeArchiveId) {
        await ensureNativeArchiveSession(book as unknown as { nativeArchiveId?: string | null; nativeArchivePath?: string | null; pageItems?: { nativeArchiveId?: string; nativeArchivePath?: string }[] | null });
        if (token !== openRequestToken) return false;
      }
      if (book.type !== 'manga' && hasArchiveSource(book) && book.chapters) {
        await ensureBookImagesResolved(book);
        if (token !== openRequestToken) return false;
      }
      const collection = shelf.collections.find(item => item.bookIds.includes(id));
      const nextLayout = applyLayoutForBook(book);
      if (options.preserveCollectionOrder && collection?.id === readingCollectionId.value && layoutConfig.direction === 'vertical') {
        nextLayout.direction = 'vertical';
        nextLayout.webtoonFit = layoutConfig.webtoonFit;
      }
      const explicitAnchor = options.position === 'end'
        ? { chapterIndex: Math.max(0, (book.chapters?.length || 1) - 1), ratio: 1 }
        : options.position === 'start'
          ? { chapterIndex: 0, ratio: 0 }
          : undefined;
      const pagePlan = planNovelPages(book, nextLayout, explicitAnchor);
      const pages = pagePlan.pages;
      if (!pages.length) throw new Error(t('没有可阅读的页面'));
      // 固定进入阅读器时的顺序，防止“最近阅读”时间更新后前后本突然重排。
      const order = options.preserveCollectionOrder && collection?.id === currentCollection.value?.id
        ? collectionBooks.value.map(item => item.id)
        : collection ? shelf.booksInCollection(collection.id).map(item => item.id) : [];
      if (currentBook.value && currentBook.value.id !== id) {
        const snapshot = progressSnapshot();
        if (options.finishCurrent) snapshot.currentIndex = Math.max(0, snapshot.activePages.length - 1);
        await flushProgress(snapshot, shelf);
      }
      if (token !== openRequestToken) return false;
      window.clearTimeout(preloadTimer.value ?? undefined);
      window.clearTimeout(resizeTimer.value ?? undefined);
      window.clearTimeout(fontPaginationTimer);
      fontPaginationTimer = 0;
      cancelNovelPagination();
      renderToken.value++;
      webtoonObserver.value?.disconnect();
      webtoonObserver.value = null;
      activeTransitionAnims.value.forEach(animation => { try { animation.cancel(); } catch (err) {} });
      activeTransitionAnims.value = [];
      const restoredIdx = pagePlan.incremental
        ? pagePlan.restoredIndex
        : applyRestoredProgress(book, pages, shelf.progressMap);
      Object.assign(layoutConfig, nextLayout);
      activePages.value = pages;
      currentIndex.value = options.position === 'end' ? pages.length - 1 : options.position === 'start' ? 0 : Math.max(0, restoredIdx);
      effectiveDouble.value = canUseDoubleSpread();
      readingCollectionId.value = collection?.id || null;
      collectionOrderIds.value = order;
      webtoonBounds.value = { atStart: currentIndex.value === 0, atEnd: false };
      currentBook.value = book;
      previousLocation.value = null;
      activeNovelPaginationKey = pagePlan.key || '';
      beginNovelPagination(pagePlan.job);
      if (previousBook && previousBook.id !== id) {
        void releaseNativeArchiveSession(previousBook as unknown as { nativeArchiveId?: string | null; nativeArchivePath?: string | null; pageItems?: { nativeArchiveId?: string; nativeArchivePath?: string }[] | null });
      }
      // 先让旧翻页组件卸载、新组件接管渲染入口，再绘制目标书，避免旧缓冲串页。
      await nextTick();
      if (token !== openRequestToken) return false;
      if (previousBook && previousBook.id !== id) releaseBookPageUrls(previousBook);
      requestRender('none');
      return true;
    } catch (err: unknown) {
      if (token === openRequestToken) {
        openError.value = t('无法打开《{0}》：{1}', { 0: book.title, 1: (err as Error).message || t('请检查本地存档') });
        console.warn('[HOMURA] 打开书本失败', err);
      }
      return false;
    } finally {
      if (token === openRequestToken) openingBook.value = false;
    }
  }

  function clearOpenError() { openError.value = ''; }

  function openAdjacentCollectionBook(direction: number) {
    if (openingBook.value) return;
    const target = direction > 0 ? nextCollectionBook.value : previousCollectionBook.value;
    if (!target) return;
    return openBook(target.id, { position: direction > 0 ? 'start' : 'end', preserveCollectionOrder: true, finishCurrent: direction > 0 });
  }

  function openCollectionBook(id: string) {
    if (!collectionBooks.value.some(book => book.id === id)) return Promise.resolve(false);
    if (id === currentBook.value?.id) return Promise.resolve(true);
    return openBook(id, { preserveCollectionOrder: true });
  }

  function closeReader() {
    openRequestToken++;
    openingBook.value = false;
    openError.value = '';
    readingCollectionId.value = null;
    collectionOrderIds.value = [];
    previousLocation.value = null;
    cancelNovelPagination();
    activeNovelPaginationKey = '';
    const shelf = useShelfStore();
    // 关闭前把防抖窗口内尚未落盘的位置补写一次，此时 currentBook 仍然有效
    flushProgress(progressSnapshot(), shelf);
    if (webtoonObserver.value) {
      webtoonObserver.value.disconnect();
      webtoonObserver.value = null;
    }
    window.clearTimeout(preloadTimer.value ?? undefined);
    window.clearTimeout(fontPaginationTimer);
    fontPaginationTimer = 0;
    const closedBook = currentBook.value;
    currentBook.value = null;
    if (closedBook) releaseBookPageUrls(closedBook);
    void releaseNativeArchiveSession(closedBook as unknown as { nativeArchiveId?: string | null; nativeArchivePath?: string | null; pageItems?: { nativeArchiveId?: string; nativeArchivePath?: string }[] | null });
    // 进度已通过 progressMap 响应式流回书架卡片，无需手动重绘书架
  }

  // ---- 排版设置 ----

  // 小说重排：保持阅读比例不变，按新窗口 / 字号 / 单双页重新切页
  function recalculateNovelPaginationAndRender() {
    window.clearTimeout(fontPaginationTimer);
    fontPaginationTimer = 0;
    const book = currentBook.value;
    if (!book || book.type === 'manga' || !measurerEl.value) return;

    const anchor = novelAnchorFromPages(activePages.value, currentIndex.value) || novelAnchorFromProgress(book);

    // 切到纵向长卷不需要测量：一章就是一页，按章节把当前位置带过去。
    if (layoutConfig.direction === 'vertical') {
      cancelNovelPagination();
      activeNovelPaginationKey = '';
      const chapters = buildActivePages(book, layoutConfig, measurerEl.value);
      activePages.value = chapters;
      const next = anchor ? chapters.findIndex((page: ReaderPage) => page.chapterIndex === anchor.chapterIndex) : 0;
      currentIndex.value = Math.max(0, next);
      sliderValue.value = currentIndex.value;
      requestRender('none');
      touchProgress();
      return;
    }

    // 阅读器首次挂载时 stage 尺寸探测会触发一次 resize；尺寸没变就别把刚测好的分页推翻重来。
    if (getNovelPaginationKey(layoutConfig) === activeNovelPaginationKey) return;
    const pagePlan = planNovelPages(book, layoutConfig, anchor ?? undefined);
    activeNovelPaginationKey = pagePlan.key || '';
    activePages.value = pagePlan.pages;
    const nextIndex = findAnchorIndex(pagePlan.pages, anchor);
    currentIndex.value = Math.max(0, Math.min(pagePlan.pages.length - 1, nextIndex >= 0 ? nextIndex : 0));
    sliderValue.value = currentIndex.value;
    beginNovelPagination(pagePlan.job);
    requestRender('none');
    touchProgress();
  }

  // 窗口尺寸 / 视口高度变化：漫画只在单双页档位变化时重渲染，小说则重新分页
  function handleViewportChange() {
    if (!currentBook.value || layoutConfig.direction === 'vertical') return;
    window.clearTimeout(resizeTimer.value ?? undefined);
    resizeTimer.value = window.setTimeout(() => {
      if (!currentBook.value || layoutConfig.direction === 'vertical') return;
      if (currentBook.value.type === 'manga') {
        const next = canUseDoubleSpread();
        if (next !== effectiveDouble.value) {
          effectiveDouble.value = next;
          requestRender('none');
        }
      } else {
        recalculateNovelPaginationAndRender();
      }
    }, 180);
  }

  function setDirection(dir: string) {
    if (!LAYOUT_DIRECTIONS.includes(dir)) return;
    const prevDir = layoutConfig.direction;
    if (dir !== 'vertical') layoutConfig.pagedDirection = dir;
    else if (prevDir !== 'vertical') layoutConfig.pagedDirection = prevDir;
    layoutConfig.direction = dir;
    if (dir === 'rtl') {
      layoutConfig.rtlInvertButtons = true;
    }
    if (currentBook.value && currentBook.value.type !== 'manga' && (prevDir === 'vertical' || dir === 'vertical')) {
      recalculateNovelPaginationAndRender();
    } else {
      requestRender('fade');
    }
    touchProgress();
  }

  function setTransitionStyle(style: string) {
    if (!TRANSITION_OPTIONS.some(option => option.value === style)) return;
    if (style === 'scroll') {
      if (layoutConfig.direction !== 'vertical') setDirection('vertical');
    } else {
      theme.setTransitionStyle(style);
      if (layoutConfig.direction === 'vertical') setDirection(layoutConfig.pagedDirection);
    }
  }

  function setSpreadCount(count: number) {
    layoutConfig.spread = count;
    if (layoutConfig.direction === 'vertical') {
      layoutConfig.direction = layoutConfig.pagedDirection;
    }
    if (currentBook.value && currentBook.value.type !== 'manga') {
      recalculateNovelPaginationAndRender();
    } else {
      requestRender('fade');
    }
  }

  function toggleCoverOffset() {
    layoutConfig.coverOffset = !layoutConfig.coverOffset;
    requestRender('fade');
  }

  function setWebtoonFit(fit: string) {
    if (!WEBTOON_FITS.includes(fit) || layoutConfig.webtoonFit === fit) return;
    layoutConfig.webtoonFit = fit;
    // 条漫模式下 WebtoonView 通过 :class 绑定响应尺寸变化，无需重渲染
    requestRender('none');
  }

  function setFontSize(value: number) {
    if (!currentBook.value || currentBook.value.type === 'manga' || !Number.isFinite(Number(value))) return;
    const size = clampNovelFontSize(Number(value));
    if (size === layoutConfig.fontSize) {
      // 拖动回到原字号时，取消尚未执行的整本重排即可，当前页仍然有效。
      window.clearTimeout(fontPaginationTimer);
      fontPaginationTimer = 0;
      return;
    }
    layoutConfig.fontSize = size;
    // 先让当前页立即反馈新字号，再在停止拖动后统一重排整本。
    // 拖一次滑块会触发几十个 input 事件，逐次同步分页会直接卡死主线程。
    touchProgress();
    window.clearTimeout(fontPaginationTimer);
    fontPaginationTimer = window.setTimeout(() => {
      fontPaginationTimer = 0;
      recalculateNovelPaginationAndRender();
    }, 140);
  }

  // delta 即像素步长，由调用方决定（组件传 ±NOVEL_FONT_STEP），store 不再二次归一步长。
  function changeFontSize(delta: number) {
    if (!delta) return;
    setFontSize(layoutConfig.fontSize + delta);
  }

  // 字体 / 行距 / 页边距都会改写每行字数，必须整本重排；漫画与条漫只刷新视图。
  function updateNovelTypography(patch: Record<string, unknown>) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if ((layoutConfig as Record<string, any>)[key] === value) continue;
      (layoutConfig as Record<string, any>)[key] = value;
      changed = true;
    }
    if (!changed) return;
    if (currentBook.value && currentBook.value.type !== 'manga' && layoutConfig.direction !== 'vertical') {
      recalculateNovelPaginationAndRender();
    } else {
      requestRender('fade');
    }
  }

  function setFontFamily(value: string) {
    if (!READER_FONT_OPTIONS.some(option => option.value === value)) return;
    updateNovelTypography({ fontFamily: value });
  }

  function setLineHeight(value: string) {
    if (!LINE_HEIGHTS.includes(value)) return;
    updateNovelTypography({ lineHeight: value });
  }

  function setPageMargin(value: string) {
    if (!PAGE_MARGINS.includes(value)) return;
    updateNovelTypography({ pageMargin: value });
  }

  function setVerticalText(value: boolean) {
    if (!currentBook.value || currentBook.value.type === 'manga' || layoutConfig.direction === 'vertical') return;
    updateNovelTypography({ verticalText: !!value });
    touchProgress();
  }

  async function setCustomCover(file: File | null) {
    const id = currentBook.value?.id;
    if (!id) return;
    const book = await shelf.setBookCover(id, file);
    if (book && currentBook.value?.id === id) currentBook.value = { ...currentBook.value, cover: book.cover, customCoverBlob: book.customCoverBlob };
  }

  // ---- 翻页 ----

  function goNextPage() {
    if (!currentBook.value || openingBook.value) return;
    if (currentCollection.value && atLastPage.value) return openAdjacentCollectionBook(1);
    if (layoutConfig.direction === 'vertical') {
      if (webtoonScrollBy.value) webtoonScrollBy.value(1);
      return;
    }
    const step = getStepSizeForNext();
    // In LTR, Next page slides in from Right ('enter-from-right').
    // In Japanese RTL, Next page slides in from Left ('enter-from-left').
    const slideDir = layoutConfig.direction === 'rtl' ? 'enter-from-left' : 'enter-from-right';

    if (currentIndex.value + step < activePages.value.length) {
      currentIndex.value += step;
      requestRender(slideDir);
    } else if (currentIndex.value < activePages.value.length - 1) {
      currentIndex.value = activePages.value.length - 1;
      requestRender(slideDir);
    }
  }

  function goPrevPage() {
    if (!currentBook.value || openingBook.value) return;
    if (currentCollection.value && atFirstPage.value) return openAdjacentCollectionBook(-1);
    if (layoutConfig.direction === 'vertical') {
      if (webtoonScrollBy.value) webtoonScrollBy.value(-1);
      return;
    }
    const step = getStepSizeForPrev();
    const slideDir = layoutConfig.direction === 'rtl' ? 'enter-from-right' : 'enter-from-left';

    if (currentIndex.value - step >= 0) {
      currentIndex.value -= step;
      requestRender(slideDir);
    } else if (currentIndex.value > 0) {
      currentIndex.value = 0;
      requestRender(slideDir);
    }
  }

  function onLeftButtonClick() {
    if (isNavigationInverted()) goNextPage();
    else goPrevPage();
  }

  function onRightButtonClick() {
    if (isNavigationInverted()) goPrevPage();
    else goNextPage();
  }

  // 记录当前屏的位置快照，供目录跳读后回退
  function captureLocation() {
    const page = activePages.value[currentIndex.value];
    if (!page) return null;
    return {
      index: currentIndex.value,
      anchor: novelAnchorFromPages(activePages.value, currentIndex.value),
      pageNumber: Number(page.pageNumber) || currentIndex.value + 1
    };
  }

  // 目录 / 页码跳读：先记住起点，跳完若仍在同一屏就不显示返回按钮
  function jumpToPage(index: number) {
    if (!currentBook.value) return;
    const total = activePages.value.length;
    if (!total) return;
    const target = Math.max(0, Math.min(total - 1, parseInt(String(index), 10) || 0));
    const origin = captureLocation();
    onSliderInput(target);
    if (!origin) return;
    const from = spreadBounds(origin.index, total, effectiveDouble.value, layoutConfig.coverOffset).start;
    const now = spreadBounds(currentIndex.value, total, effectiveDouble.value, layoutConfig.coverOffset).start;
    previousLocation.value = from !== now ? origin : null;
  }

  // 回到跳读前的那一屏：优先按锚点还原，排版变化后也不会漂到别的章节
  function returnToPreviousLocation() {
    const target = previousLocation.value;
    if (!target || !currentBook.value) return;
    const total = activePages.value.length;
    if (!total) return;
    previousLocation.value = null;
    let index = target.index;
    if (target.anchor) {
      const resolved = findAnchorIndex(activePages.value, target.anchor);
      if (resolved >= 0) index = resolved;
    }
    index = Math.max(0, Math.min(total - 1, index));
    if (layoutConfig.direction === 'vertical') {
      currentIndex.value = index;
      if (webtoonScrollTo.value) webtoonScrollTo.value(index);
      touchProgress();
      return;
    }
    const forward = index > currentIndex.value;
    const slideDir = forward
      ? (layoutConfig.direction === 'rtl' ? 'enter-from-left' : 'enter-from-right')
      : (layoutConfig.direction === 'rtl' ? 'enter-from-right' : 'enter-from-left');
    currentIndex.value = index;
    requestRender(slideDir);
    touchProgress();
  }

  function onSliderInput(val: string | number) {
    currentIndex.value = parseInt(String(val), 10) || 0;
    if (layoutConfig.direction === 'vertical') {
      if (webtoonScrollTo.value) webtoonScrollTo.value(currentIndex.value);
      pageIndicator.value = `${currentIndex.value + 1} / ${activePages.value.length}`;
      sliderValue.value = currentIndex.value;
      touchProgress();
      return;
    }
    requestRender('fade');
  }

  return {
    currentBook,
    currentCollection,
    collectionBooks,
    previousCollectionBook,
    nextCollectionBook,
    atFirstPage,
    atLastPage,
    webtoonBounds,
    openingBook,
    openError,
    clearOpenError,
    openCollectionBook,
    currentIndex,
    activePages,
    renderToken,
    webtoonObserver,
    lastWheelTurnTime,
    currentStageModeKey,
    activeBufferSlot,
    activeTransitionAnims,
    preloadTimer,
    resizeTimer,
    paginationPending,
    measurerEl,
    renderFn,
    webtoonScrollBy,
    webtoonScrollTo,
    pageIndicator,
    sliderValue,
    layoutConfig,
    transitionStyle,
    effectiveDouble,
    getSpreadPair,
    getStepSizeForNext,
    getStepSizeForPrev,
    isNavigationInverted,
    requestRender,
    touchProgress,
    openBook,
    closeReader,
    recalculateNovelPaginationAndRender,
    handleViewportChange,
    applyReaderDefaults,
    setDirection,
    setTransitionStyle,
    setSpreadCount,
    toggleCoverOffset,
    setWebtoonFit,
    changeFontSize,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setPageMargin,
    setVerticalText,
    setCustomCover,
    goNextPage,
    goPrevPage,
    onLeftButtonClick,
    onRightButtonClick,
    onSliderInput,
    previousLocation,
    canReturnToPreviousLocation,
    jumpToPage,
    returnToPreviousLocation
  };
});
