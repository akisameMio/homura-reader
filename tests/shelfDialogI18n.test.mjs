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
const { createApp, h, nextTick } = await import('vue');
const { useI18n } = await import('../src/composables/useI18n.ts');
const { setLocale } = useI18n();
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/ShelfDialogContent.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
let compiled = compileScript(descriptor, { id: 'shelf-dialog-i18n', inlineTemplate: true }).content;
compiled = compiled.replace(/from ["']vue["']/g, `from '${pathToFileURL(require.resolve('vue')).href}'`);
compiled = compiled.replace("import MdIcon from './MdIcon.vue';", 'const MdIcon = { render: () => null };');
compiled = compiled.replaceAll("'../composables/useI18n.ts'", `'${new URL('../src/composables/useI18n.ts', import.meta.url).href}'`);
const { code } = await transform(compiled, { loader: 'ts', format: 'esm', target: 'esnext' });
const { default: ShelfDialogContent } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function mount(request) {
  const app = createApp({ render: () => h(ShelfDialogContent, { request, mobileSheet: true }) });
  app.mount('#app');
  return app;
}

test('不同语言下删除风险由操作意图决定，不依赖标题文案', async () => {
  for (const language of ['en', 'ja']) {
    setLocale(language);
    const app = mount({
      kind: 'confirm', intent: 'delete', removesFiles: true,
      title: 'Review selected items', message: 'Review the selection.'
    });
    try {
      await nextTick();
      assert.ok(document.querySelector('.md-mobile-sheet-icon.is-danger'));
      const text = document.querySelector('.md-mobile-sheet-notice').textContent;
      assert.match(text, language === 'en' ? /Local content and reading history/ : /コンテンツと読書履歴/);
    } finally {
      app.unmount();
    }
  }
  setLocale('zh-CN');
});

test('导入数量与按目录分组在切换语言后仍准确', async () => {
  setLocale('en');
  const app = mount({
    kind: 'folder', title: 'Import', message: 'Import these files?',
    bookCount: 12, collectionCount: 3, groupByFolder: true
  });
  try {
    await nextTick();
    assert.match(document.body.textContent, /12 books waiting to import/);
    assert.match(document.body.textContent, /3 collections planned/);
    setLocale('ja');
    await nextTick();
    assert.match(document.body.textContent, /12 冊がインポート待ち/);
    assert.match(document.body.textContent, /3 個のコレクションを作成予定/);
  } finally {
    app.unmount();
    setLocale('zh-CN');
  }
});

test('用户书库名即使与词典键相同也保持原文', async () => {
  setLocale('en');
  const app = mount({
    kind: 'move', title: 'Move', message: '',
    options: [{ value: 'custom', title: '设置' }]
  });
  try {
    await nextTick();
    assert.equal(document.querySelector('button').textContent, '设置');
  } finally {
    app.unmount();
    setLocale('zh-CN');
  }
});
