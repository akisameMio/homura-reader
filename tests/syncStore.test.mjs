import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { createPinia, setActivePinia, disposePinia } from 'pinia';

// Node 不处理 Vite 的 worker 静态资源查询。
const workerHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?url')) return { url: 'data:text/javascript,export default "worker.js"', shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const { useSyncStore } = await import('../src/stores/sync.ts');
workerHook.deregister();

const CONFIG_KEY = 'homura_webdav_sync';
const config = (url = 'https://dav.example/reader/', username = 'reader') => ({
  url, username, enabled: false, autoSync: false
});

async function fixture(run) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  let timerId = 0;
  const timers = new Map();
  const requests = [];
  let waitingRequest = null;
  const schedule = (callback, delay, interval) => {
    const id = ++timerId;
    timers.set(id, { callback, delay, interval });
    return id;
  };
  Object.assign(replacements, {
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => {
      const request = { url, options, resolve, reject };
      if (waitingRequest) {
        const deliver = waitingRequest;
        waitingRequest = null;
        deliver(request);
      } else requests.push(request);
    })
  });
  const previous = new Map(Object.keys(replacements).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const pinia = createPinia();
  setActivePinia(pinia);
  try {
    const store = useSyncStore();
    await store.saveConfig({ ...config(), password: 'session-secret' });
    await run({
      store,
      timers,
      nextRequest: () => requests.length ? Promise.resolve(requests.shift()) : new Promise(resolve => { waitingRequest = resolve; }),
      externalConfig(next, key = CONFIG_KEY) {
        const oldValue = localStorage.getItem(CONFIG_KEY);
        if (key === null) localStorage.clear();
        else if (next === null) localStorage.removeItem(CONFIG_KEY);
        else localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        window.dispatchEvent(new window.StorageEvent('storage', {
          key, oldValue, newValue: next === null ? null : JSON.stringify(next), storageArea: localStorage
        }));
      }
    });
  } finally {
    disposePinia(pinia);
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('跨标签修改、删除配置或清空存储都会清除会话密码和旧状态', async () => {
  for (const operation of ['replace', 'remove', 'clear']) {
    await fixture(async ({ store, externalConfig, timers }) => {
      const scheduledWork = () => [...timers].filter(([, timer]) => timer.delay > 0);
      const initialTimers = scheduledWork();
      window.dispatchEvent(new window.StorageEvent('storage', { key: 'unrelated_setting' }));
      assert.equal(store.password, 'session-secret', '其它设置变化不应使同步会话失效');
      store.error = '旧错误';
      store.lastSyncAt = 1234;
      store.pendingCount = 8;
      const next = operation === 'replace' ? config('https://other.example/new', 'other') : null;
      externalConfig(next, operation === 'clear' ? null : CONFIG_KEY);
      assert.equal(store.password, '');
      assert.equal(store.enabled, false);
      assert.equal(store.error, '');
      assert.equal(store.lastSyncAt, null);
      assert.equal(store.pendingCount, 0);
      assert.equal(store.status, 'idle');
      assert.deepEqual(store.config, next
        ? { url: 'https://other.example/new/', username: 'other' }
        : { url: '', username: '' });
      assert.deepEqual(scheduledWork(), initialTimers, '停用配置后不启动额外同步定时器');
    });
  }
});

test('旧连接请求成功返回时不结束另一配置的新连接检查，且新请求不沿用旧密码', () => fixture(async ({ store, externalConfig, nextRequest }) => {
  const oldCheck = store.testConnection();
  const oldRequest = await nextRequest();
  assert.equal(store.status, 'testing');
  assert.equal(oldRequest.options.headers.Authorization, `Basic ${btoa('reader:session-secret')}`);

  externalConfig(config('https://other.example/new/', 'other'));
  const newCheck = store.testConnection();
  const newRequest = await nextRequest();
  assert.equal(newRequest.url, 'https://other.example/new/homura-sync-v1.json');
  assert.equal(newRequest.options.headers.Authorization, `Basic ${btoa('other:')}`);
  oldRequest.resolve(new Response(null, { status: 404 }));
  await oldCheck;
  assert.equal(store.status, 'testing', '过期请求不能恢复新配置的空闲状态');
  assert.equal(store.password, '');
  assert.equal(store.error, '');
  newRequest.resolve(new Response(null, { status: 404 }));
  await newCheck;
  assert.equal(store.status, 'idle');
}));

test('旧连接请求失败时不把错误写入另一标签已更新的配置', () => fixture(async ({ store, externalConfig, nextRequest }) => {
  const oldCheck = store.testConnection();
  const oldRequest = await nextRequest();
  externalConfig(config('https://other.example/new/', 'other'));
  const newCheck = store.testConnection();
  const newRequest = await nextRequest();
  const rejected = assert.rejects(oldCheck, /无法连接 WebDAV/);
  oldRequest.reject(new Error('旧服务器断开'));
  await rejected;
  assert.equal(store.status, 'testing');
  assert.equal(store.error, '');
  assert.equal(store.password, '');
  newRequest.resolve(new Response(null, { status: 404 }));
  await newCheck;
  assert.equal(store.status, 'idle');
}));
