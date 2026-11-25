import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';

const { window } = new JSDOM('<meta id="homuraThemeColor"><div id="app"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window, document: window.document, localStorage: window.localStorage,
  Element: window.Element, HTMLElement: window.HTMLElement, SVGElement: window.SVGElement,
  getComputedStyle: window.getComputedStyle.bind(window)
});
globalThis.requestAnimationFrame = window.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = () => {};
let reducedMotion = false;
window.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion') && reducedMotion, addEventListener() {}, removeEventListener() {} });
const { createApp, h, reactive, nextTick } = await import('vue');
const { createPinia, disposePinia } = await import('pinia');
const { useThemeStore } = await import('../src/stores/theme.ts');
const { playShelfToReaderSplash } = await import('../src/services/readerTransition.ts');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/ReaderLoadingPage.vue', import.meta.url), 'utf8');
const tokens = await readFile(new URL('../src/assets/styles/tokens.css', import.meta.url), 'utf8');
const paperColors = Object.fromEntries(['--md-parchment-paper', '--md-reader-green-paper'].map(token => [token, tokens.match(new RegExp(`${token}:\\s*([^;]+);`))[1]]));
for (const [token, color] of Object.entries(paperColors)) document.documentElement.style.setProperty(token, color);
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'reader-loading-surface-test', inlineTemplate: true }).content;
compiled = compiled.replace(/from ["']vue["']/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
compiled = compiled.replace(/from '(\.\.\/[^']+\.ts)'/g, (_, path) => `from '${new URL('../src/components/' + path, import.meta.url).href}'`);
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: ReaderLoadingPage } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function finishAnimation() {
  document.querySelector('.rlp-surface').dispatchEvent(new window.Event('animationend'));
  return nextTick();
}

async function fixture(run, { paper = 'parchment', mode = 'light', reduced = false } = {}) {
  reducedMotion = reduced;
  localStorage.clear();
  const chrome = [];
  window.__TAURI__ = { window: { getCurrentWindow: () => ({
    setTheme: async value => chrome.push(['theme', value]),
    setBackgroundColor: async value => chrome.push(['canvas', value])
  }) } };
  const pinia = createPinia();
  const theme = useThemeStore(pinia);
  theme.setSurfaceMode(mode, true);
  theme.setPureBlackMode(mode === 'dark');
  theme.setReaderSurfaceMode(paper);
  const props = reactive({ visible: false, reveal: false, phase: 'loading', title: '测试书籍', cover: '' });
  const app = createApp({ render: () => h(ReaderLoadingPage, props) });
  app.use(pinia);
  app.mount('#app');
  try { await run({ theme, chrome, props, app }); }
  finally { if (app._instance) app.unmount(); disposePinia(pinia); }
}

test('加载页出现即同步纸面和原生标题栏，数据提前就绪不会再改变背景', async () => {
  for (const mode of ['light', 'dark']) {
    for (const [paper, token] of [['parchment', '--md-parchment-paper'], ['green', '--md-reader-green-paper']]) {
      await fixture(async ({ theme, chrome, props }) => {
        props.visible = true;
        await nextTick();
        const root = document.querySelector('.rlp-root');
        assert.ok(root.classList.contains('reader-surface'));
        assert.equal(root.dataset.readerMode, paper);
        assert.deepEqual(chrome.slice(-2), [['theme', 'light'], ['canvas', paperColors[token]]]);
        theme.setReaderActive(true);
        assert.equal(document.getElementById('homuraThemeColor').content, paperColors[token]);
        props.reveal = true;
        props.visible = false;
        await nextTick();
        assert.equal(document.querySelector('.rlp-root'), null);
        assert.deepEqual(chrome.at(-1), ['canvas', paperColors[token]]);
        theme.setReaderActive(false);
        assert.deepEqual(chrome.at(-1), ['canvas', mode === 'dark' ? '#000000' : '#F8FAFC']);
      }, { mode, paper, reduced: true });
    }
  }
});

test('加载错误期间跟随阅读纸面，取消后恢复全局外观', () => fixture(async ({ theme, chrome, props }) => {
  props.visible = true;
  await nextTick();
  props.phase = 'error';
  theme.setReaderSurfaceMode('green');
  await nextTick();
  assert.ok(document.querySelector('.rlp-retry'));
  assert.equal(document.querySelector('.rlp-root').dataset.readerMode, 'green');
  assert.deepEqual(chrome.at(-1), ['canvas', paperColors['--md-reader-green-paper']]);
  props.visible = false;
  await nextTick();
  assert.equal(document.querySelector('.rlp-root'), null);
  assert.deepEqual(chrome.slice(-2), [['theme', 'dark'], ['canvas', '#000000']]);
}, { mode: 'dark' }));

test('减少动效时快速重新打开加载页不会被旧离场定时器关闭，卸载后释放标题栏配色', () => fixture(async ({ theme, chrome, props, app }) => {
  props.visible = true;
  await nextTick();
  props.visible = false;
  await nextTick();
  props.visible = true;
  await nextTick();
  assert.ok(document.querySelector('.rlp-root'));
  theme.setReaderSurfaceMode('settings');
  assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
  theme.setReaderSurfaceMode('parchment');
  assert.deepEqual(chrome.at(-1), ['canvas', paperColors['--md-parchment-paper']]);
  app.unmount();
  assert.deepEqual(chrome.at(-1), ['canvas', '#000000']);
}, { mode: 'dark', reduced: true }));


test('揭幕被重新打开打断时保持遮罩和纸面，完成后恢复书架颜色', () => fixture(async ({ chrome, props }) => {
  props.visible = true;
  await nextTick();
  props.reveal = true;
  props.visible = false;
  await nextTick();
  assert.ok(document.querySelector('.rlp-root.is-leaving'));
  props.visible = true;
  props.reveal = false;
  await nextTick();
  await finishAnimation();
  assert.ok(document.querySelector('.rlp-root:not(.is-leaving)'));
  assert.deepEqual(chrome.at(-1), ['canvas', paperColors['--md-parchment-paper']]);
  props.reveal = true;
  props.visible = false;
  await nextTick();
  assert.ok(document.querySelector('.rlp-root.is-leaving'));
  await finishAnimation();
  assert.equal(document.querySelector('.rlp-root'), null);
  assert.deepEqual(chrome.at(-1), ['canvas', '#F8FAFC']);
}));

test('飞行封面独占绘制，落位或取消时同步交还两端', async () => {
  reducedMotion = false;
  const source = document.createElement('div');
  const layer = document.createElement('div');
  const shadow = document.createElement('div');
  const target = document.createElement('div');
  shadow.append(target);
  layer.append(shadow);
  document.body.append(source, layer);
  source.getBoundingClientRect = () => ({ left: 10, top: 20, width: 90, height: 120 });
  target.getBoundingClientRect = () => ({ left: 160, top: 200, width: 160, height: 160 });
  const animate = window.HTMLElement.prototype.animate;
  const animations = [];
  window.HTMLElement.prototype.animate = function (keyframes) {
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    animations.push({ keyframes, finish });
    return { finished, cancel: finish };
  };
  try {
    for (const cancelled of [false, true]) {
      const flight = playShelfToReaderSplash(source, target, layer);
      assert.equal(source.style.opacity, '0');
      assert.equal(target.style.opacity, '0');
      assert.equal(layer.querySelectorAll('.rlp-flying-cover').length, 1);
      assert.equal(animations.at(-2).keyframes[1].transform, 'translate(0, 0) scale(1)');
      assert.equal(animations.at(-1).keyframes[1].clipPath, 'inset(0px 0px round 0px)');
      if (cancelled) flight.cancel();
      else animations.at(-2).finish();
      await flight.finished;
      assert.equal(layer.querySelector('.rlp-flying-cover'), null);
      assert.equal(source.style.opacity, '');
      assert.equal(target.style.opacity, '');
    }
  } finally {
    window.HTMLElement.prototype.animate = animate;
    source.remove();
    layer.remove();
  }
});
