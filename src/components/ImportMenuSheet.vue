<template>
  <dialog
    ref="dialogRef"
    class="md-bottom-sheet"
    aria-labelledby="import-menu-title"
    @cancel.prevent="close"
    @click="onBackdropClick"
  >
    <div class="md-bottom-sheet-body">
      <div class="md-sheet-grip" aria-hidden="true"></div>
      <header>
        <p class="md-surface-kicker">导入作品</p>
        <h2 id="import-menu-title" class="md-surface-title">添加内容</h2>
      </header>

      <div class="import-menu-list">
        <button ref="firstItemRef" type="button" class="import-menu-row is-selected" @click="choose('pick-files')">
          <span class="import-menu-icon"><MdIcon name="upload_file" /></span>
          <span class="import-menu-copy"><b>导入文件</b><small>EPUB / PDF / MOBI / TXT</small></span>
          <span class="import-menu-check" aria-hidden="true"><MdIcon name="check" /></span>
        </button>
        <button v-if="canPickFolder" type="button" class="import-menu-row" @click="choose('pick-folder')">
          <span class="import-menu-icon"><MdIcon name="folder_open" /></span>
          <span class="import-menu-copy"><b>导入文件夹</b><small>图片目录会合并为一本漫画</small></span>
          <span class="import-menu-check is-empty" aria-hidden="true"></span>
        </button>
        <div class="import-menu-divider" aria-hidden="true"></div>
        <button type="button" class="import-menu-row" @click="choose('create-collection')">
          <span class="import-menu-icon is-plain"><MdIcon name="create_new_folder" /></span>
          <span class="import-menu-copy"><b>新建书库</b><small>先创建书库，再整理作品</small></span>
          <span class="import-menu-check is-empty" aria-hidden="true"></span>
        </button>
      </div>

      <div class="md-surface-actionbar">
        <div class="md-surface-aux">
          <button type="button" class="md-surface-text-button" @click="close">取消</button>
        </div>
        <button type="button" class="md-surface-action is-import" @click="choose('pick-files')">
          <MdIcon name="upload_file" />
          选择文件
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { nextTick, shallowRef, watch } from 'vue';
import { canPickFolder } from '../services/platform.ts';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  open: { type: Boolean, default: false }
});
const emit = defineEmits(['update:open', 'create-collection', 'pick-files', 'pick-folder']);

const dialogRef = shallowRef<HTMLDialogElement | null>(null);
const firstItemRef = shallowRef<HTMLElement | null>(null);

watch(
  () => props.open,
  async open => {
    await nextTick();
    if (open) {
      if (!dialogRef.value?.open) dialogRef.value?.showModal();
      firstItemRef.value?.focus();
      return;
    }
    dialogRef.value?.close();
  },
  { immediate: true }
);

function close() {
  emit('update:open', false);
}

function choose(action) {
  close();
  emit(action);
}

function onBackdropClick(event) {
  if (event.target === dialogRef.value) close();
}
</script>

<style scoped>
.import-menu-list {
  display: grid;
  gap: 4px;
  margin-top: 18px;
}

.import-menu-row {
  display: flex;
  width: 100%;
  min-height: 68px;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 10px;
  border: 0;
  border-radius: 18px;
  background: transparent;
  color: var(--md-on-surface);
  text-align: left;
  transition:
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-short) var(--md-ease-emphasized);
}

.import-menu-row.is-selected {
  background: color-mix(in oklab, var(--md-primary-container) 48%, var(--md-surface-low));
}

.import-menu-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.import-menu-icon.is-plain {
  background: var(--md-surface-high);
  color: var(--md-on-surface);
}

.import-menu-icon :deep(svg) {
  width: 21px;
  height: 21px;
}

.import-menu-copy {
  min-width: 0;
  flex: 1;
}

.import-menu-copy b,
.import-menu-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-menu-copy b {
  font-size: 13px;
  font-weight: 650;
}

.import-menu-copy small {
  margin-top: 3px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.import-menu-check {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.import-menu-check.is-empty {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--md-outline) 48%, transparent);
}

.import-menu-check :deep(svg) {
  width: 14px;
  height: 14px;
}

.import-menu-divider {
  height: 0.5px;
  margin: 7px 12px;
  background: color-mix(in oklab, var(--md-outline-variant) 75%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .import-menu-row:hover {
    background: color-mix(in oklab, var(--md-primary-container) 42%, transparent);
    transform: translateX(2px);
  }
}
</style>
