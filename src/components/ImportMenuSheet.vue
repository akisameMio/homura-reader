<template>
  <MobileBottomSheet :open="open" :title="t('添加内容')" title-id="import-menu-title" @close="close" @cancel="close">
    <p class="md-mobile-sheet-label">{{ t('导入作品') }}</p>
    <div class="md-mobile-sheet-card">
      <button type="button" class="md-mobile-sheet-row" @click="choose('pick-files')">
        <span class="md-mobile-sheet-icon is-accent"><MdIcon name="upload_file" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('导入文件') }}</b><small>EPUB / CBZ / ZIP / PDF / MOBI / TXT / Markdown</small></span>
        <MdIcon name="chevron_right" />
      </button>
      <button v-if="canPickFolder" type="button" class="md-mobile-sheet-row" @click="choose('pick-folder')">
        <span class="md-mobile-sheet-icon"><MdIcon name="folder_open" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('导入文件夹') }}</b><small>{{ t('图片目录会合并为一本漫画') }}</small></span>
        <MdIcon name="chevron_right" />
      </button>
    </div>
    <p class="md-mobile-sheet-label">{{ t('整理书架') }}</p>
    <div class="md-mobile-sheet-card">
      <button type="button" class="md-mobile-sheet-row" @click="choose('create-collection')">
        <span class="md-mobile-sheet-icon"><MdIcon name="create_new_folder" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('新建书库') }}</b><small>{{ t('为喜欢的作品留一个位置') }}</small></span>
        <MdIcon name="chevron_right" />
      </button>
    </div>
    <div class="md-mobile-sheet-card md-mobile-sheet-notice">
      <MdIcon name="info" />
      <span class="md-mobile-sheet-copy"><b>{{ t('只保存在此设备') }}</b><small>{{ t('导入、解析与阅读均在本机完成。') }}</small></span>
    </div>
    <template #footer>
      <button type="button" class="md-filled-button" @click="choose('pick-files')"><MdIcon name="upload_file" />{{ t('选择文件') }}</button>
    </template>
  </MobileBottomSheet>
</template>

<script setup lang="ts">
import { canPickFolder } from '../services/platform.ts';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['update:open', 'create-collection', 'pick-files', 'pick-folder']);
function close() {
  emit('update:open', false);
}
function choose(action: 'create-collection' | 'pick-files' | 'pick-folder') {
  close();
  emit(action);
}
</script>
