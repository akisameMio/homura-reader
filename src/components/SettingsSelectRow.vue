<template>
  <button
    ref="triggerRef"
    type="button"
    class="settings-select-row"
    :class="{ 'is-open': open }"
    :disabled="disabled"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="menuId"
    :aria-label="`${label}，${selectedLabel}`"
    @click="toggle"
    @keydown="onTriggerKeydown"
  >
    <span class="settings-select-label">{{ label }}</span>
    <span class="settings-select-control">
      <span class="settings-select-value">{{ selectedLabel }}</span>
      <span class="settings-select-arrows" aria-hidden="true">
        <MdIcon name="expand_more" :size="14" />
        <MdIcon name="expand_more" :size="14" />
      </span>
    </span>
    <Teleport to="body">
      <Transition name="settings-menu">
        <div
          v-if="open"
          :id="menuId"
          ref="menuRef"
          class="settings-select-menu"
          role="listbox"
          :aria-label="label"
          :style="menuStyle"
          @keydown="onMenuKeydown"
        >
          <button
            v-for="(option, index) in options"
            :key="option.value"
            type="button"
            class="settings-select-option"
            :class="{ 'is-selected': option.value === modelValue }"
            role="option"
            :aria-selected="option.value === modelValue"
            :tabindex="index === activeIndex ? 0 : -1"
            @focus="activeIndex = index"
            @click="select(option.value)"
          >
            <span>{{ option.label }}</span>
            <MdIcon v-if="option.value === modelValue" name="check" :size="21" />
          </button>
        </div>
      </Transition>
    </Teleport>
  </button>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch, type PropType } from 'vue';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: [String, Number], required: true },
  options: { type: Array as PropType<ReadonlyArray<{ value: string | number; label: string }>>, required: true },
  disabled: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue']);
const menuId = `settings-select-${useId()}`;
const triggerRef = shallowRef<HTMLButtonElement | null>(null);
const menuRef = shallowRef<HTMLDivElement | null>(null);
const open = ref(false);
const activeIndex = ref(0);
const menuStyle = ref({ left: '0px', top: '0px', width: '224px', maxHeight: '320px' });
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || '');

function focusOption(index: number) {
  activeIndex.value = index;
  menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus({ preventScroll: true });
  menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.scrollIntoView({ block: 'nearest' });
}

async function showMenu() {
  if (props.disabled || !props.options.length || !triggerRef.value) return;
  // 菜单传送到根节点，避免设置卡片与抽屉的滚动容器裁切。
  const rect = triggerRef.value.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const width = Math.min(224, (viewport?.width ?? window.innerWidth) - 24);
  const maxHeight = Math.min(320, (viewport?.height ?? window.innerHeight) - 24);
  const index = Math.max(0, props.options.findIndex(option => option.value === props.modelValue));
  const height = Math.min(maxHeight, props.options.length * 56 + 16);
  const left = Math.max(viewportLeft + 12, Math.min(rect.right - width - 12, viewportLeft + (viewport?.width ?? window.innerWidth) - width - 12));
  const top = Math.max(viewportTop + 12, Math.min(rect.top + (rect.height - 56) / 2 - 8 - index * 56, viewportTop + (viewport?.height ?? window.innerHeight) - height - 12));
  menuStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${maxHeight}px` };
  activeIndex.value = index;
  open.value = true;
  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('keydown', onDocumentKeydown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);
  await nextTick();
  if (open.value) focusOption(index);
}

function removeListeners() {
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  document.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('scroll', onViewportChange);
}

function close(restoreFocus = false) {
  open.value = false;
  removeListeners();
  if (restoreFocus) triggerRef.value?.focus({ preventScroll: true });
}

function toggle() {
  if (open.value) close(true);
  else void showMenu();
}

function select(value: string | number) {
  emit('update:modelValue', value);
  close(true);
}

function isInside(target: EventTarget | null) {
  return target instanceof Node && (triggerRef.value?.contains(target) || menuRef.value?.contains(target));
}

function onOutsidePointer(event: PointerEvent) {
  if (!isInside(event.target)) close();
}

function onFocusIn(event: FocusEvent) {
  if (!isInside(event.target)) close();
}

function onScroll(event: Event) {
  if (event.target instanceof Node && menuRef.value?.contains(event.target)) return;
  close();
}

function onViewportChange() {
  close();
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (event.key === 'Tab') {
    // 先恢复触发项，再让浏览器按原设置列表顺序移动焦点。
    close(true);
  }
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    void showMenu().then(() => {
      if (open.value && event.key === 'Home') focusOption(0);
      if (open.value && event.key === 'End') focusOption(props.options.length - 1);
    });
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  let index = activeIndex.value;
  if (event.key === 'ArrowDown') index = (index + 1) % props.options.length;
  else if (event.key === 'ArrowUp') index = (index - 1 + props.options.length) % props.options.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = props.options.length - 1;
  else return;
  event.preventDefault();
  focusOption(index);
}

watch(() => [props.disabled, props.options, props.modelValue], () => close());
onBeforeUnmount(removeListeners);
</script>

<style scoped>
.settings-select-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 74px;
  padding: 18px 24px;
  border: 0;
  background: transparent;
  color: var(--md-on-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-select-label {
  flex: 1;
  min-width: 0;
  font-size: 16px;
}

.settings-select-value {
  font-size: 13px;
  color: var(--md-on-surface-variant);
}

.settings-select-control {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 8px;
  margin: -6px -10px -6px 0;
  padding: 6px 10px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 200ms cubic-bezier(0.2, 0, 0, 1);
}

.settings-select-arrows {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 0;
  color: var(--md-on-surface-variant);
}

.settings-select-arrows > svg:first-child {
  transform: rotate(180deg);
  margin-bottom: -4px;
}

.settings-select-row.is-open .settings-select-control,
.settings-select-row:focus-visible .settings-select-control {
  background: var(--md-surface-high);
}

.settings-select-row:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: -4px;
  border-radius: 16px;
}

.settings-select-row:disabled {
  opacity: 0.55;
  cursor: default;
}

.settings-select-menu {
  position: fixed;
  z-index: 50;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  border-radius: 28px;
  background: var(--md-select-menu-surface);
  color: var(--md-on-surface);
  box-shadow: 0 8px 32px color-mix(in oklab, var(--md-shadow-color-soft) 24%, transparent);
  transform-origin: right top;
  scrollbar-width: thin;
}

.settings-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border: 0;
  border-radius: 21px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 16px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background-color 200ms cubic-bezier(0.2, 0, 0, 1);
}

.settings-select-option.is-selected {
  background: var(--md-select-menu-selected);
  font-weight: 600;
}

.settings-select-option:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: -3px;
}

@media (hover: hover) {
  .settings-select-row:hover:not(:disabled) .settings-select-control {
    background: var(--md-surface-high);
  }

  .settings-select-option:hover {
    background: var(--md-select-menu-hover);
  }
}

.settings-select-option:active {
  background: color-mix(in oklab, var(--md-surface-highest) 88%, var(--md-on-surface) 12%);
}

.settings-menu-enter-active,
.settings-menu-leave-active {
  transition: opacity 160ms cubic-bezier(0.2, 0, 0, 1), transform 200ms cubic-bezier(0.2, 0, 0, 1);
}

.settings-menu-leave-active {
  pointer-events: none;
}

.settings-menu-enter-from,
.settings-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .settings-select-control,
  .settings-select-option,
  .settings-menu-enter-active,
  .settings-menu-leave-active {
    transition: none;
  }
}

@media (max-width: 599px) {
  .settings-select-row {
    gap: 12px;
    padding: 18px 20px;
  }

  .settings-select-label {
    font-size: 15px;
  }

  .settings-select-value {
    font-size: 12px;
  }
}
</style>
