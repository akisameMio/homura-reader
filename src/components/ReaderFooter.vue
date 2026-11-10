<template>
  <Transition
    enter-active-class="md-reader-bar-enter-active"
    enter-from-class="translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="md-reader-bar-leave-active"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-3 opacity-0"
  >
    <footer
      v-if="ui.readerChromeVisible && reader.currentBook"
      class="md-reader-footer"
      aria-label="阅读进度"
      :style="{ '--reader-footer-progress': `${progress}%` }"
      @pointerdown.stop
      @click.stop
    >
      <div class="md-reader-footer-row">
        <div class="md-reader-footer-side is-start">
          <button
            v-if="previousPageNumber"
            type="button"
            class="md-reader-footer-history"
            :title="`回到上次位置（第 ${previousPageNumber} 页）`"
            :aria-label="`回到上次位置，第 ${previousPageNumber} 页`"
            @click="reader.returnToPreviousLocation()"
          >
            <span class="md-reader-footer-history-icon" aria-hidden="true">
              <MdIcon name="history" :size="18" />
            </span>
            <span>{{ previousPageNumber }}</span>
          </button>
        </div>

        <div class="md-reader-footer-pages">
          <span
            v-for="(page, index) in visiblePages"
            :key="index"
            class="md-reader-footer-page-label"
          >{{ pageLabel(page) }}</span>
        </div>

        <div class="md-reader-footer-side is-end">
          <span v-if="showChapterRemaining" class="md-reader-footer-remaining">本章还剩 {{ chapterRemaining }} 页</span>
        </div>
      </div>

      <div class="md-reader-footer-track" :class="{ 'is-scrubbing': scrubbing }">
        <input
          ref="rangeEl"
          class="md-reader-footer-range"
          type="range"
          min="0"
          :max="maxIndex"
          step="any"
          :value="sliderValue"
          :disabled="maxIndex === 0"
          aria-label="阅读进度"
          :aria-valuetext="`${previewChapterTitle}，第 ${previewPageNumber} 页`"
          @input="onInput"
          @change="commit"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @focus="onFocus"
          @blur="onBlur"
          @keydown="onKeydown"
        />
        <span class="md-reader-footer-track-rail" aria-hidden="true"></span>
        <span class="md-reader-footer-track-fill" aria-hidden="true"></span>
        <span class="md-reader-footer-thumb" aria-hidden="true"></span>
      </div>

      <Transition
        enter-active-class="md-fade-enter-active"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="md-fade-leave-active"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="bubbleVisible" class="md-reader-footer-bubble" aria-hidden="true">
          <p class="md-reader-footer-bubble-title">{{ previewChapterTitle }}</p>
          <p class="md-reader-footer-bubble-page">第 {{ previewPageNumber }} 页</p>
        </div>
      </Transition>
    </footer>
  </Transition>
</template>

<script setup lang="ts">
/* ============================================================================
   HOMURA · 阅读器底栏
   ----------------------------------------------------------------------------
   仿纸书页脚：左侧回跳历史、中央当前页 / 双页页码、右侧本章剩余；
   底部一条通栏滑条，拖动时只更新气泡预览，松手才交给 store 翻页，
   避免一路 pointermove 都触发图片解码和双缓冲重渲染。
   ========================================================================== */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import { useUiStore } from '../stores/ui.ts';
import MdIcon from './MdIcon.vue';
import type { ReaderPage } from '../types.ts';

const reader = useReaderStore();
const ui = useUiStore();
const rangeEl = shallowRef<HTMLInputElement | null>(null);
const scrubbing = ref(false);
const keyboardFocus = ref(false);
const pointerActive = ref(false);

const total = computed(() => reader.activePages.length);
const maxIndex = computed(() => Math.max(0, total.value - 1));
// 原生 range 走连续值，手柄跟手移动；页码预览和真正落点再取最近页。
const sliderValue = ref(reader.currentIndex);
const previewIndex = computed(() => Math.max(0, Math.min(maxIndex.value, Math.round(sliderValue.value))));

// 当前实际可见的页：双页取整屏，条漫只取滚动到的那一页。
const visiblePages = computed<ReaderPage[]>(() => {
  const pages = reader.activePages;
  if (!pages.length) return [];
  if (reader.layoutConfig.direction === 'vertical') {
    const page = pages[Math.min(reader.currentIndex, pages.length - 1)];
    return page ? [page] : [];
  }
  return reader.getSpreadPair(reader.currentIndex);
});

const chapterRemaining = computed(() => {
  const pages = reader.activePages;
  if (!pages.length) return 0;
  const start = Math.min(reader.currentIndex, pages.length - 1);
  const chapter = pages[start]?.chapterIndex;
  let last = start;
  while (last + 1 < pages.length && pages[last + 1]?.chapterIndex === chapter) last += 1;
  const end = visiblePages.value.reduce((max, page) => {
    const index = pages.indexOf(page);
    return index > max ? index : max;
  }, start);
  return Math.max(0, last - end);
});

const showChapterRemaining = computed(() => reader.currentBook?.type !== 'manga' && chapterRemaining.value > 0);

const previousPageNumber = computed<number | null>(() => {
  if (!reader.canReturnToPreviousLocation) return null;
  const pageNumber = Number(reader.previousLocation?.pageNumber);
  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
});

const progress = computed(() => {
  if (!maxIndex.value) return 0;
  return Math.min(100, Math.max(0, (sliderValue.value / maxIndex.value) * 100));
});

const bubbleVisible = computed(() => scrubbing.value || keyboardFocus.value);

const previewPage = computed(() => reader.activePages[previewIndex.value]);
const previewPageNumber = computed(() => pageNumberFor(previewPage.value, previewIndex.value));
const previewChapterTitle = computed(() => chapterTitleFor(previewPage.value));

watch(() => reader.currentIndex, value => {
  if (!scrubbing.value) sliderValue.value = Math.min(value, maxIndex.value);
});

watch(maxIndex, value => {
  if (!scrubbing.value && sliderValue.value > value) sliderValue.value = Math.max(0, value);
});

watch(() => reader.currentBook?.id, () => {
  scrubbing.value = false;
  pointerActive.value = false;
  sliderValue.value = Math.min(reader.currentIndex, maxIndex.value);
});

function pageNumberFor(page: ReaderPage | undefined, index: number) {
  const pageNumber = Number(page?.pageNumber);
  if (Number.isFinite(pageNumber) && pageNumber > 0) return pageNumber;
  return index + 1;
}

function pageLabel(page: ReaderPage) {
  return `${pageNumberFor(page, reader.activePages.indexOf(page))}/${total.value}页`;
}

function chapterTitleFor(page: ReaderPage | undefined) {
  const explicit = String(page?.chapterTitle || '').trim();
  if (explicit) return explicit;
  const chapters = reader.currentBook?.chapters;
  const chapterIndex = page?.chapterIndex;
  if (chapters && Number.isInteger(chapterIndex)) {
    const title = String(chapters[chapterIndex as number]?.title || '').trim();
    if (title) return title;
  }
  return reader.currentBook?.title || '';
}

function clampSliderValue(value: number) {
  return Math.max(0, Math.min(maxIndex.value, Number.isFinite(value) ? value : 0));
}

function onInput(event: Event) {
  sliderValue.value = clampSliderValue(Number((event.target as HTMLInputElement).value));
}

// 松手 / 键盘 change 只提交一次；重复调用时 currentIndex 已相等，直接跳过。
function commit() {
  const target = previewIndex.value;
  if (target !== reader.currentIndex) reader.jumpToPage(target);
  sliderValue.value = reader.currentIndex;
}

function onPointerDown(event: PointerEvent) {
  pointerActive.value = true;
  scrubbing.value = true;
  ui.pinChrome();
  // 捕获指针：手指拖到元素外再松开也能收到 pointerup，避免 scrubbing / 工具栏钉住状态卡死
  try {
    rangeEl.value?.setPointerCapture(event.pointerId);
  } catch {
    /* 不支持指针捕获的浏览器退回普通流程 */
  }
}

function onPointerUp() {
  if (!pointerActive.value) return;
  pointerActive.value = false;
  scrubbing.value = false;
  commit();
  rangeEl.value?.blur();
  ui.unpinChrome();
}

function onPointerCancel() {
  if (!pointerActive.value) return;
  pointerActive.value = false;
  scrubbing.value = false;
  sliderValue.value = reader.currentIndex;
  rangeEl.value?.blur();
  ui.unpinChrome();
}

function onFocus() {
  // 鼠标拖动的 focus 由 pointer 流程管理，只有键盘 Tab 进入才钉住工具栏
  if (pointerActive.value) return;
  keyboardFocus.value = true;
  ui.pinChrome();
}

function onBlur() {
  keyboardFocus.value = false;
  if (!pointerActive.value) ui.unpinChrome();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    rangeEl.value?.blur();
    return;
  }

  let target: number | null = null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = previewIndex.value - 1;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = previewIndex.value + 1;
  else if (event.key === 'Home') target = 0;
  else if (event.key === 'End') target = maxIndex.value;
  else if (event.key === 'PageUp') target = previewIndex.value - Math.max(1, Math.round(maxIndex.value / 10));
  else if (event.key === 'PageDown') target = previewIndex.value + Math.max(1, Math.round(maxIndex.value / 10));
  else return;

  // 不让原生 range 再按 step 改一次值；键盘整页步进由这里统一处理。
  event.preventDefault();
  sliderValue.value = clampSliderValue(target);
  commit();
}

// 系统级打断（切后台 / 窗口失焦）时兜底复位，避免 chromePinned 被永久钉住
function abortPointer() {
  if (pointerActive.value) onPointerCancel();
}
onMounted(() => window.addEventListener('blur', abortPointer));
onBeforeUnmount(() => window.removeEventListener('blur', abortPointer));
</script>
