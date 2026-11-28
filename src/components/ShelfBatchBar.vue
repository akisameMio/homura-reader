<template>
  <div class="shelf-batch-bar" role="group" :aria-label="t('书本批量操作')">
    <span class="sr-only" role="status">{{ t(countMessage, { 0: count }) }}</span>
    <span class="batch-count" aria-hidden="true">{{ countParts[0] }}<span class="batch-count-window">
      <span ref="countText">{{ count }}</span>
      <span ref="previousText" class="batch-count-previous">{{ previousCount }}</span>
    </span>{{ countParts[1] }}</span>
    <ShelfToolTooltip
      v-for="action in actions"
      :key="action.event"
      :label="action.hint || action.label"
      :align-end="action.event === 'cancel'"
      class="batch-action"
      :class="{ 'batch-storage-action': action.event === 'manage-storage' }"
    >
      <MdIconButton
        class="batch-action-button"
        :class="{
          'batch-delete-button': action.event === 'delete' && dangerDelete,
          'batch-storage-button': action.event === 'manage-storage'
        }"
        :aria-label="action.label"
        :aria-description="action.hint"
        :disabled="action.disabled"
        @click="emit(action.event)"
      >
        <MdIcon :name="action.icon" :size="20" />
      </MdIconButton>
    </ShelfToolTooltip>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { prefersReducedMotion } from '../services/spring.ts';
import MdIcon from './MdIcon.vue';
import MdIconButton from './MdIconButton.vue';
import ShelfToolTooltip from './ShelfToolTooltip.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  count: { type: Number, required: true },
  includesCollections: Boolean,
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
const countMessage = computed(() => props.includesCollections ? '已选 {0} 项' : '已选 {0} 本');
const countParts = computed(() => t(countMessage.value).split('{0}'));
const countText = shallowRef<HTMLElement | null>(null);
const previousText = shallowRef<HTMLElement | null>(null);
const previousCount = ref(props.count);
const storageHint = computed(() => props.count !== 1 || props.includesCollections ? t('单选时可管理存储') : undefined);

watch(() => props.count, async (count, previous, onCleanup) => {
  if (prefersReducedMotion()) return;
  let cancelled = false;
  let enter: Animation | undefined;
  let leave: Animation | undefined;
  onCleanup(() => {
    cancelled = true;
    enter?.cancel();
    leave?.cancel();
  });
  previousCount.value = previous;
  await nextTick();
  if (cancelled) return;
  const direction = count > previous ? 1 : -1;
  const timing = { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
  enter = countText.value?.animate([
    { transform: `translateY(${direction * 100}%)`, opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 }
  ], timing);
  leave = previousText.value?.animate([
    { transform: 'translateY(0)', opacity: 1 },
    { transform: `translateY(${-direction * 100}%)`, opacity: 0 }
  ], timing);
});

const actions = computed(() => [
  { event: 'move', label: props.moveLabel, icon: 'folder_open', disabled: props.moveDisabled, hint: undefined },
  { event: 'manage-storage', label: t('管理存储'), icon: 'database', disabled: !props.canManageStorage, hint: storageHint.value },
  { event: 'delete', label: props.deleteLabel, icon: props.dangerDelete ? 'delete' : 'star', disabled: props.deleteDisabled, hint: undefined },
  {
    event: 'select-all',
    label: t(props.allSelected ? '取消全选' : '全选'),
    icon: props.allSelected ? 'remove' : 'check_circle',
    disabled: props.selectAllDisabled,
    hint: undefined
  },
  { event: 'cancel', label: t('取消多选'), icon: 'close', disabled: false, hint: undefined }
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
.batch-count-window {
  position: relative;
  display: inline-grid;
  overflow: hidden;
  vertical-align: bottom;
}
.batch-count-previous {
  position: absolute;
  inset: 0 0 auto auto;
  opacity: 0;
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
.batch-storage-button {
  color: var(--md-primary);
  transition: color 180ms ease, opacity 180ms ease;
}
.batch-storage-button:disabled {
  color: var(--md-on-surface-variant);
}
.batch-action-button:focus-visible {
  outline-offset: -4px;
}
@media (hover: hover) and (pointer: fine) {
  .batch-action-button:not(:disabled):hover {
    --icon-button-background: color-mix(in oklab, var(--md-on-surface) 8%, transparent);
  }
}
@media (max-width: 899px) {
  .batch-storage-action:has(button:disabled) {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .batch-storage-button {
    transition: none;
  }
}
</style>
