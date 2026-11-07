<template>
  <dialog ref="dialogRef" class="md-library-dialog" aria-labelledby="shelf-dialog-title" @cancel.prevent="resolveShelfDialog()" @keydown.stop="onKeydown">
    <ShelfDialogContent ref="contentRef" :request="pendingShelfDialog" @resolve="resolveShelfDialog" />
  </dialog>
</template>

<script setup>
import { shallowRef, watch, nextTick, onBeforeUnmount } from 'vue';
import { useShelfDialogs } from '../composables/useShelfDialogs.js';
import ShelfDialogContent from './ShelfDialogContent.vue';

const { pendingShelfDialog, resolveShelfDialog } = useShelfDialogs();
const dialogRef = shallowRef(null);
const contentRef = shallowRef(null);

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
  const elements = [...dialogRef.value.querySelectorAll('button, input')];
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

onBeforeUnmount(() => resolveShelfDialog());
</script>
