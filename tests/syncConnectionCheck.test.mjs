import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';
const dom = new JSDOM('<div id="app"></div>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement });
const { reactive, createApp, nextTick } = await import('vue');
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/SyncSettings.vue', import.meta.url), 'utf8');
let compiled = compileScript(parse(source).descriptor, { id: 'connection-check-test' }).content;
compiled = compiled.replaceAll("from 'vue'", `from '${pathToFileURL(require.resolve('vue')).href}'`);
compiled = compiled.replace(/import \{ useSyncStore \} from '[^']+';/, 'const useSyncStore = () => globalThis.connectionTestStore;');
compiled = compiled.replace(/import \{ useI18n \} from '[^']+';/, "const useI18n = () => ({ t: value => value, locale: { value: 'zh-CN' } });");
compiled = compiled.replace(/import \{ WebDavBooksClient \} from '[^']+';/, 'const WebDavBooksClient = globalThis.connectionTestClient;');
compiled = compiled.replace(/import (\w+) from '[^']+\.vue';/g, 'const $1 = {};');
const { code } = await transform(compiled, { loader: 'ts', format: 'esm' });
const requests = [];
globalThis.connectionTestClient = class {
  constructor(config) { this.config = config; this.closed = false; }
  list() { return new Promise((resolve, reject) => requests.push({ client: this, resolve, reject })); }
  close() { this.closed = true; }
};
const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
Component.render = () => null;
const flush = async () => { for (let i = 0; i < 4; i++) await nextTick(); };
function fixture(url = 'https://dav.example/books/') {
  requests.length = 0;
  globalThis.connectionTestStore = reactive({ config: { url, username: 'reader' }, password: 'test-only', enabled: false, autoSync: false, status: 'idle', error: '', lastSyncAt: null });
  const app = createApp(Component);
  app.mount(document.querySelector('#app'));
  return { app, state: app._instance.setupState, store: globalThis.connectionTestStore };
}

test('打开二级页立即发只读连通性检测，即使元数据同步关闭；重新进入会再检测', async () => {
  let { app } = fixture();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].client.config.password, 'test-only');
  requests[0].resolve([]); await flush();
  assert.equal(requests[0].client.closed, true);
  app.unmount();
  ({ app } = fixture());
  assert.equal(requests.length, 1);
  app.unmount();
});

test('未绑定不发请求；绑定、改密码后自动重测，卸载关闭未完成请求', async () => {
  const { app, store } = fixture('');
  assert.equal(requests.length, 0);
  store.config.url = 'https://dav.example/books/'; await flush();
  assert.equal(requests.length, 1);
  store.password = 'changed'; await flush();
  assert.equal(requests[0].client.closed, true);
  assert.equal(requests.length, 2);
  requests[0].reject(new Error('旧连接失败')); await flush();
  assert.equal(requests[1].client.closed, false);
  app.unmount();
  assert.equal(requests[1].client.closed, true);
  requests[1].resolve([]); await flush();
});


test('显示检测中及成功或失败结果，过期成功不能覆盖新请求失败', async () => {
  const { app, state, store } = fixture();
  assert.equal(state.checkingConnection, true);
  requests[0].resolve([]); await flush();
  assert.equal(state.connected, true);
  assert.equal(state.checkingConnection, false);
  store.password = 'second'; await flush();
  store.password = 'third'; await flush();
  requests[2].reject(new Error('offline')); await flush();
  assert.equal(state.connected, false);
  requests[1].resolve([]); await flush();
  assert.equal(state.connected, false);
  assert.equal(state.localError, '', '自动检测只更新连接状态，不覆盖其它操作反馈');
  app.unmount();
});
