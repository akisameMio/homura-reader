<template>
  <span class="shelf-tool-tooltip" :class="{ 'align-end': alignEnd }">
    <slot />
    <span class="shelf-tool-tooltip-label" aria-hidden="true">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
defineProps({
  label: { type: String, required: true },
  alignEnd: Boolean
});
</script>

<style scoped>
.shelf-tool-tooltip {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
}
.shelf-tool-tooltip-label {
  position: absolute;
  z-index: 1;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  padding: 4px 8px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--md-on-surface) 90%, var(--md-surface));
  color: var(--md-surface);
  font-size: 12px;
  line-height: 16px;
  visibility: hidden;
}
.shelf-tool-tooltip-label::before {
  content: '';
  position: absolute;
  inset: -4px 0 100%;
}
.align-end .shelf-tool-tooltip-label {
  left: auto;
  right: 0;
  transform: none;
}
.shelf-tool-tooltip > :deep(button:disabled) {
  pointer-events: none;
}
.shelf-tool-tooltip:has(> :focus-visible) .shelf-tool-tooltip-label {
  visibility: visible;
}
@media (hover: hover) and (pointer: fine) {
  .shelf-tool-tooltip:hover .shelf-tool-tooltip-label {
    visibility: visible;
  }
}
</style>
