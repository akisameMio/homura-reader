<template>
  <MobileBottomSheet :open="!!pendingShelfDialog" :title="displayRequest?.title || t('书库管理')" title-id="mobile-shelf-dialog-title"
    @close="resolveShelfDialog()" @cancel="resolveShelfDialog()" @opened="contentRef?.focusInitial()" @closed="clearDisplay">
    <ShelfDialogContent ref="contentRef" mobile-sheet :request="displayRequest" @resolve="resolveShelfDialog" />
    <template #footer>
      <button v-if="displayRequest?.kind !== 'move' && primaryAction" type="button"
        :class="[primaryAction.variant === 'tonal' ? 'md-tonal-button' : 'md-filled-button', { 'md-mobile-sheet-danger': primaryAction.variant === 'danger' }]"
        @click="contentRef?.runPrimaryAction()"><MdIcon :name="primaryAction.icon" />{{ primaryAction.label }}</button>
      <button v-if="displayRequest?.kind === 'folder'" type="button" class="md-tonal-button" @click="resolveShelfDialog(false)">{{ t('直接导入') }}</button>
      <button type="button" class="md-text-button" @click="resolveShelfDialog()">{{ t('取消') }}</button>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import type { ShelfDialogOptions } from '../composables/useShelfDialogs.ts';
import ShelfDialogContent from './ShelfDialogContent.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const { pendingShelfDialog, resolveShelfDialog } = useShelfDialogs();
const displayRequest = shallowRef<ShelfDialogOptions | null>(null);
const contentRef = shallowRef<InstanceType<typeof ShelfDialogContent> | null>(null);
const primaryAction = computed(() => contentRef.value?.primaryAction);
watch(pendingShelfDialog, request => {
  if (request) displayRequest.value = request;
}, { immediate: true });
function clearDisplay() {
  if (!pendingShelfDialog.value) displayRequest.value = null;
}
</script>
