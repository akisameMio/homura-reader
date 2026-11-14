<template>
  <!-- 章节 / 页码与书库顺序共用一个抽屉，切换分类不重新播放抽屉动画。 -->
  <Transition
    enter-active-class="md-fade-enter-active"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="md-fade-leave-active"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="ui.tocOpen" class="absolute inset-0 z-40 md-scrim" @click="ui.closeToc()"></div>
  </Transition>

  <Transition
    :css="false"
    @before-enter="onSheetBeforeEnter"
    @enter="onSheetEnter"
    @before-leave="onSheetBeforeLeave"
    @leave="onSheetLeave"
    @after-enter="scrollCurrentIntoView"
    @after-leave="onSheetAfterLeave"
    @leave-cancelled="onSheetLeaveCancelled"
  >
    <aside
      v-if="ui.tocOpen"
      ref="tocSheetRef"
      id="reader-toc-drawer"
      class="md-drawer reader-toc-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-toc-title"
      @keydown="onSheetKeydown"
    >
      <ReaderDrawerHeader
        :is-compact="isCompact"
        prominent
        inline-tabs
        :title="t('目录')"
        title-id="reader-toc-title"
        :close-label="t('关闭目录')"
        @close="ui.closeToc()"
        @drag-start="onSheetDragStart"
        @drag-move="onSheetDragMove"
        @drag-end="onSheetDragEnd"
        @drag-cancel="onSheetDragCancel"
      >
        <template v-if="reader.currentCollection" #status>
          <ReaderDrawerTabs v-model="activeTab" :options="tabs" id-prefix="reader-toc" :label="t('目录分类')" />
        </template>
      </ReaderDrawerHeader>

      <div ref="tocBodyRef" class="md-drawer-body reader-toc-scroll">
        <section
          v-show="activeTab === 'book'"
          id="reader-toc-panel-book"
          class="md-drawer-tab-panel"
          :role="reader.currentCollection ? 'tabpanel' : undefined"
          :aria-labelledby="reader.currentCollection ? 'reader-toc-tab-book' : 'reader-toc-title'"
        >
          <div class="reader-toc-summary">
            <MdIcon :name="isManga ? 'auto_stories' : 'toc'" :size="18" />
            <div><h3 :title="reader.currentBook?.title">{{ reader.currentBook?.title }}</h3><p>{{ tocSubtitle }}</p></div>
          </div>
          <nav v-if="isManga" class="reader-toc-card reader-toc-pages md-toc-grid" :aria-label="t('漫画页码')">
            <button
              v-for="(_page, idx) in reader.activePages"
              :key="idx"
              type="button"
              @click="jumpTo(idx)"
              class="md-toc-page"
              :class="{ 'is-active': idx === reader.currentIndex }"
              :aria-label="t('跳转到第 {0} 页', { 0: idx + 1 })"
              :aria-current="idx === reader.currentIndex ? 'page' : undefined"
            >{{ idx + 1 }}</button>
          </nav>

          <nav v-else class="reader-toc-card reader-toc-list" :aria-label="t('章节目录')">
            <button
              v-for="(group, index) in groups"
              :key="group.key"
              type="button"
              @click="jumpTo(group.index)"
              class="md-drawer-list-item"
              :class="{ 'is-active': isCurrentChapter(group) }"
              :title="group.title"
              :aria-current="isCurrentChapter(group) ? 'true' : undefined"
            >
              <span class="md-drawer-item-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="md-drawer-item-label">{{ group.title }}</span>
              <MdIcon v-if="isCurrentChapter(group)" class="reader-toc-current" name="auto_stories" :size="18" />
            </button>
            <p v-if="groups.length === 0" class="reader-toc-empty">{{ t('暂无章节信息') }}</p>
          </nav>
        </section>

        <section
          v-if="reader.currentCollection"
          v-show="activeTab === 'collection'"
          id="reader-toc-panel-collection"
          class="md-drawer-tab-panel"
          role="tabpanel"
          aria-labelledby="reader-toc-tab-collection"
        >
          <div class="reader-toc-summary">
            <MdIcon name="collections_bookmark" :size="18" />
            <div><h3 :title="reader.currentCollection.title">{{ reader.currentCollection.title }}</h3><p>{{ t('{0} 本 · 按书库顺序阅读', { 0: reader.collectionBooks.length }) }}</p></div>
          </div>
          <nav class="reader-toc-card reader-toc-list" :aria-label="t('本书库书本顺序')">
            <ol>
              <li v-for="(book, index) in reader.collectionBooks" :key="book.id">
                <button
                  type="button"
                  class="md-drawer-list-item"
                  :class="{ 'is-active': book.id === reader.currentBook?.id }"
                  :aria-current="book.id === reader.currentBook?.id ? 'true' : undefined"
                  :aria-label="t('打开书库书本：{0}{1}', { 0: book.title, 1: book.id === reader.currentBook?.id ? t('，正在阅读') : '' })"
                  :disabled="reader.openingBook"
                  :title="book.title"
                  @click="openBook(book.id)"
                >
                  <span class="md-drawer-item-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="md-drawer-item-label">{{ book.title }}</span>
                  <MdIcon v-if="book.id === reader.currentBook?.id" class="reader-toc-current" name="auto_stories" :size="18" />
                </button>
              </li>
            </ol>
          </nav>
        </section>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import { useUiStore } from '../stores/ui.ts';
import { useViewport } from '../composables/useViewport.ts';
import { useSheetDrag } from '../composables/useSheetDrag.ts';
import { useSheetSpring } from '../composables/useSheetSpring.ts';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import ReaderDrawerTabs from './ReaderDrawerTabs.vue';
import MdIcon from './MdIcon.vue';
import type { ReaderPage } from '../types.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const reader = useReaderStore();
const ui = useUiStore();
const { isCompact } = useViewport();
const tocOpen = computed(() => ui.tocOpen);
const tocBodyRef = shallowRef<HTMLElement | null>(null);
const activeTab = ref('book');
const tabs = [
  { value: 'book', label: '目录' },
  { value: 'collection', label: '书库' }
];
const sheetSpring = useSheetSpring({ isCompact });
const {
  onBeforeEnter: onSheetBeforeEnter,
  onEnter: onSheetEnter,
  onBeforeLeave: onSheetBeforeLeave,
  onLeave: onSheetLeave,
  onAfterLeave: onSheetAfterLeave,
  onLeaveCancelled: onSheetLeaveCancelled
} = sheetSpring;
const {
  sheetRef: tocSheetRef,
  onDragStart: onSheetDragStart,
  onDragMove: onSheetDragMove,
  onDragEnd: onSheetDragEnd,
  onDragCancel: onSheetDragCancel
} = useSheetDrag({
  isCompact,
  isOpen: tocOpen,
  onClose: () => ui.closeToc(),
  onDragBegin: sheetSpring.cancel
});

const isManga = computed(() => reader.currentBook?.type === 'manga' || reader.currentBook?.format === 'pdf');

// 小说分页后同一章节可能跨多页，这里按 chapterIndex 聚合成目录条目
const groups = computed(() => {
  if (!reader.currentBook || isManga.value) return [];
  const map = new Map<number, { key: number; title: string; index: number; end: number }>();
  reader.activePages.forEach((page: ReaderPage, idx) => {
    const key = page.chapterIndex != null ? page.chapterIndex : 0;
    if (!map.has(key)) {
      map.set(key, {
        key,
        title: page.title || t('第 {0} 章', { 0: key + 1 }),
        index: idx,
        end: idx
      });
    }
    map.get(key)!.end = idx;
  });
  return [...map.values()];
});

const tocSubtitle = computed(() => {
  const pages = reader.activePages.length;
  if (isManga.value) return t('{0} 页', { 0: pages });
  return t('{0} 章 · {1} 页', { 0: groups.value.length, 1: pages });
});

function isCurrentChapter(group: { index: number; end: number }) {
  return reader.currentIndex >= group.index && reader.currentIndex <= group.end;
}

// 打开目录时把当前章 / 当前页滚到可视区中间，省去手动翻找
function scrollCurrentIntoView() {
  const body = tocBodyRef.value;
  const active = body?.querySelector<HTMLElement>(`#reader-toc-panel-${activeTab.value} [aria-current]`);
  if (!body || !active) return;
  const bodyRect = body.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  const offset = body.scrollTop + activeRect.top - bodyRect.top - (bodyRect.height - activeRect.height) / 2;
  body.scrollTop = Math.max(0, offset);
}

let tocTrigger: HTMLElement | null = null;
watch(tocOpen, async open => {
  if (!open) {
    await nextTick();
    if (tocTrigger?.isConnected && reader.currentBook && !ui.readerDrawerOpen) tocTrigger.focus({ preventScroll: true });
    tocTrigger = null;
    return;
  }
  tocTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeTab.value = 'book';
  await nextTick();
  tocSheetRef.value?.querySelector<HTMLButtonElement>('.md-drawer-header .md-icon-button')?.focus({ preventScroll: true });
  scrollCurrentIntoView();
});

watch(activeTab, async () => {
  if (!ui.tocOpen) return;
  await nextTick();
  if (tocBodyRef.value) tocBodyRef.value.scrollTop = 0;
  scrollCurrentIntoView();
});

watch(() => reader.currentCollection?.id, id => {
  if (!id) activeTab.value = 'book';
});

function jumpTo(index: number) {
  reader.jumpToPage(index);
  ui.closeToc();
}

async function openBook(id: string) {
  if (id === reader.currentBook?.id || await reader.openCollectionBook(id)) ui.closeToc();
}

function onSheetKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    ui.closeToc();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [...(tocSheetRef.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [])]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<style scoped>
.reader-toc-drawer {
  padding-bottom: 0;
  background: color-mix(in oklab, var(--md-surface-container) 65%, var(--md-surface-low));
}
.reader-toc-scroll {
  padding: 0 18px max(20px, env(safe-area-inset-bottom));
  scrollbar-width: thin;
  scrollbar-color: var(--md-outline-variant) transparent;
}
.reader-toc-summary {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 2px 12px 18px;
  color: var(--md-on-surface-variant);
}
.reader-toc-summary > svg { flex: none; margin-top: 2px; }
.reader-toc-summary > div { min-width: 0; }
.reader-toc-summary h3 { color: var(--md-on-surface); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.reader-toc-summary p { margin-top: 5px; font-size: 11px; line-height: 1.6; }
.reader-toc-card { border-radius: 26px; background: var(--md-surface); color: var(--md-on-surface); }
.reader-toc-list { padding: 8px; }
.reader-toc-list .md-drawer-list-item { min-height: 60px; gap: 10px; border-radius: 20px; padding: 14px 12px; }
.reader-toc-list .md-drawer-item-label { font-weight: 500; line-height: 1.65; overflow-wrap: anywhere; }
.reader-toc-list .md-drawer-item-index { min-width: 20px; text-align: left; }
.reader-toc-list .is-active .md-drawer-item-label { font-weight: 600; }
.reader-toc-current { flex: none; }
.reader-toc-list button:disabled { opacity: 0.5; cursor: default; }
.reader-toc-list button:focus-visible,
.reader-toc-pages button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
.reader-toc-pages { padding: 14px; }
.reader-toc-pages .md-toc-page { min-width: 0; }
.reader-toc-empty { padding: 32px 16px; color: var(--md-on-surface-variant); font-size: 13px; text-align: center; }
@media (max-width: 899px) {
  .reader-toc-drawer { height: 78dvh; }
}
@media (prefers-reduced-motion: reduce) {
  .reader-toc-list button, .reader-toc-pages button { transition: none; }
}
</style>
