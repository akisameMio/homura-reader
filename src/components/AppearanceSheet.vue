<template>
  <MobileBottomSheet
    :open="open"
    desktop-side
    :title="t('外观设置')"
    title-id="appearance-sheet-title"
    close-label="关闭外观设置"
    @close="open = false"
    @cancel="open = false"
  >
    <AppearancePanel />
    <template v-if="isCompact" #footer>
      <button type="button" class="md-tonal-button" @click="open = false">{{ t('完成') }}</button>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useViewport } from '../composables/useViewport.ts';
import MobileBottomSheet from './MobileBottomSheet.vue';
import AppearancePanel from './AppearancePanel.vue';
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
