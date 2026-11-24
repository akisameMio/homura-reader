<template>
  <MobileBottomSheet :open="!!pendingShelfDialog || menuOpen"
    :title="displayRequest?.title || t('添加内容')" title-id="mobile-shelf-dialog-title"
    :keyboard-anchored="!!addContentPage || displayRequest?.kind === 'name'"
    :resize-page="addContentPage"
    :back-label="displayRequest?.returnToImportMenu ? '返回添加内容' : ''"
    @back="emit('back-to-import-menu')" @close="close" @cancel="onCancel"
    @opened="contentRef?.focusInitial()" @closed="clearDisplay">
    <ShelfDialogContent v-if="displayRequest" ref="contentRef" :request="displayRequest" @resolve="resolveShelfDialog" />
    <ImportMenuContent v-else v-model:import-in-place="importInPlace"
      @pick-files="emit('pick-files')"
      @pick-folder="emit('pick-folder')" @create-collection="emit('create-collection')" />
    <template #footer>
      <template v-if="displayRequest">
        <button v-if="displayRequest.kind !== 'move' && primaryAction" type="button"
          :class="[primaryAction.variant === 'tonal' ? 'md-tonal-button' : 'md-filled-button', { 'md-mobile-sheet-danger': primaryAction.variant === 'danger' }]"
          @click="contentRef?.runPrimaryAction()"><MdIcon :name="primaryAction.icon" />{{ primaryAction.label }}</button>
        <button v-if="displayRequest.kind === 'folder' && displayRequest.folders?.length !== 0" type="button" class="md-tonal-button" @click="resolveShelfDialog(false)">{{ t('直接导入') }}</button>
        <button type="button" class="md-text-button" @click="resolveShelfDialog()">{{ t('取消') }}</button>
      </template>
      <button v-else type="button" class="md-filled-button" @click="emit('pick-files')"><MdIcon name="upload_file" />{{ t('选择文件') }}</button>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import type { ShelfDialogOptions } from '../composables/useShelfDialogs.ts';
import ShelfDialogContent from './ShelfDialogContent.vue';
import ImportMenuContent from './ImportMenuContent.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();
const menuOpen = defineModel('menuOpen', { type: Boolean, required: true });
const importInPlace = defineModel('importInPlace', { type: Boolean, required: true });
const emit = defineEmits(['back-to-import-menu', 'pick-files', 'pick-folder', 'create-collection']);

const { pendingShelfDialog, resolveShelfDialog } = useShelfDialogs();
const displayRequest = shallowRef<ShelfDialogOptions | null>(null);
const contentRef = shallowRef<InstanceType<typeof ShelfDialogContent> | null>(null);
const primaryAction = computed(() => contentRef.value?.primaryAction);
const addContentPage = computed(() => {
  const request = displayRequest.value;
  if (!request) return 'menu';
  if (request.returnToImportMenu) return request.kind;
  return undefined;
});

watch([pendingShelfDialog, menuOpen], ([request, open]) => {
  if (request || open) displayRequest.value = request;
}, { immediate: true });

watch(addContentPage, (page, previous) => {
  if (page && previous === 'menu') void contentRef.value?.focusInitial();
}, { flush: 'post' });

function clearDisplay() {
  if (!pendingShelfDialog.value && !menuOpen.value) displayRequest.value = null;
}

function close() {
  if (pendingShelfDialog.value) resolveShelfDialog();
  else menuOpen.value = false;
}

function onCancel() {
  if (pendingShelfDialog.value?.returnToImportMenu) emit('back-to-import-menu');
  else close();
}
</script>
