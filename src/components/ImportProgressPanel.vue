<template>
  <section
    class="import-progress-panel bg-[var(--md-surface-container)] text-[var(--md-on-surface)]"
    role="dialog"
    aria-label="导入进度"
    aria-modal="false"
    tabindex="-1"
  >
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-semibold tracking-wide text-[var(--md-on-surface-variant)]">
          {{ statusTitle }}
        </p>
        <h2 class="mt-1 text-[17px] font-semibold leading-snug">
          {{ panelTitle }}
        </h2>
      </div>
      <span
        v-if="store.status === 'running'"
        class="shrink-0 rounded-full bg-[var(--md-primary-container)] px-2.5 py-1 text-[11px] font-semibold text-[var(--md-on-primary-container)]"
      >
        {{ phaseLabel }}
      </span>
      <span
        v-else-if="store.hasFailures"
        class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--md-error-container)] text-[var(--md-on-error-container)]"
        aria-hidden="true"
      >
        <MdIcon name="warning" class="h-4 w-4" />
      </span>
      <span
        v-else-if="store.status === 'cancelled'"
        class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--md-surface-high)] text-[var(--md-on-surface-variant)]"
        aria-hidden="true"
      >
        <MdIcon name="close" class="h-4 w-4" />
      </span>
      <span
        v-else
        class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]"
        aria-hidden="true"
      >
        <MdIcon name="check" class="h-4 w-4" />
      </span>
    </div>

    <div
      class="mt-5"
      role="status"
      aria-live="off"
      :aria-label="`${store.done} / ${store.total}，${phaseLabel}`"
    >
      <div class="flex items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="font-mono text-[21px] font-semibold leading-none tracking-tight">
            {{ store.done }} / {{ store.total }}
          </p>
          <p class="mt-2 font-mono text-[11px] text-[var(--md-on-surface-variant)]">
            {{ bytesLabel }}
            <template v-if="store.status === 'running' && store.etaLabel"> · 剩余 {{ store.etaLabel }}</template>
          </p>
        </div>
        <p class="shrink-0 font-mono text-[17px] font-semibold text-[var(--md-primary)]">
          {{ store.percent }}%
        </p>
      </div>

      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--md-surface-high)]" aria-hidden="true">
        <div class="import-progress-fill h-full rounded-full bg-[var(--md-primary)]" :style="{ transform: `scaleX(${store.percent / 100})` }"></div>
      </div>

      <div class="mt-3 flex items-center gap-1.5 text-[11px] font-medium" aria-hidden="true">
        <template v-for="(step, index) in steps" :key="step.key">
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2 py-1"
            :class="stepState(step.key) === 'active'
              ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
              : stepState(step.key) === 'complete'
                ? 'text-[var(--md-primary)]'
                : 'text-[var(--md-on-surface-variant)]'"
          >
            <MdIcon
              :name="stepState(step.key) === 'complete' ? 'check' : 'radio_button_unchecked'"
              class="h-3 w-3"
            />
            {{ step.label }}
          </span>
          <span v-if="index < steps.length - 1" class="h-px w-3 bg-[var(--md-outline-variant)]"></span>
        </template>
      </div>

      <div
        v-if="store.status !== 'running'"
        class="mt-3 flex items-center gap-4 rounded-[16px] bg-[var(--md-surface-high)] px-3 py-2 text-[11px] text-[var(--md-on-surface-variant)]"
      >
        <span>已添加 <strong class="font-mono text-[13px] text-[var(--md-on-surface)]">{{ store.saved }}</strong></span>
        <span>跳过 <strong class="font-mono text-[13px] text-[var(--md-on-surface)]">{{ store.skipped }}</strong></span>
        <span>失败 <strong class="font-mono text-[13px]" :class="store.failed ? 'text-[var(--md-error)]' : 'text-[var(--md-on-surface)]'">{{ store.failed }}</strong></span>
      </div>
    </div>

    <div class="mt-5 space-y-2 border-t border-[var(--md-outline-variant)] pt-4">
      <p v-if="store.status === 'running'" class="flex min-w-0 items-center gap-2 text-[13px]">
        <span class="shrink-0 text-[11px] font-semibold text-[var(--md-on-surface-variant)]">当前文件</span>
        <span class="min-w-0 truncate font-medium">{{ store.currentName || '准备下一本…' }}</span>
      </p>
      <p class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--md-on-surface-variant)]">
        <MdIcon name="local_library" class="h-3.5 w-3.5 shrink-0" />
        <span class="min-w-0 truncate">导入到：{{ store.targetLabel }}</span>
      </p>
    </div>

    <div
      v-if="store.hasFailures"
      class="mt-4 rounded-[16px] bg-[var(--md-error-container)] px-3 py-2.5 text-[var(--md-on-error-container)]"
    >
      <p class="text-[11px] font-semibold">未能导入</p>
      <ul class="mt-2 space-y-1.5">
        <li v-for="(failure, index) in visibleFailures" :key="`${failure.name}-${failure.reason}-${index}`" class="flex min-w-0 gap-2 text-[13px]">
          <MdIcon name="error" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 leading-snug">
            <span class="font-medium">{{ failure.name }}</span>
            <span class="block truncate text-[11px] opacity-80">{{ failure.reason }}</span>
          </span>
        </li>
      </ul>
      <p v-if="store.failures.length > visibleFailures.length" class="mt-2 pl-[22px] text-[11px] opacity-80">
        等 {{ store.failures.length }} 本
      </p>
    </div>

    <div class="mt-5 flex items-center justify-end gap-2">
      <button
        v-if="store.status === 'running'"
        type="button"
        class="import-action-button import-action-button--stop"
        :disabled="store.cancelRequested"
        @click="store.requestCancel()"
      >
        {{ store.cancelRequested ? '正在停止…' : '停止导入' }}
      </button>
      <template v-else>
        <button
          v-if="store.canRetry"
          type="button"
          class="import-action-button import-action-button--primary"
          @click="$emit('retry')"
        >
          重试失败项
        </button>
        <button
          type="button"
          class="import-action-button"
          @click="close"
        >
          关闭
        </button>
      </template>
    </div>

    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import {
  useImportProgressStore,
  importPhaseLabel,
  formatImportBytes
} from '../stores/importProgress.js';
import MdIcon from './MdIcon.vue';

const emit = defineEmits(['retry', 'close']);

const store = useImportProgressStore();
const steps = [
  { key: 'read', label: '读取' },
  { key: 'parse', label: '解析' },
  { key: 'save', label: '保存' }
];
const phaseLabel = computed(() => importPhaseLabel(store.phase));
const visibleFailures = computed(() => store.failures.slice(0, 3));
const bytesLabel = computed(() => (
  store.bytesTotal > 0
    ? `${formatImportBytes(store.bytesDone)} / ${formatImportBytes(store.bytesTotal)}`
    : formatImportBytes(store.bytesDone)
));
const statusTitle = computed(() => {
  if (store.status === 'running') return '导入进行中';
  if (store.status === 'cancelled') return '已停止';
  return store.hasFailures ? '导入结束，有项目未完成' : '全部完成';
});
const panelTitle = computed(() => {
  if (store.status === 'running') return '正在整理你的书架';
  if (store.status === 'cancelled') return '导入已停止';
  return store.hasFailures ? '部分内容未导入' : '导入完成';
});

const liveMessage = ref('');
let lastLiveAt = 0;
let lastLiveDone = 0;

function stepState(key) {
  if (store.status === 'done') return 'complete';
  if (store.phase === 'save') {
    if (key === 'save') return 'active';
    return 'complete';
  }
  if (store.phase === 'parse' || store.phase === 'cover' || store.phase === 'confirm') {
    if (key === 'read') return 'complete';
    if (key === 'parse') return 'active';
    return 'pending';
  }
  return key === 'read' ? 'active' : 'pending';
}

function close() {
  emit('close');
}

watch(
  () => [store.status, store.done],
  ([status, done]) => {
    const current = Date.now();
    if (status === 'running') {
      if (done - lastLiveDone < 5 && current - lastLiveAt < 2000) return;
      liveMessage.value = `正在导入，已完成 ${done} / ${store.total} 本，当前${phaseLabel.value}。`;
      lastLiveDone = done;
      lastLiveAt = current;
      return;
    }
    if (status === 'done' || status === 'cancelled') {
      liveMessage.value = status === 'cancelled'
        ? `导入已停止，已添加 ${store.saved} 本。`
        : `导入完成，已添加 ${store.saved} 本，跳过 ${store.skipped} 本，失败 ${store.failed} 本。`;
    }
  }
);
</script>

<style scoped>
.import-progress-panel {
  width: min(372px, calc(100vw - 32px));
  max-height: calc(100dvh - 140px);
  overflow-y: auto;
  overscroll-behavior: contain;
  outline: none;
  border-radius: 28px;
  padding: 20px;
  box-shadow:
    0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color) 28%, transparent),
    0 18px 48px -18px color-mix(in oklab, var(--md-shadow-color) 48%, transparent);
}

.import-progress-fill {
  transform-origin: left center;
  transition: transform var(--md-duration-short) var(--md-ease-emphasized);
}

.import-action-button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--md-outline-variant);
  border-radius: 999px;
  background: transparent;
  color: var(--md-primary);
  font-size: 13px;
  font-weight: 600;
  transition:
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized);
}

.import-action-button--primary {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  border-color: transparent;
}

.import-action-button--stop {
  color: var(--md-tertiary);
}

.import-action-button:disabled {
  cursor: wait;
  opacity: 0.62;
}

@media (hover: hover) and (pointer: fine) {
  .import-action-button:not(:disabled):hover {
    background: var(--md-surface-high);
  }
  .import-action-button--primary:not(:disabled):hover {
    background: color-mix(in oklab, var(--md-primary-container) 90%, var(--md-on-primary-container));
  }
}

@media (prefers-reduced-motion: reduce) {
  .import-progress-fill,
  .import-action-button {
    transition: none;
  }
}
</style>
