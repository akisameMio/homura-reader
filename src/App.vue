<template>
  <!-- 手机底栏挂在阅读器预见式返回的 transform 容器外，避免长书架把 fixed 底栏带出视口 -->
  <div id="homura-mobile-nav-root" :inert="readerOpening || !!reader.currentBook"></div>

  <div
    class="library-back-layer flex min-h-0"
    :class="{
      'is-under-reader': !!reader.currentBook,
      'has-contained-shelf-scroll': containedShelfScroll,
      'flex-1': !containedShelfScroll
    }"
    :inert="readerOpening || !!reader.currentBook"
    @wheel="onLibraryWheel"
  >
    <SideNav v-if="!isCompact || !settingsDetailOpen" :active="activeNav" @nav="onRailNav" />

    <div
      class="library-main-column relative isolate flex-1 min-w-0 flex flex-col"
      :class="[
        isCompact && activeNav === 'settings' ? ['is-settings', !settingsDetailOpen ? 'md-bottom-nav-space' : ''] : ''
      ]"
      data-app-scroll
    >
      <template v-if="activeNav === 'settings'">
        <SettingsView ref="settingsViewRef" @detail-change="settingsDetailOpen = $event">
          <template #status>
            <ImportStatusBar v-if="isCompact" @retry="retryFailedImport" />
          </template>
        </SettingsView>
      </template>
      <template v-else>
        <LibraryHeader
          :count="headerCount"
          :title="headerTitle"
          :scroll-root="activeNav === 'shelf' ? libraryScrollRef : null"
          :contained-scroll="containedShelfScroll"
          :appearance-open="appearanceOpen"
          :renamable="!!activeCollection"
          @toggle-appearance="appearanceOpen = !appearanceOpen"
          @rename="renameActiveCollection"
          v-model:query="query"
          v-model:type="typeFilter"
          v-model:sort="sortKey"
          v-model:filter-open="shelfFilterOpen"
        >
          <template v-if="isCompact" #actions>
            <LibraryImportActions
              compact
              v-model:open="importMenuOpen"
            />
          </template>
        </LibraryHeader>

        <ImportStatusBar v-if="isCompact" @retry="retryFailedImport" />

        <main
          ref="libraryScrollRef"
          class="library-scroll relative isolate flex-1 w-full flex flex-col min-[900px]:pb-40"
          :class="{ 'md-bottom-nav-space': isCompact }"
          :aria-busy="importProgress.isRunning"
          data-app-scroll
        >
          <p v-if="shelf.error || (!reader.currentBook && reader.openError)" role="alert" class="mx-4 min-[900px]:mx-7 mt-3 text-[13px] text-[var(--md-error)]">{{ t(shelf.error || reader.openError) }}</p>
          <BookShelf v-if="favoritesOnly || shelf.library.length || shelf.collections.length || shelfImportActive" :books="visibleBooks" :favorites-only="favoritesOnly" :sort-key="sortKey" :query="query" :has-filter="!!query.trim() || typeFilter !== 'all'" :home-request="shelfHomeRequest" :importing="shelfImportActive" :pending-import-count="shelfImportActive ? importProgress.pending : 0" @open="openBookWithTransition" @manage-storage="manageBookStorage" @browse="query = ''; typeFilter = 'all'" />
          <EmptyShelf v-else @pick-file="openFilePicker" @pick-folder="openFolderPicker" />
        </main>
        <ShelfBackdrop v-if="activeNav === 'shelf'" />
      </template>
    </div>
  </div>

  <DesktopIsland
    v-if="desktopIslandVisible"
    :inert="readerOpening || !!reader.currentBook"
    :active-nav="activeNav"
    v-model:menu-open="importMenuOpen"
    v-model:import-in-place="importInPlace"
    @back-to-import-menu="backToImportMenu"
    @create-collection="createCollection"
    @pick-files="pickFiles"
    @pick-folder="openFolderPicker"
    @retry-failed="retryFailedImport"
  />

  <input ref="fileInput" type="file" multiple :accept="fileAccept" class="hidden" @change="onFileChange" />
  <input v-if="canPickFolder && !isAndroid" ref="folderInput" type="file" webkitdirectory directory multiple class="hidden" @change="onFileChange" />

  <AppearanceSheet v-model:open="appearanceOpen" />
  <ImportProgressSheet v-if="isCompact" @retry="retryFailedImport" />
  <DragOverlay :suppressed="readerOpening" />
  <ReaderLoadingPage
    ref="readerLoadingRef"
    :visible="readerPhase === 'loading'"
    :reveal="readerPhase === 'reveal'"
    :rendering="!!reader.currentBook"
    :phase="readerLoadingPhase"
    :title="readerLoadingBook?.title || ''"
    :cover="readerLoadingBook?.cover || ''"
    :message="relinkError || readerLoadingError || t('无法加载这本书，请重试。')"
    :can-relink="canUseNativeImport() && !readerLoadingBook?.remote && !relinking"
    @retry="retryReaderOpen"
    @relink="relinkReaderBook"
    @cancel="cancelReaderOpen"
    @revealed="finishReaderReveal"
  />
  <div v-if="reader.currentBook" class="reader-back-scrim md-scrim" aria-hidden="true"></div>
  <ReaderModal :opening="readerOpening" @first-frame="onReaderFirstFrame" @cancel-opening="cancelReaderOpen" />
  <UpdateDialog
    v-if="isCompact"
    :open="updates.updateDialogOpen"
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
  <ChangelogSheet
    :open="updates.changelogOpen"
    :compact="isCompact"
    :status="updates.changelogStatus"
    :releases="updates.releases"
    :current-version="updates.appVersion"
    :error="updates.changelogError"
    @close="updates.closeChangelog"
    @retry="updates.loadChangelog(true)"
  />
  <DuplicateImportSheet v-if="isCompact" />
  <ShelfDialogSheet
    v-if="isCompact"
    v-model:menu-open="importMenuOpen"
    v-model:import-in-place="importInPlace"
    @back-to-import-menu="backToImportMenu"
    @create-collection="createCollection"
    @pick-files="pickFiles"
    @pick-folder="openFolderPicker"
  />

  <!-- Offscreen Measurer for Smart Novel Screen-Fit Pagination -->
  <div ref="measurerRef" id="novelPaginationMeasurer" class="fixed -left-[9999px] top-0 pointer-events-none invisible z-[-1] epub-content md-reader-prose"></div>
</template>

<script setup>
import { ref, shallowRef, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useThemeStore } from './stores/theme.ts';
import { useShelfStore } from './stores/shelf.ts';
import { useReaderStore } from './stores/reader.ts';
import { useSettingsStore } from './stores/settings.ts';
import { useUiStore } from './stores/ui.ts';
import { useUpdateStore } from './stores/updates.ts';
import { useImportProgressStore } from './stores/importProgress.ts';
import { fileAccept, canPickFolder, hasFileSystemAccess, isAndroid, isMacOSTauri } from './services/platform.ts';
import {
  canUseNativeImport,
  isNativeImportCancelled,
  shouldFallbackNativeImport
} from './services/nativeImport.ts';
import { resolveBookFormat, scrollAppToTop } from './services/utils.ts';
import { sortShelfBooks } from './services/bookTitles.ts';
import { bookShelfCategory, shelfFormatFilters } from './services/shelfSections.ts';
import { installProgressFlushHooks } from './services/progress.ts';
import { useSyncStore } from './stores/sync.ts';
import { useImporter } from './composables/useImporter.ts';
import { useDuplicateImport } from './composables/useDuplicateImport.ts';
import { useShelfDialogs } from './composables/useShelfDialogs.ts';
import { collectionNameError, availableCollectionName } from './services/collections.ts';
import { useViewport } from './composables/useViewport.ts';
import { useAndroidBackExit } from './composables/useAndroidBackExit.ts';
import { useScrollBounce } from './composables/useScrollBounce.ts';
import SideNav from './components/SideNav.vue';
import LibraryHeader from './components/LibraryHeader.vue';
import LibraryImportActions from './components/LibraryImportActions.vue';
import ImportProgressSheet from './components/ImportProgressSheet.vue';
import DesktopIsland from './components/DesktopIsland.vue';
import ImportStatusBar from './components/ImportStatusBar.vue';
import AppearanceSheet from './components/AppearanceSheet.vue';
import BookShelf from './components/BookShelf.vue';
import ShelfBackdrop from './components/ShelfBackdrop.vue';
import EmptyShelf from './components/EmptyShelf.vue';
import SettingsView from './components/SettingsView.vue';
import DragOverlay from './components/DragOverlay.vue';
import ReaderModal from './components/ReaderModal.vue';
import ReaderLoadingPage from './components/ReaderLoadingPage.vue';
import UpdateDialog from './components/UpdateDialog.vue';
import ChangelogSheet from './components/ChangelogSheet.vue';
import DuplicateImportSheet from './components/DuplicateImportSheet.vue';
import ShelfDialogSheet from './components/ShelfDialogSheet.vue';
import { useI18n } from './composables/useI18n.ts';
import { keepSmartArchive, relinkBookSource } from './services/bookStorage.ts';
import { scheduleSmartStorage } from './services/smartStorageRuntime.ts';

const { t } = useI18n();

const theme = useThemeStore();
const shelf = useShelfStore();
const reader = useReaderStore();
const settings = useSettingsStore();
const ui = useUiStore();
const updates = useUpdateStore();
const importProgress = useImportProgressStore();
const importer = useImporter();
const { pendingDuplicate, resolveImport } = useDuplicateImport();
const { pendingShelfDialog, askShelfDialog, resolveShelfDialog } = useShelfDialogs();
const { isCompact } = useViewport();

const measurerRef = ref(null);
const libraryScrollRef = shallowRef(null);
const fileInput = ref(null);
const folderInput = ref(null);
const importMenuOpen = ref(false);
const importInPlace = ref(true);
const importMode = computed(() => importInPlace.value ? 'reference' : 'copy');
const appearanceOpen = ref(false);
const shelfFilterOpen = ref(false);
const activeNav = ref('shelf');
const containedShelfScroll = computed(() => isMacOSTauri && !isCompact.value && activeNav.value !== 'settings');
const settingsViewRef = shallowRef(null);

// macOS 桌面把书架滚动收进内容区后，侧栏与顶栏不再有可滚动祖先；
// 指针停在这两处时把竖向滚轮转给书架，避免出现滚不动的死区。
function onLibraryWheel(event) {
  if (!containedShelfScroll.value || event.ctrlKey) return;
  if (!event.deltaY || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const scroller = libraryScrollRef.value;
  const target = event.target;
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return;
  if (!(target instanceof Element) || target.closest('.library-scroll')) return;
  const sidebar = target.closest('.sidenav');
  if (sidebar && sidebar.scrollHeight > sidebar.clientHeight + 1) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
  scroller.scrollTop += event.deltaY * unit;
}
const settingsDetailOpen = ref(false);

useScrollBounce(libraryScrollRef);

// 遮罩挂载后才打开书籍，等封面落位和首屏渲染都结束后再揭幕。
const readerPhase = ref('shelf');
const readerOpening = computed(() => readerPhase.value === 'loading' || readerPhase.value === 'reveal');
const readerLoadingRef = shallowRef(null);
const readerLoadingBook = shallowRef(null);
const readerLoadingError = ref('');
const readerLoadingPhase = computed(() => readerLoadingError.value ? 'error' : 'loading');
const READER_OPEN_TIMEOUT = 15000;
let loadingGuardTimer;
let readerOpenRequest = 0;
let readerFirstFrameReady = false;
let readerFlightComplete = false;

function bookById(id) { return shelf.library.find(item => item.id === id) || null; }

const relinkError = ref('');
const relinking = ref(false);

async function relinkReaderBook() {
  const book = readerLoadingBook.value;
  if (!book || relinking.value || importProgress.isRunning || nativeImportPending) return;
  relinkError.value = '';
  relinking.value = true;
  nativeImportPending = true;
  try {
    if (await relinkBookSource(book) && readerLoadingBook.value === book) await retryReaderOpen();
  } catch (err) {
    if (!isNativeImportCancelled(err)) relinkError.value = t('无法重新定位：{0}', { 0: err?.message || t('请检查本地存档') });
  } finally {
    relinking.value = false;
    nativeImportPending = false;
  }
}

async function manageBookStorage(id) {
  const book = bookById(id);
  if (!book || book.remote || importProgress.isRunning || nativeImportPending) return;
  const action = await askShelfDialog({
    kind: 'move',
    title: t('书籍存储'),
    message: book.title,
    options: [
      { value: 'relink', title: t('重新定位原文件') },
      { value: 'keep', title: t('保留自动存档到 HOMURA') }
    ]
  });
  if (!action || nativeImportPending) return;
  nativeImportPending = true;
  try {
    if (action === 'relink') await relinkBookSource(book);
    else if (!await keepSmartArchive(book)) shelf.error = t('这本书还没有自动生成的阅读存档。');
    shelf.touchBook(book);
  } catch (err) {
    if (!isNativeImportCancelled(err)) shelf.error = t('无法更新书籍存储：{0}', { 0: err?.message || t('请检查本地存档') });
  } finally {
    nativeImportPending = false;
  }
}

function clearLoadingGuard() {
  window.clearTimeout(loadingGuardTimer);
}

function failReaderOpen(message) {
  readerOpenRequest++;
  clearLoadingGuard();
  readerLoadingError.value = message || t('无法加载这本书，请重试。');
  if (reader.currentBook || reader.openingBook) reader.closeReader();
}

function maybeRevealReader() {
  if (readerPhase.value !== 'loading' || readerLoadingError.value || !reader.currentBook) return;
  if (!readerFirstFrameReady || !readerFlightComplete) return;
  clearLoadingGuard();
  readerPhase.value = 'reveal';
}

function onReaderFirstFrame(book, ready) {
  if (readerPhase.value !== 'loading' || readerLoadingError.value || book !== reader.currentBook) return;
  if (!ready || reader.openError) {
    failReaderOpen(reader.openError);
    return;
  }
  readerFirstFrameReady = true;
  maybeRevealReader();
}

function finishReaderReveal() {
  if (readerPhase.value !== 'reveal') return;
  readerPhase.value = 'reader';
  readerLoadingBook.value = null;
}

async function openBookWithTransition(id, coverSource) {
  if (readerOpening.value || reader.currentBook) return;
  const book = bookById(id);
  if (!book) return;
  readerLoadingBook.value = book;
  await loadReaderBook(coverSource);
}

async function loadReaderBook(coverSource) {
  const book = readerLoadingBook.value;
  if (!book) return;
  const request = ++readerOpenRequest;
  clearLoadingGuard();
  relinkError.value = '';
  readerLoadingError.value = '';
  readerFirstFrameReady = false;
  readerFlightComplete = false;
  readerPhase.value = 'loading';
  loadingGuardTimer = window.setTimeout(() => failReaderOpen(), READER_OPEN_TIMEOUT);
  try {
    await nextTick();
    if (request !== readerOpenRequest) return;
    const flight = readerLoadingRef.value?.flyCoverFrom(coverSource);
    // 让遮罩先实际绘制一帧，冷启动同步分页时也不会继续停留在书架。
    if (!document.hidden) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    if (request !== readerOpenRequest) return;
    const [opened] = await Promise.all([reader.openBook(book.id), flight]);
    if (request !== readerOpenRequest) return;
    if (!opened || reader.openError) {
      failReaderOpen(reader.openError);
      return;
    }
    readerFlightComplete = true;
    maybeRevealReader();
  } catch (err) {
    if (request !== readerOpenRequest) return;
    console.warn('[HOMURA] 打开书籍失败', err);
    failReaderOpen(reader.openError);
  }
}

function retryReaderOpen() {
  if (readerLoadingError.value) return loadReaderBook();
}

function cancelReaderOpen() {
  readerOpenRequest++;
  clearLoadingGuard();
  readerPhase.value = 'shelf';
  readerLoadingBook.value = null;
  readerLoadingError.value = '';
  if (reader.currentBook || reader.openingBook) reader.closeReader();
  else reader.clearOpenError();
}

// 书架视图状态
const query = ref('');
const typeFilter = ref('all');
const sortKey = computed({ get: () => shelf.sortKey, set: value => { shelf.sortKey = value; } });
const shelfHomeRequest = ref(0);
const libraryView = ref('shelf');
const favoritesOnly = computed(() => libraryView.value === 'favorite');
const favoriteBooks = computed(() => shelf.library.filter(book => book.favorite));
const activeCollection = computed(() => activeNav.value === 'shelf' ? shelf.collections.find(item => item.id === shelf.activeCollectionId) || null : null);
const headerTitle = computed(() => {
  if (activeNav.value === 'favorite') return t('收藏');
  if (activeNav.value === 'recent') return t('最近');
  return activeCollection.value?.title || t('书架');
});
const headerCount = computed(() => activeCollection.value ? (shelf.branchBooks.get(activeCollection.value.id)?.length ?? 0) : favoritesOnly.value ? favoriteBooks.value.length : shelf.library.length);
const desktopIslandVisible = computed(() => (
  !isCompact.value
  && (
    activeNav.value !== 'settings'
    || importProgress.status !== 'idle'
    || updates.updateDialogOpen
    || updates.hasNewRelease
    || updates.hasPendingInstall
    || !!pendingDuplicate.value
    || !!pendingShelfDialog.value
  )
));
const overlayLocksBody = computed(() => (
  updates.changelogOpen
  || (
    isCompact.value
    && (
      updates.updateDialogOpen
      || importMenuOpen.value
      || (importProgress.status !== 'idle' && importProgress.expanded)
      || !!pendingDuplicate.value
      || !!pendingShelfDialog.value
    )
  )
));
const SPLASH_MIN_DURATION = 720;
let previousUpdateBodyOverflow = '';
let updateBodyLocked = false;

useAndroidBackExit(reader, () => {
  // 加载页期间按返回 → 取消加载、退回书架（此时阅读器还没接管返回）
  if (readerOpening.value && !reader.currentBook) {
    cancelReaderOpen();
    return true;
  }
  if (pendingShelfDialog.value) {
    if (pendingShelfDialog.value.returnToImportMenu) backToImportMenu();
    else resolveShelfDialog();
    return true;
  }
  if (pendingDuplicate.value) {
    resolveImport();
    return true;
  }
  if (updates.changelogOpen) { updates.closeChangelog(); return true; }
  if (isCompact.value && updates.updateDialogOpen) {
    updates.closeUpdateDialog();
    return true;
  }
  if (activeNav.value === 'settings') {
    if (settingsViewRef.value?.dismissBack()) return true;
    activeNav.value = 'shelf';
    scrollAppToTop('smooth');
    return true;
  }
  if (importMenuOpen.value) {
    importMenuOpen.value = false;
    return true;
  }
  if (shelfFilterOpen.value) {
    shelfFilterOpen.value = false;
    return true;
  }
  if (isCompact.value && importProgress.status !== 'idle' && importProgress.expanded) {
    importProgress.toggleExpanded(false);
    return true;
  }
  if (appearanceOpen.value) {
    appearanceOpen.value = false;
    return true;
  }
  if (shelf.activeCollectionId) { shelf.activeCollectionId = activeCollection.value?.parentId ?? null; return true; }
  return false;
});

watch(
  () => overlayLocksBody.value,
  open => {
    if (open && !updateBodyLocked) {
      previousUpdateBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      updateBodyLocked = true;
      return;
    }
    if (!open && updateBodyLocked) {
      document.body.style.overflow = previousUpdateBodyOverflow;
      updateBodyLocked = false;
    }
  }
);

watch(isCompact, () => { importMenuOpen.value = false; });
watch(pendingShelfDialog, request => {
  if (request?.returnToImportMenu) importMenuOpen.value = false;
});
watch(() => [settings.smartStorageEnabled, settings.smartStorageBudgetMb], () => scheduleSmartStorage(), { immediate: true });
watch(shelfFilterOpen, open => {
  if (open) appearanceOpen.value = false;
});
watch(() => importProgress.status, status => {
  if (status !== 'idle') importMenuOpen.value = false;
});

// 进入阅读器时收起外观浮层，避免它悬在阅读舞台之上
watch(() => reader.currentBook, book => {
  if (book) {
    appearanceOpen.value = false;
    shelfFilterOpen.value = false;
    return;
  }
  if (readerPhase.value === 'reader') readerPhase.value = 'shelf';
});

function backToImportMenu() {
  if (!pendingShelfDialog.value?.returnToImportMenu) return;
  importMenuOpen.value = true;
  resolveShelfDialog();
}

async function createCollection() {
  const parentId = activeCollection.value?.id;
  const title = await askShelfDialog({
    kind: 'name', title: t('新建书库'),
    returnToImportMenu: true,
    initialName: availableCollectionName(t('新建书库'), shelf.collections, parentId),
    validate: name => collectionNameError(name, shelf.collections, null, parentId)
  });
  if (title === null) return;
  try { await shelf.createCollection(title, parentId); } catch (err) { console.warn('[HOMURA] 新建书库失败', err); }
}

async function renameActiveCollection() {
  const item = activeCollection.value;
  if (!item) return;
  const title = await askShelfDialog({
    kind: 'name',
    intent: 'rename',
    title: t('重命名书库'),
    initialName: item.title,
    validate: name => collectionNameError(name, shelf.collections, item.id, item.parentId)
  });
  if (title === null) return;
  try {
    await shelf.renameCollection(item.id, title);
  } catch (err) {
    shelf.error = err.message || t('重命名书库失败，请重试');
    console.warn('[HOMURA] 重命名书库失败', err);
  }
}

const visibleBooks = computed(() => {
  let list = favoritesOnly.value ? favoriteBooks.value : shelf.library;
  if (shelfFormatFilters.some(option => option.value === typeFilter.value)) {
    list = list.filter(book => resolveBookFormat(book) === typeFilter.value);
  } else if (['manga', 'novel', 'other'].includes(typeFilter.value)) {
    list = list.filter(book => bookShelfCategory(book) === typeFilter.value);
  }
  const keyword = query.value.trim().toLowerCase();
  if (keyword) {
    list = list.filter(book => (book.title || '').toLowerCase().includes(keyword));
  }
  return sortShelfBooks(list, sortKey.value, shelf.progressMap);
});

const shelfImportActive = computed(() => (
  activeNav.value === 'shelf' && !activeCollection.value && !query.value.trim()
  && typeFilter.value === 'all' && importProgress.isRunning && !importProgress.targetId
));

// Tauri 的 Activity 结果回调只有一个槽位，文件与文件夹选择不能同时启动。
let nativeImportPending = false;

async function openFilePicker() {
  if (importProgress.isRunning || nativeImportPending) return;
  const mode = importMode.value;
  const nativeImport = canUseNativeImport();
  if (nativeImport) {
    nativeImportPending = true;
    try {
      await importer.pickNativeFiles({ offerCollection: isCompact.value, mode });
      return;
    } catch (err) {
      if (isNativeImportCancelled(err)) return;
      if (mode === 'reference') {
        console.warn('[HOMURA] 原位置入库选择失败', err);
        shelf.error = t('无法读取原位置。请重新选择，或在「添加内容」中关闭「原位置入库」后重试。');
        return;
      }
      if (!shouldFallbackNativeImport(err) || err?.nativeSavedCount > 0) {
        console.warn('[HOMURA] 原生文件选择失败', err);
        shelf.error = err?.nativeSavedCount > 0
          ? t('部分文件已导入，其余文件读取失败，请选择剩余文件')
          : t('读取所选文件失败，请重新选择');
        return;
      }
      console.warn('[HOMURA] 原生文件选择不可用，回退浏览器选择器', err);
    } finally {
      nativeImportPending = false;
    }
  }
  if (hasFileSystemAccess) {
    importer.pickFilesViaFSA({ offerCollection: isCompact.value, retainHandle: !nativeImport });
    return;
  }
  fileInput.value && fileInput.value.click();
}

async function openFolderPicker() {
  if (importProgress.isRunning || nativeImportPending || !canPickFolder) return;
  if (isCompact.value) importMenuOpen.value = false;
  if (canUseNativeImport()) {
    const mode = importMode.value;
    nativeImportPending = true;
    try {
      await importer.pickNativeFolder(mode);
      return;
    } catch (err) {
      if (isNativeImportCancelled(err)) return;
      if (mode === 'reference') {
        shelf.error = t('无法读取原位置。请重新选择，或在「添加内容」中关闭「原位置入库」后重试。');
        return;
      }
      if (isAndroid || !shouldFallbackNativeImport(err)) {
        console.warn('[HOMURA] 原生文件夹导入失败', err);
        shelf.error = t('读取所选文件夹失败，请重新选择');
        return;
      }
      console.warn('[HOMURA] 桌面原生文件夹选择不可用，回退浏览器选择器', err);
    } finally {
      nativeImportPending = false;
    }
  }
  await openBrowserFolderPicker();
}

async function openBrowserFolderPicker() {
  try {
    if (window.showDirectoryPicker) {
      await importer.pickFolderViaFSA();
      return;
    }
    folderInput.value?.click();
  } catch (err) {
    console.warn('[HOMURA] 浏览器文件夹导入失败', err);
    shelf.error = t('读取所选文件夹失败，请重新选择');
  }
}

async function onFileChange(event) {
  const input = event.target;
  try {
    await importer.handleFiles(input.files, { offerCollection: isCompact.value, folderSelection: input.hasAttribute('webkitdirectory') });
  } finally {
    input.value = '';
  }
}

function pickFiles() {
  if (isCompact.value) importMenuOpen.value = false;
  openFilePicker();
}

function retryFailedImport() {
  return importer.retryFailed()?.catch(err => {
    console.warn('[HOMURA] 重试导入中断', err);
  });
}

// 设置是一级页面；书架 / 最近 / 收藏复用书库筛选状态。
function onRailNav(key) {
  if (!['shelf', 'recent', 'favorite', 'settings'].includes(key)) return;
  importMenuOpen.value = false;
  appearanceOpen.value = false;
  shelfFilterOpen.value = false;
  activeNav.value = key;
  if (key === 'settings') {
    scrollAppToTop('smooth');
    return;
  }
  libraryView.value = key;
  shelfHomeRequest.value++;
  shelf.activeCollectionId = null;
  query.value = '';
  typeFilter.value = 'all';
  if (key === 'recent') sortKey.value = 'progress';
  else sortKey.value = 'title';
  scrollAppToTop('smooth');
}

// 全屏：F 快捷键与阅读器顶栏按钮共用 ui.toggleFullscreen()
// 走 Tauri 原生窗口全屏（Windows 的 WebView2 不接管网页全屏）；浏览器调试环境回退标准 Fullscreen API
// 切换后的窗口焦点由 Rust 端监听窗口事件恢复，见 src-tauri/src/lib.rs
function onFullscreenKeydown(e) {
  if (document.querySelector('dialog[open]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.toLowerCase() !== 'f') return;
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  e.preventDefault();
  ui.toggleFullscreen();
}

async function dismissStartupSplash() {
  const splash = document.getElementById('homura-splash');
  if (!splash) return;

  const startedAt = window.__HOMURA_SPLASH_STARTED_AT__ || performance.now();
  const remaining = Math.max(0, SPLASH_MIN_DURATION - (performance.now() - startedAt));
  if (remaining > 0) {
    await new Promise(resolve => window.setTimeout(resolve, remaining));
  }

  // 先在不透明的遮罩下恢复滚动条占位，避免书架在淡出结束时突然变窄。
  document.documentElement.classList.remove('homura-splashing');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  splash.classList.add('is-leaving');
  splash.setAttribute('aria-hidden', 'true');

  let removed = false;
  const removeSplash = () => {
    if (removed) return;
    removed = true;
    splash.remove();
  };
  splash.addEventListener('transitionend', event => {
    if (event.target === splash && event.propertyName === 'opacity') removeSplash();
  });
  // prefers-reduced-motion 下没有 transitionend，用定时器兜底
  window.setTimeout(removeSplash, 240);
}

onMounted(async () => {
  let savedTheme = 'orchid';
  let savedMode = 'light';
  try {
    savedTheme = localStorage.getItem('homura_theme_color') || 'orchid';
    savedMode = localStorage.getItem('homura_surface_mode') || 'light';
  } catch (e) {}

  theme.setThemeColor(savedTheme);
  theme.setSurfaceMode(savedMode, true);

  reader.measurerEl = measurerRef.value;
  window.addEventListener('keydown', onFullscreenKeydown);
  // 关窗 / 切后台时兜底刷写进度，防止防抖窗口内的最后一次翻页丢失
  installProgressFlushHooks(reader, shelf);
  if (settings.debugAutoUpdateCheck) {
    updates.checkForUpdates({ startup: true });
  }

  try {
    // 书架上一次导入的作品会从 IndexedDB 里恢复；第一次使用才放示例书
    await shelf.loadLibrary();
  } finally {
    await dismissStartupSplash();
  }
  void useSyncStore().initialize().catch(() => {});
});

onBeforeUnmount(() => {
  readerOpenRequest++;
  clearLoadingGuard();
  window.removeEventListener('keydown', onFullscreenKeydown);
  if (updateBodyLocked) document.body.style.overflow = previousUpdateBodyOverflow;
});
</script>
