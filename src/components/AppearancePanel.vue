<template>
  <!-- 外观设置面板内容：主题色 + 表面（桌面浮层 / 手机底部 sheet 共用） -->
  <div v-if="mobileSheet">
    <p class="md-mobile-sheet-label">{{ t('表面 · {0}', { 0: modeLabel }) }}</p>
    <div class="md-mobile-sheet-card is-padded"><SurfaceModePreview /></div>
    <p class="md-mobile-sheet-label">{{ t('主题色 · {0}', { 0: themeLabel }) }}</p>
    <div class="md-mobile-sheet-card is-padded"><ThemeSwatchGrid /></div>
    <p class="md-mobile-sheet-hint px-3">{{ t('主题色会应用于按钮、选中项与界面细节。') }}</p>
  </div>
  <div v-else>
    <div class="py-3 border-t-[0.5px] border-[var(--md-outline-variant)]">
      <div class="flex items-baseline justify-between mb-3">
        <span class="text-[12px] font-semibold">{{ t('表面') }}</span>
        <b class="font-mono text-[12px] font-medium text-[var(--md-on-surface-variant)]">{{ modeLabel }}</b>
      </div>
      <SurfaceModePreview />
    </div>

    <div class="py-3 border-t-[0.5px] border-[var(--md-outline-variant)]">
      <div class="flex items-baseline justify-between mb-3">
        <span class="text-[12px] font-semibold">{{ t('主题色') }}</span>
        <b class="font-mono text-[12px] font-medium text-[var(--md-on-surface-variant)]">{{ t(themeLabel) }}</b>
      </div>
      <ThemeSwatchGrid />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { SURFACE_MODE_OPTIONS, THEME_OPTIONS, useThemeStore } from '../stores/theme.ts';
import SurfaceModePreview from './SurfaceModePreview.vue';
import ThemeSwatchGrid from './ThemeSwatchGrid.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const theme = useThemeStore();
defineProps({ mobileSheet: { type: Boolean, default: false } });

const modeLabel = computed(() => t((SURFACE_MODE_OPTIONS.find(option => option.value === theme.surfaceMode) || SURFACE_MODE_OPTIONS[0]).label));
const themeLabel = computed(() => t((THEME_OPTIONS.find(option => option.name === theme.themeColor) || THEME_OPTIONS[0]).title.replace(' (默认)', '')));
</script>
