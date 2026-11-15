import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const globals = ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'];
const saved = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
for (const name of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
}
Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
const { createApp, h } = await import('vue');
const { useSettingsTransition } = await import('../src/composables/useSettingsTransition.ts');

after(() => {
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function rect(left, top, width, height) {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
}

function pose(style, base) {
  const translation = style.transform.match(/translate3d\(([^p]+)px, ([^p]+)px/);
  const scale = style.transform.match(/scale\(([^,)]+)(?:, ([^)]+))?\)/);
  const x = Number(translation?.[1] || 0);
  const y = Number(translation?.[2] || 0);
  const sx = Number(scale?.[1] || 1);
  const sy = Number(scale?.[2] || sx);
  const centered = style.transformOrigin === 'center center';
  return rect(base.left + x + (centered ? (1 - sx) * base.width / 2 : 0), base.top + y + (centered ? (1 - sy) * base.height / 2 : 0), base.width * sx, base.height * sy);
}

async function fixture(run, { android = true, reduced = false } = {}) {
  document.body.innerHTML = '<div id="mount" data-app-scroll></div>';
  document.documentElement.dataset.platform = android ? 'android' : 'desktop';
  const mediaListeners = new Set();
  const media = { matches: reduced, addEventListener: (_name, callback) => mediaListeners.add(callback), removeEventListener: (_name, callback) => mediaListeners.delete(callback) };
  window.matchMedia = () => media;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  const frames = new Map();
  let now = 0;
  let id = 0;
  Object.defineProperties(globalThis, {
    performance: { configurable: true, value: { now: () => now } },
    requestAnimationFrame: { configurable: true, value: callback => { frames.set(++id, callback); return id; } },
    cancelAnimationFrame: { configurable: true, value: frame => frames.delete(frame) }
  });
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.parentElement?.classList.contains('settings-transition-layer') && this.style.inset === '0') {
      return pose(this.style, rect(0, 0, 390, 844));
    }
    return originalRect.call(this);
  };
  let motion;
  const app = createApp({ setup() { motion = useSettingsTransition(); return () => h('div', { class: 'settings-page' }); } });
  const mount = document.querySelector('#mount');
  mount.getBoundingClientRect = () => rect(0, 0, 390, 844);
  app.mount(mount);
  const page = mount.firstElementChild;
  page.getBoundingClientRect = () => rect(0, 0, 390, 1400);
  const home = () => {
    page.innerHTML = '<header class="settings-topbar" style="padding-top: 12px">设置</header><div class="settings-grid"><section id="live-card" class="settings-card" style="border-radius: 28px"><button id="trigger">存储与数据</button></section></div>';
    page.querySelector('header').getBoundingClientRect = () => rect(0, 0, 390, 88);
    const card = page.querySelector('section');
    card.getBoundingClientRect = () => pose(card.style, rect(16, 180, 358, 280));
    return card;
  };
  const detail = () => {
    page.innerHTML = '<header class="settings-topbar" style="padding-top: 12px"><button class="settings-back-button">返回设置</button></header><div class="settings-detail"><section class="settings-detail-group"><h2 id="detail-title">存储与数据</h2></section></div>';
    page.querySelector('header').getBoundingClientRect = () => rect(0, 0, 390, 88);
    page.querySelector('section').getBoundingClientRect = () => rect(16, 100, 358, 300);
  };
  const step = async () => {
    now += 1000 / 120;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
    await Promise.resolve();
  };
  const until = async predicate => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await step(); }
    assert.fail('动画未收敛');
  };
  const open = async () => {
    const card = home();
    let bounced;
    motion.bounce(card).then(value => { bounced = value; });
    await until(() => bounced !== undefined);
    assert.equal(bounced, true);
    const transition = motion.capture(page, card);
    detail();
    page.querySelector('.settings-back-button').focus({ preventScroll: true });
    transition.play();
    return transition;
  };
  let unmounted = false;
  const unmount = () => { if (!unmounted) { app.unmount(); unmounted = true; } };
  try { await run({ motion, page, mount, home, detail, step, until, open, frames, mediaListeners, unmount }); }
  finally {
    unmount();
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    document.documentElement.classList.remove('settings-card-transition');
  }
}

test('Android 展开复用同一真实页面，静态圆角不随帧更新且原有 DOM 位置完整恢复', () => fixture(async ({ page, mount, step, until, open }) => {
  await open();
  const layer = document.querySelector('.settings-transition-layer');
  const surface = page.parentElement;
  assert.ok(layer.contains(page));
  assert.notEqual(mount.firstElementChild, page);
  assert.equal(mount.firstElementChild.style.height, '1400px');
  assert.equal(layer.inert, false, '真实页面在转场中仍可处理返回操作');
  assert.equal(page.style.pointerEvents, 'auto');
  assert.equal(page.hasAttribute('data-settings-snapshot'), false);
  assert.equal(surface.querySelector('[data-settings-snapshot]').style.pointerEvents, 'none');
  assert.equal(document.activeElement, page.querySelector('.settings-back-button'));
  assert.equal(document.querySelectorAll('#detail-title').length, 1);
  const radius = surface.style.borderRadius;
  const transform = surface.style.transform;
  for (let i = 0; i < 12; i++) {
    await step();
    assert.equal(surface.style.borderRadius, radius, '圆角只设置一次，不触发逐帧重绘');
  }
  assert.notEqual(surface.style.transform, transform);
  await until(() => !document.querySelector('.settings-transition-layer'));
  assert.equal(page.parentElement, mount);
  assert.equal(page.style.cssText, '');
  assert.equal(page.querySelector('header').style.cssText, 'padding-top: 12px;');
  assert.equal(document.activeElement, page.querySelector('.settings-back-button'));
  assert.equal(document.documentElement.classList.contains('settings-card-transition'), false);
}));

test('Android 展开中卸载组件不遗留占位、真实页面或动画循环', () => fixture(async ({ page, mount, frames, mediaListeners, open, unmount, step }) => {
  await open();
  unmount();
  await step();
  assert.equal(page.isConnected, false);
  assert.equal(mount.childNodes.length, 0);
  assert.equal(document.querySelector('.settings-transition-layer'), null);
  assert.equal(frames.size, 0);
  assert.equal(mediaListeners.size, 0);
  assert.equal(document.documentElement.classList.contains('settings-card-transition'), false);
}));

test('Android 展开途中反向收回，落下阶段取消能恢复所有原卡片样式', () => fixture(async ({ motion, page, mount, home, open, until, step, frames }) => {
  await open();
  for (let i = 0; i < 12; i++) await step();
  const closing = motion.capture(page);
  assert.equal(page.parentElement, mount, '反向前先把真实页面归还给 Vue');
  const card = home();
  const original = card.style.cssText;
  closing.play(card);
  await until(() => !document.querySelector('.settings-transition-layer'));
  assert.notEqual(card.style.transform, '');
  motion.cancel();
  for (let i = 0; i < 3; i++) await step();
  assert.equal(card.style.cssText, original);
  assert.equal(frames.size, 0);
  assert.equal(document.documentElement.classList.contains('settings-card-transition'), false);
}));

test('桌面继续使用副本和动态圆角，取消时页面透明度恢复', () => fixture(async ({ motion, page, mount, home, detail, step }) => {
  const card = home();
  const transition = motion.capture(page, card);
  detail();
  transition.play();
  const layer = document.querySelector('.settings-transition-layer');
  const surface = layer.lastElementChild;
  const radius = surface.style.borderRadius;
  assert.equal(page.parentElement, mount);
  assert.equal(layer.inert, true);
  await step();
  assert.notEqual(surface.style.borderRadius, radius);
  motion.cancel();
  assert.equal(page.style.opacity, '');
  assert.equal(document.querySelector('.settings-transition-layer'), null);
}, { android: false }));

test('减少动态效果时直接切换，不搬动真实页面或创建动画副本', () => fixture(async ({ motion, page, home, frames }) => {
  const card = home();
  assert.equal(await motion.bounce(card), true);
  assert.equal(motion.capture(page, card), null);
  assert.equal(card.style.transform, '');
  assert.equal(frames.size, 0);
  assert.equal(document.documentElement.classList.contains('settings-card-transition'), false);
}, { reduced: true }));
