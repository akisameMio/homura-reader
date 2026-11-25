<template>
  <button
    type="button"
    role="switch"
    class="md-switch-row"
    :class="{ 'is-checked': modelValue }"
    :aria-checked="modelValue"
    :disabled="disabled"
    :title="title || undefined"
    @click="toggle"
  >
    <span class="md-switch-label"><slot /></span>
    <span ref="track" class="md-switch-track" aria-hidden="true">
      <span class="md-switch-thumb">
        <span class="md-switch-state-layer"></span>
        <span class="md-switch-knob"></span>
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { makeAxis, prefersReducedMotion, runSpring, snapAxes } from '../services/spring.ts';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue']);
const track = shallowRef<HTMLElement | null>(null);
const travel = makeAxis(Number(props.modelValue), 480);
const expansion = makeAxis(0, 1200);
const axes = [travel, expansion];
let cancelSpring: (() => void) | undefined;

watch(() => props.modelValue, checked => {
  const element = track.value;
  if (!element) return;

  travel.target = Number(checked);
  travel.stiffness = checked ? 480 : 620;

  const settle = () => {
    cancelSpring = undefined;
    expansion.target = 0;
    snapAxes(axes);
    element.style.removeProperty('--switch-travel');
    element.style.removeProperty('--switch-expansion');
  };

  if (prefersReducedMotion()) {
    cancelSpring?.();
    settle();
    return;
  }
  if (cancelSpring) return;

  const paint = () => {
    const progress = Math.min(1, Math.max(0, travel.pos));
    // 中段推高形变弹簧的目标值，滑块接近终点时仍有余势，再收回圆形。
    expansion.target = 4 * progress * (1 - progress);
    element.style.setProperty('--switch-travel', String(progress));
    element.style.setProperty('--switch-expansion', String(Math.max(0, expansion.pos)));
  };

  paint();
  cancelSpring = runSpring(axes, paint, settle, {
    damping: 0.85,
    playbackRate: 0.8,
    maxDt: 0.024,
    posEpsilon: 0.006,
    velEpsilon: 0.16
  });
}, { flush: 'post' });

onBeforeUnmount(() => cancelSpring?.());

function toggle() {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>

<style scoped>
.md-switch-row {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--md-on-surface);
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.md-switch-row:disabled {
  cursor: default;
  opacity: 0.38;
}

.md-switch-label {
  min-width: 0;
}

.md-switch-track {
  --switch-rest: 0;
  --switch-progress: var(--switch-travel, var(--switch-rest));
  --switch-bulge: var(--switch-expansion, 0);
  --switch-on-weight: calc(var(--switch-progress) * 100%);
  --switch-thumb-color: color-mix(in oklab, var(--md-on-primary) var(--switch-on-weight), var(--md-outline));
  position: relative;
  display: block;
  width: 52px;
  height: 32px;
  flex: none;
  overflow: visible;
  border-radius: 999px;
  background-color: color-mix(in oklab, var(--md-primary) var(--switch-on-weight), var(--md-surface-highest));
  box-shadow: inset 0 0 0 2px color-mix(in oklab, transparent var(--switch-on-weight), var(--md-outline));
}

.md-switch-row.is-checked .md-switch-track {
  --switch-rest: 1;
}

/* 固定尺寸的滑块容器只做位移，放大时不改变布局或点击区域。 */
.md-switch-thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 24px;
  height: 24px;
  pointer-events: none;
  transform: translate3d(calc(22px * var(--switch-progress)), -50%, 0);
}

.md-switch-state-layer {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background-color: var(--switch-thumb-color);
  opacity: 0;
  transition: opacity var(--md-duration-short) var(--md-ease-decelerate);
}

.md-switch-knob {
  --switch-circle-scale: calc((2 + var(--switch-progress)) / 3);
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: calc(50% - 12% * var(--switch-bulge));
  background-color: var(--switch-thumb-color);
  box-shadow: 0 3px 6px color-mix(in oklab, var(--md-shadow-color-soft) calc(72% * var(--switch-bulge)), transparent);
  transform:
    translateY(calc(-2px * var(--switch-bulge)))
    scale(
      calc(var(--switch-circle-scale) + 1.36 * var(--switch-bulge)),
      calc(var(--switch-circle-scale) + 1.05 * var(--switch-bulge))
    );
}

.md-switch-row:focus-visible {
  outline: none;
}

.md-switch-row:focus-visible .md-switch-state-layer,
.md-switch-row:not(:disabled):active .md-switch-state-layer {
  opacity: 0.1;
}

.md-switch-row:focus-visible .md-switch-track {
  outline: 2px solid var(--md-primary);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .md-switch-track {
    --switch-progress: var(--switch-rest);
    --switch-bulge: 0;
  }

  .md-switch-state-layer {
    transition: none;
  }
}
</style>
