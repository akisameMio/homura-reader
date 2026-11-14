import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';

const { window } = new JSDOM('<div id="app"></div>');
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window)
});
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const viewport = Object.assign(new window.EventTarget(), { width: 1440, height: 1000, offsetLeft: 0, offsetTop: 0, scale: 1 });
Object.defineProperty(window, 'visualViewport', { value: viewport });
const frames = new Map();
let sequence = 0;
let now = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
globalThis.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
globalThis.cancelAnimationFrame = id => frames.delete(id);

const { createApp, h, nextTick } = await import('vue');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/SettingsSelectRow.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'select-row-test', inlineTemplate: true }).content;
compiled = compiled.replace(/from ["']vue["']/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
compiled = compiled.replace("import MdIcon from './MdIcon.vue';", "const MdIcon = { render: () => null };");
compiled = compiled.replaceAll("'../services/settingsSelectMotion.ts'", `'${new URL('../src/services/settingsSelectMotion.ts', import.meta.url).href}'`);
compiled = compiled.replaceAll("'../services/settingsSelectScrollLock.ts'", `'${new URL('../src/services/settingsSelectScrollLock.ts', import.meta.url).href}'`);
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: SettingsSelectRow } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function mount() {
  viewport.width = 1440;
  const app = createApp({ render: () => h(SettingsSelectRow, {
    label: '翻页方式', modelValue: 'fade', options: [{ value: 'fade', label: '淡入' }, { value: 'slide', label: '滑动' }]
  }) });
  app.mount('#app');
  return { app, trigger: document.querySelector('.settings-select-row') };
}

async function advance(ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000 / 120) {
    now += 1000 / 120;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  }
  await nextTick();
}

function wheel() {
  const event = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
}

test('锁滚动后异步到达的同尺寸视口事件不会关闭桌面菜单', async () => {
  const { app, trigger } = mount();
  try {
    trigger.click();
    await nextTick();
    viewport.dispatchEvent(new window.Event('resize'));
    viewport.dispatchEvent(new window.Event('scroll'));
    await nextTick();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.ok(document.querySelector('[role="listbox"]'));
    assert.equal(wheel(), true);
    viewport.width = 1200;
    viewport.dispatchEvent(new window.Event('resize'));
    await nextTick();
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[role="listbox"]'), null);
    assert.equal(wheel(), false);
  } finally {
    app.unmount();
  }
});

test('收缩期间及中途重开持续锁滚动，完全归位后才恢复', async () => {
  const { app, trigger } = mount();
  try {
    trigger.click();
    await nextTick();
    await advance(1500);
    trigger.click();
    await nextTick();
    await advance(80);
    assert.ok(document.querySelector('[role="listbox"]'));
    assert.equal(wheel(), true);
    trigger.click();
    await nextTick();
    await advance(1500);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(wheel(), true);
    trigger.click();
    await nextTick();
    await advance(1800);
    assert.equal(document.querySelector('[role="listbox"]'), null);
    assert.equal(wheel(), false);
    assert.equal(document.documentElement.style.overflow, '');
  } finally {
    app.unmount();
  }
});

test('菜单打开时卸载组件会释放滚动锁和动画', async () => {
  const { app, trigger } = mount();
  trigger.click();
  await nextTick();
  assert.equal(wheel(), true);
  app.unmount();
  assert.equal(wheel(), false);
  assert.equal(frames.size, 0);
  assert.equal(document.documentElement.style.overflow, '');
});


test('桌面锁滚动保留滚动条，拖动和焦点滚动不能改变背景位置', async () => {
  const root = document.documentElement;
  root.style.overflowY = 'scroll';
  root.scrollTop = 120;
  const { app, trigger } = mount();
  try {
    trigger.click();
    await nextTick();
    assert.equal(root.style.overflowY, 'scroll');
    assert.equal(wheel(), true);
    root.scrollTop = 240;
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(root.scrollTop, 120);
    await advance(1500);
    trigger.click();
    await nextTick();
    await advance(80);
    root.scrollTop = 360;
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(root.scrollTop, 120);
    assert.equal(root.style.overflowY, 'scroll');
    await advance(1800);
    assert.equal(wheel(), false);
    assert.equal(root.style.overflowY, 'scroll');
    root.scrollTop = 240;
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(root.scrollTop, 240);
  } finally {
    app.unmount();
    root.style.removeProperty('overflow-y');
    root.scrollTop = 0;
  }
});
