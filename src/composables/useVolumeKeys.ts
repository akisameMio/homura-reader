/* ============================================================================
   HOMURA · Android 音量键翻页
   ----------------------------------------------------------------------------
   音量键在 WebView 里收不到 keydown，必须由原生插件拦截后经 Channel 回传。
   只有「Android + 阅读器打开 + 开关开启 + 抽屉关闭」时才注册监听：
   抽屉打开时主动撤销，把音量键还给系统音量调节。
   ========================================================================== */

import { onBeforeUnmount, watch } from 'vue';
import { isAndroid } from '../services/platform.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useUiStore } from '../stores/ui.ts';
import type { useReaderStore } from '../stores/reader.ts';

type ReaderStore = ReturnType<typeof useReaderStore>;
type UiStore = ReturnType<typeof useUiStore>;

interface VolumeKeyEvent {
  direction?: string;
}

interface TauriChannelCtor {
  new (handler: (event: VolumeKeyEvent) => void): unknown;
}

interface TauriCoreLike {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  Channel?: TauriChannelCtor;
}

function getTauriCore() {
  return (window.__TAURI__ && window.__TAURI__.core) as TauriCoreLike | null;
}

export function useVolumeKeys(reader: ReaderStore, ui: UiStore) {
  const settings = useSettingsStore();
  let channel: unknown = null;
  let enableToken = 0;
  // enable / disable 都是异步 IPC；快速开关抽屉时若并发下发，原生端可能以
  // disable 先、enable 后的顺序执行，导致抽屉打开后音量键仍被吞掉。
  let pending: Promise<void> = Promise.resolve();

  function enqueue(task: () => Promise<void>) {
    pending = pending.then(task, task).catch(err => {
      console.warn('[HOMURA] 同步 Android 音量键监听失败', err);
    });
  }

  function onVolumeKey(event: VolumeKeyEvent) {
    if (!reader.currentBook || reader.openingBook) return;
    if (ui.readerDrawerOpen) return;
    if (event && event.direction === 'prev') reader.goPrevPage();
    else reader.goNextPage();
  }

  function shouldListen() {
    return isAndroid && settings.volumeKeysTurnPage && !!reader.currentBook && !ui.readerDrawerOpen;
  }

  async function enable() {
    // 已经注册过就不再重建 Channel，避免重复 invoke
    if (!isAndroid || channel) return;
    const core = getTauriCore();
    if (!core || !core.Channel || typeof core.invoke !== 'function') return;

    const token = ++enableToken;
    const next = new core.Channel(onVolumeKey);
    channel = next;
    try {
      await core.invoke('plugin:android-volume-keys|enable', { handler: next });
      // 注册期间可能已经关书 / 开抽屉，迟到的 enable 必须自己撤销
      if (token !== enableToken || !shouldListen()) {
        // 只有当前仍是自己注册的会话才撤销；若期间已有更新的 enable 接管，
        // 这里再 disable 会把新会话一起关掉。
        if (channel === next) {
          channel = null;
          await core.invoke('plugin:android-volume-keys|disable').catch(() => {});
        }
      }
    } catch (err) {
      // 失败的可能是一次已被新会话接管的旧 enable，不能把新 channel 清掉
      if (channel === next) channel = null;
      console.warn('[HOMURA] 启用 Android 音量键翻页失败', err);
    }
  }

  async function disable() {
    enableToken++;
    if (!channel) return;
    channel = null;
    const core = getTauriCore();
    if (!core || typeof core.invoke !== 'function') return;
    try {
      await core.invoke('plugin:android-volume-keys|disable');
    } catch (err) {
      console.warn('[HOMURA] 关闭 Android 音量键翻页失败', err);
    }
  }

  watch(
    shouldListen,
    () => {
      // 在执行时再读 shouldListen，保证队列里的任务反映最新状态
      enqueue(() => (shouldListen() ? enable() : disable()));
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    enqueue(disable);
  });
}
