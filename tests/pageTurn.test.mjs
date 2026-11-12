import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { curlGeometry, curlMatrix, curlPoint, curlPolygon, pageTurnTarget, slideGeometry, turnPhase } from '../src/services/pageTurnGeometry.ts';
import { createPageTurn } from '../src/services/pageTurn.ts';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('上一页逐帧还原同一张纸，LTR / RTL 与上中下起手共享逆向轨迹', () => {
  for (const width of [390, 1440]) for (const side of [1, -1]) for (const originY of [0, 400, 800]) {
    for (let frame = 0; frame <= 40; frame++) {
      const progress = frame / 40;
      const phase = turnPhase(progress, true);
      close(phase, turnPhase(1 - progress, false));
      const forward = slideGeometry(width, 800, progress, true, side);
      const backward = slideGeometry(width, 800, 1 - progress, false, side);
      for (const key of Object.keys(forward)) close(forward[key], backward[key]);
      const lift = Math.sin(Math.PI * phase) * 150;
      const a = curlGeometry(width, originY, phase, lift, side);
      const b = curlGeometry(width, originY, turnPhase(1 - progress, false), lift, side);
      assert.equal(!!a, !!b);
      if (a) {
        for (const point of [{ x: 0, y: 0 }, { x: width, y: 800 }, { x: width / 2, y: 400 }]) {
          const pa = curlPoint(point, a), pb = curlPoint(point, b);
          for (const key of ['x', 'y', 'z']) close(pa[key], pb[key]);
        }
      }
    }
  }
});

test('纸面分片的切线矩阵与真实曲面衔接，纸背反射、裁剪不越界', () => {
  for (const side of [1, -1]) {
    const geometry = curlGeometry(390, 0, 0.4, 120, side);
    for (const distance of [-30, 0, geometry.radius * 0.8, geometry.radius * 2.3, geometry.radius * Math.PI + 40]) {
      const point = { x: geometry.axis.x + geometry.normal.x * distance, y: geometry.axis.y + geometry.normal.y * distance };
      const actual = curlPoint(point, geometry);
      const { matrix: [a, b, c, d, e, f], height } = curlMatrix(geometry, distance);
      close(a * point.x + c * point.y + e, actual.x);
      close(b * point.x + d * point.y + f, actual.y);
      close(height, actual.z);
    }
    const polygon = curlPolygon(390, 800, geometry, 0, Math.PI * geometry.radius);
    assert.ok(polygon.length >= 3);
    for (const point of polygon) {
      assert.ok(point.x >= -1e-7 && point.x <= 390 + 1e-7);
      assert.ok(point.y >= -1e-7 && point.y <= 800 + 1e-7);
      const distance = (point.x - geometry.axis.x) * geometry.normal.x + (point.y - geometry.axis.y) * geometry.normal.y;
      assert.ok(distance >= -1e-7 && distance <= Math.PI * geometry.radius + 1e-7);
    }
  }
});

test('跟手卷曲角度由二维拖点决定；整张纸翻出后不会残留在画布上', () => {
  const upper = curlGeometry(390, 0, 0.35, 140, 1);
  const lower = curlGeometry(390, 800, 0.35, -140, 1);
  assert.ok(upper.normal.y < 0 && lower.normal.y > 0);
  for (const side of [1, -1]) {
    const geometry = curlGeometry(390, 400, 1, 0, side);
    for (const x of [0, 195, 390]) {
      const point = curlPoint({ x, y: 400 }, geometry);
      assert.ok(side === 1 ? point.x < 0 : point.x > 390);
    }
  }
});

test('相邻页预览处理首页单排、末页不足一屏与书本边界', () => {
  assert.equal(pageTurnTarget(0, 6, 1, true), 1);
  assert.equal(pageTurnTarget(1, 6, 1, false), 0);
  assert.equal(pageTurnTarget(4, 6, 2, true), 5);
  assert.equal(pageTurnTarget(5, 6, 2, true), null);
  assert.equal(pageTurnTarget(0, 6, 2, false), null);
  assert.equal(pageTurnTarget(0, 0, 1, true), null);
});

function fixture(run) {
  const dom = new JSDOM('<div id="stage"><div id="a" style="opacity:1"><p id="paragraph">甲页 <b>保留排版</b></p><img src="asset://localhost/page.webp"></div><div id="b" style="opacity:0"><p>乙页</p></div></div>');
  const saved = Object.fromEntries(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const frames = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = key => frames.delete(key);
  const stage = document.getElementById('stage');
  Object.defineProperties(stage, { clientWidth: { value: 390 }, clientHeight: { value: 800 } });
  const a = document.getElementById('a'), b = document.getElementById('b');
  const flush = (time = performance.now() + 2000) => {
    const pending = [...frames.values()];frames.clear();pending.forEach(fn => fn(time));
  };
  return Promise.resolve().then(() => run({ stage, a, b, flush, frames })).finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];else globalThis[key] = value;
    }
    dom.window.close();
  });
}

test('真实纸面副本保留富文本和原生图片地址，上一页把目标纸页铺回当前页上', () => fixture(async ({ stage, a, b, flush }) => {
  const original = [a.style.cssText, b.style.cssText];
  const controller = createPageTurn({ stage, outgoing: b, incoming: a, style: 'curl', forward: false, side: 1, originY: 0, compact: true });
  const root = stage.querySelector('.reader-paper-turn');
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  assert.equal(root.querySelectorAll('[id]').length, 0);
  assert.equal(root.querySelector('b').textContent, '保留排版');
  assert.equal(root.querySelector('img').getAttribute('src'), 'asset://localhost/page.webp');
  assert.equal(b.style.opacity, '1');
  assert.equal(a.style.opacity, '0');
  controller.move(200, 90);flush();
  assert.ok([...root.querySelectorAll('.reader-turn-piece')].some(node => node.style.transform.startsWith('matrix(')));
  const finished = controller.finish(true);flush();
  assert.equal(await finished, true);
  controller.destroy();
  assert.equal(stage.querySelector('.reader-paper-turn'), null);
  assert.deepEqual([a.style.cssText, b.style.cssText], original);
}));

test('滑动底页不移动，打断动画会撤走所有副本并恢复原始双缓冲样式', () => fixture(async ({ stage, a, b, flush, frames }) => {
  const original = [a.style.cssText, b.style.cssText];
  const controller = createPageTurn({ stage, outgoing: a, incoming: b, style: 'slide', forward: true, side: 1, originY: 400 });
  controller.move(-195, 150);flush();
  const piece = stage.querySelector('.reader-turn-piece');
  assert.equal(piece.style.transform, 'translate3d(-195px,0,0)');
  assert.match(piece.style.borderRadius, /58.5px/);
  assert.equal(b.style.transform, 'none');
  close(Number(stage.querySelector('.reader-turn-dimmer').style.opacity), 0.12);
  const finished = controller.finish(true);
  controller.destroy();controller.destroy();
  assert.equal(await finished, false);
  assert.equal(frames.size, 0);
  assert.equal(stage.querySelector('.reader-paper-turn'), null);
  assert.deepEqual([a.style.cssText, b.style.cssText], original);
}));
