<template>
  <div
    ref="rootRef"
    class="desktop-island md-fab-pos"
  >
    <!-- 非空 surface 切换时让新旧卡片同时过渡，避免 out-in 收成按钮后出现空白间隔。 -->
    <Transition
      name="island-surface"
      @enter="onSurfaceEnter"
      @after-leave="onSurfaceAfterLeave"
      @leave-cancelled="onSurfaceLeaveCancelled"
    >
      <div
        v-if="surfaceKey"
        :key="surfaceKey"
        :ref="setSurfaceRef"
        class="desktop-island-surface"
        :class="{ 'is-update': surface === 'update' }"
        tabindex="-1"
        :style="{
          '--island-width': `${surfaceWidth}px`,
          '--trigger-width': `${triggerWidth}px`,
          '--island-action-width': `${buttonWidth}px`,
          '--enter-seed-width': `${enterSeed.width}px`,
          '--enter-seed-right': `${enterSeed.right}px`,
          '--enter-seed-bottom': `${enterSeed.bottom}px`
        }"
        :role="surface === 'shelf' && shelfDialogDisplay?.kind === 'confirm' ? 'alertdialog' : 'dialog'"
        :aria-modal="surface === 'shelf' || surface === 'duplicate' ? 'true' : undefined"
        :aria-labelledby="`desktop-island-title-${surfaceKey}`"
        :aria-owns="surfaceKey ? 'homura-island-action' : undefined"
      >
        <ReaderDrawerHeader
          prominent
          :title="surfaceTitle"
          :title-id="`desktop-island-title-${surfaceKey}`"
          :subtitle="surface === 'update' ? t('当前版本 v{0}', { 0: updates.appVersion }) : ''"
          :close-label="surface === 'import' && importProgress.status === 'running'
            ? t('收起，继续导入')
            : surface === 'update' && updates.updateStatus === 'downloading' ? t('取消下载') : t('关闭')"
          :close-disabled="surface === 'duplicate' && !!pendingDuplicate?.busy"
          @close="closeSurface"
        />

        <div class="island-body">
          <template v-if="surface === 'menu'">
            <p class="md-mobile-sheet-label">{{ t('导入作品') }}</p>
            <div class="md-mobile-sheet-card">
              <button type="button" class="md-mobile-sheet-row island-menu-item" @click="choose('pick-files')">
                <span class="md-mobile-sheet-icon is-accent"><MdIcon name="upload_file" /></span>
                <span class="md-mobile-sheet-copy"><b>{{ t('导入文件') }}</b><small>EPUB, CBZ, ZIP, PDF, MOBI, TXT, MD</small></span>
                <MdIcon name="chevron_right" :size="20" />
              </button>
              <button v-if="canPickFolder" type="button" class="md-mobile-sheet-row island-menu-item" @click="choose('pick-folder')">
                <span class="md-mobile-sheet-icon"><MdIcon name="folder_open" /></span>
                <span class="md-mobile-sheet-copy"><b>{{ t('导入文件夹') }}</b><small>{{ t('图片目录会合并成一本漫画') }}</small></span>
                <MdIcon name="chevron_right" :size="20" />
              </button>
            </div>
            <p v-if="isAndroid && canPickFolder" class="md-mobile-sheet-hint px-3">{{ t('选择要导入的文件夹，里面的子文件夹也会一起扫描。按钮灰色时，可以进入下一级再选择。') }}</p>
            <p class="md-mobile-sheet-label">{{ t('整理书架') }}</p>
            <div class="md-mobile-sheet-card">
              <button type="button" class="md-mobile-sheet-row island-menu-item" @click="choose('create-collection')">
                <span class="md-mobile-sheet-icon"><MdIcon name="create_new_folder" /></span>
                <span class="md-mobile-sheet-copy"><b>{{ t('新建书库') }}</b><small>{{ t('先建一个书库，再放入作品') }}</small></span>
                <MdIcon name="chevron_right" :size="20" />
              </button>
            </div>
          </template>

          <ImportProgressPanel
            v-else-if="surface === 'import'"
            ref="importPanelRef"
            desktop
            @retry="$emit('retry-failed')"
            @close="closeImport"
          />

          <DuplicateImportContent
            v-else-if="surface === 'duplicate'"
            ref="duplicateContentRef"
            desktop
            :pending="pendingDuplicate"
            @resolve="resolveImport"
          />

          <ShelfDialogContent
            v-else-if="surface === 'shelf'"
            ref="shelfContentRef"
            desktop
            :request="shelfDialogDisplay"
            @resolve="resolveShelfDialog"
          />

          <UpdateIslandPanel
            v-else-if="surface === 'update'"
            ref="updatePanelRef"
            desktop
            :status="updates.updateStatus"
            :release="updates.latestRelease"
            :current-version="updates.appVersion"
            :package-info="updates.updatePackage"
            :error="updateErrorForDisplay"
            :download="updates.downloadState"
            :download-error="downloadErrorForDisplay"
            @close="updates.closeUpdateDialog"
            @retry="updates.checkForUpdates"
            @changelog="updates.openChangelog"
            @download="updates.startUpdateDownload"
            @cancel-download="updates.cancelCurrentDownload"
            @install="updates.installDownloadedUpdate"
          />
        </div>

        <footer class="island-footer">
          <template v-if="surface === 'duplicate'">
            <button type="button" class="md-surface-text-button island-skip-duplicate" :disabled="pendingDuplicate?.busy" @click="resolveImport()">
              {{ pendingDuplicate?.batch ? t('跳过这批') : t('跳过此书') }}
            </button>
            <button type="button" class="md-surface-text-button" :disabled="pendingDuplicate?.busy" @click="resolveImport(DUPLICATE_SKIP_ALL)">
              {{ t('全部跳过') }}
            </button>
          </template>
          <template v-else-if="surface === 'shelf'">
            <button v-if="shelfDialogDisplay?.kind === 'confirm' || shelfDialogDisplay?.folders" type="button" class="md-surface-text-button island-cancel-confirm" @click="resolveShelfDialog()">
              {{ t('取消') }}
            </button>
            <button v-if="shelfDialogDisplay?.kind === 'folder' && shelfDialogDisplay.folders?.length !== 0" type="button" class="md-surface-text-button" @click="resolveShelfDialog(false)">
              {{ t('直接导入') }}
            </button>
          </template>
          <template v-else-if="surface === 'update'">
            <button v-if="updates.updateStatus === 'available'" type="button" class="md-surface-text-button" @click="updates.closeUpdateDialog()">
              {{ t('稍后提醒') }}
            </button>
            <button v-if="updates.updateStatus === 'available'" type="button" class="md-surface-text-button" @click="updatePanelRef?.openDetails()">
              {{ t('查看详情') }}
            </button>
            <button v-if="updates.updateStatus === 'downloaded'" type="button" class="md-surface-text-button" @click="updates.closeUpdateDialog()">
              {{ t('稍后安装') }}
            </button>
          </template>
        </footer>
      </div>
    </Transition>

    <div class="island-trigger-row">
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

      <span
        class="island-trigger-spacer"
        :class="{ 'is-collapsed': !!surfaceKey }"
        :style="{ '--trigger-slot-width': `${triggerWidth}px` }"
        aria-hidden="true"
      ></span>
    </div>

    <!-- 导入胶囊、进度圆环和卡片主行动共用这颗按钮，卡片只让出右下角操作位。 -->
    <button
      id="homura-island-action"
      ref="importButtonRef"
      type="button"
      class="island-import-trigger"
      :class="{
        'is-ring': showProgressRing && !actionFaceShown,
        'is-failed': importProgress.status !== 'idle' && importProgress.hasFailures && !actionFaceShown,
        'is-card-position': !!surface && !surfaceSwapping,
        'is-card-primary': actionFaceShown && heldAction?.variant === 'primary',
        'is-card-tonal': actionFaceShown && heldAction?.variant === 'tonal',
        'is-card-danger': actionFaceShown && heldAction?.variant === 'danger',
        'is-returning': surfaceLeaving || surfaceSwapping,
        'is-docking': surfaceLeaving
      }"
      :style="{ width: `${buttonWidth}px` }"
      :title="buttonTitle"
      :aria-label="buttonLabel"
      :aria-haspopup="buttonHasPopup"
      :aria-expanded="buttonExpanded"
      :disabled="buttonDisabled"
      @click="onImportClick"
    >
      <span
        class="island-action-face"
        :class="{ 'is-visible': actionFaceShown }"
        aria-hidden="true"
      >
        <MdIcon v-if="heldAction?.icon" :name="heldAction.icon" />
        <span>{{ heldAction?.label || '' }}</span>
      </span>

      <span
        class="island-import-layer"
        :class="{ 'is-hidden': importProgress.status !== 'idle' || actionFaceShown }"
        aria-hidden="true"
      >
        <MdIcon name="upload_file" filled />
        <span>{{ t('导入') }}</span>
      </span>
      <span
        class="island-import-layer"
        :class="{ 'is-hidden': !showProgressRing || actionFaceShown }"
        aria-hidden="true"
      >
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
        <MdIcon
          v-if="importProgress.status === 'cancelled'"
          name="close"
          class="island-ring-icon"
        />
        <span v-else class="island-ring-number">{{ importProgress.done }}</span>
      </span>
      <span
        class="island-import-layer"
        :class="{ 'is-hidden': importProgress.status !== 'done' || actionFaceShown }"
        aria-hidden="true"
      >
        <MdIcon :name="importProgress.hasFailures ? 'warning' : 'check'" />
        <span>{{ importProgress.hasFailures ? t('有失败') : t('完成') }}</span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch
} from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { canPickFolder, isAndroid } from '../services/platform.ts';
import { useImportProgressStore } from '../stores/importProgress.ts';
import { useUpdateStore } from '../stores/updates.ts';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import { DUPLICATE_SKIP_ALL, useDuplicateImport } from '../composables/useDuplicateImport.ts';
import DuplicateImportContent from './DuplicateImportContent.vue';
import ShelfDialogContent from './ShelfDialogContent.vue';
import ImportProgressPanel from './ImportProgressPanel.vue';
import UpdateIslandPanel from './UpdateIslandPanel.vue';
import MdIcon from './MdIcon.vue';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  activeNav: { type: String, default: 'shelf' }
});
const emit = defineEmits(['create-collection', 'pick-files', 'pick-folder', 'retry-failed']);

const importProgress = useImportProgressStore();
const updates = useUpdateStore();
const { pendingShelfDialog, resolveShelfDialog } = useShelfDialogs();
const { pendingDuplicate, resolveImport } = useDuplicateImport();

const rootRef = shallowRef<HTMLElement | null>(null);
const surfaceRef = shallowRef<HTMLElement | null>(null);
const importPanelRef = shallowRef<InstanceType<typeof ImportProgressPanel> | null>(null);
const duplicateContentRef = shallowRef<InstanceType<typeof DuplicateImportContent> | null>(null);
const shelfContentRef = shallowRef<InstanceType<typeof ShelfDialogContent> | null>(null);
const updatePanelRef = shallowRef<InstanceType<typeof UpdateIslandPanel> | null>(null);
const importButtonRef = shallowRef<HTMLButtonElement | null>(null);
const updateButtonRef = shallowRef<HTMLButtonElement | null>(null);

const menuOpen = ref(false);
const lastTrigger = shallowRef<HTMLElement | null>(null);
const restoreFocusTarget = shallowRef<HTMLElement | null>(null);
type IslandAction = { label?: string; icon?: string; variant?: 'primary' | 'tonal' | 'danger'; disabled?: boolean; run?: () => void };
const heldAction = shallowRef<IslandAction | null>(null);
const actionFaceShown = ref(false);
const surfaceSwapping = ref(false);
const surfaceLeaving = ref(false);
const enterSeed = ref({ width: 104, right: 0, bottom: 0 });
const returnFocus = ref('import');
let autoDismissTimer = 0;
let actionFaceTimer = 0;

function setSurfaceRef(element: Element | ComponentPublicInstance | null) {
  // 两张卡片同时在 DOM 中时只跟随最新挂载的那张，旧卡片卸载不能清空引用。
  if (element instanceof HTMLElement) {
    surfaceRef.value = element;
    return;
  }
  if (surfaceRef.value && !surfaceRef.value.isConnected) {
    surfaceRef.value = null;
  }
}

const updatePending = computed(() => (
  updates.hasNewRelease
  || updates.hasPendingInstall
  || ['available', 'downloading', 'downloaded', 'download-error'].includes(updates.updateStatus)
));
const importSurfaceOpen = computed(() => (
  importProgress.status !== 'idle' && importProgress.expanded
));
const shelfDialogDisplay = computed(() => pendingShelfDialog.value);
const updateErrorForDisplay = computed(() => (updates.updateError ?? null) as Record<string, unknown> | null);
const downloadErrorForDisplay = computed(() => (updates.downloadError ?? null) as Record<string, unknown> | null);
const surface = computed(() => {
  if (pendingDuplicate.value) return 'duplicate';
  if (pendingShelfDialog.value) return 'shelf';
  if (menuOpen.value && importProgress.status === 'idle') return 'menu';
  if (importSurfaceOpen.value) return 'import';
  if (updates.updateDialogOpen) return 'update';
  return null;
});
const surfaceKey = computed(() => {
  if (surface.value === 'duplicate') return 'duplicate';
  if (surface.value === 'shelf') return `shelf-${shelfDialogDisplay.value?.kind || 'dialog'}`;
  if (surface.value === 'update') return `update-${updates.updateStatus}`;
  return surface.value;
});
const surfaceWidth = computed(() => (
  surface.value === 'menu' || surface.value === 'import' ? 384 : 416
));
const surfaceTitle = computed(() => {
  if (surface.value === 'menu') return t('添加内容');
  if (surface.value === 'shelf') return shelfDialogDisplay.value?.title || t('书库管理');
  if (surface.value === 'duplicate') return t('发现同名书本');
  if (surface.value === 'import') {
    if (importProgress.status === 'running') return t('正在导入');
    if (importProgress.status === 'cancelled') return t('导入已停止');
    return t('导入结果');
  }
  if (updates.updateStatus === 'downloading') return t('正在下载更新');
  if (updates.updateStatus === 'downloaded') return t('下载完成');
  if (updates.updateStatus === 'loading') return t('检查更新');
  return t('软件更新');
});
const showProgressRing = computed(() => (
  importProgress.status === 'running' || importProgress.status === 'cancelled'
));
const triggerWidth = computed(() => (showProgressRing.value ? 56 : 104));
const showUpdateOrb = computed(() => (
  updatePending.value
  && !surface.value
  && !importSurfaceOpen.value
));
const ringLength = 2 * Math.PI * 18;
const ringOffset = computed(() => ringLength * (1 - importProgress.percent / 100));
const updateOrbTitle = computed(() => (
  updates.hasPendingInstall
    ? t('更新已下载，打开安装')
    : updates.updateStatus === 'download-error'
      ? t('更新下载失败，打开重试')
      : updates.updateStatus === 'error'
        ? t('更新检查失败，打开重试')
        : t('有新版本可用')
));
const importButtonTitle = computed(() => {
  if (importProgress.status === 'idle') return t('导入作品');
  if (importProgress.status === 'running') return t('导入进度 {0} / {1}', { 0: importProgress.done, 1: importProgress.total });
  if (importProgress.status === 'cancelled') return t('导入已停止');
  return importProgress.hasFailures ? t('导入完成，有失败项') : t('导入完成');
});
const importButtonLabel = computed(() => {
  if (importProgress.status === 'idle') return t('导入作品');
  return `${importButtonTitle.value}，${importProgress.expanded ? t('收起进度详情') : t('展开进度详情')}`;
});
const menuPrimaryAction = computed(() => ({
  label: t('选择文件'),
  icon: 'upload_file',
  variant: 'primary',
  disabled: false
}));
const activeContent = computed(() => {
  if (surface.value === 'import') return importPanelRef.value;
  if (surface.value === 'duplicate') return duplicateContentRef.value;
  if (surface.value === 'shelf') return shelfContentRef.value;
  if (surface.value === 'update') return updatePanelRef.value;
  return null;
});
const activeAction = computed(() => {
  if (!surface.value) return null;
  if (surface.value === 'menu') return menuPrimaryAction.value;
  return activeContent.value?.primaryAction || null;
});
const buttonWidth = computed(() => {
  if (!surface.value || surfaceSwapping.value || !actionFaceShown.value || !heldAction.value) {
    return showProgressRing.value ? 56 : 104;
  }
  // 当前字号下中文字宽约 13.2px，用估算宽度让胶囊到卡片动作的尺寸过渡连续。
  const labelLength = [...String(heldAction.value.label || '')].length;
  const iconWidth = heldAction.value.icon ? 20 : 0;
  const iconGap = heldAction.value.icon ? 7 : 0;
  const actionWidth = Math.ceil(30 + iconWidth + iconGap + labelLength * 13.2);
  return Math.min(Math.floor(surfaceWidth.value * 0.58), Math.max(104, actionWidth));
});
const buttonTitle = computed(() => (
  actionFaceShown.value ? heldAction.value?.label || t('处理中') : importButtonTitle.value
));
const buttonLabel = computed(() => (
  actionFaceShown.value ? heldAction.value?.label || t('处理中') : importButtonLabel.value
));
const buttonHasPopup = computed(() => {
  if (actionFaceShown.value) return undefined;
  return 'dialog';
});
const buttonExpanded = computed(() => {
  if (actionFaceShown.value) return undefined;
  return importProgress.status === 'idle'
    ? surface.value === 'menu'
    : importProgress.expanded;
});
const buttonDisabled = computed(() => (
  actionFaceShown.value
  && !surfaceLeaving.value
  && !!heldAction.value?.disabled
));

function choose(action: 'pick-files' | 'pick-folder' | 'create-collection') {
  menuOpen.value = false;
  emit(action);
}

function openUpdate() {
  returnFocus.value = 'update';
  lastTrigger.value = updateButtonRef.value;
  updates.openUpdateDialog();
}

function onImportClick() {
  if (surface.value) {
    if (!surfaceLeaving.value && !surfaceSwapping.value) runActiveAction();
    return;
  }
  if (surfaceLeaving.value) return;
  returnFocus.value = 'import';
  lastTrigger.value = importButtonRef.value;
  if (importProgress.status === 'idle') {
    menuOpen.value = !menuOpen.value;
    return;
  }
  importProgress.toggleExpanded(!importProgress.expanded);
}

function runActiveAction() {
  if (surface.value === 'menu') {
    choose('pick-files');
    return;
  }
  if (activeAction.value?.disabled) return;
  activeContent.value?.runPrimaryAction?.();
}

function closeSurface() {
  if (surface.value === 'menu') menuOpen.value = false;
  else if (surface.value === 'duplicate') resolveImport();
  else if (surface.value === 'shelf') resolveShelfDialog();
  else if (surface.value === 'import') importProgress.toggleExpanded(false);
  else if (surface.value === 'update') void updates.closeUpdateDialog();
}

function closeImport() {
  importProgress.dismiss();
  nextTick(() => importButtonRef.value?.focus());
}

function clearActionFaceTimer() {
  window.clearTimeout(actionFaceTimer);
  actionFaceTimer = 0;
}

function releaseActionFace() {
  clearActionFaceTimer();
  if (surfaceKey.value) return;
  actionFaceShown.value = false;
  heldAction.value = null;
}

function syncActiveAction() {
  const action = activeAction.value;
  if (!action || !surface.value || surfaceSwapping.value) return;
  clearActionFaceTimer();
  heldAction.value = action as IslandAction | null;
  actionFaceShown.value = true;
}

function beginSurfaceSwap() {
  surfaceSwapping.value = true;
  clearActionFaceTimer();
  actionFaceShown.value = false;
  heldAction.value = null;
}

function scheduleActionFaceRelease() {
  clearActionFaceTimer();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    releaseActionFace();
    return;
  }
  actionFaceTimer = window.setTimeout(releaseActionFace, 140);
}

function onSurfaceLeaveCancelled() {
  clearActionFaceTimer();
  surfaceLeaving.value = false;
  surfaceSwapping.value = false;
  syncActiveAction();
}

function onSurfaceEnter() {
  if (!surfaceSwapping.value) return;
  surfaceSwapping.value = false;
  syncActiveAction();
}

function captureEnterSeed() {
  const button = importButtonRef.value;
  const width = button?.isConnected ? Math.round(button.offsetWidth) : triggerWidth.value;
  enterSeed.value = {
    width: width || triggerWidth.value,
    right: 0,
    bottom: 0
  };
}

function onSurfaceAfterLeave() {
  if (surfaceKey.value) return;
  clearActionFaceTimer();
  surfaceLeaving.value = false;
  surfaceSwapping.value = false;
  releaseActionFace();
  focusSurface(null);
}

function focusImportWhenReady(remaining = 5) {
  const trigger = importButtonRef.value;
  if (!trigger?.isConnected) return;
  if (!trigger.inert) {
    trigger.focus();
    return;
  }
  if (remaining <= 0 || surfaceKey.value) return;
  requestAnimationFrame(() => focusImportWhenReady(remaining - 1));
}

async function focusSurface(key: string | null) {
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
      focusImportWhenReady();
    } else if (lastTrigger.value?.isConnected) {
      lastTrigger.value.focus();
    } else if (updatePending.value) {
      updateButtonRef.value?.focus();
    } else {
      focusImportWhenReady();
    }
    restoreFocusTarget.value = null;
    return;
  }

  await nextTick();
  if (surface.value === 'duplicate') {
    surfaceRef.value?.querySelector<HTMLElement>('.island-skip-duplicate:not(:disabled)')?.focus();
    return;
  }
  if (surface.value === 'shelf') {
    const cancel = surfaceRef.value?.querySelector<HTMLElement>('.island-cancel-confirm');
    if (cancel) cancel.focus();
    else if (!await shelfContentRef.value?.focusInitial()) {
      surfaceRef.value?.querySelector<HTMLElement>('.md-drawer-header button')?.focus();
    }
    return;
  }
  if (surface.value === 'update') {
    const active = document.activeElement;
    const isTextEntry = active && (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      || (active as HTMLElement).isContentEditable
    );
    if (isTextEntry && !rootRef.value?.contains(active)) return;
    if (actionFaceShown.value && !heldAction.value?.disabled) {
      importButtonRef.value?.focus();
      return;
    }
    surfaceRef.value?.focus({ preventScroll: true });
    return;
  }
  if (surface.value === 'import') {
    if (actionFaceShown.value && !heldAction.value?.disabled) {
      importButtonRef.value?.focus();
      return;
    }
    surfaceRef.value?.focus({ preventScroll: true });
    return;
  }
  if (surface.value === 'menu') {
    surfaceRef.value?.querySelector<HTMLElement>('.island-menu-item')?.focus();
  }
}

function focusableElements(): HTMLElement[] {
  if (!surfaceRef.value) return [];
  const elements = Array.from(surfaceRef.value.querySelectorAll(
    'button:not(:disabled):not([hidden]), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )) as HTMLElement[];
  if (
    surface.value
    && !surfaceSwapping.value
    && importButtonRef.value
    && !importButtonRef.value.disabled
  ) {
    elements.push(importButtonRef.value);
  }
  return elements;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (pendingDuplicate.value) {
      event.preventDefault();
      resolveImport();
      return;
    }
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

function onDocumentPointerDown(event: PointerEvent) {
  if (rootRef.value?.contains(event.target as Node)) return;
  if (pendingDuplicate.value) {
    resolveImport();
    return;
  }
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
  () => pendingDuplicate.value,
  (pending, previous) => {
    if (pending && !previous) {
      const active = document.activeElement;
      restoreFocusTarget.value = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    if (pending && surface.value === 'duplicate') {
      nextTick(() => {
        if (pending === pendingDuplicate.value) surfaceRef.value?.querySelector<HTMLElement>('.island-skip-duplicate:not(:disabled)')?.focus();
      });
    }
  },
  { immediate: true }
);

watch(
  () => pendingShelfDialog.value,
  (pending, previous) => {
    if (pending && !previous) {
      const active = document.activeElement;
      restoreFocusTarget.value = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    if (pending && surface.value === 'shelf') {
      nextTick(() => {
        if (pending === pendingShelfDialog.value) void focusSurface(surfaceKey.value);
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
    if (active instanceof HTMLElement && active !== document.body && !rootRef.value?.contains(active)) {
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
    if (!importProgress.isAutoDismissable || importProgress.expanded) return;
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

watch(activeAction, value => {
  if (!value) return;
  syncActiveAction();
}, { immediate: true });

watch(surfaceKey, (key, previous) => {
  if (key) {
    clearActionFaceTimer();
    surfaceLeaving.value = false;
    if (previous && previous !== key) {
      beginSurfaceSwap();
      enterSeed.value = {
        width: importButtonRef.value?.offsetWidth || triggerWidth.value,
        right: 20,
        bottom: 20
      };
    } else {
      captureEnterSeed();
    }
    return;
  }
  if (!previous) return;
  surfaceRef.value?.style.setProperty('--trigger-width', `${triggerWidth.value}px`);
  surfaceSwapping.value = false;
  surfaceLeaving.value = true;
  scheduleActionFaceRelease();
}, { flush: 'sync' });

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.clearTimeout(autoDismissTimer);
  clearActionFaceTimer();
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.desktop-island {
  --island-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --island-morph-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --island-morph-duration: 480ms;
  display: flex;
  align-items: flex-end;
  min-height: 56px;
  transform-origin: 100% 100%;
}

.island-trigger-row {
  position: relative;
  z-index: 0;
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
}

.island-trigger-spacer {
  display: block;
  width: var(--trigger-slot-width, 104px);
  height: 56px;
  flex: none;
  transition: width var(--md-duration-medium) var(--md-ease-emphasized);
}

.island-trigger-spacer.is-collapsed {
  width: 0;
}

.island-update-orb,
.island-import-trigger {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 56px;
  padding: 0;
  overflow: hidden;
  border: 0;
  box-shadow:
    0 2px 4px -2px color-mix(in oklab, var(--md-shadow-color-soft) 28%, transparent),
    0 6px 16px -8px color-mix(in oklab, var(--md-shadow-color-soft) 38%, transparent);
  transition:
    width 420ms var(--island-morph-ease),
    right 420ms var(--island-morph-ease) 50ms,
    bottom 420ms var(--island-morph-ease) 50ms,
    border-radius 380ms var(--island-morph-ease),
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    color var(--md-duration-short) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform 180ms var(--md-ease-emphasized),
    box-shadow 220ms var(--md-ease-emphasized);
}

.island-update-orb {
  position: relative;
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
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 3;
  width: 104px;
  border-radius: 28px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  transform-origin: center;
}

.island-import-trigger.is-card-position {
  right: 20px;
  bottom: 20px;
}

.island-import-trigger.is-returning {
  transition-delay: 0s;
  pointer-events: none;
}

/* 真正关闭卡片时先快速归位到锚点，再让卡片裁切收进这颗按钮；
   卡片之间切换不套用这段更快的位移，避免按钮在切换首帧抖一下。 */
.island-import-trigger.is-docking {
  transition:
    right 180ms var(--island-morph-ease),
    bottom 180ms var(--island-morph-ease),
    width 180ms var(--island-morph-ease),
    border-radius 180ms var(--island-morph-ease),
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    color var(--md-duration-short) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform 180ms var(--md-ease-emphasized),
    box-shadow 180ms var(--md-ease-emphasized);
}

.island-import-trigger.is-ring {
  width: 56px;
  border-radius: 50%;
}

.island-import-trigger.is-failed {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.island-import-trigger.is-card-primary {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  box-shadow: none;
}

.island-import-trigger.is-card-tonal {
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
  box-shadow: none;
}

.island-import-trigger.is-card-danger {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
  box-shadow: none;
}

.island-import-trigger:disabled {
  opacity: 0.38;
  cursor: default;
}

.island-import-trigger:not(:disabled):active {
  transform: scale(0.96);
}

.island-action-face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  opacity: 0;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.25;
  pointer-events: none;
  transform: scale(0.9);
  transition:
    opacity var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-medium) var(--md-ease-emphasized);
}

.island-action-face.is-visible {
  opacity: 1;
  transform: none;
}

.island-action-face > span {
  min-width: 0;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.island-action-face :deep(svg) {
  width: 20px;
  height: 20px;
  flex: none;
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
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: var(--island-width);
  max-height: calc(100dvh - 52px);
  overflow: hidden;
  outline: none;
  clip-path: inset(-80px -80px -80px -80px round 28px);
  border-radius: 28px;
  background: color-mix(in oklab, var(--md-surface-container) 65%, var(--md-surface-low));
  color: var(--md-on-surface);
  box-shadow:
    0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color-soft) 28%, transparent),
    0 16px 42px -16px color-mix(in oklab, var(--md-shadow-color-soft) 45%, transparent);
  transform-origin: 100% 100%;
}

.desktop-island-surface.is-update {
  max-height: min(680px, calc(100dvh - 52px));
}

:global([data-mode="dark"] .desktop-island-surface) {
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--md-outline-variant) 60%, transparent),
    0 14px 38px -12px var(--md-shadow-color-soft);
}

.desktop-island-surface :deep(.md-drawer-header.is-prominent) {
  min-height: 76px;
  padding: 16px 20px 12px;
}

.desktop-island-surface :deep(.md-drawer-title) { overflow-wrap: anywhere; }
.island-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 20px 4px;
  scrollbar-width: thin;
}

.island-body :deep(.md-mobile-sheet-card) {
  margin-bottom: 10px;
  border-radius: 22px;
}

.island-body :deep(.md-mobile-sheet-card:last-child) { margin-bottom: 0; }
.island-body :deep(.md-mobile-sheet-label) { margin: 14px 14px 7px; }
.island-body :deep(.md-mobile-sheet-label:first-child) { margin-top: 3px; }
.island-body :deep(.md-mobile-sheet-row) {
  min-height: 62px;
  gap: 11px;
  padding: 10px 14px;
}
.island-body :deep(.md-mobile-sheet-row + .md-mobile-sheet-row::before) { inset-inline: 63px 14px; }
.island-body :deep(.md-mobile-sheet-icon) {
  width: 38px;
  height: 38px;
  flex-basis: 38px;
  border-radius: 13px;
}
.island-body :deep(.md-mobile-sheet-field) {
  height: 46px;
  border-radius: 13px;
  font-size: 14px;
}
.island-body :deep(button.md-mobile-sheet-row:focus-visible) {
  outline: 2px solid var(--md-primary);
  outline-offset: -3px;
}

.island-footer {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-content: center;
  align-items: center;
  min-height: 88px;
  padding: 12px calc(28px + var(--island-action-width)) 20px 20px;
}

.island-footer .md-surface-text-button {
  min-height: 44px;
  padding-inline: 9px;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.island-surface-enter-active {
  z-index: 2;
  transition:
    clip-path var(--island-morph-duration) var(--island-morph-ease),
    transform var(--island-morph-duration) var(--island-spring),
    filter 220ms ease;
  will-change: clip-path, transform, filter;
}

.island-surface-enter-active > * {
  animation: island-content-in 420ms var(--island-spring) 50ms both;
}

.island-surface-leave-active {
  transition:
    /* 先让按钮归位到右下角锚点，卡片再收进同一个矩形，避免错开 20px 露出角。 */
    clip-path 360ms var(--island-morph-ease) 180ms,
    box-shadow 220ms var(--md-ease-emphasized) 180ms,
    transform 240ms var(--md-ease-emphasized),
    filter 200ms ease 180ms;
  pointer-events: none;
  will-change: clip-path, filter;
}

.island-surface-leave-active > * {
  opacity: 0;
  transform: scale(0.97);
  filter: blur(3px);
  transition:
    opacity 150ms linear 140ms,
    transform 220ms var(--md-ease-emphasized),
    filter 180ms ease;
}

.island-surface-enter-from {
  /* 56 × 56 种子在 28px 圆角下已经是圆，不要过渡到 999px 把整张卡变成白球。 */
  border-radius: 28px;
  clip-path: inset(
    calc(100% - var(--enter-seed-bottom, 0px) - 56px)
    var(--enter-seed-right, 0px)
    var(--enter-seed-bottom, 0px)
    calc(
      100%
      - var(--enter-seed-right, 0px)
      - var(--enter-seed-width, var(--trigger-width, 104px))
    )
    round 28px
  );
  filter: blur(0.6px);
  transform: scale(0.985);
}

.island-surface-leave-to {
  border-radius: 28px;
  box-shadow: none;
  clip-path: inset(
    calc(100% - 56px)
    0
    0
    calc(100% - var(--trigger-width, 104px))
    round 28px
  );
  filter: blur(0.35px);
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
  .island-import-trigger:not(.is-card-primary):not(.is-card-tonal):not(.is-card-danger):hover,
  .island-update-orb:hover {
    box-shadow:
      0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color-soft) 30%, transparent),
      0 10px 24px -10px color-mix(in oklab, var(--md-shadow-color-soft) 42%, transparent);
  }

  .island-import-trigger:not(.is-failed):not(.is-card-primary):not(.is-card-tonal):not(.is-card-danger):hover {
    background: color-mix(in oklab, var(--md-primary-container) 92%, var(--md-on-primary-container));
  }

  .island-menu-item:hover {
    background: color-mix(in oklab, var(--md-primary-container) 46%, transparent);
  }
}

@keyframes island-update-turn {
  to { transform: rotate(360deg); }
}

@keyframes island-content-in {
  from {
    opacity: 0;
    filter: blur(5px);
    transform: translateY(6px) scale(0.93);
  }
  to {
    opacity: 1;
    filter: blur(0);
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-island,
  .island-update-orb,
  .island-import-trigger,
  .island-trigger-spacer,
  .island-action-face,
  .island-import-layer,
  .island-ring-value,
  .island-surface-enter-active,
  .island-surface-leave-active,
  .island-surface-enter-active > *,
  .island-surface-leave-active > *,
  .island-orb-enter-active,
  .island-orb-leave-active {
    transition: none;
    animation: none;
  }

  .island-update-orb.is-checking :deep(svg) {
    animation: none;
  }
}
</style>
