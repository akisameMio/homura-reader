import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';

const { window } = new JSDOM('<button id="trigger">打开</button><div id="app"></div>');
Object.assign(globalThis, {
  window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement, Node: window.Node, getComputedStyle: window.getComputedStyle.bind(window)
});
window.innerWidth = 390;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get: () => 660 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { top: 184, bottom: 844, left: 0, right: 390, width: 390, height: 660 };
};
const viewport = Object.assign(new window.EventTarget(), { height: 844, offsetTop: 0 });
Object.defineProperty(window, 'visualViewport', { value: viewport });
const frames = new Map();
let sequence = 0;
let now = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
globalThis.requestAnimationFrame = cb => { frames.set(++sequence, cb); return sequence; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const { createApp, h, nextTick, reactive } = await import('vue');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/MobileBottomSheet.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'mobile-sheet-test', inlineTemplate: true }).content;
compiled = compiled.replace(/from ["']vue["']/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
compiled = compiled.replace("import ReaderDrawerHeader from './ReaderDrawerHeader.vue';", `const ReaderDrawerHeader = {
  emits: ['close'], setup(_, { emit }) { return () => h('header', { class: 'md-drawer-header' }, [h('button', { onClick: () => emit('close') }, '关闭')]); }
};`);
compiled = "import { h } from '" + pathToFileURL(require.resolve('vue')).href + "';\n" + compiled;
for (const file of ['composables/useSheetDrag.ts', 'composables/useSheetSpring.ts', 'services/settingsSelectScrollLock.ts']) {
  compiled = compiled.replaceAll(`'../${file}'`, `'${new URL(`../src/${file}`, import.meta.url).href}'`);
}
compiled = compiled.replaceAll("'../composables/useI18n.ts'", `'${new URL('../src/composables/useI18n.ts', import.meta.url).href}'`);
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: MobileBottomSheet } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function flush() { for (let i = 0; i < 5; i++) await nextTick(); }
async function advance(ms = 2000) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 120) {
    now += 1000 / 120;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(cb => cb(now));
  }
  await flush();
}
function wheel() {
  const event = new window.WheelEvent('wheel', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
}
function mount(extra = {}) {
  viewport.height = 844;
  viewport.offsetTop = 0;
  document.querySelector('#trigger').focus();
  const state = reactive({ open: true, busy: false, backdropDismissible: true, ...extra });
  const events = [];
  const app = createApp({ render: () => h(MobileBottomSheet, {
    ...state, title: '测试面板', titleId: 'test-sheet-title',
    onClose: () => events.push('close'), onCancel: () => events.push('cancel'), onClosed: () => events.push('closed')
  }, { default: () => h('input', { 'aria-label': '名称' }), footer: () => h('button', '确认') }) });
  app.mount('#app');
  return { app, state, events };
}

test('初始打开进入原生模态层，收场完成前保持背景锁，关闭后恢复焦点', async () => {
  const { app, state, events } = mount();
  try {
    await flush();
    await advance();
    assert.equal(document.querySelector('dialog').open, true);
    assert.equal(wheel(), true);
    state.open = false;
    await flush();
    await advance(60);
    assert.equal(document.querySelector('dialog').open, true);
    assert.equal(wheel(), true);
    await advance();
    assert.equal(document.querySelector('dialog').open, false);
    assert.equal(wheel(), false);
    assert.equal(document.activeElement.id, 'trigger');
    assert.deepEqual(events, ['closed']);
  } finally { app.unmount(); }
});

test('离场中重开不会释放模态层与滚动锁，卸载会清理动画及监听', async () => {
  const { app, state } = mount();
  await flush();
  await advance();
  state.open = false;
  await flush();
  await advance(60);
  state.open = true;
  await flush();
  await advance();
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(wheel(), true);
  app.unmount();
  assert.equal(wheel(), false);
  assert.equal(frames.size, 0);
  assert.equal(document.documentElement.style.overflowY, '');
});

test('忙碌时所有关闭入口都受保护，下载时可单独禁止遮罩关闭', async () => {
  const { app, state, events } = mount({ busy: true });
  try {
    await flush();
    const dialog = document.querySelector('dialog');
    document.querySelector('.md-drawer-header button').click();
    dialog.click();
    const cancel = new window.Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.deepEqual(events, []);
    state.busy = false;
    state.backdropDismissible = false;
    await flush();
    dialog.click();
    assert.deepEqual(events, []);
    dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    document.querySelector('.md-drawer-header button').click();
    assert.deepEqual(events, ['cancel', 'close']);
  } finally { app.unmount(); }
});

test('软键盘改变可视视口时调整面板可用高度，关闭后移除监听', async () => {
  const { app, state } = mount();
  try {
    await flush();
    const dialog = document.querySelector('dialog');
    viewport.height = 420;
    viewport.offsetTop = 20;
    viewport.dispatchEvent(new window.Event('resize'));
    assert.equal(dialog.style.height, '420px');
    assert.equal(dialog.style.top, '20px');
    assert.equal(dialog.style.getPropertyValue('--md-sheet-viewport-height'), '420px');
    state.open = false;
    await flush();
    await advance();
    viewport.height = 700;
    viewport.dispatchEvent(new window.Event('resize'));
    assert.equal(dialog.style.height, '420px');
  } finally { app.unmount(); }
});

test('同一轮快速打开再关闭不会留下滚动锁或原生模态层', async () => {
  const { app, state } = mount({ open: false });
  try {
    state.open = true;
    await nextTick();
    state.open = false;
    await flush();
    await advance();
    assert.equal(document.querySelector('dialog').open, false);
    assert.equal(wheel(), false);
  } finally { app.unmount(); }
});

test('减少动态效果时直接落位，关闭同步释放模态层', async () => {
  const original = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  const { app, state } = mount();
  try {
    await flush();
    assert.equal(document.querySelector('dialog').open, true);
    assert.equal(frames.size, 0);
    state.open = false;
    await flush();
    assert.equal(document.querySelector('dialog').open, false);
    assert.equal(wheel(), false);
  } finally {
    app.unmount();
    window.matchMedia = original;
  }
});

test('原生 Esc 提前关闭模态层时重新撑住，离场结束后再释放滚动锁', async () => {
  const { app, state, events } = mount();
  try {
    await flush();
    await advance();
    const dialog = document.querySelector('dialog');
    dialog.close();
    dialog.dispatchEvent(new window.Event('close'));
    await flush();
    assert.equal(dialog.open, true);
    assert.equal(wheel(), true);
    state.open = false;
    await flush();
    await advance();
    assert.equal(dialog.open, false);
    assert.equal(wheel(), false);
    assert.deepEqual(events, ['closed']);
  } finally { app.unmount(); }
});
