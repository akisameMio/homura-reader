import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) return { url: 'data:text/javascript,export default "test-worker"', shortCircuit: true };
    return nextResolve(specifier, context);
  }
});

const { window } = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window, document: window.document,
  Element: window.Element, HTMLElement: window.HTMLElement, SVGElement: window.SVGElement
});
const { createApp, h, nextTick } = await import('vue');
const { createPinia, disposePinia } = await import('pinia');
const { useShelfStore } = await import('../src/stores/shelf.ts');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/ContinueReading.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'continue-progress-test', inlineTemplate: true }).content;
compiled = compiled.replace(/from ['"]vue['"]/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
compiled = compiled.replace(/from '(\.\.\/[^']+\.ts)'/g, (_, path) => `from '${new URL('../src/components/' + path, import.meta.url).href}'`);
compiled = compiled.replace(/import MdIcon from '.\/MdIcon.vue';/, 'const MdIcon = { render: () => null };');
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: ContinueReading } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function fixture(run) {
  const pinia = createPinia();
  const shelf = useShelfStore(pinia);
  shelf.library = [{ id: 'reading', title: '测试书籍', type: 'epub', pageCount: 6 }];
  const app = createApp({ render: () => h(ContinueReading, { books: shelf.library }) });
  app.use(pinia);
  app.mount('#app');
  try { await run(shelf); }
  finally { app.unmount(); disposePinia(pinia); }
}

function expectProgress(value) {
  const track = document.querySelector('[role="progressbar"]');
  assert.equal(track.getAttribute('aria-valuenow'), String(value));
  assert.equal(track.style.getPropertyValue('--reading-progress'), `${value}%`);
  assert.equal(document.querySelector('.detail-value').textContent, `${value}%`);
  assert.equal(!!track.querySelector('.progress-active'), value > 0);
  assert.equal(track.classList.contains('is-complete'), value === 100);
}

test('特色卡波浪长度随真实阅读进度更新，返回书架后不会停留在固定长度', () => fixture(async shelf => {
  expectProgress(0);
  for (const [ratio, index, percent] of [[.2, 1, 20], [.6, 3, 60], [1, 5, 100], [.4, 2, 40], [0, 0, 0]]) {
    shelf.setProgressRecord({ id: 'reading', ratio, index, total: 6, updatedAt: Date.now() });
    await nextTick();
    expectProgress(percent);
    assert.equal(document.querySelector('.detail-position').textContent.trim(), `第 ${index + 1} / 6 页`);
  }
}));

test('切换最近阅读的书籍时，波浪与数字一起更新', () => fixture(async shelf => {
  shelf.library = [...shelf.library, { id: 'second', title: '第二本', type: 'manga', pageCount: 11 }];
  shelf.setProgressRecord({ id: 'reading', ratio: .6, index: 3, total: 6, updatedAt: 10 });
  await nextTick();
  expectProgress(60);
  shelf.setProgressRecord({ id: 'second', ratio: .3, index: 3, total: 11, updatedAt: 20 });
  await nextTick();
  assert.equal(document.querySelector('.book-title').textContent, '第二本');
  expectProgress(30);
}));
