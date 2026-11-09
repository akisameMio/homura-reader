<template>
  <dialog
    ref="dialogRef"
    class="md-bottom-sheet"
    aria-labelledby="import-progress-title"
    @cancel.prevent="closeSheet"
    @click="onBackdropClick"
  >
    <ImportProgressPanel
      ref="panelRef"
      @retry="$emit('retry')"
      @close="closeSheet"
    />
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import { useImportProgressStore } from '../stores/importProgress.ts';
import ImportProgressPanel from './ImportProgressPanel.vue';

defineEmits(['retry']);

const store = useImportProgressStore();
const dialogRef = shallowRef<HTMLDialogElement | null>(null);
const panelRef = shallowRef<{ focusInitial?: () => void } | null>(null);
const open = computed(() => store.status !== 'idle' && store.expanded);

watch(
  open,
  async visible => {
    await nextTick();
    if (visible) {
      if (!dialogRef.value?.open) dialogRef.value?.showModal();
      panelRef.value?.focusInitial?.();
      return;
    }
    dialogRef.value?.close();
  },
  { immediate: true }
);

function closeSheet() {
  if (store.status === 'running') {
    store.toggleExpanded(false);
    return;
  }
  store.dismiss();
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === dialogRef.value) closeSheet();
}
</script>
