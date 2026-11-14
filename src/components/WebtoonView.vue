<template>
  <div class="relative w-full h-full">
    <!-- Manga: 纵向条漫瀑布流，图片懒加载 -->
    <div
      v-if="isManga"
      ref="scrollRoot"
      data-reader-scroll
      class="no-scrollbar w-full h-full overflow-y-auto overscroll-contain touch-pan-y flex flex-col items-center py-2 gap-2"
      style="scroll-padding-top: calc(3.5rem + env(safe-area-inset-top)); scroll-padding-bottom: calc(4.5rem + env(safe-area-inset-bottom));"
    >
      <div
        v-for="(p, idx) in reader.activePages"
        :key="idx"
        :id="'webtoon-page-' + idx"
        class="webtoon-page w-full flex flex-col items-center justify-center shrink-0"
        :style="webtoonPageStyle(p)"
      >
        <img
          :data-lazy-index="idx"
          :width="p.imageWidth || undefined"
          :height="p.imageHeight || undefined"
          class="manga-page-img bg-[var(--bg-card)] shadow-[0_1px_3px_color-mix(in_oklab,var(--md-shadow-color-soft)_24%,transparent)] rounded-sm select-none"
          :class="webtoonImageClass(p)"
          :alt="'第 ' + p.pageNumber + ' 页'"
          decoding="async"
          draggable="false"
        />
      </div>
      <div class="shrink-0" style="height: calc(4.5rem + env(safe-area-inset-bottom));" aria-hidden="true"></div>
    </div>

    <!-- Novel: 长卷连续滚动 -->
    <div
      v-else
      ref="scrollRoot"
      data-reader-scroll
      class="no-scrollbar w-full h-full overflow-y-auto overscroll-contain touch-pan-y py-4 px-3 sm:px-2"
      style="scroll-padding-top: calc(3.5rem + env(safe-area-inset-top)); scroll-padding-bottom: calc(4.5rem + env(safe-area-inset-bottom));"
    >
      <div ref="novelContent" :style="novelProseStyle" class="max-w-[660px] mx-auto bg-[var(--md-reader-paper)] border-[0.5px] border-[var(--md-reader-rule)] rounded-[16px] p-5 sm:p-12 space-y-8">
        <section
          v-for="p in reader.activePages"
          :key="p.pageNumber"
          :id="'webtoon-page-' + ((p.pageNumber ?? 0) - 1)"
          data-novel-section
          class="webtoon-chapter border-b-[0.5px] border-[var(--md-reader-rule)] pb-6 last:border-none"
        >
          <div class="text-xs font-bold text-[var(--md-reader-ink-soft)] mb-4 flex items-center gap-2">
            <span class="truncate">{{ p.title }}</span>
            <i class="block w-[0.5px] h-3 shrink-0 bg-current opacity-30"></i>
            <span class="shrink-0">第 {{ p.pageNumber }} 章</span>
          </div>
          <div class="epub-content md-reader-prose" v-html="p.html"></div>
        </section>
      </div>
      <div class="shrink-0" style="height: calc(4.5rem + env(safe-area-inset-bottom));" aria-hidden="true"></div>
    </div>

    <ReaderFooter />
  </div>
</template>

<script setup lang="ts">
/* ============================================================================
   HOMURA · 纵向条漫 / 长卷滚动视图
   ----------------------------------------------------------------------------
   漫画由滚动位置驱动 prioritised 解码队列，IntersectionObserver 只负责
   进出视口通知；小说整卷直出。滚动位置实时回写 currentIndex 并防抖存进度。
   ========================================================================== */

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import { decodePageImage, releaseDistantPageUrls, type MangaPageItem } from '../services/pagination.ts';
import { resolveProseStyle } from '../services/readerLayout.ts';
import type { ReaderPage } from '../types.ts';
import ReaderFooter from './ReaderFooter.vue';

const MANGA_DECODE_CONCURRENCY = 2;
const MANGA_VISIBLE_MARGIN = 2;
const MANGA_QUEUE_WINDOW = 18;

const reader = useReaderStore();
const scrollRoot = ref<HTMLElement | null>(null);
const novelContent = ref<HTMLElement | null>(null);
let scrollFrame = 0;
let novelOffsetFrame = 0;
let mangaOffsetFrame = 0;
let novelOffsets: number[] = [];
let mangaPageOffsets: number[] = [];
let mangaImages: HTMLImageElement[] = [];
const mangaDecodeQueue = new Map<number, { index: number; imgEl: HTMLImageElement; pageData: ReaderPage; seq: number }>();
const mangaDecoding = new Map<number, number>();
const mangaLoadedIndexes = new Set<number>();
let mangaDecodeActive = 0;
let mangaDecodeSeq = 0;
let mangaDecodeToken = 0;
let lastMangaDirection = 1;
let lastScrollTop = 0;
let lastScrollAt = 0;
let mangaScrollVelocity = 0;
let webtoonScrollTimer = 0;
let webtoonScrollSettleTimer = 0;
let webtoonScrollTarget: number | null = null;
let webtoonScrollLastAt = 0;
const WEBTOON_SCROLL_INTERVAL = 90;
const WEBTOON_SCROLL_SETTLE = 400;
const mountedBookId = reader.currentBook?.id;
const mountedBook = reader.currentBook;
const initialMangaIndex = reader.currentBook?.type === 'manga' ? reader.currentIndex : 0;
let restoringMangaProgress = initialMangaIndex > 0;
let disposed = false;
let boundsObserver: ResizeObserver | null = null;
let novelContentObserver: ResizeObserver | null = null;
let lastMangaImage: HTMLImageElement | null = null;
const mangaHasStableLayout = !!(mountedBook?.pageItems || []).every(hasPageSize);

const novelProseStyle = computed(() => resolveProseStyle(reader.layoutConfig));
const isManga = computed(() => reader.currentBook && reader.currentBook.type === 'manga');

function hasPageSize(page: ReaderPage | null | undefined) {
  return Number(page?.imageWidth) > 0 && Number(page?.imageHeight) > 0;
}

function webtoonPageStyle(page: ReaderPage) {
  if (!hasPageSize(page)) return undefined;
  const width = Number(page?.imageWidth) || 0;
  const height = Number(page?.imageHeight) || 0;
  const ratio = width / height;
  const aspectRatio = `${width} / ${height}`;

  const fit = reader.layoutConfig.webtoonFit;
  if (fit === 'screen') {
    // 对应旧的 max-height + w-auto：宽度受容器、原图宽度和屏幕高度三重限制。
    const naturalWidth = width > 0 ? `${width}px` : '100%';
    return {
      width: `min(100%, min(${naturalWidth}, calc((100dvh - 6rem) * ${ratio})))`,
      aspectRatio
    };
  }
  return {
    width: fit === 'medium' ? 'min(100%, 720px)' : 'min(100%, 1024px)',
    aspectRatio
  };
}

function webtoonImageClass(page: ReaderPage) {
  if (hasPageSize(page)) return 'block w-full h-full object-contain';
  const fit = reader.layoutConfig.webtoonFit;
  if (fit === 'screen') return 'max-h-[calc(100dvh-6rem)] w-auto max-w-full object-contain mx-auto';
  if (fit === 'medium') return 'w-full max-w-[720px] h-auto object-contain mx-auto';
  return 'w-full max-w-[1024px] h-auto object-contain mx-auto';
}

// 条漫滚出预载窗口后释放原图 URL 与 DOM 位图，避免整本图的编码字节都留在内存里。
function releaseFarWebtoonPages(currentIdx: number) {
  if (mountedBook) releaseDistantPageUrls(mountedBook, currentIdx, 6);
}

function cancelMangaDecode(index: number) {
  mangaDecodeQueue.delete(index);
  // 原生解压无法真正中止；删掉 token 让迟到结果不再写回 img。
  mangaDecoding.delete(index);
}

// 清掉 src 会同步丢掉图片的固有高度，整卷高度瞬间缩短会把滚动位置带跑。
// 释放前把当前渲染高度钉在页面容器上，重新解码后再恢复自然布局。
function releaseImageElement(imgEl: HTMLImageElement) {
  // 还在加载的页不要急着放掉：此时量到的是 alt 行高，会把整卷高度记小。
  if (!imgEl?.getAttribute('src') || !imgEl.complete || !imgEl.naturalHeight) return;
  const wrapper = imgEl.parentElement;
  const height = imgEl.getBoundingClientRect().height;
  if (wrapper && height > 0) {
    wrapper.style.height = `${height}px`;
    wrapper.dataset.placeholderHeight = '1';
  }
  imgEl.style.visibility = 'hidden';
  imgEl.removeAttribute('src');
  // 下次滚回来必须重新走 decode；只删 src 会命中 data-current-src 的旧判断。
  imgEl.removeAttribute('data-current-src');
  const index = Number(imgEl.getAttribute('data-lazy-index'));
  if (Number.isInteger(index)) {
    mangaLoadedIndexes.delete(index);
    cancelMangaDecode(index);
  }
}

function restoreImageElement(imgEl: HTMLImageElement) {
  const wrapper = imgEl?.parentElement;
  if (wrapper?.dataset.placeholderHeight) {
    wrapper.style.height = '';
    delete wrapper.dataset.placeholderHeight;
  }
  if (imgEl) imgEl.style.visibility = '';
}

function enqueueMangaDecode(index: number) {
  if (disposed || !isManga.value) return;
  const imgEl = mangaImages[index];
  const pageData = reader.activePages[index];
  if (!imgEl || !pageData) return;
  if (imgEl.getAttribute('src') && imgEl.complete && imgEl.naturalHeight) {
    mangaLoadedIndexes.add(index);
    return;
  }
  if (mangaDecoding.has(index)) return;
  const pending = mangaDecodeQueue.get(index);
  if (pending) return;
  mangaDecodeQueue.set(index, {
    index,
    imgEl,
    pageData,
    seq: mangaDecodeSeq++
  });
  pumpMangaDecodeQueue();
}

function mangaDecodeScore(index: number, visible: { start: number; end: number }, current: number) {
  if (index >= visible.start && index <= visible.end) {
    return Math.abs(index - current);
  }
  const signedOffset = (index - current) * lastMangaDirection;
  // 预取方向比回滚方向更值得先解；旧任务的距离必须按最新阅读线实时计算。
  return signedOffset >= 0 ? 100 + signedOffset : 500 - signedOffset;
}

// 高速滑动时只保留少量在途任务，新视口可以插队到旧预取前面；
// 否则几十页同时调原生解压，会把当前可见页堵在 IPC 队列末尾。
function pumpMangaDecodeQueue() {
  if (disposed || !isManga.value) return;
  const visible = getMangaVisibleRange();
  const current = reader.currentIndex;
  for (const [index] of mangaDecodeQueue) {
    if (Math.abs(index - current) > MANGA_QUEUE_WINDOW) {
      mangaDecodeQueue.delete(index);
    }
  }
  while (mangaDecodeActive < MANGA_DECODE_CONCURRENCY && mangaDecodeQueue.size > 0) {
    let best: { index: number; imgEl: HTMLImageElement; pageData: ReaderPage; seq: number } | null = null;
    let bestScore = Infinity;
    for (const task of mangaDecodeQueue.values()) {
      const score = mangaDecodeScore(task.index, visible, current);
      if (!best || score < bestScore || (score === bestScore && task.seq < best.seq)) {
        best = task;
        bestScore = score;
      }
    }
    if (!best) break;
    mangaDecodeQueue.delete(best.index);
    const token = ++mangaDecodeToken;
    mangaDecoding.set(best.index, token);
    mangaDecodeActive++;
    decodePageImage(best.imgEl, best.pageData.itemRef as MangaPageItem, { preserveSrcOnEmpty: true })
      .then(ok => {
        if (disposed || reader.currentBook?.id !== mountedBookId) return;
        if (mangaDecoding.get(best.index) !== token) return;
        if (ok) {
          mangaLoadedIndexes.add(best.index);
          restoreImageElement(best.imgEl);
        }
      })
      .catch(err => {
        if (!disposed) console.warn('[HOMURA] 条漫页面解码失败', best.index, err);
      })
      .finally(() => {
        if (disposed) return;
        if (mangaDecoding.get(best.index) === token) mangaDecoding.delete(best.index);
        mangaDecodeActive--;
        releaseFarMangaImages();
        pumpMangaDecodeQueue();
      });
  }
}

function getMangaVisibleRange() {
  const root = scrollRoot.value;
  const lastIndex = reader.activePages.length - 1;
  if (!root || lastIndex < 0) return { start: 0, end: 0 };
  const start = findMangaPageIndex(root.scrollTop);
  const end = Math.max(start, findMangaPageIndex(root.scrollTop + root.clientHeight));
  return {
    start: Math.min(start, lastIndex),
    end: Math.min(end, lastIndex)
  };
}

function getMangaRetentionRange() {
  const lastIndex = reader.activePages.length - 1;
  const visible = getMangaVisibleRange();
  const ahead = mangaPrefetchAhead();
  if (lastMangaDirection < 0) {
    return {
      start: Math.max(0, visible.start - ahead),
      end: Math.min(lastIndex, visible.end + MANGA_VISIBLE_MARGIN)
    };
  }
  return {
    start: Math.max(0, visible.start - MANGA_VISIBLE_MARGIN),
    end: Math.min(lastIndex, visible.end + ahead)
  };
}

function releaseFarMangaImages() {
  const root = scrollRoot.value;
  if (!root) return;
  const range = getMangaRetentionRange();
  if (mangaLoadedIndexes.size === 0) return;
  const rootRect = root.getBoundingClientRect();
  // 只检查已解码的页，避免每帧遍历整本书的几千张图。
  for (const index of mangaLoadedIndexes) {
    if (index >= range.start && index <= range.end) continue;
    const imgEl = mangaImages[index];
    if (!imgEl) continue;
    // 页偏移可能因图片尚未加载而短暂滞后；真实矩形仍与视口相交时绝不释放。
    const pageRect = (imgEl.parentElement || imgEl).getBoundingClientRect();
    if (pageRect.bottom > rootRect.top && pageRect.top < rootRect.bottom) continue;
    releaseImageElement(imgEl);
  }
}

function measureMangaOffsets() {
  const root = scrollRoot.value;
  if (!root || disposed || !isManga.value) {
    mangaPageOffsets = [];
    return;
  }
  const pages = root.querySelectorAll('.webtoon-page');
  const rootOffsetParent = root.offsetParent;
  mangaPageOffsets = Array.from(pages as unknown as HTMLElement[], (page: HTMLElement) => {
    if (page.offsetParent === root) return page.offsetTop;
    if (rootOffsetParent && page.offsetParent === rootOffsetParent) {
      return page.offsetTop - root.offsetTop;
    }
    // 极端布局下 offsetParent 不一致时才退回可视坐标；入场缩放期间不会走这里。
    return page.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  });
}

function scheduleMangaOffsetMeasure() {
  if (disposed || !isManga.value || mangaOffsetFrame) return;
  mangaOffsetFrame = requestAnimationFrame(() => {
    mangaOffsetFrame = 0;
    measureMangaOffsets();
    syncMangaScrollPosition();
  });
}

function ensureMangaOffsets() {
  if (mangaPageOffsets.length !== reader.activePages.length) measureMangaOffsets();
}

function findMangaPageIndex(probe: number): number {
  let low = 0;
  let high = mangaPageOffsets.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (mangaPageOffsets[middle] <= probe) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function mangaPrefetchAhead() {
  const speed = Math.abs(mangaScrollVelocity);
  if (speed >= 4200) return 10;
  if (speed >= 2000) return 8;
  if (speed >= 650) return 5;
  return 2;
}

function syncMangaScrollPosition() {
  if (disposed || !isManga.value || reader.currentBook?.id !== mountedBookId) return;
  const root = scrollRoot.value;
  if (!root || reader.activePages.length === 0) return;
  // 恢复旧进度时先不要用滚动容器的初始 top 覆盖 currentIndex。
  if (restoringMangaProgress) return;

  ensureMangaOffsets();
  const probe = root.scrollTop + root.clientHeight * 0.45;
  let nextIndex = mangaPageOffsets.length ? findMangaPageIndex(probe) : 0;
  const canScroll = root.scrollHeight > root.clientHeight + 2;
  if (canScroll && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
    nextIndex = reader.activePages.length - 1;
  }

  if (Math.abs(mangaScrollVelocity) > 80) {
    lastMangaDirection = mangaScrollVelocity < 0 ? -1 : 1;
  }
  const visible = getMangaVisibleRange();
  for (let index = visible.start; index <= visible.end; index++) {
    enqueueMangaDecode(index);
  }
  const ahead = mangaPrefetchAhead();
  for (let offset = 1; offset <= ahead; offset++) {
    const index = nextIndex + lastMangaDirection * offset;
    if (index >= 0 && index < reader.activePages.length) {
      enqueueMangaDecode(index);
    }
  }
  releaseFarMangaImages();

  if (nextIndex !== reader.currentIndex) {
    reader.currentIndex = nextIndex;
    reader.pageIndicator = `${nextIndex + 1} / ${reader.activePages.length}`;
    reader.sliderValue = nextIndex;
    reader.touchProgress();
    releaseFarWebtoonPages(nextIndex);
  }
}

// 章节位置只在尺寸变化时量一次，滚动时用二分查找当前章。
// 之前每帧 querySelectorAll + 逐章 getBoundingClientRect，长篇小说会把主线程吃满。
function measureNovelOffsets() {
  const root = scrollRoot.value;
  if (!root || disposed || isManga.value) {
    novelOffsets = [];
    return;
  }
  const sections = root.querySelectorAll('section[data-novel-section]');
  const rootTop = root.getBoundingClientRect().top;
  const scrollTop = root.scrollTop;
  novelOffsets = Array.from(sections, section => section.getBoundingClientRect().top - rootTop + scrollTop);
}

function scheduleNovelOffsetMeasure() {
  if (disposed || isManga.value || novelOffsetFrame) return;
  novelOffsetFrame = requestAnimationFrame(() => {
    novelOffsetFrame = 0;
    measureNovelOffsets();
  });
}

function ensureNovelOffsets() {
  if (novelOffsets.length !== reader.activePages.length) measureNovelOffsets();
}

function findNovelSectionIndex(probe: number) {
  let low = 0;
  let high = novelOffsets.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (novelOffsets[middle] <= probe) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function syncNovelScrollPosition() {
  if (disposed || reader.currentBook?.id !== mountedBookId) return;
  const root = scrollRoot.value;
  if (!root || isManga.value || reader.activePages.length === 0) return;

  ensureNovelOffsets();
  const probe = root.scrollTop + root.clientHeight * 0.45;
  let nextIndex = novelOffsets.length ? findNovelSectionIndex(probe) : 0;
  // 末章较短时可能始终到不了阅读线，滚到底部仍应记到最后一章。
  const canScroll = root.scrollHeight > root.clientHeight + 2;
  if (canScroll && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
    nextIndex = reader.activePages.length - 1;
  }

  if (nextIndex === reader.currentIndex) return;
  reader.currentIndex = nextIndex;
  reader.pageIndicator = `${nextIndex + 1} / ${reader.activePages.length}`;
  reader.sliderValue = nextIndex;
  reader.touchProgress();
}

function onScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const root = scrollRoot.value;
    if (root) {
      const now = performance.now();
      const top = root.scrollTop;
      const elapsed = now - lastScrollAt;
      if (elapsed > 0) mangaScrollVelocity = (top - lastScrollTop) / elapsed * 1000;
      lastScrollTop = top;
      lastScrollAt = now;
    }
    syncScrollBounds();
    if (isManga.value) syncMangaScrollPosition();
    else syncNovelScrollPosition();
  });
}

function syncScrollBounds() {
  const root = scrollRoot.value;
  if (!root || disposed || reader.currentBook?.id !== mountedBookId) return;
  if (isManga.value && (!lastMangaImage || !lastMangaImage.isConnected)) {
    lastMangaImage = root.querySelector(`img[data-lazy-index="${reader.activePages.length - 1}"]`);
  }
  const atStart = root.scrollTop <= 2;
  const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2
    && (!isManga.value || !!(lastMangaImage?.complete && lastMangaImage.naturalHeight));
  const previous = reader.webtoonBounds;
  if (previous.atStart === atStart && previous.atEnd === atEnd) return;
  reader.webtoonBounds = { atStart, atEnd };
}

function onContentLoad() {
  syncScrollBounds();
  if (isManga.value) {
    if (!mangaHasStableLayout) scheduleMangaOffsetMeasure();
  } else {
    scheduleNovelOffsetMeasure();
  }
}

function scrollToSection(index: number, behavior: ScrollBehavior = 'auto') {
  const root = scrollRoot.value;
  if (!root) return;
  cancelQueuedWebtoonScroll();
  if (isManga.value) {
    const target = root.querySelector('#webtoon-page-' + index);
    if (target) target.scrollIntoView({ behavior, block: 'start' });
    return;
  }
  ensureNovelOffsets();
  if (Number.isFinite(novelOffsets[index])) {
    // scrollTo 不走 scroll-padding，手动减去顶部工具栏预留高度。
    const paddingTop = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    root.scrollTo({ top: Math.max(0, novelOffsets[index] - paddingTop), behavior });
  }
}

function cancelQueuedWebtoonScroll() {
  if (webtoonScrollTimer) window.clearTimeout(webtoonScrollTimer);
  if (webtoonScrollSettleTimer) window.clearTimeout(webtoonScrollSettleTimer);
  webtoonScrollTimer = 0;
  webtoonScrollSettleTimer = 0;
  webtoonScrollTarget = null;
  webtoonScrollLastAt = 0;
}

// 连续按键 / 滚轮翻页时只累加目标位置，合并成一次平滑滚动，避免动画排队互相打断
function flushWebtoonScroll() {
  const root = scrollRoot.value;
  const target = webtoonScrollTarget;
  if (!root || target === null || disposed) return;
  webtoonScrollLastAt = performance.now();
  const limit = Math.max(0, root.scrollHeight - root.clientHeight);
  root.scrollTo({ top: Math.min(limit, target), behavior: 'smooth' });
  if (webtoonScrollSettleTimer) window.clearTimeout(webtoonScrollSettleTimer);
  webtoonScrollSettleTimer = window.setTimeout(() => {
    webtoonScrollSettleTimer = 0;
    webtoonScrollTarget = null;
  }, WEBTOON_SCROLL_SETTLE);
}

function queueWebtoonScroll(direction: number) {
  const root = scrollRoot.value;
  if (!root || disposed) return;
  if (webtoonScrollSettleTimer) window.clearTimeout(webtoonScrollSettleTimer);
  webtoonScrollSettleTimer = 0;
  const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
  const base = webtoonScrollTarget ?? root.scrollTop;
  webtoonScrollTarget = Math.min(maxTop, Math.max(0, base + direction * root.clientHeight * 0.88));
  const elapsed = performance.now() - webtoonScrollLastAt;
  if (elapsed >= WEBTOON_SCROLL_INTERVAL) {
    flushWebtoonScroll();
    return;
  }
  if (!webtoonScrollTimer) {
    webtoonScrollTimer = window.setTimeout(() => {
      webtoonScrollTimer = 0;
      flushWebtoonScroll();
    }, WEBTOON_SCROLL_INTERVAL - elapsed);
  }
}

onMounted(() => {
  const total = reader.activePages.length;
  reader.pageIndicator = `${reader.currentIndex + 1} / ${total}`;
  reader.sliderValue = reader.currentIndex;
  scrollRoot.value!.addEventListener('scroll', onScroll, { passive: true });
  scrollRoot.value!.addEventListener('load', onContentLoad, true);
  boundsObserver = new ResizeObserver(() => {
    syncScrollBounds();
    if (isManga.value) scheduleMangaOffsetMeasure();
    else scheduleNovelOffsetMeasure();
  });
  boundsObserver.observe(scrollRoot.value!);
  if (!isManga.value && novelContent.value) {
    novelContentObserver = new ResizeObserver(scheduleNovelOffsetMeasure);
    novelContentObserver.observe(novelContent.value);
  }

  // 注册滚动入口：store 的翻页 / 滑条动作在条漫模式下转成滚动
  reader.webtoonScrollBy = queueWebtoonScroll;
  reader.webtoonScrollTo = (idx: number) => scrollToSection(idx, 'smooth');

  if (isManga.value) {
    // 条漫恢复进度时先把容器滚到目标页，再建立观察器，避免启动时抢解第一页。
    if (initialMangaIndex > 0) scrollToSection(initialMangaIndex, 'auto');
    mangaImages = Array.from(scrollRoot.value!.querySelectorAll('img[data-lazy-index]'));
    reader.webtoonObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (disposed || reader.currentBook?.id !== mountedBookId) return;
        const lazyIndex = parseInt(entry.target.getAttribute('data-lazy-index') as string, 10);
        if (!Number.isInteger(lazyIndex)) return;
        if (!entry.isIntersecting) return;
        enqueueMangaDecode(lazyIndex);
      });
    }, { root: scrollRoot.value, rootMargin: '1600px 0px', threshold: 0.01 });

    scrollRoot.value!.querySelectorAll('img[data-lazy-index]').forEach(img => (reader.webtoonObserver as IntersectionObserver).observe(img));
    lastMangaImage = scrollRoot.value!.querySelector(`img[data-lazy-index="${total - 1}"]`);
    lastScrollTop = scrollRoot.value!.scrollTop;
    lastScrollAt = performance.now();
    measureMangaOffsets();
    if (!restoringMangaProgress) syncMangaScrollPosition();
  }

  // 恢复上次阅读位置
  if (initialMangaIndex > 0 || (!isManga.value && reader.currentIndex > 0)) {
    setTimeout(() => {
      if (disposed) return;
      if (!isManga.value) measureNovelOffsets();
      scrollToSection(isManga.value ? initialMangaIndex : reader.currentIndex, 'auto');
      if (isManga.value) {
        restoringMangaProgress = false;
        measureMangaOffsets();
        syncMangaScrollPosition();
      } else {
        syncNovelScrollPosition();
      }
      syncScrollBounds();
    }, 50);
  } else {
    if (!isManga.value) scheduleNovelOffsetMeasure();
    syncNovelScrollPosition();
    syncScrollBounds();
  }
});

watch(
  () => reader.layoutConfig.webtoonFit,
  () => {
    if (!isManga.value) return;
    scheduleMangaOffsetMeasure();
  }
);

onBeforeUnmount(() => {
  disposed = true;
  boundsObserver?.disconnect();
  novelContentObserver?.disconnect();
  if (scrollRoot.value) {
    scrollRoot.value.removeEventListener('scroll', onScroll);
    scrollRoot.value.removeEventListener('load', onContentLoad, true);
  }
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  cancelQueuedWebtoonScroll();
  if (novelOffsetFrame) cancelAnimationFrame(novelOffsetFrame);
  novelOffsetFrame = 0;
  if (mangaOffsetFrame) cancelAnimationFrame(mangaOffsetFrame);
  mangaOffsetFrame = 0;
  novelOffsets = [];
  mangaPageOffsets = [];
  mangaImages = [];
  mangaDecodeQueue.clear();
  mangaDecoding.clear();
  mangaLoadedIndexes.clear();
  mangaDecodeActive = 0;
  if (reader.webtoonObserver) {
    reader.webtoonObserver.disconnect();
    reader.webtoonObserver = null;
  }
  reader.webtoonScrollBy = null;
  reader.webtoonScrollTo = null;
});
</script>
