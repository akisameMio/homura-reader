/* ============================================================================
   HOMURA · 阅读器预见式返回
   ----------------------------------------------------------------------------
   Android 14+ 直接消费系统 BackEvent.progress / swipeEdge，逐帧写 CSS 变量，
   与全面屏返回的边缘形变指示器共用进度源；其他环境保留 pointer 手势回退。
   全过程不触发 Vue 响应式重渲染。
   ========================================================================== */

import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { isAndroid } from '../services/platform.ts';
import { registerReaderBackHandler } from './useAndroidBackExit.ts';

const COMMIT_RATIO = 0.28;
const FLING_VELOCITY = 0.52;
const MIN_FLING_DISTANCE = 24;
const SETTLE_DURATION = 300;
const READER_SCALE_DELTA = 0.055;
const READER_RADIUS = 26;
const LIBRARY_MAX_OFFSET = 28;
const SCRIM_OPACITY = 1;
const READER_BACK_DIRECTION = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface ReaderLike {
  currentBook: unknown;
  closeReader: () => void;
}
interface UiLike {
  readerDrawerOpen: boolean;
  settingsOpen: boolean;
  tocOpen: boolean;
  fontMenuOpen?: boolean;
  closeSettings: () => void;
  closeToc: () => void;
  closeFontMenu?: () => void;
}
interface BackGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  lastX: number;
  lastTime: number;
  axis: 'x' | null;
  active: boolean;
}
interface NativeBackEvent {
  phase?: string;
  progress?: number;
}
interface TauriChannelCtor {
  new (handler: (event: NativeBackEvent) => void): unknown;
}

interface TauriCoreLike {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  Channel?: TauriChannelCtor;
}

export function useReaderBackDismiss(reader: ReaderLike, ui: UiLike) {
  let gesture: BackGesture | null = null;
  let settling = false;
  let closing = false;
  let settleToken = 0;
  let frameId = 0;
  let pendingProgress = 0;
  let pendingDirection = 1;
  let activeDirection = 1;
  let nativeMode: string | null = null;
  let nativeChannel: unknown = null;
  let nativeEnableToken = 0;
  const nativePredictiveBackSupported = ref(false);

  function applyProgress(progress: number, direction = activeDirection) {
    const width = window.innerWidth || 375;
    const p = clamp(progress, 0, 1);
    const side = direction < 0 ? -1 : 1;
    const rootStyle = document.documentElement.style;

    rootStyle.setProperty('--homura-back-reader-x', `${side * p * width}px`);
    rootStyle.setProperty('--homura-back-reader-scale', `${1 - READER_SCALE_DELTA * p}`);
    rootStyle.setProperty('--homura-back-reader-radius', `${READER_RADIUS * p}px`);
    rootStyle.setProperty(
      '--homura-back-library-x',
      `${side * Math.min(LIBRARY_MAX_OFFSET, width * 0.06) * (1 - p)}px`
    );
    rootStyle.setProperty('--homura-back-scrim-opacity', `${SCRIM_OPACITY * (1 - p)}`);
  }

  function queueProgress(progress: number, direction = activeDirection) {
    pendingProgress = progress;
    pendingDirection = direction;
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      applyProgress(pendingProgress, pendingDirection);
    });
  }

  function resetVisuals() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    pendingProgress = 0;
    pendingDirection = 1;
    activeDirection = 1;
    document.documentElement.classList.remove('reader-back-settling');
    document.documentElement.classList.remove('reader-back-entering');
    applyProgress(0, activeDirection);
  }

  function playEnter() {
    if (!reader.currentBook) return;
    closing = false;
    const token = ++settleToken;
    const reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      resetVisuals();
      settling = false;
      return;
    }

    settling = true;
    cancelAnimationFrame(frameId);
    frameId = 0;
    resetVisuals();
    document.documentElement.classList.add('reader-back-entering');

    window.setTimeout(() => {
      if (token !== settleToken) return;
      document.documentElement.classList.remove('reader-back-entering');
      settling = false;
    }, SETTLE_DURATION);
  }

  function releasePointer(e: PointerEvent) {
    const target = e.currentTarget as Element | null;
    if (target && target.releasePointerCapture) {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  }

  function clearGesture(e: PointerEvent | null) {
    if (e) releasePointer(e);
    gesture = null;
  }

  function settle(commit: boolean) {
    if (settling) return;
    settling = true;
    closing = commit;
    const token = ++settleToken;
    const reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      resetVisuals();
      if (commit) {
        disableNativePredictiveBack();
        reader.closeReader();
      }
      closing = false;
      settling = false;
      return;
    }

    cancelAnimationFrame(frameId);
    frameId = 0;
    document.documentElement.classList.remove('reader-back-entering');
    document.documentElement.classList.add('reader-back-settling');
    applyProgress(commit ? 1 : 0, activeDirection);

    window.setTimeout(async () => {
      if (token !== settleToken) return;
      if (commit) {
        // 先摘掉原生回调再关书，避免退出动画最后一帧被新的返回事件截胡
        await disableNativePredictiveBack();
        reader.closeReader();
        await nextTick();
      }
      if (token !== settleToken) return;
      resetVisuals();
      closing = false;
      settling = false;
    }, SETTLE_DURATION);
  }

  function onPointerDown(e: PointerEvent) {
    if (settling || !reader.currentBook || ui.readerDrawerOpen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    activeDirection = 1;
    gesture = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      lastX: e.clientX,
      lastTime: performance.now(),
      axis: null,
      active: false
    };
    try {
      (e.currentTarget as Element | null)?.setPointerCapture(e.pointerId);
    } catch (err) {}
    e.stopPropagation();
  }

  function onPointerMove(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;

    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!gesture.axis && (absX > 6 || absY > 6)) {
      if (dx > 0 && absX > absY * 1.15) {
        gesture.axis = 'x';
        gesture.active = true;
      } else if (absY > absX) {
        // 纵向滑动交还给条漫原生滚动
        clearGesture(e);
        return;
      }
    }
    if (gesture.axis !== 'x') return;

    e.preventDefault();
    e.stopPropagation();
    gesture.lastX = e.clientX;
    gesture.lastTime = performance.now();
    queueProgress(dx / (window.innerWidth || 375));
  }

  function finishGesture(e: PointerEvent, cancelled = false) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const current = gesture;
    clearGesture(e);

    if (!current.active) return;
    const dx = current.lastX - current.startX;
    const elapsed = Math.max(1, current.lastTime - current.startTime);
    const velocity = dx / elapsed;
    const progress = dx / (window.innerWidth || 375);
    const commit = !cancelled && (
      progress >= COMMIT_RATIO
      || (velocity >= FLING_VELOCITY && dx >= MIN_FLING_DISTANCE)
    );

    e.preventDefault();
    e.stopPropagation();
    settle(commit);
  }

  function onPointerUp(e: PointerEvent) {
    finishGesture(e);
  }

  function onPointerCancel(e: PointerEvent) {
    finishGesture(e, true);
  }

  function onPointerLostCapture(e: PointerEvent) {
    if (gesture && e.pointerId === gesture.pointerId) finishGesture(e, true);
  }

  function dismissWithPredictiveBack() {
    if (!reader.currentBook || settling) return;
    activeDirection = 1;
    settle(true);
  }

  function hasOpenDrawer() {
    return ui.readerDrawerOpen;
  }

  function closeOpenDrawer() {
    if (ui.fontMenuOpen) ui.closeFontMenu?.();
    else if (ui.settingsOpen) ui.closeSettings();
    else if (ui.tocOpen) ui.closeToc();
  }

  function onNativeBackEvent(event: NativeBackEvent) {
    if (!reader.currentBook) return;
    const phase = event && event.phase;

    if (phase === 'started') {
      if (settling) {
        if (closing) return;
        settleToken++;
        settling = false;
        document.documentElement.classList.remove('reader-back-settling');
        document.documentElement.classList.remove('reader-back-entering');
      }
      // 左右全面屏返回统一向右退场，保持从两侧触发时的视觉方向一致。
      activeDirection = READER_BACK_DIRECTION;
      if (hasOpenDrawer()) {
        nativeMode = 'drawer';
        return;
      }

      nativeMode = 'reader';
      settleToken++;
      cancelAnimationFrame(frameId);
      frameId = 0;
      document.documentElement.classList.remove('reader-back-settling');
      document.documentElement.classList.remove('reader-back-entering');
      applyProgress(0, activeDirection);
      return;
    }

    if (phase === 'progressed') {
      if (nativeMode !== 'reader') return;
      activeDirection = READER_BACK_DIRECTION;
      applyProgress(Number(event.progress) || 0, activeDirection);
      return;
    }

    if (phase === 'cancelled') {
      nativeMode = null;
      closing = false;
      resetVisuals();
      return;
    }

    if (phase !== 'invoked') return;
    if (nativeMode === 'drawer') {
      nativeMode = null;
      closeOpenDrawer();
      return;
    }
    if (nativeMode !== 'reader') {
      if (hasOpenDrawer()) {
        closeOpenDrawer();
        return;
      }
      activeDirection = 1;
    }
    nativeMode = null;
    settle(true);
  }

  function onFallbackBack() {
    if (!reader.currentBook) return;
    if (hasOpenDrawer()) {
      closeOpenDrawer();
      return;
    }
    dismissWithPredictiveBack();
  }

  function getTauriCore() {
    return window.__TAURI__ && window.__TAURI__.core;
  }

  async function disableNativePredictiveBack() {
    nativeEnableToken++;
    nativeMode = null;
    if (!nativeChannel) return;
    nativeChannel = null;

    const core = getTauriCore();
    if (!core || typeof core.invoke !== 'function') return;
    try {
      await core.invoke('plugin:android-predictive-back|disable');
    } catch (err) {
      console.warn('[HOMURA] 关闭 Android 预见式返回失败', err);
    }
  }

  async function enableNativePredictiveBack() {
    if (!nativePredictiveBackSupported.value || nativeChannel || !reader.currentBook) return;
    const core = getTauriCore() as TauriCoreLike | null;
    if (!core || !core.Channel || typeof core.invoke !== 'function') return;

    const token = ++nativeEnableToken;
    const channel = new core.Channel(onNativeBackEvent);
    nativeChannel = channel;
    try {
      await core.invoke('plugin:android-predictive-back|enable', { handler: channel });
      // 注册期间阅读器可能已经关闭，迟到的 enable 必须自己撤销
      if (token !== nativeEnableToken || !reader.currentBook) {
        if (nativeChannel === channel) nativeChannel = null;
        await core.invoke('plugin:android-predictive-back|disable').catch(() => {});
      }
    } catch (err) {
      nativeChannel = null;
      console.warn('[HOMURA] 启用 Android 预见式返回失败，回退到常驻返回监听', err);
      nativePredictiveBackSupported.value = false;
    }
  }

  async function initializeAndroidBack() {
    if (!isAndroid) return;

    const core = getTauriCore() as TauriCoreLike | null;
    if (!core || !core.Channel || typeof core.invoke !== 'function') return;

    try {
      const result = await core.invoke('plugin:android-predictive-back|supported');
      if (result && result.supported) {
        nativePredictiveBackSupported.value = true;
        await enableNativePredictiveBack();
      }
    } catch (err) {
      console.warn('[HOMURA] 查询 Android 预见式返回能力失败，回退到常驻返回监听', err);
    }
  }

  watch(
    () => reader.currentBook,
    (book, previousBook) => {
      settleToken++;
      gesture = null;
      closing = false;
      settling = false;
      if (book && !previousBook) playEnter();
      else resetVisuals();

      if (!book) {
        disableNativePredictiveBack();
      } else if (nativePredictiveBackSupported.value) {
        enableNativePredictiveBack();
      }
    }
  );

  // 应用级返回监听始终存在，低版本及原生回调失效时由它转发到阅读器。
  const unregisterReaderBackHandler = registerReaderBackHandler(onFallbackBack);
  initializeAndroidBack();

  onBeforeUnmount(() => {
    settleToken++;
    nativeEnableToken++;
    unregisterReaderBackHandler();
    cancelAnimationFrame(frameId);
    disableNativePredictiveBack();
    document.documentElement.classList.remove('reader-back-settling');
    document.documentElement.classList.remove('reader-back-entering');
  });

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLostCapture,
    dismissWithPredictiveBack,
    nativePredictiveBackSupported
  };
}
