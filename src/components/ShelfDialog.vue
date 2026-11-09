<template>
  <dialog
    ref="dialogRef"
    class="md-bottom-sheet"
    aria-labelledby="shelf-dialog-title"
    @cancel.prevent="resolveShelfDialog()"
    @click="onBackdropClick"
    @keydown.stop="onKeydown"
  >
    <ShelfDialogContent ref="contentRef" :request="(pendingShelfDialog as any)" @resolve="resolveShelfDialog" />
  </dialog>
</template>

<script setup lang="ts">
import { shallowRef, watch, nextTick } from 'vue';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import ShelfDialogContent from './ShelfDialogContent.vue';

const { pendingShelfDialog, resolveShelfDialog } = useShelfDialogs();
const dialogRef = shallowRef<HTMLDialogElement | null>(null);
const contentRef = shallowRef<any>(null);

watch(pendingShelfDialog, async pending => {
  if (!pending) {
    dialogRef.value?.close();
    return;
  }
  await nextTick();
  if (!pendingShelfDialog.value || !dialogRef.value) return;
  if (!dialogRef.value.open) dialogRef.value.showModal();
  contentRef.value?.focusInitial();
}, { immediate: true });

function onKeydown(event) {
  if (event.key !== 'Tab') return;
  if (!dialogRef.value) return;
  const elements = [...dialogRef.value.querySelectorAll('button, input')] as HTMLElement[];
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onBackdropClick(event) {
  if (event.target === dialogRef.value) resolveShelfDialog();
}

</script>
