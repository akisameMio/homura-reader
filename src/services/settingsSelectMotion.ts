/* ============================================================================
   HOMURA · 设置菜单的果冻弹射与下方归位
   ----------------------------------------------------------------------------
   卡片向左下拉出再回弹至选中项锚点，关闭时先下探再向上合回。
   外壳拉伸而内容反向补偿，快速移动时模糊，文字退去后保留囊状外壳。
   收起时向上合回胶囊，胶囊仅交叉淡入淡出，不产生位移或回弹。
   单个物理轴驱动 rAF；反向只换目标，保留菜单当前位置和速度。
   ========================================================================== */

import { axesSettled, makeAxis, prefersReducedMotion, snapAxes, stepAxes } from './spring.ts';

interface SelectMotionElements {
  control: () => HTMLElement | null;
  menu: () => HTMLElement | null;
  content: () => HTMLElement | null;
  onClosed: () => void;
}

interface MenuAnchor {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  radius: number;
  drop: number;
  drift: number;
}

const MENU_OPEN = { stiffness: 400, damping: 0.58 };
const MENU_CLOSE = { stiffness: 500, damping: 0.85 };
// 放慢模拟时钟，保留原有弹性、形变和中断时的速度连续性。
const MOTION_RATE = 0.8;
const POSITION_EPSILON = 0.001;
const VELOCITY_EPSILON = 0.01;

export function createSettingsSelectMotion(elements: SelectMotionElements) {
  const menu = makeAxis(0, MENU_OPEN.stiffness);
  let anchor: MenuAnchor | null = null;
  let frame = 0;
  let lastTime = 0;
  let targetOpen = false;
  let disposed = false;
  let closedNotified = false;
  const motionQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;

  function settled(axis: typeof menu) {
    return axesSettled([axis], POSITION_EPSILON, VELOCITY_EPSILON);
  }

  function captureAnchor() {
    const controlElement = elements.control();
    const menuElement = elements.menu();
    if (!controlElement || !menuElement) return;
    const rect = controlElement.getBoundingClientRect();
    const width = Math.max(1, menuElement.offsetWidth);
    const height = Math.max(1, menuElement.offsetHeight);
    // 使用未变换的菜单布局尺寸；反向重开时沿用原锚点，避免中途跳位。
    anchor = {
      x: rect.right - menuElement.offsetLeft - width,
      y: rect.top - menuElement.offsetTop,
      scaleX: rect.width / width,
      scaleY: rect.height / height,
      radius: rect.height / 2,
      drop: Math.min(104, height * 0.4),
      drift: Math.min(24, width * 0.1)
    };
  }

  function smoothOpacity(value: number) {
    const progress = Math.max(0, Math.min(1, value));
    return progress * progress * (3 - 2 * progress);
  }

  function draw() {
    const menuElement = elements.menu();
    if (!menuElement || !anchor) return;
    const progress = menu.pos;
    const bounded = Math.max(0, Math.min(1, progress));
    const moving = !settled(menu);
    // 两端的值与导数都为零，下探与反向归位不会在过冲处折断轨迹。
    const lobe = 16 * bounded * bounded * (1 - bounded) * (1 - bounded);
    const speed = Math.abs(menu.vel);
    const jelly = Math.min(1, speed / 6);
    const scaleX = Math.max(0.02, anchor.scaleX + (1 - anchor.scaleX) * progress) * (1 + 0.08 * jelly);
    const scaleY = Math.max(0.02, anchor.scaleY + (1 - anchor.scaleY) * progress) * (1 - 0.05 * jelly);
    const radius = anchor.radius + (28 - anchor.radius) * bounded + 28 * lobe;
    const x = anchor.x * (1 - progress) - anchor.drift * lobe;
    const y = anchor.y * (1 - progress) + anchor.drop * lobe;
    menuElement.style.opacity = String(smoothOpacity(progress / 0.14));
    menuElement.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scaleX}, ${scaleY})`;
    // 补偿非等比缩放，收拢时仍是饱满胶囊，避免圆角被压成扁椭圆。
    menuElement.style.borderRadius = `${radius / scaleX}px / ${radius / scaleY}px`;
    menuElement.style.overflowY = moving ? 'hidden' : 'auto';
    menuElement.style.willChange = moving ? 'transform, opacity' : '';
    const contentElement = elements.content();
    if (contentElement) {
      // 文字与外壳分层：抵消外壳挤压，速度越大越模糊，落位时恢复清晰。
      const inkScale = 0.96 + 0.04 * progress;
      contentElement.style.transform = `scale(${inkScale / scaleX}, ${inkScale / scaleY})`;
      contentElement.style.opacity = String(smoothOpacity((progress - 0.2) / 0.6));
      contentElement.style.filter = moving ? `blur(${Math.min(10, speed * 0.85 + (1 - bounded) * 3)}px)` : '';
      contentElement.style.willChange = moving ? 'transform, opacity, filter' : '';
    }
    const controlElement = elements.control();
    if (controlElement) {
      controlElement.style.opacity = progress === 0 && menu.vel === 0 ? '' : String(1 - smoothOpacity((progress + menu.vel * 0.03) / 0.55));
      controlElement.style.willChange = moving ? 'opacity' : '';
    }
  }

  function complete() {
    if (!targetOpen && !closedNotified) {
      closedNotified = true;
      elements.onClosed();
      anchor = null;
    }
  }

  function cancel() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function tick(now: number) {
    frame = 0;
    if (disposed) return;
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.032)) * MOTION_RATE;
    lastTime = now;
    if (!settled(menu)) stepAxes([menu], dt, targetOpen ? MENU_OPEN.damping : MENU_CLOSE.damping);
    if (settled(menu)) snapAxes([menu]);
    draw();
    if (settled(menu)) complete();
    else frame = requestAnimationFrame(tick);
  }

  function settle() {
    cancel();
    snapAxes([menu]);
    draw();
    complete();
  }

  function setOpen(open: boolean, immediate = false) {
    if (disposed) return;
    if (open && !anchor) captureAnchor();
    targetOpen = open;
    closedNotified = false;
    menu.target = open ? 1 : 0;
    menu.stiffness = open ? MENU_OPEN.stiffness : MENU_CLOSE.stiffness;
    if (immediate || prefersReducedMotion()) {
      settle();
      return;
    }
    draw();
    if (!frame) {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function onMotionChange() {
    if (motionQuery?.matches) settle();
  }
  motionQuery?.addEventListener('change', onMotionChange);

  function dispose() {
    disposed = true;
    cancel();
    motionQuery?.removeEventListener('change', onMotionChange);
    const menuElement = elements.menu();
    const contentElement = elements.content();
    const controlElement = elements.control();
    if (menuElement) menuElement.style.willChange = '';
    if (contentElement) contentElement.style.willChange = '';
    if (controlElement) {
      controlElement.style.opacity = '';
      controlElement.style.willChange = '';
    }
  }

  return { setOpen, dispose };
}
