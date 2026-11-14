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
  const control = { style: {}, getBoundingClientRect: () => ({ right: 800, top: 212, width: 96, height: 36 }) };
  const menu = { style: {}, offsetLeft: 568, offsetTop: 212, offsetWidth: 224, offsetHeight: 240 };
  const motion = createSettingsSelectMotion({ control: () => control, menu: () => menu, onClosed: () => closed++ });
  const step = (ms = 1000 / 120) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
    assert.ok(frames.size <= 1, '菜单与胶囊共用一条物理更新循环');
  };
  const advance = (ms, frameMs = 1000 / 120) => {
    for (let elapsed = 0; elapsed < ms; elapsed += frameMs) step(frameMs);
  };
  try {
    run({ motion, control, menu, step, advance, frames, listeners, media, closed: () => closed });
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

function menuProgress(menu) {
  return 1 - controlPose(menu).x / 8;
}

test('菜单从胶囊右上角与尺寸出发，展开有过冲和速度形变，最终恢复比例', () => fixture(({ motion, control, menu, step, advance, frames }) => {
  motion.setOpen(true);
  const initial = controlPose(menu);
  assert.equal(initial.x, 8);
  assert.equal(initial.y, 0);
  assert.equal(initial.sx, 96 / 224);
  assert.equal(initial.sy, 36 / 240);
  let progressPeak = 0;
  let stretchPeak = 1;
  let squashMin = 1;
  for (let frame = 0; frame < 160; frame++) {
    step();
    const progress = menuProgress(menu);
    const pose = controlPose(menu);
    const stretch = pose.sx / (96 / 224 + (1 - 96 / 224) * progress);
    const squash = pose.sy / (36 / 240 + (1 - 36 / 240) * progress);
    progressPeak = Math.max(progressPeak, progress);
    stretchPeak = Math.max(stretchPeak, stretch);
    squashMin = Math.min(squashMin, squash);
    assert.ok(Number(menu.style.opacity) >= 0 && Number(menu.style.opacity) <= 1);
    assert.equal(control.style.transform, '', '展开阶段胶囊不提前承受关闭冲击');
  }
  assert.ok(progressPeak > 1.05 && progressPeak < 1.15, String(progressPeak));
  assert.ok(Math.abs(stretchPeak - 1.08) < 1e-10);
  assert.ok(Math.abs(squashMin - 0.95) < 1e-10);
  advance(1000);
  assert.deepEqual(controlPose(menu), { x: 0, y: 0, sx: 1, sy: 1 });
  assert.equal(frames.size, 0);
}));

test('菜单接近缩回锚点才交接动量，胶囊左下挤压后回跳归零', () => fixture(({ motion, control, menu, step, advance, frames, closed }) => {
  motion.setOpen(true);
  advance(1500);
  motion.setOpen(false);
  assert.equal(control.style.transform, '');
  let contact = false;
  let compressionPeak = 1;
  let stretchPeak = 1;
  let bounced = false;
  for (let frame = 0; frame < 200; frame++) {
    step();
    const pose = controlPose(control);
    if (!contact && pose.y > 0) {
      contact = true;
      assert.ok(menuProgress(menu) <= 0.055, '只在钻回时承接动量');
      assert.ok(pose.x < 0);
    }
    compressionPeak = Math.min(compressionPeak, pose.sx);
    stretchPeak = Math.max(stretchPeak, pose.sy);
    if (contact && pose.y < 0) bounced = true;
  }
  assert.ok(contact);
  assert.ok(compressionPeak <= 0.93 && compressionPeak >= 0.92);
  assert.ok(stretchPeak >= 1.06 && stretchPeak <= 1.07);
  assert.ok(bounced, '胶囊越过原点后回弹收敛');
  advance(1000);
  assert.equal(control.style.transform, '');
  assert.equal(Number(menu.style.opacity), 0);
  assert.equal(frames.size, 0);
  assert.equal(closed(), 1);
}));

test('菜单反向保留当前位置和速度，胶囊冲击途中重开也不重置姿态', () => fixture(({ motion, control, menu, step, advance, closed }) => {
  motion.setOpen(true);
  advance(50);
  const beforeClose = menu.style.transform;
  const openingPosition = menuProgress(menu);
  motion.setOpen(false);
  assert.equal(menu.style.transform, beforeClose);
  step(1);
  assert.ok(menuProgress(menu) > openingPosition, '关闭首帧继承原展开速度');
  advance(90);
  const beforeOpen = menu.style.transform;
  const closingPosition = menuProgress(menu);
  motion.setOpen(true);
  assert.equal(menu.style.transform, beforeOpen);
  step(1);
  assert.ok(menuProgress(menu) < closingPosition, '重开首帧继承原收缩速度');
  advance(1500);
  motion.setOpen(false);
  for (let frame = 0; frame < 100 && controlPose(control).y === 0; frame++) step();
  const impactPose = control.style.transform;
  assert.ok(controlPose(control).y > 0);
  const menuPose = menu.style.transform;
  motion.setOpen(true);
  assert.equal(control.style.transform, impactPose);
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

test('减少动态效果时跳过弹射与冲击，中途启用也立即落位', () => fixture(({ motion, control, menu, step, media, listeners, frames, closed }) => {
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

test('立即关闭与卸载取消残余物理帧，不产生延迟冲击', () => fixture(({ motion, control, advance, frames, listeners, closed }) => {
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
