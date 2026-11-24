<template>
  <div>
    <p class="md-mobile-sheet-label">{{ t('导入作品') }}</p>
    <div class="md-mobile-sheet-card">
      <button type="button" class="md-mobile-sheet-row"
        :class="{ 'island-menu-item': desktop }" @click="$emit('pick-files')">
        <span class="md-mobile-sheet-icon"><MdIcon name="upload_file" /></span>
        <span class="md-mobile-sheet-copy">
          <b>{{ t('导入文件') }}</b>
          <small class="truncate">{{ t('EPUB、CBZ、PDF 等') }}</small>
        </span>
        <MdIcon name="chevron_right" :size="desktop ? 20 : 24" />
      </button>
      <button v-if="canPickFolder" type="button" class="md-mobile-sheet-row"
        :class="{ 'island-menu-item': desktop }" @click="$emit('pick-folder')">
        <span class="md-mobile-sheet-icon"><MdIcon name="folder_open" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('导入文件夹') }}</b><small>{{ t('图片目录会合并为一本漫画') }}</small></span>
        <MdIcon name="chevron_right" :size="desktop ? 20 : 24" />
      </button>
      <MdSwitch v-if="nativeImport" v-model="importInPlace" class="md-mobile-sheet-row"
        :class="{ 'island-menu-item': desktop }" :aria-label="t('原位置入库')">
        <span class="flex items-center gap-3">
          <span class="md-mobile-sheet-icon"><MdIcon name="file_open" /></span>
          <span class="md-mobile-sheet-copy">
            <b>{{ t('原位置入库') }}</b>
            <small class="truncate">{{ t('开启读原件，关闭复制') }}</small>
          </span>
        </span>
      </MdSwitch>
    </div>
    <p v-if="isAndroid && canPickFolder" class="md-mobile-sheet-hint px-3">{{ t('选择要导入的文件夹，里面的子文件夹也会一起扫描。按钮灰色时，可以进入下一级再选择。') }}</p>
    <p class="md-mobile-sheet-label">{{ t('整理书架') }}</p>
    <div class="md-mobile-sheet-card">
      <button type="button" class="md-mobile-sheet-row" :class="{ 'island-menu-item': desktop }" @click="$emit('create-collection')">
        <span class="md-mobile-sheet-icon"><MdIcon name="create_new_folder" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('新建书库') }}</b><small>{{ t(desktop ? '先建一个书库，再放入作品' : '为喜欢的作品留一个位置') }}</small></span>
        <MdIcon name="chevron_right" :size="desktop ? 20 : 24" />
      </button>
    </div>
    <div v-if="!desktop" class="md-mobile-sheet-card md-mobile-sheet-notice">
      <MdIcon name="info" />
      <span class="md-mobile-sheet-copy"><b>{{ t('只保存在此设备') }}</b><small>{{ t('导入、解析与阅读均在本机完成。') }}</small></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { canPickFolder, isAndroid } from '../services/platform.ts';
import { canUseNativeImport } from '../services/nativeImport.ts';
import MdIcon from './MdIcon.vue';
import MdSwitch from './MdSwitch.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();
const nativeImport = canUseNativeImport();

defineProps({ desktop: { type: Boolean, default: false } });
const importInPlace = defineModel('importInPlace', { type: Boolean, required: true });
defineEmits(['create-collection', 'pick-files', 'pick-folder']);
</script>
