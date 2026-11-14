<template>
  <Transition name="import-bar">
    <section
      v-if="visible"
      class="import-status-bar bg-[var(--md-surface-container)] text-[var(--md-on-surface)]"
      data-import-status-bar
      role="status"
      aria-live="off"
    >
      <div class="px-4 py-2.5">
        <template v-if="store.status === 'running'">
          <div class="flex items-start gap-3">
            <button type="button" class="import-status-main min-w-0 flex-1" @click="openDetails">
              <span class="flex min-w-0 items-baseline gap-2">
                <span class="shrink-0 text-[13px] font-semibold">
                  {{ t('导入中') }}
                  <span class="ml-0.5 font-mono">{{ store.done }} / {{ store.total }}</span>
                </span>
                <span class="shrink-0 rounded-full bg-[var(--md-primary-container)] px-2 py-0.5 text-[11px] font-semibold text-[var(--md-on-primary-container)]">
                  {{ phaseLabel }}
                </span>
                <span class="ml-auto shrink-0 font-mono text-[11px] text-[var(--md-on-surface-variant)]">
                  {{ bytesLabel }}
                </span>
              </span>
              <span class="mt-1 block min-w-0 truncate text-[11px] text-[var(--md-on-surface-variant)]">
                {{ t('{0} · 导入到：{1}', { 0: store.currentName || t('准备下一本…'), 1: store.targetLabel }) }}
              </span>
            </button>
            <button
              type="button"
              class="import-stop-button shrink-0"
              :disabled="store.cancelRequested"
              :title="store.cancelRequested ? t('正在停止导入') : t('停止导入')"
              :aria-label="store.cancelRequested ? t('正在停止导入') : t('停止导入')"
              @click="store.requestCancel()"
            >
              <MdIcon name="close" class="h-4 w-4" />
              <span>{{ store.cancelRequested ? t('正在停止…') : t('停止') }}</span>
            </button>
          </div>

          <div class="mt-2 h-[3px] overflow-hidden rounded-full bg-[var(--md-surface-high)]" aria-hidden="true">
            <div class="import-bar-fill h-full rounded-full bg-[var(--md-primary)]" :style="{ transform: `scaleX(${store.percent / 100})` }"></div>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center gap-3">
            <button type="button" class="import-status-main min-w-0 flex-1" @click="openDetails">
              <span class="block truncate text-[13px] font-semibold">
                {{ summaryTitle }}
              </span>
              <span class="mt-1 block truncate font-mono text-[11px] text-[var(--md-on-surface-variant)]">
                {{ t('{0} · 导入到：{1}', { 0: bytesLabel, 1: store.targetLabel }) }}
              </span>
            </button>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                v-if="store.canRetry"
                type="button"
                class="import-bar-action import-bar-action--primary"
                @click="$emit('retry')"
              >
                {{ t('重试失败项') }}
              </button>
              <button
                type="button"
                class="import-bar-action"
                @click="store.dismiss()"
              >
                {{ t('关闭') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>
  </Transition>
  <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  useImportProgressStore,
  importPhaseLabel,
  formatImportBytes
} from '../stores/importProgress.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

defineEmits(['retry']);

const store = useImportProgressStore();
const visible = computed(() => store.status !== 'idle' && !store.expanded);
const phaseLabel = computed(() => importPhaseLabel(store.phase));
const bytesLabel = computed(() => (
  store.bytesTotal > 0
    ? `${formatImportBytes(store.bytesDone)} / ${formatImportBytes(store.bytesTotal)}`
    : formatImportBytes(store.bytesDone)
));
const summaryTitle = computed(() => {
  if (store.status === 'cancelled') {
    return t('已停止 · 已添加 {0} · 跳过 {1} · 失败 {2}', { 0: store.saved, 1: store.skipped, 2: store.failed });
  }
  return t('已添加 {0} · 跳过 {1} · 失败 {2}', { 0: store.saved, 1: store.skipped, 2: store.failed });
});

const liveMessage = ref('');
let lastLiveAt = 0;
let lastLiveDone = 0;
let dismissTimer = 0;

function openDetails() {
  clearDismissTimer();
  store.toggleExpanded(true);
}

function clearDismissTimer() {
  if (!dismissTimer) return;
  window.clearTimeout(dismissTimer);
  dismissTimer = 0;
}

watch(
  () => [store.status, store.done] as [string, number],
  ([status, done]: [string, number]) => {
    const current = Date.now();
    if (status === 'running') {
      if (done - lastLiveDone < 5 && current - lastLiveAt < 2000) return;
      liveMessage.value = t('正在导入，已完成 {0} / {1} 本，当前{2}。', { 0: done, 1: store.total, 2: phaseLabel.value });
      lastLiveDone = done;
      lastLiveAt = current;
    } else if (status === 'done') {
      liveMessage.value = t('导入完成，已添加 {0} 本，跳过 {1} 本，失败 {2} 本。', { 0: store.saved, 1: store.skipped, 2: store.failed });
    } else if (status === 'cancelled') {
      liveMessage.value = t('导入已停止，已添加 {0} 本。', { 0: store.saved });
    }
  }
);

watch(
  () => store.status,
  () => {
    clearDismissTimer();
    if (!store.isAutoDismissable || store.expanded) return;
    dismissTimer = window.setTimeout(() => {
      dismissTimer = 0;
      if (store.expanded) return;
      if (document.activeElement?.closest?.('[data-import-status-bar]')) return;
      store.dismiss();
    }, 8000);
  }
);

onBeforeUnmount(clearDismissTimer);
</script>

<style scoped>
.import-status-bar {
  flex: none;
  max-height: 96px;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in oklab, var(--md-outline-variant) 72%, transparent);
}

.import-bar-fill {
  transform-origin: left center;
  transition: transform var(--md-duration-short) var(--md-ease-emphasized);
}

.import-status-main {
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  padding: 0;
  background: transparent;
  color: var(--md-on-surface);
  text-align: left;
}

.import-stop-button,
.import-bar-action {
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  background: var(--md-surface-high);
  color: var(--md-on-surface);
  font-size: 11px;
  font-weight: 600;
  transition:
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized);
}

.import-stop-button {
  display: inline-flex;
  min-width: 72px;
  padding: 0 11px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--md-tertiary);
}

.import-stop-button:disabled {
  cursor: wait;
  opacity: 0.62;
}

.import-bar-action {
  padding: 0 12px;
  color: var(--md-primary);
}

.import-bar-action--primary {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.import-bar-enter-active {
  transition:
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-short) var(--md-ease-emphasized);
}

.import-bar-leave-active {
  transition:
    opacity var(--md-duration-short) var(--md-ease-accelerate),
    transform var(--md-duration-short) var(--md-ease-accelerate);
}

.import-bar-enter-from,
.import-bar-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (hover: hover) and (pointer: fine) {
  .import-status-main:hover {
    background: color-mix(in oklab, var(--md-primary) 6%, transparent);
  }
  .import-stop-button:not(:disabled):hover,
  .import-bar-action:hover {
    background: var(--md-surface-highest);
  }
}

@media (prefers-reduced-motion: reduce) {
  .import-bar-fill,
  .import-stop-button,
  .import-bar-action,
  .import-bar-enter-active,
  .import-bar-leave-active {
    transition: none;
  }
}
</style>
