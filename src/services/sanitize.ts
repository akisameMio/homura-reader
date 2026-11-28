/* ============================================================================
   HOMURA · 阅读内容净化
   ----------------------------------------------------------------------------
   EPUB 的 XHTML 与 MOBI 的正文都会通过 v-html 进入阅读器，必须在解析阶段
   移除脚本、事件属性与外部资源。这里使用标签/属性白名单，同时保留常见排版、
   表格、脚注与 SVG。两条路径共用同一份清单，避免各自演化出现防护漂移。
   ========================================================================== */

import { isSafeImageUrl, isSafeLinkUrl } from './utils.ts';

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'big', 'blockquote', 'br',
  'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
  'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd',
  'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rb', 'rp', 'rt', 'rtc',
  'ruby', 's', 'samp', 'section', 'small', 'span', 'strike', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
  'tr', 'tt', 'u', 'ul', 'var', 'wbr',
  // 常见 EPUB 封面/插图会使用内联 SVG；脚本与事件属性仍会被统一剔除。
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'use', 'image', 'title', 'desc', 'clippath', 'lineargradient',
  'radialgradient', 'stop', 'pattern',
  // MathML 基础标签
  'math', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'msubsup', 'mfrac',
  'msqrt', 'mroot', 'mtext', 'mspace', 'mtable', 'mtr', 'mtd'
]);

const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'link',
  'meta', 'base', 'template', 'noscript', 'video', 'audio', 'source', 'track',
  'canvas', 'map', 'area', 'portal', 'foreignobject', 'animate', 'animatemotion',
  'animatetransform', 'set', 'handler'
]);

// 不保留 class / style，避免书内 HTML 借应用自身的 Tailwind 类覆盖阅读器界面。
const GLOBAL_ATTRS = new Set([
  'id', 'title', 'lang', 'dir', 'role', 'alt', 'width', 'height',
  'align', 'valign', 'colspan', 'rowspan', 'headers', 'scope', 'start',
  'reversed', 'value', 'type', 'datetime', 'abbr', 'axis', 'border',
  'cellpadding', 'cellspacing', 'color', 'size', 'face', 'open'
]);

const SVG_ATTRS = new Set([
  'viewbox', 'preserveaspectratio', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform',
  'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'clip-path', 'clip-rule', 'offset',
  'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'patternunits',
  'patterncontentunits', 'patterntransform'
]);

const RESERVED_APP_IDS = new Set(['app', 'novelpaginationmeasurer']);

function isReservedAppId(value: string) {
  const lower = value.trim().toLowerCase();
  return !lower || RESERVED_APP_IDS.has(lower) || lower.startsWith('homura-');
}

function isSafeZipPath(value: unknown) {
  const raw = String(value || '');
  if (!raw || raw.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(raw)) return false;
  const parts = raw.split('/');
  return parts.every(part => !!part && part !== '.' && part !== '..');
}

function svgUrlIsSafe(value: unknown) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '');
  if (!/url\s*\(/i.test(text)) return true;
  // 含 url( 时只允许 #fragment 内部引用，使用 [\s\S] 防止换行绕过，且不允许未闭合的 url(
  const matches = text.match(/url\s*\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi);
  if (!matches) return false;
  const stripped = text.replace(/url\s*\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, '');
  if (/url\s*\(/i.test(stripped)) return false;
  return matches.every(item => /^url\s*\(\s*(['"]?)#[a-zA-Z0-9_.:-]+\1\s*\)$/i.test(item));
}

function cleanUrlValue(value: unknown) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function sanitizeAttributes(el: Element, tagName: string) {
  for (const attr of Array.from(el.attributes) as Attr[]) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith('on') || name === 'style' || name === 'srcset' || name === 'srcdoc') {
      el.removeAttribute(attr.name);
      continue;
    }

    if (name === 'id') {
      if (isReservedAppId(value)) el.removeAttribute(attr.name);
      continue;
    }

    if (name === 'data-zip-path') {
      if ((tagName !== 'img' && tagName !== 'image') || !isSafeZipPath(value)) {
        el.removeAttribute(attr.name);
      }
      continue;
    }
    if (name.startsWith('aria-')) continue;

    if (name === 'href' || name === 'xlink:href') {
      const cleaned = cleanUrlValue(value);
      const safe = tagName === 'a'
        ? isSafeLinkUrl(cleaned)
        : tagName === 'use'
          ? /^#[a-zA-Z0-9_.:-]+$/.test(cleaned)
          : (tagName === 'image' || tagName === 'img') && isSafeImageUrl(cleaned);
      if (!safe) el.removeAttribute(attr.name);
      else attr.value = cleaned;
      continue;
    }

    if (name === 'src') {
      const cleaned = cleanUrlValue(value);
      if (tagName !== 'img' || !isSafeImageUrl(cleaned)) el.removeAttribute(attr.name);
      else attr.value = cleaned;
      continue;
    }

    if ((name === 'fill' || name === 'stroke' || name === 'clip-path' || name === 'filter' || name === 'mask'
      || name === 'marker-start' || name === 'marker-mid' || name === 'marker-end')
      && !svgUrlIsSafe(value)) {
      el.removeAttribute(attr.name);
      continue;
    }

    if (!GLOBAL_ATTRS.has(name) && !SVG_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
    }
  }
}

function isInsideSvg(el: Element) {
  let parent = el.parentElement;
  while (parent) {
    if ((parent.localName || parent.tagName).toLowerCase() === 'svg') return true;
    parent = parent.parentElement;
  }
  return false;
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

// 就地净化任意元素子树。EPUB 与 MOBI 共用，避免两条路径的标签清单各自演化。
export function sanitizeElement(root: Element) {
  if (!root) return;

  const elements: Element[] = [];
  const showElement = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1;
  const walker = root.ownerDocument.createTreeWalker(root, showElement);
  let node = walker.nextNode();
  while (node) {
    elements.push(node as Element);
    node = walker.nextNode();
  }

  for (const el of elements) {
    if (!el.isConnected) continue;
    const tagName = (el.localName || el.tagName).toLowerCase();

    if (DROP_WITH_CONTENT.has(tagName)) {
      el.remove();
      continue;
    }
    // HTML 命名空间下的 <title> 属于 RCDATA，容易在二次序列化时产生 mXSS，只允许在 <svg> 内保留。
    if ((tagName === 'title' || tagName === 'desc') && !isInsideSvg(el)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tagName)) {
      unwrap(el);
      continue;
    }

    sanitizeAttributes(el, tagName);
  }
}

export function sanitizeEpubHtml(html: string) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  if (!doc.body) return '';

  sanitizeElement(doc.body);
  return doc.body.innerHTML.trim();
}
