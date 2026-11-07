<template>
  <form ref="formRef" v-if="request" class="shelf-dialog-content" @submit.prevent="submitName">
    <div class="md-sheet-grip" aria-hidden="true"></div>

    <header class="shelf-dialog-head">
      <span
        class="shelf-dialog-mark"
        :class="{ 'is-danger': isDestructive, 'is-neutral': request.kind === 'confirm' && !isDestructive }"
        aria-hidden="true"
      >
        <MdIcon :name="dialogIcon" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="md-surface-kicker">{{ dialogKicker }}</p>
        <h2 id="shelf-dialog-title" class="md-surface-title shelf-dialog-title">{{ request.title }}</h2>
      </div>
    </header>

    <p
      v-if="request.message && request.kind !== 'confirm' && request.kind !== 'name'"
      class="md-surface-subtitle shelf-dialog-subtitle"
    >
      {{ request.message }}
    </p>

    <template v-if="request.kind === 'folder'">
      <div class="scan-card">
        <b class="scan-number">{{ requestCountLabel }}</b>
        <span class="scan-copy">
          <b>本作品等待导入</b>
          <small>{{ folderScanHint }}</small>
        </span>
        <span class="scan-mode">
          <MdIcon name="folder" />
          目录整理
        </span>
      </div>
      <div class="choice-card">
        <span class="choice-icon"><MdIcon name="create_new_folder" /></span>
        <span class="choice-copy">
          <b>{{ folderMode }}</b>
          <small>目录名会作为书库名，作品会自动归档</small>
        </span>
        <span class="choice-badge">推荐</span>
      </div>
    </template>

    <template v-else-if="request.kind === 'name'">
      <label for="collection-name" class="shelf-field-label">书库名称</label>
      <input
        id="collection-name"
        ref="nameInput"
        v-model="name"
        maxlength="80"
        autocomplete="off"
        class="shelf-name-field"
        :aria-invalid="!!error"
        aria-describedby="collection-name-error"
      />
      <div class="shelf-field-meta">
        <code>COLLECTIONS / {{ name || '未命名' }}</code>
        <span>{{ name.length }} / 80</span>
      </div>
      <p id="collection-name-error" v-if="error" role="alert" class="shelf-field-error">{{ error }}</p>
      <div v-if="request.message" class="shelf-path-note">
        <MdIcon name="folder" />
        <span>{{ request.message }}</span>
      </div>
    </template>

    <template v-else-if="request.kind === 'move'">
      <div class="move-options">
        <button
          v-for="option in request.options"
          :key="option.value"
          type="button"
          class="move-option"
          @click="$emit('resolve', option.value)"
        >
          <span class="move-option-icon"><MdIcon name="folder" /></span>
          <span>{{ option.title }}</span>
          <MdIcon name="chevron_right" />
        </button>
        <p v-if="!request.options.length" class="move-empty">暂无其他书库，请先新建书库。</p>
      </div>
    </template>

    <template v-else>
      <div v-if="isDestructive" class="shelf-danger-panel">
        <MdIcon name="warning" />
        <span>
          <b>{{ removesLocalFiles ? '本地内容与阅读记录会一起移除' : '删除后无法恢复' }}</b>
          <small>{{ request.message }}</small>
        </span>
      </div>
      <div v-else class="shelf-info-panel">
        <MdIcon name="star" />
        <span>
          <b>只调整收藏状态</b>
          <small>{{ request.message }}</small>
        </span>
      </div>
    </template>

    <div class="md-surface-actionbar">
      <div v-if="request.kind !== 'move'" class="md-surface-aux">
        <button type="button" class="md-surface-text-button" @click="$emit('resolve', null)">取消</button>
        <button
          v-if="request.kind === 'folder'"
          type="button"
          class="md-surface-text-button"
          @click="$emit('resolve', false)"
        >
          直接导入
        </button>
      </div>

      <template v-if="!hostPrimaryAction">
        <button
          v-if="request.kind === 'folder'"
          type="button"
          class="md-surface-action is-primary"
          @click="$emit('resolve', true)"
        >
          <MdIcon name="create_new_folder" />
          创建书库
        </button>
        <button
          v-else-if="request.kind === 'name'"
          type="submit"
          class="md-surface-action is-primary"
        >
          <MdIcon name="create_new_folder" />
          {{ nameActionLabel }}
        </button>
        <button
          v-else-if="request.kind === 'confirm'"
          type="button"
          class="md-surface-action"
          :class="isDestructive ? 'is-danger' : 'is-tonal'"
          @click="$emit('resolve', true)"
        >
          <MdIcon :name="isDestructive ? 'delete' : 'star'" />
          {{ request.confirmLabel || '确认' }}
        </button>
        <button
          v-else
          type="button"
          class="md-surface-action is-tonal"
          @click="$emit('resolve', null)"
        >
          取消
        </button>
      </template>
    </div>
  </form>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  request: { type: Object, default: null },
  hostPrimaryAction: { type: Boolean, default: false }
});
const emit = defineEmits(['resolve']);

const formRef = shallowRef(null);
const nameInput = shallowRef(null);
const name = ref('');
const error = ref('');
const isDestructive = computed(() => (
  props.request?.kind === 'confirm'
  && (
    String(props.request.title || '').includes('删除')
    || String(props.request.confirmLabel || '').includes('删除')
  )
));
const removesLocalFiles = computed(() => (
  isDestructive.value
  && String(props.request?.message || '').includes('原始文件')
));
const dialogIcon = computed(() => {
  if (props.request?.kind === 'confirm') return isDestructive.value ? 'delete' : 'star';
  if (props.request?.kind === 'folder') return 'folder_open';
  if (props.request?.kind === 'name') return 'create_new_folder';
  return 'local_library';
});
const dialogKicker = computed(() => {
  if (props.request?.kind === 'confirm') return isDestructive.value ? '永久删除' : '收藏管理';
  if (props.request?.kind === 'folder') return '导入内容';
  if (props.request?.kind === 'name') return '书库设置';
  return '书库整理';
});
const requestCountLabel = computed(() => {
  const match = String(props.request?.message || '').match(/(\d+)\s*本/);
  if (!match) return '—';
  return String(Math.max(0, Number(match[1]) || 0)).padStart(2, '0');
});
const folderMode = computed(() => (
  String(props.request?.message || '').includes('按目录')
    ? '按目录创建书库'
    : '创建一个新书库'
));
const folderScanHint = computed(() => {
  const match = String(props.request?.message || '').match(/按目录分别创建\s*(\d+)\s*个一级书库/);
  return match ? `预计 ${match[1]} 个书库` : '可整理为一个书库';
});
const nameActionLabel = computed(() => (
  String(props.request?.title || '').includes('重命名') ? '保存名称' : '创建书库'
));
const primaryAction = computed(() => {
  const request = props.request;
  if (!request) return null;
  if (request.kind === 'folder') {
    return {
      label: '创建书库',
      icon: 'create_new_folder',
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
      label: request.confirmLabel || '确认',
      icon: isDestructive.value ? 'delete' : 'star',
      variant: isDestructive.value ? 'danger' : 'tonal',
      disabled: false
    };
  }
  return {
    label: '取消',
    icon: 'close',
    variant: 'tonal',
    disabled: false
  };
});

watch(
  () => props.request,
  request => {
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
    return;
  }
  const target = formRef.value?.querySelector('button');
  target?.focus();
}

function submitName() {
  const request = props.request;
  if (!request || request.kind !== 'name') return;
  error.value = request.validate?.(name.value) || '';
  if (!name.value.trim()) error.value = '请输入书库名称';
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
.shelf-dialog-content {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  padding: 20px;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
}

.shelf-dialog-content > .md-surface-actionbar {
  margin-top: auto;
}

.shelf-dialog-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.shelf-dialog-mark {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  border-radius: 14px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.shelf-dialog-mark.is-danger {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.shelf-dialog-mark.is-neutral {
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}

.shelf-dialog-mark :deep(svg) {
  width: 22px;
  height: 22px;
}

.shelf-dialog-subtitle {
  margin-top: 10px;
}

.scan-card {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-top: 16px;
  padding: 14px 15px;
  border-radius: 18px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 84%, transparent);
}

.scan-number {
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 28px;
  font-weight: 680;
  letter-spacing: -0.06em;
  line-height: 1;
}

.scan-copy {
  min-width: 0;
  flex: 1;
}

.scan-copy b,
.scan-copy small {
  display: block;
}

.scan-copy b {
  font-size: 13px;
  font-weight: 650;
}

.scan-copy small {
  margin-top: 3px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.scan-mode {
  display: flex;
  flex: none;
  align-items: center;
  gap: 5px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  font-weight: 600;
}

.scan-mode :deep(svg) {
  width: 16px;
  height: 16px;
}

.choice-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 13px 14px;
  border-radius: 18px;
  background: color-mix(in oklab, var(--md-primary-container) 36%, var(--md-surface-container));
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-primary) 32%, var(--md-outline-variant));
}

.choice-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  border-radius: 13px;
  background: var(--md-surface);
  color: var(--md-primary);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 68%, transparent);
}

.choice-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.choice-copy {
  min-width: 0;
  flex: 1;
}

.choice-copy b,
.choice-copy small {
  display: block;
}

.choice-copy b {
  font-size: 13px;
  font-weight: 650;
}

.choice-copy small {
  margin-top: 3px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  line-height: 1.45;
}

.choice-badge {
  flex: none;
  padding: 4px 7px;
  border-radius: 999px;
  background: var(--md-primary);
  color: var(--md-on-primary);
  font-size: 10px;
  font-weight: 650;
}

.shelf-field-label {
  display: block;
  margin: 18px 0 7px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  font-weight: 650;
}

.shelf-name-field {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border: 0;
  border-radius: 14px;
  outline: none;
  background: var(--md-surface-low);
  color: var(--md-on-surface);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 92%, transparent);
  font-size: 13px;
  font-weight: 600;
}

.shelf-name-field:focus {
  box-shadow:
    inset 0 0 0 1.5px var(--md-primary),
    0 0 0 3px color-mix(in oklab, var(--md-primary) 12%, transparent);
}

.shelf-field-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 7px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.shelf-field-meta code {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shelf-field-meta span {
  flex: none;
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
}

.shelf-field-error {
  margin: 7px 0 0;
  color: var(--md-error);
  font-size: 12px;
}

.shelf-path-note {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--md-surface-low);
  color: var(--md-on-surface-variant);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 78%, transparent);
  font-size: 12px;
  line-height: 1.5;
}

.shelf-path-note :deep(svg) {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--md-primary);
}

.move-options {
  display: grid;
  gap: 6px;
  margin-top: 15px;
}

.move-option {
  display: flex;
  width: 100%;
  min-height: 56px;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  border: 0;
  border-radius: 16px;
  background: var(--md-surface-low);
  color: var(--md-on-surface);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 80%, transparent);
  text-align: left;
}

.move-option-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border-radius: 12px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.move-option-icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.move-option > span:nth-child(2) {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.move-option > :deep(svg:last-child) {
  width: 18px;
  height: 18px;
  color: var(--md-on-surface-variant);
}

.move-empty {
  margin: 4px 0;
  color: var(--md-on-surface-variant);
  font-size: 13px;
  line-height: 1.55;
}

.shelf-danger-panel,
.shelf-info-panel {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 16px;
  padding: 13px 14px;
  border-radius: 18px;
}

.shelf-danger-panel {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.shelf-info-panel {
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}

.shelf-danger-panel :deep(svg),
.shelf-info-panel :deep(svg) {
  width: 19px;
  height: 19px;
  margin-top: 1px;
  flex: none;
}

.shelf-danger-panel b,
.shelf-danger-panel small,
.shelf-info-panel b,
.shelf-info-panel small {
  display: block;
}

.shelf-danger-panel b,
.shelf-info-panel b {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
}

.shelf-danger-panel small,
.shelf-info-panel small {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.84;
}

@media (max-width: 899px) {
  .shelf-dialog-content {
    min-height: 0;
    padding: 20px;
    background: transparent;
  }

}
</style>
