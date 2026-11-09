import test from 'node:test';
import assert from 'node:assert/strict';

let transactionCount = 0;
let failNextTransaction = false;
const writes = [];

const objectStores = {
  books: {
    put(record) {
      writes.push({ store: 'books', record });
    }
  },
  sources: {
    put(record) {
      writes.push({ store: 'sources', record });
    }
  }
};

const fakeDb = {
  transaction() {
    transactionCount++;
    const tx = {
      objectStore(name) {
        return objectStores[name];
      }
    };
    queueMicrotask(() => {
      if (failNextTransaction) {
        failNextTransaction = false;
        tx.error = new Error('批量事务失败');
        tx.onerror?.();
      } else {
        tx.oncomplete?.();
      }
    });
    return tx;
  }
};

const fakeIndexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = fakeDb;
      request.onsuccess?.();
    });
    return request;
  }
};

globalThis.window = { indexedDB: fakeIndexedDB };
globalThis.indexedDB = fakeIndexedDB;

const { HomuraStore } = await import('../src/services/storage.ts');

function entry(id) {
  return {
    meta: { id, title: id },
    source: { id, kind: 'file', name: `${id}.txt`, size: 1 }
  };
}

test('批量保存把整批书目与来源放进同一次 IndexedDB 事务', async () => {
  transactionCount = 0;
  writes.length = 0;

  await HomuraStore.saveBooks([entry('a'), entry('b'), entry('c')]);

  assert.equal(transactionCount, 1);
  assert.equal(writes.filter(item => item.store === 'books').length, 3);
  assert.equal(writes.filter(item => item.store === 'sources').length, 3);
  assert.deepEqual(writes.filter(item => item.store === 'books').map(item => item.record.id), ['a', 'b', 'c']);
});

test('批量事务失败时整体拒绝，不留下半批记录', async () => {
  transactionCount = 0;
  writes.length = 0;
  failNextTransaction = true;

  await assert.rejects(
    HomuraStore.saveBooks([entry('a'), entry('b')]),
    /批量事务失败/
  );
  assert.equal(transactionCount, 1);
});
