import test from 'node:test';
import assert from 'node:assert/strict';
import { readPdfOutline } from '../src/services/pdfOutline.ts';

test('嵌套目录压平，字符串 dest、Ref dest 与整数 dest 都解析成 1-based 页码', async () => {
  const doc = {
    numPages: 20,
    async getOutline() {
      return [
        {
          title: '第一章', dest: 'chap-1', items: [
            { title: '1.1 小节', dest: [1], items: [] }
          ]
        },
        { title: '第二章', dest: [{ num: 5, gen: 0 }], items: [] },
        { title: '附录', dest: [8], items: [] }
      ];
    },
    async getDestination(id) { return id === 'chap-1' ? [{ num: 0, gen: 0 }] : null; },
    async getPageIndex(ref) { return ref.num; }
  };
  assert.deepEqual(await readPdfOutline(doc), [
    { title: '第一章', page: 1, depth: 0 },
    { title: '1.1 小节', page: 2, depth: 1 },
    { title: '第二章', page: 6, depth: 0 },
    { title: '附录', page: 9, depth: 0 }
  ]);
});

test('父节点无 dest 时继承第一个可跳转子项，纯外链条目不展示', async () => {
  const doc = {
    numPages: 10,
    async getOutline() {
      return [
        {
          title: '卷首', dest: null, items: [
            { title: '序章', dest: [2], items: [] },
            { title: '外链', dest: null, url: 'https://example.com', items: [] }
          ]
        },
        { title: '外链', dest: null, url: 'https://example.com', items: [] },
        { title: '无子项父节点', dest: null, items: [] }
      ];
    }
  };
  assert.deepEqual(await readPdfOutline(doc), [
    { title: '卷首', page: 3, depth: 0 },
    { title: '序章', page: 3, depth: 1 }
  ]);
});

test('单条 dest 解析失败只丢弃该条，其余条目保留', async () => {
  const doc = {
    numPages: 8,
    async getOutline() {
      return [
        { title: '坏引用', dest: [{ num: 99, gen: 0 }], items: [] },
        { title: '好条目', dest: [3], items: [] },
        { title: '未知命名目标', dest: 'missing', items: [] }
      ];
    },
    async getDestination() { return null; },
    async getPageIndex() { throw new Error('bad ref'); }
  };
  assert.deepEqual(await readPdfOutline(doc), [{ title: '好条目', page: 4, depth: 0 }]);
});

test('空标题丢弃但保留子项，页码越界时 clamp 到最后一页', async () => {
  const doc = {
    numPages: 5,
    async getOutline() {
      return [
        { title: '   ', dest: [0], items: [{ title: '子项', dest: [99], items: [] }] }
      ];
    }
  };
  assert.deepEqual(await readPdfOutline(doc), [{ title: '子项', page: 5, depth: 1 }]);
});

test('无 outline、读取失败或结构异常时返回空数组', async () => {
  assert.deepEqual(await readPdfOutline(null), []);
  assert.deepEqual(await readPdfOutline({}), []);
  assert.deepEqual(await readPdfOutline({ numPages: 3, async getOutline() { throw new Error('损坏'); } }), []);
  assert.deepEqual(await readPdfOutline({ numPages: 3, async getOutline() { return null; } }), []);
  assert.deepEqual(await readPdfOutline({ numPages: 3, async getOutline() { return 'bad'; } }), []);
});

test('条目数与层级深度有上限', async () => {
  const deep = {
    title: 'L0', dest: [0], items: [
      { title: 'L1', dest: [1], items: [{ title: 'L2', dest: [2], items: [] }] }
    ]
  };
  assert.deepEqual((await readPdfOutline({ numPages: 10, getOutline: async () => [deep] }, { maxDepth: 1 })).map(entry => entry.title), ['L0', 'L1']);

  const many = {
    numPages: 10,
    getOutline: async () => Array.from({ length: 5 }, (_, index) => ({ title: `T${index}`, dest: [index], items: [] }))
  };
  assert.equal((await readPdfOutline(many, { maxEntries: 2 })).length, 2);
});
