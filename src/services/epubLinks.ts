/* ============================================================================
   HOMURA · EPUB 正文链接
   ----------------------------------------------------------------------------
   书内地址以章节的压缩包路径为基准解析；锚点只在目标章内匹配，避免不同章节
   的重复 ID 串页。手势层通过可见链接矩形命中，不改变翻页舞台的事件层级。
   ========================================================================== */

import type { ChapterItem, ReaderPage } from '../types.ts';

export function resolveEpubLink(href: string, source: ChapterItem, chapters: ChapterItem[]) {
  const value = href.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const base = new URL(source.sourcePath || 'chapter.xhtml', 'https://epub.invalid/');
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    const path = decodeURIComponent(url.pathname.slice(1));
    const chapterIndex = value.startsWith('#') || value.startsWith('?')
      ? chapters.indexOf(source)
      : chapters.findIndex(chapter => chapter.sourcePath === path);
    if (chapterIndex < 0) return null;
    return { chapterIndex, fragment: decodeURIComponent(url.hash.slice(1)) };
  } catch {
    return null;
  }
}

export function findEpubLinkPage(pages: ReaderPage[], chapterIndex: number, fragment: string) {
  const first = pages.findIndex(page => page.chapterIndex === chapterIndex);
  if (!fragment) return first;
  for (let index = Math.max(0, first); index < pages.length; index++) {
    const page = pages[index];
    if (page.chapterIndex !== chapterIndex) continue;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = page.html || page.htmlContent || '';
    if (Array.from(wrapper.querySelectorAll('[id]')).some(element => element.id === fragment)) return index;
  }
  return -1;
}

export function epubLinkAtPoint(root: HTMLElement | null | undefined, x: number, y: number) {
  if (!root) return null;
  for (const link of root.querySelectorAll<HTMLAnchorElement>('.epub-content a[href]')) {
    if (Array.from(link.getClientRects()).some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return link;
  }
  return null;
}
