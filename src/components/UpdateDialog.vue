<template>
  <MobileBottomSheet :open="open" :title="sheetTitle" title-id="mobile-update-title"
    :backdrop-dismissible="status !== 'downloading'" :draggable="status !== 'downloading'"
    :close-label="status === 'downloading' ? t('取消下载') : t('关闭软件更新')" @close="onCancel" @cancel="onCancel">
    <UpdateIslandPanel ref="panelRef" mobile-sheet :status="status" :release="release" :current-version="currentVersion"
      :package-info="packageInfo" :error="error" :download="download" :download-error="downloadError"
      @close="$emit('close')" @retry="$emit('retry')" @changelog="$emit('changelog')" @download="$emit('download')"
      @cancel-download="$emit('cancel-download')" @install="$emit('install')" />
    <template #footer>
      <button v-if="primaryAction" type="button" :class="primaryAction.variant === 'tonal' ? 'md-tonal-button' : 'md-filled-button'"
        :disabled="primaryAction.disabled" @click="panelRef?.runPrimaryAction()"><MdIcon :name="primaryAction.icon" />{{ primaryAction.label }}</button>
      <button v-if="status !== 'downloading'" type="button" class="md-text-button" @click="$emit('close')">{{ status === 'downloaded' ? t('稍后安装') : status === 'available' ? t('稍后提醒') : t('关闭') }}</button>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { PropType } from 'vue';
import type { NormalizedRelease } from '../services/updates.ts';
import UpdateIslandPanel from './UpdateIslandPanel.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

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

const panelRef = shallowRef<InstanceType<typeof UpdateIslandPanel> | null>(null);
const primaryAction = computed(() => panelRef.value?.primaryAction);
const sheetTitle = computed(() => {
  if (props.status === 'downloading') return t('正在下载更新');
  if (props.status === 'downloaded') return t('下载完成');
  if (props.status === 'loading') return t('检查更新');
  return t('软件更新');
});

function onCancel() {
  if (props.status === 'downloading') {
    emit('cancel-download');
    return;
  }
  emit('close');
}

</script>
