<template>
  <dialog
    ref="dialogRef"
    class="md-bottom-sheet"
    aria-labelledby="duplicate-import-title"
    @cancel.prevent="resolveImport()"
    @click="onBackdropClick"
    @keydown.stop="onKeydown"
  >
    <div class="md-bottom-sheet-body">
      <DuplicateImportContent
        ref="contentRef"
        :pending="pendingDuplicate"
        @resolve="resolveImport"
      />
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { shallowRef, watch, nextTick } from 'vue';
import { useDuplicateImport } from '../composables/useDuplicateImport.ts';
import DuplicateImportContent from './DuplicateImportContent.vue';

const dialogRef = shallowRef(null);
const contentRef = shallowRef(null);
const { pendingDuplicate, resolveImport } = useDuplicateImport();

watch(pendingDuplicate, async pending => {
  if (!pending) {
    dialogRef.value?.close();
    return;
  }
  await nextTick();
  if (!pendingDuplicate.value) return;
  if (!dialogRef.value.open) dialogRef.value.showModal();
  contentRef.value?.focusInitial();
}, { immediate: true });

function onBackdropClick(event) {
  if (event.target !== dialogRef.value) return;
  const bounds = dialogRef.value.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
    resolveImport();
  }
}

function onKeydown(event) {
  if (event.key !== 'Tab') return;
  const buttons = dialogRef.value.querySelectorAll('button');
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

</script>
