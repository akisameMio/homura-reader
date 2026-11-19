<template>
  <div>
    <p class="md-mobile-sheet-label">{{ t('表面 · {0}', { 0: modeLabel }) }}</p>
    <div class="md-mobile-sheet-card is-padded"><SurfaceModePreview /></div>
    <p class="md-mobile-sheet-label">{{ t('主题色 · {0}', { 0: themeLabel }) }}</p>
    <div class="md-mobile-sheet-card is-padded"><ThemeSwatchGrid /></div>
    <p class="md-mobile-sheet-hint px-3">{{ t('主题色会应用于按钮、选中项与界面细节。') }}</p>
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

const modeLabel = computed(() => t((SURFACE_MODE_OPTIONS.find(option => option.value === theme.surfaceMode) || SURFACE_MODE_OPTIONS[0]).label));
const themeLabel = computed(() => t((THEME_OPTIONS.find(option => option.name === theme.themeColor) || THEME_OPTIONS[0]).title.replace(' (默认)', '')));
</script>
