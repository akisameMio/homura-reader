/* ============================================================================
   HOMURA · 导入引擎（Composable）
   ----------------------------------------------------------------------------
   文件选择、文件夹选择、拖拽导入，以及 File System Access 句柄采集。
   ========================================================================== */

import { t } from './useI18n.ts';
import { useShelfStore } from '../stores/shelf.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useImportProgressStore, importFailureReason } from '../stores/importProgress.ts';
import { useDuplicateImport } from './useDuplicateImport.ts';
import { useShelfDialogs } from './useShelfDialogs.ts';
import { planFolderCollections, availableCollectionName, collectionNameError } from '../services/collections.ts';
import { findSameTitleBook, normalizeBookTitle } from '../services/bookTitles.ts';
import { HomuraStore } from '../services/storage.ts';
import { formatBytes, isAndroid } from '../services/platform.ts';
import { parseCbzFileLazy, parseTxtFile, parseMobiFileLazy, parseMarkdownFile, parsePdfFileLazy, buildImageFolderBooks, discardParsedBook, isJunkImagePath } from '../services/parsers.ts';
import { createNativeMangaManifest, makeEpubId, parseEpubFile } from '../services/epubParser.ts';
import {
  makeFileSource,
  makeFolderSource,
  stageNativeFileSource,
  stageNativePathSource
} from '../services/restore.ts';
import { canUseNativeArchive, NATIVE_ONLY_ARCHIVE_BYTES, releaseNativeArchiveSession } from '../services/nativeArchive.ts';
import { removeNativeBookDir } from '../services/nativeStorage.ts';
import {
  isAndroidContentUri,
  isNativeImportFile,
  makeNativeImportFile,
  materializeNativeImportFile,
  materializeStagedNativeImportFile,
  pickNativeImportPaths,
  pickNativeUriImportFiles,
  scanNativeImportPaths,
  shouldFallbackNativeImport
} from '../services/nativeImport.ts';
import { createCoverThumbnail } from '../services/coverThumb.ts';
import { releaseBookPageUrls } from '../services/pagination.ts';
import { runShelfMutation } from '../services/mutationQueue.ts';
import { NativeErrorCode } from '../services/nativeRuntime.ts';
import type { Book, BookSource } from '../types.ts';


/** 导入任务：一个待解析的源（单文件 / 图片文件夹分组） */
interface ImportTask {
  kind: string;
  file?: ImportFile;
  group?: {
    book: Book;
    folderName: string;
    files: ImportFile[];
  };
  title?: string;
  titleIsReliable?: boolean;
  size?: number;
  failureReason?: string;
  duplicateApprovedTitleKey?: string;
}

/** 带自定义附加字段的 File（拖拽 / 目录句柄采集时挂上的相对路径与句柄） */
type ImportFile = File & {
  customRelativePath?: string;
  webkitRelativePath?: string;
  customHandle?: FileSystemFileHandle | null;
  nativePath?: string;
};

/** 批次耗时统计 */
interface ImportMetrics {
  files: number;
  tasks: number;
  importTasks: number;
  concurrency: number;
  commitBatchSize: number;
  commitBatches: number;
  saved: number;
  skipped: number;
  failed: number;
  parseFailed: number;
  nativeTasks: number;
  stageMs: number;
  nativeStageMs: number;
  readMs: number;
  parseMs: number;
  coverMs: number;
  idbMs: number;
  sqliteMs: number;
  commitMs: number;
  startedAt: number;
}

/** 已准备好的待入库条目 */
interface Prepared {
  book: Book;
  source: BookSource;
  coverThumb?: Blob | null;
  [key: string]: unknown;
}

/** 重复导入会话（来自 useDuplicateImport） */
interface DuplicateSession {
  confirmDuplicates: (items: { title?: string; existingTitle?: string; count: number }[]) => Promise<boolean>;
  confirmDuplicate: (book: Book, existingBook: Book) => Promise<boolean>;
  hide: () => void;
  close: () => void;
}

/** File System Access 目录/文件句柄（最小结构） */
interface FsDirectoryHandle {
  name: string;
  kind?: string;
  entries: () => AsyncIterableIterator<[string, FsFileHandle]>;
}
interface FsFileHandle {
  kind: string;
  name?: string;
  getFile: () => Promise<File>;
  entries?: () => AsyncIterableIterator<[string, FsFileHandle]>;
}

/** webkitGetAsEntry 返回的文件 / 目录条目（最小结构） */
interface FsEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file: (onSuccess: (file: File) => void, onError?: () => void) => void;
  createReader: () => {
    readEntries: (onSuccess: (entries: FsEntry[]) => void, onError?: () => void) => void;
  };
}

let quotaWarned = false;
let activeImportBatch: Promise<unknown> | null = null;
const IMPORT_TIMING_ENABLED = !!import.meta.env?.DEV;
const LARGE_FILE_BYTES = 64 * 1024 * 1024;
const VERY_LARGE_FILE_BYTES = 256 * 1024 * 1024;
const DESKTOP_IMPORT_CONCURRENCY = 4;
const ANDROID_IMPORT_CONCURRENCY = 2;
const DESKTOP_COMMIT_BATCH_SIZE = 20;
const ANDROID_COMMIT_BATCH_SIZE = 10;
const LARGE_COMMIT_BATCH_SIZE = 8;
const VERY_LARGE_COMMIT_BATCH_SIZE = 4;
const DESKTOP_COMMIT_MAX_BYTES = 256 * 1024 * 1024;
const ANDROID_COMMIT_MAX_BYTES = 96 * 1024 * 1024;

const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? () => performance.now()
  : () => Date.now();

function importTitleFromFileName(name: string | null | undefined) {
  return String(name || '')
    .replace(/(\.kepub)?\.epub$/i, '')
    .replace(/\.[^.]+$/, '');
}

function createImportMetrics(files: File[], tasks: ImportTask[]) {
  return {
    files: files.length,
    tasks: tasks.length,
    importTasks: tasks.length,
    concurrency: 1,
    commitBatchSize: 1,
    commitBatches: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    parseFailed: 0,
    nativeTasks: tasks.filter((task: ImportTask) => (
      isNativeImportFile(task.file)
      || (task.group?.files || []).some((file: File) => isNativeImportFile(file))
    )).length,
    stageMs: 0,
    nativeStageMs: 0,
    readMs: 0,
    parseMs: 0,
    coverMs: 0,
    idbMs: 0,
    sqliteMs: 0,
    commitMs: 0,
    startedAt: now()
  };
}

function logImportMetrics(metrics: ImportMetrics, savedCount: number) {
  if (!IMPORT_TIMING_ENABLED) return;
  // 阶段耗时是各任务耗时之和，并发导入时会大于实际 wall time。
  const payload = {
    files: metrics.files,
    tasks: metrics.tasks,
    importTasks: metrics.importTasks,
    concurrency: metrics.concurrency,
    commitBatchSize: metrics.commitBatchSize,
    commitBatches: metrics.commitBatches,
    saved: savedCount,
    skipped: metrics.skipped,
    failed: metrics.failed,
    parseFailed: metrics.parseFailed,
    nativeTasks: metrics.nativeTasks,
    totalMs: Math.round(now() - metrics.startedAt),
    stageMs: Math.round(metrics.stageMs),
    nativeStageMs: Math.round(metrics.nativeStageMs),
    readMs: Math.round(metrics.readMs),
    parseMs: Math.round(metrics.parseMs),
    coverMs: Math.round(metrics.coverMs),
    idbMs: Math.round(metrics.idbMs),
    sqliteMs: Math.round(metrics.sqliteMs),
    commitMs: Math.round(metrics.commitMs)
  };
  console.info('[HOMURA][import] 批次耗时', payload);
}

function buildImportTasks(files: File[]) {
  const tasks: ImportTask[] = [];
  const addFileTasks = (list: File[], kind: string, titleIsReliable = true) => {
    for (const file of list) {
      tasks.push({
        kind,
        file,
        title: importTitleFromFileName(file.name),
        titleIsReliable,
        size: file.size || 0
      });
    }
  };

  // EPUB / MOBI 的书名来自容器元数据，不能拿文件名直接断定同名。
  addFileTasks(files.filter((f: File) => /\.epub$/i.test(f.name)), 'epub', false);
  addFileTasks(files.filter((f: File) => /\.pdf$/i.test(f.name)), 'pdf');
  addFileTasks(files.filter((f: File) => /\.(cbz|zip)$/i.test(f.name)), 'archive');
  addFileTasks(files.filter((f: File) => /\.(mobi|prc|azw)$/i.test(f.name)), 'mobi', false);
  addFileTasks(files.filter((f: File) => /\.md$/i.test(f.name)), 'markdown');
  addFileTasks(files.filter((f: File) => /\.txt$/i.test(f.name)), 'txt');

  // macOS 打包留下的 __MACOSX / ._* 不是真正的页面，提前剔掉免得白读内存。
  const imgFiles = files.filter((f: ImportFile) => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|avif|bmp)$/i.test(f.name))
    .filter((f: ImportFile) => !isJunkImagePath(f.customRelativePath || f.webkitRelativePath || f.name));
  for (const group of buildImageFolderBooks(imgFiles) as unknown as NonNullable<ImportTask['group']>[]) {
    tasks.push({
      kind: 'images',
      group,
      title: group.folderName,
      titleIsReliable: true,
      size: group.files.reduce((total: number, file: File) => total + (file.size || 0), 0)
    });
  }
  return tasks;
}

function chooseImportConcurrency(tasks: ImportTask[]) {
  if (tasks.length <= 1) return 1;
  const maxSize = tasks.reduce((max: number, task: ImportTask) => Math.max(max, task.size || 0), 0);
  if (isAndroid) return maxSize > 32 * 1024 * 1024 ? 1 : ANDROID_IMPORT_CONCURRENCY;
  if (maxSize > VERY_LARGE_FILE_BYTES) return 2;
  if (maxSize > LARGE_FILE_BYTES) return 3;
  return Math.min(DESKTOP_IMPORT_CONCURRENCY, tasks.length);
}

function chooseCommitBatchSize(tasks: ImportTask[]) {
  if (tasks.length <= 1) return 1;
  const maxSize = tasks.reduce((max: number, task: ImportTask) => Math.max(max, task.size || 0), 0);
  const countCap = isAndroid
    ? (maxSize > 32 * 1024 * 1024 ? VERY_LARGE_COMMIT_BATCH_SIZE : ANDROID_COMMIT_BATCH_SIZE)
    : maxSize > VERY_LARGE_FILE_BYTES
      ? VERY_LARGE_COMMIT_BATCH_SIZE
      : maxSize > LARGE_FILE_BYTES
        ? LARGE_COMMIT_BATCH_SIZE
        : Math.min(DESKTOP_COMMIT_BATCH_SIZE, tasks.length);
  const byteCap = isAndroid ? ANDROID_COMMIT_MAX_BYTES : DESKTOP_COMMIT_MAX_BYTES;
  let count = 0;
  let bytes = 0;
  for (const task of tasks) {
    if (count >= countCap) break;
    const size = task.size || 0;
    if (count > 0 && bytes + size > byteCap) break;
    bytes += size;
    count++;
  }
  return Math.max(1, count);
}

// 有界滚动并发池：同一批任务按原始 index 回填结果，提交顺序不随完成先后变化。
// 原生导入失败需要整批交给用户重选，必须等已在跑的任务收尾，避免后台继续写盘。
async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>, onError: ((err: unknown, item: T, index: number) => void) | null, shouldStop = () => false) {
  const results: (R | null)[] = new Array(items.length);
  let next = 0;
  let fatalError: (Error & { partialResults?: (R | null)[] }) | null = null;
  async function lane() {
    while (!fatalError && !shouldStop() && next < items.length) {
      const index = next++;
      try {
        results[index] = await worker(items[index], index);
      } catch (err: unknown) {
        if ((err as { nativeImportFallback?: boolean })?.nativeImportFallback) {
          fatalError = fatalError || (err as Error & { partialResults?: (R | null)[] });
          return;
        }
        console.warn('[HOMURA] 导入预处理任务失败', err);
        results[index] = null;
        onError?.(err, items[index], index);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  if (fatalError) {
    (fatalError as Error & { partialResults?: (unknown | null)[] }).partialResults = results.filter(Boolean);
    throw fatalError;
  }
  return results;
}

async function discardPreparedResults(preparedList: (Prepared | null)[] | null | undefined) {
  for (const prepared of preparedList || []) {
    if (prepared?.book) await discardParsedBook(prepared.book).catch(() => {});
  }
}

// 移动端原文件会整份落盘，配额比桌面更容易吃满，导入后检查一次
async function warnIfStorageTight() {
  if (quotaWarned) return;
  const info = await HomuraStore.estimateStorage();
  if (!info || !info.quota) return;
  const free = info.quota - info.usage;
  if (info.ratio >= 0.85 || free < 200 * 1024 * 1024) {
    quotaWarned = true;
    console.warn(`[HOMURA] 存储空间紧张：已用 ${formatBytes(info.usage)} / ${formatBytes(info.quota)}`);
  }
}

export function useImporter() {
  const shelf = useShelfStore();
  const settings = useSettingsStore();
  const importProgress = useImportProgressStore();
  const { createDuplicateSession } = useDuplicateImport();
  const { askShelfDialog } = useShelfDialogs();

  function taskFiles(task: ImportTask | null | undefined): ImportFile[] {
    if (!task) return [];
    if (task.group?.files?.length) return task.group.files.slice();
    return task.file ? [task.file] : [];
  }

  function markTaskFailure(task: ImportTask | null | undefined, error: unknown) {
    if (task && !task.failureReason) task.failureReason = importFailureReason(error);
  }

  function recordTaskFailure(task: ImportTask | null | undefined, error: unknown, fallbackName = '') {
    importProgress.recordFailure({
      name: task?.title || fallbackName || t('未命名文件'),
      reason: task?.failureReason || importFailureReason(error),
      kind: task?.kind || '',
      files: taskFiles(task)
    });
  }

  function handleFiles(fileList: FileList | ImportFile[] | Array<ReturnType<typeof makeNativeImportFile>> | null, { offerCollection = false, targetId = shelf.activeCollectionId }: { offerCollection?: boolean; targetId?: string | null } = {}) {
    if (!fileList || fileList.length === 0) return;
    // useImporter 会被 App 与 DragOverlay 分别实例化，锁必须放在模块级；
    // 否则拖拽入口能绕过锁，第二批会覆盖当前进度。
    if (activeImportBatch || importProgress.isRunning) return;
    const files = (Array.from(fileList as ArrayLike<File>) as ImportFile[]).filter((f: File) => !f.name.startsWith('.'));
    if (files.length === 0) return;

    // 所有导入入口与清空书架共用互斥队列，防止同名漏判和源文件删除竞态。
    activeImportBatch = runShelfMutation(() => importBatch(files, targetId, offerCollection)).catch(err => {
      console.error('[HOMURA] 导入失败', err);
      throw err;
    }).finally(() => {
      activeImportBatch = null;
    });
    return activeImportBatch;
  }

  function retryFailed() {
    const files = importProgress.retryFiles.slice();
    if (!files.length) return;
    return handleFiles(files, { targetId: importProgress.targetId });
  }

  async function importBatch(files: ImportFile[], targetId: string | null = null, offerCollection: boolean) {
    const targetLabel = targetId
      ? (shelf.collections.find(item => item.id === targetId)?.title || t('全部作品'))
      : t('全部作品');
    // 返回本批实际入架的书籍 id，调用方靠它判断导入结果；别把返回值吞在这里。
    const importIntoCurrent = async () => {
      const ids = await importFiles(files, { targetId, targetLabel });
      if (ids.length && targetId && shelf.collections.some(item => item.id === targetId)) await shelf.moveBooks(ids, targetId);
      return ids;
    };
    if (!settings.importCollectionPrompt) return importIntoCurrent();
    const plan = planFolderCollections(files as unknown as { name: string; webkitRelativePath?: string; customRelativePath?: string }[]);
    if (plan.bookCount < 2 || (!plan.hasDirectories && (!offerCollection || targetId))) return importIntoCurrent();
    const grouping = plan.hasDirectories ? t('按目录分别创建 {0} 个一级书库', { 0: plan.groups.length }) : t('将这批作品放进一个新书库');
    const create = await askShelfDialog({
      kind: 'folder', title: t('为导入内容创建书库？'),
      bookCount: plan.bookCount, collectionCount: plan.groups.length, groupByFolder: plan.hasDirectories,
      message: t('检测到 {0} 本作品。可以{1}，也可以直接导入。', { 0: plan.bookCount, 1: grouping })
    });
    if (create === null) return [];
    if (!create) return importIntoCurrent();
    const reserved = [...shelf.collections];
    const groups: { path?: string; bookCount: number; title?: string; files: ImportFile[] }[] = [];
    // 所有名称确认后才导入；中途取消不会留下半批书库。
    for (const group of plan.groups) {
      const message = group.path ? t('目录：{0} · {1} 本作品', { 0: group.path, 1: group.bookCount }) : t('{0} 本作品', { 0: group.bookCount });
      const title = await askShelfDialog({ kind: 'name', title: t('创建导入书库'), message, initialName: availableCollectionName(group.title, reserved), validate: (name: string) => collectionNameError(name, reserved) }) as string | null;
      if (title === null) return [];
      reserved.push({ title } as unknown as (typeof reserved)[number]);
      groups.push({ ...group, title } as unknown as (typeof groups)[number]);
    }
    const savedIds: string[] = [];
    for (const group of groups) {
      const ids = await importFiles(group.files, {
        targetId: '',
        targetLabel: t('新建书库「{0}」', { 0: group.title })
      });
      if (!ids.length) continue;
      savedIds.push(...ids);
      const collection = await shelf.createCollection(group.title ?? '');
      await shelf.moveBooks(ids, collection.id);
    }
    shelf.activeCollectionId = null;
    return savedIds;
  }

  // 导入前只按文件名快速识别可能的同名书，避免重复文件也走完整解析。
  async function preflightDuplicateTasks(tasks: ImportTask[], duplicateSession: DuplicateSession) {
    if (!tasks.length || !shelf.library.length) {
      return { tasks, skipped: 0 };
    }
    const knownByTitle = new Map<string, Book>();
    for (const book of shelf.library) {
      const key = normalizeBookTitle(book.title);
      if (key && !knownByTitle.has(key)) knownByTitle.set(key, book);
    }

    const groups = new Map<string, { key: string; title?: string; existingTitle?: string; tasks: ImportTask[] }>();
    for (const task of tasks) {
      if (!task.titleIsReliable) continue;
      const key = normalizeBookTitle(task.title);
      const existing = key ? knownByTitle.get(key) : null;
      if (!existing) continue;
      let group = groups.get(key);
      if (!group) {
        group = { key, title: task.title, existingTitle: existing.title, tasks: [] };
        groups.set(key, group);
      }
      group.tasks.push(task);
    }
    if (!groups.size) return { tasks, skipped: 0 };

    const list = [...groups.values()];
    const keep = await duplicateSession.confirmDuplicates(list.map(group => ({
      title: group.title,
      existingTitle: group.existingTitle,
      count: group.tasks.length
    })));
    duplicateSession.hide();
    if (keep) {
      // 只对参与预检的任务免掉后续同名弹窗；其它格式的真实书名仍要单独判断。
      for (const group of list) {
        for (const task of group.tasks) task.duplicateApprovedTitleKey = group.key;
      }
      return { tasks, skipped: 0 };
    }

    const skippedTasks = new Set(list.flatMap(group => group.tasks));
    for (const task of skippedTasks) {
      if (task.kind === 'images' && task.group?.book) await discardParsedBook(task.group.book);
    }
    return {
      tasks: tasks.filter((task: ImportTask) => !skippedTasks.has(task)),
      skipped: skippedTasks.size
    };
  }

  async function prepareEpubTask(task: ImportTask, metrics: ImportMetrics): Promise<Prepared | null> {
    let file = task.file!;
    const bookId = makeEpubId();
    let source = makeFileSource(file);
    let nativePath = '';
    importProgress.setPhase('read');

    // 原生 EPUB 先流式落到 AppData。解析只读 spine 文本和封面，
    // 大画集不再把整个压缩包搬进 WebView 内存。
    if (canUseNativeArchive()) {
      const started = now();
      const viaNativePath = isNativeImportFile(file);
      try {
        const staged = viaNativePath
          ? await stageNativePathSource(bookId, file)
          : await stageNativeFileSource(bookId, file);
        source = staged as BookSource;
        nativePath = staged.nativePath;
        if (viaNativePath) metrics.nativeStageMs += now() - started;
      } catch (err) {
        if (file.size > NATIVE_ONLY_ARCHIVE_BYTES || !shouldFallbackNativeImport(err)) {
          console.warn('[HOMURA] 原生 EPUB 预存被拒绝', err);
          // 安全、超限或大型压缩包的原生失败都不会回退；已写一半的 AppData 也要回收，
          // 否则会留下没有书目指向的孤儿文件。
          await removeNativeBookDir(bookId).catch(() => {});
          markTaskFailure(task, err);
          return null;
        }
        // Android 的 content:// 授权只存在于当前选择会话。普通复制失败时
        // 交给系统文件输入重选；安全与超限错误仍由上面的分支终止。
        if (isAndroidContentUri(file.nativePath)) {
          await removeNativeBookDir(bookId).catch(() => {});
          (err as { nativeImportFallback?: boolean }).nativeImportFallback = true;
          throw err;
        }
        console.warn('[HOMURA] 原生 EPUB 预存失败，沿用 JSZip', err);
        await removeNativeBookDir(bookId).catch(() => {});
        if (isNativeImportFile(file)) {
          const readStarted = now();
          try {
            file = await materializeNativeImportFile(file);
          } catch (readError) {
            console.warn('[HOMURA] 读取原生 EPUB 失败', readError);
            markTaskFailure(task, readError);
            return null;
          } finally {
            metrics.readMs += now() - readStarted;
          }
          source = makeFileSource(file);
        }
      } finally {
        metrics.stageMs += now() - started;
      }
    }

    const parseStarted = now();
    let book: Book | null = null;
    const parseOptions = {
      id: bookId,
      name: file.name,
      nativePath,
      archiveSize: source.size,
      loadFallbackFile: nativePath
        ? () => materializeStagedNativeImportFile(file, nativePath)
        : undefined
    };
    const parseFullEpub = () => parseEpubFile(file, parseOptions);
    importProgress.setPhase('parse');
    let parseFailure: unknown = null;
    try {
      let metadataError: unknown = null;
      try {
        book = await parseEpubFile(file, { ...parseOptions, metadataOnly: true });
      } catch (err) {
        metadataError = err;
        parseFailure = err;
      }

      if (metadataError) {
        const metadataCode = (metadataError as { code?: string }).code;
        const canRetryFull = metadataCode !== NativeErrorCode.SECURITY_LIMIT
          && metadataCode !== NativeErrorCode.LIMIT_EXCEEDED
          && metadataCode !== NativeErrorCode.CANCELLED
          && (source.size || file.size) <= NATIVE_ONLY_ARCHIVE_BYTES;
        if (!canRetryFull) {
          console.warn('[HOMURA] EPUB 被安全或限额规则拒绝，不再回退', metadataError);
        } else {
          try {
            book = await parseFullEpub();
          } catch (fullError) {
            console.warn('[HOMURA] EPUB 解析失败', fullError);
            parseFailure = fullError;
          }
        }
      } else if (book?.needsFullParse || (book?.type === 'manga' && !book.pageItems?.length)) {
        if (IMPORT_TIMING_ENABLED) console.info('[HOMURA] EPUB 元数据采样不足，回退全量解析');
        try {
          book = await parseFullEpub();
        } catch (fullError) {
          if (book?.needsFullParse) {
            console.warn('[HOMURA] EPUB 解析失败', fullError);
            parseFailure = fullError;
            book = null;
          } else {
            // 漫画索引失败时仍允许入架，首次打开会回退到完整解析。
            console.warn('[HOMURA] EPUB 漫画页清单生成失败，保留元数据', fullError);
          }
        }
      }
    } finally {
      metrics.parseMs += now() - parseStarted;
    }
    if (!book) {
      markTaskFailure(task, parseFailure || new Error(t('无法解析 EPUB')));
      if (nativePath) await removeNativeBookDir(bookId).catch(() => {});
      return null;
    }
    book.nativeArchiveStaged = !!nativePath;
    const pageManifest = createNativeMangaManifest(book);
    if (pageManifest) source = { ...source, nativePageManifest: pageManifest } as BookSource;
    return { book, source };
  }

  async function prepareArchiveTask(task: ImportTask, metrics: ImportMetrics): Promise<Prepared | null> {
    let file = task.file!;
    const bookId = `cbz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let source: BookSource = makeFileSource(file);
    let nativePath = '';
    importProgress.setPhase('read');

    // 先把原文件流式落到 AppData，再让原生后端从路径随机读取；
    // 这样不会先用 JSZip 把整本压缩包读进 WebView。
    if (canUseNativeArchive()) {
      const started = now();
      const viaNativePath = isNativeImportFile(file);
      try {
        const staged = viaNativePath
          ? await stageNativePathSource(bookId, file)
          : await stageNativeFileSource(bookId, file);
        source = staged as BookSource;
        nativePath = staged.nativePath as string;
        if (viaNativePath) metrics.nativeStageMs += now() - started;
      } catch (err) {
        if (file.size > NATIVE_ONLY_ARCHIVE_BYTES || !shouldFallbackNativeImport(err)) {
          console.warn('[HOMURA] 原生压缩包预存被拒绝', err);
          await removeNativeBookDir(bookId).catch(() => {});
          markTaskFailure(task, err);
          return null;
        }
        if (isAndroidContentUri(file.nativePath)) {
          await removeNativeBookDir(bookId).catch(() => {});
          (err as { nativeImportFallback?: boolean }).nativeImportFallback = true;
          throw err;
        }
        console.warn('[HOMURA] 原生压缩包预存失败，沿用 JSZip', err);
        await removeNativeBookDir(bookId).catch(() => {});
        if (isNativeImportFile(file)) {
          const readStarted = now();
          try {
            file = await materializeNativeImportFile(file);
          } catch (readError) {
            console.warn('[HOMURA] 读取原生压缩包失败', readError);
            markTaskFailure(task, readError);
            return null;
          } finally {
            metrics.readMs += now() - readStarted;
          }
          source = makeFileSource(file);
        }
      } finally {
        metrics.stageMs += now() - started;
      }
    }

    const parseStarted = now();
    let book: Book | null = null;
    importProgress.setPhase('parse');
    try {
      book = await parseCbzFileLazy(file, {
        id: bookId,
        name: file.name,
        nativePath,
        archiveSize: source.size,
        staged: !!nativePath,
        loadFallbackFile: nativePath
          ? () => materializeStagedNativeImportFile(file, nativePath)
          : undefined
      });
    } catch (err) {
      console.warn('[HOMURA] 压缩包解析失败', err);
      markTaskFailure(task, err);
    } finally {
      metrics.parseMs += now() - parseStarted;
    }
    if (!book) {
      if (nativePath) await removeNativeBookDir(bookId).catch(() => {});
      return null;
    }
    book.nativeArchiveStaged = !!nativePath;
    const pageManifest = createNativeMangaManifest(book);
    if (pageManifest) source = { ...source, nativePageManifest: pageManifest } as BookSource;
    return { book, source };
  }

  async function prepareParsedTask(task: ImportTask, parser: (file: File) => Promise<unknown>, metrics: ImportMetrics, label: string): Promise<Prepared | null> {
    const started = now();
    let file = task.file!;
    let book: Book | null = null;
    let stagedBookId = '';
    let stagedSource: BookSource | null = null;
    importProgress.setPhase('read');
    try {
      if (isNativeImportFile(file)) {
        if (isAndroidContentUri(file.nativePath)) {
          stagedBookId = makeEpubId();
          const stageStarted = now();
          try {
            stagedSource = await stageNativePathSource(stagedBookId, file);
          } catch (err: unknown) {
            if (shouldFallbackNativeImport(err)) (err as { nativeImportFallback?: boolean }).nativeImportFallback = true;
            throw err;
          } finally {
            metrics.stageMs += now() - stageStarted;
          }
          const readStarted = now();
          try {
            file = await materializeStagedNativeImportFile(file, stagedSource.nativePath as string);
          } finally {
            metrics.readMs += now() - readStarted;
          }
        } else {
          const readStarted = now();
          try {
            file = await materializeNativeImportFile(file);
          } finally {
            metrics.readMs += now() - readStarted;
          }
        }
      }
      importProgress.setPhase('parse');
      book = (await parser(file)) as Book | null;
    } catch (err: unknown) {
      if ((err as { nativeImportFallback?: boolean })?.nativeImportFallback) {
        if (stagedBookId) await removeNativeBookDir(stagedBookId).catch(() => {});
        throw err;
      }
      console.warn(`[HOMURA] ${label} 解析失败`, err);
      markTaskFailure(task, err);
    } finally {
      metrics.parseMs += now() - started;
    }
    if (!book) {
      if (stagedBookId) await removeNativeBookDir(stagedBookId).catch(() => {});
      return null;
    }
    if (stagedSource) {
      book.id = stagedBookId;
      book.nativeArchiveStaged = true;
      return { book, source: stagedSource };
    }
    return { book, source: makeFileSource(file) };
  }

  async function prepareImportTask(task: ImportTask, metrics: ImportMetrics): Promise<Prepared | null> {
    let prepared: Prepared | null = null;
    if (task.kind === 'epub') prepared = await prepareEpubTask(task, metrics);
    else if (task.kind === 'archive') prepared = await prepareArchiveTask(task, metrics);
    else if (task.kind === 'pdf') prepared = await prepareParsedTask(task, parsePdfFileLazy, metrics, 'PDF');
    else if (task.kind === 'mobi') prepared = await prepareParsedTask(task, parseMobiFileLazy, metrics, 'MOBI');
    else if (task.kind === 'markdown') prepared = await prepareParsedTask(task, parseMarkdownFile, metrics, 'Markdown');
    else if (task.kind === 'txt') prepared = await prepareParsedTask(task, parseTxtFile, metrics, 'TXT');
    else if (task.kind === 'images') {
      importProgress.setPhase('read');
      let group = task.group;
      if (!group) {
        metrics.parseFailed++;
        markTaskFailure(task, new Error(t('图片分组缺失')));
        return null;
      }
      if (group.files.some((file: ImportFile) => isNativeImportFile(file))) {
        const readStarted = now();
        try {
          const files = new Array(group.files.length);
          const nativeEntries = new Array(group.files.length);
          for (let index = 0; index < group.files.length; index++) {
            const file = group.files[index];
            if (isAndroidContentUri(file.nativePath)) {
              let staged;
              try {
                staged = await stageNativePathSource(group.book.id, file);
              } catch (err: unknown) {
                if (shouldFallbackNativeImport(err)) (err as { nativeImportFallback?: boolean }).nativeImportFallback = true;
                throw err;
              }
              files[index] = await materializeStagedNativeImportFile(file, staged.nativePath);
              nativeEntries[index] = {
                path: file.customRelativePath || file.name,
                size: staged.size,
                lastModified: staged.lastModified,
                nativePath: staged.nativePath
              };
            } else {
              files[index] = await materializeNativeImportFile(file);
            }
          }
          const rebuilt = buildImageFolderBooks(files)[0];
          if (!rebuilt) throw new Error(t('图片目录为空'));
          rebuilt.book.id = group.book.id;
          (rebuilt.book as Book).nativeArchiveStaged = nativeEntries.some(Boolean);
          group = rebuilt as unknown as NonNullable<ImportTask['group']>;
          if (nativeEntries.some(Boolean)) {
            prepared = {
              book: group.book,
              source: {
                kind: 'folder',
                name: group.folderName,
                entries: nativeEntries.map((entry, index) => entry || {
                  path: files[index].customRelativePath || files[index].name,
                  size: files[index].size,
                  lastModified: files[index].lastModified,
                  blob: files[index]
                })
              }
            };
          }
        } catch (err: unknown) {
          console.warn('[HOMURA] 读取原生图片目录失败', err);
          if (group?.files?.some((file: ImportFile) => isAndroidContentUri(file.nativePath))) {
            await removeNativeBookDir(group.book.id).catch(() => {});
          }
          if ((err as { nativeImportFallback?: boolean })?.nativeImportFallback) throw err;
          markTaskFailure(task, err);
          return null;
        } finally {
          metrics.readMs += now() - readStarted;
        }
      }
      importProgress.setPhase('parse');
      if (!prepared) {
        prepared = {
          book: group.book,
          source: makeFolderSource(group.folderName, group.files)
        };
      }
    }
    if (!prepared) {
      metrics.parseFailed++;
      markTaskFailure(task, new Error(t('无法解析这个文件')));
      return null;
    }

    importProgress.setPhase('cover');
    const coverStarted = now();
    prepared.coverThumb = await createCoverThumbnail(
      prepared.book.coverBlob ?? null,
      undefined,
      prepared.book.coverNative as { archivePath?: string; entryPath?: string } | null | undefined
    ).catch(() => null);
    metrics.coverMs += now() - coverStarted;
    return prepared;
  }

  // 保存成功后书架只需要元数据与封面；下次打开由 hydrateBook 重新解析原文件。
  async function releaseImportedBookRuntime(book: Book, coverThumb: Blob | null | undefined) {
    try {
      releaseBookPageUrls(book);
      for (const url of new Set((book.resourceUrls as String[] | null | undefined) || [])) {
        if (typeof url === 'string' && url.startsWith('blob:') && url !== book.cover) URL.revokeObjectURL(url);
      }
      const pdfDoc = book.pdfDoc as { loadingTask?: { destroy?: () => Promise<void> }; destroy?: () => Promise<void> } | null | undefined;
      if (pdfDoc?.loadingTask?.destroy) await pdfDoc.loadingTask.destroy();
      else if (pdfDoc?.destroy) await pdfDoc.destroy();
    } catch (err) {
      console.warn('[HOMURA] 释放导入后的页面资源失败', book.title, err);
    }
    try {
      await releaseNativeArchiveSession(book as unknown as { nativeArchiveId?: string | null; nativeArchivePath?: string | null; pageItems?: { nativeArchiveId?: string; nativeArchivePath?: string }[] | null });
    } catch (err) {
      console.warn('[HOMURA] 释放导入后的原生 EPUB / CBZ 会话失败', book.title, err);
    }

    if (coverThumb && coverThumb !== book.coverBlob) {
      try {
        const previousCover = book.cover;
        book.coverBlob = coverThumb;
        book.cover = URL.createObjectURL(coverThumb);
        if (previousCover?.startsWith('blob:') && previousCover !== book.cover) URL.revokeObjectURL(previousCover);
      } catch (err) {
        console.warn('[HOMURA] 替换导入后的封面缩略图失败', book.title, err);
      }
    }
    (book as { chapters?: unknown }).chapters = null;
    (book as { pageItems?: unknown }).pageItems = null;
    (book as { resourceUrls?: unknown }).resourceUrls = null;
    book.zipContent = null;
    book.pdfDoc = null;
    (book as { nativeArchiveId?: unknown }).nativeArchiveId = null;
    (book as { nativeArchivePath?: unknown }).nativeArchivePath = null;
    (book as { nativeArchiveMode?: unknown }).nativeArchiveMode = null;
    book.nativeEntryIndexByPath = null;
    book.nativeArchiveStaged = false;
    book.coverNative = null;
    book.restored = true;
  }

  // 同一批内也要按顺序判重，前一本确认保留后，后一本必须继续询问。
  async function confirmPreparedDuplicates(preparedList: (Prepared | null)[], taskList: ImportTask[], metrics: ImportMetrics, duplicateSession: DuplicateSession) {
    const accepted: Prepared[] = [];
    const knownInBatch = new Map<string, Book>();
    try {
      for (let index = 0; index < preparedList.length; index++) {
        const prepared = preparedList[index];
        if (!prepared) continue;
        const task = taskList[index];
        const { book } = prepared;
        const titleKey = normalizeBookTitle(book.title);
        const existingBook = (titleKey && knownInBatch.get(titleKey)) || findSameTitleBook(shelf.library, book.title);
        if (existingBook && task?.duplicateApprovedTitleKey !== titleKey) {
          importProgress.setPhase('confirm');
          importProgress.setCurrentName(book.title ?? '');
          const keep = await duplicateSession.confirmDuplicate(book, existingBook as unknown as Book);
          importProgress.setPhase('save');
          if (!keep) {
            metrics.skipped++;
            importProgress.addSkipped(1);
            await discardParsedBook(book);
            continue;
          }
        }
        if (titleKey && !knownInBatch.has(titleKey)) knownInBatch.set(titleKey, book);
        accepted.push(prepared);
      }
    } finally {
      duplicateSession.hide();
    }
    return accepted;
  }

  async function commitPreparedBatch(preparedList: (Prepared | null)[], taskList: ImportTask[], savedBooks: Book[], metrics: ImportMetrics, duplicateSession: DuplicateSession) {
    importProgress.setPhase('save');
    const accepted = await confirmPreparedDuplicates(preparedList, taskList, metrics, duplicateSession);
    if (!accepted.length) return;

    metrics.commitBatches++;
    const coverThumbs = new Map(accepted.map(prepared => [prepared.book.id, prepared.coverThumb]));
    const preparedById = new Map(accepted.map(prepared => [prepared.book.id, prepared]));
    const acceptedIds = new Set(accepted.map(prepared => prepared.book.id));
    const taskByBookId = new Map<string, ImportTask>();
    for (let index = 0; index < preparedList.length; index++) {
      const prepared = preparedList[index];
      if (prepared && acceptedIds.has(prepared.book.id)) {
        taskByBookId.set(prepared.book.id, taskList[index]);
      }
    }
    importProgress.setPhase('save');
    importProgress.setCurrentName(
      accepted.length === 1 ? (accepted[0].book.title ?? '') : t('本批 {0} 本作品', { 0: accepted.length })
    );
    const started = now();
    try {
      const result = await shelf.addBooks(
        accepted.map(prepared => ({
          book: prepared.book,
          source: prepared.source,
          coverThumb: prepared.coverThumb
        })),
        {
          timing: metrics,
          onSaved: book => releaseImportedBookRuntime(book, coverThumbs.get(book.id))
        }
      );
      for (const book of result.saved) {
        savedBooks.push(book);
        metrics.saved++;
        importProgress.addSaved(1);
      }
      for (const failure of result.failed) {
        const prepared = preparedById.get(failure.book.id);
        if (!prepared) {
          metrics.failed++;
          recordTaskFailure(taskByBookId.get(failure.book.id), failure.error, failure.book.title);
          await discardParsedBook(failure.book);
          continue;
        }
        // 暂存阶段的单本失败只重试这一本，不让整批回退。
        try {
          await shelf.addBook(prepared.book, prepared.source, {
            coverThumb: prepared.coverThumb,
            timing: metrics,
            onSaved: book => releaseImportedBookRuntime(book, prepared.coverThumb)
          });
          savedBooks.push(prepared.book);
          metrics.saved++;
          importProgress.addSaved(1);
        } catch (singleErr) {
          metrics.failed++;
          console.warn('[HOMURA] 本地存档单本重试失败，已跳过', prepared.book.title, singleErr);
          recordTaskFailure(taskByBookId.get(prepared.book.id), singleErr, prepared.book.title);
          await discardParsedBook(prepared.book);
        }
      }
    } catch (err) {
      // 整批事务失败时逐本重试，避免一本坏数据拖垮整批。
      console.warn('[HOMURA] 批量存档失败，改为逐本提交', err);
      for (const prepared of accepted) {
        try {
          await shelf.addBook(prepared.book, prepared.source, {
            coverThumb: prepared.coverThumb,
            timing: metrics,
            onSaved: book => releaseImportedBookRuntime(book, prepared.coverThumb)
          });
          savedBooks.push(prepared.book);
          metrics.saved++;
          importProgress.addSaved(1);
        } catch (singleErr) {
          metrics.failed++;
          console.warn('[HOMURA] 本地存档写入失败，已跳过', prepared.book.title, singleErr);
          recordTaskFailure(taskByBookId.get(prepared.book.id), singleErr, prepared.book.title);
          await discardParsedBook(prepared.book);
        }
      }
    } finally {
      metrics.commitMs += now() - started;
    }
  }

  async function importFiles(files: ImportFile[], { targetId = shelf.activeCollectionId, targetLabel = '' }: { targetId?: string | null; targetLabel?: string } = {}) {
    const tasks = buildImportTasks(files);
    const metrics = createImportMetrics(files, tasks);
    if (!tasks.length) {
      importProgress.dismiss();
      console.warn('[HOMURA] 未找到支持的漫画或小说格式');
      logImportMetrics(metrics, 0);
      return [];
    }

    const duplicateSession = createDuplicateSession();
    try {
      const preflight = await preflightDuplicateTasks(tasks, duplicateSession);
      const importTasks = preflight.tasks;
      metrics.skipped += preflight.skipped;
      metrics.importTasks = importTasks.length;
      if (!importTasks.length) {
        importProgress.dismiss();
        logImportMetrics(metrics, 0);
        return [];
      }
      const targetCollection = shelf.collections.find(item => item.id === targetId);
      importProgress.begin({
        total: importTasks.length,
        bytesTotal: importTasks.reduce((sum: number, task: ImportTask) => sum + (task.size || 0), 0),
        skipped: preflight.skipped,
        targetId,
        targetLabel: targetLabel || targetCollection?.title || t('全部作品')
      });

      const savedBooks: Book[] = [];
      metrics.concurrency = chooseImportConcurrency(importTasks);
      const commitBatchSize = chooseCommitBatchSize(importTasks);
      metrics.commitBatchSize = commitBatchSize;
      try {
        for (let start = 0; start < importTasks.length; start += commitBatchSize) {
          const batchTasks = importTasks.slice(start, start + commitBatchSize);
          const prepared = await runPool(
            batchTasks,
            metrics.concurrency,
            async (task: ImportTask) => {
              importProgress.taskStarted(task, task.title);
              try {
                const result = await prepareImportTask(task, metrics);
                if (!result) {
                  markTaskFailure(task, new Error(t('无法解析或读取这个文件')));
                  recordTaskFailure(task, new Error(task.failureReason));
                }
                return result;
              } finally {
                importProgress.taskSettled(task, task.size);
              }
            },
            (err: unknown, task: ImportTask) => {
              metrics.parseFailed++;
              markTaskFailure(task, err);
              recordTaskFailure(task, err);
            },
            () => importProgress.cancelRequested
          );
          await commitPreparedBatch(prepared, batchTasks, savedBooks, metrics, duplicateSession);
          if (importProgress.cancelRequested) break;
        }
      } catch (err: unknown) {
        const importErr = err as { nativeImportFallback?: boolean; partialResults?: (Prepared | null)[]; nativeSavedCount?: number };
        if (importErr?.nativeImportFallback) {
          await discardPreparedResults(importErr.partialResults ?? null);
          delete importErr.partialResults;
          // 已提交的书不能因为剩余文件失败而让用户重选整批，否则会重复询问同名书。
          importErr.nativeSavedCount = savedBooks.length;
          logImportMetrics(metrics, savedBooks.length);
        }
        importProgress.recordFailure({
          name: t('导入批次'),
          reason: importFailureReason(err),
          kind: 'batch'
        });
        throw err;
      } finally {
        importProgress.finish();
      }

      if (metrics.failed > 0) {
        console.warn(`[HOMURA] ${metrics.failed} 部作品未能保存到本地存档`);
      } else if (savedBooks.length === 0 && metrics.skipped === 0) {
        console.warn('[HOMURA] 未找到支持的漫画或小说格式');
      }
      if (savedBooks.length > 0) await warnIfStorageTight();
      logImportMetrics(metrics, savedBooks.length);
      return savedBooks.map(book => book.id);
    } finally {
      duplicateSession.close();
    }
  }

  // ---- 拖拽：递归遍历 webkitGetAsEntry 目录树 ----

  function traverseFileTree(item: FsEntry, path: string, outList: ImportFile[]): Promise<void> {
    return new Promise<void>(resolve => {
      // __MACOSX 整个目录跳过，里面的 ._* 只是资源分叉，读进来也叫不醒。
      if (item.name === '__MACOSX') {
        resolve();
        return;
      }
      if (item.isFile) {
        item.file((file: ImportFile) => {
          // 隐藏文件和 macOS 资源分叉文件不参与导入。
          if (file.name.startsWith('.') || isJunkImagePath(path + file.name)) {
            resolve();
            return;
          }
          try {
            Object.defineProperty(file, 'customRelativePath', {
              value: path + file.name,
              writable: false
            });
          } catch (err) {}
          outList.push(file);
          resolve();
        }, () => resolve());
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const readEntriesBatch = () => {
          dirReader.readEntries(async (entries: FsEntry[]) => {
            if (!entries || entries.length === 0) {
              resolve();
            } else {
              for (const entry of entries) {
                await traverseFileTree(entry, path + item.name + '/', outList);
              }
              readEntriesBatch();
            }
          }, () => resolve());
        };
        readEntriesBatch();
      } else {
        resolve();
      }
    });
  }

  async function handleDrop(e: DragEvent) {
    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;
    if (dataTransfer.items && dataTransfer.items.length > 0) {
      const collectedFiles: ImportFile[] = [];
      const entries: FsEntry[] = [];
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry) entries.push(entry as unknown as FsEntry);
          else {
            const f = item.getAsFile();
            if (f) collectedFiles.push(f);
          }
        }
      }
      if (entries.length > 0) {
        for (const entry of entries) {
          await traverseFileTree(entry, '', collectedFiles);
        }
        if (collectedFiles.length > 0) {
          await handleFiles(collectedFiles);
          return;
        }
      }
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      await handleFiles(dataTransfer.files);
    }
  }

  // ---- File System Access：优先引用原文件句柄 ----

  async function pickFilesViaFSA(options: { offerCollection?: boolean; targetId?: string | null }) {
    let handles: FileSystemFileHandle[] = [];
    try {
      handles = await window.showOpenFilePicker({ multiple: true });
    } catch (err) {
      return;
    }
    const files: ImportFile[] = [];
    for (const handle of handles) {
      try {
        const file = await handle.getFile();
        Object.defineProperty(file, 'customHandle', { value: handle, writable: false });
        files.push(file);
      } catch (err) {}
    }
    if (files.length > 0) await handleFiles(files, options);
  }

  // Tauri 优先用系统选择器：桌面拿真实路径，Android 拿 content:// URI，
  // 大文件都由原生侧直接复制，WebView 只接收轻量元数据。
  async function pickNativeFiles(options: { offerCollection?: boolean; targetId?: string | null }) {
    if (isAndroid) {
      const files = await pickNativeUriImportFiles({ multiple: true });
      if (!files || files.length === 0) return false;
      await handleFiles(files, options);
      return true;
    }
    const paths = await pickNativeImportPaths({ directory: false, multiple: true });
    if (!paths || paths.length === 0) return false;
    const entries = await scanNativeImportPaths(paths);
    const files = entries.map(makeNativeImportFile);
    if (files.length === 0) {
      console.warn('[HOMURA] 所选路径里没有可导入的支持格式');
      return true;
    }
    await handleFiles(files, options);
    return true;
  }

  async function pickNativeFolder() {
    const paths = await pickNativeImportPaths({ directory: true, multiple: false, title: t('导入文件夹') });
    if (!paths || paths.length === 0) return false;
    const entries = await scanNativeImportPaths(paths);
    const files = entries.map(makeNativeImportFile);
    if (files.length === 0) {
      console.warn('[HOMURA] 该文件夹内没有可导入的文件');
      return true;
    }
    await handleFiles(files);
    return true;
  }

  async function pickFolderViaFSA() {
    let dirHandle: FsDirectoryHandle | null = null;
    try {
      dirHandle = (await window.showDirectoryPicker({ mode: 'read' })) as unknown as FsDirectoryHandle;
    } catch (err) {
      return;
    }
    if (!dirHandle) return;
    const files: ImportFile[] = [];
    await collectFilesFromDirHandle(dirHandle, dirHandle.name + '/', files);
    if (files.length > 0) await handleFiles(files);
    else console.warn('[HOMURA] 该文件夹内没有可导入的文件');
  }

  // ---- 递归遍历目录句柄，收集文件 ----

  async function collectFilesFromDirHandle(dirHandle: FsDirectoryHandle, path: string, out: ImportFile[]) {
    for await (const [name, entry] of dirHandle.entries()) {
      if (name.startsWith('.') || name === '__MACOSX') continue;
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          Object.defineProperty(file, 'customRelativePath', { value: path + name, writable: false });
          out.push(file);
        } catch (err) {}
      } else if (entry.kind === 'directory') {
        await collectFilesFromDirHandle(entry as unknown as FsDirectoryHandle, path + name + '/', out);
      }
    }
  }

  return {
    handleFiles,
    retryFailed,
    handleDrop,
    pickFilesViaFSA,
    pickFolderViaFSA,
    pickNativeFiles,
    pickNativeFolder
  };
}
