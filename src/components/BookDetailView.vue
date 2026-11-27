<template>
  <Teleport to="body">
    <section
      v-if="book"
      class="book-detail-layer"
      :class="{ 'is-preparing': preparing, 'is-settled': settled }"
      :style="insets"
      :inert="blocked || returning || !!pendingShelfDialog"
      aria-labelledby="book-detail-title"
    >
      <div ref="clipEl" class="book-detail-clip">
        <div class="book-detail-surround" aria-hidden="true"></div>
        <div ref="surfaceEl" class="book-detail-surface" aria-hidden="true"></div>
        <div ref="pageEl" class="book-detail-page" data-app-scroll>
          <div class="book-detail-masthead">
            <img v-if="book.cover" :src="book.cover" class="book-detail-wash" alt="" aria-hidden="true" />
            <header class="book-detail-header">
              <button ref="backEl" class="book-detail-back" type="button" :aria-label="t('返回书架')" @click="dismissBack">
                <MdIcon name="chevron_left" :size="28" />
              </button>
              <h1 id="book-detail-title" class="md-topbar-title">{{ t('书本详情') }}</h1>
            </header>
            <div class="book-detail-hero">
              <div ref="heroCoverEl" class="book-detail-cover">
                <img v-if="book.cover" :src="book.cover" alt="" draggable="false" />
                <span v-else aria-hidden="true">{{ book.title }}</span>
              </div>
              <div class="book-detail-identity">
                <span class="book-detail-source">{{ t(book.remote ? '云端卷' : '本地卷') }}</span>
                <h2>{{ book.title }}</h2>
                <p v-if="book.author">{{ book.author }}</p>
              </div>
              <button class="md-filled-button book-detail-read" type="button" :disabled="busy" @click="readBook">
                <span class="book-detail-read-label">
                  <MdIcon name="play_arrow" :size="22" />
                  {{ t(hasReadingPosition ? '继续阅读' : '开始阅读') }}
                </span>
                <span v-if="readingLocation" class="book-detail-position">{{ readingLocation }}</span>
              </button>
            </div>
          </div>
          <div class="book-detail-content">
            <section class="book-detail-group book-detail-volume" aria-labelledby="book-volume-title">
              <h2 id="book-volume-title"><MdIcon name="article" :size="20" />{{ t('卷信息') }}</h2>
              <dl class="book-detail-stats">
                <div>
                  <dt>{{ t('总页数') }}</dt>
                  <dd>{{ totalPages === null ? '—' : t('{0} 页', { 0: totalPages }) }}</dd>
                </div>
                <div>
                  <dt>{{ t('当前页') }}</dt>
                  <dd>{{ currentPage === null ? '—' : t('第 {0} 页', { 0: currentPage }) }}</dd>
                </div>
                <div>
                  <dt>{{ t('阅读时长') }}</dt>
                  <dd>{{ readingDuration }}</dd>
                </div>
              </dl>
            </section>
            <section class="book-detail-group" aria-labelledby="book-manage-title">
              <h2 id="book-manage-title"><MdIcon name="collections_bookmark" :size="20" />{{ t('书本管理') }}</h2>
              <div class="book-detail-list">
                <button class="book-detail-row" type="button" :disabled="busy" @click="toggleFavorite">
                  <span class="book-detail-row-icon"><MdIcon name="star" :filled="!!book.favorite" :size="20" /></span>
                  <span>{{ t(book.favorite ? '取消收藏' : '收藏本书') }}</span>
                </button>
                <button class="book-detail-row" type="button" :disabled="busy || !shelf.collections.length" @click="moveBook">
                  <span class="book-detail-row-icon"><MdIcon name="folder_open" :size="20" /></span>
                  <span>{{ t('移动到书库') }}</span>
                  <span v-if="currentCollection" class="book-detail-value">{{ currentCollection.title }}</span>
                  <MdIcon name="chevron_right" :size="20" class="book-detail-chevron" />
                </button>
                <button v-if="canManageStorage" class="book-detail-row" type="button" :disabled="busy || storageBlocked" @click="manageStorage">
                  <span class="book-detail-row-icon"><MdIcon name="database" :size="20" /></span>
                  <span>{{ t('管理存储') }}</span>
                  <span v-if="storageLabel" class="book-detail-value">{{ storageLabel }}</span>
                  <MdIcon name="chevron_right" :size="20" class="book-detail-chevron" />
                </button>
              </div>
            </section>
            <section class="book-detail-group" aria-labelledby="book-file-title">
              <h2 id="book-file-title"><MdIcon name="info" :size="20" />{{ t('文件信息') }}</h2>
              <dl class="book-detail-file">
                <div><dt>{{ t('文件格式') }}</dt><dd>{{ fileFormat }}</dd></div>
                <div><dt>{{ t('文件大小') }}</dt><dd>{{ fileSize }}</dd></div>
              </dl>
            </section>
            <div class="book-detail-footer">
              <p v-if="actionError" class="book-detail-error" role="alert">{{ actionError }}</p>
              <button class="md-text-button book-detail-delete" type="button" :disabled="busy" @click="deleteBook">
                <MdIcon name="delete" :size="20" />
                <span>{{ t('从书架删除') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type PropType } from 'vue';
import { useShelfStore } from '../stores/shelf.ts';
import { useI18n } from '../composables/useI18n.ts';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import { createSettingsTransition, measureSettingsTransition } from '../composables/useSettingsTransition.ts';
import type { NativeBackEvent } from '../composables/useAndroidBackExit.ts';
import { compareBookTitles } from '../services/bookTitles.ts';
import { collectionPath } from '../services/collections.ts';
import { canUseNativeImport } from '../services/nativeImport.ts';
import { formatBytes } from '../services/platform.ts';
import { HomuraStore } from '../services/storage.ts';
import { resolveBookFormat } from '../services/utils.ts';
import type { Book, BookSource } from '../types.ts';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  column: Object as PropType<HTMLElement | null>,
  blocked: Boolean,
  storageBlocked: Boolean,
  manageStorageAction: { type: Function as PropType<(id: string) => Promise<string | undefined>>, required: true }
});
const emit = defineEmits<{
  'detail-change': [open: boolean];
  read: [id: string, cover: HTMLElement | null];
}>();
const { t } = useI18n();
const shelf = useShelfStore();
const { pendingShelfDialog, askShelfDialog } = useShelfDialogs();

const entry = shallowRef<Book | null>(null);
const book = computed(() => entry.value && (shelf.library.find(item => item.id === entry.value?.id) ?? entry.value));
const record = computed(() => book.value ? shelf.progressMap[book.value.id] : undefined);
const format = computed(() => resolveBookFormat(book.value));
const totalPages = computed(() => {
  const savedTotal = record.value?.total;
  if (!record.value?.partialPagination && typeof savedTotal === 'number' && savedTotal > 0) return savedTotal;
  // 小说书目在分页前保存的是章节数。
  return book.value?.type === 'manga' || format.value === 'pdf' ? book.value?.pageCount || null : null;
});
const currentPage = computed(() => {
  let index = record.value?.index;
  const ratio = record.value?.ratio;
  if (typeof index !== 'number' && typeof ratio === 'number' && totalPages.value !== null) {
    index = Math.round(ratio * (totalPages.value - 1));
  }
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) return null;
  return totalPages.value === null ? index + 1 : Math.min(index + 1, totalPages.value);
});
const hasReadingPosition = computed(() => currentPage.value !== null
  || typeof record.value?.ratio === 'number' || typeof record.value?.chapterIndex === 'number');
const readingLocation = computed(() => currentPage.value === null ? '' : totalPages.value === null
  ? t('第 {0} 页', { 0: currentPage.value })
  : t('第 {0} / {1} 页', { 0: currentPage.value, 1: totalPages.value }));
const readingDuration = computed(() => {
  const seconds = Math.max(0, Math.floor((record.value?.readingDurationMs ?? 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return t('{0} 小时 {1} 分', { 0: Math.floor(minutes / 60), 1: minutes % 60 });
  return minutes > 0 ? t('{0} 分钟', { 0: minutes }) : t('{0} 秒', { 0: seconds });
});
const currentCollection = computed(() => shelf.collections.find(item => book.value && item.bookIds.includes(book.value.id)));

const source = shallowRef<BookSource | null>(null);
watch(book, (item, _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  if (!item) {
    source.value = null;
    return;
  }
  void HomuraStore.getSource(item.id).then(result => {
    if (current) source.value = result as BookSource | null;
  }, () => {
    if (current) source.value = null;
  });
});
const fileFormat = computed(() => format.value === 'markdown' ? 'MD'
  : format.value === 'images' ? t('图片文件夹')
    : format.value?.toUpperCase() || '—');
const fileSize = computed(() => {
  const bytes = source.value?.size ?? book.value?.size;
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? formatBytes(bytes) : '—';
});
const canManageStorage = computed(() => canUseNativeImport() && source.value?.kind === 'file' && !book.value?.remote);
const storageLabel = computed(() => {
  if (source.value?.nativeReference || source.value?.handle) return t('原位引用');
  return source.value?.blob || source.value?.nativePath || source.value?.opfsPath ? t('本机副本') : '';
});

const clipEl = shallowRef<HTMLElement | null>(null);
const surfaceEl = shallowRef<HTMLElement | null>(null);
const pageEl = shallowRef<HTMLElement | null>(null);
const backEl = shallowRef<HTMLButtonElement | null>(null);
const heroCoverEl = shallowRef<HTMLElement | null>(null);
const insets = shallowRef<{ left: string; right: string }>();
const preparing = ref(false);
const settled = ref(false);
const returning = ref(false);
const busy = ref(false);
const actionError = ref('');
let origin: HTMLElement | null = null;
let trigger: HTMLElement | null = null;
let motion: ReturnType<typeof createSettingsTransition> = null;
let afterReturn: (() => void) | undefined;
let backRequested = false;
let backTimer: number | undefined;
let gestureStart: number | null = null;

function readHistoryId(state: unknown = window.history.state) {
  return state && typeof state === 'object' && 'homuraBookDetail' in state && typeof state.homuraBookDetail === 'string'
    ? state.homuraBookDetail : null;
}

function measure() {
  if (!props.column) return null;
  const geometry = measureSettingsTransition(props.column, origin?.isConnected ? origin : null);
  insets.value = geometry.insets;
  return geometry.anchor;
}

function finishMotion() {
  motion?.destroy();
  motion = null;
  gestureStart = null;
  preparing.value = false;
  settled.value = !!entry.value && !returning.value;
  if (!returning.value) return;

  returning.value = false;
  window.clearTimeout(backTimer);
  backRequested = false;
  entry.value = null;
  source.value = null;
  origin = null;
  const focusTarget = trigger;
  trigger = null;
  emit('detail-change', false);
  const navigate = afterReturn;
  afterReturn = undefined;
  if (navigate) navigate();
  else if (focusTarget?.isConnected) void nextTick(() => focusTarget.focus({ preventScroll: true }));
}

function startMotion(progress: 0 | 1, anchor = measure()) {
  if (!motion && anchor && clipEl.value && surfaceEl.value && pageEl.value) {
    motion = createSettingsTransition(clipEl.value, surfaceEl.value, pageEl.value, anchor, progress, finishMotion);
  }
  return motion;
}

function enter(item: Book, animate: boolean) {
  const anchor = measure();
  preparing.value = animate && !!anchor;
  settled.value = !preparing.value;
  actionError.value = '';
  entry.value = item;
  emit('detail-change', true);
  void nextTick(() => {
    if (entry.value !== item || returning.value) return;
    const opening = preparing.value ? startMotion(1, anchor) : null;
    preparing.value = false;
    if (opening) opening.playTo(0, finishMotion);
    else settled.value = true;
    if (!props.blocked) backEl.value?.focus({ preventScroll: true });
  });
}

function open(id: string, cover: HTMLElement | null, focusTarget: HTMLElement | null) {
  const item = shelf.library.find(candidate => candidate.id === id);
  if (entry.value || props.blocked || !item) return;
  origin = cover;
  trigger = focusTarget;
  try {
    window.history.pushState({ ...window.history.state, homuraBookDetail: id }, '');
  } catch (error) {
    console.warn('[HOMURA] 写入书本详情历史失败', error);
  }
  enter(item, true);
}

function closeToCover() {
  if (!entry.value || returning.value) return;
  returning.value = true;
  const closing = startMotion(0);
  if (closing) closing.playTo(1, finishMotion, gestureStart === null ? undefined : 180);
  else finishMotion();
}

function dismissBack() {
  if (!entry.value) return false;
  if (props.blocked || busy.value || returning.value || backRequested || pendingShelfDialog.value) return true;
  if (readHistoryId() === entry.value.id) {
    backRequested = true;
    try { window.history.back(); } catch (error) {
      console.warn('[HOMURA] 返回书架历史失败', error);
    }
    backTimer = window.setTimeout(() => {
      if (!backRequested) return;
      if (readHistoryId() === entry.value?.id) {
        const state = { ...window.history.state };
        delete state.homuraBookDetail;
        try { window.history.replaceState(state, ''); } catch (error) {
          console.warn('[HOMURA] 清除书本详情历史失败', error);
        }
      }
      closeToCover();
    }, 600);
  } else closeToCover();
  return true;
}

function leaveDetail(navigate: () => void) {
  if (!entry.value) return false;
  if (busy.value || pendingShelfDialog.value) return true;
  afterReturn = navigate;
  return dismissBack();
}

function restoreFromHistory() {
  window.clearTimeout(backTimer);
  backRequested = false;
  const id = readHistoryId();
  if (id && id === entry.value?.id) {
    if (returning.value) {
      returning.value = false;
      afterReturn = undefined;
      motion?.playTo(0, finishMotion);
    }
    return;
  }
  if (entry.value) closeToCover();
  else if (id) {
    const item = shelf.library.find(candidate => candidate.id === id);
    if (item) enter(item, false);
  }
}

function canUsePredictiveBack() {
  return !!entry.value && !props.blocked && !busy.value && !pendingShelfDialog.value && !backRequested && !returning.value;
}

function onPredictiveBack(event: NativeBackEvent) {
  if (event.phase === 'invoked') {
    dismissBack();
  } else if (canUsePredictiveBack()) {
    if (event.phase === 'started') {
      gestureStart = startMotion(0)?.pause() ?? null;
    } else if (event.phase === 'progressed' && gestureStart !== null) {
      const progress = Math.max(0, Math.min(1, event.progress ?? 0));
      motion?.seek(gestureStart + (1 - gestureStart) * progress);
    } else if (event.phase === 'cancelled') {
      gestureStart = null;
      motion?.playTo(0, finishMotion);
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || !canUsePredictiveBack() || document.querySelector('dialog[open]')) return;
  if (dismissBack()) event.preventDefault();
}

async function perform(action: (item: Book) => Promise<unknown>) {
  const item = book.value;
  if (!item || busy.value || props.blocked || returning.value) return;
  actionError.value = '';
  busy.value = true;
  try {
    await action(item);
  } catch (error) {
    console.warn('[HOMURA] 书本操作失败', error);
    actionError.value = t('书本操作失败，请重试');
  } finally {
    busy.value = false;
  }
}

function toggleFavorite() {
  return perform(item => shelf.toggleFavorite(item.id));
}

function moveBook() {
  return perform(async item => {
    const current = currentCollection.value;
    const options = shelf.collections.filter(collection => collection.id !== current?.id)
      .sort(compareBookTitles).map(collection => ({ value: collection.id, title: collectionPath(collection, shelf.collectionsById) }));
    if (current) options.unshift({ value: '', title: t('书架首页') });
    const destination = await askShelfDialog({ kind: 'move', title: t('移动到书库'), message: item.title, options });
    if (typeof destination === 'string') await shelf.moveBooks([item.id], destination || null);
  });
}

async function deleteBook() {
  let deleted = false;
  await perform(async item => {
    const confirmed = await askShelfDialog({
      kind: 'confirm', intent: 'delete', removesFiles: !item.remote, title: t('删除书本'),
      message: t('将{0}。此操作无法撤销。', { 0: t('删除选中的 {0} 本作品、应用内存档与阅读记录', { 0: 1 }) }),
      confirmLabel: t('确认删除')
    });
    if (confirmed !== true) return;
    await shelf.removeBook(item.id);
    deleted = true;
  });
  if (deleted) dismissBack();
}

function manageStorage() {
  return perform(async item => { actionError.value = await props.manageStorageAction(item.id) ?? ''; });
}

function readBook() {
  if (book.value && !busy.value) emit('read', book.value.id, heroCoverEl.value);
}

watch(() => props.column, (column, _, onCleanup) => {
  if (!column || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => {
    if (!entry.value) return;
    if (motion && (settled.value === false || returning.value)) finishMotion();
    if (entry.value) measure();
  });
  observer.observe(column);
  onCleanup(() => observer.disconnect());
});
watch(() => shelf.library, () => {
  if (!entry.value && !props.blocked && readHistoryId()) restoreFromHistory();
});
watch(entry, item => { document.documentElement.classList.toggle('book-detail-scroll-locked', !!item); });
onMounted(() => {
  window.addEventListener('popstate', restoreFromHistory);
  window.addEventListener('keydown', onKeydown);
  restoreFromHistory();
});
onBeforeUnmount(() => {
  window.clearTimeout(backTimer);
  document.documentElement.classList.remove('book-detail-scroll-locked');
  window.removeEventListener('popstate', restoreFromHistory);
  window.removeEventListener('keydown', onKeydown);
  motion?.destroy();
});
defineExpose({ open, dismissBack, leaveDetail, canUsePredictiveBack, onPredictiveBack });
</script>

<style scoped>
:global(html.book-detail-scroll-locked) { overflow-y: hidden; scrollbar-gutter: auto; }
.book-detail-layer { position: fixed; inset: 0; z-index: 44; isolation: isolate; }
.book-detail-layer.is-preparing { visibility: hidden; }
.book-detail-clip, .book-detail-surface, .book-detail-page { position: absolute; inset: 0; }
.book-detail-surface { background: var(--md-surface-low); pointer-events: none; }
.book-detail-clip.is-morphing > .book-detail-surface { clip-path: var(--settings-anchor-clip); }
.book-detail-surround { display: none; }
.book-detail-clip.is-morphing > .book-detail-surround {
  display: block;
  position: absolute;
  inset: var(--settings-anchor-inset);
  border-radius: var(--settings-anchor-radius);
  outline: 150vmax solid var(--md-surface-low);
  pointer-events: none;
}
.book-detail-page {
  --book-detail-gutter: 28px;
  --book-detail-width: 880px;
  container: book-detail / inline-size;
  color: var(--md-on-surface);
  overflow: auto;
  overscroll-behavior: contain;
  opacity: 0;
}
.book-detail-layer.is-settled .book-detail-page { opacity: 1; }

.book-detail-masthead { position: relative; isolation: isolate; overflow: clip; }
.book-detail-header { container-type: inline-size; }
.book-detail-wash {
  position: absolute;
  z-index: -1;
  inset: -12% -9% -4%;
  width: 118%;
  height: 116%;
  max-width: none;
  max-height: none;
  object-fit: cover;
  object-position: 50% 54%;
  filter: blur(46px) saturate(1.3);
  opacity: .52;
  mask-image: linear-gradient(var(--md-shadow-color) 56%, transparent);
  pointer-events: none;
}
.book-detail-masthead::after {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  background: linear-gradient(
    color-mix(in oklab, var(--md-surface-low) 55%, transparent),
    color-mix(in oklab, var(--md-surface-low) 22%, transparent) 47%,
    var(--md-surface-low)
  );
  pointer-events: none;
}
.book-detail-header, .book-detail-hero, .book-detail-content {
  max-width: var(--book-detail-width);
  margin-inline: auto;
  padding-inline: max(var(--book-detail-gutter), env(safe-area-inset-left))
    max(var(--book-detail-gutter), env(safe-area-inset-right));
}
.book-detail-header { display: flex; align-items: center; min-height: 80px; gap: 16px; }
.book-detail-header h1 { min-width: 0; overflow-wrap: anywhere; }
.book-detail-back {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--md-surface) 90%, transparent);
  box-shadow: 0 5px 16px -9px var(--md-shadow-color-soft);
}
.book-detail-hero {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  align-items: center;
  gap: 16px 24px;
  padding-block: 8px 24px;
}
.book-detail-cover {
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  aspect-ratio: 420 / 620;
  overflow: hidden;
  border-radius: 12px;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
  box-shadow: 0 8px 19px -7px color-mix(in oklab, var(--md-shadow-color-soft) 78%, transparent);
}
.book-detail-cover img { width: 100%; height: 100%; object-fit: cover; }
.book-detail-cover span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  max-width: calc(100% - 24px);
  overflow: hidden;
  font-weight: 650;
  text-align: center;
  overflow-wrap: anywhere;
}
.book-detail-identity { min-width: 0; }
.book-detail-source {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding-inline: 9px;
  margin-bottom: 8px;
  border-radius: 999px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  font-size: 11px;
  font-weight: 650;
}
.book-detail-identity h2 {
  font-size: clamp(24px, 4.4cqi, 36px);
  line-height: 1.25;
  font-weight: 650;
  text-wrap: pretty;
  overflow-wrap: anywhere;
}
.book-detail-identity p { margin-top: 8px; color: var(--md-on-surface-variant); font-size: 13px; overflow-wrap: anywhere; }
.book-detail-read {
  grid-column: 1 / -1;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-height: 52px;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 15px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.book-detail-read-label { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 0; }
.book-detail-read-label > svg { flex: none; }
.book-detail-position {
  max-width: 100%;
  padding-inline-start: 8px;
  border-inline-start: 1px solid color-mix(in oklab, var(--md-on-primary) 38%, transparent);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.book-detail-content { display: grid; align-items: start; gap: 24px; padding-block: 8px 24px; }
.book-detail-group { min-width: 0; }
.book-detail-group h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 8px;
  color: var(--md-on-surface-variant);
  font-size: 16px;
  font-weight: 650;
}
.book-detail-group h2 svg { flex: none; }
.book-detail-stats, .book-detail-list, .book-detail-file {
  min-width: 0;
  overflow: hidden;
  border-radius: 28px;
  background: var(--md-surface);
}
.book-detail-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.book-detail-stats > div { min-width: 0; padding: 12px 16px; overflow-wrap: anywhere; }
.book-detail-stats > div + div {
  border-inline-start: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
}
.book-detail-stats dt { margin-bottom: 5px; color: var(--md-on-surface-variant); font-size: 12px; }
.book-detail-stats dd { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.book-detail-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 20px;
  min-height: 56px;
  text-align: start;
  font-size: 15px;
  font-weight: 500;
}
.book-detail-row > span:nth-child(2) { min-width: 0; overflow-wrap: anywhere; }
.book-detail-row + .book-detail-row, .book-detail-file > div + div {
  border-top: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
}
.book-detail-row-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--md-surface-container);
  color: var(--md-on-surface-variant);
}
.book-detail-value {
  min-width: 0;
  max-width: 45%;
  margin-inline-start: auto;
  text-align: end;
  overflow-wrap: anywhere;
  font-size: 13px;
  color: var(--md-on-surface-variant);
}
.book-detail-chevron { flex: none; margin-inline-start: auto; color: var(--md-on-surface-variant); }
.book-detail-value + .book-detail-chevron { margin-inline-start: 0; }
.book-detail-file > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 12px 20px;
  overflow-wrap: anywhere;
}
.book-detail-file dt { font-size: 14px; }
.book-detail-file dd { min-width: 0; text-align: end; color: var(--md-on-surface-variant); font-size: 13px; font-variant-numeric: tabular-nums; }
.book-detail-footer {
  padding-top: 8px;
  border-top: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
}
.book-detail-delete, .book-detail-error { color: var(--md-error); }
.book-detail-delete { max-width: 100%; padding-inline: 16px; white-space: normal; }
.book-detail-delete svg { flex: none; }
.book-detail-error { margin: 0 16px 8px; font-size: 13px; overflow-wrap: anywhere; }
.book-detail-page button:disabled { opacity: .5; cursor: default; }
.book-detail-page button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -3px; }
.book-detail-read:focus-visible { outline-color: var(--md-on-primary); }
@media (hover: hover) and (pointer: fine) {
  .book-detail-row:not(:disabled):hover { background: color-mix(in oklab, var(--md-primary) 4%, transparent); }
}
.book-detail-row:not(:disabled):active { background: color-mix(in oklab, var(--md-primary) 8%, transparent); }
@container book-detail (min-width: 744px) {
  .book-detail-content { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
  .book-detail-volume, .book-detail-footer { grid-column: 1 / -1; }
}
@media (max-width: 899px) {
  .book-detail-page { --book-detail-gutter: 16px; }
  .book-detail-wash { inset: -9% -17% -5%; width: 134%; height: 114%; filter: blur(34px) saturate(1.22); opacity: .56; }
  .book-detail-header { min-height: calc(64px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top); gap: 12px; }
  .book-detail-back { width: 48px; height: 48px; }
  .book-detail-back svg { width: 25px; height: 25px; }
  .book-detail-hero {
    grid-template-columns: clamp(88px, 29cqi, 120px) minmax(0, 1fr);
    gap: 16px;
    padding-block-end: 16px;
  }
  .book-detail-read { font-size: 14px; padding-inline: 12px; }
  .book-detail-position { font-size: 12px; }
  .book-detail-content { padding-bottom: calc(32px + env(safe-area-inset-bottom)); }
  .book-detail-group h2 { font-size: 15px; }
  .book-detail-stats, .book-detail-list, .book-detail-file { border-radius: 24px; }
  .book-detail-stats > div { padding-inline: 12px; }
  .book-detail-stats dd { font-size: 16px; }
  .book-detail-row { padding-inline: 12px; gap: 8px; font-size: 14px; }
  .book-detail-value { font-size: 12px; }
  .book-detail-file > div { min-height: 48px; padding-inline: 16px; }
}
@container book-detail (max-width: 359px) {
  .book-detail-stats { grid-template-columns: 1fr; }
  .book-detail-stats > div { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding-inline: 16px; }
  .book-detail-stats dt { margin-bottom: 0; }
  .book-detail-stats dd { text-align: end; }
  .book-detail-stats > div + div {
    border-inline-start: 0;
    border-top: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
  }
}
</style>
