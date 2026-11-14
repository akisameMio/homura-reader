<template>
  <!-- 鼠标 / 触屏手势层：左右各 30% 翻页，中间 40% 切换工具栏
       z-30 必须高于翻页舞台激活层的 z-20，否则指针事件会被图片层吃掉 -->
  <div
    ref="gestureEl"
    class="reader-gesture-layer absolute inset-0 z-30 select-none"
    @click.stop.prevent="onClick"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onPointerCancel"
    @contextmenu.prevent
  ></div>

  <!-- Hardware-Accelerated Double-Buffer Stage -->
  <div ref="pageStage" data-reader-stage class="relative w-full h-full overflow-hidden">
    <div
      v-for="slot in [0, 1]"
      :key="slot"
      :ref="el => { if (el) stageEls[slot] = el as HTMLElement; }"
      class="stage-buffer-layer"
      :class="slot === 0 ? 'z-20' : 'z-10 pointer-events-none'"
      :style="slot === 0 ? 'opacity: 1; transform: translate3d(0,0,0);' : 'opacity: 0; transform: translate3d(0,0,0);'"
    >
      <!-- Manga: 1P Single -->
      <template v-if="isManga">
        <div class="w-full h-full items-center justify-center overflow-hidden" :class="slotVMs[slot] && slotVMs[slot].mode === 'single' ? 'flex' : 'hidden'">
          <img :ref="el => { if (el) imgEls[slot].single = el as HTMLImageElement; }" class="manga-page-img h-full w-auto max-w-full object-contain select-none" />
        </div>
        <!-- Manga: 2P Double -->
        <div class="w-full h-full items-center justify-center overflow-hidden" :class="slotVMs[slot] && slotVMs[slot].mode === 'double' ? 'flex' : 'hidden'">
          <div class="flex items-center justify-center w-full h-full relative">
            <div class="w-1/2 h-full flex items-center justify-end overflow-hidden">
              <img :ref="el => { if (el) imgEls[slot].left = el as HTMLImageElement; }" class="manga-page-img h-full max-h-full w-auto max-w-full object-contain object-right select-none" />
            </div>
            <div class="w-2 h-full book-spine-shadow pointer-events-none z-10 shrink-0"></div>
            <div class="w-1/2 h-full flex items-center justify-start overflow-hidden">
              <img :ref="el => { if (el) imgEls[slot].right = el as HTMLImageElement; }" class="manga-page-img h-full max-h-full w-auto max-w-full object-contain object-left select-none" />
            </div>
          </div>
        </div>
      </template>

      <!-- Novel: 纸面排版（单页 / 双页共用同一套几何，变量由舞台下发） -->
      <template v-else>
        <div class="reader-spread" :class="{ 'is-single': slotVMs[slot] && slotVMs[slot].mode === 'single' }">
          <template v-if="slotVMs[slot] && slotVMs[slot].mode === 'double'">
            <NovelCard :page="slotVMs[slot].left!" />
            <NovelCard :page="slotVMs[slot].right!" />
          </template>
          <NovelCard
            v-else-if="slotVMs[slot] && slotVMs[slot].single"
            :page="slotVMs[slot].single!"
          />
        </div>
      </template>
    </div>

    <ReaderFooter />
  </div>
</template>

<script setup lang="ts">
/* ============================================================================
   HOMURA · 双缓冲翻页引擎（原 renderer.js 的 Vue 化）
   ----------------------------------------------------------------------------
   两个 buffer 槽位交替上屏：先在离屏槽位填充内容并解码图片，再用 Web
   Animations API 在合成器线程跑翻页动画，动画结束后才后台预解码后续页。
   buffer 槽位的显隐 / z-index / transform 全部直操作 ref DOM，不经响应式，
   避免 Vue 重渲染打断进行中的动画。
   ========================================================================== */

import { shallowRef, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import { useThemeStore } from '../stores/theme.ts';
import { useUiStore } from '../stores/ui.ts';
import { useViewport } from '../composables/useViewport.ts';
import { isAndroid } from '../services/platform.ts';
import { ensurePageUrlLoaded, decodePageImage, releaseDistantPageUrls, type MangaPageItem } from '../services/pagination.ts';
import { resolveProseStyle, resolveReaderMetrics, resolveReaderFolios, type ReaderFolio } from '../services/readerLayout.ts';
import { classifyReaderGesture } from '../services/readerGestures.ts';
import { createPageTurn, type PageTurnController, type PaperTurnStyle } from '../services/pageTurn.ts';
import { pageTurnTarget, type TurnSide } from '../services/pageTurnGeometry.ts';
import { prefersReducedMotion } from '../services/spring.ts';
import NovelCard from './NovelCard.vue';
import ReaderFooter from './ReaderFooter.vue';
import type { ReaderPage } from '../types.ts';

interface SlotVM {
  mode: 'single' | 'double';
  folios: ReaderFolio[];
  single?: ReaderPage;
  left?: ReaderPage;
  right?: ReaderPage;
  singleLabel?: string;
  leftLabel?: string;
  rightLabel?: string;
  total: number;
}

const reader = useReaderStore();
const theme = useThemeStore();
const ui = useUiStore();
const { isCompact } = useViewport();
const gestureEl = shallowRef<HTMLElement | null>(null);
const pageStage = shallowRef<HTMLElement | null>(null);
let stageResizeObserver: ResizeObserver | null = null;

const isManga = computed(() => reader.currentBook && reader.currentBook.type === 'manga');

// 纸面几何：变量挂在舞台上，两个 buffer 槽位与纸页共同继承。
// 不经过响应式 :style 绑定，避免翻页动画进行中被重渲染改写 transform。
function applyReaderGeometry() {
  const el = pageStage.value;
  if (!el || isManga.value) return;
  const metrics = resolveReaderMetrics({
    width: el.clientWidth,
    height: el.clientHeight,
    layout: reader.layoutConfig,
    compact: isCompact.value
  });
  el.style.setProperty('--reader-pad-x', metrics.padX + 'px');
  el.style.setProperty('--reader-pad-top', metrics.padTop + 'px');
  el.style.setProperty('--reader-pad-bottom', metrics.padBottom + 'px');
  el.style.setProperty('--reader-gutter', metrics.gutter + 'px');
  el.style.setProperty('--reader-page-width', metrics.textWidth + 'px');
  el.style.setProperty('--reader-flow-height', metrics.textHeight + 'px');
  // 双页几何下的单页（章首页 / 封面单排）靠 CSS 占位补出另一栏，保持与苹果图书一致的右栏起始
  el.dataset.readerSpread = metrics.isDouble ? 'double' : 'single';
  el.dataset.readerDirection = reader.layoutConfig.direction;
  const proseStyle = resolveProseStyle(reader.layoutConfig);
  for (const [name, value] of Object.entries(proseStyle)) el.style.setProperty(name, value);
}

// 每个槽位的视图模型：single / double 模式 + 页面 + 阅读顺序标签
const slotVMs = shallowRef<(SlotVM | null)[]>([null, null]);

// 直操作 DOM 引用：stage 层与 manga img（不挂响应式）
const stageEls: (HTMLElement | null)[] = [null, null];
const imgEls: { single: HTMLImageElement | null; left: HTMLImageElement | null; right: HTMLImageElement | null }[] = [{ single: null, left: null, right: null }, { single: null, left: null, right: null }];

// 组件按 书 id+type key 重挂载，首次渲染只填槽位 0、无动画
let initialized = false;
let preloadGeneration = 0;
let displayedIndex = 0;
let pendingRender = 0;
let previewGeneration = 0;
let activePaperTurn: PageTurnController | null = null;
let bufferQueue: Promise<unknown> = Promise.resolve();
let turnOriginY: number | null = null;
// 翻页动画期间合并后续请求：只保留最后一次目标页，动画结束后补渲染
let renderRunId = 0;
let renderBusy = false;
let queuedTurnDir: string | null = null;
interface GesturePreview {
  targetIndex: number;
  nextSlot: number;
  forward: boolean;
  side: TurnSide;
  dx: number;
  dy: number;
  ready: Promise<boolean>;
  controller: PageTurnController | null;
}
let gesturePreview: GesturePreview | null = null;

// 槽位切换后清掉不再使用的 img.src，释放上一页的位图。
// 两个槽位共用同一组 img 节点，隐藏模式里的旧图会一直占内存。
function clearSlotImages(slotIndex: number, keepKeys: string[]) {
  const refs = imgEls[slotIndex];
  for (const key of ['single', 'left', 'right'] as const) {
    const el = refs[key];
    if (!el || keepKeys.includes(key) || !el.getAttribute('src')) continue;
    el.removeAttribute('src');
    el.setAttribute('data-current-src', '');
  }
}

function buildSlotVM(pair: ReaderPage[], total: number): SlotVM {
  const rtl = reader.layoutConfig.direction === 'rtl';
  const folios = resolveReaderFolios(pair, {
    rtl,
    singleOnRight: reader.effectiveDouble && !isManga.value,
    startIndex: Math.max(0, reader.activePages.indexOf(pair[0]!))
  });
  if (pair.length === 1) {
    return {
      mode: 'single',
      folios,
      single: pair[0],
      singleLabel: rtl ? '[右→左]' : '[左→右]',
      total
    };
  }
  const left = rtl ? pair[1] : pair[0];
  const right = rtl ? pair[0] : pair[1];
  return {
    mode: 'double',
    folios,
    left,
    right,
    leftLabel: rtl ? '左页(后读)' : '左页(先读)',
    rightLabel: rtl ? '右页(先读)' : '右页(后读)',
    total
  };
}

// Populate a target buffer slot (0 or 1) and decode its images BEFORE starting the transition
async function populateBufferSlot(slotIndex: number, pair: ReaderPage[], total: number) {
  if (isManga.value) {
    for (const p of pair) {
      await ensurePageUrlLoaded(p.itemRef as MangaPageItem);
    }
  }
  const vm = buildSlotVM(pair, total);
  const next = slotVMs.value.slice();
  next[slotIndex] = vm;
  slotVMs.value = next;
  // 等 Vue 把槽位内容（包装显隐 / 小说 v-html）patch 进 DOM 后再解码或开启动画
  await nextTick();
  clearSlotImages(slotIndex, vm.mode === 'single' ? ['single'] : ['left', 'right']);

  if (isManga.value) {
    if (vm.mode === 'single') {
      await decodePageImage(imgEls[slotIndex].single!, vm.single!.itemRef as MangaPageItem);
    } else {
      await Promise.all([
        decodePageImage(imgEls[slotIndex].left!, vm.left!.itemRef as MangaPageItem),
        decodePageImage(imgEls[slotIndex].right!, vm.right!.itemRef as MangaPageItem)
      ]);
    }
  }
}

// 解码与 Vue patch 串行进入同一备用槽，旧请求不能在新请求完成后改写 img.src。
function prepareSlot(slot: number, pair: ReaderPage[], total: number, valid: () => boolean) {
  const task = bufferQueue.then(async () => {
    if (!valid()) return false;
    await populateBufferSlot(slot, pair, total);
    return valid();
  });
  bufferQueue = task.catch(() => {});
  return task;
}

function showSlot(slot: number) {
  stageEls.forEach((element, index) => {
    if (!element) return;
    element.style.opacity = index === slot ? '1' : '0';
    element.style.transform = 'translate3d(0,0,0)';
    element.style.zIndex = index === slot ? '20' : '10';
    element.classList.toggle('pointer-events-none', index !== slot);
  });
}

function cancelBufferAnimations() {
  reader.activeTransitionAnims.forEach(animation => { try { animation.cancel(); } catch {} });
  reader.activeTransitionAnims = [];
}

function stopPaperTurn() {
  previewGeneration++;
  gesturePreview = null;
  activePaperTurn?.destroy();
  activePaperTurn = null;
  showSlot(reader.activeBufferSlot);
}

function finishPaperTurn(controller: PageTurnController, slot: number) {
  if (activePaperTurn !== controller) return;
  controller.destroy();
  activePaperTurn = null;
  showSlot(slot);
}

function paperTurnPageNumbers(outgoingSlot: number, incomingSlot: number) {
  const label = pageStage.value?.querySelector<HTMLElement>('.md-reader-footer-pages');
  const outgoing = slotVMs.value[outgoingSlot]?.folios;
  const incoming = slotVMs.value[incomingSlot]?.folios;
  if (!label || !outgoing?.length || !incoming?.length) return undefined;
  return { label, outgoing, incoming, total: reader.activePages.length, showTotal: label.dataset.pageCountVisible === 'true' };
}

async function renderReaderViewport(transitionDir = 'fade') {
  if (!reader.currentBook) return;
  const myToken = ++reader.renderToken;
  const targetIndex = reader.currentIndex;
  const forward = targetIndex > displayedIndex;
  const preview = gesturePreview?.targetIndex === targetIndex ? gesturePreview : null;
  const originY = turnOriginY ?? 0;
  turnOriginY = null;
  pendingRender = myToken;
  cancelIdlePreload();
  cancelBufferAnimations();
  if (!preview) {
    drag.active = false;
    drag.pointerId = null;
    stopPaperTurn();
  }
  const valid = () => myToken === reader.renderToken && !!reader.currentBook;
  const total = reader.activePages.length;
  reader.sliderValue = targetIndex;
  reader.touchProgress();
  const pair = reader.getSpreadPair(targetIndex);
  reader.pageIndicator = `${pair.map(p => p.pageNumber).join('-')} / ${total}`;
  try {
    if (!initialized) {
      if (!await prepareSlot(0, pair, total, valid)) return;
      initialized = true;
      displayedIndex = targetIndex;
      reader.activeBufferSlot = 0;
      showSlot(0);
      scheduleIdlePreload();
      return;
    }
    const prevSlot = reader.activeBufferSlot;
    const nextSlot = preview?.nextSlot ?? 1 - prevSlot;
    let controller: PageTurnController | null = null;
    if (preview) {
      if (await preview.ready) controller = preview.controller;
      if (!valid()) return;
      gesturePreview = null;
    }
    if (!controller && !await prepareSlot(nextSlot, pair, total, valid)) return;
    if (!valid()) return;
    reader.activeBufferSlot = nextSlot;
    displayedIndex = targetIndex;
    pendingRender = 0;
    const outEl = stageEls[prevSlot]!;
    const inEl = stageEls[nextSlot]!;
    const style = theme.transitionStyle;
    const directional = transitionDir === 'enter-from-right' || transitionDir === 'enter-from-left';
    if (!controller && directional && (style === 'slide' || style === 'curl') && !prefersReducedMotion()) {
      controller = createPageTurn({ stage: pageStage.value!, outgoing: outEl, incoming: inEl, style, forward, side: reader.layoutConfig.direction === 'rtl' ? -1 : 1, originY, compact: isCompact.value, lowPower: isAndroid, pageNumbers: paperTurnPageNumbers(prevSlot, nextSlot) });
      activePaperTurn = controller;
    }
    if (controller) {
      const completed = await controller.finish(true);
      if (!completed || !valid()) return;
      finishPaperTurn(controller, nextSlot);
    } else {
      showSlot(nextSlot);
      if (style !== 'none' && transitionDir !== 'none' && !prefersReducedMotion() && inEl.animate) {
        const animation = inEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.2,0,0,1)' });
        reader.activeTransitionAnims = [animation];
        await new Promise<void>(resolve => { animation.onfinish = () => resolve(); animation.oncancel = () => resolve(); });
        if (!valid()) return;
        reader.activeTransitionAnims = [];
      }
    }
    if (!drag.active) scheduleIdlePreload();
  } catch (error) {
    if (!valid()) return;
    console.warn('翻页准备失败', error);
    stopPaperTurn();
  } finally {
    if (pendingRender === myToken) pendingRender = 0;
  }
}

function isDirectionalTurn(transitionDir: string) {
  return transitionDir === 'enter-from-right' || transitionDir === 'enter-from-left';
}

function clearQueuedTurn() {
  queuedTurnDir = null;
}

async function runReaderRender(transitionDir: string) {
  const runId = ++renderRunId;
  renderBusy = true;
  try {
    await renderReaderViewport(transitionDir);
  } finally {
    if (runId !== renderRunId) return;
    renderBusy = false;
    if (queuedTurnDir) flushQueuedTurn();
  }
}

function flushQueuedTurn() {
  const transitionDir = queuedTurnDir;
  queuedTurnDir = null;
  if (!transitionDir || renderBusy || !reader.currentBook) return;
  void runReaderRender(transitionDir);
}

function requestReaderRender(transitionDir: string) {
  if (!reader.currentBook) return;
  // 滑条、重排等非翻页请求立即生效，并取消尚未执行的翻页补渲染
  if (!isDirectionalTurn(transitionDir)) {
    clearQueuedTurn();
    void runReaderRender(transitionDir);
    return;
  }
  queuedTurnDir = transitionDir;
  if (renderBusy) return;
  queuedTurnDir = null;
  void runReaderRender(transitionDir);
}

function prepareGestureTurn() {
  const style = theme.transitionStyle;
  if ((style !== 'slide' && style !== 'curl') || prefersReducedMotion()) return false;
  const forward = drag.dx < 0 ? !reader.isNavigationInverted() : reader.isNavigationInverted();
  const step = forward ? reader.getStepSizeForNext() : reader.getStepSizeForPrev();
  const targetIndex = pageTurnTarget(reader.currentIndex, reader.activePages.length, step, forward);
  if (targetIndex === null) return false;
  if (gesturePreview?.targetIndex === targetIndex) {
    gesturePreview.dx = drag.dx;
    gesturePreview.dy = drag.dy;
    gesturePreview.controller?.move(drag.dx, drag.dy);
    return true;
  }
  stopPaperTurn();
  cancelIdlePreload();
  const generation = ++previewGeneration;
  const bookId = reader.currentBook?.id;
  const nextSlot = 1 - reader.activeBufferSlot;
  const side: TurnSide = forward ? (drag.dx < 0 ? 1 : -1) : (drag.dx > 0 ? 1 : -1);
  const bounds = gestureEl.value!.getBoundingClientRect();
  const y = drag.startY - bounds.top;
  const originY = y < bounds.height * 0.28 ? 0 : y > bounds.height * 0.72 ? bounds.height : y;
  const preview: GesturePreview = { targetIndex, nextSlot, forward, side, dx: drag.dx, dy: drag.dy, ready: Promise.resolve(false), controller: null };
  gesturePreview = preview;
  const valid = () => gesturePreview === preview && generation === previewGeneration && reader.currentBook?.id === bookId;
  preview.ready = prepareSlot(nextSlot, reader.getSpreadPair(targetIndex), reader.activePages.length, valid).then(ready => {
    if (!ready) return false;
    resetStageTransform();
    const controller = createPageTurn({ stage: pageStage.value!, outgoing: activeStageEl()!, incoming: stageEls[nextSlot]!, style: style as PaperTurnStyle, forward, side, originY, compact: isCompact.value, lowPower: isAndroid, pageNumbers: paperTurnPageNumbers(reader.activeBufferSlot, nextSlot) });
    activePaperTurn = controller;
    preview.controller = controller;
    controller.move(preview.dx, preview.dy);
    return true;
  }).catch(error => {
    if (valid()) { console.warn('跟手翻页准备失败', error); stopPaperTurn(); }
    return false;
  });
  return true;
}

function cancelGestureTurn() {
  const controller = gesturePreview?.controller;
  previewGeneration++;
  gesturePreview = null;
  if (controller) {
    void controller.finish(false).then(completed => {
      if (completed) { finishPaperTurn(controller, reader.activeBufferSlot); scheduleIdlePreload(); }
    });
  } else {
    resetStageTransform();
    scheduleIdlePreload();
  }
}

// Background Preloader: Only runs AFTER page turn animation completes so animation never drops a frame!
function cancelIdlePreload() {
  preloadGeneration++;
  clearTimeout(reader.preloadTimer ?? undefined);
  reader.preloadTimer = null;
}

function scheduleIdlePreload() {
  cancelIdlePreload();
  if (!reader.currentBook || reader.currentBook.type !== 'manga') return;

  const generation = preloadGeneration;
  const startIndex = reader.currentIndex;
  // 安卓机减少预载数量和并发解码压力；一次翻页只提前准备两页。
  const pagesAhead = isAndroid ? 2 : 4;
  const delay = isAndroid ? 420 : 280;

  // 回收必须跟翻页同步执行：预载会被下一次快速翻页取消，
  // 若把回收放进延时的预载任务，连续翻页时旧 asset URL 会一直不释放。
  releaseDistantPageUrls(reader.currentBook, startIndex, isAndroid ? 3 : 5);

  reader.preloadTimer = window.setTimeout(async () => {
    if (generation !== preloadGeneration || reader.currentIndex !== startIndex) return;
    for (let i = 1; i <= pagesAhead; i++) {
      if (generation !== preloadGeneration) return;
      if (document.visibilityState === 'hidden') return;
      if (reader.currentIndex !== startIndex) return;
      const nextPage = reader.activePages[startIndex + i];
      if (nextPage && nextPage.itemRef && !(nextPage.itemRef as { url?: string }).url) {
        const url = await ensurePageUrlLoaded(nextPage.itemRef as MangaPageItem);
        if (generation !== preloadGeneration || reader.currentIndex !== startIndex) return;
        if (url) {
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
          if (img.decode) {
            try { await img.decode(); } catch (e) {}
          }
        }
      }
    }
  }, delay);
}

// ---- 统一指针手势：移动越过阈值后，即使回到原位也不再当成点击 ----
const drag: {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  startTime: number;
  dx: number;
  dy: number;
  axis: 'x' | 'y' | null;
  maxDistance: number;
} = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startTime: 0,
  dx: 0,
  dy: 0,
  axis: null,
  maxDistance: 0
};
let lastPointerType: string | null = null;
let allowMouseClick = false;
let suppressMouseClick = false;

function activeStageEl() {
  return stageEls[reader.activeBufferSlot];
}

// 拖拽阻尼：前半段跟手，超出后明显变沉，避免整页被拖出屏幕
function dampedOffset(dx: number) {
  const limit = (window.innerWidth || 375) * 0.22;
  const sign = dx < 0 ? -1 : 1;
  const abs = Math.abs(dx);
  if (abs <= limit) return dx * 0.55;
  return sign * (limit * 0.55 + (abs - limit) * 0.12);
}

function resetStageTransform() {
  const el = activeStageEl();
  if (el) el.style.transform = 'translate3d(0, 0, 0)';
}

function onPointerDown(e: PointerEvent) {
  if (!reader.currentBook || reader.openingBook || pendingRender || ui.readerDrawerOpen || document.querySelector('dialog[open]')) return;
  if (e.isPrimary === false) { onPointerCancel(undefined); return; }
  if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
  lastPointerType = e.pointerType;
  allowMouseClick = false;
  suppressMouseClick = false;
  cancelBufferAnimations();
  stopPaperTurn();
  cancelIdlePreload();
  drag.active = true;
  drag.pointerId = e.pointerId;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.startTime = Date.now();
  drag.dx = 0;
  drag.dy = 0;
  drag.axis = null;
  drag.maxDistance = 0;
  if (gestureEl.value) {
    try { gestureEl.value.setPointerCapture(e.pointerId); } catch (err) {}
  }
}

function onPointerMove(e: PointerEvent) {
  if (!drag.active || e.pointerId !== drag.pointerId) return;
  if (ui.readerDrawerOpen) { onPointerCancel(e); return; }
  drag.dx = e.clientX - drag.startX;
  drag.dy = e.clientY - drag.startY;
  const absX = Math.abs(drag.dx);
  const absY = Math.abs(drag.dy);
  drag.maxDistance = Math.max(drag.maxDistance, absX, absY);
  if (!drag.axis && (absX > 8 || absY > 8)) {
    drag.axis = absX >= absY ? 'x' : 'y';
  }
  // 手指起始方向常有竖向抖动：横向位移明显占优时改判为横向手势
  if (drag.axis === 'y' && absX > 16 && absX > absY * 1.4) {
    drag.axis = 'x';
  }
  if (drag.axis === 'x') {
    if (!prepareGestureTurn()) {
      if (gesturePreview) cancelGestureTurn();
      const el = activeStageEl();
      if (el) el.style.transform = `translate3d(${dampedOffset(drag.dx)}px, 0, 0)`;
    }
  }
}

function onPointerUp(e: PointerEvent) {
  if (!drag.active || e.pointerId !== drag.pointerId) return;
  onPointerMove(e);
  drag.active = false;
  drag.pointerId = null;

  const dx = drag.dx;
  const dy = drag.dy;
  const dt = Math.max(1, Date.now() - drag.startTime);
  const bounds = gestureEl.value!.getBoundingClientRect();
  const result = classifyReaderGesture({ dx, dy, duration: dt, maxDistance: drag.maxDistance, width: bounds.width, x: e.clientX - bounds.left });
  const el = activeStageEl();

  if (result.type === 'swipe' || result.type === 'tap') {
    resetStageTransform();
    // 鼠标点击由原生 click 事件处理，避免 pointerup 的严格手势阈值吞掉普通点击。
    // 鼠标拖拽仍在这里翻页，并拦截浏览器随后合成的 click，防止重复翻页。
    if (e.pointerType === 'mouse' && result.type === 'tap') {
      allowMouseClick = true;
      return;
    }
    if (e.pointerType === 'mouse') suppressMouseClick = true;
    if (result.zone === 'left' || result.zone === 'right') {
      turnOriginY = drag.startY - bounds.top;
      if (result.zone === 'left') reader.onLeftButtonClick();
      else reader.onRightButtonClick();
    } else {
      turnOriginY = null;
      ui.toggleChrome();
    }
    return;
  }
  if (gesturePreview) {
    if (e.pointerType === 'mouse') suppressMouseClick = true;
    cancelGestureTurn();
    return;
  }
  // 长按未移动不翻页；拖动不足距离时回弹，且不补发点击。
  if (drag.axis === 'x' && dx && el && el.animate && !prefersReducedMotion()) {
    if (e.pointerType === 'mouse') suppressMouseClick = true;
    el.style.transform = 'translate3d(0, 0, 0)';
    const bounce = el.animate(
      [
        { transform: `translate3d(${dampedOffset(dx)}px, 0, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
    );
    reader.activeTransitionAnims = [bounce];
    bounce.onfinish = () => {
      if (reader.activeTransitionAnims[0] === bounce) reader.activeTransitionAnims = [];
    };
  } else {
    if (e.pointerType === 'mouse') suppressMouseClick = true;
    resetStageTransform();
  }
}

function onClick(e: MouseEvent) {
  if (suppressMouseClick) {
    suppressMouseClick = false;
    allowMouseClick = false;
    lastPointerType = null;
    return;
  }
  if (lastPointerType !== 'mouse' || !allowMouseClick || e.detail === 0 || !reader.currentBook || reader.openingBook || ui.readerDrawerOpen) return;
  allowMouseClick = false;
  lastPointerType = null;
  const bounds = gestureEl.value?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0) return;
  const zone = classifyReaderGesture({ dx: 0, dy: 0, duration: 0, width: bounds.width, x: e.clientX - bounds.left }).zone;
  if (zone === 'left' || zone === 'right') {
    turnOriginY = e.clientY - bounds.top;
    if (zone === 'left') reader.onLeftButtonClick();
    else reader.onRightButtonClick();
  } else {
    turnOriginY = null;
    ui.toggleChrome();
  }
}

function onPointerCancel(event?: PointerEvent) {
  if (event?.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
  if (!drag.active) return;
  drag.active = false;
  drag.pointerId = null;
  if (gesturePreview) cancelGestureTurn();
  else resetStageTransform();
}

onMounted(() => {
  stageResizeObserver = new ResizeObserver(() => {
    onPointerCancel();
    stopPaperTurn();
    applyReaderGeometry();
    if (!isManga.value) reader.handleViewportChange();
  });
  if (pageStage.value) stageResizeObserver!.observe(pageStage.value);
  window.addEventListener('blur', onPointerCancel as EventListener);
  reader.renderFn = requestReaderRender;
  watch(
    () => [
      reader.layoutConfig.spread,
      reader.layoutConfig.pageMargin,
      reader.layoutConfig.fontSize,
      reader.layoutConfig.fontFamily,
      reader.layoutConfig.lineHeight,
      reader.layoutConfig.verticalText,
      isCompact.value
    ],
    applyReaderGeometry
  );
  watch(() => [theme.transitionStyle, reader.layoutConfig.direction, reader.layoutConfig.spread, ui.readerDrawerOpen], () => {
    onPointerCancel();
    stopPaperTurn();
  });
  applyReaderGeometry();
  // store 动作可能在组件挂载前就已完成分页，这里自检后直接首渲染
  if (reader.activePages.length > 0) {
    void runReaderRender('none');
  }
});

onBeforeUnmount(() => {
  reader.renderToken++;
  renderRunId++;
  renderBusy = false;
  clearQueuedTurn();
  pendingRender = 0;
  stopPaperTurn();
  cancelIdlePreload();
  stageResizeObserver?.disconnect();
  window.removeEventListener('blur', onPointerCancel as EventListener);
  reader.renderFn = null;
  cancelBufferAnimations();
  const el = activeStageEl();
  if (el) el.style.transform = 'translate3d(0, 0, 0)';
});
</script>
