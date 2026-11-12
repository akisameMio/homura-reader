import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READER_FONT_OPTIONS,
  resolveFontValue,
  resolveFontStack,
  resolveReaderMetrics,
  resolveReaderFolios,
  resolveProseStyle
} from '../src/services/readerLayout.ts';

const values = READER_FONT_OPTIONS.map(option => option.value);

test('竖排只作用于分页正文，滚动阅读保留横排且字号、字体与行距不改变', () => {
  const layout = { fontSize: 26, fontFamily: 'song', lineHeight: 'normal' };
  const horizontal = resolveProseStyle(layout);
  const vertical = resolveProseStyle({ ...layout, verticalText: true });
  assert.equal(horizontal['--reader-writing-mode'], 'horizontal-tb');
  assert.equal(vertical['--reader-writing-mode'], 'vertical-rl');
  assert.equal(vertical['--reader-font-size'], '26px');
  assert.equal(vertical['--reader-font-family'], horizontal['--reader-font-family']);
  assert.equal(vertical['--reader-line-height'], horizontal['--reader-line-height']);
  assert.equal(resolveProseStyle({ ...layout, verticalText: true, direction: 'vertical' })['--reader-writing-mode'], 'horizontal-tb');
});

test('双页页码分别对应左右纸页，RTL 反排；首页单排和末页不补虚假页码', () => {
  const pair = [{ pageNumber: 5 }, { pageNumber: 6 }];
  const options = { rtl: false, singleOnRight: false, startIndex: 4 };
  assert.deepEqual(resolveReaderFolios(pair, options), [
    { pageNumber: 5, position: 'left' }, { pageNumber: 6, position: 'right' }
  ]);
  assert.deepEqual(resolveReaderFolios(pair, { ...options, rtl: true }), [
    { pageNumber: 6, position: 'left' }, { pageNumber: 5, position: 'right' }
  ]);
  assert.deepEqual(resolveReaderFolios([pair[0]], options), [{ pageNumber: 5, position: 'center' }]);
  assert.deepEqual(resolveReaderFolios([pair[0]], { ...options, singleOnRight: true }), [{ pageNumber: 5, position: 'right' }]);
  assert.deepEqual(resolveReaderFolios([pair[0]], { ...options, singleOnRight: true, rtl: true }), [{ pageNumber: 5, position: 'left' }]);
  assert.deepEqual(resolveReaderFolios([], options), []);
  assert.deepEqual(resolveReaderFolios([{}, { pageNumber: -1 }], options), [
    { pageNumber: 5, position: 'left' }, { pageNumber: 6, position: 'right' }
  ]);
  assert.deepEqual(pair, [{ pageNumber: 5 }, { pageNumber: 6 }]);
});

test('字体档位是 原始 / 方体 / 宋体 / 楷体 / 圆体', () => {
  assert.deepEqual(values, ['system', 'square', 'song', 'kai', 'round']);
  assert.deepEqual(
    READER_FONT_OPTIONS.map(option => option.label),
    ['原始', '方体', '宋体', '楷体', '圆体']
  );
  for (const option of READER_FONT_OPTIONS) {
    assert.ok(option.stack.includes('serif') || option.stack.includes('sans-serif'), option.value);
  }
});

test('旧的 hei 归一为方体，未知值回退宋体', () => {
  assert.equal(resolveFontValue('hei'), 'square');
  assert.equal(resolveFontValue('default'), 'system');
  assert.equal(resolveFontValue('song'), 'song');
  assert.equal(resolveFontValue('nope'), 'song');
  assert.equal(resolveFontValue(undefined), 'song');
});

test('resolveFontStack 跟随归一后的档位，未知值用宋体栈', () => {
  assert.equal(resolveFontStack('hei'), resolveFontStack('square'));
  assert.match(resolveFontStack('round'), /Yuanti SC/);
  assert.match(resolveFontStack('nope'), /Songti SC/);
});

test('窄屏按单页几何，不给双页预留中缝', () => {
  const compact = resolveReaderMetrics({
    width: 390,
    height: 844,
    layout: { spread: 2, fontSize: 18, pageMargin: 'normal', lineHeight: 'normal', fontFamily: 'song' },
    compact: true
  });
  assert.equal(compact.isDouble, false);
  assert.ok(compact.textWidth <= 640);
});
