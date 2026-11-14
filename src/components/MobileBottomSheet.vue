<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="md-mobile-sheet-dialog"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId || undefined"
      :aria-busy="busy || undefined"
      @cancel.prevent="onCancel"
      @close="onNativeClose"
      @click="onBackdropClick"
      @keydown.stop
    >
      <Transition
        :css="false"
        @before-enter="onBeforeEnter"
        @enter="spring.onEnter"
        @before-leave="spring.onBeforeLeave"
        @leave="spring.onLeave"
        @after-leave="onAfterLeave"
        @leave-cancelled="spring.onLeaveCancelled"
      >
        <section v-if="visible" ref="sheetRef" class="md-mobile-sheet">
          <ReaderDrawerHeader
            :is-compact="draggable && !busy"
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
  draggable: { type: Boolean, default: true },
  busy: { type: Boolean, default: false }
});
const emit = defineEmits(['close', 'cancel', 'opened', 'closed']);
const dialogRef = shallowRef<HTMLDialogElement | null>(null);
const visible = ref(false);
const compact = computed(() => true);
const dragEnabled = computed(() => props.draggable && !props.busy);
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

function onBeforeEnter(element: Element) {
  entered = true;
  spring.onBeforeEnter(element);
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

function onBackdropClick(event: MouseEvent) {
  if (event.target === dialogRef.value && props.backdropDismissible) requestClose();
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
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
  emit('closed');
}

function syncViewport() {
  const dialog = dialogRef.value;
  const viewport = window.visualViewport;
  if (!dialog || !viewport) return;
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
    dialog.showModal();
    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
  }
  visible.value = true;
  await nextTick();
  if (disposed || current !== revision || !props.open) return;
  sheetRef.value?.querySelector<HTMLButtonElement>('.md-drawer-header button')?.focus({ preventScroll: true });
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
