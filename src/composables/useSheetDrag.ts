/* ============================================================================
   HOMURA · 手机底部 Sheet 双档位拖动
   ----------------------------------------------------------------------------
   顶部拖拽条和整个 Sheet 都能起手：向上拖升到状态栏下方的大档位，向下拖先
   收缩回默认档位，继续下拉才关闭。位移与高度直接写 DOM，避免手势期间触发
   响应式重渲染。只有非交互区域、滚动容器回到顶部时才接管，避免抢走按钮、
   滑条与内容滚动。
   ========================================================================== */

import { onBeforeUnmount, shallowRef, watch } from 'vue';

const SETTLE_MS = 200;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const DRAG_INTENT_PX = 8;
const FLICK_VELOCITY = 0.6;
const EXPAND_VELOCITY = 0.35;
// 这些元素自己消费触摸手势，不接管为 Sheet 拖动
const NO_DRAG_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[data-sheet-no-drag]'
].join(', ');

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

interface DragState {
  source: 'handle' | 'sheet';
  pointerId: number | null;
  touchId: number | null;
  captureTarget: HTMLElement | null;
  startY: number;
  startedAt: number;
  startHeight: number;
  currentHeight: number;
  baseHeight: number;
  maxHeight: number;
  offset: number;
  userSelect: string;
}

interface PendingGesture {
  pointerId: number | null;
  touchId: number | null;
  startX: number;
  startY: number;
  startedAt: number;
  scrollParent: HTMLElement | null;
}

export function useSheetDrag({ isCompact, isOpen, onClose, onDragBegin }: {
  isCompact: { value: boolean };
  isOpen: { value: boolean };
  onClose: () => void;
  onDragBegin?: () => void;
}) {
  const sheetRef = shallowRef<HTMLElement | null>(null);
  let drag: DragState | null = null;
  let pendingTouch: PendingGesture | null = null;
  let pendingMouse: PendingGesture | null = null;
  let motionTimer: ReturnType<typeof setTimeout> | null = null;
  let closeAfterDrag = false;
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | null = null;
  let detachSheet: (() => void) | null = null;
  let baseHeight = 0;

  function clearMotionTimer() {
    if (motionTimer) {
      clearTimeout(motionTimer);
      motionTimer = null;
    }
  }

  function releaseCapture(activeDrag: DragState) {
    if (!activeDrag.captureTarget || activeDrag.pointerId == null) return;
    try {
      activeDrag.captureTarget.releasePointerCapture?.(activeDrag.pointerId);
    } catch (e) {}
  }

  function resetMotion(keepHeight = false) {
    clearMotionTimer();
    const activeDrag = drag;
    drag = null;
    if (activeDrag) releaseCapture(activeDrag);
    pendingTouch = null;
    pendingMouse = null;
    const el = sheetRef.value;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
    el.style.willChange = '';
    el.style.userSelect = '';
    if (!keepHeight) el.style.height = '';
  }

  function findScrollParent(target: Element | null, boundary: HTMLElement) {
    let node: HTMLElement | null = target instanceof HTMLElement ? target : target?.parentElement ?? null;
    while (node && node !== boundary) {
      const overflowY = getComputedStyle(node).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    return null;
  }

  function beginDrag(options: {
    source: DragState['source'];
    startY: number;
    startedAt: number;
    offset: number;
    pointerId?: number | null;
    touchId?: number | null;
    captureTarget?: HTMLElement | null;
  }) {
    const el = sheetRef.value;
    if (!el) return;
    onDragBegin?.();
    clearMotionTimer();
    const startHeight = el.offsetHeight || baseHeight || 480;
    // 默认档没有内联高度；布局或视口变化后按当前实际高度刷新基层，避免回弹到旧尺寸。
    if (!el.style.height) baseHeight = startHeight;
    const maxHeight = readMaxHeight(el, startHeight);
    drag = {
      source: options.source,
      pointerId: options.pointerId ?? null,
      touchId: options.touchId ?? null,
      captureTarget: options.captureTarget ?? null,
      startY: options.startY,
      startedAt: options.startedAt,
      startHeight,
      currentHeight: startHeight,
      baseHeight: baseHeight || startHeight,
      maxHeight,
      offset: 0,
      userSelect: el.style.userSelect
    };
    el.style.transition = 'none';
    el.style.transform = 'translate3d(0, 0, 0)';
    el.style.willChange = 'transform';
    if (options.source === 'sheet') el.style.userSelect = 'none';
    updateDrag(options.startY + options.offset);
  }

  function readMaxHeight(el: HTMLElement, fallback: number) {
    const value = parseFloat(getComputedStyle(el).maxHeight);
    if (Number.isFinite(value) && value > 0) return value;
    return window.innerHeight || fallback;
  }

  function applyHeight(el: HTMLElement, height: number) {
    if (!drag) return;
    const next = Math.min(drag.maxHeight, Math.max(drag.baseHeight, height));
    el.style.height = `${Math.round(next)}px`;
  }

  function updateDrag(clientY: number) {
    const el = sheetRef.value;
    if (!drag || !el) return;
    const dy = clientY - drag.startY;
    if (dy < 0) {
      drag.currentHeight = Math.min(drag.maxHeight, drag.startHeight - dy);
      applyHeight(el, drag.currentHeight);
      drag.offset = 0;
      el.style.transform = 'translate3d(0, 0, 0)';
      return;
    }
    const shrinkable = Math.max(0, drag.startHeight - drag.baseHeight);
    const shrink = Math.min(dy, shrinkable);
    drag.currentHeight = drag.startHeight - shrink;
    if (shrink > 0) applyHeight(el, drag.currentHeight);
    drag.offset = Math.max(0, dy - shrink);
    el.style.transform = `translate3d(0, ${drag.offset}px, 0)`;
  }

  function settleBack() {
    const activeDrag = drag;
    drag = null;
    if (activeDrag) releaseCapture(activeDrag);
    pendingTouch = null;
    pendingMouse = null;
    const el = sheetRef.value;
    if (!el) return;
    const settleMs = prefersReducedMotion() ? 0 : SETTLE_MS;
    clearMotionTimer();
    const targetHeight = activeDrag?.startHeight ?? el.offsetHeight;
    el.style.transition = `height ${settleMs}ms ${EASE}, transform ${settleMs}ms ${EASE}`;
    el.style.height = `${Math.round(targetHeight)}px`;
    el.style.transform = 'translate3d(0, 0, 0)';
    motionTimer = setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
      el.style.userSelect = '';
      if (targetHeight <= (activeDrag?.baseHeight ?? 0) + 1) el.style.height = '';
    }, settleMs + 40);
  }

  function finishDrag() {
    const activeDrag = drag;
    if (!activeDrag) return;
    const el = sheetRef.value;
    const elapsed = Math.max(performance.now() - activeDrag.startedAt, 1);
    const velocity = activeDrag.offset / elapsed;
    const heightVelocity = (activeDrag.currentHeight - activeDrag.startHeight) / elapsed;
    const range = Math.max(1, activeDrag.maxHeight - activeDrag.baseHeight);
    const expansion = (activeDrag.currentHeight - activeDrag.baseHeight) / range;
    const expandable = activeDrag.maxHeight > activeDrag.baseHeight + 1;
    const closeThreshold = Math.min(112, (activeDrag.baseHeight || 480) * 0.22);
    const shouldClose = activeDrag.offset > closeThreshold || (activeDrag.offset > 24 && velocity > FLICK_VELOCITY);
    const snapToExpanded = !shouldClose
      && expandable
      && activeDrag.offset <= 0
      && (expansion > 0.5 || heightVelocity > EXPAND_VELOCITY);
    const targetHeight = snapToExpanded ? activeDrag.maxHeight : activeDrag.baseHeight;
    const heightChanged = Math.abs(activeDrag.currentHeight - targetHeight) > 0.5;
    const settleMs = prefersReducedMotion() ? 0 : SETTLE_MS;

    drag = null;
    releaseCapture(activeDrag);

    if (!el) {
      if (shouldClose) onClose();
      return;
    }

    clearMotionTimer();

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearMotionTimer();
      el.removeEventListener('transitionend', onTransitionEnd);
      el.style.userSelect = '';
      if (shouldClose) {
        // Sheet 已经移出屏幕，关闭时禁用二次离场动画，避免先弹回顶部再下滑
        closeAfterDrag = true;
        el.style.transition = 'none';
        el.style.transform = 'translate3d(0, 100%, 0)';
        onClose();
        return;
      }
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
      // 扩展档位保留内联高度，默认档位交还给 CSS 的 78dvh
      el.style.height = snapToExpanded ? `${Math.round(activeDrag.maxHeight)}px` : '';
    };
    const onTransitionEnd = (transitionEvent: TransitionEvent) => {
      if (transitionEvent.target !== el) return;
      if (transitionEvent.propertyName === 'transform' || transitionEvent.propertyName === 'height') finish();
    };

    el.style.transition = `height ${heightChanged ? settleMs : 0}ms ${EASE}, transform ${settleMs}ms ${EASE}`;
    el.addEventListener('transitionend', onTransitionEnd);
    requestAnimationFrame(() => {
      if (heightChanged) el.style.height = `${Math.round(targetHeight)}px`;
      el.style.transform = shouldClose ? 'translate3d(0, 100%, 0)' : 'translate3d(0, 0, 0)';
    });
    motionTimer = setTimeout(finish, settleMs + 40);
  }

  // 顶部拖拽条：走 pointer 事件，鼠标与触摸都能用
  function onDragStart(event: PointerEvent) {
    if (!isCompact.value || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (drag) return;
    const el = sheetRef.value;
    if (!el) return;

    const captureTarget = event.currentTarget as HTMLElement;
    beginDrag({
      source: 'handle',
      startY: event.clientY,
      startedAt: performance.now(),
      offset: 0,
      pointerId: event.pointerId,
      captureTarget
    });
    try {
      captureTarget.setPointerCapture?.(event.pointerId);
    } catch (e) {}
    event.preventDefault();
  }

  function onDragMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    updateDrag(event.clientY);
    event.preventDefault();
  }

  function onDragEnd(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    finishDrag();
  }

  function onDragCancel(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    settleBack();
  }

  // 整张 Sheet：触摸手势用 touch 事件，才能在手势开始时拦住原生滚动
  function onSheetTouchStart(event: TouchEvent) {
    if (!isCompact.value || !isOpen.value || drag) return;
    if (event.touches.length !== 1) {
      pendingTouch = null;
      return;
    }
    const el = sheetRef.value;
    const target = event.target instanceof Element ? event.target : null;
    if (!el || !target) return;
    if (target.closest('[data-sheet-drag-handle]') || target.closest(NO_DRAG_SELECTOR)) {
      pendingTouch = null;
      return;
    }
    const touch = event.touches[0];
    pendingTouch = {
      pointerId: null,
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startedAt: performance.now(),
      scrollParent: findScrollParent(target, el)
    };
  }

  function onSheetTouchMove(event: TouchEvent) {
    if (drag?.source === 'sheet') {
      const touchId = drag.touchId;
      const touch = Array.from(event.touches).find(item => item.identifier === touchId);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      updateDrag(touch.clientY);
      return;
    }
    const pending = pendingTouch;
    if (!pending) return;
    const touch = Array.from(event.touches).find(item => item.identifier === pending.touchId);
    if (!touch) return;
    const dx = touch.clientX - pending.startX;
    const dy = touch.clientY - pending.startY;
    if (Math.abs(dx) < DRAG_INTENT_PX && Math.abs(dy) < DRAG_INTENT_PX) return;
    // 横向手势交还给内容；滚动条不在顶部时上下拖动都交还给原生滚动
    if (Math.abs(dx) > Math.abs(dy)) {
      pendingTouch = null;
      return;
    }
    if (pending.scrollParent && pending.scrollParent.scrollTop > 0) {
      pendingTouch = null;
      return;
    }
    // 已经到最大档位时，向上拖动应该继续滚动内容
    const sheet = sheetRef.value;
    if (dy < 0 && sheet && sheet.offsetHeight >= readMaxHeight(sheet, sheet.offsetHeight) - 1) {
      pendingTouch = null;
      return;
    }
    if (!event.cancelable) {
      pendingTouch = null;
      return;
    }
    event.preventDefault();
    pendingTouch = null;
    beginDrag({
      source: 'sheet',
      startY: pending.startY,
      startedAt: pending.startedAt,
      offset: dy,
      touchId: touch.identifier
    });
  }

  function onSheetTouchEnd(event: TouchEvent) {
    pendingTouch = null;
    if (!drag || drag.source !== 'sheet') return;
    const ended = Array.from(event.changedTouches || []);
    if (drag.touchId != null && ended.length && !ended.some(touch => touch.identifier === drag?.touchId)) return;
    if (event.type === 'touchcancel') settleBack();
    else finishDrag();
  }

  // 整张 Sheet：鼠标拖拽走 pointer 事件，移动超过阈值后才接管
  function onSheetPointerDown(event: PointerEvent) {
    suppressClick = false;
    if (event.pointerType === 'touch' || !isCompact.value || !isOpen.value || drag) return;
    if (event.button !== 0) return;
    const el = sheetRef.value;
    const target = event.target instanceof Element ? event.target : null;
    if (!el || !target) return;
    if (target.closest('[data-sheet-drag-handle]') || target.closest(NO_DRAG_SELECTOR)) {
      pendingMouse = null;
      return;
    }
    pendingMouse = {
      pointerId: event.pointerId,
      touchId: null,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      scrollParent: findScrollParent(target, el)
    };
  }

  function onSheetPointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    if (drag) {
      if (drag.source !== 'sheet' || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      updateDrag(event.clientY);
      return;
    }
    const pending = pendingMouse;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const dx = event.clientX - pending.startX;
    const dy = event.clientY - pending.startY;
    if (Math.abs(dx) < DRAG_INTENT_PX && Math.abs(dy) < DRAG_INTENT_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      pendingMouse = null;
      return;
    }
    if (pending.scrollParent && pending.scrollParent.scrollTop > 0) {
      pendingMouse = null;
      return;
    }
    pendingMouse = null;
    const el = sheetRef.value;
    if (!el) return;
    // 已经到最大档位时，向上拖动应该继续滚动内容
    if (dy < 0 && el.offsetHeight >= readMaxHeight(el, el.offsetHeight) - 1) return;
    event.preventDefault();
    suppressClick = true;
    clearTimeout(suppressTimer ?? undefined);
    suppressTimer = setTimeout(() => {
      suppressClick = false;
    }, 350);
    beginDrag({
      source: 'sheet',
      startY: pending.startY,
      startedAt: pending.startedAt,
      offset: dy,
      pointerId: event.pointerId,
      captureTarget: el
    });
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch (e) {}
  }

  function onSheetPointerUp(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    if (pendingMouse && pendingMouse.pointerId === event.pointerId) {
      pendingMouse = null;
      return;
    }
    if (!drag || drag.source !== 'sheet' || drag.pointerId !== event.pointerId) return;
    finishDrag();
  }

  function onSheetPointerCancel(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    pendingMouse = null;
    if (!drag || drag.source !== 'sheet' || drag.pointerId !== event.pointerId) return;
    settleBack();
  }

  function onClickCapture(event: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function bindSheet(el: HTMLElement | null) {
    detachSheet?.();
    detachSheet = null;
    if (!el) {
      baseHeight = 0;
      return;
    }
    baseHeight = el.offsetHeight;
    el.addEventListener('touchstart', onSheetTouchStart, { passive: true });
    el.addEventListener('touchmove', onSheetTouchMove, { passive: false });
    el.addEventListener('touchend', onSheetTouchEnd);
    el.addEventListener('touchcancel', onSheetTouchEnd);
    el.addEventListener('pointerdown', onSheetPointerDown);
    el.addEventListener('pointermove', onSheetPointerMove);
    el.addEventListener('pointerup', onSheetPointerUp);
    el.addEventListener('pointercancel', onSheetPointerCancel);
    el.addEventListener('click', onClickCapture, true);
    detachSheet = () => {
      el.removeEventListener('touchstart', onSheetTouchStart);
      el.removeEventListener('touchmove', onSheetTouchMove);
      el.removeEventListener('touchend', onSheetTouchEnd);
      el.removeEventListener('touchcancel', onSheetTouchEnd);
      el.removeEventListener('pointerdown', onSheetPointerDown);
      el.removeEventListener('pointermove', onSheetPointerMove);
      el.removeEventListener('pointerup', onSheetPointerUp);
      el.removeEventListener('pointercancel', onSheetPointerCancel);
      el.removeEventListener('click', onClickCapture, true);
    };
  }

  watch(sheetRef, bindSheet, { flush: 'post' });

  watch([isOpen, isCompact], ([open, compact], previous) => {
    const compactChanged = !!previous && previous[1] !== compact;
    if (open && compact) {
      closeAfterDrag = false;
      if (compactChanged) resetMotion();
      return;
    }
    if (!open && closeAfterDrag) closeAfterDrag = false;
    // 关闭时保留当前高度，让离场弹簧从展开后的尺寸滑出
    else resetMotion(!open && !compactChanged);
  });

  onBeforeUnmount(() => {
    detachSheet?.();
    detachSheet = null;
    clearTimeout(suppressTimer ?? undefined);
    resetMotion();
  });

  return {
    sheetRef,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel
  };
}
