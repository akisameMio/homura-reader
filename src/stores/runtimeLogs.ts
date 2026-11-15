/* ============================================================================
   HOMURA · 运行日志 Store
   ----------------------------------------------------------------------------
   把服务层的环形日志缓冲映射成 Vue 状态，提前安装 console / window 捕获。
   ========================================================================== */

import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import {
  clearRuntimeLogs,
  getRuntimeLogs,
  installRuntimeLogCapture,
  subscribeRuntimeLogs,
  type RuntimeLogEntry
} from '../services/runtimeLogs.ts';

export const useRuntimeLogStore = defineStore('runtimeLogs', () => {
  const entries = shallowRef<RuntimeLogEntry[]>(getRuntimeLogs());
  const unsubscribe = subscribeRuntimeLogs(next => {
    entries.value = next;
  });
  let releaseCapture: (() => void) | null = null;

  const newestFirst = computed(() => entries.value.slice().reverse());
  const errorCount = computed(() => entries.value.reduce((count, entry) => count + (entry.level === 'error' ? 1 : 0), 0));
  const warningCount = computed(() => entries.value.reduce((count, entry) => count + (entry.level === 'warning' ? 1 : 0), 0));
  const infoCount = computed(() => entries.value.reduce((count, entry) => count + (entry.level === 'info' ? 1 : 0), 0));

  function installCapture() {
    releaseCapture ??= installRuntimeLogCapture();
  }

  function dispose() {
    unsubscribe();
    releaseCapture?.();
    releaseCapture = null;
  }

  function clear() {
    clearRuntimeLogs();
  }

  return {
    entries,
    newestFirst,
    errorCount,
    warningCount,
    infoCount,
    installCapture,
    dispose,
    clear
  };
});
