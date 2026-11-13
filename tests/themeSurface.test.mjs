import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createPinia, setActivePinia, disposePinia } from 'pinia';
import { useThemeStore } from '../src/stores/theme.ts';

const bootScript = readFileSync(new URL('../public/homura-boot.js', import.meta.url), 'utf8');

async function fixture(run, { saved = {}, dark = false, reduced = true } = {}) {
  const dom = new JSDOM('<!doctype html><html data-mode="light"><head><meta id="homuraThemeColor" content="#F8FAFC"></head><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const names = ['window', 'document', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  let listener = null;
  let frame = 0;
  const media = {
    matches: dark,
    addEventListener(_name, callback) { listener = callback; },
    removeEventListener() { listener = null; }
  };
  dom.window.matchMedia = query => query.includes('prefers-reduced-motion') ? { matches: reduced } : media;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: () => ++frame, cancelAnimationFrame() {}
  });
  const chrome = [];
  window.__TAURI__ = { window: { getCurrentWindow: () => ({
    setTheme: async value => { chrome.push(['theme', value]); },
    setBackgroundColor: async value => { chrome.push(['canvas', value]); }
  }) } };
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
  const pinia = createPinia();
  setActivePinia(pinia);
  try {
    await run({ theme: useThemeStore(), chrome, boot: () => dom.window.eval(bootScript), systemDark(value) { media.matches = value; listener?.(); } });
  } finally {
    disposePinia(pinia);
    dom.window.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
}

test('纯黑偏好持久化但不改变白昼和主题色，夜间同步窗口与地址栏底色', () => fixture(({ theme, chrome }) => {
  theme.setThemeColor('green');
  theme.setPureBlackMode(true);
  assert.equal(localStorage.getItem('homura_pure_black'), 'true');
  assert.equal(theme.surfaceMode, 'light');
  assert.equal(document.getElementById('homuraThemeColor').content, '#F8FAFC');
  assert.deepEqual(chrome.at(-1), ['canvas', '#F8FAFC']);
  theme.setSurfaceMode('dark');
  assert.equal(document.documentElement.dataset.black, 'pure');
  assert.equal(document.documentElement.dataset.mode, 'dark');
  assert.equal(document.documentElement.dataset.theme, 'green');
  assert.equal(document.getElementById('homuraThemeColor').content, '#000000');
  assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
  theme.setPureBlackMode(false);
  assert.equal(localStorage.getItem('homura_pure_black'), 'false');
  assert.equal(document.documentElement.dataset.black, 'standard');
  assert.equal(document.getElementById('homuraThemeColor').content, '#0F1115');
  assert.deepEqual(chrome.at(-1), ['canvas', '#0F1115']);
}));

test('跟随系统进入夜间时应用纯黑，返回白昼仍保留纯黑偏好', () => fixture(({ theme, systemDark, chrome }) => {
  assert.equal(theme.pureBlackMode, true);
  theme.setSurfaceMode('auto');
  assert.equal(document.documentElement.dataset.mode, 'light');
  systemDark(true);
  assert.equal(theme.effectiveSurfaceMode, 'dark');
  assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
  systemDark(false);
  assert.equal(document.documentElement.dataset.mode, 'light');
  assert.equal(theme.pureBlackMode, true);
  assert.equal(document.getElementById('homuraThemeColor').content, '#F8FAFC');
}, { saved: { homura_pure_black: 'true' } }));

test('启动引导在 Vue 加载前恢复纯黑，并与设置 Store 保持一致', async () => {
  for (const [mode, dark, expected] of [['dark', false, '#000000'], ['auto', true, '#000000'], ['auto', false, '#F8FAFC'], ['light', true, '#F8FAFC']]) {
    await fixture(({ theme, boot }) => {
      boot();
      const before = document.getElementById('homuraThemeColor').content;
      assert.equal(before, expected);
      assert.equal(document.documentElement.dataset.black, 'pure');
      theme.setSurfaceMode(mode, true);
      assert.equal(document.getElementById('homuraThemeColor').content, before);
    }, { saved: { homura_pure_black: 'true', homura_surface_mode: mode }, dark });
  }
});

test('没有或无效的纯黑偏好沿用标准夜间模式', async () => {
  for (const saved of [{}, { homura_pure_black: 'invalid' }]) {
    await fixture(({ theme, boot }) => {
      boot();
      assert.equal(theme.pureBlackMode, false);
      theme.setSurfaceMode('dark', true);
      assert.equal(document.documentElement.dataset.black, 'standard');
      assert.equal(document.getElementById('homuraThemeColor').content, '#0F1115');
    }, { saved });
  }
});

test('纯黑切换在圆形展开动画开始时同步原生底色，连续切换只保留一个遮罩', () => fixture(({ theme, chrome }) => {
  theme.setSurfaceMode('dark', true);
  theme.setPureBlackMode(true, { x: 20, y: 30 });
  assert.equal(document.querySelectorAll('.surface-reveal').length, 1);
  assert.equal(document.documentElement.dataset.black, 'pure');
  assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
  theme.setPureBlackMode(false, { x: 40, y: 60 });
  assert.equal(document.querySelectorAll('.surface-reveal').length, 1);
  assert.equal(document.documentElement.dataset.black, 'standard');
  assert.deepEqual(chrome.at(-1), ['canvas', '#0F1115']);
}, { reduced: false }));
