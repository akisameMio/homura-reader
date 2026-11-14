<template>
  <MobileBottomSheet :open="!!pendingDuplicate" :title="t('发现同名书本')" title-id="mobile-duplicate-import-title" :busy="!!displayPending?.busy"
    @close="resolveImport()" @cancel="resolveImport()" @opened="skipButtonRef?.focus()" @closed="clearDisplay">
    <DuplicateImportContent mobile-sheet :pending="displayPending" @resolve="resolveImport" />
    <template #footer>
      <button type="button" class="md-filled-button" :disabled="displayPending?.busy" @click="resolveImport(true)"><MdIcon name="upload_file" />{{ t('仍然导入') }}</button>
      <div class="md-mobile-sheet-actions">
        <button ref="skipButtonRef" type="button" class="md-tonal-button" :disabled="displayPending?.busy" @click="resolveImport()">{{ displayPending?.batch ? t('跳过这批') : t('跳过此书') }}</button>
        <button type="button" class="md-text-button" :disabled="displayPending?.busy" @click="resolveImport(DUPLICATE_SKIP_ALL)">{{ t('全部跳过') }}</button>
      </div>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { useDuplicateImport, DUPLICATE_SKIP_ALL } from '../composables/useDuplicateImport.ts';
import type { DuplicatePending } from '../composables/useDuplicateImport.ts';
import DuplicateImportContent from './DuplicateImportContent.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const { pendingDuplicate, resolveImport } = useDuplicateImport();
const displayPending = shallowRef<DuplicatePending | null>(null);
const skipButtonRef = shallowRef<HTMLButtonElement | null>(null);
watch(pendingDuplicate, pending => {
  if (pending) displayPending.value = pending;
}, { immediate: true });
function clearDisplay() {
  if (!pendingDuplicate.value) displayPending.value = null;
}
</script>
