import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPinia, setActivePinia, disposePinia } from 'pinia';
import { registerHooks } from 'node:module';
import { useSettingsStore } from '../src/stores/settings.ts';
import { TRANSITION_OPTIONS, useThemeStore } from '../src/stores/theme.ts';
import { HomuraStore } from '../src/services/storage.ts';

// Node 不处理 Vite 的静态资源查询，沿用导入测试里的 worker 地址替身。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) return { url: 'data:text/javascript,export default "worker.js"', shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const { useReaderStore } = await import('../src/stores/reader.ts');
const { useShelfStore } = await import('../src/stores/shelf.ts');

async function fixture(run, saved = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'localStorage', 'Node', 'NodeFilter', 'getComputedStyle'];
  const original = new Map(globals.map(key => [key, globalThis[key]]));
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
  const pinia = createPinia();setActivePinia(pinia);
  const theme = useThemeStore(), settings = useSettingsStore(), reader = useReaderStore(), shelf = useShelfStore();
  const records = [];
  const saveProgress = HomuraStore.saveProgress;
  HomuraStore.saveProgress = async record => { records.push(structuredClone(record)); };
  const measurer = document.createElement('div');
  Object.defineProperties(measurer, {
    scrollHeight: { get() { return this.textContent.length * 3; } },
    scrollWidth: { get() { return this.textContent.length * 2; } }
  });
  document.body.appendChild(measurer);
  reader.measurerEl = measurer;
  try {
    await run({ reader, settings, theme, shelf, records });
  } finally {
    reader.closeReader();
    HomuraStore.saveProgress = saveProgress;
    disposePinia(pinia);
    dom.window.close();
    for (const [key, value] of original) {
      if (value === undefined) delete globalThis[key];else globalThis[key] = value;
    }
  }
}

function manga(id = 'manga') {
  return { id, type: 'manga', format: 'images', pageItems: Array.from({ length: 6 }, (_, index) => ({ url: `page-${index}.webp` })) };
}

test('翻页方式替换无动画为滚动，旧无动画偏好回退分页滑动', () => fixture(({ theme }) => {
  assert.deepEqual(TRANSITION_OPTIONS.map(option => [option.value, option.label]), [
    ['slide', '滑动'], ['curl', '卷页'], ['scroll', '滚动'], ['fade', '淡入']
  ]);
  assert.equal(theme.transitionStyle, 'slide');
}, { homura_transition_style: 'none' }));

test('设置页滚动默认值持久化，切回分页恢复 RTL，旧纵向默认值仍识别为滚动', () => fixture(({ settings, theme }) => {
  assert.equal(settings.transitionStyle, 'scroll');
  settings.setTransitionStyle('curl');
  assert.equal(settings.readerDefaults.direction, 'rtl');
  settings.setTransitionStyle('scroll');
  assert.equal(theme.transitionStyle, 'curl');
  assert.equal(settings.readerDefaults.direction, 'vertical');
  const saved = JSON.parse(localStorage.getItem('homura_reader_defaults'));
  assert.equal(saved.direction, 'vertical');
  assert.equal(saved.pagedDirection, 'rtl');
  settings.setTransitionStyle('fade');
  assert.equal(settings.readerDefaults.direction, 'rtl');
  assert.equal(settings.transitionStyle, 'fade');
  settings.setTransitionStyle('scroll');
  settings.resetReaderDefaults();
  assert.equal(settings.readerDefaults.direction, 'ltr');
}, { homura_reader_defaults: JSON.stringify({ direction: 'vertical', pagedDirection: 'rtl' }) }));

test('漫画滚动复用按屏滚动与进度跳转，重开保存滚动模式及原来的左右方向', () => fixture(async ({ reader, settings, shelf, records }) => {
  shelf.library = [manga(), manga('other')];
  assert.equal(await reader.openBook('manga'), true);
  reader.setDirection('rtl');
  reader.setTransitionStyle('scroll');
  assert.equal(reader.transitionStyle, 'scroll');
  assert.equal(reader.layoutConfig.direction, 'vertical');
  assert.equal(settings.readerDefaults.direction, 'ltr');
  const movements = [], targets = [];
  reader.webtoonScrollBy = direction => movements.push(direction);
  reader.webtoonScrollTo = index => targets.push(index);
  reader.goNextPage();reader.goPrevPage();reader.onSliderInput(3);
  assert.deepEqual(movements, [1, -1]);
  assert.deepEqual(targets, [3]);
  reader.setWebtoonFit('wide');
  reader.closeReader();
  assert.equal(records.at(-1).layout.direction, 'vertical');
  assert.equal(records.at(-1).layout.pagedDirection, 'rtl');
  assert.equal(await reader.openBook('manga'), true);
  assert.equal(reader.transitionStyle, 'scroll');
  assert.equal(reader.currentIndex, 3);
  assert.equal(reader.layoutConfig.webtoonFit, 'wide');
  reader.setTransitionStyle('curl');
  assert.equal(reader.layoutConfig.direction, 'rtl');
  assert.equal(reader.transitionStyle, 'curl');
  assert.equal(await reader.openBook('other'), true);
  assert.equal(reader.layoutConfig.direction, 'ltr');
  assert.equal(reader.transitionStyle, 'curl');
}));

test('旧条漫记录继续纵向阅读，默认滚动仅用于没有排版记忆的新书', () => fixture(async ({ reader, settings, shelf }) => {
  shelf.library = [manga('old-scroll'), manga('old-paged'), manga('new')];
  shelf.progressMap = {
    'old-scroll': { id: 'old-scroll', type: 'manga', ratio: 0.4, layout: { direction: 'vertical' } },
    'old-paged': { id: 'old-paged', type: 'manga', ratio: 0, layout: { direction: 'rtl' } }
  };
  settings.setTransitionStyle('scroll');
  assert.equal(await reader.openBook('old-scroll'), true);
  assert.equal(reader.transitionStyle, 'scroll');
  assert.equal(reader.currentIndex, 2);
  reader.setTransitionStyle('slide');
  assert.equal(reader.layoutConfig.direction, 'ltr');
  assert.equal(await reader.openBook('old-paged'), true);
  assert.equal(reader.layoutConfig.direction, 'rtl');
  assert.equal(reader.transitionStyle, 'slide');
  assert.equal(await reader.openBook('new'), true);
  assert.equal(reader.transitionStyle, 'scroll');
}));

test('小说切换滚动后按章节展开，切回分页和再次打开保留所在章节', () => fixture(async ({ reader, shelf }) => {
  shelf.library = [{
    id: 'novel', type: 'novel', format: 'txt',
    chapters: Array.from({ length: 3 }, (_, index) => ({ title: `章节 ${index}`, htmlContent: `<p>${`第${index}章的故事。`.repeat(180)}</p>` }))
  }];
  assert.equal(await reader.openBook('novel'), true);
  assert.ok(reader.activePages.length > 3);
  reader.currentIndex = reader.activePages.findIndex(page => page.chapterIndex === 1);
  reader.setDirection('rtl');
  reader.setTransitionStyle('scroll');
  assert.equal(reader.activePages.length, 3);
  assert.equal(reader.currentIndex, 1);
  assert.match(reader.activePages[1].html, /第1章的故事/);
  reader.onSliderInput(2);
  reader.setTransitionStyle('fade');
  assert.equal(reader.layoutConfig.direction, 'rtl');
  assert.equal(reader.activePages[reader.currentIndex].chapterIndex, 2);
  reader.setTransitionStyle('scroll');
  reader.closeReader();
  assert.equal(await reader.openBook('novel'), true);
  assert.equal(reader.transitionStyle, 'scroll');
  assert.equal(reader.currentIndex, 2);
  reader.setTransitionStyle('invalid');
  assert.equal(reader.transitionStyle, 'scroll');
}));

test('竖排文字按书保存、重开恢复，切换横竖排保留所在章节且不改左右方向', () => fixture(async ({ reader, settings, shelf, records }) => {
  shelf.library = [{
    id: 'vertical-novel', type: 'novel', format: 'epub',
    chapters: Array.from({ length: 3 }, (_, index) => ({ title: `章节 ${index}`, htmlContent: `<p>${`第${index}章的故事。`.repeat(100)}</p>` }))
  }, manga('bitmap')];
  assert.equal(await reader.openBook('vertical-novel'), true);
  assert.equal(reader.layoutConfig.verticalText, false);
  reader.currentIndex = reader.activePages.findIndex(page => page.chapterIndex === 1);
  reader.setDirection('rtl');
  reader.setVerticalText(true);
  assert.equal(reader.layoutConfig.verticalText, true);
  assert.equal(reader.layoutConfig.direction, 'rtl');
  assert.equal(reader.activePages[reader.currentIndex].chapterIndex, 1);
  assert.equal(reader.measurerEl.style.writingMode, 'vertical-rl');
  assert.equal(settings.readerDefaults.verticalText, false);
  reader.closeReader();
  assert.equal(records.at(-1).layout.verticalText, true);
  assert.equal(await reader.openBook('vertical-novel'), true);
  assert.equal(reader.layoutConfig.verticalText, true);
  assert.equal(reader.activePages[reader.currentIndex].chapterIndex, 1);
  reader.setTransitionStyle('scroll');
  reader.setVerticalText(false);
  assert.equal(reader.layoutConfig.verticalText, true);
  reader.setTransitionStyle('curl');
  assert.equal(reader.measurerEl.style.writingMode, 'vertical-rl');
  reader.setVerticalText(false);
  assert.equal(reader.measurerEl.style.writingMode, 'horizontal-tb');
  assert.equal(reader.activePages[reader.currentIndex].chapterIndex, 1);
  assert.equal(await reader.openBook('bitmap'), true);
  reader.setVerticalText(true);
  assert.equal(reader.layoutConfig.verticalText, false);
}));

test('竖排默认值只给未保存该选项的作品，已有横排记录不被覆盖', () => fixture(async ({ reader, settings, shelf }) => {
  assert.equal(settings.readerDefaults.verticalText, false);
  settings.setReaderDefault('verticalText', true);
  assert.equal(JSON.parse(localStorage.getItem('homura_reader_defaults')).verticalText, true);
  const novel = id => ({ id, type: 'novel', format: 'txt', chapters: [{ title: '第一章', htmlContent: '<p>正文。</p>' }] });
  shelf.library = [novel('new'), novel('horizontal')];
  shelf.progressMap = { horizontal: { id: 'horizontal', ratio: 0, layout: { verticalText: false } } };
  assert.equal(await reader.openBook('new'), true);
  assert.equal(reader.layoutConfig.verticalText, true);
  assert.equal(await reader.openBook('horizontal'), true);
  assert.equal(reader.layoutConfig.verticalText, false);
}));

test('小说实际单双页与分页测量共用断点，899px 不会把两页挤入单页宽度', () => fixture(async ({ reader, shelf }) => {
  shelf.library = [{ id: 'geometry', type: 'novel', format: 'txt', chapters: [{ title: '第一章', htmlContent: '<p>正文。</p>' }] }];
  assert.equal(await reader.openBook('geometry'), true);
  reader.layoutConfig.coverOffset = false;
  for (const [width, double] of [[390, false], [899, false], [900, true], [1440, true]]) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    reader.getSpreadPair(0);
    assert.equal(reader.effectiveDouble, double, `宽度 ${width}`);
  }
}));
