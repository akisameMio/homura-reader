<template>
  <MobileBottomSheet v-if="isCompact" :open="open" :title="t('外观设置')" title-id="appearance-sheet-title" @close="open = false" @cancel="open = false">
    <AppearancePanel mobile-sheet />
    <template #footer><button type="button" class="md-tonal-button" @click="open = false">{{ t('完成') }}</button></template>
  </MobileBottomSheet>
  <!-- 外观浮层：桌面顶栏右上角弹出卡片 / 手机底部 sheet -->
  <Transition
    enter-active-class="md-fade-enter-active"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="md-fade-leave-active"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open && !isCompact"
      class="fixed inset-0 z-40"
      @click="open = false"
    ></div>
  </Transition>

  <Transition
    enter-active-class="md-sheet-enter-active"
    enter-from-class="translate-y-2 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="md-sheet-leave-active"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="open && !isCompact"
      class="fixed z-50 right-[28px] top-[68px] w-[280px] max-h-[calc(100dvh-92px)] overflow-y-auto overscroll-contain rounded-[20px] p-4 bg-[var(--md-surface-container)] shadow-[0_24px_64px_-34px_color-mix(in_oklab,var(--md-shadow-color-soft)_50%,transparent)]"
    >
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-[17px] font-semibold">{{ t('外观设置') }}</h3>
        <button
          @click="open = false"
          class="md-hit-target w-10 h-10 -mr-1 rounded-full grid place-items-center text-[var(--md-on-surface-variant)] hover:bg-[var(--md-surface-high)] transition-colors"
          :title="t('关闭')"
          :aria-label="t('关闭外观设置')"
        >
          <MdIcon name="close" class="w-4 h-4" />
        </button>
      </div>
      <AppearancePanel />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useViewport } from '../composables/useViewport.ts';
import MobileBottomSheet from './MobileBottomSheet.vue';
import AppearancePanel from './AppearancePanel.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const { isCompact } = useViewport();
const props = defineProps({
  open: { type: Boolean, default: false }
});
const emit = defineEmits(['update:open']);

const open = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
});

</script>
