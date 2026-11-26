/* ============================================================================
   HOMURA · PDF 书签目录
   ----------------------------------------------------------------------------
   把 pdf.js 的 outline 树压平成可跳转条目。不 import pdfjs，便于单测；
   dest 解析顺序与 pdf.js 自己的 goToDestination 保持一致：
   字符串 → getDestination()；数组首项是 Ref → getPageIndex()；整数按 0-based 页索引。
   ========================================================================== */

import type { PdfOutlineEntry } from '../types.ts';

/** pdf.js outline 节点与文档方法的最小结构 */
interface PdfOutlineNode {
  title?: unknown;
  dest?: unknown;
  url?: unknown;
  items?: unknown;
}

interface PdfOutlineDoc {
  numPages?: number;
  getOutline?(): Promise<unknown[] | null>;
  getDestination?(id: string): Promise<unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
}

const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_DEPTH = 8;

function clampBound(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export async function readPdfOutline(
  doc: PdfOutlineDoc | null | undefined,
  options: { maxEntries?: number; maxDepth?: number } = {}
): Promise<PdfOutlineEntry[]> {
  const readOutline = doc?.getOutline;
  if (!doc || typeof readOutline !== 'function') return [];
  // 闭包里沿用窄化后的引用，避免 TS 在嵌套函数中重新放宽为可空
  const pdfDoc = doc;
  const maxEntries = clampBound(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, DEFAULT_MAX_ENTRIES);
  const maxDepth = clampBound(options.maxDepth, DEFAULT_MAX_DEPTH, 0, DEFAULT_MAX_DEPTH);

  let nodes: unknown[] | null;
  try {
    nodes = await readOutline.call(pdfDoc);
  } catch {
    return [];
  }
  if (!Array.isArray(nodes)) return [];

  let produced = 0;

  async function resolvePage(dest: unknown): Promise<number | null> {
    let explicit = dest;
    if (typeof explicit === 'string') {
      if (!pdfDoc.getDestination) return null;
      try {
        explicit = await pdfDoc.getDestination(explicit);
      } catch {
        return null;
      }
    }
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    let index: number | null = null;
    if (typeof ref === 'number' && Number.isSafeInteger(ref)) {
      index = ref;
    } else if (ref && typeof ref === 'object' && pdfDoc.getPageIndex) {
      try {
        const resolved = await pdfDoc.getPageIndex(ref);
        index = Number.isSafeInteger(resolved) ? resolved : null;
      } catch {
        return null;
      }
    }
    if (index == null || index < 0) return null;
    const page = index + 1;
    const total = Number(pdfDoc.numPages) || 0;
    return total > 0 ? Math.min(page, total) : page;
  }

  async function walk(list: unknown, depth: number): Promise<PdfOutlineEntry[]> {
    const result: PdfOutlineEntry[] = [];
    if (!Array.isArray(list) || depth > maxDepth || produced >= maxEntries) return result;
    for (const node of list as PdfOutlineNode[]) {
      if (produced >= maxEntries) break;
      if (!node || typeof node !== 'object') continue;
      const title = typeof node.title === 'string' ? node.title.trim() : '';
      const ownPage = await resolvePage(node.dest);
      const childEntries = depth < maxDepth ? await walk(node.items, depth + 1) : [];
      // 父节点没有自己的 dest 时，继承第一个可跳转子项的页码
      const page = ownPage ?? childEntries.find(entry => entry.page != null)?.page ?? null;
      if (title && page != null) {
        produced += 1;
        result.push({ title, page, depth });
      }
      for (const entry of childEntries) {
        if (produced >= maxEntries) break;
        produced += 1;
        result.push(entry);
      }
    }
    return result;
  }

  return walk(nodes, 0);
}
