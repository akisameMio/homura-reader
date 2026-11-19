<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="md-mobile-sheet-dialog"
      :class="{ 'is-keyboard-anchored': keyboardAnchored && compact, 'is-desktop-side': desktopSide && !compact }"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId || undefined"
      :aria-busy="busy || undefined"
      @cancel.prevent="onCancel"
      @close="onNativeClose"
      @pointerdown.capture="onDialogPointerDown"
      @click="onBackdropClick"
      @keydown.stop
    >
      <Transition
        :css="false"
        @before-enter="onBeforeEnter"
        @enter="onEnter"
        @before-leave="spring.onBeforeLeave"
        @leave="spring.onLeave"
        @after-leave="onAfterLeave"
        @leave-cancelled="spring.onLeaveCancelled"
      >
        <section v-if="visible" ref="sheetRef" class="md-mobile-sheet">
          <ReaderDrawerHeader
            :is-compact="compact && draggable && !busy"
            prominent
            :title="title"
            :title-id="titleId"
            :close-label="t(closeLabel)"
            :close-disabled="busy"
            @close="requestClose"
            @drag-start="onDragStart"
            @drag-move="onDragMove"
            @drag-end="onDragEnd"
            @drag-cancel="onDragCancel"
          >
            <template #status><slot name="status" /></template>
          </ReaderDrawerHeader>
          <div class="md-mobile-sheet-body"><slot /></div>
          <footer v-if="$slots.footer" class="md-mobile-sheet-footer"><slot name="footer" /></footer>
        </section>
      </Transition>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useViewport } from '../composables/useViewport.ts';
import { useSheetDrag } from '../composables/useSheetDrag.ts';
import { useSheetSpring } from '../composables/useSheetSpring.ts';
import { lockSettingsSelectScroll as lockBackgroundScroll } from '../services/settingsSelectScrollLock.ts';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  titleId: { type: String, required: true },
  descriptionId: { type: String, default: '' },
  closeLabel: { type: String, default: '关闭面板' },
  backdropDismissible: { type: Boolean, default: true },
  scrimCloseable: { type: Boolean, default: false },
  draggable: { type: Boolean, default: true },
  busy: { type: Boolean, default: false },
  desktopSide: { type: Boolean, default: false },
  keyboardAnchored: { type: Boolean, default: false }
});
const emit = defineEmits(['close', 'cancel', 'opened', 'closed']);
const dialogRef = shallowRef<HTMLDialogElement | null>(null);
const visible = ref(false);
const viewport = useViewport();
const compact = computed(() => !props.desktopSide || viewport.isCompact.value);
const dragEnabled = computed(() => compact.value && props.draggable && !props.busy);
const isOpen = computed(() => props.open);
const spring = useSheetSpring({ isCompact: compact });
const { sheetRef, onDragStart, onDragMove, onDragEnd, onDragCancel } = useSheetDrag({
  isCompact: dragEnabled,
  isOpen,
  onClose: requestClose,
  onDragBegin: spring.cancel
});
let revision = 0;
let disposed = false;
let unlockScroll: (() => void) | null = null;
let trigger: HTMLElement | null = null;
let entered = false;
let anchoredViewportHeight = 0;
let backdropPointerDown = false;

function onBeforeEnter(element: Element) {
  entered = true;
  spring.onBeforeEnter(element);
}

function onEnter(element: Element, done: () => void) {
  const current = revision;
  spring.onEnter(element, () => {
    done();
    if (disposed || current !== revision || !props.open) return;
    if (sheetRef.value?.contains(document.activeElement)) return;
    // WebKit 会为屏外焦点滚动 dialog；等侧滑落位后再聚焦，避免先跳入再缩回。
    sheetRef.value?.querySelector<HTMLButtonElement>('.md-drawer-header button')?.focus({ preventScroll: true });
  });
}

function onCancel() {
  if (!props.busy) emit('cancel');
}

// 部分 Chromium 版本把 cancel 事件的 cancelable 置为 false，Esc 会先把原生模态层关掉；
// 这里在离场动画结束前把面板重新撑住，收起流程仍由 props.open 驱动。
function onNativeClose() {
  if (disposed || !props.open) return;
  const dialog = dialogRef.value;
  if (!dialog || dialog.open) return;
  dialog.showModal();
  syncViewport();
}

function requestClose() {
  if (!props.busy) emit('close');
}

function onDialogPointerDown(event: PointerEvent) {
  backdropPointerDown = event.target === dialogRef.value;
}

function onBackdropClick(event: MouseEvent) {
  // 拖拽从面板内开始，松手时落在遮罩上也可能派发 click。
  if (event.target !== dialogRef.value || (event.detail > 0 && !backdropPointerDown)) return;
  // 忙碌（如导入进行中）时点遮罩仍需能收起面板「继续在后台跑」，但拖拽 / Esc / 关闭按钮保持锁定。
  if (props.busy) {
    if (props.scrimCloseable) emit('close');
    return;
  }
  if (props.backdropDismissible) requestClose();
}

function onAfterLeave() {
  spring.onAfterLeave();
  if (props.open) return;
  entered = false;
  if (dialogRef.value?.open) dialogRef.value.close();
  unlockScroll?.();
  unlockScroll = null;
  if (trigger?.isConnected && !document.querySelector('dialog[open]')) trigger.focus({ preventScroll: true });
  trigger = null;
  anchoredViewportHeight = 0;
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
  emit('closed');
}

function syncViewport() {
  const dialog = dialogRef.value;
  const viewport = window.visualViewport;
  if (!dialog) return;
  if (props.keyboardAnchored) {
    if (!anchoredViewportHeight) {
      anchoredViewportHeight = Math.round(viewport?.height || window.innerHeight);
      dialog.style.height = `${anchoredViewportHeight}px`;
      dialog.style.top = `${Math.round(viewport?.offsetTop || 0)}px`;
      dialog.style.setProperty('--md-sheet-anchored-layout-height', `${anchoredViewportHeight}px`);
      dialog.style.setProperty('--md-sheet-anchored-height', `${Math.round(anchoredViewportHeight * 0.78)}px`);
    }
    return;
  }
  if (!viewport) return;
  dialog.style.height = `${viewport.height}px`;
  dialog.style.top = `${viewport.offsetTop}px`;
  dialog.style.setProperty('--md-sheet-viewport-height', `${viewport.height}px`);
}

watch(isOpen, async open => {
  const current = ++revision;
  if (!open) {
    visible.value = false;
    // 打开后尚未插入面板就被下一项操作关闭时，没有 leave 钩子接管收尾。
    if (!entered) onAfterLeave();
    return;
  }
  await nextTick();
  if (disposed || current !== revision || !props.open) return;
  const dialog = dialogRef.value;
  if (!dialog) return;
  if (!dialog.open) {
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 与设置选择菜单共用计数锁，连续打开下一张面板时不会提前恢复背景滚动。
    unlockScroll = lockBackgroundScroll(trigger || document.body, () => sheetRef.value);
    anchoredViewportHeight = 0;
    dialog.showModal();
    syncViewport();
    if (!props.keyboardAnchored) {
      window.visualViewport?.addEventListener('resize', syncViewport);
      window.visualViewport?.addEventListener('scroll', syncViewport);
    }
  }
  visible.value = true;
  await nextTick();
  if (disposed || current !== revision || !props.open) return;
  emit('opened');
}, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  revision += 1;
  unlockScroll?.();
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
  dialogRef.value?.close();
});
</script>
