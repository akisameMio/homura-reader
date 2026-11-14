<template>
  <div class="flex flex-1 min-w-0 items-center gap-1.5 min-[430px]:gap-2" role="group" :aria-label="t('书本批量操作')">
    <div class="flex-1 min-w-0 min-h-11 px-2 rounded-[22px] flex flex-wrap items-center gap-1 bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]">
      <span class="text-[13px] px-2" aria-live="polite">
        <span class="hidden min-[430px]:inline">{{ t(label) }}</span>
        <span class="min-[430px]:hidden">{{ compactLabel }}</span>
      </span>
      <button class="md-library-text-button batch-action-button" @click="$emit('select-all')">{{ allSelected ? t('取消全选') : t('全选') }}</button>
      <button class="md-library-text-button batch-action-button" :disabled="moveDisabled" @click="$emit('move')">{{ t(moveLabel) }}</button>
      <button class="md-library-text-button batch-action-button" :class="{ 'batch-delete-button': dangerDelete }" :disabled="deleteDisabled" @click="$emit('delete')">{{ t(deleteLabel) }}</button>
    </div>
    <button
      class="w-11 h-11 shrink-0 rounded-[22px] grid place-items-center bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]"
      :title="t('取消多选')"
      :aria-label="t('取消多选')"
      @click="$emit('cancel')"
    >
      <MdIcon name="close" class="w-5 h-5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

defineProps({
  label: { type: String, required: true },
  compactLabel: { type: String, required: true },
  allSelected: { type: Boolean, default: false },
  moveLabel: { type: String, required: true },
  moveDisabled: { type: Boolean, default: false },
  deleteLabel: { type: String, required: true },
  deleteDisabled: { type: Boolean, default: false },
  dangerDelete: { type: Boolean, default: false }
});

defineEmits(['select-all', 'move', 'delete', 'cancel']);
</script>

<style scoped>
.batch-action-button.batch-delete-button { color: var(--md-error); }
.batch-action-button {
  min-width: 44px;
  padding-inline: 8px;
  color: var(--md-on-secondary-container);
  white-space: nowrap;
}
</style>
