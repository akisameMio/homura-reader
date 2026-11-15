/* ============================================================================
   HOMURA · 可选 WebDAV 元数据同步
   ----------------------------------------------------------------------------
   配置只保存地址、账号与开关，密码仅保留当前会话。同步失败不阻断本地操作；
   自动同步限流，重新联网、回到前台和退出阅读后再次尝试。
   ========================================================================== */

import { ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { createSyncEngine, type SyncStats } from '../services/syncEngine.ts';
import { loadSyncState, saveSyncState } from '../services/syncPersistence.ts';
import { fingerprintSource, prepareSourceIdentity } from '../services/syncIdentity.ts';
import { HomuraStore, subscribeMetadataChanges } from '../services/storage.ts';
import { WebDavClient, normalizeWebDavUrl } from '../services/webdav.ts';
import { runShelfMutation } from '../services/mutationQueue.ts';
import { useShelfStore } from './shelf.ts';
import { useReaderStore } from './reader.ts';

const CONFIG_KEY = 'homura_webdav_sync';
const AUTO_SYNC_DELAY = 15_000;
const REFRESH_INTERVAL = 60_000;

interface SavedConfig {
  url: string;
  username: string;
  enabled: boolean;
  autoSync: boolean;
}

export const useSyncStore = defineStore('sync', () => {
  const shelf = useShelfStore();
  const reader = useReaderStore();
  const config = ref({ url: '', username: '' });
  const password = ref('');
  const enabled = ref(false);
  const autoSync = ref(true);
  const status = ref<'idle' | 'testing' | 'syncing' | 'error'>('idle');
  const error = ref('');
  const lastSyncAt = ref<number | null>(null);
  const pendingCount = ref(0);
  const matchedCount = ref(0);
  const unmatchedCount = ref(0);
  const remoteOnlyCount = ref(0);
  const engine = shallowRef<ReturnType<typeof createSyncEngine> | null>(null);
  let initialized: Promise<void> | null = null;
  let generation = 0;
  let sessionReady = false;
  let captureTimer: ReturnType<typeof setTimeout> | null = null;
  let networkTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAttempt = 0;

  function applyStats(stats: SyncStats) {
    pendingCount.value = stats.pendingCount;
    matchedCount.value = stats.matchedCount;
    unmatchedCount.value = stats.unmatchedCount;
    remoteOnlyCount.value = stats.remoteOnlyCount;
    lastSyncAt.value = stats.lastSyncAt;
  }

  function message(error: unknown) {
    const text = error instanceof Error ? error.message : '';
    if (/^WebDAV 请求失败（HTTP \d+）$/.test(text)) return 'WebDAV 请求失败，请检查服务器状态与访问权限';
    return text && !text.startsWith('SYNC_') ? text : '同步失败，请稍后重试';
  }

  function resetTimers() {
    if (captureTimer) clearTimeout(captureTimer);
    if (networkTimer) clearTimeout(networkTimer);
    captureTimer = networkTimer = null;
  }

  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (navigator.locks) return navigator.locks.request('homura-metadata-sync', action);
    return action();
  }

  function buildEngine() {
    const current = ++generation;
    const profileId = JSON.stringify([config.value.url, config.value.username]);
    engine.value = config.value.url ? createSyncEngine({
      profileId,
      deviceId: crypto.randomUUID(),
      loadState: () => loadSyncState(profileId),
      saveState: saveSyncState,
      readSnapshot: () => HomuraStore.readSyncSnapshot(),
      getSource: async id => await HomuraStore.getSource(id) as import('../types.ts').BookSource | undefined,
      prepareIdentity: prepareSourceIdentity,
      fingerprint: fingerprintSource,
      applySnapshot: (expected, next) => runShelfMutation(() => HomuraStore.applySyncMetadata(expected, next)),
      activeBookId: () => reader.currentBook?.id || null,
      isCurrent: () => current === generation && enabled.value
    }) : null;
    pendingCount.value = matchedCount.value = unmatchedCount.value = remoteOnlyCount.value = 0;
    lastSyncAt.value = null;
  }

  async function captureChanges() {
    const target = engine.value;
    if (!enabled.value || !target) return;
    const current = generation;
    try {
      const stats = await exclusive(() => target.capture());
      if (generation === current) applyStats(stats);
    } catch (failure) {
      if (generation === current) {
        error.value = message(failure);
        if (status.value === 'idle') status.value = 'error';
      }
    }
  }

  function canAutoSync() {
    return enabled.value && autoSync.value && sessionReady && !!engine.value
      && navigator.onLine !== false && !document.hidden;
  }

  function scheduleNetwork() {
    if (!canAutoSync() || networkTimer) return;
    const delay = Math.max(1500, AUTO_SYNC_DELAY - (Date.now() - lastAttempt));
    networkTimer = setTimeout(() => {
      networkTimer = null;
      if (canAutoSync()) void syncNow().catch(() => {});
    }, delay);
  }

  function changed() {
    if (!enabled.value || !engine.value) return;
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      captureTimer = null;
      void captureChanges().then(scheduleNetwork);
    }, 750);
  }

  function restoreSavedConfig() {
    resetTimers();
    config.value = { url: '', username: '' };
    password.value = '';
    enabled.value = false;
    autoSync.value = true;
    sessionReady = false;
    status.value = 'idle';
    error.value = '';
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedConfig>;
        if (typeof saved.url === 'string' && saved.url) {
          config.value = { url: normalizeWebDavUrl(saved.url), username: typeof saved.username === 'string' ? saved.username : '' };
          enabled.value = saved.enabled === true;
          autoSync.value = saved.autoSync !== false;
          sessionReady = !config.value.username;
        }
      }
    } catch {
      error.value = '同步配置读取失败，请重新保存设置';
    }
    buildEngine();
  }

  function initialize() {
    if (initialized) return initialized;
    initialized = (async () => {
      restoreSavedConfig();
      subscribeMetadataChanges(changed);
      window.addEventListener('storage', event => {
        if (event.key !== null && event.key !== CONFIG_KEY) return;
        restoreSavedConfig();
        void captureChanges().then(scheduleNetwork);
      });
      window.addEventListener('online', scheduleNetwork);
      window.addEventListener('focus', scheduleNetwork);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleNetwork(); });
      watch(() => reader.currentBook?.id, (id, previous) => { if (previous && id !== previous) changed(); });
      setInterval(scheduleNetwork, REFRESH_INTERVAL);
      await captureChanges();
      scheduleNetwork();
    })();
    return initialized;
  }

  async function saveConfig(next: SavedConfig & { password: string }) {
    await initialize();
    if (status.value === 'syncing' || status.value === 'testing') throw new Error('请等待当前同步完成');
    error.value = '';
    try {
      const url = next.url.trim() ? normalizeWebDavUrl(next.url) : '';
      if (next.enabled && !url) throw new Error('请输入完整的 WebDAV 文件夹地址');
      if (url) new WebDavClient({ url, username: next.username, password: next.password });
      const saved = { url, username: next.username, enabled: next.enabled, autoSync: next.autoSync };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(saved));
      resetTimers();
      config.value = { url, username: next.username };
      password.value = next.password;
      enabled.value = next.enabled;
      autoSync.value = next.autoSync;
      sessionReady = true;
      buildEngine();
      status.value = 'idle';
      await captureChanges();
      scheduleNetwork();
    } catch (failure) {
      error.value = message(failure);
      status.value = 'error';
      throw failure;
    }
  }

  async function testConnection() {
    await initialize();
    if (status.value === 'syncing' || status.value === 'testing') return;
    status.value = 'testing';
    error.value = '';
    const current = generation;
    try {
      await new WebDavClient({ ...config.value, password: password.value }).testConnection();
      if (generation !== current) return;
      sessionReady = true;
      status.value = 'idle';
    } catch (failure) {
      if (generation === current) {
        error.value = message(failure);
        status.value = 'error';
      }
      throw failure;
    }
  }

  async function syncNow() {
    await initialize();
    if (status.value === 'syncing' || status.value === 'testing') return;
    if (!enabled.value || !engine.value) {
      error.value = '请先保存并启用 WebDAV 同步';
      throw new Error(error.value);
    }
    const current = generation;
    const target = engine.value;
    status.value = 'syncing';
    error.value = '';
    lastAttempt = Date.now();
    try {
      const client = new WebDavClient({ ...config.value, password: password.value });
      const stats = await exclusive(() => target.sync(client));
      if (current !== generation) return;
      applyStats(stats);
      await shelf.refreshSyncedMetadata();
      sessionReady = true;
      status.value = 'idle';
    } catch (failure) {
      if (current === generation) {
        error.value = message(failure);
        status.value = 'error';
      }
      throw failure;
    } finally {
      if (current === generation) await captureChanges();
    }
  }

  async function clearConfig() {
    await initialize();
    if (status.value === 'syncing' || status.value === 'testing') throw new Error('请等待当前同步完成');
    try {
      localStorage.removeItem(CONFIG_KEY);
      resetTimers();
      generation++;
      engine.value = null;
      config.value = { url: '', username: '' };
      password.value = '';
      enabled.value = false;
      sessionReady = false;
      pendingCount.value = matchedCount.value = unmatchedCount.value = remoteOnlyCount.value = 0;
      lastSyncAt.value = null;
      error.value = '';
      status.value = 'idle';
    } catch (failure) {
      error.value = message(failure);
      throw failure;
    }
  }

  return {
    config, password, enabled, autoSync, status, error, lastSyncAt,
    pendingCount, matchedCount, unmatchedCount, remoteOnlyCount,
    initialize, saveConfig, testConnection, syncNow, clearConfig
  };
});
