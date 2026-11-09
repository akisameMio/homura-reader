<template>
  <section v-if="pending" class="duplicate-import-content" aria-labelledby="duplicate-import-title">
    <div class="md-sheet-grip" aria-hidden="true"></div>
    <header>
      <p class="md-surface-kicker">同名检测</p>
      <h2 id="duplicate-import-title" class="md-surface-title">发现同名书本</h2>
      <p class="md-surface-subtitle">
        {{ pending.batch
          ? `按文件名检测到 ${pending.count} 本作品可能与已有书名重复。`
          : `已有同名书《${pending.existingTitle}》。` }}
      </p>
    </header>

    <div class="duplicate-list">
      <div v-if="!pending.batch && pending.existingTitle" class="duplicate-row is-existing">
        <span class="duplicate-icon" aria-hidden="true"><MdIcon name="local_library" /></span>
        <span class="duplicate-copy">
          <b>{{ pending.existingTitle }}</b>
          <small>已在书架</small>
        </span>
        <span class="duplicate-chip">已有</span>
      </div>

      <div v-for="item in incomingItems" :key="item.title" class="duplicate-row">
        <span class="duplicate-cover" aria-hidden="true"></span>
        <span class="duplicate-copy">
          <b>{{ item.title }}</b>
          <small>{{ pending.batch && item.count > 1 ? `待导入 ${item.count} 个文件` : '待导入' }}</small>
        </span>
        <span class="duplicate-chip is-incoming">待导入</span>
      </div>
    </div>

    <div class="duplicate-note">
      <MdIcon name="info" />
      <span>
        <b>仍然导入会保留为独立书本</b>
        <small>不会覆盖已有书本或阅读进度。</small>
      </span>
    </div>

    <div class="md-surface-actionbar">
      <div class="md-surface-aux">
        <button
          ref="skipButtonRef"
          type="button"
          class="md-surface-text-button"
          :disabled="pending.busy"
          @click="emit('resolve')"
        >
          {{ pending.batch ? '跳过这批' : '跳过此书' }}
        </button>
        <button
          type="button"
          class="md-surface-text-button"
          :disabled="pending.busy"
          @click="emit('resolve', DUPLICATE_SKIP_ALL)"
        >
          全部跳过
        </button>
      </div>
      <button
        v-if="!hostPrimaryAction"
        type="button"
        class="md-surface-action is-primary"
        :disabled="pending.busy"
        @click="emit('resolve', true)"
      >
        <MdIcon name="upload_file" />
        仍然导入
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, shallowRef } from 'vue';
import { DUPLICATE_SKIP_ALL } from '../composables/useDuplicateImport.ts';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  pending: { type: Object, default: null },
  hostPrimaryAction: { type: Boolean, default: false }
});
const emit = defineEmits(['resolve']);

const skipButtonRef = shallowRef(null);
const incomingItems = computed(() => {
  const pending = props.pending;
  if (!pending) return [];
  if (!pending.batch) return [{ title: pending.title || '待导入文件', count: 1 }];
  return (pending.items || []).slice(0, 2);
});
const primaryAction = computed(() => ({
  label: '仍然导入',
  icon: 'upload_file',
  variant: 'primary',
  disabled: !!props.pending?.busy
}));

async function focusInitial() {
  await nextTick();
  skipButtonRef.value?.focus();
}

function runPrimaryAction() {
  emit('resolve', true);
}

defineExpose({ focusInitial, primaryAction, runPrimaryAction });
</script>

<style scoped>
.duplicate-import-content {
  min-height: 360px;
  padding: 20px;
}

.duplicate-list {
  display: grid;
  gap: 6px;
  margin-top: 16px;
}

.duplicate-row {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border-radius: 17px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 82%, transparent);
}

.duplicate-row.is-existing {
  background: color-mix(in oklab, var(--md-primary-container) 18%, var(--md-surface-low));
}

.duplicate-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  border-radius: 13px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.duplicate-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.duplicate-cover {
  width: 34px;
  aspect-ratio: 3 / 4;
  flex: none;
  border-radius: 7px;
  background: color-mix(in oklab, var(--md-primary-container) 68%, var(--md-surface-high));
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 76%, transparent);
}

.duplicate-copy {
  min-width: 0;
  flex: 1;
}

.duplicate-copy b,
.duplicate-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.duplicate-copy b {
  font-size: 13px;
  font-weight: 650;
}

.duplicate-copy small {
  margin-top: 3px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.duplicate-chip {
  flex: none;
  padding: 5px 8px;
  border-radius: 999px;
  background: var(--md-surface-high);
  color: var(--md-on-surface-variant);
  font-size: 10px;
  font-weight: 650;
}

.duplicate-chip.is-incoming {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.duplicate-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 17px;
  background: color-mix(in oklab, var(--md-secondary-container) 36%, var(--md-surface-low));
  color: var(--md-on-secondary-container);
}

.duplicate-note :deep(svg) {
  width: 18px;
  height: 18px;
  margin-top: 1px;
  flex: none;
  color: var(--md-primary);
}

.duplicate-note b,
.duplicate-note small {
  display: block;
}

.duplicate-note b {
  font-size: 12px;
  font-weight: 650;
  line-height: 1.45;
}

.duplicate-note small {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.8;
}

@media (max-width: 899px) {
  .duplicate-import-content {
    min-height: 0;
    padding: 0;
  }

  .duplicate-import-content .md-surface-text-button {
    flex: none;
    padding: 0 12px;
    white-space: nowrap;
  }
}

@media (max-width: 379px) {
  .duplicate-import-content .md-surface-action {
    min-width: 0;
    padding: 0 12px;
  }
}
</style>
