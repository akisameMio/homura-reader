<template>
  <form ref="formRef" v-if="request" class="shelf-dialog-content p-6" @submit.prevent="submitName">
    <div class="min-[900px]:hidden w-8 h-1 mx-auto mb-5 rounded-full bg-[var(--md-outline-variant)]" aria-hidden="true"></div>
    <div class="flex items-start gap-3">
      <span
        class="grid h-10 w-10 shrink-0 place-items-center rounded-[14px]"
        :class="isDestructive
          ? 'bg-[var(--md-error-container)] text-[var(--md-on-error-container)]'
          : 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'"
        aria-hidden="true"
      >
        <MdIcon :name="dialogIcon" class="h-5 w-5" />
      </span>
      <div class="min-w-0 flex-1">
        <p v-if="isDestructive" class="text-[11px] font-semibold text-[var(--md-on-surface-variant)]">需要确认</p>
        <h2 id="shelf-dialog-title" class="text-[17px] font-semibold" :class="{ 'mt-1': isDestructive }">{{ request.title }}</h2>
      </div>
    </div>
    <p v-if="request.message" class="mt-3 text-[13px] leading-relaxed text-[var(--md-on-surface-variant)] break-words">{{ request.message }}</p>
    <div
      v-if="deletesFiles"
      class="mt-3 flex items-center gap-2 rounded-[16px] bg-[var(--md-error-container)] px-3 py-2.5 text-[11px] font-semibold text-[var(--md-on-error-container)]"
    >
      <MdIcon name="warning" class="h-4 w-4 shrink-0" />
      <span>原始文件与阅读记录会一起移除</span>
    </div>
    <template v-if="request.kind === 'name'">
      <label for="collection-name" class="block mt-5 text-[11px] text-[var(--md-on-surface-variant)]">书库名称</label>
      <input
        id="collection-name"
        ref="nameInput"
        v-model="name"
        maxlength="80"
        autocomplete="off"
        class="mt-2 w-full min-h-11 rounded-xl px-3 text-[13px] bg-[var(--md-surface-high)] text-[var(--md-on-surface)] border border-[var(--md-outline-variant)]"
        :aria-invalid="!!error"
        aria-describedby="collection-name-error"
      />
      <p id="collection-name-error" v-if="error" role="alert" class="mt-2 text-[13px] text-[var(--md-error)]">{{ error }}</p>
    </template>
    <div v-if="request.kind === 'move'" class="mt-4 flex flex-col gap-1">
      <button
        v-for="option in request.options"
        :key="option.value"
        type="button"
        class="md-library-text-button text-left break-words"
        @click="$emit('resolve', option.value)"
      >
        {{ option.title }}
      </button>
      <p v-if="!request.options.length" class="text-[13px] text-[var(--md-on-surface-variant)]">暂无其他书库，请先新建书库。</p>
    </div>
    <div class="mt-6 flex flex-wrap justify-end gap-2">
      <button type="button" class="md-library-text-button" @click="$emit('resolve', null)">取消</button>
      <template v-if="request.kind === 'folder'">
        <button type="button" class="md-library-text-button" @click="$emit('resolve', false)">直接导入</button>
        <button type="button" class="md-library-tonal-button" @click="$emit('resolve', true)">创建书库</button>
      </template>
      <button v-else-if="request.kind === 'name'" type="submit" class="md-library-tonal-button">确定</button>
      <button
        v-else-if="request.kind === 'confirm'"
        type="button"
        class="md-library-tonal-button"
        @click="$emit('resolve', true)"
      >
        {{ request.confirmLabel || '确认删除' }}
      </button>
    </div>
  </form>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  request: { type: Object, default: null }
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
const deletesFiles = computed(() => (
  isDestructive.value
  && String(props.request?.message || '').includes('原始文件')
));
const dialogIcon = computed(() => {
  if (props.request?.kind === 'confirm') return isDestructive.value ? 'delete' : 'star';
  if (props.request?.kind === 'folder') return 'folder_open';
  if (props.request?.kind === 'name') return 'create_new_folder';
  return 'local_library';
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

defineExpose({ focusInitial });
</script>
