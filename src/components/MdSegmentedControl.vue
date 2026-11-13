<template>
  <div
    class="md-segmented"
    :class="{ 'has-selection': activeIndex >= 0, 'has-many-options': options.length >= 3, 'is-disabled': disabled }"
    role="group"
    :aria-label="ariaLabel || undefined"
    :aria-disabled="disabled || undefined"
    :style="{
      '--md-segment-count': Math.max(1, options.length),
      '--md-segment-index': Math.max(0, activeIndex)
    }"
  >
    <span class="md-segmented-thumb" aria-hidden="true"></span>
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="md-segmented-option md-hit-target"
      :class="{
        'is-selected': option.value === modelValue,
        'is-animating': option.value === animatedIconValue,
        [`icon-${option.icon}`]: Boolean(option.icon)
      }"
      :aria-pressed="option.value === modelValue"
      :title="option.title || undefined"
      :disabled="disabled"
      @click="select(option.value, $event)"
    >
      <MdIcon
        v-if="option.icon"
        :key="animatedIconValue === option.value ? `clicked-${iconAnimationKey}` : `idle-${option.value}`"
        :name="option.icon"
        :size="16"
      />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, type PropType } from 'vue';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array as PropType<ReadonlyArray<{ value: string | number; label: string; title?: string; icon?: string }>>, required: true },
  ariaLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);

const activeIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const animatedIconValue = ref<string | number | null>(null);
const iconAnimationKey = ref(0);

async function select(value: string | number, event: MouseEvent) {
  if (props.disabled) return;
  const rect = (event?.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
  const origin = rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : null;
  if (value !== props.modelValue) emit('update:modelValue', value, origin);
  await nextTick();
  animatedIconValue.value = value;
  iconAnimationKey.value += 1;
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
  background-color: var(--md-primary);
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
    background-color var(--md-duration-short, 200ms) var(--md-ease-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1)),
    opacity var(--md-duration-short, 200ms) var(--md-ease-emphasized, cubic-bezier(0.2, 0, 0, 1));
}

.md-segmented-option.is-selected {
  color: var(--md-on-primary);
}

.md-segmented-option.is-animating :deep(.md3-icon) {
  transform-box: fill-box;
  transform-origin: center;
  animation: md-segment-icon-enter 680ms cubic-bezier(0.18, 0.75, 0.25, 1) both;
}

.md-segmented-option.is-animating.icon-chevron_right :deep(.md3-icon) {
  animation-name: md-segment-icon-slide-right;
}

.md-segmented-option.is-animating.icon-chevron_left :deep(.md3-icon) {
  animation-name: md-segment-icon-slide-left;
}

.md-segmented-option.is-animating.icon-auto_stories :deep(.md3-icon) {
  animation-name: md-segment-icon-open-book;
}

.md-segmented-option.is-animating.icon-article :deep(.md3-icon) {
  animation-name: md-segment-icon-page-turn;
}

.md-segmented-option.is-animating.icon-light_mode :deep(.md3-icon) {
  animation-name: md-segment-icon-sunrise;
}

.md-segmented-option.is-animating.icon-dark_mode :deep(.md3-icon) {
  animation-name: md-segment-icon-moon;
}

.md-segmented-option.is-animating.icon-contrast :deep(.md3-icon) {
  animation-name: md-segment-icon-contrast;
}

.md-segmented-option.is-animating.icon-expand_more :deep(.md3-icon) {
  animation-name: md-segment-icon-scroll;
}

.md-segmented-option.is-animating.icon-radio_button_unchecked :deep(.md3-icon) {
  animation-name: md-segment-icon-pulse;
}

.md-segmented-option:active {
  opacity: 0.72;
}

@media (hover: hover) and (pointer: fine) {
  .md-segmented-option:not(.is-selected):hover {
    color: var(--md-on-surface);
    background-color: color-mix(in oklab, var(--md-on-surface) 6%, transparent);
  }

  .md-segmented-option:hover :deep(.md3-icon) {
    transform: translateY(-1px);
  }
}

@keyframes md-segment-icon-enter {
  0% { opacity: 0.45; transform: translateY(4px) scale(0.58) rotate(-18deg); }
  32% { opacity: 1; transform: translateY(-2px) scale(1.2) rotate(7deg); }
  54% { transform: translateY(1px) scale(0.9) rotate(-4deg); }
  76% { transform: translateY(-1px) scale(1.08) rotate(2deg); }
  100% { opacity: 1; transform: translateY(0) scale(1) rotate(0); }
}

@keyframes md-segment-icon-slide-right {
  0% { opacity: 0.45; transform: translateX(-9px) scale(0.62) rotate(-22deg); }
  34% { opacity: 1; transform: translateX(4px) scale(1.2) rotate(9deg); }
  56% { transform: translateX(-2px) scale(0.9) rotate(-4deg); }
  78% { transform: translateX(1px) scale(1.08) rotate(2deg); }
  100% { opacity: 1; transform: translateX(0) scale(1) rotate(0); }
}

@keyframes md-segment-icon-slide-left {
  0% { opacity: 0.45; transform: translateX(9px) scale(0.62) rotate(22deg); }
  34% { opacity: 1; transform: translateX(-4px) scale(1.2) rotate(-9deg); }
  56% { transform: translateX(2px) scale(0.9) rotate(4deg); }
  78% { transform: translateX(-1px) scale(1.08) rotate(-2deg); }
  100% { opacity: 1; transform: translateX(0) scale(1) rotate(0); }
}

@keyframes md-segment-icon-open-book {
  0% { opacity: 0.45; transform: perspective(70px) rotateY(-38deg) scaleX(0.62) scaleY(0.82); }
  30% { opacity: 1; transform: perspective(70px) rotateY(12deg) scaleX(1.16) scaleY(1.08); }
  52% { transform: perspective(70px) rotateY(-6deg) scaleX(0.94) scaleY(0.96); }
  76% { transform: perspective(70px) rotateY(3deg) scaleX(1.04) scaleY(1.02); }
  100% { opacity: 1; transform: perspective(70px) rotateY(0) scale(1); }
}

@keyframes md-segment-icon-page-turn {
  0% { opacity: 0.4; transform: perspective(55px) rotateY(-58deg) rotateZ(-6deg) scale(0.72, 0.86); }
  28% { opacity: 1; transform: perspective(55px) rotateY(16deg) rotateZ(2deg) scale(1.12, 1.04); }
  50% { transform: perspective(55px) rotateY(-8deg) rotateZ(-1deg) scale(0.94, 0.98); }
  74% { transform: perspective(55px) rotateY(4deg) rotateZ(0.5deg) scale(1.04); }
  100% { opacity: 1; transform: perspective(55px) rotateY(0) rotateZ(0) scale(1); }
}

@keyframes md-segment-icon-sunrise {
  0% { opacity: 0.45; transform: rotate(-80deg) scale(0.5); }
  32% { opacity: 1; transform: rotate(28deg) scale(1.18); }
  54% { transform: rotate(-12deg) scale(0.92); }
  78% { transform: rotate(5deg) scale(1.06); }
  100% { opacity: 1; transform: rotate(0) scale(1); }
}

@keyframes md-segment-icon-moon {
  0% { opacity: 0.45; transform: rotate(-35deg) translateY(4px) scale(0.66); }
  34% { opacity: 1; transform: rotate(14deg) translateY(-2px) scale(1.16); }
  56% { transform: rotate(-7deg) translateY(1px) scale(0.93); }
  78% { transform: rotate(3deg) scale(1.05); }
  100% { opacity: 1; transform: rotate(0) translateY(0) scale(1); }
}

@keyframes md-segment-icon-contrast {
  0% { opacity: 0.45; transform: rotate(-100deg) scale(0.62); }
  32% { opacity: 1; transform: rotate(24deg) scale(1.18); }
  54% { transform: rotate(-10deg) scale(0.92); }
  78% { transform: rotate(4deg) scale(1.06); }
  100% { opacity: 1; transform: rotate(0) scale(1); }
}

@keyframes md-segment-icon-scroll {
  0% { opacity: 0.45; transform: translateY(-7px) scale(0.7); }
  30% { opacity: 1; transform: translateY(5px) scale(1.15); }
  50% { transform: translateY(-3px) scale(0.93); }
  72% { transform: translateY(2px) scale(1.05); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes md-segment-icon-pulse {
  0% { opacity: 0.4; transform: scale(0.4); }
  28% { opacity: 1; transform: scale(1.28); }
  48% { transform: scale(0.82); }
  68% { transform: scale(1.12); }
  84% { transform: scale(0.96); }
  100% { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .md-segmented-thumb,
  .md-segmented-option {
    transition: none;
  }

  .md-segmented-option.is-animating :deep(.md3-icon) {
    animation: none;
  }

  .md-segmented-option:hover :deep(.md3-icon) {
    transform: none;
  }
}

/* 手机窄屏下三项以上的分段控件优先保证文字完整，图标只在空间充足时显示。 */
@media (max-width: 480px) {
  .md-segmented.has-many-options .md-segmented-option :deep(.md3-icon) {
    display: none;
  }
}
</style>
