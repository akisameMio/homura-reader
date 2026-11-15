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
let reducedMotion = false;
window.matchMedia = () => ({ matches: reducedMotion });
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
const { createApp, reactive, shallowReactive, h, nextTick } = await import('vue');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/PaginatedView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'paginated-fade-test', inlineTemplate: true }).content;
compiled = compiled.replace(/from ["']vue["']/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
for (const [name, store] of [['Reader', 'reader'], ['Theme', 'theme'], ['Ui', 'ui']]) {
  compiled = compiled.replace(new RegExp(`import \\{ use${name}Store \\} from [^;]+;`), `const use${name}Store = () => globalThis.__fadeTest.${store};`);
}
compiled = compiled.replace(/import \{ useViewport \} from [^;]+;/, 'const useViewport = () => ({ isCompact: computed(() => true) });');
compiled = compiled.replace("import NovelCard from './NovelCard.vue';", "const NovelCard = { props: ['page'], template: '<article>{{ page.html }}</article>' };");
compiled = compiled.replace("import ReaderFooter from './ReaderFooter.vue';", 'const ReaderFooter = { render: () => null };');
compiled = compiled.replace(/from '(\.\.\/[^']+\.ts)'/g, (_, path) => `from '${new URL('../src/components/' + path, import.meta.url).href}'`);
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: PaginatedView } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function flush() {
  for (let i = 0; i < 12; i++) await nextTick();
}

async function fixture(run) {
  reducedMotion = false;
  const animations = [];
  window.HTMLElement.prototype.animate = function (keyframes, options) {
    const animation = {
      element: this, keyframes, options, onfinish: null, oncancel: null,
      cancelled: false,
      cancel() { this.cancelled = true; this.oncancel?.(); },
      finish() { this.onfinish?.(); }
    };
    animations.push(animation);
    return animation;
  };
  const reader = shallowReactive({
    currentBook: { id: 'fade-test', type: 'novel' }, currentIndex: 0,
    activePages: Array.from({ length: 5 }, (_, i) => ({ pageNumber: i + 1, html: `第 ${i + 1} 页` })),
    activeBufferSlot: 0, activeTransitionAnims: [], renderToken: 0,
    layoutConfig: reactive({ direction: 'ltr', spread: 1 }),
    effectiveDouble: false, touchProgress() {}, handleViewportChange() {},
    getSpreadPair(index) { return [this.activePages[index]]; }
  });
  const theme = reactive({ transitionStyle: 'fade' });
  const ui = reactive({ readerDrawerOpen: false });
  globalThis.__fadeTest = { reader, theme, ui };
  const app = createApp({ render: () => h(PaginatedView) });
  app.mount('#app');
  const slots = [...document.querySelectorAll('.stage-buffer-layer')];
  const turn = async (index, direction = 'enter-from-right') => {
    reader.currentIndex = index;
    reader.renderFn(direction);
    await flush();
  };
  await flush();
  try { await run({ reader, theme, ui, app, slots, animations, turn }); }
  finally { app.unmount(); delete globalThis.__fadeTest; }
}

test('淡入保留旧页托底、新页覆盖；正反翻页结束只留下目标页', () => fixture(async ({ reader, slots, animations, turn }) => {
  assert.equal(animations.length, 0);
  for (const index of [1, 0]) {
    const previous = reader.activeBufferSlot;
    await turn(index, index ? 'enter-from-right' : 'enter-from-left');
    const incoming = slots[reader.activeBufferSlot];
    assert.equal(slots[previous].style.opacity, '1');
    assert.equal(incoming.style.opacity, '1');
    assert.ok(Number(incoming.style.zIndex) > Number(slots[previous].style.zIndex));
    const animation = animations.at(-1);
    assert.equal(animation.element, incoming);
    assert.deepEqual(animation.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
    animation.finish();
    await flush();
    assert.equal(slots[previous].style.opacity, '0');
    assert.equal(incoming.style.opacity, '1');
    assert.equal(reader.activeTransitionAnims.length, 0);
  }
}));

test('连续翻页合并到最后目标，跳读打断后旧回调不能改写复用的槽位', () => fixture(async ({ reader, slots, animations, turn }) => {
  await turn(1);
  await turn(2);
  await turn(3);
  assert.equal(animations.length, 1);
  animations[0].finish();
  await flush();
  assert.equal(animations.length, 2);
  assert.match(slots[reader.activeBufferSlot].textContent, /第 4 页/);
  const staleFinish = animations[1].onfinish;
  await turn(4, 'none');
  assert.equal(animations[1].cancelled, true);
  staleFinish();
  await flush();
  assert.match(slots[reader.activeBufferSlot].textContent, /第 5 页/);
  assert.equal(slots[reader.activeBufferSlot].style.opacity, '1');
  assert.equal(slots[1 - reader.activeBufferSlot].style.opacity, '0');
}));

test('打开抽屉与切换翻页方式会同步收稳淡入，取消事件同样释放动画', () => fixture(async ({ reader, theme, ui, slots, animations, turn }) => {
  await turn(1);
  ui.readerDrawerOpen = true;
  await flush();
  assert.equal(animations[0].cancelled, true);
  assert.equal(slots[1 - reader.activeBufferSlot].style.opacity, '0');
  ui.readerDrawerOpen = false;
  await turn(2);
  theme.transitionStyle = 'none';
  await flush();
  assert.equal(animations[1].cancelled, true);
  theme.transitionStyle = 'fade';
  await flush();
  await turn(3);
  animations[2].cancel();
  await flush();
  assert.equal(reader.activeTransitionAnims.length, 0);
  assert.equal(slots[1 - reader.activeBufferSlot].style.opacity, '0');
}));

test('淡入期间再次按下会立即收稳，不留下双页叠影或阻塞下一次翻页', () => fixture(async ({ reader, slots, animations, turn }) => {
  await turn(1);
  const down = new window.Event('pointerdown');
  Object.assign(down, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 200 });
  document.querySelector('.reader-gesture-layer').dispatchEvent(down);
  assert.equal(animations[0].cancelled, true);
  assert.equal(slots[1 - reader.activeBufferSlot].style.opacity, '0');
  await flush();
  await turn(2);
  assert.equal(animations.length, 2);
  animations[1].finish();
  await flush();
  assert.match(slots[reader.activeBufferSlot].textContent, /第 3 页/);
}));

test('减少动态效果与无动画跳读直接切页，卸载时收回进行中的动画', () => fixture(async ({ reader, slots, animations, turn, app }) => {
  reducedMotion = true;
  await turn(1);
  await turn(2, 'none');
  assert.equal(animations.length, 0);
  assert.equal(slots[reader.activeBufferSlot].style.opacity, '1');
  assert.equal(slots[1 - reader.activeBufferSlot].style.opacity, '0');
  reducedMotion = false;
  const animate = window.HTMLElement.prototype.animate;
  delete window.HTMLElement.prototype.animate;
  await turn(3);
  assert.equal(animations.length, 0);
  window.HTMLElement.prototype.animate = animate;
  await turn(4);
  app.unmount();
  await flush();
  assert.equal(animations[0].cancelled, true);
  assert.equal(reader.activeTransitionAnims.length, 0);
  assert.equal(reader.renderFn, null);
}));
