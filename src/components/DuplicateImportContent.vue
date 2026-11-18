<template>
  <section v-if="pending">
    <p v-if="!desktop || pending.batch" class="md-mobile-sheet-label">{{ pending.batch ? t('检测到 {0} 本同名作品', { 0: pending.count }) : t('同名检测') }}</p>
    <div class="md-mobile-sheet-card">
      <div v-if="!pending.batch && pending.existingTitle" class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon"><MdIcon name="local_library" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ pending.existingTitle }}</b><small>{{ t('已在书架') }}</small></span>
        <span v-if="!desktop" class="md-mobile-sheet-meta">{{ t('已有') }}</span>
      </div>
      <div v-for="item in incomingItems" :key="item.title" class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-accent"><MdIcon name="upload_file" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ item.title }}</b><small>{{ pending.batch && (item.count ?? 0) > 1 ? t('待导入 {0} 个文件', { 0: item.count }) : t('待导入') }}</small></span>
      </div>
    </div>
    <div class="md-mobile-sheet-notice" :class="desktop ? 'is-island-note' : 'md-mobile-sheet-card'">
      <MdIcon name="info" /><span class="md-mobile-sheet-copy"><b>{{ t('仍然导入会保留为独立书本') }}</b><small>{{ t('不会覆盖已有书本或阅读进度。') }}</small></span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import type { DuplicatePending } from '../composables/useDuplicateImport.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  pending: { type: Object as PropType<DuplicatePending | null>, default: null },
  desktop: { type: Boolean, default: false }
});
const emit = defineEmits(['resolve']);

const incomingItems = computed(() => {
  const pending = props.pending;
  if (!pending) return [];
  if (!pending.batch) return [{ title: pending.title || t('待导入文件'), count: 1 }];
  return (pending.items || []).slice(0, 2);
});
const primaryAction = computed(() => ({
  label: t('仍然导入'),
  icon: 'upload_file',
  variant: 'primary',
  disabled: !!props.pending?.busy
}));

function runPrimaryAction() {
  emit('resolve', true);
}

defineExpose({ primaryAction, runPrimaryAction });
</script>

<style scoped>
.is-island-note { padding: 0 14px; }
.is-island-note > .md3-icon { width: 18px; height: 18px; }
</style>
