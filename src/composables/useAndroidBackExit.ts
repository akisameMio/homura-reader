/* ============================================================================
   HOMURA · Android 主页返回退出
   ----------------------------------------------------------------------------
   常驻监听系统返回，阅读器打开时交给阅读器处理；
   主页第一次按返回只提示，短时间内再按一次才退出。
   ========================================================================== */

import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { isAndroid } from '../services/platform.ts';
import { t } from './useI18n.ts';
import type { useReaderStore } from '../stores/reader.ts';

type ReaderStore = ReturnType<typeof useReaderStore>;
type BackListener = (() => void) | { unregister: () => void } | null;
export interface NativeBackEvent {
  phase: 'started' | 'progressed' | 'cancelled' | 'invoked';
  progress?: number;
  touchX?: number;
  frameTimeMillis?: number;
}
type PredictiveHandler = (event: NativeBackEvent) => void;
interface SettingsBack {
  enabled: () => boolean;
  handle: PredictiveHandler;
}
let readerBackHandler: (() => void) | null = null;
let readerPredictiveHandler: PredictiveHandler | null = null;

export function registerReaderBackHandler(handler: () => void, predictiveHandler: PredictiveHandler) {
  readerBackHandler = handler;
  readerPredictiveHandler = predictiveHandler;
  return () => {
    if (readerBackHandler !== handler) return;
    readerBackHandler = null;
    readerPredictiveHandler = null;
  };
}

const EXIT_CONFIRM_WINDOW = 2000;
const EXIT_TOAST_TEXT = '再按一次退出';

export function useAndroidBackExit(reader: ReaderStore, dismissOverlay: () => boolean, settingsBack?: SettingsBack) {
  const nativePredictiveBackSupported = ref(false);
  let nativeChannel: unknown;
  let nativeChannelConfigured = false;
  let nativeEnabled = false;
  let disposed = false;
  let registration = Promise.resolve();
  let gestureHandler: PredictiveHandler | null = null;
  let gestureStarted = false;
  let gestureInterrupted = false;
  let backListener: BackListener = null;
  let backListenerToken = 0;
  let lastBackAt = 0;
  let exitRequested = false;

  function unregisterBackListener(listener: BackListener) {
    if (typeof listener === 'function') return listener();
    if (listener && typeof listener.unregister === 'function') return listener.unregister();
  }

  async function showExitToast() {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') return;

    try {
      await core.invoke('plugin:android-toast|show', { message: t(EXIT_TOAST_TEXT) });
    } catch (err) {
      console.warn('[HOMURA] 显示 Android 退出提示失败', err);
    }
  }

  async function exitApp() {
    if (exitRequested) return;
    exitRequested = true;

    const app = window.__TAURI__ && window.__TAURI__.app;
    try {
      if (!app || typeof app.exit !== 'function') throw new Error('Tauri app.exit 不可用');
      await app.exit(0);
    } catch (err) {
      exitRequested = false;
      console.warn('[HOMURA] Android 退出失败', err);
    }
  }

  function onBackButtonPress() {
    if (reader.currentBook) {
      readerBackHandler?.();
      return;
    }
    if (dismissOverlay && dismissOverlay()) {
      lastBackAt = 0;
      return;
    }

    const now = Date.now();
    if (now - lastBackAt <= EXIT_CONFIRM_WINDOW) {
      lastBackAt = 0;
      exitApp();
      return;
    }

    lastBackAt = now;
    showExitToast();
  }

  async function enableBackListener() {
    if (!isAndroid || backListener) return;

    const token = ++backListenerToken;
    const app = window.__TAURI__ && window.__TAURI__.app;
    if (!app || typeof app.onBackButtonPress !== 'function') return;

    try {
      const listener = await app.onBackButtonPress(onBackButtonPress);
      if (token !== backListenerToken) {
        await unregisterBackListener(listener);
        return;
      }
      backListener = listener;
    } catch (err) {
      console.warn('[HOMURA] 注册 Android 返回监听失败', err);
    }
  }

  function disableBackListener() {
    backListenerToken++;
    lastBackAt = 0;
    if (!backListener) return;

    const listener = backListener;
    backListener = null;
    Promise.resolve(unregisterBackListener(listener)).catch(err => {
      console.warn('[HOMURA] 注销 Android 返回监听失败', err);
    });
  }

  function currentPredictiveHandler() {
    if (reader.currentBook) return readerPredictiveHandler;
    return settingsBack?.enabled() ? settingsBack.handle : null;
  }

  function onNativeBack(event: NativeBackEvent) {
    if (disposed) return;
    if (event.phase === 'started') {
      gestureStarted = true;
      gestureInterrupted = false;
      gestureHandler = currentPredictiveHandler();
    }
    const handler = gestureStarted ? gestureHandler : currentPredictiveHandler();
    if (handler && !gestureInterrupted && handler === currentPredictiveHandler()) handler(event);
    else if (!handler && event.phase === 'invoked') onBackButtonPress();
    if (event.phase === 'invoked' || event.phase === 'cancelled') {
      if (event.phase === 'invoked') lastBackAt = 0;
      gestureStarted = false;
      gestureInterrupted = false;
      gestureHandler = null;
      syncNativeRegistration();
    }
  }

  function syncNativeRegistration() {
    const core = window.__TAURI__?.core;
    if (!nativeChannel || !core) return;
    // 插件只有一个通道，串行注册与注销，阅读器和设置页切换时沿用同一注册。
    registration = registration.then(async () => {
      const enabled = !disposed && nativePredictiveBackSupported.value
        && (!!currentPredictiveHandler() || gestureStarted);
      if (enabled === nativeEnabled) return;
      try {
        if (enabled) {
          // 同一个 JS Channel 重传会重建 Rust 消息序号，后续手势无法送达。
          await core.invoke('plugin:android-predictive-back|enable', nativeChannelConfigured ? {} : { handler: nativeChannel });
          nativeChannelConfigured = true;
        } else await core.invoke('plugin:android-predictive-back|disable');
        nativeEnabled = enabled;
      } catch (err) {
        if (enabled) nativePredictiveBackSupported.value = false;
        console.warn('[HOMURA] 更新 Android 预见式返回注册失败', err);
      }
    });
  }

  async function initializeNativeBack() {
    const core = window.__TAURI__?.core as {
      invoke: (cmd: string) => Promise<{ supported?: boolean }>;
      Channel?: new (handle: PredictiveHandler) => unknown;
    } | undefined;
    if (!isAndroid || !core?.Channel || !core.invoke) return;
    try {
      const result = await core.invoke('plugin:android-predictive-back|supported');
      if (disposed || !result?.supported) return;
      nativeChannel = new core.Channel(onNativeBack);
      nativePredictiveBackSupported.value = true;
      syncNativeRegistration();
    } catch (err) {
      console.warn('[HOMURA] 查询 Android 预见式返回能力失败，回退到常驻返回监听', err);
    }
  }

  watch(() => reader.currentBook, () => { lastBackAt = 0; });
  watch(currentPredictiveHandler, handler => {
    if (gestureHandler && gestureHandler !== handler && !gestureInterrupted) {
      gestureInterrupted = true;
      gestureHandler({ phase: 'cancelled' });
    }
    syncNativeRegistration();
  });

  onMounted(() => {
    enableBackListener();
    initializeNativeBack();
  });

  onBeforeUnmount(() => {
    disposed = true;
    syncNativeRegistration();
    disableBackListener();
  });

  return nativePredictiveBackSupported;
}
