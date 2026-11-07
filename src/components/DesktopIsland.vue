<template>
  <div
    ref="rootRef"
    class="desktop-island md-fab-pos"
    :class="{ 'is-replacing': replaceSurface }"
  >
    <Transition name="island-surface" mode="out-in">
      <div
        v-if="surfaceKey"
        :key="surfaceKey"
        ref="surfaceRef"
        class="desktop-island-surface"
        :class="surfaceClass"
        :style="{ '--island-width': `${surfaceWidth}px` }"
        :role="surface === 'shelf' ? (pendingShelfDialog?.kind === 'confirm' ? 'alertdialog' : 'dialog') : undefined"
        :aria-modal="surface === 'shelf' ? 'true' : undefined"
        :aria-labelledby="surface === 'shelf' ? 'shelf-dialog-title' : undefined"
      >
        <div v-if="surface === 'menu'" class="island-menu" role="menu" aria-label="导入与书库">
          <p role="presentation" class="island-menu-label">导入作品</p>
          <button type="button" role="menuitem" class="island-menu-item" @click="choose('pick-files')">
            <MdIcon name="upload_file" />
            <span><b>导入文件</b><small>EPUB · PDF · MOBI · TXT</small></span>
          </button>
          <button v-if="canPickFolder" type="button" role="menuitem" class="island-menu-item" @click="choose('pick-folder')">
            <MdIcon name="folder_open" />
            <span><b>导入文件夹</b><small>图片目录会合并成一本漫画</small></span>
          </button>
          <button type="button" role="menuitem" class="island-menu-item" @click="choose('create-collection')">
            <MdIcon name="create_new_folder" />
            <span><b>新建书库</b><small>先建一个书库，再放入作品</small></span>
          </button>
        </div>

        <ImportProgressPanel
          v-else-if="surface === 'import'"
          embedded
          @retry="$emit('retry-failed')"
          @close="closeImport"
        />

        <ShelfDialogContent
          v-else-if="surface === 'shelf'"
          ref="shelfContentRef"
          :request="pendingShelfDialog"
          @resolve="resolveShelfDialog"
        />

        <UpdateIslandPanel
          v-else-if="surface === 'update'"
          ref="updatePanelRef"
          :status="updates.updateStatus"
          :release="updates.latestRelease"
          :current-version="updates.appVersion"
          :package-info="updates.updatePackage"
          :error="updates.updateError"
          :download="updates.downloadState"
          :download-error="updates.downloadError"
          @close="updates.closeUpdateDialog"
          @retry="updates.checkForUpdates"
          @changelog="updates.openChangelog"
          @download="updates.startUpdateDownload"
          @cancel-download="updates.cancelCurrentDownload"
          @install="updates.installDownloadedUpdate"
        />
      </div>
    </Transition>

    <div class="island-trigger-row" role="group" aria-label="导入与更新">
      <Transition name="island-orb">
        <button
          v-if="showUpdateOrb"
          ref="updateButtonRef"
          type="button"
          class="island-update-orb"
          :class="{
            'is-ready': updates.hasPendingInstall,
            'is-checking': updates.updateStatus === 'loading'
          }"
          :title="updateOrbTitle"
          :aria-label="updateOrbTitle"
          aria-haspopup="dialog"
          @click="openUpdate"
        >
          <MdIcon :name="updates.hasPendingInstall ? 'check' : 'update'" />
          <span v-if="!updates.hasPendingInstall" class="island-update-dot" aria-hidden="true"></span>
        </button>
      </Transition>

      <button
        ref="importButtonRef"
        type="button"
        class="island-import-trigger"
        :class="{
          'is-ring': importProgress.status !== 'idle',
          'is-failed': importProgress.status !== 'idle' && importProgress.hasFailures,
          'is-open': surface === 'menu' || surface === 'import',
          'is-collapsed': triggerCollapsed
        }"
        :title="importButtonTitle"
        :aria-label="importButtonLabel"
        :aria-haspopup="importProgress.status === 'idle' ? 'menu' : 'dialog'"
        :aria-expanded="importProgress.status === 'idle' ? surface === 'menu' : importProgress.expanded"
        :inert="triggerCollapsed"
        :tabindex="triggerCollapsed ? -1 : undefined"
        @click="onImportClick"
      >
        <span class="island-import-layer" :class="{ 'is-hidden': importProgress.status !== 'idle' }" aria-hidden="true">
          <MdIcon name="upload_file" filled />
          <span>导入</span>
        </span>
        <span class="island-import-layer" :class="{ 'is-hidden': importProgress.status === 'idle' }" aria-hidden="true">
          <svg class="island-ring" viewBox="0 0 44 44">
            <circle class="island-ring-track" cx="22" cy="22" r="18"></circle>
            <circle
              class="island-ring-value"
              cx="22"
              cy="22"
              r="18"
              :stroke-dasharray="ringLength"
              :stroke-dashoffset="ringOffset"
            ></circle>
          </svg>
          <MdIcon v-if="importProgress.status === 'done' && !importProgress.hasFailures" name="check" class="island-ring-icon" />
          <MdIcon
            v-else-if="importProgress.status === 'done' || importProgress.status === 'cancelled'"
            :name="importProgress.status === 'cancelled' ? 'close' : 'warning'"
            class="island-ring-icon"
          />
          <span v-else class="island-ring-number">{{ importProgress.done }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch
} from 'vue';
import { canPickFolder } from '../services/platform.js';
import { useImportProgressStore } from '../stores/importProgress.js';
import { useUpdateStore } from '../stores/updates.js';
import { useShelfDialogs } from '../composables/useShelfDialogs.js';
import ShelfDialogContent from './ShelfDialogContent.vue';
import ImportProgressPanel from './ImportProgressPanel.vue';
import UpdateIslandPanel from './UpdateIslandPanel.vue';
import MdIcon from './MdIcon.vue';

const props = defineProps({
  activeNav: { type: String, default: 'shelf' }
});
const emit = defineEmits(['create-collection', 'pick-files', 'pick-folder', 'retry-failed']);

const importProgress = useImportProgressStore();
const updates = useUpdateStore();
const { pendingShelfDialog, resolveShelfDialog } = useShelfDialogs();

const rootRef = shallowRef(null);
const surfaceRef = shallowRef(null);
const shelfContentRef = shallowRef(null);
const updatePanelRef = shallowRef(null);
const importButtonRef = shallowRef(null);
const updateButtonRef = shallowRef(null);

const menuOpen = ref(false);
const lastTrigger = shallowRef(null);
const restoreFocusTarget = shallowRef(null);
const returnFocus = ref('import');
let autoDismissTimer = 0;

const updatePending = computed(() => (
  updates.hasNewRelease
  || updates.hasPendingInstall
  || ['available', 'downloading', 'downloaded', 'download-error'].includes(updates.updateStatus)
));
const importSurfaceOpen = computed(() => (
  importProgress.status !== 'idle' && importProgress.expanded
));
const surface = computed(() => {
  if (pendingShelfDialog.value) return 'shelf';
  if (menuOpen.value && importProgress.status === 'idle') return 'menu';
  if (importSurfaceOpen.value) return 'import';
  if (updates.updateDialogOpen) return 'update';
  return null;
});
const surfaceKey = computed(() => {
  if (surface.value === 'shelf') return `shelf-${pendingShelfDialog.value?.kind || 'dialog'}`;
  if (surface.value === 'update') return `update-${updates.updateStatus}`;
  return surface.value;
});
const surfaceWidth = computed(() => {
  if (surface.value === 'menu') return 292;
  if (surface.value === 'import') return 372;
  if (surface.value === 'shelf') {
    return pendingShelfDialog.value?.kind === 'confirm' ? 372 : 390;
  }
  if (surface.value === 'update') return 430;
  return 0;
});
const surfaceClass = computed(() => ({
  'is-shelf': surface.value === 'shelf',
  'is-update': surface.value === 'update'
}));
const replaceSurface = computed(() => !!surface.value && surface.value !== 'update');
const triggerCollapsed = computed(() => replaceSurface.value);
const showUpdateOrb = computed(() => (
  updatePending.value
  && !surface.value
  && !importSurfaceOpen.value
));
const ringLength = 2 * Math.PI * 18;
const ringOffset = computed(() => ringLength * (1 - importProgress.percent / 100));
const updateOrbTitle = computed(() => (
  updates.hasPendingInstall
    ? '更新已下载，打开安装'
    : updates.updateStatus === 'download-error'
      ? '更新下载失败，打开重试'
      : updates.updateStatus === 'error'
        ? '更新检查失败，打开重试'
        : '有新版本可用'
));
const importButtonTitle = computed(() => {
  if (importProgress.status === 'idle') return '导入作品';
  if (importProgress.status === 'running') return `导入进度 ${importProgress.done} / ${importProgress.total}`;
  if (importProgress.status === 'cancelled') return '导入已停止';
  return importProgress.hasFailures ? '导入完成，有失败项' : '导入完成';
});
const importButtonLabel = computed(() => {
  if (importProgress.status === 'idle') return '导入作品';
  return `${importButtonTitle.value}，${importProgress.expanded ? '收起进度详情' : '展开进度详情'}`;
});

function choose(action) {
  menuOpen.value = false;
  emit(action);
}

function openUpdate() {
  returnFocus.value = 'update';
  lastTrigger.value = updateButtonRef.value;
  updates.openUpdateDialog();
}

function onImportClick() {
  returnFocus.value = 'import';
  lastTrigger.value = importButtonRef.value;
  if (importProgress.status === 'idle') {
    menuOpen.value = !menuOpen.value;
    return;
  }
  importProgress.toggleExpanded(!importProgress.expanded);
}

function closeImport() {
  importProgress.dismiss();
  nextTick(() => importButtonRef.value?.focus());
}

async function focusSurface(key) {
  if (!key) {
    await nextTick();
    const active = document.activeElement;
    if (
      active
      && active.isConnected
      && active !== document.body
      && !rootRef.value?.contains(active)
    ) {
      restoreFocusTarget.value = null;
      return;
    }
    if (restoreFocusTarget.value?.isConnected) {
      restoreFocusTarget.value.focus();
    } else if (returnFocus.value === 'update' && updateButtonRef.value?.isConnected) {
      updateButtonRef.value.focus();
    } else if (importButtonRef.value?.isConnected) {
      importButtonRef.value.focus();
    } else if (lastTrigger.value?.isConnected) {
      lastTrigger.value.focus();
    } else if (updatePending.value) {
      updateButtonRef.value?.focus();
    } else {
      importButtonRef.value?.focus();
    }
    restoreFocusTarget.value = null;
    return;
  }

  await nextTick();
  if (surface.value === 'shelf') {
    shelfContentRef.value?.focusInitial();
    return;
  }
  if (surface.value === 'update') {
    const active = document.activeElement;
    const isTextEntry = active && (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      || active.isContentEditable
    );
    if (isTextEntry && !rootRef.value?.contains(active)) return;
    updatePanelRef.value?.focusInitial();
    return;
  }
  if (surface.value === 'import') {
    surfaceRef.value?.querySelector('.import-progress-panel')?.focus();
    return;
  }
  if (surface.value === 'menu') {
    surfaceRef.value?.querySelector('.island-menu-item')?.focus();
  }
}

function focusableElements() {
  if (!surfaceRef.value) return [];
  return Array.from(surfaceRef.value.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
  ));
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (pendingShelfDialog.value) {
      event.preventDefault();
      resolveShelfDialog();
      return;
    }
    if (menuOpen.value) {
      event.preventDefault();
      menuOpen.value = false;
      nextTick(() => importButtonRef.value?.focus());
      return;
    }
    if (importSurfaceOpen.value) {
      event.preventDefault();
      importProgress.toggleExpanded(false);
      nextTick(() => importButtonRef.value?.focus());
      return;
    }
    if (updates.updateDialogOpen) {
      event.preventDefault();
      updates.closeUpdateDialog();
      return;
    }
  }

  if (event.key !== 'Tab' || !surfaceKey.value) return;
  const elements = focusableElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onDocumentPointerDown(event) {
  if (rootRef.value?.contains(event.target)) return;
  if (pendingShelfDialog.value) return;
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  if (importSurfaceOpen.value) {
    importProgress.toggleExpanded(false);
    return;
  }
  if (updates.updateDialogOpen && updates.updateStatus !== 'downloading') {
    updates.closeUpdateDialog();
  }
}

watch(
  () => pendingShelfDialog.value,
  (pending, previous) => {
    if (pending && !previous) {
      const active = document.activeElement;
      restoreFocusTarget.value = active && active !== document.body ? active : null;
    }
    if (pending && surface.value === 'shelf') {
      nextTick(() => {
        if (pending === pendingShelfDialog.value) shelfContentRef.value?.focusInitial();
      });
    }
  },
  { immediate: true }
);

watch(
  () => updates.updateDialogOpen,
  open => {
    if (!open) return;
    returnFocus.value = 'update';
    if (pendingShelfDialog.value) return;
    const active = document.activeElement;
    if (active && active !== document.body && !rootRef.value?.contains(active)) {
      restoreFocusTarget.value = active;
    }
  },
  { immediate: true }
);

watch(
  () => importProgress.status,
  status => {
    if (status !== 'idle') menuOpen.value = false;
    window.clearTimeout(autoDismissTimer);
    autoDismissTimer = 0;
    if (!importProgress.isAutoDismissable) return;
    autoDismissTimer = window.setTimeout(() => {
      autoDismissTimer = 0;
      if (document.activeElement?.closest?.('.desktop-island-surface')) return;
      importProgress.dismiss();
    }, 8000);
  }
);

watch(surfaceRef, element => {
  if (element) {
    focusSurface(surfaceKey.value);
    return;
  }
  if (!surfaceKey.value) focusSurface(null);
});

watch(
  () => props.activeNav,
  () => {
    menuOpen.value = false;
  }
);

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.clearTimeout(autoDismissTimer);
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.desktop-island {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  min-height: 56px;
  transform-origin: 100% 100%;
  transition: gap var(--md-duration-medium) var(--md-ease-emphasized);
}

.desktop-island.is-replacing {
  gap: 0;
}

.island-trigger-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
}

.island-update-orb,
.island-import-trigger {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 56px;
  padding: 0;
  overflow: hidden;
  border: 0;
  box-shadow:
    0 2px 4px -2px color-mix(in oklab, var(--md-shadow-color) 28%, transparent),
    0 6px 16px -8px color-mix(in oklab, var(--md-shadow-color) 38%, transparent);
  transition:
    width var(--md-duration-medium) var(--md-ease-emphasized),
    border-radius var(--md-duration-medium) var(--md-ease-emphasized),
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-medium) var(--md-ease-emphasized),
    box-shadow var(--md-duration-short) var(--md-ease-emphasized);
}

.island-update-orb {
  width: 56px;
  border-radius: 50%;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}

.island-update-orb.is-ready {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.island-update-orb.is-checking :deep(svg) {
  animation: island-update-turn 1.2s linear infinite;
}

.island-update-orb :deep(svg) {
  width: 21px;
  height: 21px;
}

.island-update-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 7px;
  height: 7px;
  border: 1.5px solid var(--md-secondary-container);
  border-radius: 50%;
  background: var(--md-primary);
}

.island-import-trigger {
  width: 104px;
  border-radius: 28px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  transform-origin: 100% 50%;
}

.island-import-trigger.is-ring {
  width: 56px;
  border-radius: 50%;
}

.island-import-trigger.is-failed {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.island-import-trigger.is-open {
  background: color-mix(in oklab, var(--md-primary-container) 92%, var(--md-on-primary-container));
}

.island-import-trigger.is-collapsed {
  width: 0;
  border-radius: 0;
  opacity: 0;
  transform: scale(0.82);
  pointer-events: none;
}

.island-import-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font-size: 13px;
  font-weight: 650;
  transition:
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-short) var(--md-ease-emphasized);
}

.island-import-layer :deep(svg) {
  width: 20px;
  height: 20px;
}

.island-import-layer.is-hidden {
  opacity: 0;
  transform: scale(0.76);
  transition-duration: 120ms;
  pointer-events: none;
}

.island-import-layer:not(.is-hidden) {
  transition-delay: 70ms;
}

.island-ring {
  position: absolute;
  inset: 6px;
  width: 44px;
  height: 44px;
  transform: rotate(-90deg);
}

.island-ring-track,
.island-ring-value {
  fill: none;
  stroke-width: 3;
}

.island-ring-track {
  stroke: color-mix(in oklab, var(--md-on-primary-container) 16%, transparent);
}

.island-ring-value {
  stroke: var(--md-primary);
  stroke-linecap: round;
  transition: stroke-dashoffset var(--md-duration-short) var(--md-ease-emphasized);
}

.island-import-trigger.is-failed .island-ring-track {
  stroke: color-mix(in oklab, var(--md-on-error-container) 18%, transparent);
}

.island-import-trigger.is-failed .island-ring-value {
  stroke: var(--md-error);
}

.island-ring-number,
.island-ring-icon {
  position: relative;
  z-index: 1;
}

.island-ring-number {
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
}

.island-ring-icon {
  width: 18px;
  height: 18px;
}

.desktop-island-surface {
  width: var(--island-width);
  max-height: calc(100dvh - 112px);
  overflow: hidden;
  border-radius: 28px;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
  box-shadow:
    0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color) 28%, transparent),
    0 18px 48px -18px color-mix(in oklab, var(--md-shadow-color) 48%, transparent);
  transform-origin: 100% 100%;
}

.desktop-island-surface.is-update {
  max-height: min(680px, calc(100dvh - 112px));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.desktop-island-surface.is-shelf {
  overflow-y: auto;
  overscroll-behavior: contain;
}

.desktop-island-surface :deep(.shelf-dialog-content) {
  padding: 20px;
}

.island-menu {
  padding: 10px;
}

.island-menu-label {
  margin: 4px 10px 8px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.island-menu-item {
  display: flex;
  width: 100%;
  min-height: 56px;
  align-items: center;
  gap: 11px;
  padding: 7px 9px;
  border-radius: 18px;
  color: var(--md-on-surface);
  text-align: left;
}

.island-menu-item :deep(svg) {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--md-primary);
}

.island-menu-item > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.island-menu-item b {
  font-size: 13px;
  font-weight: 650;
}

.island-menu-item small {
  overflow: hidden;
  color: var(--md-on-surface-variant);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-surface-enter-active {
  transition:
    opacity var(--md-duration-short) var(--md-ease-emphasized) 60ms,
    transform var(--md-duration-medium) var(--md-ease-emphasized) 40ms;
}

.island-surface-leave-active {
  transition:
    opacity 120ms var(--md-ease-accelerate),
    transform 160ms var(--md-ease-accelerate);
}

.island-surface-enter-from,
.island-surface-leave-to {
  opacity: 0;
  transform: translate3d(8px, 16px, 0) scale(0.3);
}

.island-orb-enter-active,
.island-orb-leave-active {
  transition:
    width var(--md-duration-medium) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-medium) var(--md-ease-emphasized),
    border-radius var(--md-duration-medium) var(--md-ease-emphasized);
}

.island-orb-enter-from,
.island-orb-leave-to {
  width: 0;
  border-radius: 0;
  opacity: 0;
  transform: translateX(24px) scale(0.6);
}

.island-orb-enter-active {
  transition-delay: 60ms;
}

@media (hover: hover) and (pointer: fine) {
  .island-import-trigger:not(.is-open):hover,
  .island-update-orb:hover {
    box-shadow:
      0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color) 30%, transparent),
      0 10px 24px -10px color-mix(in oklab, var(--md-shadow-color) 42%, transparent);
  }

  .island-import-trigger:not(.is-failed):not(.is-open):hover {
    background: color-mix(in oklab, var(--md-primary-container) 92%, var(--md-on-primary-container));
  }

  .island-menu-item:hover {
    background: color-mix(in oklab, var(--md-primary-container) 46%, transparent);
  }
}

@keyframes island-update-turn {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-island,
  .island-update-orb,
  .island-import-trigger,
  .island-import-layer,
  .island-ring-value,
  .island-surface-enter-active,
  .island-surface-leave-active,
  .island-orb-enter-active,
  .island-orb-leave-active {
    transition: none;
  }

  .island-update-orb.is-checking :deep(svg) {
    animation: none;
  }
}
</style>
