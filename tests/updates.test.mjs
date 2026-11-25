import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchStableReleases,
  formatReleaseDate,
  parseAtomReleases,
  parseExpandedAssetsHtml,
  resetReleasesCache
} from '../src/services/updates.ts';

test('GitHub 限流期间合并请求并暂停重试，到期后恢复更新检查', async (t) => {
  resetReleasesCache();
  t.after(() => resetReleasesCache());

  let now = Date.UTC(2026, 10, 20);
  t.mock.method(Date, 'now', () => now);
  const reset = now + 120_000;
  const responses = [
    new Response('Forbidden', { status: 403 }),
    new Response(null, { status: 429, headers: { 'Retry-After': '90' } }),
    new Response(null, {
      status: 403,
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String((reset + 90_000) / 1000) }
    }),
    new Response('You have exceeded a secondary rate limit.', { status: 403 }),
    Response.json([{ tag_name: 'v2.3.3' }])
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift());
  const refresh = () => fetchStableReleases({ force: true });

  await assert.rejects(refresh(), { code: 'HTTP_ERROR' });
  await Promise.all([
    assert.rejects(refresh(), { code: 'RATE_LIMIT' }),
    assert.rejects(refresh(), { code: 'RATE_LIMIT' })
  ]);
  now += 89_000;
  await assert.rejects(refresh(), { code: 'RATE_LIMIT' });
  assert.equal(fetch.mock.callCount(), 2);

  now += 1000;
  await assert.rejects(refresh(), { code: 'RATE_LIMIT' });
  now += 119_000;
  await assert.rejects(refresh(), { code: 'RATE_LIMIT' });
  assert.equal(fetch.mock.callCount(), 3);

  now += 1000;
  await assert.rejects(refresh(), { code: 'RATE_LIMIT' });
  now += 59_000;
  await assert.rejects(refresh(), { code: 'RATE_LIMIT' });
  assert.equal(fetch.mock.callCount(), 4);

  now += 1000;
  const releases = await refresh();
  assert.equal(releases[0].version, '2.3.3');
  assert.equal(await fetchStableReleases(), releases);
  assert.equal(fetch.mock.callCount(), 5);
});

test('parseAtomReleases 解析 releases.atom 并过滤预发布版与清洗更新日志', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>tag:github.com,2008:Repository/1/v2.4.0-beta.1</id>
      <updated>2026-11-24T12:00:00Z</updated>
      <link rel="alternate" type="text/html" href="https://github.com/Leon-Ning-san/HomuraReader/releases/tag/v2.4.0-beta.1"/>
      <title>HOMURA v2.4.0-beta.1</title>
      <content type="html">&lt;h2&gt;🔄 更新日志&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;测试版&lt;/li&gt;&lt;/ul&gt;</content>
    </entry>
    <entry>
      <id>tag:github.com,2008:Repository/1/v2.3.3</id>
      <updated>2026-11-22T16:40:37Z</updated>
      <link rel="alternate" type="text/html" href="https://github.com/Leon-Ning-san/HomuraReader/releases/tag/v2.3.3"/>
      <title>HOMURA v2.3.3</title>
      <content type="html">&lt;h1&gt;HOMURA v2.3.3&lt;/h1&gt;
&lt;h2&gt;🔄 更新日志&lt;/h2&gt;
&lt;h3&gt;✨ 新功能&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;优化书架导入反馈（&lt;a href=&quot;https://github.com/Leon-Ning-san/HomuraReader/commit/b8f867c&quot;&gt;b8f867c&lt;/a&gt;）&lt;/li&gt;
&lt;/ul&gt;
&lt;h3&gt;🐛 问题修复&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;修正继续阅读卡高度（&lt;a href=&quot;https://github.com/Leon-Ning-san/HomuraReader/commit/9b80ae8&quot;&gt;9b80ae8&lt;/a&gt;）&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;&lt;strong&gt;完整对比&lt;/strong&gt;：v2.3.2...v2.3.3&lt;/p&gt;</content>
    </entry>
  </feed>`;

  const releases = parseAtomReleases(xml);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].version, '2.3.3');
  assert.equal(releases[0].tag, 'v2.3.3');
  assert.equal(releases[0].dateLabel, formatReleaseDate('2026-11-22T16:40:37Z'));
  assert.equal(releases[0].notes.groups.length, 2);
  assert.deepEqual(releases[0].notes.groups[0], { title: '新增', items: ['优化书架导入反馈'] });
  assert.deepEqual(releases[0].notes.groups[1], { title: '修复', items: ['修正继续阅读卡高度'] });
});

test('parseExpandedAssetsHtml 提取发布安装包并过滤非本仓库链接', () => {
  const html = `
    <a href="/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/HOMURA_2.3.3_universal.dmg">dmg</a>
    <a href="/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/HOMURA_2.3.3_universal.dmg">dup</a>
    <a href="/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/HOMURA_2.3.3_arm64.apk">apk</a>
    <a href="https://evil.example.com/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/bad.dmg">bad</a>
  `;
  const assets = parseExpandedAssetsHtml(html);
  assert.deepEqual(
    assets.map((asset) => ({ name: asset.name, url: asset.url, size: asset.size })),
    [
      {
        name: 'HOMURA_2.3.3_universal.dmg',
        url: 'https://github.com/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/HOMURA_2.3.3_universal.dmg',
        size: 0
      },
      {
        name: 'HOMURA_2.3.3_arm64.apk',
        url: 'https://github.com/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/HOMURA_2.3.3_arm64.apk',
        size: 0
      }
    ]
  );
});

test('Tauri 环境下 API 限流时自动回退到 releases.atom 与 expanded_assets', async (t) => {
  resetReleasesCache();
  const previousWindow = globalThis.window;
  t.after(() => {
    resetReleasesCache();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  let now = Date.UTC(2026, 10, 25);
  t.mock.method(Date, 'now', () => now);

  const invoked = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          invoked.push({ command, args });
          if (command === 'fetch_release_feed') {
            return `<feed>
              <entry>
                <id>tag:github.com,2008:Repository/1/v2.3.3</id>
                <updated>2026-11-22T16:40:37Z</updated>
                <link rel="alternate" href="https://github.com/Leon-Ning-san/HomuraReader/releases/tag/v2.3.3"/>
                <title>HOMURA v2.3.3</title>
                <content type="html">&lt;h2&gt;🔄 更新日志&lt;/h2&gt;&lt;h3&gt;✨ 新功能&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;支持自动回退&lt;/li&gt;&lt;/ul&gt;</content>
              </entry>
            </feed>`;
          }
          if (command === 'fetch_release_assets') {
            return '<a href="/Leon-Ning-san/HomuraReader/releases/download/v2.3.3/HOMURA_2.3.3_universal.dmg">dmg</a>';
          }
          throw new Error(`unexpected command: ${command}`);
        }
      }
    }
  };

  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 403,
    headers: {
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String((now + 600_000) / 1000)
    }
  }));

  const releases = await fetchStableReleases({ force: true });
  assert.equal(releases.length, 1);
  assert.equal(releases[0].version, '2.3.3');
  assert.equal(releases[0].assets[0].name, 'HOMURA_2.3.3_universal.dmg');
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(invoked, [
    { command: 'fetch_release_feed', args: undefined },
    { command: 'fetch_release_assets', args: { tag: 'v2.3.3' } }
  ]);

  // 冷却期内再次强制刷新时应直接走原生订阅，不再浪费 API 请求
  now += 30_000;
  const second = await fetchStableReleases({ force: true });
  assert.equal(second[0].version, '2.3.3');
  assert.equal(fetch.mock.callCount(), 1);
});

test('ETag 命中 304 与 localStorage 持久缓存复用', async (t) => {
  const storage = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  resetReleasesCache();
  t.after(() => {
    resetReleasesCache();
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });

  let now = Date.UTC(2026, 10, 25);
  t.mock.method(Date, 'now', () => now);

  const seenHeaders = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    seenHeaders.push(init?.headers || {});
    if (seenHeaders.length === 1) {
      return new Response(JSON.stringify([{ tag_name: 'v2.3.3' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: 'W/"rel-233"' }
      });
    }
    return new Response(null, { status: 304 });
  });

  const first = await fetchStableReleases({ force: true });
  assert.equal(first[0].version, '2.3.3');

  // 模拟重启后内存缓存清空，非强制查询直接命中 localStorage 持久缓存
  resetReleasesCache({ preserveStorage: true });
  now += 10_000;
  const fromStorage = await fetchStableReleases({ force: false });
  assert.equal(fromStorage[0].version, '2.3.3');
  assert.equal(fetch.mock.callCount(), 1);

  // 强制检查更新时携带 If-None-Match，收到 304 后直接复用缓存
  const revalidated = await fetchStableReleases({ force: true });
  assert.equal(revalidated[0].version, '2.3.3');
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(seenHeaders[1]['If-None-Match'], 'W/"rel-233"');
});
