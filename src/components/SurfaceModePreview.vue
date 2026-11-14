<template>
  <div class="surface-mode-preview" :class="{ 'is-cards': cards && isReader }" role="group" :aria-label="isReader ? t('阅读模式') : t('表面')">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="surface-mode-option"
      :class="{ 'is-selected': selectedValue === option.value, 'is-follow': option.value === 'settings' }"
      :title="t(option.title)"
      :aria-label="`${t(option.label)}: ${t(option.note)}`"
      :aria-pressed="selectedValue === option.value"
      @click="selectMode(option.value, $event)"
    >
      <span
        class="surface-mode-card"
        :class="{ 'is-selected': selectedValue === option.value }"
        :data-theme="previewTheme(option)"
        :data-mode="previewMode(option)"
      >
        <span class="surface-mode-sheet" :class="sheetClass(option)" aria-hidden="true">
          <template v-if="cards && isReader">
            <b class="surface-mode-sample-title">{{ t('阅读时光') }}</b>
            <span class="surface-mode-sample-lines"><i></i><i></i></span>
          </template>
          <template v-else>
            <span class="surface-mode-palette"><i></i><i></i><i></i></span>
            <span class="surface-mode-copy-block"><i></i><i></i><i></i></span>
            <span class="surface-mode-footer"><i></i><i></i></span>
            <span v-if="isReader && option.value === 'settings'" class="surface-mode-badge">{{ t('跟随') }}</span>
          </template>
        </span>
        <span v-if="selectedValue === option.value && !(cards && isReader)" class="surface-mode-check" aria-hidden="true">
          <MdIcon name="check" />
        </span>
      </span>

      <span v-if="cards && isReader && selectedValue === option.value" class="surface-mode-check" aria-hidden="true"><MdIcon name="check" /></span>

      <span class="surface-mode-meta">
        <span class="surface-mode-icon" aria-hidden="true">
          <MdIcon :name="option.icon" />
        </span>
        <span class="surface-mode-note">{{ t(option.label) }}</span>
        <span v-if="cards && isReader" class="surface-mode-description">{{ option.value === 'settings' ? t('沿用应用的外观与主题设置') : t(option.note) }}</span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  READER_SURFACE_MODE_OPTIONS,
  SURFACE_MODE_OPTIONS,
  useThemeStore
} from '../stores/theme.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

type PreviewOption = {
  value: string;
  label: string;
  note: string;
  title: string;
  icon: string;
  theme?: string;
};

const props = defineProps({
  surface: { type: String, default: 'appearance' },
  cards: { type: Boolean, default: false }
});

const theme = useThemeStore();
const isReader = computed(() => props.surface === 'reader');
const options = computed<PreviewOption[]>(() => (
  isReader.value ? READER_SURFACE_MODE_OPTIONS : SURFACE_MODE_OPTIONS
) as PreviewOption[]);
const selectedValue = computed(() => (isReader.value ? theme.readerSurfaceMode : theme.surfaceMode));

function previewMode(option: PreviewOption) {
  if (isReader.value) {
    return option.value === 'settings' ? theme.effectiveSurfaceMode : 'light';
  }
  return option.value === 'auto' ? 'light' : option.value;
}

function previewTheme(option: PreviewOption) {
  return option.theme || theme.themeColor;
}

function sheetClass(option: PreviewOption) {
  if (!isReader.value && option.value === 'auto') return 'is-auto-split';
  if (isReader.value && option.value === 'parchment') return 'is-preview-parchment';
  if (isReader.value && option.value === 'green') return 'is-preview-green';
  return '';
}

function selectMode(mode: string, event: MouseEvent) {
  if (isReader.value) {
    if (mode !== theme.readerSurfaceMode) theme.setReaderSurfaceMode(mode);
    return;
  }
  if (mode === theme.surfaceMode) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  theme.setSurfaceMode(mode, false, {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  });
}
</script>

<style scoped>
.surface-mode-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 280px;
  margin-inline: auto;
}

.surface-mode-option {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--md-on-surface);
  text-align: left;
  cursor: pointer;
}

.surface-mode-card {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 0.72;
  padding: 5px;
  overflow: hidden;
  border: 0.5px solid color-mix(in oklab, var(--md-outline-variant) 72%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, var(--md-surface-container) 84%, transparent);
  box-shadow: 0 10px 22px -18px color-mix(in oklab, var(--md-shadow-color-soft) 32%, transparent);
  transition:
    transform var(--md-duration-short) var(--md-ease-emphasized),
    box-shadow var(--md-duration-short) var(--md-ease-emphasized),
    border-color var(--md-duration-short) var(--md-ease-emphasized);
}

.surface-mode-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--md-surface);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 58%, transparent);
}

.surface-mode-sheet.is-auto-split {
  background: linear-gradient(
    135deg,
    var(--md-canvas-light) 0 49.4%,
    var(--md-canvas-dark) 50.6% 100%
  );
}

.surface-mode-sheet.is-preview-parchment {
  background: var(--md-parchment-paper);
}

.surface-mode-sheet.is-preview-green {
  background: var(--md-reader-green-paper);
}

.surface-mode-palette {
  display: grid;
  grid-template-columns: 1.15fr 0.88fr 1.1fr;
  height: 27px;
  overflow: hidden;
  border-radius: 7px;
}

.surface-mode-palette i:nth-child(1) {
  background: var(--md-primary);
}

.surface-mode-palette i:nth-child(2) {
  background: var(--md-tertiary);
}

.surface-mode-palette i:nth-child(3) {
  background: var(--md-secondary);
}

.surface-mode-copy-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 13px;
}

.surface-mode-copy-block i {
  display: block;
  height: 5px;
  border-radius: 999px;
}

.surface-mode-copy-block i:nth-child(1) {
  width: 67%;
  background: var(--md-primary-container);
}

.surface-mode-copy-block i:nth-child(2) {
  width: 49%;
  background: var(--md-secondary-container);
}

.surface-mode-copy-block i:nth-child(3) {
  width: 84%;
  margin-top: 7px;
  background: var(--md-tertiary-container);
}

.surface-mode-footer {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
}

.surface-mode-footer i:first-child {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  border-radius: 50%;
  background: var(--md-primary);
}

.surface-mode-footer i:last-child {
  height: 17px;
  flex: 1;
  border-radius: 999px;
  background: var(--md-primary-container);
}

.surface-mode-check {
  position: absolute;
  top: 7px;
  right: 7px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
  box-shadow: 0 1px 4px color-mix(in oklab, var(--md-shadow-color-soft) 20%, transparent);
}

.surface-mode-check svg {
  width: 10px;
  height: 10px;
}

.surface-mode-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 5px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--md-surface-container) 82%, transparent);
  color: var(--md-on-surface-variant);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 7px;
  letter-spacing: 0.04em;
}

.surface-mode-card.is-selected {
  border-color: var(--md-primary);
  box-shadow:
    0 0 0 1.5px var(--md-primary),
    0 12px 24px -18px color-mix(in oklab, var(--md-primary) 56%, transparent);
}

.surface-mode-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  margin-top: 8px;
  padding-inline: 2px;
}

.surface-mode-icon {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--md-on-surface);
}

.surface-mode-icon svg {
  display: block;
  width: 16px;
  height: 16px;
}

.surface-mode-option.is-selected .surface-mode-icon {
  color: var(--md-primary);
}

.surface-mode-note {
  min-width: 0;
  overflow: hidden;
  color: var(--md-on-surface-variant);
  font-size: 8px;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.surface-mode-option:focus-visible {
  outline: none;
}

.surface-mode-option:focus-visible .surface-mode-card {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .surface-mode-option:hover .surface-mode-card {
    transform: translateY(-2px);
    box-shadow: 0 16px 26px -20px color-mix(in oklab, var(--md-shadow-color-soft) 38%, transparent);
  }

  .surface-mode-option.is-selected:hover .surface-mode-card {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .surface-mode-card {
    transition: none;
  }

  .surface-mode-option:hover .surface-mode-card {
    transform: none;
  }
}

.surface-mode-preview.is-cards {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: none;
}
.is-cards .surface-mode-option {
  position: relative;
  padding: 12px;
  border: 2px solid transparent;
  border-radius: 26px;
  background: var(--md-surface);
}
.is-cards .surface-mode-option.is-selected { border-color: var(--md-primary); }
.is-cards .surface-mode-card {
  height: 92px;
  aspect-ratio: auto;
  padding: 0;
  border: 0;
  border-radius: 16px;
  box-shadow: none;
  background: var(--md-surface-low);
  transform: none;
}
.is-cards .surface-mode-option:hover .surface-mode-card { transform: none; box-shadow: none; }
.is-cards .surface-mode-sheet {
  justify-content: center;
  gap: 10px;
  padding: 16px;
  border-radius: inherit;
  box-shadow: none;
  color: var(--md-on-surface-variant);
}
.is-cards .is-preview-parchment { color: var(--md-parchment-ink-soft); }
.is-cards .is-preview-green { color: var(--md-reader-green-ink-soft); }
.surface-mode-sample-title { font-family: 'Songti SC', serif; font-size: 17px; font-weight: 500; }
.surface-mode-sample-lines { display: grid; gap: 6px; }
.surface-mode-sample-lines i {
  display: block;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.3;
}
.surface-mode-sample-lines i:last-child { width: 65%; }
.is-cards .surface-mode-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-top: 12px;
}
.is-cards .surface-mode-icon { display: none; }
.is-cards .surface-mode-note { font-size: 13px; font-weight: 600; color: var(--md-on-surface); }
.surface-mode-description { font-size: 10px; line-height: 1.6; color: var(--md-on-surface-variant); }
.is-cards .surface-mode-check {
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  background: var(--md-primary);
  color: var(--md-on-primary);
  box-shadow: none;
}
.is-cards .surface-mode-option.is-follow {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 92px;
  padding: 12px 16px;
}
.is-cards .is-follow .surface-mode-card { width: 76px; height: 66px; flex: none; }
.is-cards .is-follow .surface-mode-sheet { padding: 10px; gap: 7px; }
.is-cards .is-follow .surface-mode-sample-title { font-size: 12px; }
.is-cards .is-follow .surface-mode-meta { min-width: 0; margin-top: 0; padding-right: 10px; }
.is-cards .is-follow .surface-mode-note { white-space: normal; }
.is-cards .surface-mode-option:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
.is-cards .surface-mode-option:focus-visible .surface-mode-card { outline: none; }
</style>
