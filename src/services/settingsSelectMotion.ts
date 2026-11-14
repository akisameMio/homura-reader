/* ============================================================================
   HOMURA · 设置菜单的果冻弹射与动量交接
   ----------------------------------------------------------------------------
   菜单从胶囊右上角弹出，缩回接触时给胶囊施加冲量。
   两个物理轴共用一条 rAF；反向只换目标，保留当前位置和速度。
   ========================================================================== */

import { axesSettled, makeAxis, prefersReducedMotion, snapAxes, stepAxes } from './spring.ts';

interface SelectMotionElements {
  control: () => HTMLElement | null;
  menu: () => HTMLElement | null;
  onClosed: () => void;
}

interface MenuAnchor {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

const MENU_OPEN = { stiffness: 400, damping: 0.58 };
const MENU_CLOSE = { stiffness: 500, damping: 0.85 };
const IMPACT = { stiffness: 450, damping: 0.55 };
const CONTACT_PROGRESS = 0.055;
const POSITION_EPSILON = 0.001;
const VELOCITY_EPSILON = 0.01;

export function createSettingsSelectMotion(elements: SelectMotionElements) {
  const menu = makeAxis(0, MENU_OPEN.stiffness);
  const impact = makeAxis(0, IMPACT.stiffness);
  let anchor: MenuAnchor | null = null;
  let frame = 0;
  let lastTime = 0;
  let targetOpen = false;
  let impactArmed = false;
  let excursion = 0;
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
      scaleY: rect.height / height
    };
  }

  function draw() {
    const controlElement = elements.control();
    if (controlElement) {
      const compression = Math.max(-1, Math.min(1, impact.pos));
      controlElement.style.transform = impact.pos === 0 && impact.vel === 0 ? ''
        : `translate3d(${-10 * impact.pos}px, ${7 * impact.pos}px, 0) scale(${1 - 0.08 * compression}, ${1 + 0.07 * compression})`;
      controlElement.style.willChange = settled(impact) ? '' : 'transform';
    }
    const menuElement = elements.menu();
    if (!menuElement || !anchor) return;
    const progress = menu.pos;
    const jelly = Math.min(1, Math.abs(menu.vel) / 6);
    const scaleX = Math.max(0.02, anchor.scaleX + (1 - anchor.scaleX) * progress) * (1 + 0.08 * jelly);
    const scaleY = Math.max(0.02, anchor.scaleY + (1 - anchor.scaleY) * progress) * (1 - 0.05 * jelly);
    menuElement.style.opacity = String(Math.max(0, Math.min(1, progress / 0.18)));
    menuElement.style.transform = `translate3d(${anchor.x * (1 - progress)}px, ${anchor.y * (1 - progress)}px, 0) scale(${scaleX}, ${scaleY})`;
    menuElement.style.willChange = settled(menu) ? '' : 'transform, opacity';
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
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.032));
    lastTime = now;
    if (!settled(menu)) stepAxes([menu], dt, targetOpen ? MENU_OPEN.damping : MENU_CLOSE.damping);
    excursion = Math.max(excursion, menu.pos);
    if (!targetOpen && impactArmed && menu.pos <= CONTACT_PROGRESS && menu.vel < 0) {
      impactArmed = false;
      // 将钻回时的剩余速度交给胶囊；仅短暂展开就反向时，按行程减轻冲击。
      const impulse = Math.min(44, Math.max(40, Math.abs(menu.vel) * 32));
      impact.vel += impulse * Math.min(1, excursion / 0.45);
    }
    if (!settled(impact)) stepAxes([impact], dt, IMPACT.damping);
    if (settled(menu)) snapAxes([menu]);
    if (settled(impact)) snapAxes([impact]);
    draw();
    if (settled(menu) && settled(impact)) complete();
    else frame = requestAnimationFrame(tick);
  }

  function settle() {
    cancel();
    impactArmed = false;
    snapAxes([menu, impact]);
    draw();
    complete();
  }

  function setOpen(open: boolean, immediate = false) {
    if (disposed) return;
    if (open && !anchor) captureAnchor();
    if (open !== targetOpen) {
      impactArmed = !open && (menu.pos > POSITION_EPSILON || Math.abs(menu.vel) > VELOCITY_EPSILON);
      if (open) excursion = Math.max(0, menu.pos);
    }
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
    const controlElement = elements.control();
    const menuElement = elements.menu();
    if (controlElement) {
      controlElement.style.transform = '';
      controlElement.style.willChange = '';
    }
    if (menuElement) menuElement.style.willChange = '';
  }

  return { setOpen, dispose };
}
