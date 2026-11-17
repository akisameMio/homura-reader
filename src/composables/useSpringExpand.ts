/* ============================================================================
   HOMURA · 条件行的物理弹簧展开 / 收起
   ----------------------------------------------------------------------------
   高度与透明度由同一个物理轴驱动：展开带轻微过冲（ζ < 1），收起临界阻尼直接
   合拢，避免固定时长贝塞尔在长列表里显得生硬。位移直接写 DOM，不触发重渲染。
   每一行各自持有弹簧状态，同一张卡片里多行同时进出互不覆盖。
   行内的上下 padding 同步缩放：border-box 下 padding 会把高度撑出地板值，
   不跟着收会让收起在末尾跳一下。
   展开时如果行会超出滚动容器，按同一弹簧进度推进 scrollTop，让滚动条跟着长，
   而不是等动画结束才把内容露出来。
   减少动态效果时直接落位；打断时先取消该元素的上一段弹簧再接管。
   ========================================================================== */

import { onBeforeUnmount } from 'vue';
import { makeAxis, prefersReducedMotion, runSpring } from '../services/spring.ts';

const EXPAND = { stiffness: 380, damping: 0.66, posEpsilon: 0.3, velEpsilon: 6 };
const COLLAPSE = { stiffness: 620, damping: 1, posEpsilon: 0.3, velEpsilon: 6 };
// 展开后底边留一点余量，避免新行紧贴容器下沿
const SCROLL_EDGE_GAP = 8;

export function useSpringExpand() {
  interface ExpandState {
    cancel: (() => void) | null;
    done: (() => void) | null;
    padTop: number;
    padBottom: number;
    scroller: HTMLElement | null;
    baseScroll: number;
    extraScroll: number;
    anchorPrev: string;
  }
  const states = new Map<HTMLElement, ExpandState>();

  function measurePadding(node: HTMLElement) {
    const style = getComputedStyle(node);
    return {
      padTop: Number.parseFloat(style.paddingTop) || 0,
      padBottom: Number.parseFloat(style.paddingBottom) || 0
    };
  }

  /**
   * 进入 / 离场时元素已挂载，此时读到的 padding 才是真实值。
   * before-enter 阶段元素尚未插入文档，getComputedStyle 只能拿到 0。
   */
  function stateOf(node: HTMLElement) {
    let state = states.get(node);
    if (!state) {
      state = { cancel: null, done: null, padTop: 0, padBottom: 0, scroller: null, baseScroll: 0, extraScroll: 0, anchorPrev: '' };
    }
    Object.assign(state, measurePadding(node));
    states.set(node, state);
    return state;
  }

  /** 找到真正滚动的祖先：抽屉或手机面板的内容区 */
  function findScroller(node: HTMLElement) {
    let parent = node.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      // 当前内容可能还没溢出（行高为 0），不能拿 scrollHeight 当判据
      if (/(auto|scroll)/.test(style.overflowY)) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  /**
   * 预约展开需要的滚动距离：行底边若会越过容器可视区，就按弹簧进度把内容往上顶，
   * 起点固定、进度线性推进，滚动条和卡片同时长出来。
   */
  function planScroll(node: HTMLElement, state: ExpandState, target: number) {
    const scroller = findScroller(node);
    state.scroller = scroller;
    state.baseScroll = scroller?.scrollTop ?? 0;
    state.extraScroll = 0;
    if (!scroller) return;
    // 高度每帧变化会触发滚动锚定重算，动画期间先关掉
    state.anchorPrev = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = 'none';
    // 提到合成层，重绘交给渲染线程，避免主线程每帧重画整块抽屉
    scroller.style.willChange = 'transform';
    const visibleBottom = scroller.getBoundingClientRect().bottom - SCROLL_EDGE_GAP;
    state.extraScroll = Math.max(0, node.getBoundingClientRect().top + target - visibleBottom);
  }

  function restoreScroller(state: ExpandState | undefined) {
    if (!state?.scroller) return;
    state.scroller.style.overflowAnchor = state.anchorPrev;
    state.scroller.style.willChange = '';
  }

  function applyScroll(state: ExpandState, ratio: number) {
    if (!state.scroller || !state.extraScroll) return;
    const target = Math.round(state.baseScroll + state.extraScroll * ratio);
    // 少于 2px 不动：每帧写 scrollTop 会逼着整个滚动层重绘
    if (Math.abs(target - state.scroller.scrollTop) < 2) return;
    state.scroller.scrollTop = target;
  }

  function applyPadding(node: HTMLElement, state: ExpandState, ratio: number) {
    // 取整到 CSS px：WebKit 每次亚像素重排都会重绘文字，慢速尾段会看着发抖
    node.style.paddingTop = `${Math.round(state.padTop * ratio)}px`;
    node.style.paddingBottom = `${Math.round(state.padBottom * ratio)}px`;
  }

  function clearStyles(el: HTMLElement) {
    el.style.height = '';
    el.style.opacity = '';
    el.style.overflow = '';
    el.style.willChange = '';
    el.style.paddingTop = '';
    el.style.paddingBottom = '';
    el.style.contain = '';
  }

  /** 取消进行中的弹簧，并假定被打断的那段转场已经结束 */
  function settle(node: Element | null) {
    if (!(node instanceof HTMLElement)) return;
    const state = states.get(node);
    states.delete(node);
    state?.cancel?.();
    restoreScroller(state);
    clearStyles(node);
    const done = state?.done;
    done?.();
  }

  function prepare(el: Element) {
    const node = el as HTMLElement;
    settle(node);
    node.style.overflow = 'hidden';
    // 动画期间把布局 / 重绘的影响限制在这一行内
    node.style.contain = 'layout paint';
    node.style.willChange = 'height, opacity, padding';
    return node;
  }

  function onBeforeEnter(el: Element) {
    const node = prepare(el);
    if (prefersReducedMotion()) return;
    // 先藏起来再测量，避免插入当帧露出整行
    node.style.height = '0px';
    node.style.opacity = '0';
  }

  function onEnter(el: Element, done: () => void) {
    const node = el as HTMLElement;
    if (prefersReducedMotion()) {
      clearStyles(node);
      done();
      return;
    }
    const state = stateOf(node);
    node.style.height = 'auto';
    node.style.opacity = '';
    const target = node.offsetHeight;
    if (!target) {
      clearStyles(node);
      done();
      return;
    }
    node.style.height = '0px';
    node.style.opacity = '0';
    applyPadding(node, state, 0);
    planScroll(node, state, target);
    state.done = done;
    const spring = makeAxis(0, EXPAND.stiffness);
    spring.target = target;
    const apply = () => {
      const pos = Math.max(0, spring.pos);
      node.style.height = `${Math.round(pos)}px`;
      node.style.opacity = String(Math.min(1, pos / target));
      applyPadding(node, state, Math.min(1, pos / target));
      applyScroll(state, Math.min(1, pos / target));
    };
    apply();
    state.cancel = runSpring([spring], apply, () => {
      states.delete(node);
      restoreScroller(state);
      clearStyles(node);
      done();
    }, EXPAND);
  }

  function onBeforeLeave(el: Element) {
    const node = prepare(el);
    if (prefersReducedMotion()) return;
    const state = stateOf(node);
    node.style.paddingTop = `${state.padTop}px`;
    node.style.paddingBottom = `${state.padBottom}px`;
    node.style.height = `${node.offsetHeight}px`;
  }

  function onLeave(el: Element, done: () => void) {
    const node = el as HTMLElement;
    const from = node.offsetHeight;
    if (prefersReducedMotion() || !from) {
      clearStyles(node);
      done();
      return;
    }
    const state = stateOf(node);
    state.done = done;
    const spring = makeAxis(from, COLLAPSE.stiffness);
    spring.target = 0;
    const apply = () => {
      const pos = Math.max(0, spring.pos);
      node.style.height = `${Math.round(pos)}px`;
      node.style.opacity = String(Math.min(1, pos / from));
      applyPadding(node, state, Math.min(1, pos / from));
    };
    apply();
    state.cancel = runSpring([spring], apply, () => {
      states.delete(node);
      restoreScroller(state);
      clearStyles(node);
      done();
    }, { ...COLLAPSE, stopWhen: () => spring.pos <= 0.6 });
  }

  // 组件卸载时不要回调节目转场的 done，避免对已移除的节点触发后续钩子。
  onBeforeUnmount(() => {
    for (const [node, state] of states) {
      state.cancel?.();
      restoreScroller(state);
      clearStyles(node);
    }
    states.clear();
  });

  return {
    onBeforeEnter,
    onEnter,
    onBeforeLeave,
    onLeave,
    onCancelled: settle
  };
}
