import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cloneSettingsTransitionPage } from '../src/services/settingsTransitionSnapshot.ts';

function fixture(markup, rectangles) {
  const dom = new JSDOM(`<main class="settings-page">${markup}</main>`);
  const page = dom.window.document.querySelector('main');
  for (const [id, [top, height]] of Object.entries(rectangles)) {
    page.querySelector(`#${id}`).getBoundingClientRect = () => ({ top, bottom: top + height, height });
  }
  return { dom, page };
}

test('屏外卡片仅保留原尺寸占位，可见卡片的图标和控件完整保留', () => {
  const { dom, page } = fixture(`
    <header><h1>设置</h1></header><div class="settings-grid">
      <section id="above" class="settings-card settings-appearance"><b>上方内容</b></section>
      <section id="visible" class="settings-card"><button aria-label="打开存储与数据"><svg><path d="M0 0"/></svg></button><strong>102 KB</strong></section>
      <section id="below" class="settings-card"><button>下方控件</button></section>
    </div>`, { above: [-400, 280], visible: [160, 280], below: [1000, 360] });
  try {
    const clone = cloneSettingsTransitionPage(page, { top: 0, bottom: 800 });
    for (const [id, height] of [['above', 280], ['below', 360]]) {
      const block = clone.querySelector(`#${id}`);
      assert.equal(block.childNodes.length, 0);
      assert.equal(block.style.height, `${height}px`);
      assert.equal(block.style.minHeight, `${height}px`);
      assert.equal(block.style.boxSizing, 'border-box');
      assert.equal(block.style.visibility, 'hidden');
    }
    assert.ok(clone.querySelector('#above').classList.contains('settings-appearance'));
    assert.equal(clone.querySelector('#visible').innerHTML, page.querySelector('#visible').innerHTML);
    assert.equal(clone.querySelector('#visible path').namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(page.querySelector('#above').textContent, '上方内容');
    assert.equal(page.querySelector('#below').style.height, '', '原页面不受动画副本裁剪影响');
  } finally { dom.window.close(); }
});

test('滚动后的二级页保留视口边缘分组及阴影缓冲区', () => {
  const { dom, page } = fixture(`
    <div class="settings-detail">
      <div id="hero" class="settings-detail-hero"><p>页首示意</p></div>
      <section id="edge" class="settings-detail-group"><h2>边缘分组</h2></section>
      <section id="buffer" class="settings-detail-group"><p>阴影缓冲</p></section>
      <section id="far" class="settings-detail-group"><p>屏外分组</p></section>
    </div>`, { hero: [-500, 300], edge: [-40, 90], buffer: [820, 180], far: [840, 200] });
  try {
    const clone = cloneSettingsTransitionPage(page, { top: 0, bottom: 800 });
    assert.equal(clone.querySelector('#hero').childNodes.length, 0);
    assert.equal(clone.querySelector('#edge h2').textContent, '边缘分组');
    assert.equal(clone.querySelector('#buffer p').textContent, '阴影缓冲');
    assert.equal(clone.querySelector('#far').childNodes.length, 0);
  } finally { dom.window.close(); }
});

test('没有屏外分组时保留完整结构，零高和未知尺寸不误删内容', () => {
  const { dom, page } = fixture(`
    <!-- 分组锚点 --><section id="zero" class="settings-detail-group"><p>尚未度量</p></section>
    <section id="unknown" class="settings-detail-group"><button>未知尺寸</button></section>
    <section id="visible" class="settings-card"><input value="保留值"/></section>
  `, { zero: [1000, 0], unknown: [1000, NaN], visible: [100, 300] });
  try {
    const clone = cloneSettingsTransitionPage(page, { top: 0, bottom: 800 });
    assert.equal(clone.innerHTML, page.innerHTML);
    assert.notEqual(clone.querySelector('input'), page.querySelector('input'));
  } finally { dom.window.close(); }
});
