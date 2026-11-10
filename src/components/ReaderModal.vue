<template>
  <!-- Reader Fullscreen Modal · 沉浸式：工具栏浮在画布上，默认自动隐藏 -->
  <div
    v-show="!!reader.currentBook"
    class="reader-dismiss-layer fixed inset-0 bg-[var(--md-reader-paper)] z-50 flex flex-col transition-colors duration-200"
    :data-reader-mode="theme.readerSurfaceMode"
  >
    <div
      v-if="isCompact && !!reader.currentBook && !nativePredictiveBackSupported"
      class="reader-back-edge"
      aria-hidden="true"
      @pointerdown="onBackPointerDown"
      @pointermove="onBackPointerMove"
      @pointerup="onBackPointerUp"
      @pointercancel="onBackPointerCancel"
      @lostpointercapture="onBackPointerLostCapture"
    ></div>

    <div
      ref="viewportRef"
      class="relative flex-1 min-h-0 overflow-hidden select-text"
      @pointermove="onViewportPointerMove"
      @pointerdown="onTouchStart"
      @pointerup="onTouchEnd"
      @pointercancel="cancelVerticalGesture"
      @lostpointercapture="cancelVerticalGesture"
    >
      <template v-if="reader.currentBook">
        <!-- 纸面铺满整块画布：设置抽屉浮在纸面上，不再挤压正文重排 -->
        <div
          class="reader-stage-shell"
          :class="{ 'is-obscured': ui.readerDrawerOpen, 'is-chrome': ui.readerChromeVisible }"
        >
          <WebtoonView
            v-if="reader.layoutConfig.direction === 'vertical'"
            :key="'webtoon-' + reader.currentBook?.id"
          />
          <template v-else>
            <PaginatedView :key="'paginated-' + reader.currentBook?.type + '-' + reader.currentBook?.id" />
            <!-- 左右翻页箭头：跟手翻页之外给鼠标用户一个落点，悬停纸面时浮现 -->
            <button
              type="button"
              class="reader-page-arrow is-prev"
              :class="{ 'is-dim': reader.atFirstPage && !reader.currentCollection }"
              title="上一页 (←)"
              aria-label="上一页"
              @click="reader.onLeftButtonClick()"
            >
              <MdIcon name="chevron_left" />
            </button>
            <button
              type="button"
              class="reader-page-arrow is-next"
              :class="{ 'is-dim': reader.atLastPage && !reader.currentCollection }"
              title="下一页 (→)"
              aria-label="下一页"
              @click="reader.onRightButtonClick()"
            >
              <MdIcon name="chevron_right" />
            </button>
          </template>

        </div>
      </template>

      <Transition
        enter-active-class="md-reader-bar-enter-active"
        enter-from-class="-translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="md-reader-bar-leave-active"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="-translate-y-2 opacity-0"
      >
        <ReaderTopBar
          v-if="ui.readerChromeVisible"
          @back="dismissWithPredictiveBack"
        />
      </Transition>

      <ReaderFooter />
      <ReaderTocDrawer />
      <ReaderSettingsDrawer />
      <ReaderCollectionDrawer />
      <Transition
        enter-active-class="md-fade-enter-active"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="md-fade-leave-active"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="reader.openingBook || reader.openError"
          class="md-reader-status"
          :role="reader.openError ? 'alert' : 'status'"
          :aria-live="reader.openError ? 'assertive' : 'polite'"
        >
          <span v-if="!reader.openError" class="md-reader-spinner" aria-hidden="true"></span>
          <span class="md-reader-status-copy">{{ reader.openError || '正在打开书本…' }}</span>
          <button v-if="reader.openError" type="button" class="md-text-button" @click="reader.clearOpenError()">关闭</button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
/* ============================================================================
   HOMURA · 阅读器整屏遮罩
   ----------------------------------------------------------------------------
   画布铺满窗口，顶部/底部工具栏以浮层形式出现并自动隐藏；
   鼠标靠近上/下边缘、点击画布或按 Esc 唤出，2.2 秒无操作淡出；
   触屏点中间区域切换工具栏，条漫模式轻点画布切换。
   设置与目录改为左右抽屉，不再占用顶栏。
   ========================================================================== */

import { shallowRef, watch, onBeforeUnmount } from 'vue';
import { classifyReaderGesture } from '../services/readerGestures.ts';
import { useReaderStore } from '../stores/reader.ts';
import { useUiStore } from '../stores/ui.ts';
import { useThemeStore } from '../stores/theme.ts';
import { useViewport } from '../composables/useViewport.ts';
import { useShortcuts } from '../composables/useShortcuts.ts';
import { useReaderBackDismiss } from '../composables/useReaderBackDismiss.ts';
import { useVolumeKeys } from '../composables/useVolumeKeys.ts';
import MdIcon from './MdIcon.vue';
import ReaderTopBar from './ReaderTopBar.vue';
import ReaderFooter from './ReaderFooter.vue';
import ReaderTocDrawer from './ReaderTocDrawer.vue';
import ReaderSettingsDrawer from './ReaderSettingsDrawer.vue';
import ReaderCollectionDrawer from './ReaderCollectionDrawer.vue';
import PaginatedView from './PaginatedView.vue';
import WebtoonView from './WebtoonView.vue';

const reader = useReaderStore();
const ui = useUiStore();
const theme = useThemeStore();
const { isCompact } = useViewport();
const viewportRef = shallowRef<HTMLElement | null>(null);
const {
  onPointerDown: onBackPointerDown,
  onPointerMove: onBackPointerMove,
  onPointerUp: onBackPointerUp,
  onPointerCancel: onBackPointerCancel,
  onPointerLostCapture: onBackPointerLostCapture,
  dismissWithPredictiveBack,
  nativePredictiveBackSupported
} = useReaderBackDismiss(reader, ui);

// 桌面：鼠标贴近上下边缘唤出工具栏；工具栏可见时，移动鼠标会重新计时
function onMouseMove(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || e.buttons) return;
  if (!reader.currentBook) return;
  const nearEdge = e.clientY <= 88 || e.clientY >= window.innerHeight - 88;
  if (nearEdge || ui.readerChromeVisible) ui.showChrome();
}

// 条漫保留原生纵向滚动，鼠标按住正文也可上下拖动，短点沿用四分区。
const tapInfo = { active: false, pointerId: null as number | null, x: 0, y: 0, t: 0, maxDistance: 0, scrollTop: 0 };

function onTouchStart(e: PointerEvent) {
  if (reader.layoutConfig.direction !== 'vertical' || e.isPrimary === false) return;
  if (ui.readerDrawerOpen) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if ((e.target as HTMLElement | null)?.closest?.('button, input, a, select, textarea, [role="dialog"]')) return;
  tapInfo.active = true;
  tapInfo.pointerId = e.pointerId;
  tapInfo.x = e.clientX;
  tapInfo.y = e.clientY;
  tapInfo.t = Date.now();
  tapInfo.maxDistance = 0;
  tapInfo.scrollTop = viewportRef.value!.querySelector('[data-reader-scroll]')?.scrollTop || 0;
}

function onViewportPointerMove(e: PointerEvent) {
  onMouseMove(e);
  if (!tapInfo.active || tapInfo.pointerId !== e.pointerId) return;
  const dx = e.clientX - tapInfo.x;
  const dy = e.clientY - tapInfo.y;
  tapInfo.maxDistance = Math.max(tapInfo.maxDistance, Math.abs(dx), Math.abs(dy));
  if (e.pointerType === 'mouse' && Math.abs(dy) >= 8 && Math.abs(dy) > Math.abs(dx)) {
    const root = viewportRef.value!.querySelector('[data-reader-scroll]');
    if (root) root.scrollTop = tapInfo.scrollTop - dy;
    e.preventDefault();
    try { viewportRef.value!.setPointerCapture(e.pointerId); } catch (err) {}
  }
}

function onTouchEnd(e: PointerEvent) {
  if (!tapInfo.active || tapInfo.pointerId !== e.pointerId) return;
  tapInfo.active = false;
  const bounds = viewportRef.value!.getBoundingClientRect();
  const result = classifyReaderGesture({ dx: e.clientX - tapInfo.x, dy: e.clientY - tapInfo.y, duration: Date.now() - tapInfo.t, maxDistance: tapInfo.maxDistance, width: bounds.width, x: e.clientX - bounds.left });
  if (ui.readerDrawerOpen || result.type === 'cancel') return;
  if (result.zone === 'left') reader.onLeftButtonClick();
  else if (result.zone === 'right') reader.onRightButtonClick();
  else ui.toggleChrome();
}

function cancelVerticalGesture() { tapInfo.active = false; }

watch(() => reader.currentCollection?.id, id => { if (!id && ui.collectionTocOpen) ui.closeCollectionToc(); });

// 阅读器隐藏 body 滚动前，记录页面滚动条宽度。部分 WebView 不支持
// scrollbar-gutter，若只隐藏滚动条，返回结束时书架会被突然挤窄。
function pageScrollsVertically() {
  const root = document.documentElement;
  return root.scrollHeight > root.clientHeight + 1 || window.scrollY > 0;
}

function measureScrollbarWidth() {
  // 用 fixed 探针直接量 fixed 元素实际可用的视口宽度；overlay 滚动条为 0
  return Math.max(0, Math.round(window.innerWidth - measureFixedViewportWidth()));
}

function measureFixedViewportWidth() {
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'right:0',
    'width:1px',
    'height:1px',
    'visibility:hidden',
    'pointer-events:none'
  ].join(';');
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().right;
  probe.remove();
  return width;
}

function setReaderScrollLock(locked: boolean) {
  const html = document.documentElement;
  const isLocked = html.classList.contains('reader-scroll-locked');
  if (locked === isLocked) return;

  if (locked) {
    let scrollbarWidth = 0;
    if (pageScrollsVertically()) {
      scrollbarWidth = measureScrollbarWidth();
      html.style.setProperty(
        '--homura-reader-scrollbar-width',
        `${scrollbarWidth}px`
      );
      html.classList.add('reader-scroll-reserved');
    }
    html.classList.add('reader-scroll-locked');
    // WKWebView 在滚动条隐藏后，scrollbar-gutter 可能与可见滚动条宽度不同。
    // 按锁定后的真实可用宽度修正 fixed 按钮，避免退出阅读器时横向跳动。
    const contentWidth = window.innerWidth - scrollbarWidth;
    html.style.setProperty(
      '--homura-reader-fab-offset',
      `${measureFixedViewportWidth() - contentWidth}px`
    );
    return;
  }

  html.classList.remove('reader-scroll-locked');
  html.classList.remove('reader-scroll-reserved');
  html.style.removeProperty('--homura-reader-scrollbar-width');
  html.style.removeProperty('--homura-reader-fab-offset');
}

// 阅读器是全屏遮罩，锁住底层书架页的滚动，避免右侧多出无用的长滚动条
watch(() => reader.currentBook?.id, id => {
  cancelVerticalGesture();
  setReaderScrollLock(!!id);
  document.documentElement.classList.toggle('reader-active', !!id);
  ui.resetReaderUi();
  if (id) ui.showChrome();
});

onBeforeUnmount(() => {
  setReaderScrollLock(false);
  document.documentElement.classList.remove('reader-active');
});

useShortcuts(reader, viewportRef, dismissWithPredictiveBack);
useVolumeKeys(reader, ui);
</script>
