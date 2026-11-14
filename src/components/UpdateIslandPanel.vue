<template>
  <section v-if="mobileSheet" :aria-busy="status === 'loading' || status === 'downloading'">
    <p class="md-mobile-sheet-label">{{ t('HOMURA · 稳定通道') }}</p>
    <div class="md-mobile-sheet-card">
      <div class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-accent"><MdIcon :name="status === 'downloaded' || status === 'latest' ? 'check' : 'update'" /></span>
        <span class="md-mobile-sheet-copy">
          <b>{{ status === 'downloaded' ? t('v{0} 已准备就绪', { 0: download.version }) : status === 'downloading' ? t('正在下载 v{0}', { 0: release?.version || currentVersion }) : title }}</b>
          <small>{{ t('当前版本 v{0}', { 0: currentVersion }) }}<template v-if="release?.dateLabel"> · {{ release.dateLabel }}</template></small>
        </span>
      </div>
    </div>
    <template v-if="status === 'loading'">
      <div class="md-mobile-sheet-card md-mobile-sheet-notice" role="status">
        <span class="update-spinner" aria-hidden="true"></span>
        <span class="md-mobile-sheet-copy"><b>{{ t('正在连接 GitHub Releases') }}</b><small>{{ t('读取稳定版本与安装包信息，请稍候。') }}</small></span>
      </div>
    </template>
    <template v-else-if="status === 'available' && release">
      <p class="md-mobile-sheet-label">{{ t('本次更新') }}</p>
      <div class="md-mobile-sheet-card is-padded">
        <ul v-if="summaryItems.length" class="mobile-update-notes"><li v-for="item in summaryItems" :key="item">{{ item }}</li></ul>
        <p v-else class="md-mobile-sheet-hint">{{ t('该版本没有提供可展示的更新摘要。') }}</p>
      </div>
      <div class="md-mobile-sheet-card">
        <div class="md-mobile-sheet-row">
          <span class="md-mobile-sheet-icon"><MdIcon name="download" /></span>
          <span class="md-mobile-sheet-copy"><b>{{ t(packageInfo.label) }}</b><small>{{ t(packageInfo.note) }}</small></span>
        </div>
        <button type="button" class="md-mobile-sheet-row" @click="openDetails">
          <span class="md-mobile-sheet-copy"><b>{{ t('查看完整更新说明') }}</b></span><MdIcon name="chevron_right" />
        </button>
      </div>
    </template>
    <template v-else-if="status === 'downloading'">
      <div class="md-mobile-sheet-card is-padded">
        <div class="update-progress-meta"><b>{{ downloadPercentLabel }}</b><span>{{ downloadSizeLabel }}</span></div>
        <div class="update-track" role="progressbar" :aria-label="t('更新下载进度')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(downloadPercent * 10) / 10">
          <i :style="{ transform: `scaleX(${downloadPercent / 100})` }"></i>
        </div>
      </div>
      <div class="md-mobile-sheet-card md-mobile-sheet-notice">
        <MdIcon name="download" /><span class="md-mobile-sheet-copy"><b>{{ download.fileName || t(packageInfo.label) }}</b><small>{{ t('下载完成后可立即安装。') }}</small></span>
      </div>
    </template>
    <template v-else-if="status === 'downloaded'">
      <div class="md-mobile-sheet-card md-mobile-sheet-notice">
        <MdIcon name="info" /><span class="md-mobile-sheet-copy"><b>{{ t('安装提示') }}</b><small>{{ installWarning }}</small></span>
      </div>
      <p class="md-mobile-sheet-label">{{ t('文件位置') }}</p>
      <div class="md-mobile-sheet-card is-padded md-mobile-sheet-hint">{{ download.path }}</div>
      <p v-if="downloadError" class="md-mobile-sheet-field-error" role="alert">{{ t(downloadErrorMessage) }}</p>
    </template>
    <div v-else-if="status === 'latest'" class="md-mobile-sheet-card md-mobile-sheet-notice">
      <MdIcon name="check" /><span class="md-mobile-sheet-copy"><b>{{ t('已经是最新稳定版') }}</b><small>{{ t('当前安装的 HOMURA 与 GitHub 最新版本一致。') }}</small></span>
    </div>
    <div v-else class="md-mobile-sheet-card md-mobile-sheet-notice is-danger" role="alert">
      <MdIcon name="error" /><span class="md-mobile-sheet-copy"><b>{{ status === 'download-error' ? t('下载没有完成') : t('暂时无法检查更新') }}</b><small>{{ t(errorMessage) }}</small></span>
    </div>
    <p v-if="linkError" class="md-mobile-sheet-field-error" role="alert">{{ linkError }}</p>
  </section>
  <section
    v-else
    ref="panelRef"
    class="update-island-panel"
    role="group"
    aria-labelledby="update-island-title"
    :aria-busy="status === 'loading' || status === 'downloading'"
    tabindex="-1"
  >
    <div class="md-sheet-grip" aria-hidden="true"></div>

    <template v-if="status === 'downloading'">
      <header>
        <p class="md-surface-kicker">{{ t('软件更新') }}</p>
        <h2 id="update-island-title" class="md-surface-title">{{ t('正在下载更新') }}</h2>
        <p class="md-surface-subtitle">
          HOMURA v{{ release?.version || currentVersion }} · {{ t(download.packageLabel || packageInfo.label) }}
        </p>
      </header>

      <div class="update-progress">
        <div
          class="update-track"
          role="progressbar"
          :aria-label="t('更新下载进度')"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(downloadPercent * 10) / 10"
        >
          <i :style="{ transform: `scaleX(${downloadPercent / 100})` }"></i>
        </div>
        <div class="update-progress-meta">
          <b>{{ downloadPercentLabel }}</b>
          <span>{{ downloadSizeLabel }}</span>
        </div>
      </div>

      <div class="update-current">
        <MdIcon name="download" />
        <span>{{ t('下载完成后可立即安装') }}</span>
        <code>{{ download.fileName || t(packageInfo.label) }}</code>
      </div>

      <div class="md-surface-actionbar">
        <button
          v-if="!hostPrimaryAction"
          ref="primaryActionRef"
          type="button"
          class="md-surface-action is-tonal"
          @click="$emit('cancel-download')"
        >
          <MdIcon name="close" />
          {{ t('取消下载') }}
        </button>
      </div>
    </template>

    <template v-else-if="status === 'downloaded'">
      <header>
        <p class="md-surface-kicker">{{ t('软件更新') }}</p>
        <h2 id="update-island-title" class="md-surface-title">{{ t('下载完成') }}</h2>
      </header>

      <div class="update-success">
        <span class="update-success-icon" aria-hidden="true"><MdIcon name="check" /></span>
        <span>
          <b>{{ t('HOMURA v{0} 已准备就绪', { 0: download.version }) }}</b>
          <small>{{ installWarning }}</small>
        </span>
      </div>

      <div class="update-file">
        <span>{{ t('文件位置') }}</span>
        <code><template v-for="(part, index) in downloadPathParts" :key="`${index}-${part}`">{{ part }}<wbr v-if="part === '/' || part === '\\'" /></template></code>
      </div>

      <div class="md-surface-actionbar">
        <div class="md-surface-aux">
          <button type="button" class="md-surface-text-button" @click="$emit('close')">{{ t('稍后安装') }}</button>
        </div>
        <button
          v-if="!hostPrimaryAction"
          ref="primaryActionRef"
          type="button"
          class="md-surface-action is-primary"
          @click="$emit('install')"
        >
          <MdIcon name="check" />
          {{ t('立即安装') }}
        </button>
      </div>

      <p v-if="downloadError" class="update-error" role="alert">{{ t(downloadErrorMessage) }}</p>
    </template>

    <template v-else>
      <header>
        <p class="md-surface-kicker">{{ t('软件更新') }}</p>
        <h2 id="update-island-title" class="md-surface-title">{{ title }}</h2>
        <p class="md-surface-subtitle">{{ t('当前版本 v{0} · 稳定通道', { 0: currentVersion }) }}</p>
      </header>

      <template v-if="status === 'loading'">
        <div class="update-state" role="status">
          <span class="update-spinner" aria-hidden="true"></span>
          <span><b>{{ t('正在连接 GitHub Releases') }}</b><small>{{ t('读取稳定版本与安装包信息，请稍候。') }}</small></span>
        </div>
        <div v-if="hostPrimaryAction" class="md-surface-actionbar" aria-hidden="true"></div>
      </template>

      <template v-else-if="status === 'available' && release">
        <div class="update-version-line">
          <span class="update-version-pill">v{{ currentVersion }}</span>
          <MdIcon name="chevron_right" />
          <span class="update-version-pill is-new">v{{ release.version }}</span>
          <span class="update-version-date">{{ release.dateLabel }}</span>
        </div>

        <div class="update-release-notes">
          <h3>{{ t('本次更新') }}</h3>
          <ul v-if="summaryItems.length">
            <li v-for="item in summaryItems" :key="item">{{ item }}</li>
          </ul>
          <p v-else>{{ t('该版本没有提供可展示的更新摘要。') }}</p>
        </div>

        <button type="button" class="update-package-row" :title="t('下载 {0}', { 0: t(packageInfo.label) })" @click="$emit('download')">
          <span class="update-package-icon"><MdIcon name="download" /></span>
          <span class="update-package-copy"><b>{{ t(packageInfo.label) }}</b><small>{{ t(packageInfo.note) }}</small></span>
          <MdIcon name="chevron_right" />
        </button>

        <div class="md-surface-actionbar">
          <div class="md-surface-aux">
            <button type="button" class="md-surface-text-button" @click="$emit('close')">{{ t('稍后提醒') }}</button>
            <button type="button" class="md-surface-text-button" @click="openDetails">{{ t('查看详情') }}</button>
          </div>
          <button
            v-if="!hostPrimaryAction"
            ref="primaryActionRef"
            type="button"
            class="md-surface-action is-primary"
            @click="$emit('download')"
          >
            <MdIcon name="download" />
            {{ t('下载更新') }}
          </button>
        </div>
      </template>

      <template v-else-if="status === 'latest'">
        <div class="update-state is-success">
          <span class="update-state-icon" aria-hidden="true"><MdIcon name="check" /></span>
          <span><b>{{ t('已经是最新稳定版') }}</b><small>{{ t('当前安装的 HOMURA 与 GitHub 最新版本一致。') }}</small></span>
        </div>
        <div class="md-surface-actionbar">
          <div class="md-surface-aux">
            <button type="button" class="md-surface-text-button" @click="$emit('close')">{{ t('关闭') }}</button>
          </div>
          <button v-if="!hostPrimaryAction" ref="primaryActionRef" type="button" class="md-surface-action is-primary" @click="$emit('changelog')">
            {{ t('查看更新日志') }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="update-state is-error" role="alert">
          <span class="update-state-icon" aria-hidden="true"><MdIcon name="error" /></span>
          <span>
            <b>{{ status === 'download-error' ? t('下载没有完成') : t('暂时无法检查更新') }}</b>
            <small>{{ t(errorMessage) }}</small>
          </span>
        </div>
        <div class="md-surface-actionbar">
          <div class="md-surface-aux">
            <button type="button" class="md-surface-text-button" @click="$emit('close')">{{ t('关闭') }}</button>
          </div>
          <button
            v-if="!hostPrimaryAction"
            ref="primaryActionRef"
            type="button"
            class="md-surface-action is-primary"
            @click="$emit(status === 'download-error' ? 'download' : 'retry')"
          >
            {{ status === 'download-error' ? t('重新下载') : t('再试一次') }}
          </button>
        </div>
      </template>

      <p v-if="linkError" class="update-error" role="alert">{{ linkError }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue';
import type { PropType } from 'vue';
import type { NormalizedRelease } from '../services/updates.ts';
import { openGitHubUrl } from '../services/external.ts';
import { formatBytes } from '../services/platform.ts';
import { getUpdateErrorMessage } from '../services/updates.ts';
import { getDownloadErrorMessage } from '../services/updateDownload.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  mobileSheet: { type: Boolean, default: false },
  status: { type: String, default: 'idle' },
  hostPrimaryAction: { type: Boolean, default: false },
  release: { type: Object as PropType<NormalizedRelease | null>, default: null },
  currentVersion: { type: String, required: true },
  packageInfo: { type: Object as PropType<Record<string, unknown>>, required: true },
  error: { type: Object as PropType<Record<string, unknown> | null>, default: null },
  download: {
    type: Object,
    default: () => ({
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      fileName: '',
      path: '',
      size: 0,
      version: '',
      packageLabel: '',
      platform: ''
    })
  },
  downloadError: { type: Object as PropType<Record<string, unknown> | null>, default: null }
});

const emit = defineEmits(['close', 'retry', 'changelog', 'download', 'cancel-download', 'install']);

const panelRef = shallowRef<HTMLElement | null>(null);
const primaryActionRef = shallowRef<HTMLElement | null>(null);
const linkError = ref('');

const title = computed(() => {
  if (props.status === 'loading') return t('正在检查更新');
  if (props.status === 'available' && props.release) return t('发现新版本 {0}', { 0: props.release.version });
  if (props.status === 'latest') return t('已是最新版本');
  if (props.status === 'download-error') return t('下载未完成');
  return t('检查更新失败');
});

const downloadErrorMessage = computed(() => getDownloadErrorMessage(props.downloadError));
const errorMessage = computed(() => (
  props.status === 'download-error'
    ? downloadErrorMessage.value
    : getUpdateErrorMessage(props.error)
));
const downloadPercent = computed(() => {
  const progress = Number(props.download && props.download.progress);
  return Math.min(100, Math.max(0, Number.isFinite(progress) ? progress * 100 : 0));
});
const downloadPercentLabel = computed(() => (
  downloadPercent.value >= 100 ? '100%' : `${downloadPercent.value.toFixed(1)}%`
));
const downloadSizeLabel = computed(() => {
  const total = Number(props.download.totalBytes) || Number(props.download.size) || 0;
  if (!total) return props.packageInfo.note || '';
  const done = Number(props.download.downloadedBytes) || 0;
  return `${formatBytes(done)} / ${formatBytes(total)}`;
});
const downloadPathParts = computed(() =>
  String(props.download.path || '').split(/([\\/])/).filter(Boolean)
);
const installWarning = computed(() => {
  const platform = props.download.platform || props.packageInfo.platform;
  if (platform === 'android' || platform === 'windows') return t('安装过程中应用将会退出');
  if (platform === 'macos') return t('打开 DMG 后，将 HOMURA 拖入“应用程序”');
  if (platform === 'linux') return t('将交由系统软件中心处理安装包');
  return t('将使用系统默认程序打开安装包');
});
const summaryItems = computed(() => {
  if (!props.release) return [];
  const items = props.release.notes.groups
    .flatMap((group: { items: string[] }) => group.items)
    .slice(0, 4);
  return items.length > 0
    ? items
    : props.release.notes.intro
      ? [props.release.notes.intro]
      : [];
});
const primaryAction = computed(() => {
  if (props.status === 'loading') {
    return {
      label: t('检查中'),
      icon: 'update',
      variant: 'primary',
      disabled: true
    };
  }
  if (props.status === 'downloading') {
    return {
      label: t('取消下载'),
      icon: 'close',
      variant: 'tonal',
      disabled: false
    };
  }
  if (props.status === 'downloaded') {
    return {
      label: t('立即安装'),
      icon: 'check',
      variant: 'primary',
      disabled: false
    };
  }
  if (props.status === 'available') {
    return {
      label: t('下载更新'),
      icon: 'download',
      variant: 'primary',
      disabled: false
    };
  }
  if (props.status === 'latest') {
    return {
      label: t('查看更新日志'),
      icon: 'article',
      variant: 'primary',
      disabled: false
    };
  }
  if (props.status === 'download-error') {
    return {
      label: t('重新下载'),
      icon: 'update',
      variant: 'primary',
      disabled: false
    };
  }
  if (props.status === 'error') {
    return {
      label: t('再试一次'),
      icon: 'update',
      variant: 'primary',
      disabled: false
    };
  }
  return {
    label: t('关闭'),
    icon: 'close',
    variant: 'tonal',
    disabled: false
  };
});

async function openDetails() {
  if (!props.release) return;
  linkError.value = '';
  try {
    await openGitHubUrl(props.release.htmlUrl);
  } catch (error) {
    linkError.value = t('无法打开系统浏览器，请稍后再试。');
    console.warn('打开更新链接失败', error);
  }
}

async function focusInitial() {
  await nextTick();
  primaryActionRef.value?.focus();
  if (!primaryActionRef.value) panelRef.value?.focus({ preventScroll: true });
}

function runPrimaryAction() {
  if (props.status === 'downloading') {
    emit('cancel-download');
    return;
  }
  if (props.status === 'downloaded') {
    emit('install');
    return;
  }
  if (props.status === 'available' || props.status === 'download-error') {
    emit('download');
    return;
  }
  if (props.status === 'latest') {
    emit('changelog');
    return;
  }
  if (props.status === 'error') {
    emit('retry');
    return;
  }
  if (props.status !== 'loading') emit('close');
}

defineExpose({ focusInitial, primaryAction, runPrimaryAction });
</script>

<style scoped>
.update-island-panel {
  width: 100%;
  padding: 20px;
  outline: none;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
}

.update-progress {
  margin-top: 24px;
}

.update-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--md-surface-high);
}

.update-track i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--md-primary);
  transform-origin: left center;
  transition: transform var(--md-duration-short) var(--md-ease-emphasized);
}

.update-progress-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 11px;
}

.update-progress-meta b {
  color: var(--md-primary);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 17px;
  font-weight: 720;
}

.update-progress-meta span {
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
}

.update-current {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  margin-top: 15px;
  padding: 11px 12px;
  border-radius: 15px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 78%, transparent);
}

.update-current :deep(svg) {
  width: 17px;
  height: 17px;
  flex: none;
  color: var(--md-primary);
}

.update-current span {
  min-width: 0;
  flex: 1;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.update-current code {
  max-width: 46%;
  overflow: hidden;
  color: var(--md-on-surface);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-success {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-top: 18px;
  padding: 15px;
  border-radius: 19px;
  background: color-mix(in oklab, var(--md-primary-container) 30%, var(--md-surface-container));
}

.update-success-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  background: var(--md-primary);
  color: var(--md-on-primary);
  box-shadow: 0 0 0 6px color-mix(in oklab, var(--md-primary) 10%, transparent);
}

.update-success-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.update-success b,
.update-success small {
  display: block;
}

.update-success b {
  font-size: 13px;
  font-weight: 650;
}

.update-success small {
  margin-top: 3px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  line-height: 1.5;
}

.update-file {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 80%, transparent);
}

.update-file span {
  display: block;
  margin-bottom: 5px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  font-weight: 650;
}

.update-file code {
  display: block;
  overflow-wrap: anywhere;
  color: var(--md-on-surface);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.6;
}

.update-version-line {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 17px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 82%, transparent);
}

.update-version-pill {
  padding: 5px 8px;
  border-radius: 8px;
  background: var(--md-surface-high);
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 650;
}

.update-version-pill.is-new {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.update-version-line :deep(svg) {
  width: 16px;
  height: 16px;
  color: var(--md-on-surface-variant);
}

.update-version-date {
  margin-left: auto;
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
}

.update-release-notes {
  margin-top: 16px;
}

.update-release-notes h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 650;
}

.update-release-notes ul {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.update-release-notes li {
  position: relative;
  padding-left: 15px;
  font-size: 12px;
  line-height: 1.55;
}

.update-release-notes li::before {
  content: "";
  position: absolute;
  top: 0.68em;
  left: 1px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--md-primary);
}

.update-release-notes > p {
  margin: 0;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.55;
}

.update-package-row {
  display: flex;
  width: 100%;
  min-height: 60px;
  align-items: center;
  gap: 11px;
  margin-top: 15px;
  padding: 11px 12px;
  border: 0;
  border-radius: 17px;
  background: color-mix(in oklab, var(--md-primary-container) 24%, var(--md-surface-container));
  color: var(--md-on-surface);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-primary) 24%, var(--md-outline-variant));
  text-align: left;
}

.update-package-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border-radius: 12px;
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.update-package-icon :deep(svg) {
  width: 19px;
  height: 19px;
}

.update-package-copy {
  min-width: 0;
  flex: 1;
}

.update-package-copy b,
.update-package-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-package-copy b {
  font-size: 12px;
  font-weight: 650;
}

.update-package-copy small {
  margin-top: 2px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.update-package-row > :deep(svg:last-child) {
  width: 18px;
  height: 18px;
  color: var(--md-on-surface-variant);
}

.update-state {
  display: flex;
  min-height: 132px;
  align-items: center;
  gap: 14px;
  margin-top: 18px;
  padding: 18px;
  border-radius: 19px;
  background: var(--md-surface-low);
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--md-outline-variant) 78%, transparent);
}

.update-state b,
.update-state small {
  display: block;
}

.update-state b {
  font-size: 13px;
  font-weight: 650;
}

.update-state small {
  margin-top: 5px;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.55;
}

.update-state-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.update-state-icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.update-state.is-error .update-state-icon {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.update-spinner {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border: 2.5px solid color-mix(in oklab, var(--md-primary) 18%, transparent);
  border-top-color: var(--md-primary);
  border-radius: 50%;
  animation: update-spin 800ms linear infinite;
}

.update-error {
  margin: 12px 0 0;
  color: var(--md-error);
  font-size: 11px;
  line-height: 1.55;
}

@keyframes update-spin {
  to { transform: rotate(360deg); }
}

@media (hover: hover) and (pointer: fine) {
  .update-package-row:hover {
    background: color-mix(in oklab, var(--md-primary-container) 32%, var(--md-surface-container));
  }
}

@media (prefers-reduced-motion: reduce) {
  .update-track i,
  .update-spinner {
    transition: none;
    animation: none;
  }
}
</style>
