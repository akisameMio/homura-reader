import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('Android 返回监听在书架与阅读器之间保持注册', async () => {
  const { window } = new JSDOM('<div id="app"></div>');
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Android', configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.assign(globalThis, {
    window,
    document: window.document,
    Element: window.Element,
    SVGElement: window.SVGElement,
    Node: window.Node,
    cancelAnimationFrame: () => {}
  });
  window.matchMedia = () => ({ matches: true });

  let backHandler;
  let registrations = 0;
  let removals = 0;
  let exits = 0;
  let toasts = 0;
  window.__TAURI__ = {
    app: {
      onBackButtonPress: async handler => {
        registrations++;
        backHandler = handler;
        return { unregister: async () => { removals++; } };
      },
      exit: async () => { exits++; }
    },
    core: { invoke: async command => { if (command === 'plugin:android-toast|show') toasts++; } }
  };

  const { createApp, h, nextTick, reactive } = await import('vue');
  const { useAndroidBackExit } = await import('../src/composables/useAndroidBackExit.ts');
  const { useReaderBackDismiss } = await import('../src/composables/useReaderBackDismiss.ts');
  const reader = reactive({
    currentBook: null,
    closeReader() { this.currentBook = null; }
  });
  const ui = reactive({
    readerDrawerOpen: false,
    settingsOpen: false,
    tocOpen: false,
    collectionTocOpen: false,
    fontMenuOpen: false,
    closeSettings() { this.settingsOpen = false; this.readerDrawerOpen = false; },
    closeToc() {},
    closeCollectionToc() {},
    closeFontMenu() { this.fontMenuOpen = false; this.readerDrawerOpen = false; }
  });
  const app = createApp({
    setup() {
      useAndroidBackExit(reader, () => false);
      useReaderBackDismiss(reader, ui);
      return () => h('div');
    }
  });
  app.mount('#app');
  await nextTick();
  assert.equal(registrations, 1);

  backHandler();
  assert.equal(toasts, 1);
  reader.currentBook = { id: 'book' };
  await nextTick();
  ui.readerDrawerOpen = true;
  ui.settingsOpen = true;
  backHandler();
  assert.equal(ui.readerDrawerOpen, false);
  assert.ok(reader.currentBook);
  ui.readerDrawerOpen = true;
  ui.fontMenuOpen = true;
  backHandler();
  assert.equal(ui.fontMenuOpen, false);
  assert.equal(ui.readerDrawerOpen, false);
  assert.ok(reader.currentBook);
  backHandler();
  await nextTick();
  assert.equal(reader.currentBook, null);
  assert.equal(exits, 0);
  assert.equal(registrations, 1);
  assert.equal(removals, 0);

  backHandler();
  assert.equal(toasts, 2);
  assert.equal(exits, 0);
  backHandler();
  assert.equal(exits, 1);
  app.unmount();
  await nextTick();
  assert.equal(removals, 1);
});
