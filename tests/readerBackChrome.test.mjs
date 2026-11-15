import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<meta id="homuraThemeColor"><div id="app"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window, document: window.document, localStorage: window.localStorage,
  Element: window.Element, SVGElement: window.SVGElement,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}
});
let reduced = false;
window.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion') && reduced, addEventListener() {}, removeEventListener() {} });
let timerId = 0;
const timers = new Map();
window.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
window.clearTimeout = id => timers.delete(id);
const { createApp, h, reactive, watch, nextTick } = await import('vue');
const { createPinia, disposePinia } = await import('pinia');
const { useThemeStore } = await import('../src/stores/theme.ts');
const { useReaderBackDismiss } = await import('../src/composables/useReaderBackDismiss.ts');

async function finishTimers() {
  const pending = [...timers.values()];
  timers.clear();
  for (const callback of pending) await callback();
  await nextTick();
}

async function fixture(run, { mode = 'light', paper = 'parchment', reduce = false } = {}) {
  reduced = reduce;
  localStorage.clear();
  timers.clear();
  const chrome = [];
  window.__TAURI__ = { window: { getCurrentWindow: () => ({
    setTheme: async value => chrome.push(['theme', value]),
    setBackgroundColor: async value => chrome.push(['canvas', value])
  }) } };
  document.documentElement.style.setProperty('--md-parchment-paper', '#F4E8D3');
  document.documentElement.style.setProperty('--md-reader-green-paper', '#E8F0E1');
  const pinia = createPinia();
  const theme = useThemeStore(pinia);
  theme.setSurfaceMode(mode, true);
  theme.setPureBlackMode(mode === 'dark');
  theme.setReaderSurfaceMode(paper);
  const reader = reactive({ currentBook: { id: 'book' }, closeReader() { this.currentBook = null; } });
  const ui = { readerDrawerOpen: false, settingsOpen: false, tocOpen: false, closeSettings() {}, closeToc() {} };
  let back;
  const app = createApp({
    setup() {
      back = useReaderBackDismiss(reader, ui);
      watch([() => !!reader.currentBook, back.readerDismissing], ([active, dismissing]) => {
        theme.setReaderActive(active && !dismissing);
      }, { immediate: true, flush: 'sync' });
      return () => h('div');
    }
  });
  app.use(pinia);
  app.mount('#app');
  try { await run({ reader, theme, chrome, back }); }
  finally { app.unmount(); disposePinia(pinia); timers.clear(); }
}

function pointer(x) {
  return { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 100, currentTarget: null, preventDefault() {}, stopPropagation() {} };
}

test('确认退出即恢复标题栏，300 毫秒退场期间仍保留书籍以完成动画', async () => {
  for (const mode of ['light', 'dark']) {
    for (const paper of ['parchment', 'green']) {
      await fixture(async ({ reader, chrome, back }) => {
        back.dismissWithPredictiveBack();
        assert.equal(back.readerDismissing.value, true);
        assert.ok(reader.currentBook);
        assert.ok(document.documentElement.classList.contains('reader-back-settling'));
        assert.deepEqual(chrome.slice(-2), [['theme', mode], ['canvas', mode === 'dark' ? '#000000' : '#F8FAFC']]);
        const callsAtStart = chrome.length;
        await finishTimers();
        assert.equal(reader.currentBook, null);
        assert.equal(chrome.length, callsAtStart);
      }, { mode, paper });
    }
  }
});

test('拖动返回后取消不改变阅读标题栏，提交手势才恢复书架配色', () => fixture(async ({ reader, chrome, back }) => {
  const initialCalls = chrome.length;
  back.onPointerDown(pointer(0));
  back.onPointerMove(pointer(100));
  back.onPointerCancel(pointer(100));
  assert.equal(back.readerDismissing.value, false);
  assert.equal(chrome.length, initialCalls);
  await finishTimers();
  assert.ok(reader.currentBook);
  back.onPointerDown(pointer(0));
  back.onPointerMove(pointer(window.innerWidth));
  back.onPointerUp(pointer(window.innerWidth));
  assert.equal(back.readerDismissing.value, true);
  assert.deepEqual(chrome.at(-1), ['canvas', '#F8FAFC']);
  await finishTimers();
  assert.equal(reader.currentBook, null);
}));

test('退出期间换书会恢复阅读配色，过期退场回调不能关闭新书', () => fixture(async ({ reader, chrome, back }) => {
  back.dismissWithPredictiveBack();
  reader.currentBook = { id: 'new-book' };
  await nextTick();
  assert.equal(back.readerDismissing.value, false);
  assert.deepEqual(chrome.at(-1), ['canvas', '#F4E8D3']);
  await finishTimers();
  assert.equal(reader.currentBook.id, 'new-book');
}));

test('减少动效时退出立即关书并恢复原生标题栏', () => fixture(async ({ reader, chrome, back }) => {
  back.dismissWithPredictiveBack();
  assert.equal(reader.currentBook, null);
  assert.equal(back.readerDismissing.value, false);
  assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
  assert.equal(timers.size, 0);
}, { mode: 'dark', paper: 'green', reduce: true }));
