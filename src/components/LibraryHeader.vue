<template>
  <!-- 书架页头部：MD3 Top App Bar -->
  <div
    ref="headerRef"
    class="library-header-bar z-20"
    :class="{ 'is-scroll-hidden': scrollHidden }"
    :style="isCompact ? { paddingTop: 'env(safe-area-inset-top)' } : null"
  >
    <!-- Top App Bar: 桌面 64px / 手机 56px -->
    <div
      ref="toolbarRef"
      class="library-toolbar"
      :class="{ 'is-search-open': searchOpen }"
      :style="{ '--library-pill-button-count': 3 + Number(showFullscreen) + Number(!!$slots.actions) }"
      :inert="scrollHidden"
    >
      <div class="library-toolbar-title" :inert="searchOpen && isCompact">
        <Transition name="library-title" mode="out-in" appear @enter="onTitleEnter">
          <button
            v-if="renamable"
            :key="title"
            type="button"
            class="group flex items-center gap-1.5 min-w-0 text-left text-[21px] min-[900px]:text-[22px] font-medium tracking-tight"
            :title="t('重命名书库')"
            :aria-label="t('重命名书库：{0}', { 0: title })"
            @click="$emit('rename')"
          >
            <span class="min-w-0 truncate">{{ title }}</span>
            <MdIcon name="edit" class="w-3.5 h-3.5 shrink-0 text-[var(--md-on-surface-variant)] opacity-50 group-hover:opacity-80 transition-opacity duration-200" />
          </button>
          <h1 v-else :key="title" class="text-[21px] min-[900px]:text-[22px] font-medium tracking-tight min-w-0 truncate">{{ title }}</h1>
        </Transition>
        <span ref="countBadgeRef" class="hidden min-[360px]:inline-flex shrink-0 whitespace-nowrap text-[var(--md-on-surface-variant)] font-mono text-[10px] min-[900px]:text-[12px] font-semibold">{{ t('{0} 部作品', { 0: count }) }}</span>
      </div>

      <div ref="searchTrackRef" class="library-search-track">
        <div class="library-pill-surface"></div>
        <div class="library-pill-content">
          <div class="library-pill-buttons" :inert="searchOpen">
            <button
              v-if="showFullscreen"
              type="button"
              @click="ui.toggleFullscreen()"
              class="library-tool"
              :title="ui.fullscreen ? t('退出全屏 (F)') : t('全屏 (F)')"
              :aria-label="ui.fullscreen ? t('退出全屏 (F)') : t('全屏 (F)')"
              :aria-pressed="ui.fullscreen"
            >
              <MdIcon :name="ui.fullscreen ? 'fullscreen_exit' : 'fullscreen'" class="w-5 h-5" />
            </button>
            <button
              type="button"
              @click="$emit('toggle-appearance')"
              class="library-tool"
              :class="{ 'is-tonal': appearanceOpen }"
              :title="t('外观设置')"
              :aria-label="t('外观设置')"
              aria-haspopup="dialog"
              :aria-expanded="appearanceOpen"
            >
              <MdIcon name="palette" class="w-5 h-5" />
            </button>

            <div v-if="$slots.actions">
              <slot name="actions" />
            </div>
            <button
              type="button"
              class="library-tool"
              :class="{ 'is-tonal': filterOpen || type !== 'all' }"
              :title="t('筛选与排序')"
              :aria-label="t('筛选与排序')"
              :aria-expanded="filterOpen"
              aria-haspopup="dialog"
              @click="$emit('update:filterOpen', true)"
            >
              <MdIcon name="tune" class="w-5 h-5" />
            </button>
            <button
              ref="searchButtonRef"
              type="button"
              class="library-tool library-pill-search"
              :class="{ 'is-tonal': !!query }"
              :title="t('搜索书名、作者')"
              :aria-label="t('搜索书名、作者')"
              aria-controls="library-toolbar-search"
              :aria-expanded="searchOpen"
              @click="openSearch"
            >
              <MdIcon name="search" :size="22" />
            </button>
          </div>
          <div
            ref="searchFieldRef"
            id="library-toolbar-search"
            class="library-search-field"
            role="search"
            :inert="!searchOpen"
            @focusout="onSearchFocusOut"
            @keydown="onSearchKeydown"
          >
            <MdIcon name="search" :size="17" class="library-search-icon" />
            <input
              ref="searchInputRef"
              :value="query"
              @input="emit('update:query', ($event.target as HTMLInputElement).value)"
              type="search"
              inputmode="search"
              enterkeyhint="search"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :aria-label="t('搜索书名、作者')"
              :placeholder="t('搜索')"
              class="library-search-input"
            />
            <button
              v-if="query"
              type="button"
              class="library-tool library-search-end"
              :title="t('清空搜索')"
              :aria-label="t('清空搜索')"
              @pointerdown.prevent
              @click="clearSearch"
            >
              <MdIcon name="close" :size="18" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <MobileBottomSheet
    :open="filterOpen"
    desktop-side
    :title="t('筛选与排序')"
    title-id="shelf-filter-title"
    @close="$emit('update:filterOpen', false)"
    @cancel="$emit('update:filterOpen', false)"
  >
    <div class="md-mobile-sheet-card shelf-filter-card">
      <h3 class="shelf-filter-label">{{ t('作品分类') }}</h3>
      <MdSegmentedControl
        class="shelf-category-control"
        :model-value="type"
        :options="categoryOptions"
        aria-label="作品分类"
        @update:model-value="$emit('update:type', $event)"
      />

      <h3 id="shelf-format-label" class="shelf-filter-label shelf-format-label">{{ t('文件格式') }}</h3>
      <div class="shelf-format-options" role="group" aria-labelledby="shelf-format-label">
        <button
          v-for="option in formatOptions"
          :key="option.value"
          type="button"
          class="md-filter-chip"
          :class="{ 'is-selected': type === option.value }"
          :aria-pressed="type === option.value"
          @click="$emit('update:type', option.value)"
        >
          <span>{{ t(option.label) }}</span>
        </button>
      </div>
    </div>

    <h3 id="shelf-sort-label" class="md-mobile-sheet-label">{{ t('排序方式') }}</h3>
    <div class="md-mobile-sheet-card shelf-sort-options" role="group" aria-labelledby="shelf-sort-label">
      <button
        v-for="option in sortOptions"
        :key="option.value"
        type="button"
        class="md-drawer-list-item shelf-sort-option"
        :class="{ 'is-active': sort === option.value }"
        :aria-pressed="sort === option.value"
        @click="$emit('update:sort', option.value)"
      >
        <span>{{ t(option.label) }}</span>
        <MdIcon v-if="sort === option.value" name="check" :size="17" />
      </button>
    </div>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, shallowRef, onBeforeUnmount, type PropType } from 'vue';
import { useSettingsStore } from '../stores/settings.ts';
import { useUiStore } from '../stores/ui.ts';
import { useViewport } from '../composables/useViewport.ts';
import { shelfFormatFilters } from '../services/shelfSections.ts';
import { makeAxis, prefersReducedMotion, runSpring, snapAxes } from '../services/spring.ts';
import MdIcon from './MdIcon.vue';
import MdSegmentedControl from './MdSegmentedControl.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  title: { type: String, default: '书架' },
  count: { type: Number, default: 0 },
  scrollRoot: { type: Object as PropType<HTMLElement | null>, default: null },
  containedScroll: { type: Boolean, default: false },
  appearanceOpen: { type: Boolean, default: false },
  filterOpen: { type: Boolean, default: false },
  query: { type: String, default: '' },
  type: { type: String, default: 'all' },
  sort: { type: String, default: 'title' },
  renamable: { type: Boolean, default: false }
});

const emit = defineEmits(['update:query', 'update:type', 'update:sort', 'update:filterOpen', 'toggle-appearance', 'rename']);

const settings = useSettingsStore();
const ui = useUiStore();
const { isCompact } = useViewport();
const showFullscreen = computed(() => !isCompact.value && settings.showFullscreenButton);

const searchOpen = ref(false);
const scrollHidden = ref(false);
const headerRef = shallowRef<HTMLElement | null>(null);
const toolbarRef = shallowRef<HTMLElement | null>(null);
const searchTrackRef = shallowRef<HTMLElement | null>(null);
const searchFieldRef = shallowRef<HTMLElement | null>(null);
const searchInputRef = shallowRef<HTMLInputElement | null>(null);
const searchButtonRef = shallowRef<HTMLButtonElement | null>(null);
const headerSpring = makeAxis(0, 620);
const searchSpring = makeAxis(0, 740);
let cancelSearchSpring: (() => void) | null = null;
let closeSpringDelay: ReturnType<typeof setTimeout> | undefined;

const usesInnerScroller = computed(() => isCompact.value || props.containedScroll);

watch([() => props.scrollRoot, usesInnerScroller, isCompact, () => props.title], ([root, inner, compact], _, onCleanup) => {
  scrollHidden.value = false;
  if (!root) return;

  const scroller = inner ? root : document.scrollingElement ?? document.documentElement;
  const eventTarget = inner ? root : window;
  const scrollLimit = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  let limit = scrollLimit();
  let turningPoint = Math.max(0, Math.min(limit, scroller.scrollTop));
  let touch: { x: number; startY: number; y: number; turningY: number; vertical: boolean } | null = null;

  function keepHeaderVisible() {
    return searchOpen.value || props.appearanceOpen || props.filterOpen
      || !!toolbarRef.value?.querySelector(':focus-visible');
  }

  function updateTouchHeader(top: number) {
    if (!touch?.vertical) return;
    if (keepHeaderVisible()) {
      scrollHidden.value = false;
      touch.turningY = touch.y;
    } else if (scrollHidden.value) {
      touch.turningY = Math.min(touch.turningY, touch.y);
      if (touch.y - touch.turningY >= 8) {
        scrollHidden.value = false;
        touch.turningY = touch.y;
      }
    } else {
      touch.turningY = Math.max(touch.turningY, touch.y);
      if (top > 1 && touch.turningY - touch.y >= 12) {
        scrollHidden.value = true;
        touch.turningY = touch.y;
      }
    }
  }

  function onShelfScroll() {
    const nextLimit = scrollLimit();
    const top = Math.max(0, Math.min(nextLimit, scroller.scrollTop));
    // 手机顶栏收起会增加内容区高度。触底后的 scrollTop 钳制不算反向滚动。
    const wasClamped = nextLimit < limit && top >= nextLimit - 1 && turningPoint >= nextLimit - 1;
    limit = nextLimit;
    if (top <= 1 || keepHeaderVisible()) {
      scrollHidden.value = false;
      turningPoint = top;
    } else if (wasClamped) {
      turningPoint = top;
    } else if (touch?.vertical) {
      // 手指按住时按触控方向切换；松手后再交还给原生惯性滚动。
      updateTouchHeader(top);
      turningPoint = top;
    } else if (scrollHidden.value) {
      turningPoint = Math.max(turningPoint, top);
      if (turningPoint - top >= 8) {
        scrollHidden.value = false;
        turningPoint = top;
      }
    } else {
      turningPoint = Math.min(turningPoint, top);
      if (top - turningPoint >= 12) {
        scrollHidden.value = true;
        turningPoint = top;
      }
    }
  }

  function onTouchStart(event: TouchEvent) {
    const point = event.touches.length === 1 ? event.touches[0] : null;
    touch = point ? { x: point.clientX, startY: point.clientY, y: point.clientY, turningY: point.clientY, vertical: false } : null;
  }

  function onTouchMove(event: TouchEvent) {
    if (!touch) return;
    if (event.touches.length !== 1 || document.body.classList.contains('md-touch-dragging')) {
      touch = null;
      return;
    }
    const point = event.touches[0];
    touch.y = point.clientY;
    if (!touch.vertical) {
      const horizontal = Math.abs(point.clientX - touch.x);
      const vertical = Math.abs(touch.y - touch.startY);
      if (horizontal >= 8 && horizontal >= vertical) touch = null;
      if (!touch || vertical < 8 || vertical <= horizontal * 1.15) return;
      touch.vertical = true;
    }
    updateTouchHeader(scroller.scrollTop);
  }

  function onTouchEnd() {
    touch = null;
    turningPoint = Math.max(0, Math.min(scrollLimit(), scroller.scrollTop));
  }

  eventTarget.addEventListener('scroll', onShelfScroll, { passive: true });
  if (compact) {
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }
  onCleanup(() => {
    eventTarget.removeEventListener('scroll', onShelfScroll);
    if (compact) {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
    }
  });
}, { immediate: true, flush: 'post' });

watch(scrollHidden, (hidden, _, onCleanup) => {
  const header = headerRef.value;
  if (!header) return;

  headerSpring.target = hidden ? 1 : 0;
  const property = '--library-header-spring-progress';
  if (prefersReducedMotion()) {
    snapAxes([headerSpring]);
    header.style.removeProperty(property);
    return;
  }

  const paint = () => {
    const progress = Math.min(1, Math.max(0, headerSpring.pos));
    header.style.setProperty(property, String(progress));
  };
  // 顶栏位移和手机内容区腾出的空间共用一个进度，反向时保留弹簧速度。
  paint();
  onCleanup(runSpring([headerSpring], paint, () => {
    header.style.removeProperty(property);
  }, { damping: 0.9 }));
});

watch(searchOpen, open => {
  const toolbar = toolbarRef.value;
  if (!toolbar) return;
  cancelSearchSpring?.();
  cancelSearchSpring = null;
  clearTimeout(closeSpringDelay);
  searchSpring.target = open ? 1 : 0;
  if (prefersReducedMotion()) {
    snapAxes([searchSpring]);
    toolbar.style.removeProperty('--library-search-spring-progress');
    return;
  }

  const startProgress = Math.min(1, Math.max(0, searchSpring.pos));
  const collapseDelay = !open && startProgress >= 0.98 && Math.abs(searchSpring.vel) < 0.04 ? 80 : 0;
  if (open) {
    toolbar.style.setProperty('--library-field-appear-delay', `${Math.round(125 * (1 - startProgress))}ms`);
  } else {
    toolbar.style.setProperty('--library-pill-return-delay', `${collapseDelay + Math.round(134 * startProgress)}ms`);
  }

  // 反向切换沿用当前弹簧的位移和速度，每帧只更新 DOM 样式。
  const paint = () => {
    const progress = Math.min(1, Math.max(0, searchSpring.pos));
    toolbar.style.setProperty('--library-search-spring-progress', String(progress));
  };
  paint();
  const animate = () => {
    cancelSearchSpring = runSpring([searchSpring], paint, () => {
      cancelSearchSpring = null;
      toolbar.style.removeProperty('--library-search-spring-progress');
    }, { damping: 0.94 });
  };
  // 已展开时先淡出文字。途中反向时马上交给弹簧，保留当帧速度。
  if (collapseDelay) {
    closeSpringDelay = setTimeout(animate, collapseDelay);
  } else {
    animate();
  }
});

watch(searchOpen, (open, _, onCleanup) => {
  if (!open) return;
  function dismissOutside(event: PointerEvent) {
    if (event.target instanceof Node && !searchTrackRef.value?.contains(event.target)) void closeSearch();
  }
  document.addEventListener('pointerdown', dismissOutside, true);
  onCleanup(() => document.removeEventListener('pointerdown', dismissOutside, true));
});

function openSearch() {
  const field = searchFieldRef.value;
  if (!field) return;
  searchOpen.value = true;
  // 在点击回调内聚焦，保留 iOS 唤起软键盘所需的用户手势。
  field.inert = false;
  searchInputRef.value?.focus({ preventScroll: true });
}

async function closeSearch(restoreFocus = false) {
  searchOpen.value = false;
  if (restoreFocus) {
    await nextTick();
    if (!searchOpen.value) searchButtonRef.value?.focus({ preventScroll: true });
  }
}

function onSearchFocusOut(event: FocusEvent) {
  const field = event.currentTarget as HTMLElement;
  if (!(event.relatedTarget instanceof Node) || !field.contains(event.relatedTarget)) closeSearch();
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key !== 'Escape' && (event.key !== 'Enter' || event.target !== searchInputRef.value)) return;
  event.preventDefault();
  event.stopPropagation();
  void closeSearch(true);
}

function clearSearch() {
  emit('update:query', '');
  searchInputRef.value?.focus({ preventScroll: true });
}

const countBadgeRef = shallowRef<HTMLElement | null>(null);
let previousBadgeLeft: number | null = null;
let badgeAnimation: Animation | null = null;

// 标题变化前记录徽章位置；新标题进场时用 FLIP 补间，制造被文字推动的效果。
watch(() => props.title, () => {
  const badge = countBadgeRef.value;
  if (!badge) {
    previousBadgeLeft = null;
    return;
  }
  const rect = badge.getBoundingClientRect();
  previousBadgeLeft = rect.width > 0 ? rect.left : null;
});

function onTitleEnter() {
  const badge = countBadgeRef.value;
  const oldLeft = previousBadgeLeft;
  previousBadgeLeft = null;
  if (!badge || oldLeft === null) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  badgeAnimation?.cancel();
  badgeAnimation = null;
  const newLeft = badge.getBoundingClientRect().left;
  const offset = oldLeft - newLeft;
  if (Math.abs(offset) < 0.5) return;

  badgeAnimation = badge.animate(
    [
      { transform: `translate3d(${offset}px, 0, 0)` },
      { transform: 'translate3d(0, 0, 0)' }
    ],
    { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
  );
  badgeAnimation.onfinish = () => { badgeAnimation = null; };
}

onBeforeUnmount(() => {
  cancelSearchSpring?.();
  clearTimeout(closeSpringDelay);
  badgeAnimation?.cancel();
  badgeAnimation = null;
});

const categories = [
  { value: 'all', label: '全部' },
  { value: 'manga', label: '漫画' },
  { value: 'novel', label: '轻小说' },
  { value: 'other', label: '其他' }
];
const categoryOptions = computed(() => categories.map(option => ({
  ...option,
  icon: option.value === props.type ? 'check' : undefined
})));

const formatOptions = [{ value: 'all', label: '不限格式' }, ...shelfFormatFilters];

const sortOptions = [
  { value: 'title', label: '书名 · 数字 / 字母 / 拼音' },
  { value: 'recent', label: '最近添加' },
  { value: 'progress', label: '阅读进度' }
];
</script>

<style scoped>
.library-header-bar {
  --library-toolbar-height: var(--library-desktop-toolbar-height, 64px);
  --library-header-target: 0;
  --library-header-progress: var(--library-header-target);
  position: sticky;
  top: 0;
  pointer-events: none;
  transform: translateY(calc(-100% * var(--library-header-progress)));
}
.has-contained-shelf-scroll .library-header-bar {
  position: absolute;
  inset: 0 0 auto;
}
.library-header-bar.is-scroll-hidden {
  --library-header-target: 1;
}
@media (prefers-reduced-motion: no-preference) {
  .library-header-bar {
    --library-header-progress: var(--library-header-spring-progress, var(--library-header-target));
  }
}

.library-toolbar {
  --library-toolbar-inset: 28px;
  --library-action-size: 44px;
  --library-pill-rest: calc(var(--library-action-size) * var(--library-pill-button-count) + 8px);
  --library-search-width: 340px;
  --library-pill-width: calc(var(--library-pill-rest) + (var(--library-search-width) - var(--library-pill-rest)) * var(--library-search-progress));
  --library-search-target: 0;
  --library-search-progress: var(--library-search-target);
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--library-toolbar-height);
  padding-inline-start: var(--library-toolbar-inset);
  padding-inline-end: calc(var(--library-toolbar-inset) + var(--library-pill-width) + 8px);
}
.library-toolbar.is-search-open {
  --library-search-target: 1;
}
@media (prefers-reduced-motion: no-preference) {
  .library-toolbar {
    --library-search-progress: var(--library-search-spring-progress, var(--library-search-target));
  }
}
.library-toolbar-title {
  display: flex;
  align-items: center;
  gap: inherit;
  min-width: 0;
  height: var(--library-action-size);
  padding-inline: 14px;
}
.library-toolbar-title,
.library-pill-surface {
  border-radius: 9999px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--md-outline-variant) 38%, transparent),
    var(--md-elevation-level1);
}
.library-tool {
  display: grid;
  width: var(--library-action-size);
  height: var(--library-action-size);
  flex: none;
  place-items: center;
  border-radius: 50%;
  color: var(--md-on-surface);
  transition: background-color 200ms var(--md-ease-emphasized);
}
.library-tool.is-tonal {
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}
@media (hover: hover) and (pointer: fine) {
  .library-tool:not(.is-tonal):hover {
    background: color-mix(in oklab, var(--md-on-surface) 8%, transparent);
  }
}
.library-search-track {
  position: absolute;
  z-index: 1;
  inset-inline-end: var(--library-toolbar-inset);
  width: var(--library-search-width);
  height: var(--library-action-size);
  pointer-events: none;
}
.library-pill-surface {
  position: absolute;
  inset-block: 0;
  right: 0;
  width: calc(var(--library-pill-rest) + (100% - var(--library-pill-rest)) * var(--library-search-progress));
}
.library-pill-content {
  position: absolute;
  inset: 0;
  clip-path: inset(0 0 0 calc((100% - var(--library-pill-rest)) * (1 - var(--library-search-progress))) round 9999px);
}
.library-pill-buttons,
.library-search-field {
  position: absolute;
  inset-block: 0;
  display: flex;
  align-items: center;
}
.library-pill-buttons {
  right: 0;
  width: var(--library-pill-rest);
  padding-inline: 4px;
}
.library-toolbar-title:not([inert]) > button,
.library-pill-buttons:not([inert]),
.library-search-field:not([inert]) {
  pointer-events: auto;
}
.library-pill-buttons > * {
  --library-icon-delay: var(--library-pill-return-delay, 214ms);
  opacity: 1;
  filter: blur(0);
  transition:
    opacity 110ms var(--md-ease-emphasized) var(--library-icon-delay),
    filter 110ms var(--md-ease-emphasized) var(--library-icon-delay),
    background-color 200ms var(--md-ease-emphasized);
}
.library-pill-buttons .library-pill-search {
  --library-icon-delay: calc(var(--library-pill-return-delay, 214ms) + 40ms);
}
.is-search-open .library-pill-buttons > * {
  opacity: 0;
  filter: blur(5px);
  transition-delay: 0ms;
  transition-duration: 78ms, 78ms, 200ms;
}
.library-search-field {
  inset-inline: 0;
  gap: 8px;
  padding-inline-start: 15px;
  opacity: 0;
  filter: blur(5px);
  transition: opacity 80ms var(--md-ease-emphasized), filter 80ms var(--md-ease-emphasized);
}
.is-search-open .library-search-field {
  opacity: 1;
  filter: blur(0);
  transition-delay: var(--library-field-appear-delay, 125ms);
  transition-duration: 120ms;
}
.library-search-icon {
  flex: none;
  color: var(--md-on-surface-variant);
}
.library-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--md-on-surface);
  font-size: 13px;
  font-weight: 500;
  caret-color: var(--md-primary);
}
.library-search-input::placeholder {
  color: var(--md-on-surface-variant);
}
.library-search-input:focus-visible {
  outline: none;
}
.library-pill-buttons .library-tool:focus-visible,
.library-search-end:focus-visible {
  outline-offset: -4px;
}

/* 手机书架顶栏留在滚动区外，搜索展开时占用原有顶栏宽度。 */
@media (max-width: 899px) {
  .library-header-bar {
    --library-toolbar-height: 56px;
    position: relative;
    flex: 0 0 auto;
    margin-block-end: calc(-1 * var(--library-toolbar-height) * var(--library-header-progress));
  }
  .library-toolbar {
    --library-toolbar-inset: 16px;
    --library-search-width: calc(100% - var(--library-toolbar-inset) * 2);
    gap: 6px;
    padding-inline-end: calc(var(--library-toolbar-inset) + var(--library-pill-rest) + 4px);
  }
  .library-toolbar-title {
    padding-inline: 10px;
    opacity: calc(1 - var(--library-search-progress));
  }
  .library-search-input {
    font-size: 16px;
  }
}
@media (max-width: 399px) {
  .library-toolbar {
    --library-toolbar-inset: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .library-pill-buttons > *,
  .library-search-field {
    transition: none;
  }
}

.shelf-filter-card {
  padding: 14px;
}
.shelf-filter-label {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}
.shelf-format-label {
  margin-top: 14px;
  margin-bottom: 2px;
}
.shelf-category-control {
  --md-segmented-selected-bg: var(--md-secondary-container);
  --md-segmented-selected-color: var(--md-on-secondary-container);
}
.shelf-category-control :deep(.md-segmented-option) {
  min-height: 38px;
  padding: 4px;
  white-space: normal;
}
.shelf-category-control :deep(.md-segmented-option:not(.is-selected)) {
  color: var(--md-on-surface);
}
.shelf-category-control :deep(.md-segmented-option.is-selected > .md3-icon) {
  order: 1;
  flex: none;
}
@media (max-width: 899px) {
  .shelf-category-control {
    padding-block: 0;
  }
  .shelf-category-control :deep(.md-segmented-option) {
    min-height: 44px;
  }
}
@media (min-width: 360px) {
  .shelf-category-control :deep(.md-segmented-option.is-selected > .md3-icon) {
    display: block;
  }
}
.shelf-format-options {
  display: flex;
  flex-wrap: wrap;
  column-gap: 6px;
}
.shelf-format-options .md-filter-chip {
  height: 44px;
  min-height: 44px;
  padding-inline: 10px;
}
.shelf-format-options .md-filter-chip::before {
  inset-block: 6px;
}
.shelf-sort-options {
  padding: 4px 8px;
}
.shelf-sort-options .shelf-sort-option {
  justify-content: space-between;
  min-height: 44px;
  border-radius: 20px;
}
.shelf-sort-option:not(.is-active) {
  font-weight: 500;
}
.shelf-sort-option span {
  overflow-wrap: anywhere;
}
.shelf-sort-option svg {
  flex: none;
}

.library-title-enter-active {
  transition:
    opacity 180ms var(--md-ease-emphasized),
    transform 180ms var(--md-ease-emphasized);
}
.library-title-leave-active {
  transition:
    opacity 120ms var(--md-ease-emphasized),
    transform 120ms var(--md-ease-emphasized);
}
.library-title-enter-from {
  opacity: 0;
  transform: translate3d(-12px, 0, 0);
}
.library-title-leave-to {
  opacity: 0;
  transform: translate3d(12px, 0, 0);
}

@media (prefers-reduced-motion: reduce) {
  .library-title-enter-active,
  .library-title-leave-active {
    transition: none;
  }
  .library-title-enter-from,
  .library-title-leave-to {
    transform: none;
  }
}
</style>
