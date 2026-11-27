<template>
  <header class="library-header-bar md-topbar-fade z-20">
    <div
      ref="toolbarRef"
      class="library-toolbar"
      :class="{ 'is-search-open': searchOpen }"
      :style="{ '--library-pill-button-count': 3 + Number(showFullscreen) + Number(!!$slots.actions) }"
    >
      <div class="library-toolbar-title" :inert="searchOpen && isCompact">
        <Transition name="md-topbar-title" mode="out-in" appear>
          <button
            v-if="renamable"
            :key="title"
            type="button"
            class="md-topbar-title library-title-text group flex items-center gap-1.5 text-left"
            :title="t('重命名书库')"
            :aria-label="t('重命名书库：{0}', { 0: title })"
            @click="$emit('rename')"
          >
            <span class="min-w-0 truncate">{{ title }}</span>
            <MdIcon name="edit" class="w-3.5 h-3.5 shrink-0 text-[var(--md-on-surface-variant)] opacity-50 group-hover:opacity-80 transition-opacity duration-200" />
          </button>
          <h1 v-else :key="title" class="md-topbar-title library-title-text truncate">{{ title }}</h1>
        </Transition>
      </div>

      <div
        ref="searchTrackRef"
        class="library-search-track"
        :class="{ 'is-scroll-hidden': scrollHidden }"
        :inert="scrollHidden"
      >
        <div class="library-pill-surface"></div>
        <div class="library-pill-content">
          <div class="library-pill-buttons" :inert="searchOpen">
            <MdIconButton
              v-if="showFullscreen"
              type="button"
              preserve-user-activation
              @click="ui.toggleFullscreen()"
              class="library-tool"
              :title="ui.fullscreen ? t('退出全屏 (F)') : t('全屏 (F)')"
              :aria-label="ui.fullscreen ? t('退出全屏 (F)') : t('全屏 (F)')"
              :aria-pressed="ui.fullscreen"
            >
              <MdIcon :name="ui.fullscreen ? 'fullscreen_exit' : 'fullscreen'" class="w-5 h-5" />
            </MdIconButton>
            <MdIconButton
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
            </MdIconButton>

            <div v-if="$slots.actions">
              <slot name="actions" />
            </div>
            <MdIconButton
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
            </MdIconButton>
            <MdIconButton
              ref="searchButtonRef"
              type="button"
              preserve-user-activation
              class="library-tool library-pill-search"
              :class="{ 'is-tonal': !!query }"
              :title="t('搜索书名、作者')"
              :aria-label="t('搜索书名、作者')"
              aria-controls="library-toolbar-search"
              :aria-expanded="searchOpen"
              @click="openSearch"
            >
              <MdIcon name="search" :size="22" />
            </MdIconButton>
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
            <MdIconButton
              v-if="query"
              type="button"
              preserve-user-activation
              class="library-tool library-search-end"
              :title="t('清空搜索')"
              :aria-label="t('清空搜索')"
              @pointerdown.prevent
              @click="clearSearch"
            >
              <MdIcon name="close" :size="18" />
            </MdIconButton>
          </div>
        </div>
      </div>
    </div>
  </header>

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
import MdIconButton from './MdIconButton.vue';
import MdSegmentedControl from './MdSegmentedControl.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  title: { type: String, default: '书架' },
  scrollRoot: { type: Object as PropType<HTMLElement | null>, default: null },
  importOpen: { type: Boolean, default: false },
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
const toolbarRef = shallowRef<HTMLElement | null>(null);
const searchTrackRef = shallowRef<HTMLElement | null>(null);
const searchFieldRef = shallowRef<HTMLElement | null>(null);
const searchInputRef = shallowRef<HTMLInputElement | null>(null);
const searchButtonRef = shallowRef<InstanceType<typeof MdIconButton> | null>(null);
const scrollSpring = makeAxis(0, 620);
const searchSpring = makeAxis(0, 740);
let cancelSearchSpring: (() => void) | null = null;
let closeSpringDelay: ReturnType<typeof setTimeout> | undefined;

const keepToolsVisible = computed(() => searchOpen.value || props.appearanceOpen || props.filterOpen || props.importOpen);
watch(keepToolsVisible, visible => {
  if (visible) scrollHidden.value = false;
});

watch([() => props.scrollRoot, () => props.title], ([root], _, onCleanup) => {
  scrollHidden.value = false;
  const column = root?.parentElement;
  if (!root || !column) return;

  let wheelDistance = 0;
  let lastWheelTime = -Infinity;
  let touch: { id: number; startX: number; startY: number; turningY: number; vertical: boolean } | null = null;

  function updateTools(distance: number) {
    if (keepToolsVisible.value || searchTrackRef.value?.querySelector(':focus-visible')) {
      scrollHidden.value = false;
    } else if (distance >= 12) {
      scrollHidden.value = true;
    } else if (distance <= -8) {
      scrollHidden.value = false;
    }
  }

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? column.clientHeight : 1;
    const distance = event.deltaY * unit;
    if (event.timeStamp - lastWheelTime > 150 || wheelDistance * distance < 0) wheelDistance = 0;
    lastWheelTime = event.timeStamp;
    wheelDistance += distance;
    updateTools(wheelDistance);
    if (wheelDistance >= 12 || wheelDistance <= -8) wheelDistance = 0;
  };

  function onTouchStart(event: TouchEvent) {
    const point = event.touches.length === 1 ? event.touches[0] : null;
    touch = point ? { id: point.identifier, startX: point.clientX, startY: point.clientY, turningY: point.clientY, vertical: false } : null;
  }

  function onTouchMove(event: TouchEvent) {
    if (!touch) return;
    const point = event.touches[0];
    if (event.touches.length !== 1 || point.identifier !== touch.id || document.body.classList.contains('md-touch-dragging')) {
      touch = null;
      return;
    }
    if (!touch.vertical) {
      const horizontal = Math.abs(point.clientX - touch.startX);
      const vertical = Math.abs(point.clientY - touch.startY);
      if (horizontal >= 8 && horizontal >= vertical) touch = null;
      if (!touch || vertical < 8 || vertical <= horizontal * 1.15) return;
      touch.vertical = true;
    }
    // 用手指最近的转向点判断反向，长滑时也能立即把胶囊带回来。
    const wasHidden = scrollHidden.value;
    touch.turningY = wasHidden ? Math.min(touch.turningY, point.clientY) : Math.max(touch.turningY, point.clientY);
    updateTools(touch.turningY - point.clientY);
    if (scrollHidden.value !== wasHidden || keepToolsVisible.value) touch.turningY = point.clientY;
  }

  function onTouchEnd() {
    touch = null;
  }

  column.addEventListener('wheel', onWheel, { passive: true });
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: true });
  root.addEventListener('touchend', onTouchEnd, { passive: true });
  root.addEventListener('touchcancel', onTouchEnd, { passive: true });
  onCleanup(() => {
    column.removeEventListener('wheel', onWheel);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('touchend', onTouchEnd);
    root.removeEventListener('touchcancel', onTouchEnd);
  });
}, { immediate: true, flush: 'post' });

watch(scrollHidden, (hidden, _, onCleanup) => {
  const track = searchTrackRef.value;
  if (!track) return;
  const property = '--library-tools-spring-progress';
  scrollSpring.target = hidden ? 1 : 0;
  if (prefersReducedMotion()) {
    snapAxes([scrollSpring]);
    track.style.removeProperty(property);
    return;
  }
  const paint = () => track.style.setProperty(property, String(Math.min(1, Math.max(0, scrollSpring.pos))));
  paint();
  onCleanup(runSpring([scrollSpring], paint, () => track.style.removeProperty(property), { damping: 0.9 }));
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
    if (!searchOpen.value) searchButtonRef.value?.button?.focus({ preventScroll: true });
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

onBeforeUnmount(() => {
  cancelSearchSpring?.();
  clearTimeout(closeSpringDelay);
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
  container-type: inline-size;
  position: sticky;
  top: 0;
  flex: none;
  height: var(--library-topbar-height);
  pointer-events: none;
}
.has-contained-shelf-scroll .library-header-bar {
  position: absolute;
  inset: 0 0 auto;
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
  height: 100%;
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
  min-width: 0;
}
.library-title-text {
  max-width: 100%;
}
button.library-title-text {
  min-height: var(--library-action-size);
}
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
  box-sizing: border-box;
  padding: 4px;
  border-radius: 16px;
  background-clip: content-box;
  color: var(--md-on-surface);
  transition: background-color var(--md-duration-short) var(--md-ease-emphasized);
}
.library-tool.is-tonal {
  --icon-button-background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}
@media (hover: hover) and (pointer: fine) {
  .library-tool:hover:not(:disabled):not(.is-tonal) {
    background-color: color-mix(in oklab, var(--md-on-surface) 8%, transparent);
  }
}
.library-search-track {
  --library-tools-target: 0;
  --library-tools-progress: var(--library-tools-target);
  position: absolute;
  z-index: 1;
  inset-inline-end: var(--library-toolbar-inset);
  width: var(--library-search-width);
  height: var(--library-action-size);
  pointer-events: none;
  transform: translateY(calc(-1 * var(--library-topbar-height) * var(--library-tools-progress)));
}
.library-search-track.is-scroll-hidden {
  --library-tools-target: 1;
}
@media (prefers-reduced-motion: no-preference) {
  .library-search-track {
    --library-tools-progress: var(--library-tools-spring-progress, var(--library-tools-target));
  }
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
    background-color var(--md-duration-short) var(--md-ease-emphasized);
}
.library-pill-buttons .library-pill-search {
  --library-icon-delay: calc(var(--library-pill-return-delay, 214ms) + 40ms);
}
.is-search-open .library-pill-buttons > * {
  opacity: 0;
  filter: blur(5px);
  transition-delay: 0ms;
  transition-duration: 78ms, 78ms, var(--md-duration-short);
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

@media (max-width: 899px) {
  .library-header-bar {
    position: relative;
    padding-block-start: env(safe-area-inset-top);
  }
  .library-toolbar {
    --library-toolbar-inset: 16px;
    --library-search-width: calc(100% - var(--library-toolbar-inset) * 2);
    gap: 6px;
    padding-inline-end: calc(var(--library-toolbar-inset) + var(--library-pill-rest) + 4px);
  }
  .library-toolbar-title {
    opacity: calc(1 - var(--library-search-progress));
  }
  .library-search-input {
    font-size: 16px;
  }
}
@media (max-width: 399px) {
  .library-toolbar {
    --library-toolbar-inset: 12px;
    padding-inline-start: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .library-tool,
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
  --md-segmented-color: var(--md-on-surface);
  --md-segmented-selected-bg: var(--md-secondary-container);
  --md-segmented-selected-color: var(--md-on-secondary-container);
}
.shelf-category-control :deep(.md-segmented-option) {
  min-height: 38px;
  padding: 4px;
  white-space: normal;
}
.shelf-category-control :deep(.md-segmented-option.is-selected > .md-segmented-icon) {
  order: 1;
  flex: none;
}
@media (max-width: 899px) {
  .shelf-category-control :deep(.md-segmented-option) {
    min-height: 44px;
  }
}
@media (min-width: 360px) {
  .shelf-category-control :deep(.md-segmented-option.is-selected > .md-segmented-icon) {
    display: grid;
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
</style>
