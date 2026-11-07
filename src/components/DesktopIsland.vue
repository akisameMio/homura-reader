<template>
  <div
    ref="rootRef"
    class="desktop-island md-fab-pos"
    :class="{ 'is-replacing': replaceSurface }"
  >
    <Transition
      name="island-surface"
      mode="out-in"
      @enter="syncSurfaceSeed"
      @before-leave="onSurfaceBeforeLeave"
      @after-leave="onSurfaceAfterLeave"
      @leave-cancelled="onSurfaceLeaveCancelled"
    >
      <div
        v-if="surfaceKey"
        :key="surfaceKey"
        ref="surfaceRef"
        class="desktop-island-surface"
        :class="surfaceClass"
        :style="{
          '--island-width': `${surfaceWidth}px`,
          '--seed-x': seedScale.x,
          '--seed-y': seedScale.y,
          '--seed-radius': seedScale.radius
        }"
        :role="surface === 'shelf'
          ? (pendingShelfDialog?.kind === 'confirm' ? 'alertdialog' : 'dialog')
          : ['duplicate', 'import', 'update'].includes(surface) ? 'dialog' : undefined"
        :aria-modal="surface === 'shelf' || surface === 'duplicate' ? 'true' : undefined"
        :aria-labelledby="surface === 'shelf'
          ? 'shelf-dialog-title'
          : surface === 'duplicate'
            ? 'duplicate-import-title'
            : surface === 'import'
              ? 'import-progress-title'
              : surface === 'update' ? 'update-island-title' : undefined"
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
            <button type="button" class="md-surface-action is-import" @click="choose('pick-files')">
              <MdIcon name="upload_file" />
              选择文件
            </button>
          </div>
        </div>

        <ImportProgressPanel
          v-else-if="surface === 'import'"
          ref="importPanelRef"
          @retry="$emit('retry-failed')"
          @close="closeImport"
        />

        <DuplicateImportContent
          v-else-if="surface === 'duplicate'"
          ref="duplicateContentRef"
          :pending="pendingDuplicate"
          @resolve="resolveImport"
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
          'is-collapsed': triggerCollapsed,
          'is-handoff': triggerHandoff
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
import { useDuplicateImport } from '../composables/useDuplicateImport.js';
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

const rootRef = shallowRef(null);
const surfaceRef = shallowRef(null);
const importPanelRef = shallowRef(null);
const duplicateContentRef = shallowRef(null);
const shelfContentRef = shallowRef(null);
const updatePanelRef = shallowRef(null);
const importButtonRef = shallowRef(null);
const updateButtonRef = shallowRef(null);

const menuOpen = ref(false);
const lastTrigger = shallowRef(null);
const restoreFocusTarget = shallowRef(null);
const actionGhost = shallowRef(null);
const hiddenAction = shallowRef(null);
const triggerHandoff = ref(false);
const triggerMorphing = ref(false);
const surfaceLeaving = ref(false);
const returnFocus = ref('import');
let autoDismissTimer = 0;
let actionGhostCleanupTimer = 0;

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
  if (surface.value === 'shelf') return `shelf-${pendingShelfDialog.value?.kind || 'dialog'}`;
  if (surface.value === 'update') return `update-${updates.updateStatus}`;
  return surface.value;
});
const surfaceWidth = computed(() => {
  if (surface.value === 'menu') return 348;
  if (surface.value === 'import') return 432;
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
const seedScale = computed(() => {
  const triggerWidth = importProgress.status === 'idle' ? 104 : 56;
  const width = surfaceWidth.value || triggerWidth;
  return {
    x: (triggerWidth / width).toFixed(4),
    y: '0.14',
    radius: importProgress.status === 'idle' ? '28px' : '999px'
  };
});
const replaceSurface = computed(() => !!surface.value);
const triggerCollapsed = computed(() => (
  replaceSurface.value || triggerMorphing.value || surfaceLeaving.value
));
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

function naturalTriggerRect() {
  const trigger = importButtonRef.value;
  if (!trigger) return null;
  const previousTransform = trigger.style.transform;
  const previousTransition = trigger.style.transition;
  trigger.style.transition = 'none';
  trigger.style.transform = 'none';
  const rect = trigger.getBoundingClientRect();
  trigger.style.transform = previousTransform;
  trigger.style.transition = previousTransition;
  return rect;
}

function clearActionGhost() {
  window.clearTimeout(actionGhostCleanupTimer);
  actionGhostCleanupTimer = 0;
  actionGhost.value?.remove();
  actionGhost.value = null;
  if (hiddenAction.value?.isConnected) hiddenAction.value.style.visibility = '';
  hiddenAction.value = null;
}

function onSurfaceLeaveCancelled() {
  clearActionGhost();
  triggerMorphing.value = false;
  surfaceLeaving.value = false;
}

function onSurfaceBeforeLeave(element) {
  syncSurfaceSeed(element);
  clearActionGhost();
  if (surface.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  startActionHandoff(element);
}

function onSurfaceAfterLeave() {
  surfaceLeaving.value = false;
  hiddenAction.value = null;
  if (!surfaceKey.value) focusSurface(null);
  if (!actionGhost.value) {
    triggerMorphing.value = false;
    return;
  }
  triggerHandoff.value = true;
  triggerMorphing.value = false;
  const ghost = actionGhost.value;
  actionGhost.value = null;
  requestAnimationFrame(() => {
    ghost.remove();
    actionGhostCleanupTimer = window.setTimeout(() => {
      triggerHandoff.value = false;
      actionGhostCleanupTimer = 0;
    }, 80);
  });
}

function startActionHandoff(element) {
  const action = element?.querySelector('.md-surface-action');
  const trigger = importButtonRef.value;
  if (!action || !trigger || !rootRef.value) return;
  const actionRect = action.getBoundingClientRect();
  const triggerRect = naturalTriggerRect();
  if (!triggerRect || !actionRect.width || !actionRect.height) return;

  const scaleX = triggerRect.width / actionRect.width;
  const scaleY = triggerRect.height / actionRect.height;
  const shiftX = triggerRect.right - actionRect.right;
  const shiftY = triggerRect.bottom - actionRect.bottom;
  const actionStyle = getComputedStyle(action);
  const triggerStyle = getComputedStyle(trigger);
  const ghost = action.cloneNode(true);
  ghost.classList.add('island-action-handoff');
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.tabIndex = -1;
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${actionRect.left}px`,
    top: `${actionRect.top}px`,
    width: `${actionRect.width}px`,
    height: `${actionRect.height}px`,
    margin: '0',
    padding: actionStyle.padding,
    gap: actionStyle.gap,
    zIndex: '2',
    pointerEvents: 'none',
    transformOrigin: '100% 100%'
  });

  const original = document.createElement('span');
  original.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `gap:${actionStyle.gap}`,
    'white-space:nowrap'
  ].join(';');
  while (ghost.firstChild) original.appendChild(ghost.firstChild);
  ghost.appendChild(original);

  const triggerLayer = trigger.querySelector('.island-import-layer:not(.is-hidden)');
  const face = triggerLayer
    ? triggerLayer.cloneNode(true)
    : document.createElement('span');
  face.classList.add('island-action-handoff-face');
  face.style.transformOrigin = 'center';
  face.style.transform = `scale(${1 / scaleX}, ${1 / scaleY})`;
  ghost.appendChild(face);

  rootRef.value.appendChild(ghost);
  action.style.visibility = 'hidden';
  hiddenAction.value = action;
  actionGhost.value = ghost;
  triggerMorphing.value = true;

  const timing = {
    duration: 280,
    delay: 80,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    fill: 'both'
  };
  ghost.animate([
    {
      transform: 'translate(0px, 0px) scale(1, 1)',
      backgroundColor: actionStyle.backgroundColor,
      color: actionStyle.color,
      borderRadius: actionStyle.borderRadius,
      boxShadow: actionStyle.boxShadow
    },
    {
      transform: `translate(${shiftX}px, ${shiftY}px) scale(${scaleX}, ${scaleY})`,
      backgroundColor: triggerStyle.backgroundColor,
      color: triggerStyle.color,
      borderRadius: triggerStyle.borderRadius,
      boxShadow: triggerStyle.boxShadow
    }
  ], timing);
  original.animate([
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: 0.46 },
    { opacity: 0, offset: 0.62 },
    { opacity: 0, offset: 1 }
  ], { ...timing, easing: 'linear' });
  face.animate([
    { opacity: 0, offset: 0 },
    { opacity: 0, offset: 0.54 },
    { opacity: 1, offset: 0.72 },
    { opacity: 1, offset: 1 }
  ], { ...timing, easing: 'linear' });
}

function syncSurfaceSeed(element) {
  if (!element?.isConnected) return;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (!width || !height) return;
  const triggerWidth = importProgress.status === 'idle' ? 104 : 56;
  element.style.setProperty('--seed-x', (triggerWidth / width).toFixed(4));
  element.style.setProperty('--seed-y', (56 / height).toFixed(4));
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
      || active.isContentEditable
    );
    if (isTextEntry && !rootRef.value?.contains(active)) return;
    updatePanelRef.value?.focusInitial();
    return;
  }
  if (surface.value === 'import') {
    importPanelRef.value?.focusInitial();
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

watch(surfaceKey, key => {
  surfaceLeaving.value = !key;
}, { flush: 'sync' });

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.clearTimeout(autoDismissTimer);
  clearActionGhost();
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.desktop-island {
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

.island-import-trigger:not(.is-collapsed) {
  transition-delay: 0s, 0s, 0s, 250ms, 0s, 0s;
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
  opacity: 0;
  transform: scale(0.9);
  transition-delay: 0s;
  pointer-events: none;
}

.island-import-trigger.is-handoff {
  opacity: 1;
  transform: none;
  transition: none;
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

.desktop-island-surface.is-duplicate {
  overflow: hidden;
}

.desktop-island-surface :deep(.md-surface-action) {
  gap: 7px;
  padding: 0 13px;
  border-radius: 28px;
  font-weight: 650;
  box-shadow: none;
  transition:
    background-color var(--md-duration-short) var(--md-ease-emphasized),
    color var(--md-duration-short) var(--md-ease-emphasized),
    transform var(--md-duration-short) var(--md-ease-emphasized),
    box-shadow var(--md-duration-short) var(--md-ease-emphasized);
}

.desktop-island-surface :deep(.md-surface-action > svg) {
  width: 20px;
  height: 20px;
}

.desktop-island-surface :deep(.md-surface-action.is-primary) {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.desktop-island-surface :deep(.md-surface-action.is-danger) {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

@media (hover: hover) and (pointer: fine) {
  .desktop-island-surface :deep(.md-surface-action.is-primary:hover:not(:disabled)) {
    background: color-mix(in oklab, var(--md-primary-container) 92%, var(--md-on-primary-container));
  }

  .desktop-island-surface :deep(.md-surface-action.is-danger:hover:not(:disabled)) {
    background: color-mix(in oklab, var(--md-error-container) 92%, var(--md-on-error-container));
  }
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

.island-menu > .md-surface-actionbar .md-surface-action {
  margin-left: auto;
}

.island-surface-enter-active {
  transition:
    transform 320ms var(--md-ease-emphasized),
    border-radius 320ms var(--md-ease-emphasized),
    opacity 160ms linear;
  will-change: transform, opacity;
}

.island-surface-enter-active > * {
  animation: island-content-in 180ms var(--md-ease-emphasized) 80ms both;
}

.island-surface-leave-active {
  transition:
    clip-path 280ms var(--md-ease-emphasized) 80ms,
    transform 160ms var(--md-ease-emphasized),
    border-radius 280ms var(--md-ease-emphasized) 80ms,
    opacity 100ms linear 260ms;
  pointer-events: none;
  will-change: clip-path, opacity;
}

.island-surface-leave-active > * {
  opacity: 0;
  transition: opacity 140ms linear 160ms;
}

.island-surface-enter-from {
  border-radius: var(--seed-radius, 28px);
  opacity: 0.72;
  transform: scale(var(--seed-x, 0.24), var(--seed-y, 0.14));
}

.island-surface-leave-to {
  border-radius: var(--seed-radius, 28px);
  clip-path: inset(
    calc(100% - 56px)
    0
    0
    calc(100% - 104px)
    round var(--seed-radius, 28px)
  );
  opacity: 0.62;
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

@keyframes island-content-in {
  from {
    opacity: 0;
    transform: translateY(9px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-island,
  .island-update-orb,
  .island-import-trigger,
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
