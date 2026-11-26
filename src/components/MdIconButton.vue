<template>
  <button
    ref="button"
    type="button"
    class="md-elastic-icon-button md-hit-target"
    :disabled="disabled"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onPointerCancel"
    @click.capture="onClick"
  >
    <span v-if="$slots.default" ref="face" class="md-icon-button-face"><slot /></span>
    <slot name="label" />
  </button>
</template>

<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { makeAxis, prefersReducedMotion, runSpring, snapAxes } from '../services/spring.ts';

const props = defineProps({
  disabled: Boolean,
  preserveUserActivation: Boolean
});
const button = shallowRef<HTMLButtonElement | null>(null);
const face = shallowRef<HTMLElement | null>(null);
defineExpose({ button });

const REST = 1;
const HOVER = 1.09;
const MOUSE_PRESS = 0.955;
const TOUCH_PRESS = 0.91;
const TOUCH_FEEDBACK = 0.95;
const PRESS_STIFFNESS = 3600;
const RELEASE_STIFFNESS = 2800;
const scale = makeAxis(REST, RELEASE_STIFFNESS);
const axes = [scale];
let hovering = false;
let press: { id: number; mouse: boolean; inside: boolean; cancelled: boolean } | null = null;
let clickFromPointer: 'cancelled' | 'touch' | null = null;
let cancelSpring: (() => void) | undefined;
let releaseFrame = 0;
let queuedClicks = 0;

function paint() {
  if (scale.pos === REST) face.value?.style.removeProperty('--icon-button-scale');
  else face.value?.style.setProperty('--icon-button-scale', String(scale.pos));
}

function isDisabled() {
  return props.disabled || button.value?.matches(':disabled') === true;
}

function updateScale() {
  if (isDisabled() || prefersReducedMotion()) {
    cancelSpring?.();
    cancelSpring = undefined;
    scale.target = REST;
    snapAxes(axes);
    paint();
    return;
  }
  const pressing = press?.inside && !press.cancelled;
  const pressedScale = press?.mouse ? MOUSE_PRESS : TOUCH_PRESS;
  scale.target = hovering ? HOVER : REST;
  if (pressing) scale.target = pressedScale;
  else if (releaseFrame) scale.target = TOUCH_PRESS;
  scale.stiffness = pressing || releaseFrame ? PRESS_STIFFNESS : RELEASE_STIFFNESS;
  if (cancelSpring || scale.pos === scale.target) return;

  cancelSpring = runSpring(axes, paint, () => { cancelSpring = undefined; }, {
    damping: 0.92,
    maxDt: 0.02,
    posEpsilon: 0.0015,
    velEpsilon: 0.16
  });
}

function onPointerEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || !face.value || isDisabled()) return;
  hovering = true;
  updateScale();
}

function onPointerLeave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  hovering = false;
  updateScale();
}

function onPointerDown(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || press || isDisabled() || !face.value?.getClientRects().length) return;
  const mouse = event.pointerType === 'mouse';
  hovering = mouse;
  press = { id: event.pointerId, mouse, inside: true, cancelled: false };
  clickFromPointer = null;
  button.value?.setPointerCapture(event.pointerId);
  updateScale();
}

function isInside(event: PointerEvent) {
  return button.value?.contains(document.elementFromPoint(event.clientX, event.clientY)) ?? false;
}

function onPointerMove(event: PointerEvent) {
  if (press?.id !== event.pointerId || press.cancelled) return;
  const inside = isInside(event);
  if (inside === press.inside) return;
  press.inside = inside;
  if (press.mouse) hovering = inside;
  else press.cancelled = true;
  updateScale();
}

function onPointerUp(event: PointerEvent) {
  if (press?.id !== event.pointerId) return;
  const inside = isInside(event);
  const { mouse, cancelled } = press;
  press = null;
  hovering = mouse && inside;
  if (cancelled || !inside || isDisabled()) clickFromPointer = 'cancelled';
  else if (!mouse) {
    clickFromPointer = 'touch';
    if (scale.pos > TOUCH_FEEDBACK && !prefersReducedMotion()) holdQuickTap();
  }
  updateScale();
}

function onPointerCancel(event: PointerEvent) {
  if (press?.id !== event.pointerId) return;
  press = null;
  hovering = false;
  clickFromPointer = 'cancelled';
  updateScale();
}

function holdQuickTap() {
  if (releaseFrame) return;
  let pressedFrame = false;
  const deadline = performance.now() + 100;
  const afterPaint = (now: number) => {
    if (!pressedFrame && now < deadline && !prefersReducedMotion()) {
      pressedFrame = scale.pos <= TOUCH_FEEDBACK;
      releaseFrame = requestAnimationFrame(afterPaint);
      return;
    }
    releaseFrame = 0;
    updateScale();
    const clicks = queuedClicks;
    queuedClicks = 0;
    for (let i = 0; i < clicks && button.value?.isConnected && !isDisabled(); i++) {
      button.value.click();
    }
  };
  releaseFrame = requestAnimationFrame(afterPaint);
}

function onClick(event: MouseEvent) {
  if (event.detail === 0 || !clickFromPointer) return;
  const outcome = clickFromPointer;
  clickFromPointer = null;
  if (outcome === 'touch' && (!releaseFrame || props.preserveUserActivation)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  // 等下压绘制后再激活原生按钮，以便关闭面板前也能看到反馈，并保留表单提交。
  if (outcome === 'touch') queuedClicks++;
}

function clearQuickTap() {
  if (releaseFrame) cancelAnimationFrame(releaseFrame);
  releaseFrame = 0;
  queuedClicks = 0;
}

watch(() => props.disabled, disabled => {
  if (!disabled) return;
  if (press) clickFromPointer = 'cancelled';
  press = null;
  hovering = false;
  clearQuickTap();
  updateScale();
}, { flush: 'sync' });

onBeforeUnmount(() => {
  clearQuickTap();
  cancelSpring?.();
});
</script>

<style scoped>
.md-elastic-icon-button {
  -webkit-tap-highlight-color: transparent;
}

.md-icon-button-face {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  border-radius: inherit;
  background: var(--icon-button-background, transparent);
  box-shadow: var(--icon-button-shadow, none);
  pointer-events: none;
  transform: scale(var(--icon-button-scale, 1));
  transform-origin: center;
}

.md-elastic-icon-button:disabled .md-icon-button-face {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .md-icon-button-face {
    transform: none;
  }
}
</style>
