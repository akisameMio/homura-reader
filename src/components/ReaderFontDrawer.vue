<template>
  <Transition
    enter-active-class="md-fade-enter-active"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="md-fade-leave-active"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="ui.fontMenuOpen" class="absolute inset-0 z-40 md-scrim" @click="closeFontMenu()"></div>
  </Transition>
  <Transition
    enter-active-class="md-sheet-enter-active"
    :enter-from-class="isCompact ? 'translate-y-full' : 'translate-x-full'"
    :enter-to-class="isCompact ? 'translate-y-0' : 'translate-x-0'"
    leave-active-class="md-sheet-leave-active"
    :leave-from-class="isCompact ? 'translate-y-0' : 'translate-x-0'"
    :leave-to-class="isCompact ? 'translate-y-full' : 'translate-x-full'"
  >
    <aside
      v-if="ui.fontMenuOpen"
      id="reader-font-menu"
      ref="fontMenu"
      class="md-drawer reader-font-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-font-title"
      @keydown="onFontMenuKeydown"
    >
      <ReaderDrawerHeader
        :is-compact="isCompact"
        prominent
        title="字体"
        title-id="reader-font-title"
        close-label="关闭字体卡片"
        @close="closeFontMenu"
        @drag-start="onSheetDragStart"
        @drag-move="onSheetDragMove"
        @drag-end="onSheetDragEnd"
        @drag-cancel="onSheetDragCancel"
      >
        <template #status>
          <button type="button" class="reader-font-tool" title="搜索字体" aria-label="搜索字体" @click="fontSearchInput?.focus()"><MdIcon name="search" /></button>
        </template>
      </ReaderDrawerHeader>
      <div class="md-drawer-body reader-font-body" role="group" aria-label="选择正文字体">
        <button
          v-if="showDefaultFont"
          type="button"
          :aria-pressed="reader.layoutConfig.fontFamily === 'system'"
          class="reader-font-default reader-font-option"
          @click="pickFont('system')"
        >
          <span>默认</span>
          <MdIcon v-if="reader.layoutConfig.fontFamily === 'system'" name="check" />
        </button>
        <h3 class="reader-font-group-title">可用字体</h3>
        <div v-if="filteredFonts.length" class="reader-font-list">
          <button
            v-for="option in filteredFonts"
            :key="option.value"
            type="button"
            :aria-pressed="reader.layoutConfig.fontFamily === option.value"
            class="reader-font-option"
            @click="pickFont(option.value)"
          >
            <span class="reader-font-name" :style="{ fontFamily: option.stack }">{{ option.label }}</span>
            <MdIcon v-if="reader.layoutConfig.fontFamily === option.value" name="check" />
          </button>
        </div>
        <p v-else class="reader-font-empty" role="status">没有找到匹配的字体</p>
      </div>
      <div class="reader-font-search-wrap">
        <div class="reader-font-search">
          <MdIcon name="search" :size="20" />
          <input ref="fontSearchInput" v-model="fontQuery" type="search" placeholder="搜索字体" aria-label="搜索可用字体" autocomplete="off" />
          <button v-if="fontQuery" type="button" class="reader-font-clear" aria-label="清除字体搜索" @click="clearFontSearch"><MdIcon name="close" :size="18" /></button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import { useUiStore } from '../stores/ui.ts';
import { READER_FONT_OPTIONS } from '../services/readerLayout.ts';
import { useViewport } from '../composables/useViewport.ts';
import { useSheetDrag } from '../composables/useSheetDrag.ts';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import MdIcon from './MdIcon.vue';

const reader = useReaderStore();
const ui = useUiStore();
const { isCompact } = useViewport();
const fontMenuOpen = computed(() => ui.fontMenuOpen);
const {
  sheetRef: fontMenu,
  onDragStart: onSheetDragStart,
  onDragMove: onSheetDragMove,
  onDragEnd: onSheetDragEnd,
  onDragCancel: onSheetDragCancel
} = useSheetDrag({ isCompact, isOpen: fontMenuOpen, onClose: () => ui.closeFontMenu() });
const fontQuery = ref('');
const fontSearchInput = shallowRef<HTMLInputElement | null>(null);
const normalizedFontQuery = computed(() => fontQuery.value.trim().toLocaleLowerCase());
const filteredFonts = computed(() => READER_FONT_OPTIONS.filter(option => option.value !== 'system'
  && `${option.label} ${option.value} ${option.stack}`.toLocaleLowerCase().includes(normalizedFontQuery.value)));
const showDefaultFont = computed(() => !normalizedFontQuery.value || '默认 原始 system default'.includes(normalizedFontQuery.value));
let fontTrigger: HTMLElement | null = null;

watch(fontMenuOpen, async open => {
  if (open) {
    fontTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fontQuery.value = '';
    await nextTick();
    const selected = fontMenu.value?.querySelector<HTMLElement>('.reader-font-option[aria-pressed="true"]');
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: 'nearest' });
  } else {
    await nextTick();
    if (reader.currentBook && !ui.readerDrawerOpen) {
      const trigger = fontTrigger?.isConnected ? fontTrigger : document.querySelector<HTMLElement>('[aria-controls="reader-font-menu"]');
      trigger?.focus({ preventScroll: true });
    }
    fontTrigger = null;
  }
});

function closeFontMenu() {
  ui.closeFontMenu();
}

function pickFont(value: string) {
  reader.setFontFamily(value);
  closeFontMenu();
}

function clearFontSearch() {
  fontQuery.value = '';
  fontSearchInput.value?.focus();
}

function onFontMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeFontMenu();
    return;
  }
  if (event.key === 'Tab') {
    const controls = [...(fontMenu.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])]
      .filter(element => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  const options = [...(fontMenu.value?.querySelectorAll<HTMLButtonElement>('.reader-font-option') || [])];
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  let next = index;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % options.length;
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + options.length - 1) % options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  else return;
  event.preventDefault();
  options[next]?.focus();
}
</script>

<style scoped>
.reader-font-drawer {
  padding-bottom: 0;
  background: color-mix(in oklab, var(--md-surface-container) 65%, var(--md-surface-low));
}
.reader-font-tool { display: grid; width: 48px; height: 48px; flex: none; place-items: center; border-radius: 50%; background: var(--md-surface); color: var(--md-on-surface); }
@media (max-width: 899px) {
  .reader-font-drawer { height: 78dvh; }
}
.reader-font-body { min-height: 0; padding: 0 14px 4px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--md-outline-variant) transparent; }
.reader-font-default, .reader-font-list { overflow: hidden; border-radius: 24px; background: var(--md-surface); }
.reader-font-option { position: relative; display: flex; width: 100%; min-height: 60px; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; color: var(--md-on-surface); text-align: left; }
.reader-font-option > svg { width: 22px; height: 22px; flex: none; color: var(--md-primary); }
.reader-font-default { font-size: 17px; }
.reader-font-name { min-width: 0; font-size: 19px; line-height: 1.5; overflow-wrap: anywhere; }
.reader-font-group-title { margin: 24px 16px 12px; color: var(--md-on-surface-variant); font-size: 13px; font-weight: 600; text-align: left; }
.reader-font-option + .reader-font-option::before { position: absolute; top: 0; right: 18px; left: 18px; height: 1px; background: color-mix(in oklab, var(--md-outline-variant) 65%, transparent); content: ''; }
.reader-font-search-wrap { flex: none; padding: 14px 14px max(16px, env(safe-area-inset-bottom)); }
.reader-font-search { display: flex; min-height: 48px; align-items: center; gap: 10px; padding-left: 16px; overflow: hidden; border-radius: 26px; background: var(--md-surface); color: var(--md-on-surface-variant); }
.reader-font-search input { width: 0; min-width: 0; min-height: 48px; flex: 1; padding-right: 14px; border: 0; outline: none; background: transparent; color: var(--md-on-surface); font-size: 13px; }
.reader-font-search input::placeholder { color: var(--md-on-surface-variant); opacity: 1; }
.reader-font-search input::-webkit-search-cancel-button { appearance: none; }
.reader-font-clear { display: grid; width: 48px; height: 48px; flex: none; place-items: center; color: var(--md-on-surface-variant); }
.reader-font-search:focus-within { outline: 2px solid var(--md-primary); outline-offset: -2px; }
.reader-font-option:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -4px; border-radius: 12px; }
.reader-font-tool:focus-visible, .reader-font-clear:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -3px; }
.reader-font-empty { padding: 24px 16px; border-radius: 24px; background: var(--md-surface); color: var(--md-on-surface-variant); font-size: 13px; line-height: 1.7; text-align: center; }
@media (hover: hover) and (pointer: fine) {
  .reader-font-option:hover, .reader-font-tool:hover, .reader-font-clear:hover { background: color-mix(in oklab, var(--md-surface) 92%, var(--md-on-surface)); }
}
</style>
