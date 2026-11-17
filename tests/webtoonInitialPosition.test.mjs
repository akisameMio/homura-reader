import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';

const { window } = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window, document: window.document, Element: window.Element,
  HTMLElement: window.HTMLElement, SVGElement: window.SVGElement,
  getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}
});
const { createApp, reactive, nextTick } = await import('vue');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/WebtoonView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'webtoon-initial-position-test', inlineTemplate: true }).content;
compiled = compiled.replace(/import .* from ['"]([^'"]+)['"];?/g, (line, specifier) => {
  if (specifier === 'vue') return line.replace(specifier, pathToFileURL(require.resolve('vue')).href);
  if (specifier.endsWith('/reader.ts')) return 'const useReaderStore = () => globalThis.webtoonTestReader;';
  if (specifier.endsWith('/pagination.ts')) return 'const decodePageImage = async () => true; const releaseDistantPageUrls = () => {};';
  if (specifier.endsWith('/runtimeLogs.ts')) return 'const logRuntimeOperation = () => {};';
  if (specifier.endsWith('/useI18n.ts')) return 'const useI18n = () => ({ t: value => value });';
  if (specifier.endsWith('/ReaderFooter.vue')) return 'const ReaderFooter = { render: () => null };';
  if (specifier.startsWith('../')) return line.replace(specifier, new URL('../src/components/' + specifier, import.meta.url).href);
  return line;
});
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: WebtoonView } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

// jsdom 没有布局：用固定章节间距模拟长卷，并记录真正发生的定位。
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const index = Number(this.id.replace('webtoon-page-', ''));
  return { top: this.matches('[data-novel-section]') ? index * 1000 : 0 };
};
window.HTMLElement.prototype.scrollTo = function (options) {
  this.scrollTop = options.top;
};
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { get: () => 4000 });

test('滚动视图首次绘制前恢复目标章节，后续帧不再从卷首跳转', async () => {
  for (const index of [0, 1, 2]) {
    globalThis.webtoonTestReader = reactive({
      currentBook: { id: 'novel', type: 'novel' }, currentIndex: index,
      layoutConfig: { direction: 'vertical' },
      activePages: Array.from({ length: 3 }, (_, i) => ({ pageNumber: i + 1, chapterIndex: i, title: `章 ${i}`, html: '<p>正文</p>' })),
      webtoonBounds: { atStart: false, atEnd: false },
      touchProgress() {}
    });
    const app = createApp(WebtoonView);
    app.mount('#app');
    try {
      const root = document.querySelector('[data-reader-scroll]');
      assert.equal(root.scrollTop, index * 1000, '挂载返回时已恢复章节');
      assert.equal(globalThis.webtoonTestReader.currentIndex, index);
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 70));
      assert.equal(root.scrollTop, index * 1000, '不存在延迟定位造成的第二次跳动');
    } finally { app.unmount(); }
  }
  delete globalThis.webtoonTestReader;
});
