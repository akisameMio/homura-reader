<template>
  <div class="md-card md-card--filled md-collection-card" :class="{ 'is-drop-target': highlighted, 'md-collection-selected': selected }" :data-collection-id="collection.id" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <button class="md-collection-open" :aria-label="selecting ? t('选择书库：{0}', { 0: collection.title }) : t('打开书库：{0}，{1} 本', { 0: collection.title, 1: books.length })" :aria-pressed="selecting ? selected : undefined" @click="$emit(selecting ? 'toggle' : 'open', collection.id)">
      <span class="md-collection-art" aria-hidden="true">
        <span class="md-collection-board">
          <span v-for="index in 4" :key="index" class="md-collection-tile" :class="{ 'is-empty': !covers[index - 1] }">
            <template v-if="covers[index - 1]">
              <img v-if="covers[index - 1].cover" :src="covers[index - 1].cover || undefined" alt="" loading="lazy" decoding="async" draggable="false" />
              <span v-else class="md-collection-fallback">{{ covers[index - 1].title }}</span>
            </template>
            <MdIcon v-else name="auto_stories" />
          </span>
        </span>
        <span v-if="selecting" class="md-select-badge" aria-hidden="true">
          <MdIcon :name="selected ? 'check' : 'radio_button_unchecked'" :size="16" />
        </span>
      </span>
      <span class="md-collection-info">
        <span class="md-collection-title">{{ collection.title }}</span>
        <span class="md-collection-meta">
          <span v-if="highlighted" class="md-collection-drop">{{ t('松开移入书库') }}</span>
          <template v-else>
            <span class="md-collection-count">{{ t('{0} 本作品', { 0: books.length }) }}</span>
            <span class="md-collection-action">{{ t('打开 →') }}</span>
          </template>
        </span>
      </span>
    </button>
  </div>
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
const covers = computed(() => {
  return sortShelfBooks(props.books, props.sortKey, shelf.progressMap).slice(0, 4);
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
