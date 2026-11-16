<template>
  <!-- 信息与行动分区：整卡可点击，小封面保留书架到阅读器的共享元素锚点。 -->
  <button
    v-if="featured"
    type="button"
    class="md-card continue-card md-featured-cell"
    :title="started ? t('继续阅读：{0}', { 0: featured.book.title }) : t('开始阅读：{0}', { 0: featured.book.title })"
    :aria-label="started ? t('继续阅读：{0}', { 0: featured.book.title }) : t('开始阅读：{0}', { 0: featured.book.title })"
    @click="onOpen"
  >
    <span class="content">
      <span class="eyebrow-row">
        <MdIcon name="auto_stories" class="section-icon" />
        <span class="section-label">{{ t('阅读进度') }}</span>
        <span class="reading-state"><span class="state-dot"></span>{{ started ? t('继续阅读') : t('开始阅读') }}</span>
      </span>

      <span class="book-summary">
        <span class="cover-shell" :data-book-cover-id="featured.book.id">
          <img v-if="featured.book.cover" :src="featured.book.cover" class="cover-image" alt="" loading="lazy" decoding="async" draggable="false" />
          <span v-else class="cover-fallback" aria-hidden="true"><MdIcon name="auto_stories" /></span>
        </span>
        <span class="book-copy">
          <span class="book-title">{{ featured.book.title }}</span>
          <span class="book-chips">
            <span class="format-chip">{{ typeLabel }}</span>
            <span class="count-chip">{{ totalPages }} {{ started ? t('页') : countUnit }}</span>
          </span>
        </span>
      </span>

      <span class="reading-details">
        <span class="detail-group">
          <span class="detail-label">{{ t('阅读进度') }}</span>
          <span class="detail-value">{{ progressPercent }}<small>%</small></span>
        </span>
        <span class="detail-group">
          <span class="detail-label">{{ lastReadLabel }}</span>
          <span class="detail-position">
            <template v-if="started">{{ t('第 {0} / {1} 页', { 0: (featured.progress?.index ?? 0) + 1, 1: totalPages }) }}</template>
            <template v-else>{{ remainingText }}</template>
          </span>
        </span>
      </span>

      <span class="progress-track" role="progressbar" :aria-label="t('阅读进度')" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="progressPercent">
        <svg class="progress-wave" viewBox="0 0 120 20" preserveAspectRatio="none" aria-hidden="true">
          <path d="M3 10C7 3 11 3 15 10S23 17 27 10 35 3 39 10 47 17 51 10 59 3 63 10 71 17 75 10 83 3 87 10 95 17 99 10 107 3 111 10 115 14 117 10" />
        </svg>
      </span>
    </span>

    <span class="action-panel" aria-hidden="true">
      <svg class="action-surface" viewBox="0 0 240 400" preserveAspectRatio="none" focusable="false">
        <path d="M43 0H240V400H99C65 386 85 360 53 344C12 324 52 292 26 264C-7 228 28 200 17 169C3 132 39 112 25 80C12 48 57 35 43 0Z" />
      </svg>
      <span class="action-content">
        <span class="play">
          <svg class="play-shape" viewBox="0 0 100 100" focusable="false"><path d="M50 3C57-1 61 8 67 9C74 8 80 12 81 20C89 21 94 27 92 35C99 41 99 49 94 55C97 63 93 71 85 73C84 82 78 87 70 85C64 93 56 96 50 91C43 97 35 93 32 86C23 88 16 82 16 74C6 72 3 65 7 58C0 52 1 43 8 38C4 29 10 23 17 22C18 13 24 9 32 11C36 3 43-1 50 3Z" /></svg>
          <MdIcon name="play_arrow" filled class="play-icon" />
        </span>
        <span class="action-label">{{ started ? t('继续阅读') : t('开始阅读') }}</span>
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { useShelfStore } from '../stores/shelf.ts';
import { resolveBookFormat } from '../services/utils.ts';
import MdIcon from './MdIcon.vue';
import { readBookCoverRect } from '../services/bookCover.ts';
import { playShelfToReaderSplash } from '../services/readerTransition.ts';

const emit = defineEmits(['open']);
import type { Book } from '../types.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t, locale } = useI18n();
const props = defineProps({ books: { type: Array as PropType<Book[] | null>, default: null } });

const shelf = useShelfStore();

const items = computed(() =>
  (props.books || shelf.library)
    .map(book => {
      const record = shelf.progressMap[book.id];
      const progress = shelf.progressInfoFor(book.id) || (record ? { percent: 0, index: (record.index as number) || 0, total: (record.total as number) || 0, updatedAt: (record.updatedAt as number) || 0 } : null);
      return { book, progress };
    })
    .filter(item => item.progress)
    .sort((a, b) => ((b.progress?.updatedAt) || 0) - ((a.progress?.updatedAt) || 0))
);

// 没有阅读记录时，用最近添加的一部作品作为「开始阅读」入口，保证特色卡始终在网格首位
const featured = computed(() => {
  if (items.value.length) return items.value[0];
  const book = (props.books || shelf.library)[0];
  if (!book) return null;
  const total = book.pageCount || (book.pageItems && book.pageItems.length) || (book.chapters && book.chapters.length) || 0;
  return { book, progress: { index: 0, total, percent: 0, updatedAt: 0 } };
});

// 点击特色卡：若拿到封面起点矩形，就播共享元素飞行封面，再通知父级打开
function onOpen() {
  const item = featured.value;
  if (!item) return;
  const rect = readBookCoverRect(item.book.id);
  if (rect) playShelfToReaderSplash({ rect, cover: item.book.cover || '', title: item.book.title });
  emit('open', item.book.id);
}

const typeLabel = computed(() => {
  const book = featured.value && featured.value.book;
  if (!book) return '';
  const format = resolveBookFormat(book);
  if (format === 'pdf') return 'PDF';
  if (format === 'cbz') return 'CBZ';
  if (format === 'mobi') return 'MOBI';
  if (format === 'markdown') return 'MD';
  if (format === 'txt') return 'TXT';
  return book.type === 'manga' ? t('漫画') : (book.type === 'epub' ? 'EPUB' : t('轻小说'));
});

const totalPages = computed((): number => {
  const item = featured.value;
  if (!item) return 0;
  if (item.progress?.total) return item.progress.total;
  const book = item.book;
  if (book.pageCount) return book.pageCount;
  if (book.pageItems) return book.pageItems.length;
  return book.chapters ? book.chapters.length : 0;
});

const started = computed(() => !!featured.value && (featured.value.progress?.updatedAt || 0) > 0);

// 未开始阅读的小说显示章节数，漫画 / PDF 才是页数；读起来之后一律用实际分页。
const countUnit = computed(() => (featured.value?.book?.type === 'manga' ? t('页') : t('章')));

// 上次阅读时间：当天只显示时刻，跨天显示日期
const clockText = computed(() => {
  const item = featured.value;
  if (!item || !item.progress?.updatedAt) return '';
  const date = new Date(item.progress.updatedAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
});

const lastReadLabel = computed(() => {
  if (!started.value) return t('初次阅读');
  return clockText.value ? t('上次 {0}', { 0: clockText.value }) : t('上次阅读');
});

const remainingText = computed(() => {
  const item = featured.value;
  if (!item || !started.value) return t('尚未开始');
  const rest = Math.max(0, totalPages.value - (item.progress?.index ?? 0) - 1);
  return t('剩 {0} 页', { 0: rest });
});

const progressPercent = computed(() => {
  const percent = featured.value ? Number(featured.value.progress?.percent) : 0;
  return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
});
</script>

<style scoped>
.continue-card {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 292px;
  padding: 0;
  border: 0;
  border-radius: 32px;
  overflow: hidden;
  text-align: left;
  background: var(--md-surface-low);
  color: var(--md-on-surface);
  box-shadow: var(--md-elevation-card-soft);
  transition: transform 280ms var(--md-ease-emphasized), box-shadow 280ms var(--md-ease-emphasized);
}
.content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
  width: 69%;
  min-width: 0;
  padding: 28px 12px 28px 28px;
}
.eyebrow-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.section-icon { width: 20px; height: 20px; color: var(--md-on-surface-variant); }
.section-label { font-size: 12px; font-weight: 600; color: var(--md-on-surface-variant); }
.reading-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
  font-size: 11px;
  font-weight: 650;
}
.state-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.book-summary { display: flex; align-items: center; gap: 14px; min-width: 0; }
.cover-shell {
  display: grid;
  place-items: center;
  flex: 0 0 56px;
  width: 56px;
  height: 76px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}
.cover-image { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-fallback { display: grid; place-items: center; }
.cover-fallback :deep(svg) { width: 30px; height: 30px; }
.book-copy { display: flex; flex: 1; flex-direction: column; gap: 10px; min-width: 0; }
.book-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -.025em;
  line-height: 1.28;
  overflow-wrap: anywhere;
}
.book-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.format-chip, .count-chip {
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--md-surface-container);
  color: var(--md-on-surface-variant);
  font-size: 10px;
  font-weight: 600;
}
.reading-details { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; align-items: end; }
.detail-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.detail-label { color: var(--md-on-surface-variant); font-size: 11px; }
.detail-value { font-size: 28px; font-weight: 750; line-height: 1; font-variant-numeric: tabular-nums; }
.detail-value small { margin-left: 3px; font-size: 13px; font-weight: 600; }
.detail-position { font-size: 13px; font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.progress-track { position: relative; display: block; height: 16px; color: var(--md-reading-progress); }
.progress-track::before {
  position: absolute;
  top: 5px;
  left: calc(34% + 8px);
  right: 16px;
  height: 6px;
  border-radius: 999px;
  background: var(--md-outline-variant);
  content: '';
}
.progress-wave {
  position: absolute; inset: 0 auto 0 0; width: 34%; height: 16px;
  fill: none; stroke: currentColor; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round;
}
.progress-track::after { position: absolute; top: 4px; right: 0; width: 8px; height: 8px; border-radius: 50%; background: currentColor; content: ''; }
.action-panel { position: absolute; inset: 0 0 0 auto; width: 34%; }
.action-surface { position: absolute; inset: 0; width: 100%; height: 100%; fill: color-mix(in oklab, var(--md-primary-container) 54%, var(--md-surface-low)); }
.action-content { position: absolute; inset: 0 0 0 20px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 14px; }
.play { position: relative; display: grid; place-items: center; width: clamp(76px, 13vw, 124px); aspect-ratio: 1; color: var(--md-on-primary); }
.play-shape { position: absolute; inset: 0; width: 100%; height: 100%; fill: var(--md-primary); filter: drop-shadow(0 5px 8px color-mix(in oklab, var(--md-shadow-color-soft) 18%, transparent)); transition: transform 420ms var(--md-ease-spring); }
.play-icon { position: relative; width: 32px; height: 32px; transition: transform 420ms var(--md-ease-spring); }
.action-label { color: var(--md-on-primary-container); font-size: 11px; font-weight: 650; }
@media (hover: hover) and (pointer: fine) {
  .continue-card:hover { transform: translateY(-2px); box-shadow: var(--md-elevation-card-soft), var(--md-elevation-hover); }
  .continue-card:hover .play-shape { transform: rotate(12deg) scale(1.06); }
  .continue-card:hover .play-icon { transform: translateX(2px); }
}
.continue-card:active { transform: scale(.99); }
.continue-card:active .play-shape { transform: rotate(-8deg) scale(1.1, .92); }
@media (max-width: 599px) {
  .continue-card { min-height: 264px; border-radius: 28px; }
  .content { gap: 20px; width: 74%; padding: 20px 12px 20px 20px; }
  .section-label { display: none; }
  .book-summary { gap: 10px; }
  .cover-shell { flex-basis: 42px; width: 42px; height: 60px; border-radius: 10px; }
  .book-title { font-size: 17px; }
  .book-chips { gap: 4px; }
  .format-chip, .count-chip { padding: 3px 7px; }
  .reading-details { gap: 10px; grid-template-columns: 1fr 1.5fr; }
  .detail-value { font-size: 24px; }
  .detail-position { font-size: 12px; }
  .action-panel { width: 29%; }
  .action-content { left: 12px; gap: 10px; }
  .play { width: 68px; }
  .play-icon { width: 26px; height: 26px; }
  .action-label { font-size: 10px; }
}
@media (min-width: 768px) and (max-width: 899px) {
  .continue-card { grid-column: span 3; }
}
@media (prefers-reduced-motion: reduce) {
  .continue-card, .play-shape, .play-icon { transition: none; }
  .continue-card:is(:hover, :active), .continue-card:is(:hover, :active) .play-shape, .continue-card:is(:hover, :active) .play-icon { transform: none; }
}
</style>
