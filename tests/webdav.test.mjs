import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebDavClient, WebDavError, normalizeWebDavUrl } from '../src/services/webdav.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.window;
});

test('目录地址只接受 HTTPS 或本机测试地址，不允许内嵌凭据', () => {
  assert.equal(normalizeWebDavUrl(' https://example.com/dav/user '), 'https://example.com/dav/user/');
  assert.equal(normalizeWebDavUrl('http://[::1]:1234/dav'), 'http://[::1]:1234/dav/');
  for (const url of ['http://example.com/dav', 'file:///tmp', 'https://user:{{PASSWORD_u1s7ki4r}}@example.com/dav', 'https://example.com/dav?x=1', 'https://example.com/dav#x']) {
    assert.throws(() => new WebDavClient({ url, username: '', password: '' }), error => error.code === 'INVALID_CONFIG');
  }
  assert.throws(() => new WebDavClient({ url: 'https://example.com', username: 'a:b', password: '' }));
});

test('真实 HTTP 服务首次创建、条件更新与两个客户端竞争时不会无条件覆盖', async () => {
  let document = null;
  let revision = 0;
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method, path: request.url, headers: request.headers });
    const etag = `"${revision}"`;
    if (request.method === 'GET') {
      if (document === null) { response.writeHead(404).end(); return; }
      response.writeHead(200, { ETag: etag, 'Content-Type': 'application/json' }).end(document);
      return;
    }
    if (request.method === 'PUT') {
      if ((document === null && request.headers['if-none-match'] !== '*')
        || (document !== null && request.headers['if-match'] !== etag)) {
        response.writeHead(412).end(); return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      document = body;
      revision++;
      response.writeHead(204).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = new WebDavClient({ url: `http://127.0.0.1:${server.address().port}/dav`, username: '鱼', password: 'pass' });
    assert.deepEqual(await client.read(), { document: null, etag: null });
    await client.write({ schemaVersion: 1, records: [] }, null);
    const first = await client.read();
    assert.equal(first.etag, '"1"');
    assert.deepEqual(first.document, { schemaVersion: 1, records: [] });
    await client.write({ updated: true }, first.etag);
    await assert.rejects(client.write({ stale: true }, first.etag), error => error instanceof WebDavError && error.code === 'CONFLICT');
    await assert.rejects(client.write({ recreate: true }, null), error => error.code === 'CONFLICT');
    assert.equal(document, '{"updated":true}');
    assert.ok(requests.every(request => request.path === '/dav/homura-sync-v1.json'));
    assert.equal(requests[0].headers.authorization, `Basic ${Buffer.from('鱼:pass').toString('base64')}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('无强 ETag、认证失败与损坏 JSON 都会中止', async () => {
  const client = new WebDavClient({ url: 'https://example.com/dav/', username: '', password: '' });
  for (const etag of [null, 'W/"weak"']) {
    globalThis.fetch = async () => new Response('{}', { headers: etag ? { ETag: etag } : {} });
    await assert.rejects(client.read(), error => error.code === 'UNSUPPORTED');
  }
  globalThis.fetch = async () => new Response('', { status: 401 });
  await assert.rejects(client.read(), error => error.code === 'AUTH');
  globalThis.fetch = async () => new Response('invalid', { headers: { ETag: '"valid"' } });
  await assert.rejects(client.read(), error => error.code === 'INVALID_DATA');
});

test('已有文件中的 JSON null 不能冒充未创建的同步文档', async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options.method);
    return new Response('null', { headers: { ETag: '"existing"' } });
  };
  const client = new WebDavClient({ url: 'https://example.com/dav/', username: '', password: '' });
  await assert.rejects(client.read(), error => error.code === 'INVALID_DATA');
  await assert.rejects(client.testConnection(), error => error.code === 'INVALID_DATA');
  assert.deepEqual(requests, ['GET', 'GET']);
});

test('声明过大、流式超限与本地超限文档不会继续传输', async () => {
  const client = new WebDavClient({ url: 'https://example.com/dav/', username: '', password: '' });
  globalThis.fetch = async () => new Response('{}', { headers: { ETag: '"valid"', 'Content-Length': String(8 * 1024 * 1024 + 1) } });
  await assert.rejects(client.read(), error => error.code === 'LIMIT_EXCEEDED');
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); }
  }), { headers: { ETag: '"valid"' } });
  await assert.rejects(client.read(), error => error.code === 'LIMIT_EXCEEDED');
  let requested = false;
  globalThis.fetch = async () => { requested = true; return new Response(); };
  await assert.rejects(client.write({ data: 'x'.repeat(8 * 1024 * 1024) }, null), error => error.code === 'LIMIT_EXCEEDED');
  assert.equal(requested, false);
  await assert.rejects(client.write({}, 'W/"invalid"'), error => error.code === 'INVALID_DATA');
  for (const etag of ['"unterminated', '"with space"', '"control\u0001"', `"${'x'.repeat(1024)}"`]) {
    await assert.rejects(client.write({}, etag), error => error.code === 'INVALID_DATA');
  }
  assert.equal(requested, false);
});

test('测试连接只读取，浏览器禁用重定向和隐式 cookie', async () => {
  let options;
  globalThis.fetch = async (_url, init) => { options = init; return new Response('', { status: 404 }); };
  const client = new WebDavClient({ url: 'https://example.com/dav', username: '', password: '' });
  await client.testConnection();
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
});

test('原生通道失败时不转向浏览器，也不把账号密码写入错误', async () => {
  let fetched = false;
  globalThis.window = { __TAURI__: { core: { invoke: async () => { throw new Error('secret-user:confidential-password'); } } } };
  globalThis.fetch = async () => { fetched = true; throw new Error(); };
  const client = new WebDavClient({ url: 'https://example.com/dav', username: 'secret-user', password: 'secret-pass' });
  await assert.rejects(client.read(), error => error.code === 'NETWORK' && !error.message.includes('secret'));
  assert.equal(fetched, false);
});

test('原生通道保留 HTTP 状态与 ETag，条件请求只发送给原生', async () => {
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
    calls.push({ command, args });
    return args.method === 'GET' ? { status: 200, etag: '"native"', body: '{"records":[]}' } : { status: 412, etag: null, body: '' };
  } } } };
  const client = new WebDavClient({ url: 'https://example.com/dav', username: 'u', password: 'p' });
  assert.equal((await client.read()).etag, '"native"');
  await assert.rejects(client.write({}, '"native"'), error => error.code === 'CONFLICT');
  assert.equal(calls[0].command, 'sync_webdav_request');
  assert.equal(calls[1].args.etag, '"native"');
});

test('原生返回超限时保持超限分类，不泄露原始异常或尝试浏览器', async () => {
  let fetched = false;
  globalThis.window = { __TAURI__: { core: { invoke: async () => {
    throw 'NATIVE_LIMIT_EXCEEDED: upstream confidential response';
  } } } };
  globalThis.fetch = async () => { fetched = true; throw new Error(); };
  const client = new WebDavClient({ url: 'https://example.com/dav', username: '', password: '' });
  await assert.rejects(client.read(), error => error.code === 'LIMIT_EXCEEDED' && !error.message.includes('confidential'));
  assert.equal(fetched, false);
});
