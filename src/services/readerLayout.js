/* ============================================================================
   HOMURA · 阅读版式度量
   ----------------------------------------------------------------------------
   分页器与阅读视图共用同一套页宽 / 行高 / 页边距计算，避免「测量用一套、渲染
   用另一套」把最后一行裁掉。返回的 textWidth / textHeight 就是正文栏的实际
   内容盒，视图只负责把它摆到画布上。
   ========================================================================== */

/** 正文字体：只暴露有稳定 CJK 覆盖的系统字体栈，不引入网络字体。 */
export const READER_FONT_OPTIONS = [
  {
    value: 'song',
    label: '宋体',
    stack: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif'
  },
  {
    value: 'hei',
    label: '黑体',
    stack: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif'
  },
  {
    value: 'kai',
    label: '楷体',
    stack: '"Kaiti SC", "STKaiti", "KaiTi", serif'
  }
];

/** 行距档位：中文长行需要比西文更松，标准档取 1.9。 */
export const READER_LINE_HEIGHT_OPTIONS = [
  { value: 'tight', label: '紧凑', ratio: 1.62 },
  { value: 'normal', label: '标准', ratio: 1.9 },
  { value: 'loose', label: '宽松', ratio: 2.12 }
];

/** 页边距档位：桌面按视口宽度取比例，手机取固定值。 */
export const READER_MARGIN_OPTIONS = [
  { value: 'narrow', label: '窄' },
  { value: 'normal', label: '标准' },
  { value: 'wide', label: '宽' }
];

const DESKTOP_PAD_RATIO = { narrow: 0.058, normal: 0.083, wide: 0.112 };
const COMPACT_PAD = { narrow: 16, normal: 22, wide: 30 };

const FOLIO_HEIGHT = 24;
const TOP_CHROME = { compact: 104, desktop: 96 };
const BOTTOM_CHROME = { compact: 112, desktop: 96 };
const DOUBLE_PAGE_MAX = 540;
const SINGLE_PAGE_MAX = 640;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function resolveFontStack(value) {
  const match = READER_FONT_OPTIONS.find((option) => option.value === value);
  return (match || READER_FONT_OPTIONS[0]).stack;
}

export function resolveLineHeight(value) {
  const match = READER_LINE_HEIGHT_OPTIONS.find((option) => option.value === value);
  return (match || READER_LINE_HEIGHT_OPTIONS[1]).ratio;
}

/**
 * 计算一页正文的几何。
 *
 * @param {object} input
 * @param {number} input.width   阅读舞台宽度
 * @param {number} input.height  阅读舞台高度
 * @param {object} input.layout  reader.layoutConfig（direction / spread / fontFamily / lineHeight / pageMargin）
 * @param {boolean} [input.compact] 是否走手机版式（<900px）
 */
export function resolveReaderMetrics({ width, height, layout = {}, compact = false }) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const marginKey = READER_MARGIN_OPTIONS.some((option) => option.value === layout.pageMargin)
    ? layout.pageMargin
    : 'normal';

  const padX = compact
    ? COMPACT_PAD[marginKey]
    : clamp(Math.round(safeWidth * DESKTOP_PAD_RATIO[marginKey]), 20, 150);
  const gutter = compact ? 24 : clamp(Math.round(safeWidth * 0.083), 48, 144);
  const padTop = compact ? TOP_CHROME.compact : TOP_CHROME.desktop;
  const padBottom = compact ? BOTTOM_CHROME.compact : BOTTOM_CHROME.desktop;

  const innerWidth = Math.max(120, safeWidth - padX * 2);
  // 与 DOUBLE_SPREAD_MIN_WIDTH 一致：窄于 768 或走手机布局（compact）一律单页，
  // 否则分页器按双栏算宽度、视图却只渲染一页，单页会被挤到右栏。
  const wantsDouble = Number(layout.spread) === 2 && !compact && safeWidth >= 768;
  const doubleWidth = (innerWidth - gutter) / 2;
  // 双页在窄窗口会挤成细条，低于 300px 一栏就退回单页。
  const isDouble = wantsDouble && doubleWidth >= 300;
  const textWidth = isDouble
    ? Math.min(DOUBLE_PAGE_MAX, doubleWidth)
    : Math.min(SINGLE_PAGE_MAX, innerWidth);

  const textHeight = Math.max(160, safeHeight - padTop - padBottom - FOLIO_HEIGHT);

  return {
    padX,
    padTop,
    padBottom,
    gutter: isDouble ? gutter : 0,
    folioHeight: FOLIO_HEIGHT,
    isDouble,
    textWidth: Math.round(textWidth),
    textHeight: Math.round(textHeight)
  };
}

/** 正文容器需要的内联变量：字体、字号、行高、段距都与测量保持一致。 */
export function resolveProseStyle(layout = {}, metrics = {}) {
  const fontSize = Number(layout.fontSize) || 18;
  return {
    '--reader-font-family': resolveFontStack(layout.fontFamily),
    '--reader-font-size': `${fontSize}px`,
    '--reader-line-height': String(resolveLineHeight(layout.lineHeight)),
    '--reader-para-gap': `${(fontSize * 0.42).toFixed(1)}px`
  };
}
