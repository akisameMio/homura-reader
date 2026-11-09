import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READER_FONT_OPTIONS,
  resolveFontValue,
  resolveFontStack,
  resolveReaderMetrics
} from '../src/services/readerLayout.ts';

const values = READER_FONT_OPTIONS.map(option => option.value);

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
