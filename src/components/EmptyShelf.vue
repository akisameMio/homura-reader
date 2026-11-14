<template>
  <!-- 空书架引导 -->
  <section class="flex-1 flex items-center justify-center px-4 py-10 sm:py-16">
    <div class="w-full max-w-md rounded-[16px] bg-[var(--md-surface-container)] border-[0.5px] border-dashed border-[var(--md-outline-variant)] px-5 sm:px-8 py-8 sm:py-10 flex flex-col items-center text-center gap-4">
      <img
        :src="logoUrl"
        alt="HOMURA"
        class="w-14 h-14 shrink-0 select-none pointer-events-none"
        draggable="false"
      />
      <div class="space-y-1.5">
        <h2 class="text-base font-display font-bold tracking-tight">{{ t('书架还是空的') }}</h2>
        <p class="text-xs text-[var(--md-on-surface-variant)] leading-relaxed">{{ isPhone ? t('选择本地文件或文件夹导入作品') : t('把文件拖进窗口，或直接选择本地文件 / 文件夹') }}</p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-1.5 font-mono text-[12px]">
        <span class="px-2 py-0.5 rounded-md bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] border-[0.5px] border-[var(--md-outline-variant)] font-semibold">.EPUB</span>
        <span class="px-2 py-0.5 rounded-md bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] border-[0.5px] border-[var(--md-outline-variant)] font-semibold">.CBZ / .ZIP</span>
        <span class="px-2 py-0.5 rounded-md bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] border-[0.5px] border-[var(--md-outline-variant)] font-semibold">.PDF</span>
        <span class="px-2 py-0.5 rounded-md bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] border-[0.5px] border-[var(--md-outline-variant)] font-semibold">.TXT / .MD</span>
        <span class="px-2 py-0.5 rounded-md bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] border-[0.5px] border-[var(--md-outline-variant)] font-semibold">.MOBI</span>
        <span class="px-2 py-0.5 rounded-md bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] border-[0.5px] border-[var(--md-outline-variant)] font-semibold">{{ t('图片文件夹') }}</span>
      </div>
      <div v-if="!isCompact" class="flex items-center gap-2.5 pt-1">
        <button @click="$emit('pick-file')" class="uiverse-btn-primary">{{ t('选择文件') }}</button>
        <button @click="$emit('pick-folder')" class="uiverse-btn">{{ t('选择文件夹') }}</button>
      </div>
      <p v-else class="text-[12px] font-medium text-[var(--md-on-surface-variant)] pt-1">
        {{ t('使用右下角「导入」选择本地文件或文件夹') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useViewport } from '../composables/useViewport.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const logoUrl = import.meta.env.BASE_URL + 'favicon.png';

const { isPhone, isCompact } = useViewport();

defineEmits(['pick-file', 'pick-folder']);
</script>
