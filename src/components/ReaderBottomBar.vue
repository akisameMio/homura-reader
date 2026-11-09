<template>
  <!-- 阅读器底部：悬浮进度条（页码 / 百分比 / 滑条），单双页在排版面板里选 -->
  <footer class="md-reader-bottombar" aria-label="阅读进度与翻页">
    <button
      type="button"
      @click="reader.onLeftButtonClick()"
      class="md-icon-button md-hit-target"
      :title="leftText"
      :aria-label="leftText"
      :disabled="reader.openingBook"
    >
      <MdIcon name="chevron_left" />
    </button>

    <div class="md-reader-scrub">
      <div class="md-reader-scrub-meta">
        <span class="md-reader-scrub-pages">{{ reader.pageIndicator }}</span>
        <span class="md-reader-scrub-percent">{{ percentText }}</span>
      </div>
      <MdRange
        :model-value="reader.sliderValue"
        :min="0"
        :max="Math.max(0, reader.activePages.length - 1)"
        :rtl="inverted"
        title="拖动跳转"
        aria-label="阅读进度"
        :aria-valuetext="`${reader.pageIndicator}，${percentText}`"
        :disabled="reader.openingBook"
        class="w-full min-w-0"
        @update:model-value="reader.onSliderInput"
      />
    </div>

    <button
      type="button"
      @click="reader.onRightButtonClick()"
      class="md-icon-button md-hit-target"
      :title="rightText"
      :aria-label="rightText"
      :disabled="reader.openingBook"
    >
      <MdIcon name="chevron_right" />
    </button>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import MdIcon from './MdIcon.vue';
import MdRange from './MdRange.vue';

const reader = useReaderStore();
const config = reader.layoutConfig;

const inverted = computed(() => config.direction === 'rtl' && config.rtlInvertButtons);
const isVertical = computed(() => config.direction === 'vertical');

const leftText = computed(() => {
  if (inverted.value && reader.atLastPage && reader.nextCollectionBook) return '下一本';
  if (!inverted.value && reader.atFirstPage && reader.previousCollectionBook) return '上一本';
  if (isVertical.value) return '上滚一屏';
  if (config.direction === 'rtl') return inverted.value ? '下一页' : '上一页';
  return '上一页';
});

const rightText = computed(() => {
  if (!inverted.value && reader.atLastPage && reader.nextCollectionBook) return '下一本';
  if (inverted.value && reader.atFirstPage && reader.previousCollectionBook) return '上一本';
  if (isVertical.value) return '下滚一屏';
  if (config.direction === 'rtl') return inverted.value ? '上一页' : '下一页';
  return '下一页';
});

const percentText = computed(() => {
  const total = reader.activePages.length;
  if (!total) return '0%';
  return Math.round(((reader.currentIndex + 1) / total) * 100) + '%';
});
</script>
