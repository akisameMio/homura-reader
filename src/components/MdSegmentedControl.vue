<template>
  <div
    ref="track"
    class="md-segmented"
    :class="{ 'has-selection': activeIndex >= 0, 'has-many-options': options.length >= 3, 'is-disabled': disabled, 'is-tablist': tabIdPrefix }"
    :role="tabIdPrefix ? 'tablist' : 'group'"
    :aria-label="ariaLabel ? t(ariaLabel) : undefined"
    :aria-disabled="disabled || undefined"
    :style="{ '--md-segment-count': Math.max(1, options.length) }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerLeave"
    @pointercancel="onPointerCancel"
    @lostpointercapture.self="onPointerCancel"
  >
    <div ref="optionsLayer" class="md-segmented-options">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        :id="tabIdPrefix ? `${tabIdPrefix}-tab-${option.value}` : undefined"
        type="button"
        class="md-segmented-option"
        :class="{ 'is-selected': index === activeIndex }"
        :data-segment-index="index"
        :role="tabIdPrefix ? 'tab' : undefined"
        :aria-pressed="tabIdPrefix ? undefined : index === activeIndex"
        :aria-selected="tabIdPrefix ? index === activeIndex : undefined"
        :aria-controls="tabIdPrefix ? `${tabIdPrefix}-panel-${option.value}` : undefined"
        :tabindex="tabIdPrefix ? (index === activeIndex ? 0 : -1) : undefined"
        :title="option.title ? t(option.title) : undefined"
        :disabled="disabled"
        @click="onClick(index, $event)"
        @keydown="onKeydown(index, $event)"
      >
        <span v-if="option.icon" class="md-segmented-icon"><MdIcon :name="option.icon" :size="16" /></span>
        <span>{{ labels[index] }}</span>
      </button>
    </div>
    <div v-if="options.length" ref="selectionLayer" class="md-segmented-selection" aria-hidden="true">
      <div class="md-segmented-thumb"></div>
      <div class="md-segmented-labels">
        <span
          v-for="(option, index) in options"
          :key="option.value"
          class="md-segmented-option"
          :class="{ 'is-selected': index === activeIndex }"
        >
          <span v-if="option.icon" class="md-segmented-icon"><MdIcon :name="option.icon" :size="16" /></span>
          <span>{{ labels[index] }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch, type PropType } from 'vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';
import { axesSettled, makeAxis, runSpring, snapAxes } from '../services/spring.ts';

const { t } = useI18n();

const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array as PropType<ReadonlyArray<{ value: string | number; label: string; title?: string; icon?: string }>>, required: true },
  ariaLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  tabIdPrefix: { type: String, default: '' }
});

const emit = defineEmits(['update:modelValue']);

const track = shallowRef<HTMLDivElement | null>(null);
const optionsLayer = shallowRef<HTMLDivElement | null>(null);
const selectionLayer = shallowRef<HTMLDivElement | null>(null);
const activeIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const labels = computed(() => props.options.map(option => t(option.label)));

const TRAVEL_STIFFNESS = 460;
const TRAVEL_DAMPING = 34 / (2 * Math.sqrt(TRAVEL_STIFFNESS));
const SPRING_OPTIONS = { maxDt: 0.032, maxStep: 1 / 240, posEpsilon: 0.0005, velEpsilon: 0.001 };
const DRAG_THRESHOLD = 5;
const VELOCITY_EXPIRY_MS = 75;
const MAX_RELEASE_VELOCITY = 2400;

const travel = makeAxis(0, TRAVEL_STIFFNESS, TRAVEL_DAMPING);
const axes = [travel];
let rtl = false;
let observer: ResizeObserver | undefined;
let motionPreference: MediaQueryList | undefined;
let stopSpring: (() => void) | undefined;
let hovered: HTMLButtonElement | null = null;
let suppressPointerClick = false;

interface Press {
  id: number;
  button: HTMLButtonElement;
  startX: number;
  slotWidth: number;
  baseX: number;
  canDrag: boolean;
  dragging: boolean;
  sampleX: number;
  sampleTime: number;
  velocity: number;
}
let press: Press | null = null;

function clampTravel(position: number) {
  return Math.max(0, Math.min(props.options.length - 1, position));
}

function paint() {
  selectionLayer.value?.style.setProperty('--md-segmented-offset', String(clampTravel(travel.pos)));
}

function animate(forceFrame = false) {
  if (motionPreference?.matches) {
    stopSpring?.();
    stopSpring = undefined;
    snapAxes(axes);
    paint();
    return;
  }
  if (stopSpring || !props.options.length) return;
  if (!forceFrame && axesSettled(axes, SPRING_OPTIONS.posEpsilon, SPRING_OPTIONS.velEpsilon)) {
    snapAxes(axes);
    paint();
    return;
  }
  stopSpring = runSpring(axes, paint, () => { stopSpring = undefined; }, SPRING_OPTIONS);
}

function updateTargets(snap = false) {
  const index = activeIndex.value;
  if (index < 0 || press?.dragging) return;
  // 弹簧以列为单位，轨道尺寸仅由 CSS 负责。滚动和尺寸变化不会改变弹簧目标。
  travel.target = rtl ? props.options.length - 1 - index : index;
  if (snap) {
    snapAxes(axes);
    paint();
  }
  animate();
}

function optionButton(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLButtonElement>('button[data-segment-index]') : null;
}

function buttonAt(index: number) {
  return optionsLayer.value?.querySelector<HTMLButtonElement>(`[data-segment-index="${index}"]`) ?? null;
}

function setHovered(button: HTMLButtonElement | null) {
  if (hovered === button) return;
  hovered?.removeAttribute('data-hovered');
  hovered = button;
  hovered?.setAttribute('data-hovered', '');
}

function select(index: number, button: HTMLButtonElement | null) {
  const option = props.options[index];
  if (props.disabled || !option || (!props.tabIdPrefix && index === activeIndex.value)) return;
  setHovered(null);
  const rect = button?.getBoundingClientRect();
  const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  emit('update:modelValue', option.value, origin);
}

function onClick(index: number, event: MouseEvent) {
  if (event.detail > 0 && suppressPointerClick) return;
  select(index, event.currentTarget as HTMLButtonElement);
}

function onKeydown(index: number, event: KeyboardEvent) {
  if (!props.tabIdPrefix || props.disabled) return;
  const count = props.options.length;
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = count - 1;
  else if (event.key === 'ArrowRight') next = (index + (rtl ? count - 1 : 1)) % count;
  else if (event.key === 'ArrowLeft') next = (index + (rtl ? 1 : count - 1)) % count;
  else return;
  event.preventDefault();
  const button = buttonAt(next);
  select(next, button);
  button?.focus({ preventScroll: true });
}

function onPointerDown(event: PointerEvent) {
  const button = optionButton(event.target);
  if (props.disabled || !button || !event.isPrimary || event.button !== 0 || press) return;
  const rect = optionsLayer.value?.getBoundingClientRect();
  const slotWidth = (rect?.width || 0) / props.options.length;
  if (!rect || !slotWidth) return;
  const localX = (event.clientX - rect.left) / slotWidth;
  const capsuleStart = clampTravel(travel.pos);
  setHovered(null);
  suppressPointerClick = false;
  press = {
    id: event.pointerId,
    button,
    startX: event.clientX,
    slotWidth,
    baseX: travel.pos,
    canDrag: props.options.length > 1 && activeIndex.value >= 0
      && localX >= capsuleStart && localX <= capsuleStart + 1,
    dragging: false,
    sampleX: event.clientX,
    sampleTime: event.timeStamp,
    velocity: 0
  };
}

function moveDrag(event: PointerEvent, state: Press) {
  const delta = (event.clientX - state.startX) / state.slotWidth;
  const elapsed = event.timeStamp - state.sampleTime;
  if (elapsed > 0 && event.clientX !== state.sampleX) {
    const velocity = elapsed <= VELOCITY_EXPIRY_MS
      ? (event.clientX - state.sampleX) * 1000 / elapsed
      : 0;
    state.velocity = Math.max(-MAX_RELEASE_VELOCITY, Math.min(MAX_RELEASE_VELOCITY, velocity)) / state.slotWidth;
    state.sampleX = event.clientX;
    state.sampleTime = event.timeStamp;
  }

  travel.target = clampTravel(state.baseX + delta);
  // 拖动由指针直接定位，松手后才把采样速度交给弹簧。
  travel.pos = travel.target;
  travel.vel = 0;
}

function onPointerMove(event: PointerEvent) {
  const state = press;
  if (!state) {
    if (!props.disabled && event.pointerType === 'mouse' && event.buttons === 0) setHovered(optionButton(event.target));
    return;
  }
  if (event.pointerId !== state.id || !state.canDrag) return;
  if (!state.dragging) {
    if (Math.abs(event.clientX - state.startX) < DRAG_THRESHOLD) return;
    state.dragging = true;
    state.baseX = clampTravel(travel.pos);
    track.value?.setPointerCapture(event.pointerId);
    track.value?.classList.add('is-dragging');
  }
  moveDrag(event, state);
  animate(true);
}

function finishPress(cancelled: boolean, event?: PointerEvent) {
  const state = press;
  if (!state) return;
  if (state.dragging && event && !cancelled) moveDrag(event, state);

  press = null;
  if (state.dragging) {
    suppressPointerClick = true;
    track.value?.classList.remove('is-dragging');
    if (track.value?.hasPointerCapture(state.id)) track.value.releasePointerCapture(state.id);
    if (!cancelled && event) {
      const slot = Math.round(clampTravel(travel.pos));
      const index = rtl ? props.options.length - 1 - slot : slot;
      if (event.timeStamp - state.sampleTime <= VELOCITY_EXPIRY_MS) travel.vel = state.velocity;
      if (index >= 0 && index !== activeIndex.value) {
        const button = buttonAt(index);
        select(index, button);
        if (props.tabIdPrefix && document.activeElement === state.button) button?.focus({ preventScroll: true });
      }
    }
  }
  updateTargets();
}

function onPointerUp(event: PointerEvent) {
  if (press?.id !== event.pointerId) return;
  finishPress(!press.dragging && optionButton(document.elementFromPoint(event.clientX, event.clientY)) !== press.button, event);
}

function onPointerLeave(event: PointerEvent) {
  setHovered(null);
  if (event.pointerType === 'mouse' && press?.id === event.pointerId && !press.dragging) finishPress(true);
}

function onPointerCancel(event: PointerEvent) {
  if (press?.id === event.pointerId) finishPress(true);
}

function onMotionChange() {
  animate();
}

watch([activeIndex, () => props.options.length], ([, count], [previousIndex, previousCount]) => {
  setHovered(null);
  updateTargets(previousIndex < 0 || count !== previousCount);
}, { flush: 'post' });

watch(() => props.disabled, disabled => {
  if (!disabled) return;
  setHovered(null);
  finishPress(true);
});

onMounted(() => {
  const layer = optionsLayer.value;
  if (!layer) return;
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', onMotionChange);
  rtl = getComputedStyle(layer).direction === 'rtl';
  updateTargets(true);
  observer = new ResizeObserver(([entry]) => {
    // WebKit 会取整 translateX 百分比的参照宽度，颜色和裁切统一使用实际列宽。
    const width = entry.contentRect.width;
    if (width > 0) track.value?.style.setProperty('--md-segmented-inner-width', `${width}px`);
  });
  observer.observe(layer);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  motionPreference?.removeEventListener('change', onMotionChange);
  stopSpring?.();
});
</script>

<style scoped>
.md-segmented {
  --md-segmented-fill: var(--md-segmented-selected-bg, var(--md-primary));
  --md-segmented-inset: 3px;
  position: relative;
  padding: var(--md-segmented-inset);
  border-radius: 20px;
  background-color: var(--md-segmented-bg, var(--md-surface-high));
  isolation: isolate;
  user-select: none;
  transition: opacity 200ms ease;
}

.md-segmented-options,
.md-segmented-labels {
  display: grid;
  grid-template-columns: repeat(var(--md-segment-count), minmax(0, 1fr));
}

.md-segmented-options {
  position: relative;
  touch-action: pan-y pinch-zoom;
}

.md-segmented-selection,
.md-segmented-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.md-segmented-selection {
  --md-segmented-slot: calc(var(--md-segmented-inner-width, 0px) / var(--md-segment-count));
  --md-segmented-left: calc(var(--md-segmented-inset) + var(--md-segmented-slot) * var(--md-segmented-offset, 0));
  z-index: 2;
  visibility: hidden;
  clip-path: inset(var(--md-segmented-inset) calc(100% - var(--md-segmented-left) - var(--md-segmented-slot)) var(--md-segmented-inset) var(--md-segmented-left) round 999px);
}

.md-segmented.has-selection .md-segmented-selection {
  visibility: visible;
}

.md-segmented-thumb {
  position: absolute;
  top: var(--md-segmented-inset);
  bottom: var(--md-segmented-inset);
  left: 0;
  width: var(--md-segmented-slot);
  background-color: var(--md-segmented-fill);
  transform: translateX(var(--md-segmented-left));
}

.md-segmented-labels {
  padding: var(--md-segmented-inset);
  color: var(--md-segmented-selected-color, var(--md-on-primary));
}

.md-segmented.is-disabled {
  opacity: var(--md-segmented-disabled-opacity, 0.55);
}

.md-segmented-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  min-height: 44px;
  padding: 7px 8px;
  border-radius: 17px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}

button.md-segmented-option {
  color: var(--md-segmented-color, var(--md-on-surface-variant));
  touch-action: pan-y pinch-zoom;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

button.md-segmented-option:disabled {
  cursor: default;
}

.md-segmented.is-dragging button.md-segmented-option {
  cursor: grabbing;
}

.md-segmented.is-tablist {
  --md-segmented-bg: var(--md-surface);
  --md-segmented-selected-bg: var(--md-secondary-container);
  --md-segmented-selected-color: var(--md-on-secondary-container);
  flex: none;
  border-radius: 28px;
}

.md-segmented.is-tablist :is(.md-segmented-options, .md-segmented-labels) {
  grid-template-columns: repeat(var(--md-segment-count), minmax(44px, 1fr));
}

.md-segmented.is-tablist .md-segmented-option {
  border-radius: 24px;
}

.md-segmented.is-tablist button:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 3px;
}

.md-segmented-icon {
  display: grid;
  flex: none;
  place-items: center;
}

@media (hover: hover) and (pointer: fine) {
  button.md-segmented-option[data-hovered]:not(.is-selected) {
    color: var(--md-on-surface);
  }
}

@media (prefers-reduced-motion: reduce) {
  .md-segmented {
    transition: none;
  }
}

/* 手机窄屏下三项以上的分段控件优先保证文字完整。 */
@media (max-width: 480px) {
  .md-segmented.has-many-options .md-segmented-icon {
    display: none;
  }
}
</style>
