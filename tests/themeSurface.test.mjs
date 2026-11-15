import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createPinia, setActivePinia, disposePinia } from 'pinia';
import { useThemeStore } from '../src/stores/theme.ts';

const bootScript = readFileSync(new URL('../public/homura-boot.js', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/assets/styles/tokens.css', import.meta.url), 'utf8');
const paperColors = Object.fromEntries(['--md-parchment-paper', '--md-reader-green-paper'].map(token => [token, tokens.match(new RegExp(`${token}:\\s*([^;]+);`))[1]]));

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
  for (const [token, color] of Object.entries(paperColors)) document.documentElement.style.setProperty(token, color);
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

test('进入阅读时标题栏立即跟随羊皮纸和护眼绿，退出恢复原有纯黑外观', async () => {
  for (const [paper, token] of [['parchment', '--md-parchment-paper'], ['green', '--md-reader-green-paper']]) {
    await fixture(({ theme, chrome }) => {
      theme.setSurfaceMode('dark', true);
      theme.setPureBlackMode(true);
      theme.setReaderSurfaceMode(paper);
      assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
      theme.setReaderActive(true);
      assert.deepEqual(chrome.slice(-2), [['theme', 'light'], ['canvas', paperColors[token]]]);
      assert.equal(document.getElementById('homuraThemeColor').content, paperColors[token]);
      assert.equal(theme.surfaceMode, 'dark');
      assert.equal(theme.pureBlackMode, true);
      theme.setReaderActive(false);
      assert.deepEqual(chrome.slice(-2), [['theme', 'dark'], ['canvas', '#000000']]);
      assert.equal(document.getElementById('homuraThemeColor').content, '#000000');
      assert.equal(localStorage.getItem('homura_reader_surface_mode'), paper);
    });
  }
});

test('阅读中切换纸面、全局表面或纯黑偏好，原生背景始终跟随当前可见纸面', () => fixture(({ theme, chrome }) => {
  theme.setReaderActive(true);
  theme.setReaderSurfaceMode('parchment');
  theme.setSurfaceMode('dark');
  assert.deepEqual(chrome.slice(-2), [['theme', 'light'], ['canvas', paperColors['--md-parchment-paper']]]);
  theme.setPureBlackMode(true);
  assert.deepEqual(chrome.at(-1), ['canvas', paperColors['--md-parchment-paper']]);
  theme.setReaderSurfaceMode('green');
  assert.deepEqual(chrome.at(-1), ['canvas', paperColors['--md-reader-green-paper']]);
  theme.setReaderSurfaceMode('settings');
  assert.deepEqual(chrome.slice(-2), [['theme', 'dark'], ['canvas', '#000000']]);
  assert.equal(document.getElementById('homuraThemeColor').content, '#000000');
  theme.setPureBlackMode(false);
  assert.deepEqual(chrome.at(-1), ['canvas', '#0F1115']);
}, { reduced: false }));

test('恢复独立阅读纸面后系统深浅色变化不覆盖标题栏，退出再同步系统外观', () => fixture(({ theme, chrome, systemDark }) => {
  theme.setSurfaceMode('auto', true);
  theme.setReaderActive(true);
  systemDark(true);
  assert.equal(theme.effectiveSurfaceMode, 'dark');
  assert.deepEqual(chrome.slice(-2), [['theme', 'light'], ['canvas', paperColors['--md-reader-green-paper']]]);
  theme.setReaderActive(false);
  assert.deepEqual(chrome.slice(-2), [['theme', 'dark'], ['canvas', '#0F1115']]);
  systemDark(false);
  assert.deepEqual(chrome.at(-1), ['canvas', '#F8FAFC']);
}, { saved: { homura_reader_surface_mode: 'green' } }));
