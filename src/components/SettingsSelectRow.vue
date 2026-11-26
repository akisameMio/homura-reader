<template>
  <button
    ref="triggerRef"
    type="button"
    class="settings-select-row"
    :disabled="disabled"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="menuId"
    :aria-label="`${t(label)}, ${t(selectedLabel)}`"
    @click="toggle"
    @keydown="onTriggerKeydown"
  >
    <span class="settings-select-label">{{ t(label) }}</span>
    <span ref="controlRef" class="settings-select-control">
      <span class="settings-select-value">{{ t(selectedLabel) }}</span>
      <span class="settings-select-arrows" aria-hidden="true">
        <MdIcon name="expand_more" :size="14" />
        <MdIcon name="expand_more" :size="14" />
      </span>
    </span>
    <Teleport to="body">
      <div
        v-if="menuVisible"
        ref="menuRef"
        class="settings-select-menu"
        :class="{ 'is-closing': !open }"
      >
        <span ref="menuPillRef" class="settings-select-menu-pill" aria-hidden="true">
          <span class="settings-select-value">{{ t(selectedLabel) }}</span>
          <span class="settings-select-arrows">
            <MdIcon name="expand_more" :size="14" />
            <MdIcon name="expand_more" :size="14" />
          </span>
        </span>
        <div
          :id="menuId"
          ref="menuListRef"
          class="settings-select-menu-list"
          :aria-hidden="!open"
          :inert="!open"
          role="listbox"
          :aria-label="t(label)"
          @keydown="onMenuKeydown"
        >
          <div ref="menuOptionsRef" class="settings-select-menu-options">
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
              <span>{{ t(option.label) }}</span>
              <MdIcon v-if="option.value === modelValue" name="check" :size="21" />
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </button>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch, type PropType } from 'vue';
import MdIcon from './MdIcon.vue';
import { createSettingsSelectMotion } from '../services/settingsSelectMotion.ts';
import { lockSettingsSelectScroll } from '../services/settingsSelectScrollLock.ts';
import { useI18n } from '../composables/useI18n.ts';
import { settingsSelectBackKey } from '../composables/useSettingsTransition.ts';

const { t } = useI18n();

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: [String, Number], required: true },
  options: { type: Array as PropType<ReadonlyArray<{ value: string | number; label: string }>>, required: true },
  disabled: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue']);
const menuId = `settings-select-${useId()}`;
const selectBack = inject(settingsSelectBackKey, null);
const dismissFromSettings = () => close(true, true);
const triggerRef = shallowRef<HTMLButtonElement | null>(null);
const controlRef = shallowRef<HTMLSpanElement | null>(null);
const menuRef = shallowRef<HTMLDivElement | null>(null);
const menuPillRef = shallowRef<HTMLSpanElement | null>(null);
const menuListRef = shallowRef<HTMLDivElement | null>(null);
const menuOptionsRef = shallowRef<HTMLDivElement | null>(null);
const open = ref(false);
const menuVisible = ref(false);
const activeIndex = ref(0);
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || '');
let releaseScrollLock: (() => void) | null = null;
let menuViewport = '';
const motion = createSettingsSelectMotion({
  control: () => controlRef.value,
  menu: () => menuRef.value,
  pill: () => menuPillRef.value,
  list: () => menuListRef.value,
  options: () => menuOptionsRef.value,
  onClosed: () => {
    if (!open.value) {
      menuVisible.value = false;
      removeViewportListeners();
      unlockScroll();
      unregisterSelectBack();
    }
  }
});

function unregisterSelectBack() {
  if (selectBack?.value === dismissFromSettings) selectBack.value = null;
}

function unlockScroll() {
  releaseScrollLock?.();
  releaseScrollLock = null;
}

function focusOption(index: number) {
  activeIndex.value = index;
  const menu = menuListRef.value;
  const option = menu?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index];
  if (!menu || !option) return;
  option.focus({ preventScroll: true });
  // 只滚动菜单自身，scrollIntoView 会连带移动背景并误触发关闭。
  let top = option.offsetTop;
  let parent = option.offsetParent;
  while (parent instanceof HTMLElement && parent !== menu) {
    top += parent.offsetTop;
    parent = parent.offsetParent;
  }
  if (top < menu.scrollTop) menu.scrollTop = top;
  else if (top + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
    menu.scrollTop = top + option.offsetHeight - menu.clientHeight;
  }
}

async function showMenu() {
  if (props.disabled || !props.options.length || !triggerRef.value) return;
  // 收缩途中重开沿用同一把锁，直到卡片完全归位才释放。
  releaseScrollLock ??= lockSettingsSelectScroll(triggerRef.value, () => open.value ? menuRef.value : null);
  const viewport = window.visualViewport;
  const index = Math.max(0, props.options.findIndex(option => option.value === props.modelValue));
  menuViewport = viewportGeometry();
  activeIndex.value = index;
  open.value = true;
  menuVisible.value = true;
  if (selectBack) selectBack.value = dismissFromSettings;
  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);
  await nextTick();
  if (open.value) {
    motion.setOpen(true, props.options.length);
    focusOption(index);
  }
}

function removeListeners() {
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('focusin', onFocusIn);
  document.removeEventListener('keydown', onDocumentKeydown, true);
}

function removeViewportListeners() {
  window.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('scroll', onViewportChange);
}

function close(restoreFocus = false, immediate = false) {
  if (!open.value && !immediate) return;
  open.value = false;
  removeListeners();
  if (restoreFocus) triggerRef.value?.focus({ preventScroll: true });
  if (immediate) motion.setOpen(false, props.options.length, true);
  else {
    // 提交新选项后再量胶囊，新文案改变宽度时也能精确归位。
    void nextTick(() => {
      if (!open.value && menuVisible.value) motion.setOpen(false, props.options.length);
    });
  }
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

function viewportGeometry() {
  const viewport = window.visualViewport;
  return [window.innerWidth, window.innerHeight, viewport?.width, viewport?.height, viewport?.offsetLeft, viewport?.offsetTop, viewport?.scale].join(':');
}

function onViewportChange() {
  // 锁滚动条产生的 resize 会异步送达；几何未变化时不能误关刚展开的菜单。
  if (viewportGeometry() !== menuViewport) close(false, true);
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

watch(() => [props.disabled, props.options, props.modelValue], () => {
  if (open.value) close(true);
});
onBeforeUnmount(() => {
  removeListeners();
  removeViewportListeners();
  motion.dispose();
  unlockScroll();
  unregisterSelectBack();
});
</script>

<style scoped>
@property --settings-select-scrollbar-opacity {
  syntax: '<number>';
  inherits: true;
  initial-value: 0;
}

.settings-select-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--md-space-700);
  padding: var(--md-space-150) var(--md-space-250);
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
  font-weight: 500;
}

.settings-select-value {
  color: var(--md-on-surface-variant);
}

.settings-select-control,
.settings-select-menu-pill {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 8px;
  padding: 6px 10px;
  font-size: 13px;
}

.settings-select-control {
  --settings-select-control-surface: transparent;
  margin: -6px -10px -6px 0;
  border-radius: 999px;
  background: var(--settings-select-control-surface);
  transition: background-color 50ms cubic-bezier(0.2, 0, 0, 1);
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

.settings-select-row:focus-visible .settings-select-control {
  --settings-select-control-surface: var(--md-surface-high);
  transition-duration: 200ms;
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
  overflow: hidden;
  overflow: clip;
  color: var(--md-on-surface);
  --settings-select-menu-elevation: 0;
  box-shadow: 0 calc(8px * var(--settings-select-menu-elevation)) calc(32px * var(--settings-select-menu-elevation))
    color-mix(in oklab, var(--md-shadow-color-soft) calc(24% * var(--settings-select-menu-elevation)), transparent);
  opacity: 0;
}

.settings-select-menu-pill,
.settings-select-menu-list {
  position: absolute;
  top: 0;
  right: 0;
  box-sizing: border-box;
}

.settings-select-menu-pill {
  pointer-events: none;
}

.settings-select-menu-list {
  --settings-select-scrollbar-opacity: 0;
  --settings-select-scrollbar-color: color-mix(in oklab, var(--md-on-surface-variant)
    calc(28% * var(--settings-select-scrollbar-opacity)), transparent);
  overflow: hidden auto;
  overscroll-behavior: contain;
  border: solid transparent;
  border-width: 8px 8px 8px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--settings-select-scrollbar-color) transparent;
}

.settings-select-menu-list.is-settled {
  --settings-select-scrollbar-opacity: 1;
  transition: --settings-select-scrollbar-opacity 160ms cubic-bezier(0.2, 0, 0, 1);
}

@supports selector(::-webkit-scrollbar) {
  .settings-select-menu-list {
    scrollbar-width: auto;
    scrollbar-color: auto;
  }

  .settings-select-menu-list::-webkit-scrollbar {
    display: block;
    width: 4px;
  }

  .settings-select-menu-list::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--settings-select-scrollbar-color);
  }
}

/* 给模糊后的文字和选中态留出透明边缘，不把滚动条纳入滤镜。 */
.settings-select-menu-options {
  padding: 3px 3px 3px 8px;
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
    --settings-select-control-surface: var(--md-surface-high);
    transition-duration: 200ms;
  }

  .settings-select-option:hover {
    background: var(--md-select-menu-hover);
  }
}

.settings-select-option:active {
  background: color-mix(in oklab, var(--md-surface-highest) 88%, var(--md-on-surface) 12%);
}

.settings-select-menu.is-closing {
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .settings-select-control,
  .settings-select-option,
  .settings-select-menu-list.is-settled {
    transition: none;
  }
}

@media (max-width: 599px) {
  .settings-select-row {
    padding-inline: var(--md-space-200);
  }

  .settings-select-label {
    font-size: 15px;
  }

  .settings-select-control {
    font-size: 12px;
  }
}
</style>
