<template>
  <form v-if="request" ref="formRef" @submit.prevent="submitName">
    <template v-if="request.kind === 'name'">
      <p v-if="!desktop" class="md-mobile-sheet-label">{{ t('书库设置') }}</p>
      <div class="md-mobile-sheet-card is-padded">
        <label for="mobile-collection-name" class="md-mobile-sheet-field-label">{{ t('书库名称') }}</label>
        <input id="mobile-collection-name" ref="nameInput" v-model="name" class="md-mobile-sheet-field"
          maxlength="80" autocomplete="off" :aria-invalid="!!error" aria-describedby="mobile-collection-name-error" />
        <div class="md-mobile-sheet-field-meta md-mobile-sheet-hint" :class="{ 'justify-end': desktop }"><span v-if="!desktop">{{ t('为作品取一个好找的名字') }}</span><span>{{ name.length }} / 80</span></div>
        <p v-if="error" id="mobile-collection-name-error" role="alert" class="md-mobile-sheet-field-error">{{ t(error) }}</p>
      </div>
      <div v-if="request.message" class="md-mobile-sheet-card md-mobile-sheet-notice">
        <MdIcon name="folder" /><span class="md-mobile-sheet-copy"><small>{{ request.message }}</small></span>
      </div>
      <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
    </template>
    <template v-else-if="request.kind === 'folder'">
      <p class="md-mobile-sheet-label">{{ t('扫描结果') }}</p>
      <div class="md-mobile-sheet-card">
        <div class="md-mobile-sheet-row">
          <span class="md-mobile-sheet-icon is-accent"><MdIcon name="folder_open" /></span>
          <span class="md-mobile-sheet-copy">
            <b>{{ t('{0} 本作品等待导入', { 0: requestCountLabel }) }}</b>
            <small v-if="folderScanHint">{{ folderScanHint }}</small>
            <small v-if="request.shelfBookCount">{{ t('{0} 本作品放在书架首页', { 0: request.shelfBookCount }) }}</small>
          </span>
        </div>
      </div>
      <ul v-if="request.folders?.length" class="md-mobile-sheet-card folder-preview" :aria-label="t('预览导入目录')">
        <li v-for="folder in previewFolders" :key="folder.path" class="folder-preview-row"
          :style="{ paddingInlineStart: Math.min(folder.depth, 6) * 12 + 12 + 'px' }">
          <MdIcon name="folder" :size="18" />
          <span class="folder-preview-name" :title="folder.path">{{ folder.depth > 6 ? folder.path : folder.title }}</span>
          <small v-if="folder.bookCount">{{ t('{0} 册', { 0: folder.bookCount }) }}</small>
        </li>
        <li v-if="previewLimit < request.folders.length" class="px-3">
          <button type="button" class="md-text-button" @click="previewLimit += 100">{{ t('查看更多目录') }}</button>
        </li>
      </ul>
      <template v-else-if="!request.folders">
        <p class="md-mobile-sheet-label">{{ t('推荐整理方式') }}</p>
        <div class="md-mobile-sheet-card">
          <div class="md-mobile-sheet-row">
            <span class="md-mobile-sheet-icon is-accent"><MdIcon name="create_new_folder" /></span>
            <span class="md-mobile-sheet-copy"><b>{{ t('创建一个新书库') }}</b><small>{{ t('目录名会作为书库名，作品会自动归档') }}</small></span>
            <MdIcon name="check" />
          </div>
        </div>
        <p class="md-mobile-sheet-hint px-3">{{ request.message }}</p>
      </template>
    </template>
    <template v-else-if="request.kind === 'move'">
      <p class="md-mobile-sheet-label">{{ request.message || t('选择目标书库') }}</p>
      <div class="md-mobile-sheet-card">
        <button v-for="option in request.options" :key="option.value" type="button" class="md-mobile-sheet-row" @click="$emit('resolve', option.value)">
          <span class="md-mobile-sheet-icon"><MdIcon name="folder" /></span>
          <span class="md-mobile-sheet-copy"><b>{{ option.title }}</b></span><MdIcon name="chevron_right" />
        </button>
        <p v-if="!request.options?.length" class="md-mobile-sheet-notice md-mobile-sheet-hint">{{ t('暂无其他书库，请先新建书库。') }}</p>
      </div>
    </template>
    <template v-else>
      <p class="md-mobile-sheet-label">{{ isDestructive ? t('请确认影响范围') : t('收藏管理') }}</p>
      <div class="md-mobile-sheet-card">
        <div class="md-mobile-sheet-row">
          <span class="md-mobile-sheet-icon" :class="isDestructive ? 'is-danger' : 'is-accent'"><MdIcon :name="dialogIcon" /></span>
          <span class="md-mobile-sheet-copy"><b>{{ request.title }}</b><small>{{ request.message }}</small></span>
        </div>
      </div>
      <div class="md-mobile-sheet-card md-mobile-sheet-notice" :class="{ 'is-danger': isDestructive }">
        <MdIcon :name="isDestructive ? 'warning' : 'info'" />
        <span class="md-mobile-sheet-copy"><b>{{ isDestructive ? t('删除后无法恢复') : t('只调整收藏状态') }}</b>
          <small>{{ isDestructive ? (removesLocalFiles ? t('本地内容与阅读记录会一起移除，请确认后继续。') : t('请确认上方列出的内容后继续。')) : t('作品与阅读记录仍保留在本机书架。') }}</small>
        </span>
      </div>
    </template>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import type { PropType } from 'vue';
import MdIcon from './MdIcon.vue';
import type { ShelfDialogOptions } from '../composables/useShelfDialogs.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  request: { type: Object as PropType<ShelfDialogOptions | null>, default: null },
  desktop: { type: Boolean, default: false }
});
const emit = defineEmits(['resolve']);

const formRef = shallowRef<HTMLElement | null>(null);
const nameInput = shallowRef<HTMLInputElement | null>(null);
const name = ref('');
const error = ref('');
const isDestructive = computed(() => (
  props.request?.kind === 'confirm' && props.request.intent === 'delete'
));
const removesLocalFiles = computed(() => (
  isDestructive.value && props.request?.removesFiles
));
const dialogIcon = computed(() => {
  if (props.request?.kind === 'confirm') return isDestructive.value ? 'delete' : 'star';
  if (props.request?.kind === 'folder') return 'folder_open';
  if (props.request?.kind === 'name') return 'create_new_folder';
  return 'local_library';
});
const requestCountLabel = computed(() => props.request?.bookCount ?? 0);
const previewLimit = ref(100);
const previewFolders = computed(() => props.request?.folders?.slice(0, previewLimit.value) ?? []);
const folderScanHint = computed(() => {
  const { folders } = props.request ?? {};
  if (!folders) return t('可整理为一个书库');
  return folders.length ? t('预计 {0} 个书库', { 0: folders.length }) : '';
});
const nameActionLabel = computed(() => (
  props.request?.intent === 'rename' ? t('保存名称') : t('创建书库')
));
const primaryAction = computed(() => {
  const request = props.request;
  if (!request) return null;
  if (request.kind === 'folder') {
    const shelfOnly = request.folders?.length === 0;
    return {
      label: shelfOnly ? t('导入到书架') : request.folders ? t('保留层级导入') : t('创建书库'),
      icon: shelfOnly ? 'upload_file' : 'create_new_folder',
      variant: 'primary',
      disabled: false
    };
  }
  if (request.kind === 'name') {
    return {
      label: nameActionLabel.value,
      icon: 'create_new_folder',
      variant: 'primary',
      disabled: false
    };
  }
  if (request.kind === 'confirm') {
    return {
      label: request.confirmLabel || t('确认'),
      icon: request.confirmIcon || (isDestructive.value ? 'delete' : 'star'),
      variant: isDestructive.value ? 'danger' : 'tonal',
      disabled: false
    };
  }
  return {
    label: t('取消'),
    icon: 'close',
    variant: 'tonal',
    disabled: false
  };
});

watch(
  () => props.request,
  request => {
    previewLimit.value = 100;
    name.value = request?.initialName || '';
    error.value = '';
  },
  { immediate: true }
);

async function focusInitial() {
  await nextTick();
  if (nameInput.value) {
    nameInput.value.focus();
    nameInput.value.select();
    return true;
  }
  const target = formRef.value?.querySelector<HTMLElement>('button:not([hidden])');
  target?.focus();
  return !!target;
}

function submitName() {
  const request = props.request;
  if (!request || request.kind !== 'name') return;
  error.value = request.validate?.(name.value) || '';
  if (!name.value.trim()) error.value = t('请输入书库名称');
  if (!error.value) emit('resolve', name.value.trim());
}

function runPrimaryAction() {
  const request = props.request;
  if (!request) return;
  if (request.kind === 'name') {
    submitName();
    return;
  }
  if (request.kind === 'move') {
    emit('resolve', null);
    return;
  }
  emit('resolve', true);
}

defineExpose({ focusInitial, primaryAction, runPrimaryAction });
</script>

<style scoped>
.folder-preview {
  list-style: none;
  margin-inline: 0;
  padding-block: 6px;
}
.folder-preview-row {
  display: flex;
  align-items: start;
  gap: 8px;
  padding-block: 8px;
  padding-inline-end: 12px;
  font-size: 13px;
}
.folder-preview-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.folder-preview-row small {
  flex-shrink: 0;
  color: var(--md-on-surface-variant);
}
</style>
