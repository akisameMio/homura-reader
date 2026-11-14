<template>
  <div ref="tabsRef" class="reader-drawer-tabs" role="tablist" :aria-label="label">
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
    >{{ tab.label }}</button>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, type PropType } from 'vue';

const props = defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array as PropType<{ value: string; label: string }[]>, required: true },
  idPrefix: { type: String, required: true },
  label: { type: String, required: true }
});
const emit = defineEmits(['update:modelValue']);
const tabsRef = shallowRef<HTMLElement | null>(null);

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
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 4px;
  border-radius: 28px;
  background: var(--md-surface);
}
.reader-drawer-tabs button {
  min-width: 44px;
  min-height: 44px;
  padding-inline: 8px;
  border-radius: 24px;
  background: transparent;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: background-color 200ms var(--md-ease-emphasized), color 200ms var(--md-ease-emphasized);
}
.reader-drawer-tabs button[aria-selected='true'] { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
.reader-drawer-tabs button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 3px; }
@media (hover: hover) and (pointer: fine) {
  .reader-drawer-tabs button:not([aria-selected='true']):hover { background: var(--md-surface-high); }
}
@media (prefers-reduced-motion: reduce) {
  .reader-drawer-tabs button { transition: none; }
}
</style>
