<template>
  <div v-if="!currentCollection && pendingImportCount > 0" class="min-h-11 px-4 min-[900px]:px-7 pt-3 flex items-center">
    <span class="shelf-import-status">{{ t('正在导入 {0} 本', { 0: pendingImportCount }) }}</span>
  </div>
  <div v-if="currentCollection" class="relative mx-4 min-[900px]:mx-7 mt-2 flex items-center gap-2">
    <MdIconButton
      class="shelf-back-button w-11 h-11 shrink-0 rounded-full grid place-items-center text-[var(--md-on-secondary-container)]"
      :class="{ 'is-drop-target': touchDrag.home }"
      data-shelf-home
      :title="backLabel"
      :aria-label="backLabel"
      @click="navigateUp"
      @dragover="onRootDragOver"
      @drop="onRootDrop"
    >
      <MdIcon name="chevron_left" class="w-5 h-5" />
    </MdIconButton>
  </div>
  <Teleport v-if="selectionTarget" :to="selectionTarget">
    <ShelfBatchBar
      :label="selectionLabel"
      :all-selected="allSelected"
      :select-all-disabled="!canSelect || busy"
      :move-label="currentCollection ? t('移出书库') : t('移入书库')"
      :move-disabled="!selectedIds.length || (!currentCollection && !!selectedCollectionIds.length) || busy"
      :delete-label="favoritesOnly ? t('取消收藏') : t('删除')"
      :delete-disabled="(!selectedIds.length && !selectedCollectionIds.length) || busy"
      :danger-delete="!favoritesOnly"
      :can-manage-storage="canManageStorage"
      @select-all="selectAll"
      @move="moveSelection"
      @delete="deleteSelected"
      @cancel="closeSelection"
      @manage-storage="emit('manage-storage', selectedIds[0])"
    />
  </Teleport>
  <section ref="gridRef" class="md-shelf-grid" :aria-label="favoritesOnly ? t('收藏内容') : currentCollection ? t('书库：{0}', { 0: currentCollection.title }) : t('书架内容')" @contextmenu="onShelfContextMenu" @keydown="onShelfKeydown" @touchstart.passive="onBookTouchStart">
    <ContinueReading v-if="!favoritesOnly && !currentCollection && !selecting && featuredBooks.length" :books="featuredBooks" @open="openBook" />
    <CollectionCard v-for="collection in displayCollections" :key="collection.id" :collection="collection" :books="booksForCollection(collection)" :sort-key="sortKey" :touch-over="touchDrag.overId === collection.id" :selecting="selecting" :selected="selectedCollectionIds.includes(collection.id)" @open="openCollection" @toggle="toggleCollection" @move="moveDropped" />
    <BookCard v-for="book in renderedBooks" :key="book.id" :book="book" :progress="shelf.progressInfoFor(book.id) ?? undefined" :selecting="selecting" :selected="selectedIds.includes(book.id)" :dragging="touchDrag.active && touchDrag.ids.includes(book.id)" @open="openBook" @drag="onBookDrag" />
    <template v-if="!selecting">
      <div
        v-for="slot in importPlaceholderCount"
        :key="`import-slot-${slot}`"
        class="md-shelf-card shelf-import-placeholder self-start"
        :style="{ '--shelf-shimmer-delay': `${(slot - 1) * 110}ms` }"
        aria-hidden="true"
      >
        <div class="md-shelf-cover"></div>
        <div class="md-shelf-caption"></div>
      </div>
    </template>
    <div v-if="renderedBooks.length < orderedBooks.length" ref="loadMoreSentinel" class="col-span-full h-8" aria-hidden="true"></div>
    <p v-if="!importing && !displayBooks.length && !displayCollections.length" class="col-span-full py-16 text-center text-[13px] text-[var(--md-on-surface-variant)]">{{ emptyShelfHint }}</p>
  </section>

</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type PropType } from 'vue';
import { useShelfStore } from '../stores/shelf.ts';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import { useViewport } from '../composables/useViewport.ts';
import { compareBookTitles, normalizeBookTitle } from '../services/bookTitles.ts';
import { collectionPath } from '../services/collections.ts';
import { groupShelfBooks } from '../services/shelfSections.ts';
import { canUseNativeImport } from '../services/nativeImport.ts';
import BookCard from './BookCard.vue';
import ContinueReading from './ContinueReading.vue';
import CollectionCard from './CollectionCard.vue';
import MdIcon from './MdIcon.vue';
import MdIconButton from './MdIconButton.vue';
import ShelfBatchBar from './ShelfBatchBar.vue';
import type { Book, Collection } from '../types.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  books: { type: Array as PropType<Book[]>, default: () => [] },
  sortKey: { type: String, default: 'title' },
  query: { type: String, default: '' },
  hasFilter: { type: Boolean, default: false },
  homeRequest: { type: Number, default: 0 },
  favoritesOnly: { type: Boolean, default: false },
  importing: { type: Boolean, default: false },
  pendingImportCount: { type: Number, default: 0 },
  selectionTarget: { type: Object as PropType<HTMLElement | null>, default: null }
});
const emit = defineEmits(['open', 'detail', 'browse', 'manage-storage']);
const shelf = useShelfStore();
const { askShelfDialog } = useShelfDialogs();
const { isTouch } = useViewport();
const selecting = ref(false);
const selectedIds = ref<string[]>([]);
const selectedCollectionIds = ref<string[]>([]);
const busy = ref(false);
const canManageStorage = computed(() => canUseNativeImport() && !busy.value && selectedIds.value.length === 1
  && !selectedCollectionIds.value.length && shelf.library.some(book => book.id === selectedIds.value[0] && !book.remote));
const currentCollection = computed(() => props.favoritesOnly ? null : shelf.collectionsById.get(shelf.activeCollectionId ?? '') ?? null);
const backLabel = computed(() => currentCollection.value?.parentId ? t('返回上一级') : t('返回书架'));
const groupedIds = computed(() => new Set(shelf.collections.flatMap(item => item.bookIds)));
const displayBooks = computed(() => props.books.filter(book => props.favoritesOnly ? book.favorite : currentCollection.value ? currentCollection.value.bookIds.includes(book.id) : !groupedIds.value.has(book.id)));
const featuredBooks = computed(() => currentCollection.value ? displayBooks.value : props.hasFilter ? props.books : shelf.library);
const orderedBooks = computed(() => currentCollection.value ? displayBooks.value : groupShelfBooks(displayBooks.value).flatMap(section => section.books));
const INITIAL_RENDER_LIMIT = 96;
const RENDER_STEP = 96;
const importPlaceholderCount = computed(() => Math.min(8, props.pendingImportCount));
const renderLimit = ref(INITIAL_RENDER_LIMIT);
const gridRef = shallowRef<HTMLElement | null>(null);
const loadMoreSentinel = shallowRef<HTMLElement | null>(null);
const renderedBooks = computed(() => orderedBooks.value.length > renderLimit.value
  ? orderedBooks.value.slice(0, renderLimit.value)
  : orderedBooks.value);
let loadMoreObserver: IntersectionObserver | null = null;
const allSelected = computed(() => {
  const total = displayBooks.value.length + displayCollections.value.length;
  return total > 0 &&
    displayBooks.value.every(book => selectedIds.value.includes(book.id)) &&
    displayCollections.value.every(collection => selectedCollectionIds.value.includes(collection.id));
});
const selectionLabel = computed(() => {
  const bookCount = selectedIds.value.length;
  const collectionCount = selectedCollectionIds.value.length;
  if (collectionCount) return t('已选 {0} 项', { 0: bookCount + collectionCount });
  return t('已选 {0} 本', { 0: bookCount });
});
const emptyShelfHint = computed(() => {
  if (props.hasFilter) return t('没有符合条件的作品，换个关键词或筛选试试');
  if (props.favoritesOnly) return t('还没有收藏的书，在阅读器中点亮星星即可收藏');
  if (currentCollection.value) return isTouch.value ? t('书库还是空的，可长按主页封面后移入书库') : t('书库还是空的，可从主页拖入书本，或多选后移入书库');
  return t('书库还是空的，可从主页拖入书本，或多选后移入书库');
});

const TOUCH_DRAG_DELAY = 420;
const TOUCH_DRAG_CANCEL_DISTANCE = 10;
const AUTO_SCROLL_EDGE = 88;
const AUTO_SCROLL_MAX_SPEED = 14;
const touchDrag = reactive({
  active: false,
  x: 0,
  y: 0,
  ids: [] as string[],
  overId: null as string | null,
  home: false
});
let touchTimer: number | null = null;
type BookTrigger = { id: string; card: HTMLElement; cover: HTMLElement; button: HTMLButtonElement | null };
let touchContext: {
  trigger: BookTrigger; identifier: number; startX: number; startY: number;
  x: number; y: number; held: boolean; scrollEl: Element | null;
} | null = null;
let autoScrollFrame = 0;
let autoScrollVelocity = 0;
let autoScrollEl: Element | null = null;
let swallowClick = false;
let swallowClickTarget: HTMLElement | null = null;
let swallowClickTimer: number | null = null;

const canTouchMoveBooks = computed(() => !props.favoritesOnly && (displayCollections.value.length > 0 || !!currentCollection.value));
const matchingBranches = computed(() => {
  const matches = new Set<string>();
  if (!props.hasFilter) return matches;
  const visible = new Set(props.books.map(book => book.id));
  const keyword = normalizeBookTitle(props.query);
  for (const item of shelf.collections) {
    if (!(keyword && normalizeBookTitle(item.title).includes(keyword)) && !item.bookIds.some(id => visible.has(id))) continue;
    for (let branch: Collection | undefined = item; branch && !matches.has(branch.id); branch = shelf.collectionsById.get(branch.parentId ?? '')) {
      matches.add(branch.id);
    }
  }
  return matches;
});
const displayCollections = computed(() => {
  if (props.favoritesOnly) return [];
  const list = shelf.collections.filter(item => item.parentId === currentCollection.value?.id
    && (!props.hasFilter || matchingBranches.value.has(item.id)));
  const latest = (item: Collection) => booksForCollection(item).reduce((time, book) => Math.max(time, shelf.progressMap[book.id]?.updatedAt || 0), 0);
  return list.sort((a, b) => (props.sortKey === 'recent' ? (b.createdAt || 0) - (a.createdAt || 0) : props.sortKey === 'progress' ? latest(b) - latest(a) : 0) || compareBookTitles(a, b));
});
const canSelect = computed(() => displayBooks.value.length > 0 || displayCollections.value.length > 0);

defineExpose({ canSelect, selecting, startSelection, closeSelection });

function booksForCollection(collection: Collection) {
  return shelf.branchBooks.get(collection.id) ?? [];
}

function navigateUp() {
  shelf.activeCollectionId = currentCollection.value?.parentId ?? null;
  emit('browse');
}

function openCollection(id: string) { shelf.activeCollectionId = id; emit('browse'); }
function clearSelection() { selectedIds.value = []; selectedCollectionIds.value = []; }
function startSelection() {
  if (canSelect.value) selecting.value = true;
}
function closeSelection() {
  selecting.value = false;
  clearSelection();
}
function toggleCollection(id: string) {
  selectedCollectionIds.value = selectedCollectionIds.value.includes(id)
    ? selectedCollectionIds.value.filter(item => item !== id)
    : [...selectedCollectionIds.value, id];
}
function selectAll() {
  if (allSelected.value) {
    clearSelection();
    return;
  }
  selectedIds.value = displayBooks.value.map(book => book.id);
  selectedCollectionIds.value = displayCollections.value.map(collection => collection.id);
}
function openBook(id: string, cover: HTMLElement | null) {
  if (!selecting.value) return emit('open', id, cover);
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(item => item !== id) : [...selectedIds.value, id];
}

async function perform(action: () => unknown) {
  if (busy.value) return;
  busy.value = true;
  try { await action(); } catch (err) { console.warn('[HOMURA] 书库操作失败', err); } finally { busy.value = false; }
}

async function chooseDestination() {
  const options = shelf.collections.filter(item => item.id !== shelf.activeCollectionId).sort(compareBookTitles).map(item => ({ value: item.id, title: collectionPath(item, shelf.collectionsById) }));
  const target = await askShelfDialog({ kind: 'move', title: t('移入书库'), message: t('将选中的 {0} 本书移动到：', { 0: selectedIds.value.length }), options });
  if (typeof target === 'string') await moveSelected(target);
}

function moveSelection() {
  return currentCollection.value ? moveSelected(null) : chooseDestination();
}

async function deleteSelected() {
  const bookCount = selectedIds.value.length;
  const collectionCount = selectedCollectionIds.value.length;
  if ((!bookCount && !collectionCount) || busy.value) return;
  const removingFavorites = props.favoritesOnly;
  const changes: string[] = [];
  if (bookCount) changes.push(t('删除选中的 {0} 本作品、应用内存档与阅读记录', { 0: bookCount }));
  if (collectionCount) {
    const hasChildren = shelf.collections.some(item => item.parentId && selectedCollectionIds.value.includes(item.parentId));
    changes.push(t(hasChildren ? '删除选中的 {0} 个书库（直接收录的作品移回主页，子书库提升一级）' : '删除选中的 {0} 个书库（书库内作品会移回主页）', { 0: collectionCount }));
  }
  const confirmed = await askShelfDialog({
    kind: 'confirm',
    intent: removingFavorites ? 'favorite' : 'delete',
    removesFiles: !removingFavorites && bookCount > 0,
    title: removingFavorites
      ? t('取消收藏')
      : collectionCount && !bookCount
        ? t('删除书库')
        : bookCount && !collectionCount
          ? t('删除书本')
          : t('删除所选内容'),
    message: removingFavorites
      ? t('将取消收藏选中的 {0} 本作品，不会删除原始文件。', { 0: bookCount })
      : t('将{0}。此操作无法撤销。', { 0: changes.join('；') }),
    confirmLabel: removingFavorites ? t('取消收藏') : t('确认删除')
  });
  if (!confirmed) return;

  const bookIds = [...selectedIds.value];
  const collectionIds = [...selectedCollectionIds.value];
  await perform(async () => {
    const failedBooks: string[] = [];
    const failedCollections: string[] = [];
    for (const id of bookIds) {
      try {
        if (removingFavorites) await shelf.setFavorite(id, false);
        else await shelf.removeBook(id);
      } catch (err) {
        failedBooks.push(id);
      }
    }
    for (const id of collectionIds) {
      try {
        await shelf.deleteCollection(id);
      } catch (err) {
        failedCollections.push(id);
      }
    }
    if (failedBooks.length || failedCollections.length) {
      selectedIds.value = failedBooks;
      selectedCollectionIds.value = failedCollections;
      shelf.error = removingFavorites ? t('部分作品取消收藏失败，请重试') : t('部分内容删除失败，请重试');
      return;
    }
    closeSelection();
  });
}

async function moveSelected(target: string | null) {
  await perform(async () => { await shelf.moveBooks(selectedIds.value, target); closeSelection(); });
}

function onBookDrag(event: DragEvent, id: string) {
  const ids = selectedIds.value.includes(id) ? selectedIds.value : [id];
  event.dataTransfer!.setData('application/x-homura-books', JSON.stringify(ids));
  event.dataTransfer!.effectAllowed = 'move';
}

async function moveDropped(ids: string[], target: string | null) {
  await perform(async () => { await shelf.moveBooks(ids, target); closeSelection(); });
}

function bookTrigger(target: EventTarget | null): BookTrigger | null {
  const card = target instanceof Element ? target.closest<HTMLElement>('[data-book-id]') : null;
  const cover = card?.querySelector<HTMLElement>('[data-book-cover]');
  const id = card?.dataset.bookId;
  if (!card || !cover || !id) return null;
  return { id, card, cover, button: card instanceof HTMLButtonElement ? card : card.querySelector('.md-shelf-open') };
}

function hitsCover(cover: HTMLElement, x: number, y: number) {
  const rect = cover.getBoundingClientRect();
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function showBookDetail(trigger: BookTrigger) {
  if (!selecting.value) emit('detail', trigger.id, trigger.cover, trigger.button);
}

function onShelfContextMenu(event: MouseEvent) {
  const trigger = bookTrigger(event.target);
  if (!trigger) return;
  event.preventDefault();
  // 触屏的系统 contextmenu 可能先于 touchend，交给同一条长按手势处理。
  if (touchContext || swallowClick || (event as PointerEvent).pointerType === 'touch') return;
  if (hitsCover(trigger.cover, event.clientX, event.clientY)) showBookDetail(trigger);
}

function onShelfKeydown(event: KeyboardEvent) {
  if (selecting.value || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
  const trigger = bookTrigger(event.target);
  if (!trigger) return;
  event.preventDefault();
  showBookDetail(trigger);
}

function onBookTouchStart(event: TouchEvent) {
  if (touchDrag.active || event.touches.length !== 1) return;
  const trigger = bookTrigger(event.target);
  if (!trigger) return;

  cancelTouchCandidate();
  const touch = event.touches[0];
  if (selecting.value && !canTouchMoveBooks.value) return;
  if (!selecting.value && !hitsCover(trigger.cover, touch.clientX, touch.clientY)) return;
  touchContext = {
    trigger,
    identifier: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    x: touch.clientX,
    y: touch.clientY,
    held: false,
    scrollEl: findScrollParent(trigger.card)
  };
  window.addEventListener('touchmove', onBookTouchMove, { passive: false });
  window.addEventListener('touchstart', onAdditionalTouch, { passive: true });
  window.addEventListener('touchend', onBookTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onBookTouchCancel, { passive: false });
  touchTimer = window.setTimeout(() => {
    touchTimer = null;
    if (!touchContext) return;
    touchContext.held = true;
    try { navigator.vibrate?.(12); } catch (err) {}
    if (selecting.value) beginTouchDrag();
  }, TOUCH_DRAG_DELAY);
}

function beginTouchDrag() {
  if (!touchContext || touchDrag.active) return;
  const ctx = touchContext;
  const id = ctx.trigger.id;
  const ids = selectedIds.value.includes(id) ? [...selectedIds.value] : [id];
  autoScrollEl = ctx.scrollEl;
  touchDrag.active = true;
  touchDrag.x = ctx.x;
  touchDrag.y = ctx.y;
  touchDrag.ids = ids;
  document.body.classList.add('md-touch-dragging');
  updateTouchDropTarget();
  updateAutoScroll();
}

function onBookTouchMove(event: TouchEvent) {
  if (!touchContext) return;
  if (event.touches.length !== 1) {
    if (touchDrag.active) finishTouchDrag(false);
    else cancelTouchCandidate();
    return;
  }
  const touch = event.touches[0];
  if (!touch || touch.identifier !== touchContext.identifier) return;
  touchContext.x = touch.clientX;
  touchContext.y = touch.clientY;

  if (!touchDrag.active) {
    const distance = Math.hypot(touch.clientX - touchContext.startX, touch.clientY - touchContext.startY);
    if (distance <= TOUCH_DRAG_CANCEL_DISTANCE) return;
    if (touchContext.held && canTouchMoveBooks.value && touchContext.trigger.card.classList.contains('md-shelf-card') && event.cancelable) {
      beginTouchDrag();
    } else {
      cancelTouchCandidate();
      return;
    }
  }

  event.preventDefault();
  touchDrag.x = touch.clientX;
  touchDrag.y = touch.clientY;
  updateTouchDropTarget();
  updateAutoScroll();
}

function onAdditionalTouch(event: TouchEvent) {
  if (event.touches.length > 1) finishTouchDrag(false);
}

function onBookTouchEnd(event: TouchEvent) {
  const context = touchContext;
  if (!context || !Array.from(event.changedTouches).some(touch => touch.identifier === context.identifier)) return;
  if (touchDrag.active) {
    event.preventDefault();
    finishTouchDrag(true);
    return;
  }
  cancelTouchCandidate();
  if (context.held && !selecting.value && context.trigger.cover.isConnected) {
    event.preventDefault();
    armClickGuard(context.trigger.card);
    showBookDetail(context.trigger);
  }
}

function onBookTouchCancel(event: TouchEvent) {
  if (!touchContext) return;
  event.preventDefault();
  finishTouchDrag(false);
}

function finishTouchDrag(commit: boolean) {
  const wasActive = touchDrag.active;
  const ids = [...touchDrag.ids];
  const targetId = touchDrag.overId;
  const moveHome = touchDrag.home;
  if (wasActive) armClickGuard();
  resetTouchDrag();
  if (!commit || !wasActive) return;
  if (targetId) moveDropped(ids, targetId);
  else if (moveHome) moveDropped(ids, currentCollection.value?.parentId ?? null);
}

function cancelTouchCandidate() {
  if (touchTimer !== null) {
    window.clearTimeout(touchTimer);
    touchTimer = null;
  }
  window.removeEventListener('touchmove', onBookTouchMove);
  window.removeEventListener('touchstart', onAdditionalTouch);
  window.removeEventListener('touchend', onBookTouchEnd);
  window.removeEventListener('touchcancel', onBookTouchCancel);
  touchContext = null;
}

function resetTouchDrag() {
  cancelTouchCandidate();
  stopAutoScroll();
  touchDrag.active = false;
  touchDrag.ids = [];
  touchDrag.overId = null;
  touchDrag.home = false;
  autoScrollEl = null;
  document.body.classList.remove('md-touch-dragging');
}

function updateTouchDropTarget() {
  const element = document.elementFromPoint(touchDrag.x, touchDrag.y);
  const collection = element?.closest('[data-collection-id]');
  const home = element?.closest('[data-shelf-home]');
  touchDrag.overId = collection?.getAttribute('data-collection-id') || null;
  touchDrag.home = !collection && !!home;
}

function findScrollParent(element: Element | null | undefined) {
  let current = element?.parentElement || null;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return document.scrollingElement;
}

function updateAutoScroll() {
  if (!autoScrollEl) {
    autoScrollVelocity = 0;
    return;
  }
  const rect = autoScrollEl.getBoundingClientRect();
  if (!rect.height) return;
  const edge = Math.min(AUTO_SCROLL_EDGE, rect.height * 0.24);
  let velocity = 0;
  if (touchDrag.y < rect.top + edge) {
    velocity = -Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, (rect.top + edge - touchDrag.y) / edge));
  } else if (touchDrag.y > rect.bottom - edge) {
    velocity = Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, (touchDrag.y - (rect.bottom - edge)) / edge));
  }
  autoScrollVelocity = velocity;
  if (velocity && !autoScrollFrame) autoScrollFrame = window.requestAnimationFrame(tickAutoScroll);
}

function tickAutoScroll() {
  autoScrollFrame = 0;
  if (!touchDrag.active || !autoScrollEl || !autoScrollVelocity) return;
  const maxTop = Math.max(0, autoScrollEl.scrollHeight - autoScrollEl.clientHeight);
  const nextTop = Math.max(0, Math.min(maxTop, autoScrollEl.scrollTop + autoScrollVelocity));
  if (nextTop === autoScrollEl.scrollTop) {
    autoScrollVelocity = 0;
    return;
  }
  autoScrollEl.scrollTop = nextTop;
  updateTouchDropTarget();
  autoScrollFrame = window.requestAnimationFrame(tickAutoScroll);
}

function stopAutoScroll() {
  if (autoScrollFrame) window.cancelAnimationFrame(autoScrollFrame);
  autoScrollFrame = 0;
  autoScrollVelocity = 0;
}

function armClickGuard(target: HTMLElement | null = null) {
  swallowClick = true;
  swallowClickTarget = target;
  if (swallowClickTimer !== null) window.clearTimeout(swallowClickTimer);
  swallowClickTimer = window.setTimeout(() => {
    swallowClick = false;
    swallowClickTarget = null;
    swallowClickTimer = null;
  }, 500);
}

function onDocumentClick(event: MouseEvent) {
  if (!swallowClick) return;
  if (swallowClickTarget && (!(event.target instanceof Node) || !swallowClickTarget.contains(event.target))) return;
  swallowClick = false;
  swallowClickTarget = null;
  if (swallowClickTimer !== null) {
    window.clearTimeout(swallowClickTimer);
    swallowClickTimer = null;
  }
  event.preventDefault();
  event.stopPropagation();
}

function onRootDragOver(event: DragEvent) {
  if (Array.from(event.dataTransfer?.types || []).includes('application/x-homura-books')) event.preventDefault();
}

function onRootDrop(event: DragEvent) {
  if (!Array.from(event.dataTransfer?.types || []).includes('application/x-homura-books')) return;
  event.preventDefault();
  event.stopPropagation();
  try { const ids = JSON.parse(event.dataTransfer!.getData('application/x-homura-books')); if (Array.isArray(ids)) moveDropped(ids.filter(id => typeof id === 'string'), currentCollection.value?.parentId ?? null); } catch (err) { console.warn('[HOMURA] 拖动书本失败', err); }
}

watch([() => shelf.activeCollectionId, () => props.homeRequest], closeSelection);
watch(displayBooks, list => { const ids = new Set(list.map(book => book.id)); selectedIds.value = selectedIds.value.filter(id => ids.has(id)); });

watch([renderedBooks, () => props.importing], async ([books, importing], [previousBooks, wasImporting]) => {
  const grid = gridRef.value;
  if (!grid || (!importing && !wasImporting) || books === previousBooks) return;
  const main = grid.closest<HTMLElement>('main[data-app-scroll]');
  const scroller = main && /auto|scroll/.test(getComputedStyle(main).overflowY) ? main : null;
  if ((scroller?.scrollTop ?? window.scrollY) <= 0) return;

  // 新书仍按当前规则排序；若落在视口上方，保住正在查看的原有书卡。
  const top = scroller?.getBoundingClientRect().top ?? 0;
  const bottom = scroller?.getBoundingClientRect().bottom ?? window.innerHeight;
  const card = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .md-shelf-card:not(.shelf-import-placeholder)')).find(node => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > top && rect.top < bottom;
  });
  if (!card) return;
  const previousTop = card.getBoundingClientRect().top;
  await nextTick();
  if (!card.isConnected) return;
  const shift = card.getBoundingClientRect().top - previousTop;
  if (Math.abs(shift) < 1) return;
  (scroller ?? window).scrollBy({ top: shift, behavior: 'instant' });
});

// 超大书架先渲染前几屏；封面内部用 content-visibility 跳过屏外绘制，
// 这里再限制 DOM 数量，避免几千本书一次性建节点。
function observeLoadMore() {
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: '900px 0px' });
  }
  loadMoreObserver.disconnect();
  if (loadMoreSentinel.value && renderedBooks.value.length < orderedBooks.value.length) {
    loadMoreObserver.observe(loadMoreSentinel.value);
  }
}

function loadMore() {
  if (renderLimit.value >= orderedBooks.value.length) return;
  renderLimit.value += RENDER_STEP;
  nextTick(observeLoadMore);
}

watch(
  [() => props.query, () => props.sortKey, () => props.favoritesOnly, () => currentCollection.value?.id],
  () => {
    renderLimit.value = INITIAL_RENDER_LIMIT;
    nextTick(observeLoadMore);
  }
);
watch(loadMoreSentinel, observeLoadMore, { flush: 'post' });

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true);
  nextTick(observeLoadMore);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick, true);
  loadMoreObserver?.disconnect();
  loadMoreObserver = null;
  if (swallowClickTimer !== null) window.clearTimeout(swallowClickTimer);
  resetTouchDrag();
});
</script>

<style scoped>
.shelf-import-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
  font-size: 12px;
  font-weight: 600;
}
.shelf-import-status::before {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--md-primary);
}
.shelf-import-placeholder {
  pointer-events: none;
  overflow-anchor: none;
}
.shelf-import-placeholder .md-shelf-cover {
  border: 0.5px solid var(--md-outline-variant);
  background: linear-gradient(112deg,
    var(--md-surface-high) 10%,
    color-mix(in oklab, var(--md-surface-high) 66%, var(--md-surface)) 51%,
    var(--md-surface-high) 91%);
}
.shelf-import-placeholder .md-shelf-caption {
  display: grid;
  justify-items: center;
  min-height: 1lh;
}
.shelf-import-placeholder .md-shelf-caption::before {
  content: '';
  width: 58%;
  height: 10px;
  margin-top: 4px;
  border-radius: 999px;
  background: var(--md-surface-high);
}
.shelf-import-placeholder:nth-child(even) .md-shelf-caption::before { width: 68%; }

@media (prefers-reduced-motion: no-preference) {
  .shelf-import-placeholder .md-shelf-cover::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(110deg,
      transparent 24%,
      color-mix(in oklab, var(--md-primary) 14%, transparent) 50%,
      transparent 76%);
    transform: translateX(-100%);
    animation: shelf-import-shimmer 2s linear var(--shelf-shimmer-delay) infinite;
  }

  @keyframes shelf-import-shimmer {
    0% { transform: translateX(-100%); }
    72%, 100% { transform: translateX(100%); }
  }
}

.shelf-back-button {
  --icon-button-background: var(--md-secondary-container);
}
.shelf-back-button.is-drop-target {
  --icon-button-background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}
</style>
