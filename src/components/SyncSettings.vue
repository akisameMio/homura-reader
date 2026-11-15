<template>
  <div class="sync-settings" :aria-busy="busy">
    <section class="sync-intro" aria-labelledby="sync-intro-title">
      <MdIcon name="update" />
      <div>
        <h2 id="sync-intro-title">{{ t('在不同设备间继续阅读') }}</h2>
        <p>{{ t('同步阅读进度、收藏与书库，原始文件不会上传。') }}</p>
        <p>{{ t('请在各设备导入相同的原文件，HOMURA 会按文件内容匹配作品。') }}</p>
      </div>
    </section>

    <form class="sync-form" @submit.prevent="save">
      <section class="sync-group" aria-labelledby="sync-connection-title">
        <h2 id="sync-connection-title">{{ t('WebDAV 连接') }}</h2>
        <div class="sync-card sync-fields">
          <label class="sync-field" for="sync-url">
            <span>{{ t('WebDAV 文件夹地址') }}</span>
            <input
              id="sync-url"
              v-model="draft.url"
              type="url"
              inputmode="url"
              autocomplete="url"
              autocapitalize="off"
              spellcheck="false"
              placeholder="https://example.com/dav/HOMURA/"
              maxlength="2048"
              :required="draft.enabled"
              :disabled="busy"
              aria-describedby="sync-url-hint"
              @input="edit"
              @focus="revealField"
            />
            <small id="sync-url-hint">{{ t('填写已存在的 HTTPS 文件夹地址，不包含用户名或密码。') }}</small>
          </label>
          <label class="sync-field" for="sync-username">
            <span>{{ t('用户名') }}</span>
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
          </label>
          <label class="sync-field" for="sync-password">
            <span>{{ t('密码或应用专用密码') }}</span>
            <input
              id="sync-password"
              v-model="draft.password"
              type="password"
              autocomplete="current-password"
              maxlength="4096"
              :disabled="busy"
              aria-describedby="sync-password-hint"
              @input="edit"
              @focus="revealField"
            />
            <small id="sync-password-hint">{{ t('密码仅用于本次会话，重新启动后需要再次填写。') }}</small>
          </label>
        </div>
      </section>

      <section class="sync-group" aria-labelledby="sync-options-title">
        <h2 id="sync-options-title">{{ t('同步偏好') }}</h2>
        <div class="sync-card sync-options">
          <MdSwitch v-model="draft.enabled" :disabled="busy" @update:model-value="edit">
            <span class="sync-switch-copy">
              <b>{{ t('启用 WebDAV 同步') }}</b>
              <span>{{ t('开启后，允许向此服务器发送进度、收藏与书库信息。') }}</span>
            </span>
          </MdSwitch>
          <MdSwitch v-model="draft.autoSync" :disabled="busy || !draft.enabled" @update:model-value="edit">
            <span class="sync-switch-copy">
              <b>{{ t('自动同步') }}</b>
              <span>{{ t('应用运行且网络可用时，自动同步已保存的更改。') }}</span>
            </span>
          </MdSwitch>
        </div>
        <div class="sync-save-actions">
          <button type="submit" class="md-tonal-button" :disabled="busy || !dirty">{{ t('保存设置') }}</button>
          <p v-if="dirty" class="sync-note">{{ t('有未保存的更改，请先保存再测试或同步。') }}</p>
        </div>
      </section>
    </form>

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
      <button v-if="sync.config.url" type="button" class="md-text-button sync-disconnect" :disabled="busy" @click="disconnect">{{ t('移除此设备的连接') }}</button>
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

const sync = useSyncStore();
const { t, locale } = useI18n();
const draft = reactive({ url: '', username: '', password: '', enabled: false, autoSync: false });
const edited = ref(false);
const saving = ref(false);
const performing = ref(false);
const notice = ref('');
const localError = ref('');
const busy = computed(() => saving.value || performing.value || sync.status === 'testing' || sync.status === 'syncing');
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
    }
  }, '同步设置已保存。');
  saving.value = false;
}

function testConnection() {
  return perform(() => sync.testConnection(), '连接测试通过，写入权限将在同步时验证。');
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
  }, '已移除此设备的连接。');
  saving.value = false;
}
</script>

<style scoped>
.sync-settings { min-width: 0; }
.sync-intro { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 28px; padding: 28px; border-radius: 28px; background: var(--md-primary-container); color: var(--md-on-primary-container); }
.sync-intro > svg { flex: none; width: 28px; height: 28px; }
.sync-intro h2 { margin: 0 0 12px; font-size: 21px; font-weight: 600; }
.sync-intro p { margin: 8px 0 0; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.sync-group { min-width: 0; margin-bottom: 28px; }
.sync-group > h2 { margin: 0 16px 12px; color: var(--md-on-surface-variant); font-size: 13px; font-weight: 600; }
.sync-card { min-width: 0; border-radius: 28px; background: var(--md-surface); color: var(--md-on-surface); }
.sync-fields { display: grid; gap: 24px; padding: 24px; }
.sync-field { display: grid; min-width: 0; gap: 8px; font-size: 13px; font-weight: 600; }
.sync-field input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 48px; padding: 12px 16px; border: 1px solid var(--md-outline-variant); border-radius: 12px; outline: none; background: var(--md-surface-high); color: var(--md-on-surface); font: inherit; font-weight: 400; transition: border-color 200ms cubic-bezier(0.2, 0, 0, 1); }
.sync-field input:focus-visible { border-color: var(--md-primary); outline: 2px solid var(--md-primary); outline-offset: 2px; }
.sync-field input::placeholder { color: var(--md-on-surface-variant); opacity: 1; }
.sync-field input:disabled { opacity: 0.38; }
.sync-field small, .sync-note { margin: 0; color: var(--md-on-surface-variant); font-size: 12px; font-weight: 400; line-height: 1.7; overflow-wrap: anywhere; }
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
  .sync-fields, .sync-status { padding: 20px; }
  .sync-options > :deep(.md-switch-row) { padding: 20px; }
  .sync-stats { gap: 12px; }
  .sync-actions > button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .sync-field input { transition: none; }
}
</style>
