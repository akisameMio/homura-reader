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
        :class="surfaceClass"
        :style="{
          '--island-width': `${surfaceWidth}px`,
          '--trigger-width': `${triggerWidth}px`,
          '--enter-seed-width': `${enterSeed.width}px`,
          '--enter-seed-right': `${enterSeed.right}px`,
          '--enter-seed-bottom': `${enterSeed.bottom}px`
        }"
        :role="surface === 'shelf'
          ? ((pendingShelfDialog as any)?.kind === 'confirm' ? 'alertdialog' : 'dialog')
          : ['duplicate', 'import', 'update'].includes(surface as string) ? 'dialog' : undefined"
        :aria-modal="surface === 'shelf' || surface === 'duplicate' ? 'true' : undefined"
        :aria-labelledby="surface === 'shelf'
          ? 'shelf-dialog-title'
          : surface === 'duplicate'
            ? 'duplicate-import-title'
            : surface === 'import'
              ? 'import-progress-title'
              : surface === 'update' ? 'update-island-title' : undefined"
        :aria-owns="surfaceKey ? 'homura-island-action' : undefined"
      >
        <div v-if="surface === 'menu'" class="island-menu" role="menu" aria-label="导入与书库">
          <header class="island-card-head">
            <p class="md-surface-kicker">导入作品</p>
            <h2 class="md-surface-title">添加内容</h2>
          </header>
          <div class="island-menu-list">
            <button type="button" role="menuitem" class="island-menu-item is-selected" @click="choose('pick-files')">
              <span class="island-menu-icon"><MdIcon name="upload_file" /></span>
              <span class="island-menu-copy"><b>导入文件</b><small>EPUB / PDF / MOBI / TXT</small></span>
              <span class="island-menu-check" aria-hidden="true"><MdIcon name="check" /></span>
            </button>
            <button v-if="canPickFolder" type="button" role="menuitem" class="island-menu-item" @click="choose('pick-folder')">
              <span class="island-menu-icon"><MdIcon name="folder_open" /></span>
              <span class="island-menu-copy"><b>导入文件夹</b><small>图片目录会合并成一本漫画</small></span>
              <span class="island-menu-check is-empty" aria-hidden="true"></span>
            </button>
            <div class="island-menu-divider" aria-hidden="true"></div>
            <button type="button" role="menuitem" class="island-menu-item" @click="choose('create-collection')">
              <span class="island-menu-icon is-plain"><MdIcon name="create_new_folder" /></span>
              <span class="island-menu-copy"><b>新建书库</b><small>先建一个书库，再放入作品</small></span>
              <span class="island-menu-check is-empty" aria-hidden="true"></span>
            </button>
          </div>
          <div class="md-surface-actionbar">
            <div class="md-surface-aux">
              <button type="button" class="md-surface-text-button" @click="menuOpen = false">取消</button>
            </div>
          </div>
        </div>

        <ImportProgressPanel
          v-else-if="surface === 'import'"
          ref="importPanelRef"
          host-primary-action
          @retry="$emit('retry-failed')"
          @close="closeImport"
        />

        <DuplicateImportContent
          v-else-if="surface === 'duplicate'"
          ref="duplicateContentRef"
          host-primary-action
          :pending="pendingDuplicate"
          @resolve="resolveImport"
        />

        <ShelfDialogContent
          v-else-if="surface === 'shelf'"
          ref="shelfContentRef"
          host-primary-action
          :request="(pendingShelfDialog as any)"
          @resolve="resolveShelfDialog"
        />

        <UpdateIslandPanel
          v-else-if="surface === 'update'"
          ref="updatePanelRef"
          host-primary-action
          :status="updates.updateStatus"
          :release="(updates.latestRelease as any)"
          :current-version="updates.appVersion"
          :package-info="updates.updatePackage"
          :error="(updates.updateError as any)"
          :download="updates.downloadState"
          :download-error="(updates.downloadError as any)"
          @close="updates.closeUpdateDialog"
          @retry="updates.checkForUpdates"
          @changelog="updates.openChangelog"
          @download="updates.startUpdateDownload"
          @cancel-download="updates.cancelCurrentDownload"
          @install="updates.installDownloadedUpdate"
        />
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
        <span>导入</span>
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
        <span>{{ importProgress.hasFailures ? '有失败' : '完成' }}</span>
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
import { canPickFolder } from '../services/platform.ts';
import { useImportProgressStore } from '../stores/importProgress.ts';
import { useUpdateStore } from '../stores/updates.ts';
import { useShelfDialogs } from '../composables/useShelfDialogs.ts';
import { useDuplicateImport } from '../composables/useDuplicateImport.ts';
import DuplicateImportContent from './DuplicateImportContent.vue';
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
const { pendingDuplicate, resolveImport } = useDuplicateImport();

const rootRef = shallowRef<any>(null);
const surfaceRef = shallowRef<any>(null);
const importPanelRef = shallowRef<any>(null);
const duplicateContentRef = shallowRef<any>(null);
const shelfContentRef = shallowRef<any>(null);
const updatePanelRef = shallowRef<any>(null);
const importButtonRef = shallowRef<any>(null);
const updateButtonRef = shallowRef<any>(null);

const menuOpen = ref(false);
const lastTrigger = shallowRef<any>(null);
const restoreFocusTarget = shallowRef<any>(null);
const heldAction = shallowRef<any>(null);
const actionFaceShown = ref(false);
const surfaceSwapping = ref(false);
const surfaceLeaving = ref(false);
const enterSeed = ref({ width: 104, right: 0, bottom: 0 });
const returnFocus = ref('import');
let autoDismissTimer = 0;
let actionFaceTimer = 0;

function setSurfaceRef(element) {
  // 两张卡片同时在 DOM 中时只跟随最新挂载的那张，旧卡片卸载不能清空引用。
  if (element) {
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
  if (surface.value === 'shelf') return `shelf-${(pendingShelfDialog.value as any)?.kind || 'dialog'}`;
  if (surface.value === 'update') return `update-${updates.updateStatus}`;
  return surface.value;
});
const surfaceWidth = computed(() => {
  if (surface.value === 'menu') return 348;
  if (surface.value === 'import') return 348;
  if (surface.value === 'duplicate') return 432;
  if (surface.value === 'shelf') {
    return 432;
  }
  if (surface.value === 'update') return 448;
  return 0;
});
const surfaceClass = computed(() => ({
  'is-menu': surface.value === 'menu',
  'is-import': surface.value === 'import',
  'is-duplicate': surface.value === 'duplicate',
  'is-shelf': surface.value === 'shelf',
  'is-update': surface.value === 'update'
}));
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
const menuPrimaryAction = Object.freeze({
  label: '选择文件',
  icon: 'upload_file',
  variant: 'primary',
  disabled: false
});
const activeContent = computed(() => {
  if (surface.value === 'import') return importPanelRef.value;
  if (surface.value === 'duplicate') return duplicateContentRef.value;
  if (surface.value === 'shelf') return shelfContentRef.value;
  if (surface.value === 'update') return updatePanelRef.value;
  return null;
});
const activeAction = computed(() => {
  if (!surface.value) return null;
  if (surface.value === 'menu') return menuPrimaryAction;
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
  return Math.max(104, Math.ceil(26 + iconWidth + iconGap + labelLength * 13.2));
});
const buttonTitle = computed(() => (
  actionFaceShown.value ? heldAction.value?.label || '处理中' : importButtonTitle.value
));
const buttonLabel = computed(() => (
  actionFaceShown.value ? heldAction.value?.label || '处理中' : importButtonLabel.value
));
const buttonHasPopup = computed(() => {
  if (actionFaceShown.value) return undefined;
  return importProgress.status === 'idle' ? 'menu' : 'dialog';
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
  heldAction.value = action;
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
    duplicateContentRef.value?.focusInitial();
    return;
  }
  if (surface.value === 'shelf') {
    shelfContentRef.value?.focusInitial();
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
    updatePanelRef.value?.focusInitial();
    return;
  }
  if (surface.value === 'import') {
    if (actionFaceShown.value && !heldAction.value?.disabled) {
      importButtonRef.value?.focus();
      return;
    }
    importPanelRef.value?.focusInitial();
    return;
  }
  if (surface.value === 'menu') {
    surfaceRef.value?.querySelector('.island-menu-item')?.focus();
  }
}

function focusableElements(): HTMLElement[] {
  if (!surfaceRef.value) return [];
  const elements = Array.from(surfaceRef.value.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
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

function onKeydown(event) {
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

function onDocumentPointerDown(event) {
  if (rootRef.value?.contains(event.target)) return;
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
      restoreFocusTarget.value = active && active !== document.body ? active : null;
    }
    if (pending && surface.value === 'duplicate') {
      nextTick(() => {
        if (pending === pendingDuplicate.value) duplicateContentRef.value?.focusInitial();
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
  white-space: nowrap;
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
  width: var(--island-width);
  max-height: calc(100dvh - 112px);
  overflow: hidden;
  clip-path: inset(-80px -80px -80px -80px round 28px);
  border-radius: 28px;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
  box-shadow:
    0 2px 6px -2px color-mix(in oklab, var(--md-shadow-color-soft) 28%, transparent),
    0 18px 48px -18px color-mix(in oklab, var(--md-shadow-color-soft) 48%, transparent);
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

.desktop-island-surface.is-duplicate {
  overflow: hidden;
}

.desktop-island-surface :deep(.md-surface-actionbar) {
  min-height: 56px;
}

.island-menu {
  display: flex;
  min-height: 372px;
  flex-direction: column;
  padding: 20px 20px 92px;
}

.island-card-head {
  flex: none;
}

.island-menu-list {
  display: grid;
  gap: 4px;
  margin-top: 18px;
}

.island-menu-item {
  display: flex;
  width: 100%;
  min-height: 68px;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 10px;
  border-radius: 18px;
  color: var(--md-on-surface);
  text-align: left;
  transition:
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-short) var(--md-ease-emphasized);
}

.island-menu-item.is-selected {
  background: color-mix(in oklab, var(--md-primary-container) 48%, var(--md-surface-low));
}

.island-menu-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.island-menu-icon.is-plain {
  background: var(--md-surface-high);
  color: var(--md-on-surface);
}

.island-menu-icon :deep(svg) {
  width: 21px;
  height: 21px;
}

.island-menu-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.island-menu-copy b {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-menu-copy small {
  overflow: hidden;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.island-menu-check {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.island-menu-check.is-empty {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--md-outline) 48%, transparent);
}

.island-menu-check :deep(svg) {
  width: 14px;
  height: 14px;
}

.island-menu-divider {
  height: 0.5px;
  margin: 7px 12px;
  background: color-mix(in oklab, var(--md-outline-variant) 75%, transparent);
}

.island-menu > .md-surface-actionbar {
  position: absolute;
  right: 20px;
  bottom: 20px;
  left: 20px;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
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
