<template>
  <div class="shelf-batch-bar" role="group" :aria-label="t('书本批量操作')">
    <span class="batch-count" role="status" :title="label">{{ label }}</span>
    <ShelfToolTooltip
      v-for="action in actions"
      :key="action.event"
      :label="action.label"
      :align-end="action.event === 'cancel'"
      class="batch-action"
    >
      <MdIconButton
        class="batch-action-button"
        :class="{ 'batch-delete-button': action.event === 'delete' && dangerDelete }"
        :aria-label="action.label"
        :disabled="action.disabled"
        @click="emit(action.event)"
      >
        <MdIcon :name="action.icon" :size="20" />
      </MdIconButton>
    </ShelfToolTooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MdIcon from './MdIcon.vue';
import MdIconButton from './MdIconButton.vue';
import ShelfToolTooltip from './ShelfToolTooltip.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  label: { type: String, required: true },
  allSelected: { type: Boolean, default: false },
  selectAllDisabled: { type: Boolean, default: false },
  moveLabel: { type: String, required: true },
  moveDisabled: { type: Boolean, default: false },
  deleteLabel: { type: String, required: true },
  deleteDisabled: { type: Boolean, default: false },
  canManageStorage: { type: Boolean, default: false },
  dangerDelete: { type: Boolean, default: false }
});

const emit = defineEmits(['select-all', 'move', 'delete', 'cancel', 'manage-storage']);
const actions = computed(() => [
  { event: 'move', label: props.moveLabel, icon: 'folder_open', disabled: props.moveDisabled },
  ...(props.canManageStorage ? [{ event: 'manage-storage' as const, label: t('存储'), icon: 'database', disabled: false }] : []),
  { event: 'delete', label: props.deleteLabel, icon: props.dangerDelete ? 'delete' : 'star', disabled: props.deleteDisabled },
  {
    event: 'select-all',
    label: t(props.allSelected ? '取消全选' : '全选'),
    icon: props.allSelected ? 'remove' : 'check_circle',
    disabled: props.selectAllDisabled
  },
  { event: 'cancel', label: t('取消多选'), icon: 'close', disabled: false }
] as const);
</script>

<style scoped>
.shelf-batch-bar {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  padding-inline: 8px 4px;
  color: var(--md-on-surface);
}
.batch-count {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 8em;
  min-width: 0;
  margin-inline-end: 8px;
  padding-inline-start: 3px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.batch-count:lang(en) {
  flex-basis: 9.5em;
}
.batch-count + .batch-action {
  margin-inline-start: auto;
}
.batch-action-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 4px;
  border-radius: 16px;
}
.batch-delete-button {
  color: var(--md-error);
}
.batch-action-button:disabled {
  opacity: 0.45;
}
.batch-action-button:focus-visible {
  outline-offset: -4px;
}
@media (hover: hover) and (pointer: fine) {
  .batch-action-button:not(:disabled):hover {
    --icon-button-background: color-mix(in oklab, var(--md-on-surface) 8%, transparent);
  }
}
</style>
