import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsSelectMotion } from '../src/services/settingsSelectMotion.ts';

function fixture(run, reduced = false) {
  const names = ['window', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const frames = new Map();
  const listeners = new Set();
  let now = 0;
  let sequence = 0;
  let closed = 0;
  const media = {
    matches: reduced,
    addEventListener(_event, listener) { listeners.add(listener); },
    removeEventListener(_event, listener) { listeners.delete(listener); }
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { matchMedia: () => media } },
    performance: { configurable: true, value: { now: () => now } },
    requestAnimationFrame: { configurable: true, value: callback => { frames.set(++sequence, callback); return sequence; } },
    cancelAnimationFrame: { configurable: true, value: id => frames.delete(id) }
  });
  const control = { style: { transform: '', opacity: '', willChange: '' }, getBoundingClientRect: () => ({ right: 800, top: 212, width: 96, height: 36 }) };
  const menu = { style: {}, offsetLeft: 568, offsetTop: 194, offsetWidth: 224, offsetHeight: 240 };
  const content = { style: {} };
  const motion = createSettingsSelectMotion({ control: () => control, menu: () => menu, content: () => content, onClosed: () => closed++ });
  const step = (ms = 1000 / 120) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
    assert.ok(frames.size <= 1, '菜单只保留一条物理更新循环');
  };
  const advance = (ms, frameMs = 1000 / 120) => {
    for (let elapsed = 0; elapsed < ms; elapsed += frameMs) step(frameMs);
  };
  try {
    run({ motion, control, menu, content, step, advance, frames, listeners, media, closed: () => closed });
  } finally {
    motion.dispose();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

function controlPose(control) {
  const transform = control.style.transform || '';
  const translate = transform.match(/translate3d\(([^p]+)px, ([^p]+)px/);
  const scale = transform.match(/scale\(([^,]+), ([^)]+)\)/);
  return { x: Number(translate?.[1] || 0), y: Number(translate?.[2] || 0), sx: Number(scale?.[1] || 1), sy: Number(scale?.[2] || 1) };
}

function menuProgress(menu, content) {
  return (controlPose(menu).sx * controlPose(content).sx - 0.96) / 0.04;
}

test('菜单从胶囊向左下拉出再回弹，带过冲、形变和文字模糊', () => fixture(({ motion, control, menu, content, step, advance, frames }) => {
  motion.setOpen(true);
  const initial = controlPose(menu);
  assert.equal(initial.x, 8);
  assert.equal(initial.y, 18);
  assert.equal(initial.sx, 96 / 224);
  assert.equal(initial.sy, 36 / 240);
  let progressPeak = 0;
  let stretchPeak = 1;
  let squashMin = 1;
  let hadBlur = false;
  let dropPeak = 0;
  let driftMin = 8;
  for (let frame = 0; frame < 160; frame++) {
    step();
    const progress = menuProgress(menu, content);
    const pose = controlPose(menu);
    hadBlur ||= Boolean(content.style.filter);
    dropPeak = Math.max(dropPeak, pose.y);
    driftMin = Math.min(driftMin, pose.x);
    const ink = controlPose(content);
    assert.ok(Math.abs(ink.sx * pose.sx - (0.96 + 0.04 * progress)) < 1e-10, '文字补偿外壳的横向挤压');
    assert.ok(Math.abs(ink.sy * pose.sy - (0.96 + 0.04 * progress)) < 1e-10, '文字补偿外壳的纵向挤压');
    const stretch = pose.sx / (96 / 224 + (1 - 96 / 224) * progress);
    const squash = pose.sy / (36 / 240 + (1 - 36 / 240) * progress);
    progressPeak = Math.max(progressPeak, progress);
    stretchPeak = Math.max(stretchPeak, stretch);
    squashMin = Math.min(squashMin, squash);
    assert.ok(Number(menu.style.opacity) >= 0 && Number(menu.style.opacity) <= 1);
    assert.equal(control.style.transform, '', '展开阶段胶囊保持静止');
  }
  assert.ok(hadBlur);
  assert.ok(dropPeak > 70, '先向下拉出再回弹到停驻位置');
  assert.ok(driftMin < -10, '展开中段向左偏移');
  assert.ok(progressPeak > 1.05 && progressPeak < 1.15, String(progressPeak));
  assert.ok(Math.abs(stretchPeak - 1.08) < 1e-10);
  assert.ok(Math.abs(squashMin - 0.95) < 1e-10);
  advance(1000);
  assert.deepEqual(controlPose(menu), { x: 0, y: 0, sx: 1, sy: 1 });
  assert.equal(content.style.filter, '');
  assert.equal(content.style.opacity, '1');
  assert.equal(control.style.opacity, '0');
  assert.equal(frames.size, 0);
}));

test('关闭先下探成圆囊再合回胶囊，胶囊仅淡入淡出且不形变', () => fixture(({ motion, control, menu, step, advance, frames, closed }) => {
  const initialControlStyle = { ...control.style };
  motion.setOpen(true);
  advance(1500);
  motion.setOpen(false);
  step();
  assert.ok(controlPose(menu).y > 0, '收起先下探');
  let dropPeak = 0;
  for (let frame = 0; frame < 200; frame++) {
    step();
    dropPeak = Math.max(dropPeak, controlPose(menu).y);
    assert.equal(control.style.transform, '', '胶囊不位移、不挤压');
  }
  assert.ok(dropPeak > 70, '下垂卡片随后向上合回');
  assert.deepEqual(control.style, initialControlStyle);
  const final = controlPose(menu);
  assert.equal(menu.offsetTop + final.y, 212, '缩回顶部匹配胶囊顶部');
  assert.equal(menu.offsetLeft + menu.offsetWidth + final.x, 800, '缩回右侧匹配胶囊右侧');
  assert.equal(menu.offsetWidth * final.sx, 96);
  assert.equal(menu.offsetHeight * final.sy, 36);
  assert.equal(Number(menu.style.opacity), 0);
  assert.equal(frames.size, 0);
  assert.equal(closed(), 1);
}));

test('菜单反向保留当前位置和速度，连续重开时胶囊仍保持静止', () => fixture(({ motion, control, menu, content, step, advance, closed }) => {
  motion.setOpen(true);
  advance(50);
  const beforeClose = menu.style.transform;
  const openingPosition = menuProgress(menu, content);
  motion.setOpen(false);
  assert.equal(menu.style.transform, beforeClose);
  step(1);
  assert.ok(menuProgress(menu, content) > openingPosition, '关闭首帧继承原展开速度');
  advance(90);
  const beforeOpen = menu.style.transform;
  const closingPosition = menuProgress(menu, content);
  motion.setOpen(true);
  assert.equal(menu.style.transform, beforeOpen);
  step(1);
  assert.ok(menuProgress(menu, content) < closingPosition, '重开首帧继承原收缩速度');
  advance(1500);
  motion.setOpen(false);
  advance(100);
  const menuPose = menu.style.transform;
  motion.setOpen(true);
  assert.equal(control.style.transform, '');
  assert.equal(menu.style.transform, menuPose);
  advance(1500);
  assert.equal(closed(), 0);
  assert.equal(control.style.transform, '');
}));

test('快速连续切换不重复发帧，低帧率下仍可收束且只回收一次', () => fixture(({ motion, control, advance, frames, closed }) => {
  for (let click = 0; click < 20; click++) {
    motion.setOpen(click % 2 === 0);
    advance(32, 32);
  }
  advance(2500, 32);
  assert.equal(frames.size, 0);
  assert.equal(closed(), 1);
  assert.equal(control.style.transform, '');
}));

test('减少动态效果时跳过弹射，中途启用也立即落位', () => fixture(({ motion, control, menu, step, media, listeners, frames, closed }) => {
  motion.setOpen(true);
  step();
  media.matches = true;
  listeners.forEach(listener => listener());
  assert.equal(control.style.transform, '');
  assert.deepEqual(controlPose(menu), { x: 0, y: 0, sx: 1, sy: 1 });
  assert.equal(Number(menu.style.opacity), 1);
  assert.equal(frames.size, 0);
  motion.setOpen(false);
  assert.equal(control.style.transform, '');
  assert.equal(closed(), 1);
  motion.dispose();
  assert.equal(listeners.size, 0);
}));

test('立即关闭与卸载取消残余物理帧，不改变胶囊姿态', () => fixture(({ motion, control, advance, frames, listeners, closed }) => {
  motion.setOpen(true);
  advance(50);
  motion.setOpen(false, true);
  assert.equal(closed(), 1);
  assert.equal(frames.size, 0);
  assert.equal(control.style.transform, '');
  motion.setOpen(true);
  advance(50);
  motion.dispose();
  assert.equal(control.style.transform, '');
  assert.equal(control.style.willChange, '');
  assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0);
  advance(1500);
  assert.equal(closed(), 1);
}));
