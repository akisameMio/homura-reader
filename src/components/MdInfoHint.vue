<template>
  <span class="md-info-hint">
    <button
      ref="triggerRef"
      type="button"
      class="md-info-hint-trigger md-hit-target"
      :class="{ 'is-open': open }"
      :aria-label="t('{0}的说明', { 0: label })"
      :aria-expanded="open"
      :aria-controls="hintId"
      :aria-describedby="open ? hintId : undefined"
      @click.stop="toggle"
    >
      <MdIcon name="info" :size="18" />
    </button>
    <Teleport :to="portalTarget">
      <div
        :id="hintId"
        ref="cardRef"
        class="md-info-hint-card"
        role="tooltip"
        :popover="hasPopover ? 'auto' : undefined"
        :hidden="!hasPopover && !open"
        @toggle="onPopoverToggle"
      ><slot /></div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, ref, shallowRef, useId } from 'vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';
import { settingsSelectBackKey } from '../composables/useSettingsTransition.ts';

defineProps({ label: { type: String, required: true } });
const { t } = useI18n();
const hintId = `md-info-hint-${useId()}`;
const open = ref(false);
const triggerRef = shallowRef<HTMLButtonElement | null>(null);
const cardRef = shallowRef<HTMLElement | null>(null);
const portalTarget = shallowRef<string | HTMLElement>('body');
const hasPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const settingsBack = inject(settingsSelectBackKey, null);
const dismissFromSettings = () => close(true);

function placeCard() {
  const trigger = triggerRef.value;
  const card = cardRef.value;
  if (!trigger || !card) return;
  const viewport = window.visualViewport;
  const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
  const topEdge = (viewport?.offsetTop ?? 0) + 12;
  const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 24;
  const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 24;
  const anchor = trigger.getBoundingClientRect();
  const below = bottomEdge - anchor.bottom - 8;
  const above = anchor.top - topEdge - 8;
  card.style.maxWidth = `${Math.max(0, rightEdge - leftEdge)}px`;
  card.style.maxHeight = `${Math.max(0, Math.max(below, above))}px`;
  const bounds = card.getBoundingClientRect();
  const left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - bounds.width));
  const top = below >= bounds.height || below >= above ? anchor.bottom + 8 : anchor.top - bounds.height - 8;
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - bounds.height))}px`;
}

async function toggle() {
  if (open.value) {
    close();
    return;
  }
  // 旧 WebView 走固定定位；原生 dialog 内的说明仍留在同一顶层表面中。
  portalTarget.value = triggerRef.value?.closest('dialog') ?? 'body';
  settingsBack?.value?.();
  triggerRef.value?.focus({ preventScroll: true });
  open.value = true;
  await nextTick();
  if (!open.value || !cardRef.value || !triggerRef.value?.isConnected) return;
  if (hasPopover) cardRef.value.showPopover();
  placeCard();
  if (settingsBack) settingsBack.value = dismissFromSettings;
  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
}

function removeListeners() {
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('scroll', onViewportChange);
  if (settingsBack?.value === dismissFromSettings) settingsBack.value = null;
}

function close(restoreFocus = false) {
  open.value = false;
  removeListeners();
  if (hasPopover && cardRef.value?.matches(':popover-open')) cardRef.value.hidePopover();
  if (restoreFocus) triggerRef.value?.focus({ preventScroll: true });
}

function isInside(target: EventTarget | null) {
  return target instanceof Node && (triggerRef.value?.contains(target) || cardRef.value?.contains(target));
}

function onOutsidePointer(event: PointerEvent) {
  if (!isInside(event.target)) close();
}

function onFocusIn(event: FocusEvent) {
  if (!isInside(event.target)) close();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (event.key === 'Tab') close();
}

function onScroll(event: Event) {
  if (!(event.target instanceof Node) || !cardRef.value?.contains(event.target)) close();
}

function onViewportChange() {
  close();
}

function onPopoverToggle(event: Event) {
  if ((event as ToggleEvent).newState === 'closed' && open.value) close();
}

onBeforeUnmount(() => close());
</script>

<style scoped>
.md-info-hint {
  display: inline-flex;
  flex: none;
  align-items: center;
  vertical-align: middle;
}

.md-info-hint-trigger {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--md-on-surface-variant);
  cursor: pointer;
  transition: color 200ms var(--md-ease-emphasized), background-color 200ms var(--md-ease-emphasized);
}

.md-info-hint-trigger.is-open,
.md-info-hint-trigger:active {
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}

.md-info-hint-trigger:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}

.md-info-hint-card {
  position: fixed;
  inset: auto;
  z-index: 50;
  box-sizing: border-box;
  width: 296px;
  max-width: calc(100vw - 24px);
  margin: 0;
  padding: 14px 16px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--md-outline-variant);
  border-radius: 16px;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
  box-shadow: 0 6px 24px -6px color-mix(in oklab, var(--md-shadow-color-soft) 32%, transparent);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.7;
  letter-spacing: normal;
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
  animation: info-hint-appear 200ms var(--md-ease-emphasized);
}

.md-info-hint-card :deep(p + p) { margin-top: 8px; }

@keyframes info-hint-appear {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (hover: hover) and (pointer: fine) {
  .md-info-hint-trigger:hover {
    background: var(--md-surface-high);
  }
}

@media (prefers-reduced-motion: reduce) {
  .md-info-hint-trigger { transition: none; }
  .md-info-hint-card { animation: none; }
}
</style>
