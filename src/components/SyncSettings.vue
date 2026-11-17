<template>
  <div class="sync-settings" :aria-busy="busy">
    <section class="sync-group">
      <h2>{{ t('远程') }}</h2>
      <div class="sync-card connection-card">
        <MdIcon name="local_library" />
        <div class="connection-copy">
          <strong>{{ sync.config.url ? (sync.config.username || 'WebDAV') : t('暂无信息') }}</strong>
          <span v-if="sync.config.url">{{ t('连通性') }}：<span class="connection-dot" :class="{ 'is-connected': connected === true, 'is-failed': connected === false }"></span>{{ t(connected === true ? '已连接' : connected === false ? '连接失败' : '未检测') }}</span>
          <span v-else>{{ t('请绑定 WebDAV') }}</span>
        </div>
        <button type="button" class="md-tonal-button" :disabled="busy" @click="openEditor">{{ t(sync.config.url ? '编辑' : '绑定') }}</button>
      </div>
    </section>
    <MobileBottomSheet :open="editorOpen" desktop-side :title="t('WebDAV 配置')" title-id="webdav-config-title" :busy="busy" @close="editorOpen = false" @cancel="editorOpen = false" @closed="finishEditor">
      <template #status><button type="submit" form="webdav-connection-form" class="md-icon-button connection-confirm" :disabled="busy || !draft.url.trim()" :aria-label="t('保存设置')"><MdIcon name="check" /></button></template>
    <form id="webdav-connection-form" class="sync-form" @submit.prevent="save">
      <section class="sync-group" aria-labelledby="sync-connection-title">
        <h2 id="sync-connection-title">{{ t('WebDAV 连接') }}</h2>
        <div class="sync-card sync-fields">
          <div class="sync-field">
            <label for="sync-url">{{ t('地址') }}</label>
            <input
              id="sync-url"
              v-model="draft.url"
              type="url"
              inputmode="url"
              autocomplete="url"
              autocapitalize="off"
              spellcheck="false"
              :placeholder="t('必填')"
              maxlength="2048"
              required
              :disabled="busy"
              @input="edit"
              @focus="revealField"
            />
            <span class="sync-field-state">{{ draft.enabled ? t('必填') : t('可选') }}</span>
          </div>
          <div class="sync-field">
            <label for="sync-username">{{ t('账号') }}</label>
            <input
              id="sync-username"
              v-model="draft.username"
              type="text"
              autocomplete="username"
              autocapitalize="off"
              spellcheck="false"
              maxlength="512"
              :disabled="busy"
              @input="edit"
              @focus="revealField"
            />
            <span class="sync-field-state">{{ t('可选') }}</span>
          </div>
          <div class="sync-field">
            <label for="sync-password">{{ t('密码') }}</label>
            <input
              id="sync-password"
              v-model="draft.password"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="current-password"
              maxlength="4096"
              :disabled="busy"
              @input="edit"
              @focus="revealField"
            />
            <span class="sync-field-end">
              <span class="sync-field-state">{{ t('可选') }}</span>
              <button
                type="button"
                class="sync-password-toggle md-hit-target"
                :aria-label="passwordVisible ? t('隐藏密码') : t('显示密码')"
                :aria-pressed="passwordVisible"
                :disabled="busy"
                @click="passwordVisible = !passwordVisible"
              ><MdIcon :name="passwordVisible ? 'visibility_off' : 'visibility'" /></button>
            </span>
          </div>
        </div>
      </section>

    </form>
      <p v-if="displayError" class="sync-feedback is-error" role="alert">{{ t(displayError) }}</p>
      <button v-if="sync.config.url" type="button" class="connection-delete md-mobile-sheet-card md-mobile-sheet-danger" :disabled="busy" @click="disconnect">{{ t('删除连接') }}</button>
    </MobileBottomSheet>
      <section class="sync-group" aria-labelledby="sync-options-title">
        <h2 id="sync-options-title">{{ t('同步偏好') }}</h2>
        <div class="sync-card sync-options">
          <MdSwitch v-model="draft.enabled" :disabled="busy || !sync.config.url" @update:model-value="savePreferences">
            <span class="sync-switch-copy">
              <b>{{ t('启用 WebDAV 同步') }}</b>
              <span>{{ t('开启后，允许向此服务器发送进度、收藏与书库信息。') }}</span>
            </span>
          </MdSwitch>
          <MdSwitch v-model="draft.autoSync" :disabled="busy || !draft.enabled" @update:model-value="savePreferences">
            <span class="sync-switch-copy">
              <b>{{ t('自动同步') }}</b>
              <span>{{ t('应用运行且网络可用时，自动同步已保存的更改。') }}</span>
            </span>
          </MdSwitch>
        </div>
      </section>
    <WebDavBrowser v-if="sync.config.url" :url="sync.config.url" :username="sync.config.username" :password="sync.password" :disabled="dirty || saving || performing || sync.status === 'syncing' || sync.status === 'testing'" @busy="browserBusy = $event" />

    <section class="sync-group" aria-labelledby="sync-status-title">
      <h2 id="sync-status-title">{{ t('同步状态') }}</h2>
      <div class="sync-card sync-status" aria-live="polite">
        <div class="sync-status-heading">
          <div>
            <strong>{{ statusLabel }}</strong>
            <p class="sync-note">{{ lastSyncLabel }}</p>
          </div>
          <span v-if="sync.pendingCount > 0" class="sync-pending">{{ t('待同步 {0} 项', { 0: sync.pendingCount }) }}</span>
        </div>
        <dl class="sync-stats">
          <div><dt>{{ t('已识别作品') }}</dt><dd>{{ sync.matchedCount }}</dd></div>
          <div><dt>{{ t('待识别作品') }}</dt><dd>{{ sync.unmatchedCount }}</dd></div>
          <div><dt>{{ t('仅远端有记录') }}</dt><dd>{{ sync.remoteOnlyCount }}</dd></div>
        </dl>
        <p v-if="sync.remoteOnlyCount > 0" class="sync-note">{{ t('在本机导入对应作品后，才能应用远端记录。') }}</p>
        <p v-if="displayError" class="sync-feedback is-error" role="alert">{{ t(displayError) }}</p>
        <p v-else-if="notice" class="sync-feedback" role="status">{{ t(notice) }}</p>
        <div class="sync-actions">
          <button type="button" class="md-filled-button" :disabled="busy || dirty || !sync.enabled || !sync.config.url" @click="synchronize">
            {{ sync.status === 'syncing' ? t('正在同步…') : t('立即同步') }}
          </button>
          <button type="button" class="md-tonal-button" :disabled="busy || dirty || !sync.config.url" @click="testConnection">
            {{ sync.status === 'testing' ? t('正在测试…') : t('测试连接') }}
          </button>
        </div>
      </div>

      <p class="sync-note sync-disconnect-note">{{ t('移除连接不会删除本机作品或服务器上的同步记录。') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useSyncStore } from '../stores/sync.ts';
import { useI18n } from '../composables/useI18n.ts';
import MdIcon from './MdIcon.vue';
import MdSwitch from './MdSwitch.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import { WebDavBooksClient } from '../services/webdavBooks.ts';
import WebDavBrowser from './WebDavBrowser.vue';

const sync = useSyncStore();
const editorOpen = ref(false);
const connected = ref<boolean | null>(null);
const { t, locale } = useI18n();
const draft = reactive({ url: '', username: '', password: '', enabled: false, autoSync: false });
const passwordVisible = ref(false);
const edited = ref(false);
const browserBusy = ref(false);
const saving = ref(false);
const performing = ref(false);
const notice = ref('');
const localError = ref('');
const busy = computed(() => browserBusy.value || saving.value || performing.value || sync.status === 'testing' || sync.status === 'syncing');
const displayError = computed(() => localError.value || sync.error);
const dirty = computed(() => draft.url !== sync.config.url || draft.username !== sync.config.username
  || draft.password !== sync.password || draft.enabled !== sync.enabled || draft.autoSync !== sync.autoSync);
const statusLabel = computed(() => {
  if (sync.status === 'syncing') return t('正在同步…');
  if (sync.status === 'testing') return t('正在测试…');
  if (displayError.value) return t('同步需要处理');
  return sync.enabled ? t('同步已启用') : t('同步已关闭');
});
const lastSyncLabel = computed(() => sync.lastSyncAt
  ? t('上次同步：{0}', { 0: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sync.lastSyncAt)) })
  : t('尚未同步'));

function hydrate() {
  Object.assign(draft, sync.config, { password: sync.password, enabled: sync.enabled, autoSync: sync.autoSync });
}

watch(() => [sync.config.url, sync.config.username, sync.password, sync.enabled, sync.autoSync], () => {
  if (!edited.value) hydrate();
}, { immediate: true });

function openEditor() {
  hydrate(); edited.value = false; localError.value = ''; passwordVisible.value = false; editorOpen.value = true;
}
function finishEditor() { hydrate(); edited.value = false; passwordVisible.value = false; }
function savePreferences() {
  return perform(() => sync.saveConfig({ ...sync.config, password: sync.password, enabled: draft.enabled, autoSync: draft.autoSync }), '同步设置已保存。');
}
watch(() => [sync.config.url, sync.config.username, sync.password], () => { connected.value = null; });
function edit() {
  edited.value = true;
  notice.value = '';
  localError.value = '';
}

function revealField(event: FocusEvent) {
  const input = event.target as HTMLInputElement;
  if (window.matchMedia('(max-width: 899px)').matches) {
    input.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
}

async function perform(action: () => Promise<unknown>, success: string) {
  performing.value = true;
  notice.value = '';
  localError.value = '';
  try {
    await action();
    if (!sync.error) notice.value = success;
  } catch (error) {
    localError.value = sync.error ? '' : error instanceof Error ? error.message : '同步操作失败，请重试。';
  } finally {
    performing.value = false;
  }
}

async function save() {
  saving.value = true;
  await perform(async () => {
    await sync.saveConfig({ ...draft });
    if (!sync.error) {
      edited.value = false;
      hydrate();
      editorOpen.value = false;
    }
  }, '同步设置已保存。');
  saving.value = false;
}

function testConnection() {
  return perform(async () => {
    const client = new WebDavBooksClient({ ...sync.config, password: sync.password });
    try { await client.list(); connected.value = true; } catch (error) { connected.value = false; throw error; } finally { client.close(); }
  }, '连接测试通过，写入权限将在同步时验证。');
}

function synchronize() {
  return perform(() => sync.syncNow(), '同步完成。');
}

async function disconnect() {
  saving.value = true;
  await perform(async () => {
    await sync.clearConfig();
    if (!sync.error) {
      edited.value = false;
      hydrate();
    }
    editorOpen.value = false;
  }, '已移除此设备的连接。');
  saving.value = false;
}
</script>

<style scoped>
.connection-card { display: flex; align-items: center; gap: 18px; padding: 22px 24px; }
.connection-card > svg { width: 28px; height: 28px; color: var(--md-on-surface-variant); }
.connection-copy { display: grid; gap: 8px; flex: 1; min-width: 0; }
.connection-copy strong { font-size: 17px; overflow-wrap: anywhere; }
.connection-copy > span { font-size: 13px; color: var(--md-on-surface-variant); }
.connection-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--md-outline); margin-right: 6px; }
.connection-dot.is-connected { background: var(--md-primary); }
.connection-dot.is-failed { background: var(--md-error); }
.connection-delete { background: var(--md-surface); color: var(--md-error); border: 0; display: block; width: 100%; padding: 20px; text-align: left; margin-top: 24px; }
.connection-confirm { background: var(--md-surface); }
.sync-form .sync-group > h2 { display: none; }
.sync-form .sync-field { grid-template-columns: 62px minmax(0, 1fr) auto; gap: 8px; padding: 14px 18px; }
.sync-form .sync-field input { text-align: right; font-size: 16px; }
.sync-form .sync-field > label { font-size: 13px; }
.sync-form .sync-field-state { display: none; }

.sync-settings { min-width: 0; }
.sync-intro { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 28px; padding: 28px; border-radius: 28px; background: var(--md-primary-container); color: var(--md-on-primary-container); }
.sync-intro > svg { flex: none; width: 28px; height: 28px; }
.sync-intro h2 { margin: 0 0 12px; font-size: 21px; font-weight: 600; }
.sync-intro p { margin: 8px 0 0; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.sync-group { min-width: 0; margin-bottom: 28px; }
.sync-group > h2 { margin: 0 16px 12px; color: var(--md-on-surface-variant); font-size: 13px; font-weight: 600; }
.sync-card { min-width: 0; border-radius: 28px; background: var(--md-surface); color: var(--md-on-surface); }
.sync-fields { overflow: hidden; padding: 0; }
.sync-field { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.4fr) auto; grid-template-rows: auto auto; align-items: center; column-gap: 20px; min-width: 0; padding: 16px 30px; transition: background-color 200ms cubic-bezier(0.2, 0, 0, 1); }
.sync-field + .sync-field { border-top: 1px solid var(--md-outline-variant); }
.sync-field:focus-within { background: color-mix(in oklab, var(--md-primary-container) 10%, var(--md-surface)); }
.sync-field > label { grid-column: 1; grid-row: 1; min-width: 0; font-size: 16px; font-weight: 550; }
.sync-field input { box-sizing: border-box; grid-column: 2; grid-row: 1; width: 100%; min-width: 0; min-height: 44px; padding: 8px 0; border: 0; border-radius: 4px; outline: none; background: transparent; color: var(--md-on-surface); font: inherit; font-size: 15px; font-weight: 400; }
.sync-field input:is(:focus, :focus-visible) { outline: none; box-shadow: none; }
.sync-field input::placeholder { color: var(--md-on-surface-variant); opacity: 1; }
.sync-field input:disabled { opacity: 0.38; }
.sync-field-state { color: var(--md-on-surface-variant); font-size: 15px; font-weight: 450; white-space: nowrap; }
.sync-field-end { display: flex; grid-column: 3; grid-row: 1; align-items: center; gap: 12px; }
.sync-password-toggle { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--md-on-surface-variant); cursor: pointer; }
.sync-password-toggle:hover { background: color-mix(in oklab, var(--md-on-surface) 8%, transparent); }
.sync-password-toggle:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 1px; }
.sync-password-toggle:disabled { opacity: .38; cursor: default; }
.sync-password-toggle :deep(svg) { width: 22px; height: 22px; }
.sync-note { margin: 0; color: var(--md-on-surface-variant); font-size: 12px; font-weight: 400; line-height: 1.7; overflow-wrap: anywhere; }
.sync-options > :deep(.md-switch-row) { padding: 20px 24px; }
.sync-options > :deep(.md-switch-row + .md-switch-row) { border-top: 1px solid var(--md-outline-variant); }
.sync-switch-copy { display: grid; gap: 6px; }
.sync-switch-copy b { font-size: 13px; font-weight: 600; }
.sync-switch-copy > span { color: var(--md-on-surface-variant); font-size: 12px; line-height: 1.7; }
.sync-save-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; margin: 16px 0 0; }
.sync-status { padding: 24px; }
.sync-status-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px 16px; }
.sync-status-heading strong { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; }
.sync-pending { padding: 6px 12px; border-radius: 999px; color: var(--md-on-secondary-container); background: var(--md-secondary-container); font-size: 11px; }
.sync-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
.sync-stats div { min-width: 0; }
.sync-stats dt { color: var(--md-on-surface-variant); font-size: 11px; line-height: 1.7; }
.sync-stats dd { margin: 8px 0 0; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.sync-feedback { margin: 16px 0 0; padding: 12px 16px; border-radius: 12px; background: var(--md-surface-high); color: var(--md-on-surface); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.sync-feedback.is-error { color: var(--md-on-error-container); background: var(--md-error-container); }
.sync-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.sync-actions > button, .sync-save-actions > button { min-height: 48px; }
.sync-disconnect { margin-top: 12px; }
.sync-disconnect-note { margin: 4px 16px 0; }
@media (max-width: 899px) {
  .sync-field input { font-size: 16px; scroll-margin-block: 80px; }
}
@container settings (max-width: 599px) {
  .sync-intro { gap: 12px; padding: 24px 20px; }
  .sync-intro > svg { width: 24px; height: 24px; }
  .sync-field { grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 0; padding: 8px 20px; }
  .sync-field > label { grid-column: 1; grid-row: 1; font-size: 15px; }
  .sync-field input { grid-column: 1 / 3; grid-row: 2; }
  .sync-field-state { font-size: 13px; }
  .sync-field-end { grid-column: 2; grid-row: 1; gap: 8px; }
  .sync-status { padding: 20px; }
  .sync-options > :deep(.md-switch-row) { padding: 20px; }
  .sync-stats { gap: 12px; }
  .sync-actions > button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .sync-field, .sync-field input { transition: none; }
}
</style>

<style scoped>
.sync-form .sync-field input { grid-column: 2; grid-row: 1; }
.sync-form .sync-field > label { grid-column: 1; grid-row: 1; }
.sync-form .sync-field-end { grid-column: 3; grid-row: 1; }
</style>
