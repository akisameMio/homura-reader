import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUPLICATE_SKIP_ALL,
  useDuplicateImport
} from '../src/composables/useDuplicateImport.ts';

test('跳过同名书后保持卡片 pending，下一本只替换内容', async () => {
  const { pendingDuplicate, createDuplicateSession, resolveImport } = useDuplicateImport();
  const session = createDuplicateSession();
  try {
    const first = session.confirmDuplicate({ title: '同名 A' }, { title: '同名 A' });
    assert.equal(pendingDuplicate.value.title, '同名 A');
    assert.equal(pendingDuplicate.value.busy, false);

    resolveImport();
    assert.equal(await first, false);
    assert.equal(pendingDuplicate.value.title, '同名 A');
    assert.equal(pendingDuplicate.value.busy, true);

    const second = session.confirmDuplicate({ title: '同名 B' }, { title: '同名 B' });
    assert.equal(pendingDuplicate.value.title, '同名 B');
    assert.equal(pendingDuplicate.value.busy, false);

    resolveImport(true);
    assert.equal(await second, true);
    assert.equal(pendingDuplicate.value.busy, true);
  } finally {
    session.close();
  }
  assert.equal(pendingDuplicate.value, null);
});

test('全部跳过后立即清空，并让后续同名请求直接返回 false', async () => {
  const { pendingDuplicate, createDuplicateSession, resolveImport } = useDuplicateImport();
  const session = createDuplicateSession();
  try {
    const first = session.confirmDuplicate({ title: '同名 A' }, { title: '同名 A' });
    resolveImport(DUPLICATE_SKIP_ALL);
    assert.equal(await first, false);
    assert.equal(pendingDuplicate.value, null);

    assert.equal(
      await session.confirmDuplicate({ title: '同名 B' }, { title: '同名 B' }),
      false
    );
    assert.equal(pendingDuplicate.value, null);
  } finally {
    session.close();
  }
});
