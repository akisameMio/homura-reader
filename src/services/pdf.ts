/* ============================================================================
   HOMURA · PDF 渲染
   ----------------------------------------------------------------------------
   PDF 版式固定，不能像 EPUB 那样重排；这里把每一页按需渲染成位图，
   交给现有漫画管道（pageItems）显示，书架 / 翻页 / 条漫 / 进度全部复用。
   pdf.js 体积较大，首次导入或恢复 PDF 时才动态加载；渲染出的页面位图
   走 LRU 缓存，避免来回翻页把内存吃满。
   ========================================================================== */

import type { PdfPageItem } from '../types.ts';
import PdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// 正文页按 1600px 宽渲染：桌面全屏显示足够清晰，缩放阅读也不糊
const RENDER_TARGET_WIDTH = 1600;
// 封面只用于书架卡片，小一点，避免存档里多塞一张大图
const COVER_TARGET_WIDTH = 900;
// 超小页面（如单格漫画）不无限放大，2.5 倍足够
const MAX_UPSCALE = 2.5;
// 超大/超长页面限制画布边长与总像素，避免触发浏览器 Canvas 上限导致 toBlob 返回 null
const MAX_CANVAS_EDGE = 4096;
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
// 超过该体积的本地 File / Blob 改用 Range 分块读取，避免整本读入 ArrayBuffer 触发 OOM
const LOCAL_RANGE_THRESHOLD_BYTES = 4 * 1024 * 1024;
const LOCAL_RANGE_CHUNK_SIZE = 256 * 1024;
// 缓存上限按页数算，约等于 20~50MB 位图，够翻几个来回了
const MAX_CACHED_PAGES = 24;

/** pdf.js 文档的最小结构 */
export interface PdfDocLike {
  numPages?: number;
  getPage(pageNumber: number): Promise<{
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
    cleanup(): void;
  }>;
  getOutline?(): Promise<unknown[] | null>;
  getDestination?(id: string): Promise<unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
  destroy?(): Promise<void>;
  loadingTask?: { destroy?(): Promise<void> };
}

/** 支持全量或切片读取的本地文件结构 */
interface PdfFileLike {
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice?(start?: number, end?: number): Blob;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;
      return mod;
    }).catch(err => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

// ---- 渲染位图缓存：超出上限时释放最久未用过的页 ----

const renderedUrls: { pageItem: PdfPageItem; url: string }[] = [];

function rememberRenderedUrl(pageItem: PdfPageItem, url: string) {
  // 先清理已被外部回收（releaseDistantPageUrls / releaseBookPageUrls）的陈旧记录，避免误淘汰仍在显示的页
  for (let i = renderedUrls.length - 1; i >= 0; i--) {
    const entry = renderedUrls[i];
    if (entry.pageItem.url !== entry.url || entry.url === url) {
      renderedUrls.splice(i, 1);
    }
  }
  renderedUrls.push({ pageItem, url });
  while (renderedUrls.length > MAX_CACHED_PAGES) {
    const evicted = renderedUrls.shift()!;
    if (evicted.pageItem.url === evicted.url) {
      URL.revokeObjectURL(evicted.url);
      evicted.pageItem.url = '';
    }
  }
}

export function clampPdfRenderScale(baseWidth: number, baseHeight: number, targetWidth: number): number {
  const safeWidth = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1;
  const safeHeight = Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : 1;
  let scale = Math.min(targetWidth / safeWidth, MAX_UPSCALE);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  const edgeLimit = Math.min(MAX_CANVAS_EDGE / safeWidth, MAX_CANVAS_EDGE / safeHeight);
  const pixelLimit = Math.sqrt(MAX_CANVAS_PIXELS / (safeWidth * safeHeight));
  return Math.max(0.05, Math.min(scale, edgeLimit, pixelLimit));
}

async function renderPageBlob(pdfDoc: PdfDocLike, pageIndex: number, targetWidth: number): Promise<Blob> {
  const page = await pdfDoc.getPage(pageIndex + 1);
  const canvas = document.createElement('canvas');
  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = clampPdfRenderScale(baseViewport.width, baseViewport.height, targetWidth);
    const viewport = page.getViewport({ scale });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('无法创建页面渲染上下文');
    // 深色主题下 PDF 也保持纸面白底，与真实版面一致
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('页面位图生成失败');
    return blob;
  } finally {
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
}

// ---- 对外接口 ----

export async function destroyPdfDocument(pdfDoc: unknown): Promise<void> {
  const doc = pdfDoc as PdfDocLike | null | undefined;
  if (!doc) return;
  if (typeof doc.loadingTask?.destroy === 'function') {
    await doc.loadingTask.destroy();
  } else if (typeof doc.destroy === 'function') {
    await doc.destroy();
  }
}

function attachLoadingTask(doc: PdfDocLike, task: { destroy(): Promise<void> }): PdfDocLike {
  if (doc && typeof doc === 'object' && !doc.loadingTask) {
    try {
      doc.loadingTask = task;
    } catch {
      // 某些代理对象不可扩展时，调用方仍可走 doc.destroy()
    }
  }
  return doc;
}

// 打开 PDF：大文件走 File.slice 按需 Range 读取，避免整本读入 ArrayBuffer 触发内存溢出
export async function openPdfDocument(file: PdfFileLike): Promise<PdfDocLike> {
  const pdfjs = (await loadPdfjs())!;
  const size = Number(file.size);
  if (Number.isSafeInteger(size) && size > LOCAL_RANGE_THRESHOLD_BYTES && typeof file.slice === 'function') {
    const sliceFn = file.slice.bind(file);
    const opened = await openRemotePdfDocument({
      size,
      async read(start: number, end: number) {
        const safeStart = Math.max(0, start);
        const safeEnd = Math.min(size, end);
        if (safeStart >= safeEnd) return new Uint8Array(0);
        return new Uint8Array(await sliceFn(safeStart, safeEnd).arrayBuffer());
      }
    }, LOCAL_RANGE_CHUNK_SIZE);
    return attachLoadingTask(opened.document, { destroy: opened.destroy });
  }

  const data = await file.arrayBuffer();
  // CMap / 标准字体 / wasm 解码器由 vite-static-copy 放在 dist/pdfjs 下：
  // 缺了它们，CJK 非嵌入字体和 JPX/JBIG2 扫描页都会渲染成空白
  const assetBase = new URL('pdfjs/', document.baseURI).href;
  const task = pdfjs.getDocument({
    data,
    // 关掉 eval 渲染路径，降低恶意 PDF 注入脚本的风险
    isEvalSupported: false,
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    iccUrl: assetBase + 'iccs/'
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = (await task.promise) as unknown as PdfDocLike;
    return attachLoadingTask(doc, task);
  } catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  }
}

// Range 传输由 WebDAV 客户端或本地分块读取器提供；禁用自动取全书和后台连续下载。
export async function openRemotePdfDocument(source: import('./webdavBooks.ts').RangeSource, chunkSize = 128 * 1024) {
  const pdfjs = await loadPdfjs();
  const assetBase = new URL('pdfjs/', document.baseURI).href;
  let task: ReturnType<typeof pdfjs.getDocument>;
  class RemoteTransport extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      const safeStart = Math.max(0, Math.floor(begin));
      const safeEnd = Math.min(source.size, Math.floor(end));
      if (safeStart >= safeEnd) {
        this.onDataRange(safeStart, new Uint8Array(0));
        return;
      }
      void source.read(safeStart, safeEnd).then(bytes => this.onDataRange(safeStart, bytes)).catch(() => {
        void task.destroy().catch(() => {});
      });
    }
  }
  const transport = new RemoteTransport(source.size, new Uint8Array(), false);
  task = pdfjs.getDocument({
    range: transport, rangeChunkSize: chunkSize,
    disableAutoFetch: true, disableStream: true, isEvalSupported: false,
    cMapUrl: assetBase + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/', wasmUrl: assetBase + 'wasm/', iccUrl: assetBase + 'iccs/'
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = attachLoadingTask(await task.promise as unknown as PdfDocLike, task);
    return { document: doc as unknown as PdfDocLike & { numPages: number }, destroy: () => task.destroy() };
  } catch (error) { await task.destroy().catch(() => {}); throw error; }
}

// 生成漫画管道可用的 pageItems：每项自带 render()，首次显示时才真正渲染
export function createPdfPageItems(pdfDoc: PdfDocLike, pageCount: number): PdfPageItem[] {
  const items: PdfPageItem[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const item: PdfPageItem = { render: async () => '', pdfPageIndex: pageIndex };
    item.render = async () => {
      try {
        const blob = await renderPageBlob(pdfDoc, pageIndex, RENDER_TARGET_WIDTH);
        const url = URL.createObjectURL(blob as Blob);
        rememberRenderedUrl(item, url);
        return url;
      } catch (err) {
        console.error('[HOMURA] PDF 页面渲染失败', pageIndex, err);
        return '';
      }
    };
    items.push(item);
  }
  return items;
}

// 封面取第一页的缩略渲染，返回值由调用方转成 Blob URL
export function renderPdfCoverBlob(pdfDoc: PdfDocLike): Promise<Blob> {
  return renderPageBlob(pdfDoc, 0, COVER_TARGET_WIDTH);
}
