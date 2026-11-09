<template>
  <section
    ref="panelRef"
    class="import-progress-panel"
    :class="{
      'is-summary': store.status !== 'running',
      'is-host-action': hostPrimaryAction
    }"
    role="group"
    aria-labelledby="import-progress-title"
    tabindex="-1"
  >
    <div class="md-sheet-grip" aria-hidden="true"></div>

    <header>
      <p class="md-surface-kicker">{{ statusTitle }}</p>
      <h2 id="import-progress-title" class="md-surface-title">{{ panelTitle }}</h2>
      <p class="md-surface-subtitle">{{ panelSubtitle }}</p>
    </header>

    <template v-if="store.status === 'running'">
      <div class="import-overview">
        <div class="import-count">
          <b>{{ store.done }}<span> / {{ store.total }}</span></b>
          <small>本作品已处理</small>
        </div>
        <div class="import-percent">
          <b>{{ store.percent }}%</b>
          <span>{{ statusMeta }}</span>
        </div>
      </div>

      <div
        class="import-track"
        role="progressbar"
        aria-label="导入进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="store.percent"
      >
        <i :style="{ transform: `scaleX(${store.percent / 100})` }"></i>
      </div>

      <div class="import-steps" aria-hidden="true">
        <template v-for="(step, index) in steps" :key="step.key">
          <span
            class="import-step"
            :class="{
              'is-done': stepState(step.key) === 'complete',
              'is-active': stepState(step.key) === 'active'
            }"
          >
            <MdIcon
              v-if="stepState(step.key) === 'complete'"
              name="check"
            />
            {{ step.label }}
          </span>
          <span v-if="index < steps.length - 1" class="import-step-line"></span>
        </template>
      </div>

      <div class="import-current">
        <MdIcon name="upload_file" />
        <span>当前文件</span>
        <b>{{ store.currentName || '准备下一本…' }}</b>
      </div>

      <div class="import-target">
        <MdIcon name="folder_open" />
        <span>导入到：{{ store.targetLabel }}</span>
        <code>{{ bytesLabel }}</code>
      </div>
    </template>

    <div v-else class="import-summary-list">
      <div class="import-summary-row is-accent">
        <span class="import-summary-icon"><MdIcon name="check" /></span>
        <span class="import-summary-copy">
          <b>已添加</b>
          <small>{{ savedNote }}</small>
        </span>
        <span class="import-summary-value">{{ store.saved }} 本</span>
      </div>

      <div v-if="store.skipped > 0" class="import-summary-row">
        <span class="import-summary-icon is-plain"><MdIcon name="remove" /></span>
        <span class="import-summary-copy">
          <b>跳过</b>
          <small>同名或重复内容没有导入</small>
        </span>
        <span class="import-summary-value">{{ store.skipped }} 本</span>
      </div>

      <template v-if="store.hasFailures">
        <div class="import-summary-divider" aria-hidden="true"></div>
        <div
          v-for="(failure, index) in visibleFailures"
          :key="`${failure.name}-${failure.reason}-${index}`"
          class="import-summary-row is-error"
        >
          <span class="import-summary-icon is-error"><MdIcon name="warning" /></span>
          <span class="import-summary-copy">
            <b>{{ failure.name }}</b>
            <small>{{ failure.reason }}</small>
          </span>
        </div>
        <p v-if="store.failures.length > visibleFailures.length" class="import-summary-more">
          还有 {{ store.failures.length - visibleFailures.length }} 本未导入
        </p>
      </template>

      <div class="import-summary-divider" aria-hidden="true"></div>
      <div class="import-summary-row">
        <span class="import-summary-icon is-plain"><MdIcon name="folder_open" /></span>
        <span class="import-summary-copy">
          <b>导入到</b>
          <small>{{ store.targetLabel }}</small>
        </span>
        <span class="import-summary-value">{{ bytesLabel }}</span>
      </div>
    </div>

    <div class="md-surface-actionbar">
      <template v-if="store.status === 'running'">
        <button
          v-if="!hostPrimaryAction"
          ref="primaryActionRef"
          type="button"
          class="md-surface-action is-tonal"
          :disabled="store.cancelRequested"
          @click="store.requestCancel()"
        >
          <MdIcon name="close" />
          {{ store.cancelRequested ? '正在停止' : '停止导入' }}
        </button>
      </template>
      <template v-else>
        <div v-if="store.canRetry" class="md-surface-aux">
          <button type="button" class="md-surface-text-button" @click="close">关闭</button>
        </div>
        <button
          v-if="store.canRetry && !hostPrimaryAction"
          ref="primaryActionRef"
          type="button"
          class="md-surface-action is-primary"
          @click="$emit('retry')"
        >
          重试失败项
        </button>
        <button
          v-else-if="!store.canRetry && !hostPrimaryAction"
          ref="primaryActionRef"
          type="button"
          class="md-surface-action is-primary"
          @click="close"
        >
          <MdIcon name="check" />
          完成
        </button>
      </template>
    </div>

    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import {
  useImportProgressStore,
  importPhaseLabel,
  formatImportBytes
} from '../stores/importProgress.ts';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  hostPrimaryAction: { type: Boolean, default: false }
});
const emit = defineEmits(['retry', 'close']);

const store = useImportProgressStore();
const panelRef = shallowRef(null);
const primaryActionRef = shallowRef(null);
const steps = [
  { key: 'read', label: '读取' },
  { key: 'parse', label: '解析' },
  { key: 'save', label: '保存' }
];
const phaseLabel = computed(() => importPhaseLabel(store.phase));
const visibleFailures = computed(() => store.failures.slice(0, 3));
const savedNote = computed(() => (
  store.saved > 0 ? '作品已保存到本地书架' : '本次没有新增作品'
));
const bytesLabel = computed(() => (
  store.bytesTotal > 0
    ? `${formatImportBytes(store.bytesDone)} / ${formatImportBytes(store.bytesTotal)}`
    : formatImportBytes(store.bytesDone)
));
const statusTitle = computed(() => {
  if (store.status === 'running') return '导入进行中';
  if (store.status === 'cancelled') return '导入已停止';
  return store.hasFailures ? '导入完成，有项目未完成' : '导入完成';
});
const panelTitle = computed(() => {
  if (store.status === 'running') return '正在整理你的书架';
  if (store.status === 'cancelled') return '导入已停止';
  return store.hasFailures ? '部分内容未导入' : '书架整理好了';
});
const panelSubtitle = computed(() => {
  if (store.status === 'running') return `正在${phaseLabel.value} · ${bytesLabel.value}`;
  if (store.status === 'cancelled') return `已添加 ${store.saved} 本，其余内容已停止处理。`;
  if (store.hasFailures) return `已添加 ${store.saved} 本，失败 ${store.failed} 本。`;
  return `已添加 ${store.saved} 本，跳过 ${store.skipped} 本。`;
});
const statusMeta = computed(() => {
  if (store.status === 'running') return store.etaLabel ? `剩余 ${store.etaLabel}` : phaseLabel.value;
  if (store.status === 'cancelled') return '已停止';
  return store.hasFailures ? `失败 ${store.failed}` : '全部完成';
});
const primaryAction = computed(() => {
  if (store.status === 'running') {
    return {
      label: store.cancelRequested ? '正在停止' : '停止导入',
      icon: 'close',
      variant: 'tonal',
      disabled: store.cancelRequested
    };
  }
  if (store.canRetry) {
    return {
      label: '重试失败项',
      icon: 'update',
      variant: 'primary',
      disabled: false
    };
  }
  return {
    label: '完成',
    icon: 'check',
    variant: 'primary',
    disabled: false
  };
});

const liveMessage = ref('');
let lastLiveAt = 0;
let lastLiveDone = 0;

function stepState(key) {
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

async function focusInitial() {
  await nextTick();
  primaryActionRef.value?.focus();
  if (!primaryActionRef.value) panelRef.value?.focus({ preventScroll: true });
}

watch(
  () => [store.status, store.done] as [string, number],
  ([status, done]: [string, number]) => {
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

// 状态切换会替换主行动按钮；焦点原本在面板内时，顺手交给新的主行动。
watch(
  () => store.status,
  async () => {
    if (props.hostPrimaryAction) return;
    const panel = panelRef.value;
    if (!panel?.contains(document.activeElement)) return;
    await nextTick();
    const active = document.activeElement;
    if (!active || active === document.body || !panelRef.value?.contains(active)) {
      primaryActionRef.value?.focus();
    }
  }
);

defineExpose({ focusInitial, primaryAction, runPrimaryAction });
</script>

<style scoped>
.import-progress-panel {
  width: 100%;
  max-height: min(680px, calc(100dvh - 112px));
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 28px;
  padding: 20px;
  outline: none;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
}

.import-overview {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-top: 20px;
}

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

.import-current,
.import-target {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  border-radius: 15px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 78%, transparent);
}

.import-current {
  margin-top: 15px;
  padding: 11px 12px;
}

.import-current :deep(svg),
.import-target :deep(svg) {
  width: 17px;
  height: 17px;
  flex: none;
  color: var(--md-primary);
}

.import-current span {
  flex: none;
  color: var(--md-on-surface-variant);
  font-size: 10px;
  font-weight: 650;
}

.import-current b {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-target {
  margin-top: 11px;
  padding: 9px 12px;
  color: var(--md-on-surface-variant);
  box-shadow: none;
  background: transparent;
  font-size: 11px;
}

.import-target span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-target code {
  margin-left: auto;
  flex: none;
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
}

.import-summary-list {
  display: grid;
  gap: 4px;
  margin-top: 18px;
}

.import-summary-row {
  display: flex;
  min-height: 68px;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 10px;
  border-radius: 18px;
}

.import-summary-row.is-accent {
  background: color-mix(in oklab, var(--md-primary-container) 48%, var(--md-surface-low));
}

.import-summary-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.import-summary-icon.is-plain {
  background: var(--md-surface-high);
  color: var(--md-on-surface);
}

.import-summary-icon.is-error {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.import-summary-icon :deep(svg) {
  width: 21px;
  height: 21px;
}

.import-summary-copy {
  min-width: 0;
  flex: 1;
}

.import-summary-copy b,
.import-summary-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-summary-copy b {
  font-size: 13px;
  font-weight: 650;
}

.import-summary-copy small {
  margin-top: 3px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.import-summary-row.is-error small {
  color: color-mix(in oklab, var(--md-error) 76%, var(--md-on-surface-variant));
}

.import-summary-value {
  flex: none;
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
}

.import-summary-row.is-accent .import-summary-value {
  color: var(--md-primary);
}

.import-summary-divider {
  height: 0.5px;
  margin: 7px 12px;
  background: color-mix(in oklab, var(--md-outline-variant) 75%, transparent);
}

.import-summary-more {
  margin: 2px 0 0 62px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.import-progress-panel.is-summary.is-host-action :deep(.md-surface-actionbar) {
  position: absolute;
  right: 20px;
  bottom: 20px;
  left: 20px;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.import-progress-panel.is-summary.is-host-action {
  position: relative;
  padding-bottom: 92px;
}

@media (max-width: 899px) {
  .import-progress-panel {
    max-height: calc(78dvh - env(safe-area-inset-bottom, 0px));
    padding: 20px;
    border-radius: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .import-track i {
    transition: none;
  }
}
</style>
