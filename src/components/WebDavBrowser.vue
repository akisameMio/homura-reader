<template>
  <section class="dav-browser" aria-labelledby="dav-browser-title" :aria-busy="busy">
    <div class="dav-heading">
      <h2 id="dav-browser-title">{{ t('远程书籍') }}</h2>
      <button type="button" class="md-tonal-button" :disabled="disabled || busy || !url" @click="browse(directory || url)">{{ t(loaded ? '刷新目录' : '浏览远程书籍') }}</button>
    </div>
    <p class="dav-note">{{ t('直接浏览服务器上的书籍。EPUB、CBZ、ZIP 和 PDF 按需读取，不保存原文件；TXT、Markdown 仅将正文载入内存。') }}</p>
    <p class="dav-note">{{ t('添加到书架只保存云端引用和封面，阅读时仍从服务器按需读取。') }}</p>
    <p class="dav-note">{{ t('远程阅读需要网络和服务器的 HTTP Range 支持。MOBI 暂不支持远程阅读。') }}</p>
    <div v-if="loaded" class="dav-content">
      <nav class="dav-path" :aria-label="t('远程目录')">
        <button type="button" class="md-text-button" :disabled="busy || disabled || atRoot" @click="browse(url)">{{ t('根目录') }}</button>
        <button type="button" class="md-text-button" :disabled="busy || disabled || atRoot" @click="up">{{ t('上一级') }}</button>
        <span>{{ pathLabel }}</span>
      </nav>
      <p v-if="!entries.length" class="dav-note dav-empty">{{ t('此目录没有支持的书籍或子文件夹。') }}</p>
      <ul v-else class="dav-list">
        <li v-for="entry in entries.slice(0, visibleCount)" :key="entry.href">
          <MdIcon :name="entry.directory ? 'folder_open' : 'auto_stories'" aria-hidden="true" />
          <div class="dav-entry-copy">
            <strong>{{ entry.name }}</strong>
            <span>{{ entry.directory ? t('文件夹') : entry.size === null ? t('大小未知') : formatBytes(entry.size) }}</span>
          </div>
          <div class="dav-entry-actions">
            <button v-if="!entry.directory && canReadRemote(entry)" type="button" class="md-text-button" :disabled="busy || disabled || isShelved(entry)" :aria-label="t(isShelved(entry) ? '已在书架：{0}' : '添加到书架：{0}', { 0: entry.name })" @click="add(entry)">{{ t(isShelved(entry) ? '已在书架' : '添加到书架') }}</button>
            <button type="button" class="md-text-button" :disabled="busy || disabled || (!entry.directory && !canReadRemote(entry))" :aria-label="t(entry.directory ? '打开文件夹：{0}' : '在线阅读：{0}', { 0: entry.name })" @click="entry.directory ? browse(entry.href) : read(entry)">{{ t(entry.directory ? '打开' : '在线阅读') }}</button>
          </div>
        </li>
      </ul>
      <button v-if="entries.length > visibleCount" type="button" class="md-text-button" @click="visibleCount += 100">{{ t('显示更多') }}</button>
    </div>
    <div v-if="busy" class="dav-loading" role="status">
      <span>{{ openingName ? t(adding ? '正在添加到书架：{0}' : '正在打开：{0}', { 0: openingName }) : t('正在读取目录…') }}</span>
      <button type="button" class="md-text-button" :disabled="saving" @click="cancel">{{ t('取消') }}</button>
    </div>
    <p v-if="error" class="dav-error" role="alert">{{ t(error) }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from '../composables/useI18n.ts';
import { WebDavBooksClient, type DavEntry } from '../services/webdavBooks.ts';
import { normalizeWebDavUrl } from '../services/webdav.ts';
import { openRemoteBook, canReadRemote, prepareRemoteShelfBook } from '../services/remoteBooks.ts';
import { makeRemoteBookSource, remoteBookId } from '../services/remoteBookSource.ts';
import { useShelfStore } from '../stores/shelf.ts';
import { useReaderStore } from '../stores/reader.ts';
import { formatBytes } from '../services/platform.ts';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  url: { type: String, required: true }, username: { type: String, default: '' },
  password: { type: String, default: '' }, disabled: { type: Boolean, default: false }
});
const emit = defineEmits(['busy']);
const { t } = useI18n();
const reader = useReaderStore();
const shelf = useShelfStore();
const entries = shallowRef<DavEntry[]>([]);
const directory = ref('');
const loaded = ref(false);
const busy = ref(false);
const error = ref('');
const openingName = ref('');
const visibleCount = ref(100);
const adding = ref(false);
const saving = ref(false);
const entryIds = shallowRef(new Map<string, string>());
const shelfIds = computed(() => new Set(shelf.library.map(book => book.id)));
const isShelved = (entry: DavEntry) => shelfIds.value.has(entryIds.value.get(entry.href) || '');
let client: WebDavBooksClient | null = null;
let generation = 0;
const root = computed(() => { try { return normalizeWebDavUrl(props.url); } catch { return ''; } });
const atRoot = computed(() => directory.value === root.value);
const pathLabel = computed(() => {
  try { return decodeURIComponent(new URL(directory.value).pathname); } catch { return ''; }
});
function setBusy(value: boolean) { busy.value = value; emit('busy', value); }
function cancel() {
  generation++;
  client?.close(); client = null;
  setBusy(false); openingName.value = ''; adding.value = false;
}
function reset() { cancel(); entries.value = []; directory.value = ''; loaded.value = false; error.value = ''; }
watch(() => [props.url, props.username, props.password], reset);
onBeforeUnmount(cancel);
watch(() => entries.value.slice(0, visibleCount.value), async visible => {
  const currentEntries = entries.value;
  const currentRoot = props.url;
  const pairs = await Promise.all(visible.filter(entry => canReadRemote(entry)).map(async entry => {
    const source = makeRemoteBookSource({ url: props.url, username: props.username, password: '' }, entry);
    return [entry.href, await remoteBookId(source)] as const;
  }));
  if (entries.value === currentEntries && props.url === currentRoot) entryIds.value = new Map(pairs);
});
function createClient() {
  return new WebDavBooksClient({ url: props.url, username: props.username, password: props.password });
}
async function browse(href: string) {
  if (busy.value || props.disabled) return;
  const token = ++generation;
  setBusy(true); error.value = '';
  try {
    const active = createClient(); client = active;
    const next = await active.list(href);
    if (generation !== token) return;
    entries.value = next; directory.value = new URL(href, active.root).href;
    visibleCount.value = 100; loaded.value = true;
  } catch (failure) {
    if (generation === token) error.value = failure instanceof Error ? failure.message : '无法读取远程目录';
  } finally {
    if (generation === token) { client?.close(); client = null; setBusy(false); }
  }
}
function up() {
  if (!atRoot.value) void browse(new URL('../', directory.value).href);
}
async function add(entry: DavEntry) {
  if (busy.value || props.disabled || isShelved(entry)) return;
  const token = ++generation;
  setBusy(true); error.value = ''; openingName.value = entry.name; adding.value = true;
  let prepared: Awaited<ReturnType<typeof prepareRemoteShelfBook>> | null = null;
  try {
    client = createClient();
    prepared = await prepareRemoteShelfBook(client, entry, props.username);
    if (generation !== token) {
      if (prepared.book.cover?.startsWith('blob:')) URL.revokeObjectURL(prepared.book.cover);
      return;
    }
    saving.value = true;
    await shelf.addRemoteBook(prepared.book, prepared.source, () => generation === token);
    entryIds.value = new Map(entryIds.value).set(entry.href, prepared.book.id);
  } catch (failure) {
    if (prepared?.book.cover?.startsWith('blob:')) URL.revokeObjectURL(prepared.book.cover);
    if (generation === token) error.value = failure instanceof Error ? failure.message : '添加云端书籍失败，请重试';
  } finally {
    saving.value = false;
    if (generation === token) { client?.close(); client = null; setBusy(false); openingName.value = ''; adding.value = false; }
  }
}

async function read(entry: DavEntry) {
  if (busy.value || props.disabled || reader.openingBook) return;
  const token = ++generation;
  setBusy(true); error.value = ''; openingName.value = entry.name;
  let book: Awaited<ReturnType<typeof openRemoteBook>> | null = null;
  try {
    const active = createClient(); client = active;
    book = await openRemoteBook(active, entry, props.username, message => {
      if (book && reader.currentBook?.id === book.id) reader.openError = t(message);
    });
    if (generation !== token) { if (typeof book.remoteDispose === 'function') book.remoteDispose(); return; }
    // 阅读器接管网络生命周期；设置页卸载不能中止已打开的书。
    client = null;
    const opened = await reader.openRemoteBook(book);
    if (!opened) {
      if (typeof book.remoteDispose === 'function') book.remoteDispose();
      throw new Error('无法打开远程书籍，请检查网络或文件格式');
    }
  } catch (failure) {
    if (generation === token) error.value = failure instanceof Error ? failure.message : '无法打开远程书籍，请检查网络或文件格式';
  } finally {
    if (generation === token) { client?.close(); client = null; setBusy(false); openingName.value = ''; }
  }
}
</script>

<style scoped>
.dav-browser { min-width: 0; margin-bottom: 28px; padding: 24px; border-radius: 28px; background: var(--md-surface); color: var(--md-on-surface); }
.dav-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.dav-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.dav-note { margin: 8px 0; color: var(--md-on-surface-variant); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.dav-path { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 16px 0 8px; }
.dav-path span { min-width: 0; overflow-wrap: anywhere; font-size: 12px; color: var(--md-on-surface-variant); }
.dav-list { margin: 0; padding: 0; list-style: none; }
.dav-list li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; min-width: 0; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--md-outline-variant); }
.dav-list li > svg { flex: none; width: 24px; height: 24px; color: var(--md-on-surface-variant); }
.dav-entry-copy { flex: 1; min-width: 0; }
.dav-entry-copy strong { display: block; font-size: 13px; font-weight: 550; overflow-wrap: anywhere; }
.dav-entry-copy span { display: block; margin-top: 4px; font-size: 11px; color: var(--md-on-surface-variant); }
.dav-entry-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.dav-list button { flex: none; }
.dav-browser button { min-height: 44px; }
.dav-empty { padding: 16px 0; }
.dav-loading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: 13px; overflow-wrap: anywhere; }
.dav-error { padding: 12px 16px; border-radius: 12px; background: var(--md-error-container); color: var(--md-on-error-container); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
@media (max-width: 899px) { .dav-browser { padding: 20px; } }
@container settings (max-width: 599px) {
  .dav-entry-actions { grid-column: 2 / -1; justify-content: flex-end; }
  .dav-list li { grid-template-columns: 24px minmax(0, 1fr); }
}
</style>
