<template>
  <!-- 信息与行动分区：整卡可点击，小封面保留书架到阅读器的共享元素锚点。 -->
  <button
    v-if="featured"
    type="button"
    class="md-card continue-card md-featured-cell"
    :data-book-id="featured.book.id"
    :title="started ? t('继续阅读：{0}', { 0: featured.book.title }) : t('开始阅读：{0}', { 0: featured.book.title })"
    :aria-label="started ? t('继续阅读：{0}', { 0: featured.book.title }) : t('开始阅读：{0}', { 0: featured.book.title })"
    aria-keyshortcuts="Shift+F10"
    @click="onOpen"
  >
    <span class="content">
      <span class="cover-shell" ref="coverEl" data-book-cover>
        <img v-if="featured.book.cover" :src="featured.book.cover" class="cover-image" alt="" loading="lazy" decoding="async" draggable="false" />
        <span v-else class="cover-fallback" aria-hidden="true"><MdIcon name="auto_stories" /></span>
      </span>

      <span class="book-heading">
        <span class="book-title">{{ featured.book.title }}</span>
        <span class="book-meta">
          <span>{{ typeLabel }}</span>
          <span v-if="featured.book.remote">{{ t('云端') }}</span>
          <span v-if="started">{{ lastReadLabel }}</span>
          <span v-else-if="totalPages">{{ totalPages }} {{ countUnit }}</span>
        </span>
      </span>

      <span class="reading-details">
        <span class="detail-value">{{ progressPercent }}<small>%</small></span>
        <span class="detail-position">
          <template v-if="started">{{ t('第 {0} / {1} 页', { 0: (featured.progress?.index ?? 0) + 1, 1: totalPages }) }}</template>
          <template v-else>{{ t('尚未开始') }}</template>
        </span>
      </span>

      <span class="progress-track" :class="{ 'is-complete': progressPercent === 100 }" :style="{ '--reading-progress': progressPercent + '%', '--reading-progress-gap': progressPercent > 0 ? '6px' : '0px' }" role="progressbar" :aria-label="t('阅读进度')" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="progressPercent">
        <span ref="progressRail" class="progress-rail" aria-hidden="true">
          <span class="progress-rest"></span>
          <svg v-if="progressPercent > 0" class="progress-active" focusable="false">
            <path :d="progressWavePath" :stroke-width="progressStrokeWidth" />
          </svg>
        </span>
      </span>
    </span>

    <span class="action-panel" aria-hidden="true">
      <svg class="action-surface" viewBox="0 0 240 400" preserveAspectRatio="none" focusable="false">
        <path d="M43 0H240V400H99C65 386 85 360 53 344C12 324 52 292 26 264C-7 228 28 200 17 169C3 132 39 112 25 80C12 48 57 35 43 0Z" />
      </svg>
      <span class="action-content">
        <span class="play">
          <svg class="play-shape" viewBox="0 0 100 100" focusable="false"><path d="M50.00 3.00 C51.49 3.00 53.10 3.72 54.46 4.68 C55.83 5.65 57.08 7.39 58.19 8.81 C59.31 10.23 60.17 12.02 61.17 13.19 C62.16 14.36 63.00 15.34 64.16 15.82 C65.32 16.30 66.60 16.20 68.13 16.08 C69.66 15.95 71.54 15.29 73.33 15.08 C75.13 14.87 77.24 14.52 78.89 14.80 C80.54 15.08 82.18 15.71 83.23 16.77 C84.29 17.82 84.92 19.46 85.20 21.11 C85.48 22.76 85.13 24.87 84.92 26.67 C84.71 28.46 84.05 30.34 83.92 31.87 C83.80 33.40 83.70 34.68 84.18 35.84 C84.66 37.00 85.64 37.84 86.81 38.83 C87.98 39.83 89.77 40.69 91.19 41.81 C92.61 42.92 94.35 44.17 95.32 45.54 C96.28 46.90 97.00 48.51 97.00 50.00 C97.00 51.49 96.28 53.10 95.32 54.46 C94.35 55.83 92.61 57.08 91.19 58.19 C89.77 59.31 87.98 60.17 86.81 61.17 C85.64 62.16 84.66 63.00 84.18 64.16 C83.70 65.32 83.80 66.60 83.92 68.13 C84.05 69.66 84.71 71.54 84.92 73.33 C85.13 75.13 85.48 77.24 85.20 78.89 C84.92 80.54 84.29 82.18 83.23 83.23 C82.18 84.29 80.54 84.92 78.89 85.20 C77.24 85.48 75.13 85.13 73.33 84.92 C71.54 84.71 69.66 84.05 68.13 83.92 C66.60 83.80 65.32 83.70 64.16 84.18 C63.00 84.66 62.16 85.64 61.17 86.81 C60.17 87.98 59.31 89.77 58.19 91.19 C57.08 92.61 55.83 94.35 54.46 95.32 C53.10 96.28 51.49 97.00 50.00 97.00 C48.51 97.00 46.90 96.28 45.54 95.32 C44.17 94.35 42.92 92.61 41.81 91.19 C40.69 89.77 39.83 87.98 38.83 86.81 C37.84 85.64 37.00 84.66 35.84 84.18 C34.68 83.70 33.40 83.80 31.87 83.92 C30.34 84.05 28.46 84.71 26.67 84.92 C24.87 85.13 22.76 85.48 21.11 85.20 C19.46 84.92 17.82 84.29 16.77 83.23 C15.71 82.18 15.08 80.54 14.80 78.89 C14.52 77.24 14.87 75.13 15.08 73.33 C15.29 71.54 15.95 69.66 16.08 68.13 C16.20 66.60 16.30 65.32 15.82 64.16 C15.34 63.00 14.36 62.16 13.19 61.17 C12.02 60.17 10.23 59.31 8.81 58.19 C7.39 57.08 5.65 55.83 4.68 54.46 C3.72 53.10 3.00 51.49 3.00 50.00 C3.00 48.51 3.72 46.90 4.68 45.54 C5.65 44.17 7.39 42.92 8.81 41.81 C10.23 40.69 12.02 39.83 13.19 38.83 C14.36 37.84 15.34 37.00 15.82 35.84 C16.30 34.68 16.20 33.40 16.08 31.87 C15.95 30.34 15.29 28.46 15.08 26.67 C14.87 24.87 14.52 22.76 14.80 21.11 C15.08 19.46 15.71 17.82 16.77 16.77 C17.82 15.71 19.46 15.08 21.11 14.80 C22.76 14.52 24.87 14.87 26.67 15.08 C28.46 15.29 30.34 15.95 31.87 16.08 C33.40 16.20 34.68 16.30 35.84 15.82 C37.00 15.34 37.84 14.36 38.83 13.19 C39.83 12.02 40.69 10.23 41.81 8.81 C42.92 7.39 44.17 5.65 45.54 4.68 C46.90 3.72 48.51 3.00 50.00 3.00Z" /></svg>
          <MdIcon name="play_arrow" filled class="play-icon" />
        </span>
        <span class="action-label">{{ started ? t('继续阅读') : t('开始阅读') }}</span>
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, type PropType } from 'vue';
import { useShelfStore } from '../stores/shelf.ts';
import { resolveBookFormat } from '../services/utils.ts';
import MdIcon from './MdIcon.vue';

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

const coverEl = shallowRef<HTMLElement | null>(null);

function onOpen() {
  if (featured.value) emit('open', featured.value.book.id, coverEl.value);
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

const lastReadLabel = computed(() => clockText.value ? t('上次 {0}', { 0: clockText.value }) : t('上次阅读'));

const progressPercent = computed(() => {
  const percent = featured.value ? Number(featured.value.progress?.percent) : 0;
  return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
});

const progressRail = shallowRef<HTMLElement | null>(null);
const progressRailWidth = ref(0);
watch(progressRail, (rail, _, onCleanup) => {
  progressRailWidth.value = rail?.clientWidth ?? 0;
  if (!rail || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(([entry]) => {
    progressRailWidth.value = entry.contentRect.width;
  });
  observer.observe(rail);
  onCleanup(() => observer.disconnect());
});

const progressLength = computed(() => progressRailWidth.value * progressPercent.value / 100);
const progressStrokeWidth = computed(() => Math.min(4, progressLength.value));
const progressWavePath = computed(() => {
  const radius = progressStrokeWidth.value / 2;
  const length = progressLength.value - 2 * radius;
  const start = `M ${radius} 10`;
  if (length <= 16) return `${start} h ${length}`;

  // 每段绘制完整波形，圆头与灰轨始终落在同一条中线上。
  const cycles = Math.max(1, Math.round(length / 32));
  const quarter = length / cycles / 4;
  const handle = quarter * 0.5;
  const amplitude = Math.min(2.5, (length - 16) / 6);
  const wave = ` c ${handle} 0 ${handle} ${-amplitude} ${quarter} ${-amplitude}`
    + ` s ${handle} ${amplitude} ${quarter} ${amplitude}`
    + ` s ${handle} ${amplitude} ${quarter} ${amplitude}`
    + ` s ${handle} ${-amplitude} ${quarter} ${-amplitude}`;
  return start + wave.repeat(cycles);
});
</script>

<style scoped>
.continue-card {
  position: relative;
  container: continue-reading / inline-size;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 184px;
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
  display: grid;
  grid-template-columns: clamp(64px, 17cqi, 96px) minmax(0, 1fr);
  grid-template-areas:
    "cover heading"
    "cover details"
    "cover progress";
  align-content: center;
  gap: 8px clamp(12px, 3cqi, 20px);
  width: 74%;
  min-width: 0;
  padding: 24px 16px 24px clamp(16px, 4cqi, 28px);
}
.cover-shell {
  grid-area: cover;
  align-self: center;
  display: grid;
  place-items: center;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 12px;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}
.cover-image { display: block; width: 100%; height: 100%; object-fit: cover; }
.cover-fallback { display: grid; width: 100%; place-items: center; }
.cover-fallback :deep(svg) { width: clamp(28px, 42%, 44px); height: auto; }
.book-heading { grid-area: heading; align-self: end; min-width: 0; }
.book-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: clamp(17px, 3.65cqi, 22px);
  font-weight: 700;
  letter-spacing: -.025em;
  line-height: 1.3;
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.book-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin-top: 6px;
  color: var(--md-on-surface-variant);
  font-size: 12px;
}
.reading-details {
  grid-area: details;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.detail-value { font-size: clamp(17px, 3.65cqi, 22px); font-weight: 700; line-height: 1; }
.detail-value small { margin-left: 2px; font-size: 12px; font-weight: 600; }
.detail-position { font-size: 12px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.progress-track { grid-area: progress; position: relative; display: block; height: 20px; color: var(--md-reading-progress); }
.progress-rail { position: absolute; inset: 0 12px 0 0; }
.progress-rest {
  position: absolute;
  top: 8px;
  left: min(100%, calc(var(--reading-progress) + var(--reading-progress-gap)));
  right: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--md-outline-variant);
}
.progress-active {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
}
.progress-track::after { position: absolute; top: 7px; right: 0; width: 6px; height: 6px; border-radius: 50%; background: currentColor; content: ''; }
.action-panel { position: absolute; inset: 0 0 0 auto; width: 28%; }
.action-surface { position: absolute; inset: 0; width: 100%; height: 100%; fill: color-mix(in oklab, var(--md-primary-container) 54%, var(--md-surface-low)); }
.action-content { position: absolute; inset: 0 8px 0 14px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; }
.play { position: relative; display: grid; place-items: center; width: clamp(48px, 65%, 72px); aspect-ratio: 1; color: var(--md-on-primary); }
.play-shape { position: absolute; inset: 0; width: 100%; height: 100%; fill: var(--md-primary); filter: drop-shadow(0 5px 8px color-mix(in oklab, var(--md-shadow-color-soft) 18%, transparent)); transition: transform 420ms var(--md-ease-spring); }
.play-icon { position: relative; width: 32px; height: 32px; transition: transform 420ms var(--md-ease-spring); }
.action-label { color: var(--md-on-primary-container); font-size: 12px; font-weight: 650; text-align: center; }
@media (hover: hover) and (pointer: fine) {
  .continue-card:hover { box-shadow: var(--md-elevation-card-soft), var(--md-elevation-hover); }
  .continue-card:hover .play-shape { transform: rotate(12deg) scale(1.06); }
  .continue-card:hover .play-icon { transform: translateX(2px); }
}
.continue-card:active { transform: scale(.99); }
.continue-card:active .play-shape { transform: rotate(-8deg) scale(1.1, .92); }
@media (max-width: 599px) {
  .continue-card { border-radius: 28px; }
}
@media (min-width: 768px) {
  /* 同排书卡决定行高，特色卡随网格拉伸。 */
  .continue-card { min-height: 0; align-self: stretch; }
  .continue-card:not(:has(+ .md-shelf-card)) { min-height: 188px; }
  .content { position: absolute; inset: 0 auto 0 0; }
}
@container continue-reading (max-width: 520px) {
  .content {
    grid-template-columns: clamp(52px, 15cqi, 72px) minmax(0, 1fr);
    grid-template-areas:
      "cover heading"
      "details details"
      "progress progress";
    column-gap: 12px;
    row-gap: 8px;
    padding: 20px 16px;
  }
  .book-heading { align-self: center; }
  .cover-shell { border-radius: 10px; }
  .reading-details { margin-top: 4px; }
  .action-content { left: 8px; }
  .play-icon { width: 24px; height: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .continue-card, .play-shape, .play-icon { transition: none; }
  .continue-card:is(:hover, :active), .continue-card:is(:hover, :active) .play-shape, .continue-card:is(:hover, :active) .play-icon { transform: none; }
}
</style>
