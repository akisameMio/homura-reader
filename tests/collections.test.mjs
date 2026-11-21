import test from 'node:test';
import assert from 'node:assert/strict';
import { moveCollectionBooks, restoreCollections, planFolderCollections, collectionNameError, planImportFolders, assignImportedFolders, collectionPath } from '../src/services/collections.ts';

test('批量移动只保留一个归属，移回主页不删除书本', () => {
  const original = [{ id: 'a', title: '甲', bookIds: ['1', '2'] }, { id: 'b', title: '乙', bookIds: ['3'] }];
  const moved = moveCollectionBooks(original, ['1', '3', '1'], 'b');
  assert.deepEqual(moved.map(item => item.bookIds), [['2'], ['1', '3']]);
  assert.deepEqual(original[0].bookIds, ['1', '2']);
  assert.deepEqual(moveCollectionBooks(moved, ['1', '3'], null).map(item => item.bookIds), [['2'], []]);
  assert.throws(() => moveCollectionBooks(original, ['1'], 'missing'));
});

test('恢复时去除失效与重复归属，保留空书库', () => {
  const restored = restoreCollections([
    { id: 'a', title: '甲', bookIds: ['1', '1', 'gone'] },
    { id: 'b', title: '乙', bookIds: ['1', '2'] },
    { id: 'c', title: '空书库', bookIds: [] }
  ], [{ id: '1' }, { id: '2' }]);
  assert.deepEqual(restored.map(item => item.bookIds), [['1'], ['2'], []]);
  assert.deepEqual(restored.map(item => item.title), ['甲', '乙', '空书库']);
});

test('恢复时兼容旧 name 字段，缺失名称才回退为未命名书库', () => {
  const restored = restoreCollections([
    { id: 'a', name: '旧书库', bookIds: [] },
    { id: 'b', bookIds: [] }
  ], []);
  assert.deepEqual(restored.map(item => item.title), ['旧书库', '未命名书库']);
});

test('直接归属按完整目录路径分组，保留同名子目录', () => {
  const files = [
    { name: '1.txt', customRelativePath: '书籍/甲/同名/1.txt' },
    { name: '2.epub', customRelativePath: '书籍/乙/同名/2.epub' },
    { name: '3.pdf', customRelativePath: '书籍/3.pdf' },
    { name: '4.cbz', customRelativePath: '书籍/4.cbz' },
    { name: '.hidden.txt', customRelativePath: '书籍/.hidden.txt' },
    { name: 'notes.exe', customRelativePath: '书籍/notes.exe' }
  ];
  const plan = planFolderCollections(files);
  assert.equal(plan.bookCount, 4);
  assert.deepEqual(plan.groups.map(item => item.path), ['书籍/甲/同名', '书籍/乙/同名', '书籍']);
  assert.equal(plan.hasDirectories, true);
});

test('散装图片每个目录算一本漫画，混合文档保持独立', () => {
  const plan = planFolderCollections([
    { name: '01.png', webkitRelativePath: '漫画/第一卷/01.png' },
    { name: '02.png', webkitRelativePath: '漫画/第一卷/02.png' },
    { name: '01.png', webkitRelativePath: '漫画/第二卷/01.png' },
    { name: '说明.md', webkitRelativePath: '漫画/第二卷/说明.md' }
  ]);
  assert.deepEqual(plan.groups.map(item => [item.title, item.bookCount, item.files.length]), [['第一卷', 1, 2], ['第二卷', 2, 2]]);
});

test('书库名称校验支持重命名并避免全半角同名', () => {
  const collections = [{ id: 'a', title: 'ＡＢＣ' }];
  assert.ok(collectionNameError('', collections));
  assert.ok(collectionNameError('abc', collections));
  assert.equal(collectionNameError('abc', collections, 'a'), '');
  assert.ok(collectionNameError('长'.repeat(81), collections));
});

test('根目录作品直接入架，子目录保留层级并复用导入书库', () => {
  const folders = planImportFolders(planFolderCollections([
    { name: '1.txt', customRelativePath: '漫画/作者甲/作品/1.txt' },
    { name: '2.txt', customRelativePath: '漫画/作者乙/作品/2.txt' },
    { name: '3.txt', customRelativePath: '漫画/作者甲/未入架/3.txt' },
    { name: '说明.md', customRelativePath: '漫画/说明.md' }
  ]).groups);
  assert.deepEqual(folders.map(folder => [folder.title, folder.depth, folder.bookCount]), [
    ['作者甲', 0, 0], ['作品', 1, 1], ['未入架', 1, 1], ['作者乙', 0, 0], ['作品', 1, 1]
  ]);
  let sequence = 0;
  const nextId = () => String(++sequence);
  const initial = assignImportedFolders([], folders, new Map([
    ['漫画/作者甲/作品', ['book-1']],
    ['漫画/作者乙/作品', ['book-2']],
    ['漫画', ['book-on-shelf']]
  ]), 'source-a', 1, nextId);
  assert.deepEqual(initial.map(item => [item.title, item.parentId, item.bookIds]), [
    ['作者甲', undefined, []], ['作品', '1', ['book-1']],
    ['作者乙', undefined, []], ['作品', '3', ['book-2']]
  ]);
  const retry = assignImportedFolders(initial, folders, new Map([['漫画/作者甲/作品', ['book-1', 'book-4']]]), 'source-a', 2, nextId);
  assert.equal(retry.length, initial.length);
  assert.deepEqual(retry[1].bookIds, ['book-1', 'book-4']);
  const otherRoot = assignImportedFolders(retry, folders, new Map([['漫画/作者甲/作品', ['book-5']]]), 'source-b', 3, nextId);
  assert.equal(otherRoot[4].title, '作者甲 (2)');
  assert.equal(otherRoot[5].parentId, otherRoot[4].id);
});

test('恢复目录层级时提升失去父级的书库并断开循环', () => {
  const restored = restoreCollections([
    { id: 'old', title: '旧书库', bookIds: [] },
    { id: 'child', title: '子书库', parentId: 'old', importFolderKey: 'local', bookIds: [] },
    { id: 'orphan', title: '孤立', parentId: 'missing', bookIds: [] },
    { id: 'loop-a', title: '甲', parentId: 'loop-b', bookIds: [] },
    { id: 'loop-b', title: '乙', parentId: 'loop-a', bookIds: [] }
  ], []);
  const byId = new Map(restored.map(item => [item.id, item]));
  assert.equal(collectionPath(byId.get('child'), byId), '旧书库 / 子书库');
  assert.equal(byId.get('child').importFolderKey, 'local');
  assert.equal(byId.get('orphan').parentId, undefined);
  assert.equal(collectionPath(byId.get('loop-a'), byId), '乙 / 甲');
});
