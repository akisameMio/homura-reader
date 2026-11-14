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
  window, document: window.document, Element: window.Element,
  HTMLElement: window.HTMLElement, SVGElement: window.SVGElement, Node: window.Node
});
window.matchMedia = () => ({ matches: true });
const { createApp, h, nextTick, reactive, ref } = await import('vue');
const { createPinia, setActivePinia } = await import('pinia');
const { useUiStore } = await import('../src/stores/ui.ts');
const require = createRequire(import.meta.url);

async function compile(name, replacements = []) {
  const source = await readFile(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  let compiled = compileScript(descriptor, { id: name, inlineTemplate: true }).content;
  compiled = compiled.replace(/from ["']vue["']/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
  if (compiled.includes('Transition as _Transition')) {
    compiled = compiled.replace(/Transition as _Transition,?/, '');
    compiled = `const _Transition = { inheritAttrs: false, emits: ['after-enter'], setup: (_, { slots }) => () => slots.default?.() };\n${compiled}`;
  }
  for (const [from, to] of replacements) compiled = compiled.replaceAll(from, to);
  compiled = compiled.replaceAll("'../composables/useI18n.ts'", `'${new URL('../src/composables/useI18n.ts', import.meta.url).href}'`);
  const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

const iconStub = ["import MdIcon from './MdIcon.vue';", 'const MdIcon = { render: () => null };'];
const header = await compile('ReaderDrawerHeader', [iconStub]);
const tabs = await compile('ReaderDrawerTabs');
const drawer = await compile('ReaderTocDrawer', [
  iconStub,
  ["'./ReaderDrawerHeader.vue'", `'${header}'`],
  ["'./ReaderDrawerTabs.vue'", `'${tabs}'`],
  ["import { useReaderStore } from '../stores/reader.ts';", 'const useReaderStore = () => globalThis.tocTestReader;'],
  ["import { useViewport } from '../composables/useViewport.ts';", 'const useViewport = () => ({ isCompact: globalThis.tocTestCompact });'],
  ["'../stores/ui.ts'", `'${new URL('../src/stores/ui.ts', import.meta.url).href}'`],
  ["'../composables/useSheetDrag.ts'", `'${new URL('../src/composables/useSheetDrag.ts', import.meta.url).href}'`],
  ["'../composables/useSheetSpring.ts'", `'${new URL('../src/composables/useSheetSpring.ts', import.meta.url).href}'`]
]);
const { default: ReaderTocDrawer } = await import(drawer);

async function mount({ collection = true, manga = false, openResult = true } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const ui = useUiStore();
  const calls = [];
  const reader = reactive({
    currentBook: { id: 'a', title: '当前书本', type: manga ? 'manga' : 'novel' },
    currentCollection: collection ? { id: 'shelf', title: '测试书库' } : null,
    collectionBooks: [{ id: 'a', title: '当前书本' }, { id: 'b', title: '下一本书' }],
    activePages: [
      { chapterIndex: 0, title: '第一章' },
      { chapterIndex: 0, title: '第一章' },
      { chapterIndex: 1, title: '第二章' }
    ],
    currentIndex: 1,
    openingBook: false,
    jumpToPage(index) { calls.push(['jump', index]); },
    async openCollectionBook(id) { calls.push(['open', id]); return openResult; }
  });
  globalThis.tocTestReader = reader;
  globalThis.tocTestCompact = ref(false);
  const app = createApp({ render: () => h(ReaderTocDrawer) });
  app.use(pinia);
  app.mount('#app');
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  ui.openToc();
  await nextTick();
  await nextTick();
  return {
    ui, reader, calls, trigger,
    cleanup() { ui.resetReaderUi(); app.unmount(); trigger.remove(); }
  };
}

function tab(value) { return document.querySelector(`#reader-toc-tab-${value}`); }

test('章节与书库共用同一个抽屉，键盘切换更新面板并聚焦选中分类', async () => {
  const context = await mount();
  try {
    const sheet = document.querySelector('[role="dialog"]');
    assert.equal(document.querySelectorAll('.md-scrim').length, 1);
    assert.equal(document.activeElement.getAttribute('aria-label'), '关闭目录');
    assert.equal(document.querySelectorAll('#reader-toc-panel-book button').length, 2);
    assert.equal(document.querySelector('#reader-toc-panel-book [aria-current]').title, '第一章');
    tab('book').focus();
    tab('book').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();
    assert.equal(tab('collection').getAttribute('aria-selected'), 'true');
    assert.equal(document.querySelector('[role="dialog"]'), sheet);
    assert.equal(document.activeElement, tab('collection'));
    assert.equal(tab('collection').getAttribute('aria-selected'), 'true');
    assert.equal(document.querySelector('#reader-toc-panel-book').style.display, 'none');
    document.querySelector('[aria-label="打开书库书本：下一本书"]').click();
    await nextTick();
    assert.deepEqual(context.calls, [['open', 'b']]);
    assert.equal(context.ui.tocOpen, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.activeElement, context.trigger);
  } finally { context.cleanup(); }
});

test('章节跳转使用聚合后的首个页号，关闭抽屉而不退出阅读器', async () => {
  const context = await mount();
  try {
    document.querySelectorAll('#reader-toc-panel-book button')[1].click();
    assert.deepEqual(context.calls, [['jump', 2]]);
    assert.equal(context.ui.tocOpen, false);
    assert.equal(context.reader.currentBook.id, 'a');
  } finally { context.cleanup(); }
});

test('切书失败保留本目录和当前书；重复点当前书只关闭抽屉', async () => {
  const context = await mount({ openResult: false });
  try {
    tab('collection').click();
    await nextTick();
    document.querySelector('[aria-label="打开书库书本：下一本书"]').click();
    await nextTick();
    assert.equal(context.ui.tocOpen, true);
    assert.equal(tab('collection').getAttribute('aria-selected'), 'true');
    assert.equal(context.reader.currentBook.id, 'a');
    document.querySelector('[aria-label="打开书库书本：当前书本，正在阅读"]').click();
    assert.deepEqual(context.calls, [['open', 'b']]);
    assert.equal(context.ui.tocOpen, false);
  } finally { context.cleanup(); }
});

test('脱离书库时回到章节目录，无书库时不显示无效分类', async () => {
  const context = await mount();
  try {
    tab('collection').click();
    await nextTick();
    context.reader.currentCollection = null;
    await nextTick();
    assert.equal(document.querySelector('[role="tablist"]'), null);
    assert.equal(document.querySelector('#reader-toc-panel-book').style.display, '');
    document.querySelector('[role="dialog"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(context.ui.tocOpen, false);
    assert.equal(context.reader.currentBook.id, 'a');
  } finally { context.cleanup(); }
});

test('漫画页码跳转保留原始索引，重新打开默认回到目录分类', async () => {
  const context = await mount({ manga: true });
  try {
    assert.equal(document.querySelectorAll('.md-toc-page').length, 3);
    document.querySelector('[aria-label="跳转到第 3 页"]').click();
    assert.deepEqual(context.calls, [['jump', 2]]);
    context.ui.openToc();
    await nextTick();
    tab('collection').click();
    await nextTick();
    context.ui.closeToc();
    await nextTick();
    context.ui.openToc();
    await nextTick();
    assert.equal(tab('book').getAttribute('aria-selected'), 'true');
    context.ui.openSettings();
    assert.equal(context.ui.tocOpen, false);
    assert.equal(context.ui.readerDrawerOpen, true);
    context.ui.openToc();
    assert.equal(context.ui.settingsOpen, false);
    context.ui.openFontMenu();
    assert.equal(context.ui.tocOpen, false);
  } finally { context.cleanup(); }
});

test('切换到本目录只滚动抽屉自身，将当前书居中而不移动阅读画布', async () => {
  const context = await mount();
  try {
    const body = document.querySelector('.reader-toc-scroll');
    const active = document.querySelector('#reader-toc-panel-collection [aria-current]');
    body.getBoundingClientRect = () => ({ top: 100, height: 400 });
    active.getBoundingClientRect = () => ({ top: 860, height: 60 });
    document.documentElement.scrollTop = 80;
    tab('collection').click();
    await nextTick();
    await nextTick();
    assert.equal(body.scrollTop, 590);
    assert.equal(document.documentElement.scrollTop, 80);
  } finally {
    context.cleanup();
    document.documentElement.scrollTop = 0;
  }
});
