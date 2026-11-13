<template>
  <label class="settings-select-row">
    <span class="settings-select-label">{{ label }}</span>
    <span class="settings-select-value" aria-hidden="true">{{ selectedLabel }}</span>
    <MdIcon name="chevron_right" />
    <select :value="modelValue" :aria-label="label" @change="select">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: [String, Number], required: true },
  options: { type: Array as PropType<ReadonlyArray<{ value: string | number; label: string }>>, required: true }
});
const emit = defineEmits(['update:modelValue']);
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || '');

function select(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const option = props.options.find(item => String(item.value) === value);
  if (option) emit('update:modelValue', option.value);
}
</script>

<style scoped>
.settings-select-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 74px;
  padding: 18px 24px;
  cursor: pointer;
}

.settings-select-label {
  flex: 1;
  min-width: 0;
  font-size: 16px;
}

.settings-select-value {
  font-size: 13px;
  color: var(--md-on-surface-variant);
}

.settings-select-row > svg {
  width: 22px;
  height: 22px;
  color: var(--md-on-surface-variant);
}

select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.settings-select-row:focus-within {
  outline: 2px solid var(--md-primary);
  outline-offset: -4px;
  border-radius: 8px;
}

@media (max-width: 599px) {
  .settings-select-row {
    padding: 18px 20px;
  }

  .settings-select-label {
    font-size: 15px;
  }

  .settings-select-value {
    font-size: 12px;
  }
}
</style>
