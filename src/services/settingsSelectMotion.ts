/* ============================================================================
   HOMURA · 设置选择器容器形变
   ----------------------------------------------------------------------------
   固定定位的外壳直接插值四条边，文字保持原字号，在外壳内部交替显现。
   ========================================================================== */

interface SelectMotionElements {
  control: () => HTMLElement | null;
  menu: () => HTMLElement | null;
  pill: () => HTMLElement | null;
  list: () => HTMLElement | null;
  onClosed: () => void;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Pose extends Bounds {
  radius: number;
  elevation: number;
  pillOpacity: number;
  listOpacity: number;
}

const VIEWPORT_INSET = 12;
const MENU_WIDTH = 224;
const MENU_RADIUS = 24;
const MENU_MAX_HEIGHT = 320;
const OPTION_HEIGHT = 56;
const MENU_PADDING = 16;

function expandedBounds(pill: Bounds, optionCount: number): Bounds {
  const viewport = window.visualViewport;
  const leftLimit = (viewport?.offsetLeft ?? 0) + VIEWPORT_INSET;
  const topLimit = (viewport?.offsetTop ?? 0) + VIEWPORT_INSET;
  const rightLimit = leftLimit + (viewport?.width ?? window.innerWidth) - 2 * VIEWPORT_INSET;
  const bottomLimit = topLimit + (viewport?.height ?? window.innerHeight) - 2 * VIEWPORT_INSET;
  const height = Math.min(MENU_MAX_HEIGHT, optionCount * OPTION_HEIGHT + MENU_PADDING);
  const right = Math.min(pill.right, rightLimit);
  const left = Math.max(leftLimit, right - Math.max(MENU_WIDTH, pill.right - pill.left));

  // 下方至少留出一整行才保持原上沿。靠近视口底部时向上让出滚动空间。
  const spaceBelow = bottomLimit - pill.top;
  const top = Math.max(topLimit, spaceBelow >= OPTION_HEIGHT + MENU_PADDING
    ? pill.top
    : Math.min(pill.top, bottomLimit - Math.min(height, 2 * OPTION_HEIGHT + MENU_PADDING)));
  return { left, top, right, bottom: Math.min(bottomLimit, top + height) };
}

function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function fade(progress: number, start: number, end: number) {
  const value = Math.max(0, Math.min(1, (progress - start) / (end - start)));
  return value * value * (3 - 2 * value);
}

export function createSettingsSelectMotion(elements: SelectMotionElements) {
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let expanded: Bounds | null = null;
  let current: Pose | null = null;
  let targetOpen = false;
  let frame = 0;
  let finish: (() => void) | null = null;

  function cancel() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    finish = null;
  }

  function closeMenu() {
    cancel();
    const menu = elements.menu();
    const control = elements.control();
    if (menu) menu.style.opacity = '0';
    if (control) control.style.opacity = '';
    current = null;
    expanded = null;
    elements.onClosed();
  }

  function setOpen(open: boolean, optionCount: number, immediate = false) {
    const control = elements.control();
    const menu = elements.menu();
    const pill = elements.pill();
    const list = elements.list();
    if (!open && (immediate || motionQuery?.matches || !current)) {
      closeMenu();
      return;
    }
    if (!control || !menu || !pill || !list || (current && targetOpen === open)) return;

    cancel();
    targetOpen = open;
    const rect = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    const collapsed = {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      radius: Math.min(parseFloat(style.borderTopRightRadius || '999'), rect.height / 2, rect.width / 2),
      elevation: 0, pillOpacity: 1, listOpacity: 0
    };
    expanded ??= expandedBounds(collapsed, optionCount);
    const from = current ?? collapsed;
    const to = open
      ? { ...expanded, radius: MENU_RADIUS, elevation: 1, pillOpacity: 0, listOpacity: 1 }
      : collapsed;
    const fromColor = current ? getComputedStyle(menu).backgroundColor : style.backgroundColor;
    const toColor = open ? 'var(--md-select-menu-surface)' : style.getPropertyValue('--settings-select-control-surface').trim() || style.backgroundColor;
    pill.style.width = `${rect.width}px`;
    pill.style.height = `${rect.height}px`;
    pill.style.font = style.font;
    list.style.width = `${expanded.right - expanded.left}px`;
    list.style.height = `${expanded.bottom - expanded.top}px`;

    const draw = (time: number) => {
      const progress = 1 - (1 - time) ** 3;
      const pose = {
        left: mix(from.left, to.left, progress),
        top: mix(from.top, to.top, progress),
        right: mix(from.right, to.right, progress),
        bottom: mix(from.bottom, to.bottom, progress),
        radius: mix(from.radius, to.radius, progress),
        elevation: mix(from.elevation, to.elevation, progress),
        pillOpacity: mix(from.pillOpacity, to.pillOpacity, open ? fade(time, 0, 0.25) : fade(time, 0.55, 1)),
        listOpacity: mix(from.listOpacity, to.listOpacity, open ? fade(time, 0.25, 0.75) : fade(time, 0, 0.3))
      };
      current = pose;
      menu.style.left = `${pose.left}px`;
      menu.style.top = `${pose.top}px`;
      menu.style.width = `${pose.right - pose.left}px`;
      menu.style.height = `${pose.bottom - pose.top}px`;
      menu.style.borderRadius = `${pose.radius}px`;
      menu.style.setProperty('--settings-select-menu-elevation', String(pose.elevation));
      menu.style.backgroundColor = time === 0 ? fromColor : time === 1 ? toColor
        : `color-mix(in oklab, ${fromColor} ${(1 - progress) * 100}%, ${toColor})`;
      pill.style.opacity = String(pose.pillOpacity);
      pill.style.filter = `blur(${6 * (1 - pose.pillOpacity)}px)`;
      list.style.opacity = String(pose.listOpacity);
      list.style.filter = `blur(${6 * (1 - pose.listOpacity)}px)`;
    };

    finish = () => {
      cancel();
      draw(1);
      if (!open) closeMenu();
    };

    draw(0);
    control.style.opacity = '0';
    menu.style.opacity = '1';
    if (immediate || motionQuery?.matches) {
      finish();
      return;
    }

    // 反向时从当前四条边与内容透明度开始，缩短剩余路程的时长。
    const duration = (open ? 280 : 220) * Math.max(0.4, Math.abs(to.elevation - from.elevation));
    const start = performance.now();
    const tick = (now: number) => {
      const time = Math.min(1, Math.max(0, (now - start) / duration));
      if (time === 1) finish?.();
      else {
        draw(time);
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
  }

  function onMotionChange() {
    if (motionQuery?.matches) finish?.();
  }
  motionQuery?.addEventListener('change', onMotionChange);

  function dispose() {
    cancel();
    motionQuery?.removeEventListener('change', onMotionChange);
    const control = elements.control();
    if (control) control.style.opacity = '';
  }

  return { setOpen, dispose };
}
