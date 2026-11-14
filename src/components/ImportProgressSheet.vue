<template>
  <MobileBottomSheet :open="open" :title="store.status === 'running' ? t('导入进度') : store.status === 'cancelled' ? t('导入已停止') : t('导入结果')"
    title-id="mobile-import-progress-title" @close="closeSheet" @cancel="closeSheet" @closed="finishClose">
    <ImportProgressPanel ref="panelRef" mobile-sheet @retry="$emit('retry')" @close="closeSheet" />
    <template #footer>
      <button v-if="primaryAction" type="button" :class="primaryAction.variant === 'primary' ? 'md-filled-button' : 'md-tonal-button'"
        :disabled="primaryAction.disabled" @click="panelRef?.runPrimaryAction()"><MdIcon :name="primaryAction.icon" />{{ primaryAction.label }}</button>
      <button v-if="store.status === 'running' || store.canRetry" type="button" class="md-text-button" @click="closeSheet">{{ store.status === 'running' ? t('收起，继续导入') : t('关闭') }}</button>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useImportProgressStore } from '../stores/importProgress.ts';
import ImportProgressPanel from './ImportProgressPanel.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

defineEmits(['retry']);
const store = useImportProgressStore();
const panelRef = shallowRef<InstanceType<typeof ImportProgressPanel> | null>(null);
const open = computed(() => store.status !== 'idle' && store.expanded);
const primaryAction = computed(() => panelRef.value?.primaryAction);
let dismissOnClosed = false;
function closeSheet() {
  dismissOnClosed = store.status !== 'running';
  store.toggleExpanded(false);
}
function finishClose() {
  if (dismissOnClosed && store.status !== 'running' && !store.expanded) store.dismiss();
  dismissOnClosed = false;
}
</script>
