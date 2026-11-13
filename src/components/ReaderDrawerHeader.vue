<template>
  <div
    v-if="isCompact"
    class="mobile-sheet-drag-zone h-9 flex shrink-0 cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing"
    :class="{ 'is-prominent': prominent }"
    @pointerdown="$emit('drag-start', $event)"
    @pointermove="$emit('drag-move', $event)"
    @pointerup="$emit('drag-end', $event)"
    @pointercancel="$emit('drag-cancel', $event)"
  >
    <span class="h-1 w-8 rounded-full bg-[var(--md-outline-variant)]"></span>
  </div>

  <header class="md-drawer-header" :class="{ 'is-prominent': prominent }">
    <div class="md-drawer-heading">
      <h2 :id="titleId" class="md-drawer-title">{{ title }}</h2>
      <p v-if="subtitle" class="md-drawer-subtitle" :title="subtitle">{{ subtitle }}</p>
    </div>
    <button
      type="button"
      class="md-icon-button"
      :title="closeLabel"
      :aria-label="closeLabel"
      @click="$emit('close')"
    >
      <MdIcon name="close" />
    </button>
    <slot name="status" />
  </header>
</template>

<script setup lang="ts">
import MdIcon from './MdIcon.vue';

defineProps({
  isCompact: { type: Boolean, default: false },
  prominent: { type: Boolean, default: false },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  titleId: { type: String, required: true },
  closeLabel: { type: String, default: '关闭' }
});

defineEmits(['close', 'drag-start', 'drag-move', 'drag-end', 'drag-cancel']);
</script>

<style scoped>
.mobile-sheet-drag-zone.is-prominent { height: 24px; }
.md-drawer-header.is-prominent {
  min-height: 92px;
  gap: 12px;
  padding: 22px 20px;
}
.is-prominent .md-drawer-title { font-size: 22px; }
.is-prominent .md-icon-button {
  order: -1;
  width: 48px;
  height: 48px;
  flex: none;
  background: var(--md-surface);
}
@media (max-width: 899px) {
  .md-drawer-header.is-prominent {
    min-height: 76px;
    padding-block: 12px 16px;
  }
}
</style>
