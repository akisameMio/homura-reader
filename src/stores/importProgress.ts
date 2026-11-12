/* ============================================================================
   HOMURA · 导入进度 Store
   ----------------------------------------------------------------------------
   导入任务按数量推进；字节只用于展示已读取体积，不参与百分比计算。
   取消只关闭调度门闩，已经开始的解析 / 提交会正常收尾。
   ========================================================================== */

import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

export const IMPORT_PHASE_LABELS = Object.freeze({
  read: '读取',
  parse: '解析',
  cover: '生成封面',
  save: '保存',
  confirm: '等待确认'
});

export function importPercent({ status = 'idle', total = 0, done = 0 } = {}) {
  if (status === 'idle' || total <= 0) return 0;
  if (status === 'running') return Math.min(99, Math.max(0, Math.floor((done / total) * 100)));
  if (done >= total) return 100;
  return Math.min(99, Math.max(0, Math.floor((done / total) * 100)));
}

// 并发池会同时推进多本，ETA 必须按「整批已用时间 / 已完成数」算吞吐，
// 不能拿单本耗时乘剩余数量，否则桌面 4 并发会把时间估成 4 倍。
export function estimateImportEtaSeconds({ total = 0, done = 0, elapsedMs = 0 } = {}) {
  if (done < 2 || done >= total) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  const perTaskMs = elapsedMs / done;
  return Math.max(1, Math.round((perTaskMs * (total - done)) / 1000));
}

export function formatEta(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `约 ${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `约 ${minutes} 分 ${rest} 秒` : `约 ${minutes} 分钟`;
}

export function formatImportBytes(bytes: number) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  const digits = index === 0 ? 0 : amount >= 100 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[index]}`;
}

export function importPhaseLabel(phase: string) {
  return (IMPORT_PHASE_LABELS as Record<string, string>)[phase] || IMPORT_PHASE_LABELS.read;
}

export function importFailureReason(error: unknown) {
  if (!error) return '无法读取这个文件';
  if (typeof error === 'string') return error;
  const err = error as { code?: string; message?: string; name?: string };
  if (err.code === 'NATIVE_SECURITY_LIMIT') return '文件触发原生安全限制';
  if (err.code === 'NATIVE_LIMIT_EXCEEDED') {
    const fileLimit = err.message?.match(/单个(?:压缩包|导入文件)超过 \d+ GiB/)?.[0];
    return fileLimit || '文件超出原生解析限额';
  }
  const message = err.message || err.name || '';
  if (/end of central directory|not a zip|invalid zip/i.test(message)) return '文件不是有效的 EPUB 压缩包';
  if (/password|encrypted|drm/i.test(message)) return '文件受密码或 DRM 保护';
  return message || '无法读取这个文件';
}

function normalizeRetryFiles(files: FileList | File[] | null) {
  if (!files) return [];
  return Array.from(files).filter(Boolean);
}

export const useImportProgressStore = defineStore('importProgress', () => {
  const status = ref('idle');
  const total = ref(0);
  const done = ref(0);
  const bytesTotal = ref(0);
  const bytesDone = ref(0);
  const phase = ref('read');
  const currentName = ref('');
  const saved = ref(0);
  const skipped = ref(0);
  const failed = ref(0);
  const failures = ref<{ name: string; reason: string; kind: string }[]>([]);
  const targetLabel = ref('全部作品');
  const targetId = ref('');
  const startedAt = ref(0);
  const finishedAt = ref(0);
  const expanded = ref(false);
  const cancelRequested = ref(false);
  const retryFiles = shallowRef<File[]>([]);

  const isRunning = computed(() => status.value === 'running');
  const percent = computed(() => importPercent({
    status: status.value,
    total: total.value,
    done: done.value
  }));
  const etaSeconds = computed(() => estimateImportEtaSeconds({
    total: total.value,
    done: done.value,
    elapsedMs: startedAt.value ? Date.now() - startedAt.value : 0
  }));
  const etaLabel = computed(() => formatEta(etaSeconds.value));
  const hasFailures = computed(() => failures.value.length > 0);
  const canRetry = computed(() => hasFailures.value && retryFiles.value.length > 0);
  const isAutoDismissable = computed(() => (
    status.value === 'done'
    && !hasFailures.value
    && !cancelRequested.value
  ));

  function begin(options: Record<string, any> = {}) {
    status.value = 'running';
    total.value = Math.max(0, Number(options.total) || 0);
    done.value = 0;
    bytesTotal.value = Math.max(0, Number(options.bytesTotal) || 0);
    bytesDone.value = 0;
    phase.value = 'read';
    currentName.value = '';
    saved.value = 0;
    skipped.value = Math.max(0, Number(options.skipped) || 0);
    failed.value = 0;
    failures.value = [];
    targetLabel.value = options.targetLabel || '全部作品';
    targetId.value = options.targetId || '';
    startedAt.value = Date.now();
    finishedAt.value = 0;
    expanded.value = options.expanded !== false;
    cancelRequested.value = false;
    retryFiles.value = [];
  }

  function taskStarted(_task: unknown, name = '') {
    if (status.value !== 'running') return;
    if (name) currentName.value = name;
  }

  function taskSettled(_task: unknown, bytes = 0) {
    if (status.value !== 'running') return;
    done.value = Math.min(total.value, done.value + 1);
    bytesDone.value = Math.min(bytesTotal.value, bytesDone.value + Math.max(0, Number(bytes) || 0));
  }

  function setPhase(nextPhase: string) {
    if (status.value !== 'running' || !(IMPORT_PHASE_LABELS as Record<string, string>)[nextPhase]) return;
    phase.value = nextPhase;
  }

  function setCurrentName(name: string) {
    if (status.value !== 'running') return;
    currentName.value = name || '';
  }

  function addSaved(count = 1) {
    saved.value += Math.max(0, Number(count) || 0);
  }

  function addSkipped(count = 1) {
    skipped.value += Math.max(0, Number(count) || 0);
  }

  function recordFailure({ name = '', reason = '无法读取这个文件', kind = '', files = null }: { name?: string; reason?: string; kind?: string; files?: FileList | File[] | null } = {}) {
    if (status.value !== 'running') return;
    failures.value = [...failures.value, {
      name: name || currentName.value || '未命名文件',
      reason: reason || '无法读取这个文件',
      kind
    }];
    failed.value++;
    const nextFiles = normalizeRetryFiles(files);
    if (nextFiles.length) retryFiles.value = [...retryFiles.value, ...nextFiles];
  }

  function requestCancel() {
    if (status.value !== 'running' || cancelRequested.value) return;
    cancelRequested.value = true;
  }

  function finish(nextStatus = '') {
    if (status.value !== 'running') return;
    status.value = nextStatus === 'cancelled' || cancelRequested.value ? 'cancelled' : 'done';
    finishedAt.value = Date.now();
    currentName.value = '';
    expanded.value = true;
  }

  function toggleExpanded(nextValue: boolean | undefined) {
    if (status.value === 'idle') return;
    expanded.value = typeof nextValue === 'boolean' ? nextValue : !expanded.value;
  }

  function dismiss() {
    if (status.value === 'running') return;
    status.value = 'idle';
    total.value = 0;
    done.value = 0;
    bytesTotal.value = 0;
    bytesDone.value = 0;
    phase.value = 'read';
    currentName.value = '';
    saved.value = 0;
    skipped.value = 0;
    failed.value = 0;
    failures.value = [];
    targetLabel.value = '全部作品';
    targetId.value = '';
    startedAt.value = 0;
    finishedAt.value = 0;
    expanded.value = false;
    cancelRequested.value = false;
    retryFiles.value = [];
  }

  return {
    status,
    total,
    done,
    bytesTotal,
    bytesDone,
    phase,
    currentName,
    saved,
    skipped,
    failed,
    failures,
    targetLabel,
    targetId,
    startedAt,
    finishedAt,
    expanded,
    cancelRequested,
    retryFiles,
    isRunning,
    percent,
    etaSeconds,
    etaLabel,
    hasFailures,
    canRetry,
    isAutoDismissable,
    begin,
    taskStarted,
    taskSettled,
    setPhase,
    setCurrentName,
    addSaved,
    addSkipped,
    recordFailure,
    requestCancel,
    finish,
    toggleExpanded,
    dismiss
  };
});
