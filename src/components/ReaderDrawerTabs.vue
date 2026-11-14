<template>
  <div ref="tabsRef" class="reader-drawer-tabs" :class="{ 'is-ready': thumbReady }" role="tablist" :aria-label="t(label)">
    <span class="reader-drawer-tabs-thumb" aria-hidden="true" :style="thumbStyle"></span>
    <button
      v-for="(tab, index) in options"
      :id="`${idPrefix}-tab-${tab.value}`"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.value"
      :aria-controls="`${idPrefix}-panel-${tab.value}`"
      :tabindex="modelValue === tab.value ? 0 : -1"
      @click="$emit('update:modelValue', tab.value)"
      @keydown="onKeydown($event, index)"
    >{{ t(tab.label) }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type PropType } from 'vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array as PropType<{ value: string; label: string }[]>, required: true },
  idPrefix: { type: String, required: true },
  label: { type: String, required: true }
});
const emit = defineEmits(['update:modelValue']);
const tabsRef = shallowRef<HTMLElement | null>(null);
const thumb = ref({ x: 0, width: 0 });
const thumbReady = ref(false);
let resizeObserver: ResizeObserver | null = null;

const thumbStyle = computed(() => ({
  transform: `translate3d(${thumb.value.x}px, 0, 0)`,
  width: `${thumb.value.width}px`
}));

function measureThumb() {
  const root = tabsRef.value;
  if (!root) return;
  const index = props.options.findIndex(tab => tab.value === props.modelValue);
  const button = root.querySelectorAll<HTMLButtonElement>('button')[index];
  if (!button) {
    thumb.value = { x: 0, width: 0 };
    return;
  }
  thumb.value = { x: button.offsetLeft, width: button.offsetWidth };
}

watch(() => props.modelValue, async () => {
  await nextTick();
  measureThumb();
});

watch(() => props.options, async () => {
  await nextTick();
  measureThumb();
});

onMounted(async () => {
  await nextTick();
  measureThumb();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      thumbReady.value = true;
    });
  } else {
    thumbReady.value = true;
  }
  if (typeof ResizeObserver === 'undefined' || !tabsRef.value) return;
  resizeObserver = new ResizeObserver(measureThumb);
  resizeObserver.observe(tabsRef.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

function onKeydown(event: KeyboardEvent, index: number) {
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % props.options.length;
  else if (event.key === 'ArrowLeft') next = (index + props.options.length - 1) % props.options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = props.options.length - 1;
  else return;
  if (!props.options[next]) return;
  event.preventDefault();
  emit('update:modelValue', props.options[next].value);
  tabsRef.value?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus({ preventScroll: true });
}
</script>

<style scoped>
.reader-drawer-tabs {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 4px;
  border-radius: 28px;
  background: var(--md-surface);
  isolation: isolate;
}
.reader-drawer-tabs-thumb {
  position: absolute;
  top: 4px;
  left: 0;
  z-index: 0;
  height: calc(100% - 8px);
  border-radius: 24px;
  background: var(--md-secondary-container);
  opacity: 0;
  will-change: transform, width;
  transition:
    transform 280ms cubic-bezier(0.22, 1.2, 0.36, 1),
    width 280ms cubic-bezier(0.22, 1.2, 0.36, 1),
    opacity 160ms var(--md-ease-emphasized);
}
.reader-drawer-tabs.is-ready .reader-drawer-tabs-thumb {
  opacity: 1;
}
.reader-drawer-tabs button {
  position: relative;
  z-index: 1;
  min-width: 44px;
  min-height: 44px;
  padding-inline: 8px;
  border-radius: 24px;
  background: transparent;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: color 200ms var(--md-ease-emphasized);
}
.reader-drawer-tabs button[aria-selected='true'] { color: var(--md-on-secondary-container); }
.reader-drawer-tabs button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 3px; }
@media (hover: hover) and (pointer: fine) {
  .reader-drawer-tabs button:not([aria-selected='true']):hover { background: var(--md-surface-high); }
}
@media (prefers-reduced-motion: reduce) {
  .reader-drawer-tabs-thumb,
  .reader-drawer-tabs button { transition: none; }
}
</style>
