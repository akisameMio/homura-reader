<template>
  <section
    ref="panelRef"
    class="update-island-panel"
    role="dialog"
    aria-modal="false"
    aria-labelledby="update-island-title"
    :aria-busy="status === 'loading' || status === 'downloading'"
    tabindex="-1"
  >
    <template v-if="status === 'downloading'">
      <h2 id="update-island-title" class="update-island-title">正在下载更新</h2>
      <p class="update-island-subtitle">
        HOMURA v{{ release?.version || currentVersion }} ·
        {{ download.packageLabel || packageInfo.label }}
      </p>
      <div class="update-island-download">
        <div
          class="update-island-track"
          :style="{ '--update-progress': downloadPercent / 100 }"
          role="progressbar"
          aria-label="更新下载进度"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(downloadPercent * 10) / 10"
        >
          <i></i>
        </div>
        <p>{{ downloadPercentLabel }}</p>
      </div>
      <div class="update-island-actions">
        <button ref="cancelDownloadButtonRef" type="button" class="update-island-text-button" @click="$emit('cancel-download')">取消</button>
      </div>
    </template>

    <template v-else-if="status === 'downloaded'">
      <h2 id="update-island-title" class="update-island-title">下载完成</h2>
      <div class="update-island-ready">
        <span class="update-island-check" aria-hidden="true">
          <MdIcon name="check" />
        </span>
        <span>
          <b>新版本 v{{ download.version }} 已下载完成</b>
          <small>{{ installWarning }}</small>
        </span>
      </div>
      <div class="update-island-file">
        <span>文件位置</span>
        <code><template v-for="(part, index) in downloadPathParts" :key="`${index}-${part}`">{{ part }}<wbr v-if="part === '/' || part === '\\'" /></template></code>
      </div>
      <div class="update-island-actions">
        <button type="button" class="update-island-text-button" @click="$emit('close')">稍后安装</button>
        <button type="button" class="update-island-primary-button" @click="$emit('install')">立即安装</button>
      </div>
      <p v-if="downloadError" class="update-island-error" role="alert">{{ downloadErrorMessage }}</p>
    </template>

    <template v-else>
      <header class="update-island-head">
        <span class="update-island-icon" aria-hidden="true"><MdIcon name="update" /></span>
        <div class="update-island-copy">
          <p class="update-island-kicker">{{ kicker }}</p>
          <h2 id="update-island-title">{{ title }}</h2>
          <p class="update-island-current">当前版本 v{{ currentVersion }} · 稳定通道</p>
        </div>
        <button ref="closeButtonRef" type="button" class="update-island-icon-button" title="关闭更新提示" aria-label="关闭更新提示" @click="$emit('close')">
          <MdIcon name="close" />
        </button>
      </header>

      <div v-if="status === 'loading'" class="update-island-state" role="status">
        <span class="update-island-spinner" aria-hidden="true"></span>
        <div>
          <b>正在连接 GitHub Releases</b>
          <p>读取稳定版本与安装包信息，请稍候。</p>
        </div>
      </div>

      <template v-else-if="status === 'available' && release">
        <div class="update-island-release">
          <div class="update-island-release-head">
            <strong>本次更新</strong>
            <span>{{ release.dateLabel }}</span>
          </div>
          <ul v-if="summaryItems.length">
            <li v-for="item in summaryItems" :key="item">{{ item }}</li>
          </ul>
          <p v-else>该版本没有提供可展示的更新摘要。</p>
        </div>
        <button type="button" class="update-island-install" :title="`下载 ${packageInfo.label}`" @click="$emit('download')">
          <span class="update-island-download-icon" aria-hidden="true"><MdIcon name="download" filled /></span>
          <span><b>{{ packageInfo.label }}</b><small>{{ packageInfo.note }}</small></span>
          <MdIcon name="chevron_right" />
        </button>
        <div class="update-island-actions">
          <button type="button" class="update-island-text-button" @click="$emit('close')">稍后提醒</button>
          <button type="button" class="update-island-text-button" @click="openDetails">查看详情</button>
          <button type="button" class="update-island-primary-button" @click="$emit('download')">立即更新</button>
        </div>
      </template>

      <template v-else-if="status === 'latest'">
        <div class="update-island-state is-success">
          <span class="update-island-symbol" aria-hidden="true"><MdIcon name="check" /></span>
          <div><b>已经是最新稳定版</b><p>当前安装的 HOMURA 与 GitHub 最新版本一致。</p></div>
        </div>
        <div class="update-island-actions">
          <button type="button" class="update-island-text-button" @click="$emit('close')">关闭</button>
          <button type="button" class="update-island-primary-button" @click="$emit('changelog')">查看更新日志</button>
        </div>
      </template>

      <template v-else>
        <div class="update-island-state is-error" role="alert">
          <span class="update-island-symbol" aria-hidden="true"><MdIcon name="error" /></span>
          <div>
            <b>{{ status === 'download-error' ? '下载没有完成' : '暂时无法检查更新' }}</b>
            <p>{{ errorMessage }}</p>
          </div>
        </div>
        <div class="update-island-actions">
          <button type="button" class="update-island-text-button" @click="$emit('close')">关闭</button>
          <button type="button" class="update-island-primary-button" @click="$emit(status === 'download-error' ? 'download' : 'retry')">
            {{ status === 'download-error' ? '重新下载' : '再试一次' }}
          </button>
        </div>
      </template>

      <p v-if="linkError" class="update-island-error" role="alert">{{ linkError }}</p>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef } from 'vue';
import { openGitHubUrl } from '../services/external.js';
import { getUpdateErrorMessage } from '../services/updates.js';
import { getDownloadErrorMessage } from '../services/updateDownload.js';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  status: { type: String, default: 'idle' },
  release: { type: Object, default: null },
  currentVersion: { type: String, required: true },
  packageInfo: { type: Object, required: true },
  error: { type: Object, default: null },
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
  downloadError: { type: Object, default: null }
});

defineEmits(['close', 'retry', 'changelog', 'download', 'cancel-download', 'install']);

const panelRef = shallowRef(null);
const closeButtonRef = shallowRef(null);
const cancelDownloadButtonRef = shallowRef(null);
const linkError = ref('');

const kicker = computed(() => {
  if (props.status === 'loading') return 'CHECKING RELEASES';
  if (props.status === 'available') return 'UPDATE AVAILABLE';
  if (props.status === 'latest') return 'YOU ARE UP TO DATE';
  return 'UPDATE CHECK FAILED';
});

const title = computed(() => {
  if (props.status === 'loading') return '正在检查更新';
  if (props.status === 'available' && props.release) return `发现新版本 ${props.release.version}`;
  if (props.status === 'latest') return '已是最新版本';
  if (props.status === 'download-error') return '下载未完成';
  return '检查更新失败';
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
const downloadPathParts = computed(() =>
  String(props.download.path || '').split(/([\\/])/).filter(Boolean)
);
const installWarning = computed(() => {
  const platform = props.download.platform || props.packageInfo.platform;
  if (platform === 'android' || platform === 'windows') return '安装过程中应用将会退出';
  if (platform === 'macos') return '打开 DMG 后，将 HOMURA 拖入“应用程序”';
  if (platform === 'linux') return '将交由系统软件中心处理安装包';
  return '将使用系统默认程序打开安装包';
});
const summaryItems = computed(() => {
  if (!props.release) return [];
  const items = props.release.notes.groups
    .flatMap(group => group.items)
    .slice(0, 4);
  return items.length > 0
    ? items
    : props.release.notes.intro
      ? [props.release.notes.intro]
      : [];
});

async function openDetails() {
  if (!props.release) return;
  linkError.value = '';
  try {
    await openGitHubUrl(props.release.htmlUrl);
  } catch (error) {
    linkError.value = '无法打开系统浏览器，请稍后再试。';
    console.warn('打开更新链接失败', error);
  }
}

async function focusInitial() {
  await nextTick();
  if (props.status === 'downloading') {
    cancelDownloadButtonRef.value?.focus();
    return;
  }
  closeButtonRef.value?.focus();
  if (!closeButtonRef.value) panelRef.value?.focus({ preventScroll: true });
}

defineExpose({ focusInitial });
</script>

<style scoped>
.update-island-panel {
  width: 100%;
  padding: 20px;
  outline: none;
}

.update-island-title {
  margin: 0;
  font-size: 21px;
  font-weight: 680;
  line-height: 1.25;
  letter-spacing: -0.025em;
}

.update-island-subtitle {
  margin: 8px 0 0;
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.55;
}

.update-island-download {
  margin-top: 24px;
}

.update-island-track {
  position: relative;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--md-surface-high);
}

.update-island-track i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--md-primary);
  transform: scaleX(var(--update-progress, 0));
  transform-origin: left center;
  transition: transform var(--md-duration-short) var(--md-ease-emphasized);
}

.update-island-download > p {
  margin: 12px 0 0;
  color: var(--md-on-surface);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  font-weight: 560;
  text-align: center;
}

.update-island-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.update-island-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  border-radius: 14px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.update-island-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.update-island-copy {
  min-width: 0;
  flex: 1;
}

.update-island-kicker {
  margin: 0;
  color: var(--md-primary);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.update-island-copy h2 {
  margin: 5px 0 0;
  font-size: 17px;
  font-weight: 680;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.update-island-current {
  margin: 6px 0 0;
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
}

.update-island-icon-button {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 50%;
  color: var(--md-on-surface-variant);
}

.update-island-icon-button :deep(svg) {
  width: 18px;
  height: 18px;
}

.update-island-state,
.update-island-ready {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 18px;
  padding: 16px;
  border-radius: 18px;
  background: var(--md-surface-low);
}

.update-island-state b,
.update-island-ready b {
  font-size: 13px;
  font-weight: 650;
}

.update-island-state p,
.update-island-ready small {
  display: block;
  margin: 6px 0 0;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.55;
}

.update-island-spinner {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  border: 2.5px solid color-mix(in oklab, var(--md-primary) 18%, transparent);
  border-top-color: var(--md-primary);
  border-radius: 50%;
  animation: update-island-spin 800ms linear infinite;
}

.update-island-symbol,
.update-island-check {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border-radius: 50%;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.update-island-symbol :deep(svg),
.update-island-check :deep(svg) {
  width: 18px;
  height: 18px;
}

.update-island-state.is-error .update-island-symbol {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.update-island-release {
  margin-top: 18px;
  padding: 14px;
  border-radius: 17px;
  background: var(--md-surface-low);
}

.update-island-release-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.update-island-release-head strong {
  font-size: 12px;
  font-weight: 650;
}

.update-island-release-head span {
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9.5px;
}

.update-island-release ul {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.update-island-release li {
  position: relative;
  padding-left: 12px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  line-height: 1.5;
}

.update-island-release li::before {
  content: "";
  position: absolute;
  top: 0.62em;
  left: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--md-primary);
}

.update-island-release > p {
  margin: 10px 0 0;
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.update-island-install {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  margin-top: 12px;
  padding: 9px 11px;
  border: 1px solid var(--md-outline-variant);
  border-radius: 16px;
  background: var(--md-surface);
  color: var(--md-on-surface);
  text-align: left;
}

.update-island-download-icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border-radius: 11px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.update-island-install > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.update-island-install b {
  font-size: 11px;
  font-weight: 650;
}

.update-island-install small {
  color: var(--md-on-surface-variant);
  font-size: 9.5px;
}

.update-island-install > :deep(svg) {
  width: 17px;
  height: 17px;
  flex: none;
  color: var(--md-on-surface-variant);
}

.update-island-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--md-outline-variant);
}

.update-island-text-button,
.update-island-primary-button {
  min-height: 40px;
  padding: 0 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 640;
}

.update-island-text-button {
  color: var(--md-primary);
}

.update-island-primary-button {
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.update-island-file {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--md-surface-low);
}

.update-island-file span {
  display: block;
  margin-bottom: 5px;
  color: var(--md-on-surface-variant);
  font-size: 10px;
  font-weight: 600;
}

.update-island-file code {
  display: block;
  overflow-wrap: break-word;
  color: var(--md-on-surface);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.65;
}

.update-island-error {
  margin: 10px 0 0;
  color: var(--md-error);
  font-size: 11px;
}

@keyframes update-island-spin {
  to { transform: rotate(360deg); }
}

@media (hover: hover) and (pointer: fine) {
  .update-island-text-button:hover,
  .update-island-icon-button:hover {
    background: var(--md-surface-high);
  }

  .update-island-primary-button:hover {
    background: color-mix(in oklab, var(--md-primary) 90%, var(--md-on-primary));
  }
}

@media (prefers-reduced-motion: reduce) {
  .update-island-track i,
  .update-island-spinner {
    transition: none;
    animation: none;
  }
}
</style>
