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

const overlay = () => document.querySelector('.settings-transition-layer');
const surface = () => overlay().querySelector('.settings-transition-surface');
const scrim = () => overlay().querySelector('.settings-transition-scrim');
const content = () => Array.from(surface().children, node => Number(node.style.opacity));
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} ≠ ${expected}`);
}

after(() => {
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

async function fixture(run, { android = true, reduced = false, left = 0, width = 390 } = {}) {
  document.body.innerHTML = '<div id="homura-mobile-nav-root"><nav class="mobile-nav"></nav></div><div id="mount" data-app-scroll></div>';
  document.documentElement.dataset.platform = android ? 'android' : 'desktop';
  const nav = document.querySelector('#homura-mobile-nav-root');
  nav.firstElementChild.inert = false;
  const mediaListeners = new Set();
  window.matchMedia = () => ({ matches: reduced, addEventListener: (_type, fn) => mediaListeners.add(fn), removeEventListener: (_type, fn) => mediaListeners.delete(fn) });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width + left });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  const frames = new Map();
  let now = 0;
  let id = 0;
  Object.defineProperties(globalThis, {
    performance: { configurable: true, value: { now: () => now } },
    requestAnimationFrame: { configurable: true, value: callback => { frames.set(++id, callback); return id; } },
    cancelAnimationFrame: { configurable: true, value: frame => frames.delete(frame) }
  });
  let motion;
  const app = createApp({ setup() { motion = useSettingsTransition(); return () => h('div', { class: 'settings-page' }); } });
  const mount = document.querySelector('#mount');
  mount.getBoundingClientRect = () => rect(left, 0, width, 844);
  app.mount(mount);
  const page = mount.firstElementChild;
  page.inert = false;
  page.getBoundingClientRect = () => rect(left, 0, width, 1400);
  const home = () => {
    page.innerHTML = '<header class="settings-topbar">设置</header><div class="settings-grid"><section id="live-card" class="settings-card" style="border-radius: 28px"><button id="trigger">存储与数据</button></section></div>';
    page.querySelector('header').getBoundingClientRect = () => rect(left, 0, width, 88);
    const card = page.querySelector('section');
    card.getBoundingClientRect = () => rect(left + 16, 180, 358, 280);
    return card;
  };
  const detail = () => {
    page.innerHTML = '<header class="settings-topbar" style="padding-top: 12px"><button class="settings-back-button">返回设置</button></header><div class="settings-detail"><section class="settings-detail-group"><h2 id="detail-title">存储与数据</h2></section></div>';
    page.querySelector('header').getBoundingClientRect = () => rect(left, 0, width, 88);
    page.querySelector('section').getBoundingClientRect = () => rect(left + 16, 100, 358, 300);
  };
  const step = (dt = 1000 / 120) => {
    now += dt;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  };
  const open = () => {
    const transition = motion.capture(page, home());
    detail();
    transition?.play();
    return transition;
  };
  let unmounted = false;
  const unmount = () => { if (!unmounted) { app.unmount(); unmounted = true; } };
  try { await run({ motion, page, mount, home, detail, step, open, nav, frames, mediaListeners, unmount }); }
  finally { unmount(); }
}

test('打开首帧底栏仍在，卡片与详情分段显隐，遮罩和圆角跟随几何', () => fixture(async ({ page, mount, nav, open, step }) => {
  const transition = open();
  assert.equal(overlay().parentElement, document.body);
  assert.equal(overlay().style.zIndex, '45');
  assert.equal(page.parentElement, mount);
  assert.equal(page.style.visibility, 'hidden');
  assert.equal(overlay().querySelector('.settings-card').style.visibility, 'hidden');
  assert.equal(document.querySelectorAll('#detail-title').length, 1);
  assert.equal(nav.style.getPropertyValue('--settings-nav-visibility'), '1');
  assert.equal(scrim().style.opacity, '0');
  assert.equal(surface().style.clipPath, 'inset(180px 16px 384px 16px round 28px)');
  assert.deepEqual(content(), [0, 1]);
  const firstColor = surface().style.background;

  step(40);
  assert.equal(content()[0], 0);
  assert.ok(content()[1] > 0 && content()[1] < 1);
  const previousClip = surface().style.clipPath;
  const previousScrim = Number(scrim().style.opacity);
  step(80);
  assert.ok(content()[0] > 0);
  assert.equal(content()[1], 0);
  assert.equal(overlay().querySelector(':scope > .settings-page .settings-topbar').textContent, '设置');
  assert.notEqual(surface().style.clipPath, previousClip);
  assert.notEqual(surface().style.background, firstColor);
  assert.ok(Number(scrim().style.opacity) > previousScrim && Number(scrim().style.opacity) < 0.12);
  assert.equal(nav.style.getPropertyValue('--settings-nav-visibility'), '0');

  step(259);
  assert.ok(overlay(), '380ms 之前仍由浮层绘制');
  step(1);
  await transition.finished;
  assert.equal(overlay(), null);
  assert.equal(page.style.visibility, '');
  assert.equal(page.inert, false);
  assert.equal(nav.firstElementChild.inert, false);
  assert.equal(nav.style.getPropertyValue('--settings-nav-visibility'), '');
}));

test('返回可逆向跟手，详情与卡片不重叠，取消先恢复详情再清理浮层', () => fixture(async ({ motion, page, home, detail, nav, step, frames }) => {
  detail();
  let resolution;
  const transition = motion.capture(page, null, async commit => {
    assert.ok(overlay());
    resolution = commit;
    detail();
  });
  transition.update(0.25);
  const card = home();
  transition.play(card);
  assert.equal(card.style.visibility, 'hidden');
  assertClose(content()[0], 1 - 0.25 / 0.35);
  assert.equal(content()[1], 0);
  assertClose(Number(scrim().style.opacity), 0.09);
  assert.equal(nav.style.getPropertyValue('--settings-nav-visibility'), '0');
  transition.update(0.35);
  assert.deepEqual(content(), [0, 0]);
  transition.update(0.55);
  assert.deepEqual(content().map(value => Number(value.toFixed(2))), [0, 0.44]);
  assert.ok(Number(nav.style.getPropertyValue('--settings-nav-visibility')) > 0);
  transition.update(0.10);
  assert.ok(content()[0] > 0 && content()[1] === 0);
  transition.settle(0, -2);
  for (let i = 0; i < 34; i++) step();
  assert.deepEqual(content(), [1, 0]);
  await transition.finished;
  assert.equal(resolution, false);
  assert.ok(page.querySelector('#detail-title'));
  assert.equal(overlay(), null);
  assert.equal(frames.size, 0);
}));

test('提交继承手势速度，限定时间内精确贴回原卡片且没有第二段落地动画', () => fixture(async ({ motion, page, home, detail, step, frames }) => {
  async function close(velocity) {
    detail();
    let resolution;
    let landing;
    const transition = motion.capture(page, null, async commit => {
      resolution = commit;
      landing = surface().style.clipPath;
      assert.deepEqual(content(), [0, 1]);
    });
    const card = home();
    transition.play(card);
    transition.update(0.4);
    transition.settle(1, velocity);
    step();
    const firstFrame = Number(scrim().style.opacity);
    for (let i = 0; i < 33; i++) step();
    await transition.finished;
    assert.equal(resolution, true);
    assert.equal(landing, 'inset(180px 16px 384px 16px round 28px)');
    assert.equal(card.style.visibility, '');
    assert.equal(card.style.transform, '');
    assert.equal(frames.size, 0);
    return firstFrame;
  }
  assert.ok(await close(4) < await close(0));
}));

test('入口与底栏位置重叠时，底栏等容器落位后才上浮', () => fixture(async ({ motion, page, home, detail, nav, step }) => {
  detail();
  const pill = nav.firstElementChild;
  pill.getBoundingClientRect = () => rect(24, 800, 342, 64);
  let navAnimation;
  pill.animate = (keyframes, options) => {
    assert.equal(overlay(), null);
    navAnimation = { keyframes, options };
    return { cancel() {} };
  };
  const transition = motion.capture(page, null, async () => {});
  const card = home();
  card.getBoundingClientRect = () => rect(16, 600, 358, 202);
  transition.play(card);
  transition.update(0.95);
  assert.equal(nav.style.getPropertyValue('--settings-nav-visibility'), '0');
  transition.settle(1);
  for (let i = 0; i < 34; i++) step();
  await transition.finished;
  assert.equal(navAnimation.options.duration, 120);
  assert.deepEqual(navAnimation.keyframes.map(keyframe => keyframe.opacity), [0, 1]);
}));

test('桌面概览顶栏先退出，详情延后淡入并等比适宽，由真实详情接手', () => fixture(async ({ motion, page, home, detail, step }) => {
  const card = home();
  card.getBoundingClientRect = () => rect(280, 180, 540, 280);
  const transition = motion.capture(page, card);
  detail();
  transition.play();

  const overview = overlay().querySelector(':scope > .settings-page');
  const overviewHeader = overview.querySelector('.settings-topbar');
  overviewHeader.getBoundingClientRect = () => rect(252, 0, 1180, 104);
  assert.equal(overviewHeader.textContent, '设置');
  assert.equal(overviewHeader.style.opacity, '1');
  step(40);
  assertClose(Number(overviewHeader.style.opacity), content()[1]);
  assert.ok(content()[1] > 0 && content()[1] < 1);
  step(60);
  assert.equal(overviewHeader.isConnected, false, '详情淡入前已移除旧标题及其背景层');
  assert.equal(overview.firstElementChild.style.height, '104px', '概览网格保留原来的布局位置');
  assert.ok(overview.querySelector('.settings-grid'));
  assert.deepEqual(content(), [0, 0]);
  assert.match(surface().style.background, /color-mix/);
  step(44);
  const p = Number(scrim().style.opacity) / 0.12;
  assert.ok(p > 0.60);
  assert.equal(surface().style.background, 'var(--md-surface-low)');
  assert.ok(content()[0] > 0 && content()[1] === 0);
  const scale = Number(surface().firstElementChild.style.transform.match(/scale\(([\d.]+)\)/)[1]);
  assertClose(scale, (540 + (1180 - 540) * p) / 1180);

  step(235);
  assert.equal(page.style.visibility, 'hidden');
  assert.ok(overlay().querySelector(':scope > .settings-page'));
  step(1);
  assert.equal(page.style.visibility, '');
  assert.equal(page.inert, true, '铺满的转场层仍覆盖真实页面');
  assert.equal(overlay().querySelector(':scope > .settings-page'), null, '概览标题不能参与交接帧');
  assert.deepEqual(content(), [1, 0]);
  step();
  await transition.finished;
  assert.equal(overlay(), null);
  assert.equal(page.inert, false);
}, { android: false, left: 252, width: 1180 }));

test('桌面按钮返回缓起，240–270ms 内对齐原卡片', () => fixture(async ({ motion, page, home, detail, step, frames }) => {
  detail();
  let landing;
  const transition = motion.capture(page, null, async () => { landing = surface().style.clipPath; });
  const card = home();
  card.getBoundingClientRect = () => rect(280, 180, 540, 280);
  transition.play(card);
  transition.settle(1);
  step(33);
  assert.ok(1 - Number(scrim().style.opacity) / 0.12 < 0.06);
  step(206);
  assert.ok(overlay());
  assert.equal(landing, undefined);
  step(17);
  await transition.finished;
  assert.equal(landing, 'inset(180px 612px 384px 28px round 28px)');
  assert.equal(overlay(), null);
  assert.equal(card.style.visibility, '');
  assert.equal(frames.size, 0);
}, { android: false, left: 252, width: 1180 }));

test('桌面转场只覆盖主列；卸载和窗口变化恢复节点状态与回调', () => fixture(async ({ page, mount, nav, frames, mediaListeners, open, unmount, step }) => {
  const first = open();
  assert.equal(overlay().style.left, '220px');
  assert.equal(overlay().style.width, '390px');
  window.dispatchEvent(new window.Event('resize'));
  await first.finished;
  assert.equal(page.style.visibility, '');
  const second = open();
  unmount();
  await second.finished;
  step();
  assert.equal(mount.childNodes.length, 0);
  assert.equal(nav.firstElementChild.inert, false);
  assert.equal(overlay(), null);
  assert.equal(frames.size, 0);
  assert.equal(mediaListeners.size, 0);
  assert.equal(document.documentElement.classList.contains('settings-card-transition'), false);
}, { android: false, left: 220 }));

test('减少动态效果时不创建浮层、不改动真实页面', () => fixture(async ({ page, nav, open, frames }) => {
  assert.equal(open(), null);
  assert.equal(page.style.visibility, '');
  assert.equal(nav.style.getPropertyValue('--settings-nav-visibility'), '');
  assert.equal(frames.size, 0);
}, { reduced: true }));
