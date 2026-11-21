import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStableReleases } from '../src/services/updates.ts';

test('GitHub 限流期间合并请求并暂停重试，到期后恢复更新检查', async (t) => {
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
