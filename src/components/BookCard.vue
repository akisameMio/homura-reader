<template>
  <article class="md-shelf-card relative min-w-0 self-start" :class="{ 'is-touch-dragging': dragging, 'is-selecting': selecting }" :data-book-id="book.id" draggable="true" @dragstart="$emit('drag', $event, book.id)" @contextmenu.prevent>
    <button type="button" class="md-shelf-open absolute inset-0 z-10" :aria-label="selecting ? t('选择书本：{0}', { 0: book.title }) : t('阅读：{0}', { 0: book.title })" :aria-pressed="selecting ? selected : undefined" :aria-keyshortcuts="selecting ? undefined : 'Shift+F10'" @click="onOpen"></button>
    <div class="md-shelf-cover" :class="{ 'is-selected': selected }" ref="coverEl" data-book-cover>
      <img
        v-if="book.cover"
        :src="book.cover"
        class="md-shelf-cover-image"
        alt=""
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        draggable="false"
      />
      <div v-else class="md-shelf-cover-fallback" aria-hidden="true">
        <span class="md-shelf-cover-title line-clamp-3">{{ book.title }}</span>
      </div>

      <Transition name="md-select-badge">
        <span v-if="selecting" class="md-select-badge" :class="{ 'is-selected': selected }" aria-hidden="true">
          <MdIcon :name="selected ? 'check' : 'radio_button_unchecked'" :size="16" />
        </span>
      </Transition>
      <span v-if="!selecting" class="book-badges">
        <span v-if="book.remote" class="book-badge" role="img" :aria-label="t('云端')">
          <MdIcon name="cloud" />
        </span>
        <span class="book-badge" role="img" :aria-label="badgeText">
          <MdIcon name="auto_stories" />
        </span>
      </span>

      <div v-if="progress" class="book-progress-track" role="progressbar" :aria-label="t('阅读进度')" :aria-valuenow="progress.percent">
        <div class="book-progress-fill" :style="{ width: progress.percent + '%' }"></div>
      </div>
    </div>

    <h4 class="md-shelf-caption line-clamp-2">{{ book.title }}</h4>
  </article>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { PropType } from 'vue';
import type { Book } from '../types.ts';
import { resolveBookFormat } from '../services/utils.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  book: { type: Object as PropType<Book>, required: true },
  selecting: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  progress: { type: Object as PropType<{ percent: number } | null>, default: null },
  dragging: { type: Boolean, default: false }
});

const emit = defineEmits(['open', 'drag']);

const coverEl = shallowRef<HTMLElement | null>(null);

function onOpen() {
  emit('open', props.book.id, coverEl.value);
}

const badgeText = computed(() => {
  const format = resolveBookFormat(props.book);
  if (format === 'pdf') return 'PDF';
  if (format === 'cbz') return 'CBZ';
  if (format === 'mobi') return 'MOBI';
  if (format === 'markdown') return 'MD';
  if (format === 'txt') return 'TXT';
  return props.book.type === 'manga' ? t('漫画') : (props.book.type === 'epub' ? 'EPUB' : t('小说'));
});
</script>

<style scoped>
.book-badges {
  position: absolute;
  inset: 2.2% 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  pointer-events: none;
}

.book-badge {
  display: grid;
  flex: 0 0 clamp(17px, 13%, 36px);
  aspect-ratio: 1;
  place-items: center;
  border-radius: 36%;
  background: var(--md-on-surface);
  color: var(--md-surface);
}

.book-badge:last-child {
  margin-inline-end: 3.2%;
}

.book-badge svg {
  width: 65%;
  height: 65%;
}

.book-progress-track {
  position: absolute;
  inset: auto 0 0;
  height: 4px;
  background: color-mix(in oklab, var(--md-on-surface) 18%, transparent);
}

.book-progress-fill {
  height: 100%;
  border-radius: 0 2px 2px 0;
  background: var(--md-primary);
}
</style>
