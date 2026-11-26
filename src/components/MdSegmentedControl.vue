<template>
  <div
    class="md-segmented"
    :class="{ 'has-selection': activeIndex >= 0, 'has-many-options': options.length >= 3, 'is-disabled': disabled }"
    role="group"
    :aria-label="ariaLabel ? t(ariaLabel) : undefined"
    :aria-disabled="disabled || undefined"
    :style="{
      '--md-segment-count': Math.max(1, options.length),
      '--md-segment-index': Math.max(0, activeIndex)
    }"
  >
    <span class="md-segmented-thumb" aria-hidden="true"></span>
    <MdIconButton
      v-for="option in options"
      :key="option.value"
      type="button"
      class="md-segmented-option"
      :class="{ 'is-selected': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :title="option.title ? t(option.title) : undefined"
      :disabled="disabled"
      @click="select(option.value, $event)"
    >
      <template v-if="option.icon" #default>
        <MdIcon :name="option.icon" :size="16" />
      </template>
      <template #label>
        <span>{{ t(option.label) }}</span>
      </template>
    </MdIconButton>
  </div>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import MdIcon from './MdIcon.vue';
import MdIconButton from './MdIconButton.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array as PropType<ReadonlyArray<{ value: string | number; label: string; title?: string; icon?: string }>>, required: true },
  ariaLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);

const activeIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));

function select(value: string | number, event: MouseEvent) {
  if (props.disabled || value === props.modelValue) return;
  const rect = (event?.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
  const origin = rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : null;
  emit('update:modelValue', value, origin);
}
</script>

<style scoped>
.md-segmented {
  position: relative;
  display: flex;
  align-items: center;
  padding: 3px;
  border-radius: 20px;
  background-color: var(--md-segmented-bg, var(--md-surface-high));
  isolation: isolate;
}

.md-segmented-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  z-index: 0;
  width: calc((100% - 6px) / var(--md-segment-count, 1));
  border-radius: 17px;
  background-color: var(--md-segmented-selected-bg, var(--md-primary));
  opacity: 0;
  transform: translate3d(calc(var(--md-segment-index, 0) * 100%), 0, 0);
  /* 胶囊整格位移：强调减速 + 轻微过冲，落位时收得住又带一点弹性 */
  transition:
    transform var(--md-duration-medium, 280ms) var(--md-ease-expressive, cubic-bezier(0.22, 1.2, 0.36, 1)),
    opacity var(--md-duration-short, 200ms) var(--md-ease-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1));
  will-change: transform;
}

.md-segmented.has-selection .md-segmented-thumb {
  opacity: 1;
}

.md-segmented.is-disabled {
  opacity: 0.55;
}

.md-segmented.is-disabled .md-segmented-option {
  cursor: default;
}

.md-segmented-option {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  flex: 1 1 0;
  padding: 7px 8px;
  border-radius: 17px;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  /* 文字换色比滑块略快，避免「字还没变色胶囊已经到了」 */
  transition:
    color var(--md-duration-short, 200ms) var(--md-ease-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1)),
    background-color var(--md-duration-short, 200ms) var(--md-ease-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1));
}

.md-segmented-option.is-selected {
  color: var(--md-segmented-selected-color, var(--md-on-primary));
}

.md-segmented-option :deep(.md-icon-button-face) {
  width: auto;
  height: auto;
  flex: none;
}

@media (hover: hover) and (pointer: fine) {
  .md-segmented-option:not(.is-selected):hover {
    color: var(--md-on-surface);
    background-color: color-mix(in oklab, var(--md-on-surface) 6%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .md-segmented-thumb,
  .md-segmented-option {
    transition: none;
  }
}

/* 手机窄屏下三项以上的分段控件优先保证文字完整，图标只在空间充足时显示。 */
@media (max-width: 480px) {
  .md-segmented.has-many-options .md-segmented-option :deep(.md-icon-button-face) {
    display: none;
  }
}
</style>
