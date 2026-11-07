<template>
  <div
    :class="compact ? 'relative flex items-center' : 'md-fab-pos flex flex-col items-end'"
  >
    <button
      type="button"
      class="import-fab relative z-10"
      :class="{
        'is-compact': compact,
        'is-circle': !isIdle,
        'is-failed': !isIdle && store.hasFailures,
        'is-open': isIdle ? open : store.expanded
      }"
      :title="buttonTitle"
      :aria-label="buttonLabel"
      :aria-haspopup="isIdle ? 'menu' : 'dialog'"
      :aria-expanded="isIdle ? open : store.expanded"
      @click="onFabClick"
    >
      <span class="import-fab-layer" :class="{ 'is-hidden': !isIdle }" aria-hidden="true">
        <MdIcon name="upload_file" filled :class="compact ? 'w-5 h-5' : 'w-6 h-6'" />
        <span v-if="!compact" class="import-fab-label">导入</span>
      </span>

      <span class="import-fab-layer" :class="{ 'is-hidden': isIdle }" aria-hidden="true">
        <svg class="import-ring" viewBox="0 0 44 44">
          <circle class="import-ring-track" cx="22" cy="22" r="18"></circle>
          <circle
            class="import-ring-progress"
            cx="22"
            cy="22"
            r="18"
            :stroke-dasharray="ringLength"
            :stroke-dashoffset="ringOffset"
          ></circle>
        </svg>
        <MdIcon
          v-if="store.status === 'done' && !store.hasFailures"
          name="check"
          class="import-ring-icon"
        />
        <MdIcon
          v-else-if="store.status === 'done' || store.status === 'cancelled'"
          :name="store.status === 'cancelled' ? 'close' : 'warning'"
          class="import-ring-icon"
        />
        <span v-else class="import-ring-number">{{ compact ? `${store.percent}%` : store.done }}</span>
      </span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useImportProgressStore } from '../stores/importProgress.js';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  compact: Boolean,
  open: Boolean
});
const emit = defineEmits([
  'update:open'
]);

const store = useImportProgressStore();
const isIdle = computed(() => store.status === 'idle');
const ringLength = 2 * Math.PI * 18;
const ringOffset = computed(() => ringLength * (1 - store.percent / 100));
const buttonTitle = computed(() => {
  if (isIdle.value) return '导入作品';
  if (store.status === 'running') return `导入进度 ${store.done} / ${store.total}`;
  if (store.status === 'cancelled') return '导入已停止';
  return store.hasFailures ? '导入完成，有失败项' : '导入完成';
});
const buttonLabel = computed(() => {
  if (isIdle.value) return '导入作品';
  if (props.compact) return `${buttonTitle.value}，查看导入状态`;
  return `${buttonTitle.value}，${store.expanded ? '收起进度详情' : '展开进度详情'}`;
});

function onFabClick() {
  if (isIdle.value) {
    emit('update:open', !props.open);
    return;
  }
  store.toggleExpanded(true);
}
</script>

<style scoped>
.import-fab {
  position: relative;
  display: inline-flex;
  width: 104px;
  height: 56px;
  padding: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 0;
  border-radius: 28px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  font-size: 13px;
  font-weight: 600;
  box-shadow:
    0 2px 4px -2px color-mix(in oklab, var(--md-shadow-color) 28%, transparent),
    0 6px 16px -8px color-mix(in oklab, var(--md-shadow-color) 38%, transparent);
  transition:
    border-radius var(--md-duration-medium) var(--md-ease-emphasized),
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    box-shadow var(--md-duration-short) var(--md-ease-emphasized);
}

.import-fab.is-open {
  background: color-mix(in oklab, var(--md-primary-container) 92%, var(--md-on-primary-container));
  box-shadow:
    0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color) 30%, transparent),
    0 10px 24px -10px color-mix(in oklab, var(--md-shadow-color) 42%, transparent);
}

.import-fab.is-circle {
  width: 56px;
  border-radius: 999px;
}

.import-fab.is-failed {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.import-fab.is-failed .import-ring-track {
  stroke: color-mix(in oklab, var(--md-on-error-container) 18%, transparent);
}

.import-fab.is-failed .import-ring-progress {
  stroke: var(--md-error);
}

.import-fab.is-compact {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  box-shadow: none;
}

.import-fab.is-compact.is-open {
  box-shadow: none;
}

.import-fab-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  transition:
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-short) var(--md-ease-emphasized);
}

.import-fab-layer.is-hidden {
  opacity: 0;
  transform: scale(0.76);
  transition-duration: 120ms;
  transition-delay: 0ms;
  pointer-events: none;
}

.import-fab-layer:not(.is-hidden) {
  transition-delay: 80ms;
}

.import-fab-label {
  line-height: 1;
}

.import-ring {
  position: absolute;
  inset: 6px;
  width: 44px;
  height: 44px;
  transform: rotate(-90deg);
}

.import-fab.is-compact .import-ring {
  inset: 4px;
  width: 36px;
  height: 36px;
}

.import-ring-track,
.import-ring-progress {
  fill: none;
  stroke-width: 3;
}

.import-ring-track {
  stroke: color-mix(in oklab, var(--md-on-primary-container) 16%, transparent);
}

.import-ring-progress {
  stroke: var(--md-primary);
  stroke-linecap: round;
  transition: stroke-dashoffset var(--md-duration-short) var(--md-ease-emphasized);
}

.import-ring-number {
  position: relative;
  z-index: 1;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.import-fab.is-compact .import-ring-number {
  font-size: 11px;
}

.import-ring-icon {
  position: relative;
  z-index: 1;
  width: 18px;
  height: 18px;
}

.import-panel-position {
  position: fixed;
  right: 28px;
  bottom: 94px;
  z-index: 50;
  /* FAB 中心距面板底边约 40px，container transform 从按钮中心展开 */
  transform-origin: calc(100% - 28px) calc(100% + 40px);
}

.import-panel-enter-active {
  transition:
    transform var(--md-duration-medium) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized);
}

.import-panel-leave-active {
  transition:
    transform var(--md-duration-medium) var(--md-ease-accelerate),
    opacity var(--md-duration-short) var(--md-ease-accelerate);
}

.import-panel-enter-from,
.import-panel-leave-to {
  opacity: 0;
  transform: translate3d(8px, 18px, 0) scale(0.16);
}

@media (hover: hover) and (pointer: fine) {
  .import-fab:hover {
    background: color-mix(in oklab, var(--md-primary-container) 92%, var(--md-on-primary-container));
    box-shadow:
      0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color) 30%, transparent),
      0 10px 24px -10px color-mix(in oklab, var(--md-shadow-color) 42%, transparent);
  }

  .import-fab.is-compact:hover {
    box-shadow: none;
  }

  .import-fab.is-failed:hover {
    background: color-mix(in oklab, var(--md-error-container) 92%, var(--md-on-error-container));
  }
}

.import-fab:active {
  background: color-mix(in oklab, var(--md-primary-container) 86%, var(--md-on-primary-container));
}

.import-fab.is-failed:active {
  background: color-mix(in oklab, var(--md-error-container) 86%, var(--md-on-error-container));
}

@media (prefers-reduced-motion: reduce) {
  .import-fab,
  .import-fab-layer,
  .import-ring-progress,
  .import-panel-enter-active,
  .import-panel-leave-active {
    transition: none;
  }
}
</style>
