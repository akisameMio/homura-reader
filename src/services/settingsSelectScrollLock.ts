/* ============================================================================
   HOMURA · 设置菜单的背景滚动锁
   ----------------------------------------------------------------------------
   多个菜单交替开合时共享锁，最后一张卡片收缩完成后才恢复滚动容器。
   ========================================================================== */

interface LockedScroller {
  count: number;
  top: number;
  left: number;
  styles: Array<{ name: string; value: string; priority: string }>;
}

const scrollers = new Map<HTMLElement, LockedScroller>();
const menus = new Set<() => HTMLElement | null>();
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

function isMenuTarget(target: EventTarget | null) {
  return target instanceof Node && [...menus].some(getMenu => getMenu()?.contains(target));
}

function preventBackgroundScroll(event: WheelEvent | TouchEvent) {
  if (isMenuTarget(event.target)) return;
  event.preventDefault();
  // 同时拦住背景的自定义滚动回弹手势。
  event.stopPropagation();
}

function preventScrollKey(event: KeyboardEvent) {
  if (!scrollKeys.has(event.key) || isMenuTarget(event.target)) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
}

function restoreScrollPosition(event: Event) {
  const element = event.target === document ? document.documentElement : event.target;
  if (!(element instanceof HTMLElement)) return;
  const saved = scrollers.get(element);
  if (!saved) return;
  if (element.scrollTop !== saved.top) element.scrollTop = saved.top;
  if (element.scrollLeft !== saved.left) element.scrollLeft = saved.left;
}

export function lockSettingsSelectScroll(trigger: HTMLElement, getMenu: () => HTMLElement | null) {
  const desktop = window.innerWidth >= 900;
  const targets = new Set<HTMLElement>([document.documentElement]);
  for (let element = trigger.parentElement; element; element = element.parentElement) {
    // body 不能变成新的滚动容器，否则会改变背景 sticky 元素的参照。
    if (element === document.body) continue;
    const style = getComputedStyle(element);
    if (scrollers.has(element) || /(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)) targets.add(element);
  }

  for (const element of targets) {
    const existing = scrollers.get(element);
    if (existing) {
      existing.count += 1;
      continue;
    }
    scrollers.set(element, {
      count: 1,
      top: element.scrollTop,
      left: element.scrollLeft,
      styles: ['overflow-x', 'overflow-y', 'scrollbar-gutter', 'scroll-behavior'].map(name => ({
        name,
        value: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name)
      }))
    });
    element.style.setProperty('scroll-behavior', 'auto');
    // 桌面保留原滚动条；拖动滚动条或焦点引起的位移由捕获监听归位。
    if (!desktop) {
      element.style.setProperty('scrollbar-gutter', 'stable');
      element.style.setProperty('overflow-x', 'hidden');
      element.style.setProperty('overflow-y', 'hidden');
    }
  }

  if (!menus.size) {
    document.addEventListener('wheel', preventBackgroundScroll, { capture: true, passive: false });
    document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false });
    document.addEventListener('keydown', preventScrollKey, true);
    document.addEventListener('scroll', restoreScrollPosition, true);
  }
  menus.add(getMenu);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    menus.delete(getMenu);
    for (const element of targets) {
      const saved = scrollers.get(element);
      if (!saved || --saved.count > 0) continue;
      for (const { name, value, priority } of saved.styles) {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
      scrollers.delete(element);
    }
    if (!menus.size) {
      document.removeEventListener('wheel', preventBackgroundScroll, true);
      document.removeEventListener('touchmove', preventBackgroundScroll, true);
      document.removeEventListener('keydown', preventScrollKey, true);
      document.removeEventListener('scroll', restoreScrollPosition, true);
    }
  };
}
