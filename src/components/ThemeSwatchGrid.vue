<template>
  <div
    class="theme-swatch-grid"
    :class="{ 'is-wide': wide, 'has-labels': labels && !strip, 'is-strip': strip }"
    :style="{ '--swatch-columns': columns }"
    role="group"
    aria-label="主题色"
  >
    <button
      v-for="option in THEME_OPTIONS"
      :key="option.name"
      type="button"
      class="theme-swatch-tile"
      :class="{ 'is-selected': theme.themeColor === option.name }"
      :title="option.title"
      :aria-label="option.title"
      :aria-pressed="theme.themeColor === option.name"
      @click="theme.setThemeColor(option.name)"
    >
      <span class="theme-swatch-disc" :style="swatchStyle(option)" aria-hidden="true"></span>
      <span v-if="theme.themeColor === option.name" class="theme-swatch-check" aria-hidden="true">
        <MdIcon name="check" />
      </span>
      <span v-if="labels && !strip" class="theme-swatch-label">{{ option.title.replace(' (默认)', '') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { THEME_OPTIONS, useThemeStore } from '../stores/theme.ts';
import MdIcon from './MdIcon.vue';

defineProps({
  columns: { type: Number, default: 5 },
  wide: { type: Boolean, default: false },
  labels: { type: Boolean, default: false },
  strip: { type: Boolean, default: false }
});

const theme = useThemeStore();

type ThemeOption = (typeof THEME_OPTIONS)[number];

function swatchStyle(option: ThemeOption) {
  const [light, base, deep] = option.tones;
  return {
    '--swatch-light': light,
    '--swatch-base': base,
    '--swatch-deep': deep
  };
}
</script>

<style scoped>
.theme-swatch-grid.is-strip {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 8px;
  max-width: none;
  padding: 8px 4px;
}

.is-strip .theme-swatch-tile {
  width: min(100%, 56px);
  height: 56px;
  justify-self: center;
  aspect-ratio: auto;
  border-radius: 50%;
}

.is-strip .theme-swatch-disc {
  width: 40px;
  background: var(--swatch-deep);
  box-shadow: none;
}

.is-strip .is-selected .theme-swatch-disc {
  background: var(--md-primary);
  outline: 2px solid var(--md-primary);
  outline-offset: 4px;
}

.is-strip .theme-swatch-check {
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--md-on-primary);
  box-shadow: none;
}

.is-strip .theme-swatch-check svg {
  width: 24px;
  height: 24px;
}

@container theme-palette (max-width: 639px) {
  .theme-swatch-grid.is-strip {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

.theme-swatch-grid.has-labels .theme-swatch-tile {
  aspect-ratio: auto;
  min-height: 66px;
  grid-template-rows: 44px auto;
  gap: 6px;
}

.has-labels .theme-swatch-check {
  top: 14px;
}

.theme-swatch-label {
  color: var(--md-on-surface-variant);
  font-size: 10px;
  white-space: nowrap;
}

.theme-swatch-grid.is-wide {
  grid-template-columns: repeat(var(--swatch-columns, 10), minmax(0, 1fr));
  gap: 8px;
  max-width: none;
}

.theme-swatch-grid.is-wide .theme-swatch-tile {
  min-height: 44px;
  aspect-ratio: auto;
}

.theme-swatch-grid.is-wide .theme-swatch-disc {
  width: 32px;
}
</style>
