import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsSelectMotion } from '../src/services/settingsSelectMotion.ts';

function fixture(run) {
  const names = ['window', 'getComputedStyle', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const frames = new Map();
  const listeners = new Set();
  const media = {
    matches: false,
    addEventListener(_event, listener) { listeners.add(listener); },
    removeEventListener(_event, listener) { listeners.delete(listener); }
  };
  let now = 0;
  let sequence = 0;
  let closed = 0;
  const viewport = { width: 1000, height: 600, offsetLeft: 0, offsetTop: 0 };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { visualViewport: viewport, matchMedia: () => media } },
    getComputedStyle: { configurable: true, value: element => element.style },
    performance: { configurable: true, value: { now: () => now } },
    requestAnimationFrame: { configurable: true, value: callback => { frames.set(++sequence, callback); return sequence; } },
    cancelAnimationFrame: { configurable: true, value: id => frames.delete(id) }
  });
  const element = (properties = {}) => ({
    style: {
      ...properties,
      setProperty(name, value) { this[name] = value; },
      getPropertyValue(name) { return this[name] ?? ''; }
    }
  });
  const bounds = { left: 703.75, top: 212.25, right: 800, bottom: 248.25, width: 96.25, height: 36 };
  const control = {
    ...element({ borderTopRightRadius: '999px', backgroundColor: 'transparent' }),
    getBoundingClientRect: () => bounds
  };
  const menu = element();
  const classes = new Set();
  const list = {
    ...element(),
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    }
  };
  const pill = element();
  const options = element();
  const motion = createSettingsSelectMotion({
    control: () => control, menu: () => menu, list: () => list, pill: () => pill,
    options: () => options, onClosed: () => closed++
  });
  const step = ms => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
    assert.ok(frames.size <= 1);
  };
  const setOpen = (open, immediate = false) => motion.setOpen(open, 4, immediate);
  try {
    run({ motion, setOpen, control, menu, list, pill, options, viewport, bounds, step, frames, listeners, media, closed: () => closed });
  } finally {
    motion.dispose();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

function edges(menu) {
  const { left, top, width, height } = menu.style;
  return [parseFloat(left), parseFloat(top), parseFloat(left) + parseFloat(width), parseFloat(top) + parseFloat(height)];
}

test('菜单从胶囊精确起步，沿固定右上角单调展开和收回', () => fixture(({ setOpen, control, menu, step, frames, closed }) => {
  const collapsed = [703.75, 212.25, 800, 248.25];
  setOpen(true);
  assert.deepEqual(edges(menu), collapsed);
  assert.equal(menu.style.borderRadius, '18px');
  assert.equal(menu.style.backgroundColor, 'transparent');
  assert.equal(menu.style.opacity, '1');
  let previous = collapsed;
  for (let i = 0; i < 28; i++) {
    step(10);
    const current = edges(menu);
    assert.ok(current[0] <= previous[0] && current[3] >= previous[3]);
    assert.deepEqual(current.slice(1, 3), collapsed.slice(1, 3));
    assert.equal(control.style.opacity, '0');
    previous = current;
  }
  assert.deepEqual(edges(menu), [576, 212.25, 800, 458.25]);
  assert.equal(menu.style.borderRadius, '24px');
  assert.equal(menu.style.backgroundColor, 'var(--md-select-menu-surface)');
  assert.equal(menu.style['--settings-select-menu-elevation'], '1');

  setOpen(false);
  for (let i = 0; i < 21; i++) {
    step(10);
    const current = edges(menu);
    assert.ok(current[0] >= previous[0] && current[3] <= previous[3]);
    assert.deepEqual(current.slice(1, 3), collapsed.slice(1, 3));
    assert.equal(control.style.opacity, '0');
    previous = current;
  }
  step(10);
  assert.deepEqual(edges(menu), collapsed);
  assert.equal(menu.style.opacity, '0');
  assert.equal(control.style.opacity, '');
  assert.equal(frames.size, 0);
  assert.equal(closed(), 1);
}));

test('文字与箭头按开合阶段交叉淡化，跳过低于 0.5px 的模糊节点', () => fixture(({ setOpen, pill, options, step }) => {
  setOpen(true);
  assert.equal(pill.style.filter, 'none');
  assert.equal(options.style.opacity, '0');
  step(10);
  assert.ok(Number(pill.style.opacity) < 1);
  assert.equal(pill.style.filter, 'none');
  step(25);
  assert.equal(pill.style.opacity, '0.5');
  assert.equal(pill.style.filter, 'blur(3px)');
  step(35);
  assert.equal(pill.style.opacity, '0');
  step(70);
  assert.equal(options.style.opacity, '0.5');
  assert.equal(options.style.filter, 'blur(3px)');
  step(70);
  assert.equal(options.style.opacity, '1');
  step(70);

  setOpen(false);
  step(66);
  assert.equal(options.style.opacity, '0');
  step(33);
  assert.equal(pill.style.opacity, '0');
  step(11);
  assert.ok(Number(pill.style.opacity) > 0);
  step(100);
  assert.ok(Number(pill.style.opacity) < 1);
  assert.equal(pill.style.filter, 'none');
  step(10);
  assert.equal(pill.style.opacity, '1');
  assert.equal(pill.style.filter, 'none');
}));

test('视口底部空间不足时胶囊文字与外壳一起锁定右下角', () => fixture(({ setOpen, menu, list, pill, viewport, step }) => {
  viewport.height = 270;
  setOpen(true);
  step(35);
  assert.equal(pill.style.top, 'auto');
  assert.equal(pill.style.bottom, '0px');
  assert.equal(edges(menu)[3], 248.25);
  assert.ok(edges(menu)[1] < 212.25);
  step(245);
  assert.equal(list.style.height, '236.25px');
  assert.deepEqual(edges(menu), [576, 12, 800, 248.25]);
  setOpen(false);
  step(110);
  assert.ok(edges(menu)[1] > 12 && edges(menu)[1] < 212.25);
  assert.equal(edges(menu)[3], 248.25);
  step(110);
  assert.deepEqual(edges(menu), [703.75, 212.25, 800, 248.25]);
}));

test('仅完全展开后显示滚动条，收起首帧的高度变化小于剩余行程十分之一', () => fixture(({ setOpen, menu, list, step }) => {
  setOpen(true);
  step(279);
  assert.equal(list.classList.contains('is-settled'), false);
  step(1);
  assert.equal(list.classList.contains('is-settled'), true);
  const openedBottom = edges(menu)[3];
  setOpen(false);
  assert.equal(list.classList.contains('is-settled'), false);
  step(1000 / 60);
  assert.ok((openedBottom - edges(menu)[3]) / (openedBottom - 248.25) < 0.1);
  assert.equal(list.style.filter, undefined);
}));

test('反向时沿用当前边界和内容透明度，下一帧直接朝新目标移动', () => fixture(({ setOpen, control, menu, options, step, closed }) => {
  setOpen(true);
  step(120);
  const opening = edges(menu);
  const opacity = options.style.opacity;
  setOpen(false);
  assert.deepEqual(edges(menu), opening);
  assert.equal(options.style.opacity, opacity);
  step(16);
  const closing = edges(menu);
  assert.ok(closing[0] > opening[0]);
  setOpen(true);
  assert.deepEqual(edges(menu), closing);
  step(16);
  assert.ok(edges(menu)[0] < closing[0]);
  step(280);
  assert.equal(closed(), 0);
  assert.equal(control.style.opacity, '0');
}));

test('收起时使用新选项的胶囊边界和底色', () => fixture(({ setOpen, bounds, control, menu, pill, step }) => {
  setOpen(true);
  step(280);
  bounds.left = 690;
  bounds.width = 110;
  control.style['--settings-select-control-surface'] = 'var(--md-surface-high)';
  setOpen(false);
  assert.equal(pill.style.width, '110px');
  step(220);
  assert.deepEqual(edges(menu), [690, 212.25, 800, 248.25]);
  assert.equal(menu.style.backgroundColor, 'var(--md-surface-high)');
}));

test('快速切换、减少动态效果和卸载都会清理待执行的帧', () => fixture(({ motion, setOpen, control, menu, step, media, listeners, frames, closed }) => {
  for (let click = 0; click < 20; click++) {
    setOpen(click % 2 === 0);
    step(32);
  }
  step(280);
  assert.equal(frames.size, 0);
  assert.equal(closed(), 1);

  setOpen(true);
  step(30);
  media.matches = true;
  listeners.forEach(listener => listener());
  assert.deepEqual(edges(menu), [576, 212.25, 800, 458.25]);
  assert.equal(frames.size, 0);
  setOpen(false);
  assert.equal(closed(), 2);
  assert.equal(control.style.opacity, '');

  media.matches = false;
  setOpen(true);
  setOpen(false, true);
  assert.equal(closed(), 3);
  assert.equal(frames.size, 0);
  setOpen(true);
  motion.dispose();
  assert.equal(control.style.opacity, '');
  assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0);
}));
