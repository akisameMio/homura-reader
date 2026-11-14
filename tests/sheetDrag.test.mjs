import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: callback => setTimeout(callback, 0)
});
window.matchMedia = () => ({ matches: true });

const { createApp, defineComponent, h, nextTick, ref } = await import('vue');
const { useSheetDrag } = await import('../src/composables/useSheetDrag.ts');

async function mount() {
  let closed = 0;
  const isCompact = ref(true);
  const isOpen = ref(true);
  const Host = defineComponent({
    setup() {
      const { sheetRef } = useSheetDrag({ isCompact, isOpen, onClose: () => { closed += 1; } });
      return () => h('div', { id: 'sheet', ref: sheetRef }, [
        h('button', { id: 'action', type: 'button' }, '按钮'),
        h('div', { id: 'scroll', style: 'overflow-y: auto;' }, [h('p', { id: 'scrolled' }, '内容')]),
        h('div', { id: 'plain' }, '留白')
      ]);
    }
  });
  const app = createApp(Host);
  app.mount('#app');
  await nextTick();
  await nextTick();
  const sheet = document.querySelector('#sheet');
  const scroller = document.querySelector('#scroll');
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => 400, configurable: true },
    clientHeight: { get: () => 200, configurable: true }
  });
  scroller.scrollTop = 0;
  Object.defineProperty(sheet, 'offsetHeight', {
    get: () => parseFloat(sheet.style.height) || 500,
    configurable: true
  });
  return {
    sheet,
    scroller,
    get closed() { return closed; },
    cleanup() { app.unmount(); }
  };
}

function fireTouch(target, type, x, y) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  const touches = type === 'touchend' || type === 'touchcancel'
    ? []
    : [{ identifier: 1, clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
}

test('从整张卡片留白处下拉会跟手移动，超过阈值松手关闭', async () => {
  const context = await mount();
  try {
    const plain = document.querySelector('#plain');
    fireTouch(plain, 'touchstart', 100, 100);
    fireTouch(plain, 'touchmove', 100, 120);
    assert.match(context.sheet.style.transform, /translate3d\(0, 20px, 0\)/);
    fireTouch(plain, 'touchmove', 100, 240);
    fireTouch(plain, 'touchend', 100, 240);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(context.closed, 1);
  } finally { context.cleanup(); }
});

test('按钮和输入控件保留原生点击，不触发整卡拖动', async () => {
  const context = await mount();
  try {
    const action = document.querySelector('#action');
    fireTouch(action, 'touchstart', 100, 100);
    fireTouch(action, 'touchmove', 100, 220);
    assert.equal(context.sheet.style.transform, '');
    assert.equal(context.closed, 0);
  } finally { context.cleanup(); }
});

test('滚动区域未回到顶部时下拉交给原生滚动，回顶后才接管', async () => {
  const context = await mount();
  try {
    const target = document.querySelector('#scrolled');
    context.scroller.scrollTop = 60;
    fireTouch(target, 'touchstart', 100, 100);
    fireTouch(target, 'touchmove', 100, 180);
    assert.equal(context.sheet.style.transform, '');
    fireTouch(target, 'touchstart', 100, 200);
    fireTouch(target, 'touchmove', 100, 100);
    assert.equal(context.sheet.style.height, '');

    context.scroller.scrollTop = 0;
    fireTouch(target, 'touchstart', 100, 100);
    fireTouch(target, 'touchmove', 100, 180);
    assert.match(context.sheet.style.transform, /translate3d\(0, 80px, 0\)/);
  } finally { context.cleanup(); }
});

test('向上拖动整张卡片抬升到最大档位，横向手势仍不接管', async () => {
  const context = await mount();
  try {
    const plain = document.querySelector('#plain');
    fireTouch(plain, 'touchstart', 100, 400);
    fireTouch(plain, 'touchmove', 100, 100);
    assert.equal(context.sheet.style.height, '768px');
    fireTouch(plain, 'touchend', 100, 100);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.sheet.style.height, '768px');
    assert.equal(context.sheet.style.transform, '');
    assert.equal(context.closed, 0);

    fireTouch(plain, 'touchstart', 100, 300);
    fireTouch(plain, 'touchmove', 220, 300);
    assert.equal(context.sheet.style.height, '768px');
    assert.equal(context.closed, 0);
  } finally { context.cleanup(); }
});

test('双档位：小幅下拉回弹到扩展档，过半下拉回到默认档', async () => {
  const context = await mount();
  try {
    const plain = document.querySelector('#plain');
    fireTouch(plain, 'touchstart', 100, 400);
    fireTouch(plain, 'touchmove', 100, 100);
    fireTouch(plain, 'touchend', 100, 100);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.sheet.style.height, '768px');

    fireTouch(plain, 'touchstart', 100, 200);
    fireTouch(plain, 'touchmove', 100, 280);
    fireTouch(plain, 'touchend', 100, 280);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.sheet.style.height, '768px');

    fireTouch(plain, 'touchstart', 100, 200);
    fireTouch(plain, 'touchmove', 100, 400);
    fireTouch(plain, 'touchend', 100, 400);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.sheet.style.height, '');
    assert.equal(context.closed, 0);
  } finally { context.cleanup(); }
});

test('扩展档位一路下拉：先收回默认档，再继续下拉关闭', async () => {
  const context = await mount();
  try {
    const plain = document.querySelector('#plain');
    fireTouch(plain, 'touchstart', 100, 400);
    fireTouch(plain, 'touchmove', 100, 100);
    fireTouch(plain, 'touchend', 100, 100);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.sheet.style.height, '768px');

    fireTouch(plain, 'touchstart', 100, 100);
    fireTouch(plain, 'touchmove', 100, 500);
    fireTouch(plain, 'touchend', 100, 500);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.closed, 1);
  } finally { context.cleanup(); }
});

test('最大档位下向上拖动交还给内容滚动', async () => {
  const context = await mount();
  try {
    const plain = document.querySelector('#plain');
    fireTouch(plain, 'touchstart', 100, 400);
    fireTouch(plain, 'touchmove', 100, 100);
    fireTouch(plain, 'touchend', 100, 100);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context.sheet.style.height, '768px');

    const target = document.querySelector('#scrolled');
    context.scroller.scrollTop = 0;
    fireTouch(target, 'touchstart', 100, 300);
    fireTouch(target, 'touchmove', 100, 180);
    assert.equal(context.sheet.style.height, '768px');
    assert.equal(context.sheet.style.transform, '');
  } finally { context.cleanup(); }
});
