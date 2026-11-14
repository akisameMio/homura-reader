/* ============================================================================
   HOMURA · Sheet 物理弹簧入场 / 收场
   ----------------------------------------------------------------------------
   用 spring.ts 的临界阻尼弹簧驱动 transform，替代固定时长的贝塞尔过渡：
   入场从卡片外侧弹回静止位，收场加速滑出；位移直接写 DOM，不触发重渲染。
   减少动态效果时直接落位；拖拽关闭已把卡片移出屏幕时跳过二次离场。
   ========================================================================== */

import { onBeforeUnmount } from 'vue';
import { makeAxis, prefersReducedMotion, runSpring } from '../services/spring.ts';

const ENTER_SPRING = { stiffness: 380, damping: 0.86, posEpsilon: 0.4, velEpsilon: 14 };
const LEAVE_SPRING = { stiffness: 760, damping: 1, posEpsilon: 0.4, velEpsilon: 14 };
// 弹簧末端允许越过静止位 2px，保留一点回弹手感，又不至于在底边 / 右侧露缝
const MAX_OVERSHOOT = 2;

interface SheetSpringOptions {
  isCompact: { value: boolean };
  /** 更新日志这类“外层负责遮罩、内层负责滑动”的结构，传入面板定位函数 */
  panel?: (root: HTMLElement) => HTMLElement | null;
  /** 让外层遮罩随面板进度淡入淡出 */
  fadeRoot?: boolean;
}

export function useSheetSpring({ isCompact, panel, fadeRoot = false }: SheetSpringOptions) {
  let rootEl: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;
  let cancelSpring: (() => void) | null = null;
  let enterDone: (() => void) | null = null;
  let currentPos = 0;
  let skipLeave = false;

  function axis() {
    return isCompact.value ? 'y' : 'x';
  }

  function applyTransform(node: HTMLElement, direction: 'x' | 'y', value: number) {
    node.style.transform = direction === 'x'
      ? `translate3d(${value.toFixed(2)}px, 0, 0)`
      : `translate3d(0, ${value.toFixed(2)}px, 0)`;
  }

  function applyFade(progress: number) {
    if (!fadeRoot || !rootEl) return;
    rootEl.style.opacity = String(Math.min(1, Math.max(0, 1 - progress)));
  }

  function clearMotion() {
    cancelSpring?.();
    cancelSpring = null;
    if (panelEl) {
      panelEl.style.transform = '';
      panelEl.style.transition = '';
      panelEl.style.willChange = '';
    }
    if (fadeRoot && rootEl) rootEl.style.opacity = '';
    currentPos = 0;
  }

  function settleEnter() {
    const done = enterDone;
    enterDone = null;
    clearMotion();
    done?.();
  }

  function onBeforeEnter(el: Element) {
    rootEl = el as HTMLElement;
    panelEl = panel ? panel(rootEl) : rootEl;
    skipLeave = false;
    currentPos = 0;
    if (!panelEl) return;
    panelEl.style.transition = 'none';
    panelEl.style.willChange = 'transform';
    // beforeEnter 阶段还未插入 DOM，先用 100% 兜底，enter 里再按实际尺寸重算
    panelEl.style.transform = axis() === 'x' ? 'translate3d(100%, 0, 0)' : 'translate3d(0, 100%, 0)';
    if (fadeRoot && rootEl) rootEl.style.opacity = '0';
  }

  function onEnter(_el: Element, done: () => void) {
    enterDone = done;
    if (!panelEl) {
      enterDone = null;
      done();
      return;
    }
    const direction = axis();
    const distance = direction === 'x' ? panelEl.offsetWidth : panelEl.offsetHeight;
    if (prefersReducedMotion() || !distance) {
      settleEnter();
      return;
    }
    const spring = makeAxis(distance, ENTER_SPRING.stiffness);
    spring.target = 0;
    const apply = () => {
      currentPos = Math.max(0, spring.pos);
      applyTransform(panelEl!, direction, Math.max(-MAX_OVERSHOOT, spring.pos));
      applyFade(spring.pos / distance);
    };
    apply();
    cancelSpring = runSpring([spring], apply, () => {
      cancelSpring = null;
      enterDone = null;
      clearMotion();
      done();
    }, ENTER_SPRING);
  }

  function onBeforeLeave(el: Element) {
    if (enterDone) settleEnter();
    if (rootEl !== el) {
      rootEl = el as HTMLElement;
      panelEl = panel ? panel(rootEl) : rootEl;
    }
    if (!panelEl) return;
    panelEl.style.transition = 'none';
    panelEl.style.willChange = 'transform';
    const rect = panelEl.getBoundingClientRect();
    // 拖拽关闭已经把卡片推出屏幕时不再播第二遍离场
    skipLeave = isCompact.value ? rect.top >= window.innerHeight - 2 : rect.left >= window.innerWidth - 2;
  }

  function onLeave(_el: Element, done: () => void) {
    if (!panelEl) {
      done();
      return;
    }
    const direction = axis();
    const distance = (direction === 'x' ? panelEl.offsetWidth : panelEl.offsetHeight) || 0;
    if (skipLeave || prefersReducedMotion() || !distance) {
      panelEl.style.transform = direction === 'x' ? 'translate3d(100%, 0, 0)' : 'translate3d(0, 100%, 0)';
      applyFade(1);
      done();
      return;
    }
    const spring = makeAxis(currentPos, LEAVE_SPRING.stiffness);
    spring.target = distance;
    const apply = () => {
      applyTransform(panelEl!, direction, Math.max(0, spring.pos));
      applyFade(spring.pos / distance);
    };
    apply();
    cancelSpring = runSpring([spring], apply, () => {
      cancelSpring = null;
      applyTransform(panelEl!, direction, distance);
      applyFade(1);
      done();
    }, { ...LEAVE_SPRING, stopWhen: () => spring.pos >= distance - 6 });
  }

  function onAfterLeave() {
    clearMotion();
    rootEl = null;
    panelEl = null;
    skipLeave = false;
  }

  function onLeaveCancelled() {
    clearMotion();
  }

  onBeforeUnmount(() => {
    cancelSpring?.();
    cancelSpring = null;
  });

  return {
    onBeforeEnter,
    onEnter,
    onBeforeLeave,
    onLeave,
    onAfterLeave,
    onLeaveCancelled,
    /** 拖拽起手时让进行中的入场弹簧直接落位，避免两套位移互相覆盖 */
    cancel: settleEnter
  };
}
