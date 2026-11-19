<template>
  <article class="md-shelf-card md-collection-card relative min-w-0 self-start" :class="{ 'is-drop-target': highlighted }" :data-collection-id="collection.id" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <button type="button" class="md-shelf-open absolute inset-0 z-10" :aria-label="selecting ? t('选择书库：{0}', { 0: collection.title }) : t('打开书库：{0}，{1} 本', { 0: collection.title, 1: books.length })" :aria-pressed="selecting ? selected : undefined" @click="$emit(selecting ? 'toggle' : 'open', collection.id)"></button>
    <div class="md-collection-stack">
      <div class="md-shelf-cover" :class="{ 'is-selected': selected }">
        <img v-if="leadBook?.cover" :src="leadBook.cover" class="md-shelf-cover-image" alt="" loading="lazy" decoding="async" draggable="false" />
        <div v-else class="md-shelf-cover-fallback" aria-hidden="true">
          <span v-if="leadBook" class="md-shelf-cover-title line-clamp-3">{{ leadBook.title }}</span>
          <MdIcon v-else name="collections_bookmark" :size="36" />
        </div>
        <span class="md-collection-badges" aria-hidden="true">
          <span class="md-collection-badge"><span class="md-collection-badge-label">{{ t('{0} 册', { 0: books.length }) }}</span></span>
          <span v-if="!selecting" class="md-collection-badge">
            <MdIcon name="collections_bookmark" :size="14" />
            <span class="md-collection-badge-label">{{ t('系列') }}</span>
          </span>
        </span>
        <span v-if="selecting" class="md-select-badge md-shape-morph md-shape-boom" :class="{ 'is-selected': selected }" aria-hidden="true">
          <MdIcon :name="selected ? 'check' : 'radio_button_unchecked'" :size="16" />
        </span>
        <span v-if="highlighted" class="md-collection-drop">{{ t('松开移入书库') }}</span>
      </div>
    </div>
    <h4 class="md-shelf-caption line-clamp-2">{{ collection.title }}</h4>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PropType } from 'vue';
import { sortShelfBooks } from '../services/bookTitles.ts';
import { useShelfStore } from '../stores/shelf.ts';
import MdIcon from './MdIcon.vue';
import type { Book, Collection } from '../types.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({ collection: { type: Object as PropType<Collection>, required: true }, books: { type: Array as PropType<Book[]>, default: () => [] as Book[] }, sortKey: { type: String, default: 'title' }, touchOver: { type: Boolean, default: false }, selecting: { type: Boolean, default: false }, selected: { type: Boolean, default: false } });
const emit = defineEmits(['open', 'toggle', 'move']);
const hovering = ref(false);
const shelf = useShelfStore();
const highlighted = computed(() => hovering.value || props.touchOver);
const leadBook = computed(() => {
  const orderedBooks = sortShelfBooks(props.books, props.sortKey, shelf.progressMap);
  return orderedBooks.find(book => book.cover) ?? orderedBooks[0];
});

function onDragOver(event: DragEvent) {
  if (!Array.from(event.dataTransfer?.types || []).includes('application/x-homura-books')) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
  hovering.value = true;
}

function onDragLeave(event: DragEvent) {
  if (!(event.currentTarget as Node).contains(event.relatedTarget as Node)) hovering.value = false;
}

function onDrop(event: DragEvent) {
  hovering.value = false;
  if (!Array.from(event.dataTransfer?.types || []).includes('application/x-homura-books')) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    const ids = JSON.parse(event.dataTransfer!.getData('application/x-homura-books'));
    if (Array.isArray(ids) && ids.every(id => typeof id === 'string')) emit('move', ids, props.collection.id);
  } catch (err) {
    console.warn('[HOMURA] 无法读取拖动的书本', err);
  }
}
</script>
