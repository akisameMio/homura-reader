<template>
  <dialog
    ref="dialogRef"
    class="md-bottom-sheet"
    aria-labelledby="update-island-title"
    @cancel.prevent="onCancel"
    @click="onBackdropClick"
  >
    <UpdateIslandPanel
      ref="panelRef"
      :status="status"
      :release="release"
      :current-version="currentVersion"
      :package-info="packageInfo"
      :error="error"
      :download="download"
      :download-error="downloadError"
      @close="$emit('close')"
      @retry="$emit('retry')"
      @changelog="$emit('changelog')"
      @download="$emit('download')"
      @cancel-download="$emit('cancel-download')"
      @install="$emit('install')"
    />
  </dialog>
</template>

<script setup lang="ts">
import { nextTick, shallowRef, watch } from 'vue';
import type { PropType } from 'vue';
import type { NormalizedRelease } from '../services/updates.ts';
import UpdateIslandPanel from './UpdateIslandPanel.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  status: { type: String, default: 'idle' },
  release: { type: Object as PropType<NormalizedRelease | null>, default: null },
  currentVersion: { type: String, required: true },
  packageInfo: { type: Object, required: true },
  error: { type: Object, default: null },
  download: {
    type: Object,
    default: () => ({
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      fileName: '',
      path: '',
      size: 0,
      version: '',
      packageLabel: '',
      platform: ''
    })
  },
  downloadError: { type: Object, default: null }
});
const emit = defineEmits(['close', 'retry', 'changelog', 'download', 'cancel-download', 'install']);

const dialogRef = shallowRef<HTMLDialogElement | null>(null);
const panelRef = shallowRef<{ focusInitial?: () => void } | null>(null);

watch(
  () => props.open,
  async open => {
    await nextTick();
    if (open) {
      if (!dialogRef.value?.open) dialogRef.value?.showModal();
      panelRef.value?.focusInitial?.();
      return;
    }
    dialogRef.value?.close();
  },
  { immediate: true }
);

watch(
  () => props.status,
  async () => {
    if (!props.open) return;
    await nextTick();
    panelRef.value?.focusInitial?.();
  }
);

function onCancel() {
  if (props.status === 'downloading') {
    emit('cancel-download');
    return;
  }
  emit('close');
}

function onBackdropClick(event: MouseEvent) {
  if (event.target !== dialogRef.value) return;
  if (props.status === 'downloading') return;
  emit('close');
}
</script>
