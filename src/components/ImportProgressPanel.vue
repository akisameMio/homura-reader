<template>
  <section :class="{ 'is-island': desktop }">
    <p v-if="!desktop" class="md-mobile-sheet-label">{{ panelTitle }}</p>
    <div v-if="store.status === 'running'" class="md-mobile-sheet-card is-padded">
      <div class="import-overview mobile-import-overview">
        <div class="import-count"><b>{{ store.done }}<span> / {{ store.total }}</span></b><small>{{ t('本作品已处理') }}</small></div>
        <div class="import-percent"><b>{{ store.percent }}%</b><span>{{ statusMeta }}</span></div>
      </div>
      <div class="import-track" role="progressbar" :aria-label="t('导入进度')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="store.percent">
        <i :style="{ transform: `scaleX(${store.percent / 100})` }"></i>
      </div>
      <div class="import-steps" aria-hidden="true">
        <template v-for="(step, index) in steps" :key="step.key">
          <span class="import-step" :class="{ 'is-done': stepState(step.key) === 'complete', 'is-active': stepState(step.key) === 'active' }">
            <MdIcon v-if="stepState(step.key) === 'complete'" name="check" />{{ t(step.label) }}
          </span>
          <span v-if="index < steps.length - 1" class="import-step-line"></span>
        </template>
      </div>
    </div>
    <div v-else class="md-mobile-sheet-card">
      <div class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-accent"><MdIcon name="check" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('已添加 {0} 本', { 0: store.saved }) }}</b><small>{{ savedNote }}</small></span>
      </div>
      <div v-if="store.skipped > 0" class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon"><MdIcon name="remove" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('跳过 {0} 本', { 0: store.skipped }) }}</b><small>{{ t('同名或重复内容没有导入') }}</small></span>
      </div>
    </div>
    <p v-if="store.hasFailures" class="md-mobile-sheet-label">{{ t('未导入 · {0} 本', { 0: store.failed }) }}</p>
    <div v-if="store.hasFailures" class="md-mobile-sheet-card">
      <div v-for="(failure, index) in store.failures" :key="`${failure.name}-${index}`" class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-danger"><MdIcon name="warning" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ failure.name }}</b><small>{{ t(failure.reason) }}</small></span>
      </div>
    </div>
    <p v-if="!desktop || store.status !== 'running'" class="md-mobile-sheet-label">{{ store.status === 'running' ? t('正在处理') : t('本次导入') }}</p>
    <div class="md-mobile-sheet-card">
      <div v-if="store.status === 'running'" class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-accent"><MdIcon name="upload_file" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ store.currentName || t('准备下一本…') }}</b><small>{{ desktop ? t('当前文件') : t('当前{0}', { 0: phaseLabel }) }}</small></span>
      </div>
      <div class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon"><MdIcon name="folder_open" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ store.targetLabel }}</b><small>{{ desktop && store.status === 'running' ? t('导入到') + ' · ' + bytesLabel : bytesLabel }}</small></span>
      </div>
    </div>
    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  useImportProgressStore,
  importPhaseLabel,
  formatImportBytes
} from '../stores/importProgress.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

defineProps({ desktop: { type: Boolean, default: false } });
const emit = defineEmits(['retry', 'close']);

const store = useImportProgressStore();
const steps = [
  { key: 'read', label: '读取' },
  { key: 'parse', label: '解析' },
  { key: 'save', label: '保存' }
];
const phaseLabel = computed(() => importPhaseLabel(store.phase));
const savedNote = computed(() => (
  store.saved > 0 ? t('作品已保存到本地书架') : t('本次没有新增作品')
));
const bytesLabel = computed(() => (
  store.bytesTotal > 0
    ? `${formatImportBytes(store.bytesDone)} / ${formatImportBytes(store.bytesTotal)}`
    : formatImportBytes(store.bytesDone)
));
const panelTitle = computed(() => {
  if (store.status === 'running') return t('正在整理你的书架');
  if (store.status === 'cancelled') return t('导入已停止');
  return store.hasFailures ? t('部分内容未导入') : t('书架整理好了');
});
const statusMeta = computed(() => {
  if (store.status === 'running') return store.etaLabel ? t('剩余 {0}', { 0: store.etaLabel }) : phaseLabel.value;
  if (store.status === 'cancelled') return t('已停止');
  return store.hasFailures ? t('失败 {0}', { 0: store.failed }) : t('全部完成');
});
const primaryAction = computed(() => {
  if (store.status === 'running') {
    return {
      label: store.cancelRequested ? t('正在停止') : t('停止导入'),
      icon: 'close',
      variant: 'tonal',
      disabled: store.cancelRequested
    };
  }
  if (store.canRetry) {
    return {
      label: t('重试失败项'),
      icon: 'update',
      variant: 'primary',
      disabled: false
    };
  }
  return {
    label: t('完成'),
    icon: 'check',
    variant: 'primary',
    disabled: false
  };
});

const liveMessage = ref('');
let lastLiveAt = 0;
let lastLiveDone = 0;

function stepState(key: string) {
  if (store.status === 'done' || store.status === 'cancelled') {
    return store.phase === 'save' || store.status === 'done' ? 'complete' : 'pending';
  }
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

function runPrimaryAction() {
  if (store.status === 'running') {
    store.requestCancel();
    return;
  }
  if (store.canRetry) {
    emit('retry');
    return;
  }
  close();
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
      return;
    }
    if (status === 'done' || status === 'cancelled') {
      liveMessage.value = status === 'cancelled'
        ? t('导入已停止，已添加 {0} 本。', { 0: store.saved })
        : t('导入完成，已添加 {0} 本，跳过 {1} 本，失败 {2} 本。', { 0: store.saved, 1: store.skipped, 2: store.failed });
    }
  }
);

defineExpose({ primaryAction, runPrimaryAction });
</script>

<style scoped>
.import-overview {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-top: 20px;
}
.mobile-import-overview { margin-top: 0; }

.import-count b {
  display: block;
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 32px;
  font-weight: 720;
  letter-spacing: -0.055em;
  line-height: 1;
}

.import-count b span {
  color: var(--md-on-surface-variant);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.import-count small {
  display: block;
  margin-top: 7px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  font-weight: 600;
}

.import-percent {
  text-align: right;
}

.import-percent b {
  display: block;
  color: var(--md-primary);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 22px;
  font-weight: 720;
  letter-spacing: -0.04em;
  line-height: 1;
}

.import-percent span {
  display: block;
  margin-top: 5px;
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
}

.import-track {
  height: 5px;
  margin-top: 15px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--md-surface-high);
}

.import-track i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--md-primary);
  transform-origin: left center;
  transition: transform var(--md-duration-short) var(--md-ease-emphasized);
}

.import-steps {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 13px;
}

.import-step {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border-radius: 999px;
  color: var(--md-on-surface-variant);
  font-size: 10px;
  font-weight: 600;
}

.import-step :deep(svg) {
  width: 12px;
  height: 12px;
}

.import-step.is-done {
  color: var(--md-primary);
}

.import-step.is-active {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.import-step-line {
  width: 12px;
  height: 0.5px;
  flex: none;
  background: color-mix(in oklab, var(--md-outline-variant) 82%, transparent);
}


.is-island .import-overview { align-items: center; }
.is-island .import-count b,
.is-island .import-percent b { font-family: inherit; font-variant-numeric: tabular-nums; }
.is-island .import-count b { font-size: 28px; }
.is-island .import-percent b { font-size: 18px; }
.is-island .import-step { padding-inline: 0; }
.is-island .import-step.is-active { background: transparent; color: var(--md-primary); }
</style>
