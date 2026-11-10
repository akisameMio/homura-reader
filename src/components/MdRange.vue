<template>
  <div
    class="md-range"
    :class="{ 'is-rtl': rtl, 'is-disabled': disabled, 'is-bubble': variant === 'bubble' }"
    :style="{ '--md-range-progress': `${progress}%`, '--md-range-ratio': progress / 100 }"
  >
    <input
      class="md-range-input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      :aria-valuetext="ariaValueText || undefined"
      @input="onInput"
    />
    <!-- 点阵胶囊轨道 + 竖条手柄；原生 input 透明覆盖，保留键盘与触控语义 -->
    <div class="md-range-track" aria-hidden="true">
      <span class="md-range-fill"></span>
      <template v-if="variant === 'bubble'">
        <span
          v-for="tick in ticks"
          :key="tick.value"
          class="md-range-tick"
          :class="{ 'is-filled': tick.value <= currentValue }"
          :style="{ left: `calc(20px + (100% - 40px) * ${tick.ratio})` }"
        ></span>
      </template>
      <span class="md-range-thumb">
        <template v-if="variant === 'bubble'">{{ valueLabel || modelValue }}</template>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: [Number, String], required: true },
  min: { type: [Number, String], default: 0 },
  max: { type: [Number, String], default: 100 },
  step: { type: [Number, String], default: 1 },
  disabled: { type: Boolean, default: false },
  rtl: { type: Boolean, default: false },
  variant: { type: String, default: 'dots' },
  valueLabel: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  ariaValueText: { type: String, default: '' }
});

const emit = defineEmits(['update:modelValue']);

function toNumber(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// 拖动时先更新本地值，让活动轨道紧跟手柄，不等父级下一帧回写。
const currentValue = ref(toNumber(props.modelValue));

watch(() => props.modelValue, value => {
  currentValue.value = toNumber(value);
});

const progress = computed(() => {
  const min = toNumber(props.min);
  const max = toNumber(props.max);
  if (max <= min) return 0;
  return Math.min(100, Math.max(0, ((currentValue.value - min) / (max - min)) * 100));
});

// 字号圆钮滑条按可取值打点；位置与手柄共用 20px 端点留白。
const ticks = computed(() => {
  const min = toNumber(props.min);
  const max = toNumber(props.max);
  const step = toNumber(props.step);
  if (max <= min || step <= 0) return [];
  const count = Math.floor((max - min) / step);
  return Array.from({ length: count + 1 }, (_, index) => {
    const value = min + index * step;
    return { value, ratio: (value - min) / (max - min) };
  });
});

function onInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  currentValue.value = value;
  emit('update:modelValue', value);
}
</script>
