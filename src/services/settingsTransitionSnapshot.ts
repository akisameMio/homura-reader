/* 设置转场只复制视口附近的分组，屏外保留定高外壳，维持滚动位置和网格占位。 */
export function cloneSettingsTransitionPage(page: HTMLElement, viewport: { top: number; bottom: number }): HTMLElement {
  const hidden = new Map<Node, number>();
  const branches = new Set<Node>();
  const overscan = 32;
  for (const block of page.querySelectorAll<HTMLElement>('.settings-card, .settings-detail-hero, .settings-detail-group')) {
    const rect = block.getBoundingClientRect();
    if (!Number.isFinite(rect.height) || rect.height <= 0) continue;
    if (rect.bottom >= viewport.top - overscan && rect.top <= viewport.bottom + overscan) continue;
    hidden.set(block, rect.height);
    for (let parent = block.parentNode; parent && page.contains(parent); parent = parent.parentNode) {
      branches.add(parent);
    }
  }

  function copy(source: Node): Node {
    const height = hidden.get(source);
    if (height !== undefined) {
      const clone = source.cloneNode(false) as HTMLElement;
      Object.assign(clone.style, {
        height: `${height}px`, minHeight: `${height}px`, boxSizing: 'border-box',
        visibility: 'hidden', contentVisibility: 'hidden'
      });
      return clone;
    }
    if (!branches.has(source)) return source.cloneNode(true);
    const clone = source.cloneNode(false);
    for (const child of source.childNodes) clone.appendChild(copy(child));
    return clone;
  }

  return copy(page) as HTMLElement;
}
