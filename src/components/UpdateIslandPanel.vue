<template>
  <section :class="{ 'is-island': desktop }" :aria-busy="status === 'loading' || status === 'downloading'">
    <p v-if="!desktop" class="md-mobile-sheet-label">{{ t('HOMURA · 稳定通道') }}</p>
    <div class="md-mobile-sheet-card">
      <div class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-accent"><MdIcon :name="status === 'downloaded' || status === 'latest' ? 'check' : 'update'" /></span>
        <span class="md-mobile-sheet-copy">
          <b>{{ desktop && status === 'available' && release ? `HOMURA v${release.version}` : status === 'downloaded' ? t('v{0} 已准备就绪', { 0: download.version }) : status === 'downloading' ? t('正在下载 v{0}', { 0: release?.version || currentVersion }) : title }}</b>
          <small>{{ desktop && status === 'available' ? t('稳定通道') : t('当前版本 v{0}', { 0: currentVersion }) }}<template v-if="release?.dateLabel"> · {{ release.dateLabel }}</template></small>
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
        <component :is="desktop ? 'button' : 'div'" :type="desktop ? 'button' : undefined"
          class="md-mobile-sheet-row" @click="desktop && $emit('download')">
          <span class="md-mobile-sheet-icon"><MdIcon name="download" /></span>
          <span class="md-mobile-sheet-copy"><b>{{ t(packageInfo.label) }}</b><small>{{ t(packageInfo.note) }}</small></span>
        </component>
        <button v-if="!desktop" type="button" class="md-mobile-sheet-row" @click="openDetails">
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
    <div v-if="status === 'error'" class="md-mobile-sheet-card">
      <button type="button" class="md-mobile-sheet-row" @click="openReleasePage(RELEASES_PAGE_URL)">
        <span class="md-mobile-sheet-copy"><b>{{ t('在 GitHub 查看全部发布') }}</b></span><MdIcon name="chevron_right" />
      </button>
    </div>
    <p v-if="linkError" class="md-mobile-sheet-field-error" role="alert">{{ linkError }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PropType } from 'vue';
import { openGitHubUrl } from '../services/external.ts';
import { formatBytes } from '../services/platform.ts';
import { getUpdateErrorMessage, RELEASES_PAGE_URL, type NormalizedRelease } from '../services/updates.ts';
import { getDownloadErrorMessage } from '../services/updateDownload.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  desktop: { type: Boolean, default: false },
  status: { type: String, default: 'idle' },
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

async function openReleasePage(url: string) {
  linkError.value = '';
  try {
    await openGitHubUrl(url);
  } catch (error) {
    linkError.value = t('无法打开系统浏览器，请稍后再试。');
    console.warn('打开更新链接失败', error);
  }
}

function openDetails() {
  if (props.release) return openReleasePage(props.release.htmlUrl);
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

defineExpose({ openDetails, primaryAction, runPrimaryAction });
</script>

<style scoped>
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

.is-island .update-progress-meta { margin: 0 0 12px; }
.is-island .mobile-update-notes { list-style: disc; font-size: 12px; }
.is-island .mobile-update-notes li + li { margin-top: 3px; }
.is-island .mobile-update-notes li::marker { color: var(--md-primary); }
</style>
