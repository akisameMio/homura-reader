import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { curlGeometry, curlLighting, curlMatrix, curlPoint, curlPolygon, curlStripTransforms, pageTurnTarget, slideGeometry, turnPhase } from '../src/services/pageTurnGeometry.ts';
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

test('固定裁剪窗覆盖斜向卷页分片，两层矩阵合成保持原始曲面和裁剪边界', () => {
  const apply = ([a, b, c, d, e, f], p) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
  for (const width of [390, 899, 900, 1440]) for (const side of [1, -1]) for (const originY of [0, 400, 800]) {
    const extent = Math.ceil(Math.hypot(width, 800)) + 1;
    for (const phase of [0.001, 0.05, 0.25, 0.5, 0.75, 1]) for (const lift of [-480 - originY, 0, 1280 - originY]) {
      const geometry = curlGeometry(width, originY, phase, lift, side);
      const circumference = Math.PI * geometry.radius;
      for (let index = 0; index < 8; index++) {
        const min = index === 0 ? -Infinity : index === 7 ? circumference : (index - 1) * circumference / 6;
        const max = index === 0 ? 0 : index === 7 ? Infinity : index * circumference / 6;
        const polygon = curlPolygon(width, 800, geometry, min - 0.12, max + 0.12);
        if (polygon.length < 3) continue;
        const distance = index === 0 ? 0 : index === 7 ? circumference : (min + max) / 2;
        const frame = curlStripTransforms(geometry, polygon, distance, extent);
        assert.ok([...frame.clip, ...frame.content].every(Number.isFinite));
        for (const point of polygon) {
          const inClip = apply(frame.content, point);
          assert.ok(inClip.x >= -1e-7 && inClip.x <= extent + 1e-7);
          assert.ok(inClip.y >= -1e-7 && inClip.y <= 2 * extent + 1e-7);
          const actual = apply(frame.clip, inClip);
          const expected = apply(frame.matrix, point);
          close(actual.x, expected.x);
          close(actual.y, expected.y);
        }
      }
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

test('卷页光照跟随斜折痕与左右方向，接触阴影、底页投影和曲面明暗连续衔接', () => {
  for (const width of [390, 899, 900, 1440]) for (const side of [1, -1]) for (const lift of [-300, 0, 300]) {
    const geometry = curlGeometry(width, 400, 0.35, lift, side);
    const extent = Math.ceil(Math.hypot(width, 800)) + 1;
    const lighting = curlLighting(geometry, extent);
    assert.ok(lighting.opacity > 0 && lighting.opacity <= 1);
    for (const [key, start, end] of [['contact', -2.4, 0], ['cast', 0, 4], ['surface', 0, Math.PI]]) {
      const [a, b, c, d, e, f] = lighting[key];
      assert.ok(lighting[key].every(Number.isFinite));
      for (const [x, expected] of [[0, start], [128, end]]) {
        const p = { x: a * x + c * 0.5 + e, y: b * x + d * 0.5 + f };
        close(p.x, geometry.axis.x + geometry.normal.x * expected * geometry.radius);
        close(p.y, geometry.axis.y + geometry.normal.y * expected * geometry.radius);
      }
    }
  }
});

function fixture(run, width = 390) {
  const dom = new JSDOM('<div id="stage"><div id="a" style="opacity:1"><p id="paragraph">甲页 <b>保留排版</b></p><img src="asset://localhost/page.webp"></div><div id="b" style="opacity:0"><p>乙页</p></div></div>');
  const saved = Object.fromEntries(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const frames = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = key => frames.delete(key);
  const stage = document.getElementById('stage');
  Object.defineProperties(stage, { clientWidth: { value: width }, clientHeight: { value: 800 } });
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

test('滑动与卷页将各自页码带进纸面，反向和取消时恢复固定页码且不复制进度控件', async () => {
  for (const style of ['slide', 'curl']) for (const forward of [true, false]) for (const showTotal of [true, false]) {
    await fixture(async ({ stage, a, b, flush }) => {
      const footer = document.createElement('footer');
      footer.innerHTML = '<div class="md-reader-footer-pages" style="opacity:0.75"><span>旧页码</span></div><input type="range">';
      stage.appendChild(footer);
      const label = footer.firstElementChild;
      label.getBoundingClientRect = () => ({ left: 170, top: 745, width: 50, height: 14 });
      stage.getBoundingClientRect = () => ({ left: 10, top: 20 });
      const format = number => showTotal ? `${number}/12页` : `${number}页`;
      const outgoing = 5, incoming = forward ? 7 : 3;
      const controller = createPageTurn({ stage, outgoing: a, incoming: b, style, forward, side: -1, originY: 800, lowPower: true, pageNumbers: { label, outgoing: [{ pageNumber: outgoing, position: 'center' }], incoming: [{ pageNumber: incoming, position: 'center' }], total: 12, showTotal } });
      assert.equal(label.style.opacity, '0');
      assert.equal(a.querySelector('.reader-turn-page-number').textContent, format(outgoing));
      assert.equal(b.querySelector('.reader-turn-page-number').textContent, format(incoming));
      const copied = stage.querySelector('.reader-turn-copy .reader-turn-page-number');
      assert.equal(copied.textContent, format(forward ? outgoing : incoming));
      assert.equal(copied.style.left, '160px');
      assert.equal(copied.style.top, '725px');
      assert.equal(copied.getAttribute('aria-hidden'), 'true');
      assert.equal(stage.querySelectorAll('.reader-paper-turn input').length, 0);
      label.textContent = '正在变化的全局页码';
      controller.move(forward ? 220 : -220, -80);flush();
      assert.equal(copied.textContent, format(forward ? outgoing : incoming));
      const cancelled = controller.finish(false);flush();
      assert.equal(await cancelled, true);
      controller.destroy();
      assert.equal(label.style.opacity, '0.75');
      assert.equal(stage.querySelectorAll('.reader-turn-page-number').length, 0);
      assert.equal(stage.querySelector('.reader-paper-turn'), null);
      assert.equal(footer.querySelectorAll('input').length, 1);
    });
  }
});

test('双页的两枚页码均进入翻页副本，保留 RTL 左右顺序和底页各自页数', async () => {
  for (const style of ['slide', 'curl']) for (const forward of [true, false]) {
    await fixture(async ({ stage, a, b, flush }) => {
      const label = document.createElement('div');
      stage.appendChild(label);
      label.getBoundingClientRect = () => ({ left: 0, top: 745, width: 900, height: 30 });
      const outgoing = [{ pageNumber: 6, position: 'left' }, { pageNumber: 5, position: 'right' }];
      const incoming = forward
        ? [{ pageNumber: 8, position: 'left' }, { pageNumber: 7, position: 'right' }]
        : [{ pageNumber: 4, position: 'left' }, { pageNumber: 3, position: 'right' }];
      const controller = createPageTurn({ stage, outgoing: a, incoming: b, style, forward, side: -1, originY: 0, pageNumbers: { label, outgoing, incoming, total: 12, showTotal: false } });
      const read = paper => [...paper.querySelectorAll('.reader-turn-page-number [data-reader-folio]')].map(node => ({ position: node.dataset.readerFolio, text: node.textContent }));
      const expected = numbers => numbers.map(number => ({ position: number.position, text: `${number.pageNumber}页` }));
      assert.deepEqual(read(a), expected(outgoing));
      assert.deepEqual(read(b), expected(incoming));
      const copy = stage.querySelector('.reader-turn-copy');
      assert.deepEqual(read(copy), expected(forward ? outgoing : incoming));
      controller.move(forward ? 270 : -270, 90);flush();
      assert.deepEqual(read(copy), expected(forward ? outgoing : incoming));
      const finished = controller.finish(true);flush();
      assert.equal(await finished, true);
      controller.destroy();
      assert.equal(stage.querySelectorAll('.reader-turn-page-number').length, 0);
      assert.equal(label.style.opacity, '');
    }, 900);
  }
});

test('低功耗卷页减少纸面分片数量，控制移动端合成层与显存占用', () => fixture(async ({ stage, a, b }) => {
  const low = createPageTurn({ stage, outgoing: b, incoming: a, style: 'curl', forward: true, side: 1, originY: 400, lowPower: true });
  assert.equal(stage.querySelectorAll('.reader-turn-piece').length, 8);
  low.destroy();
  const normal = createPageTurn({ stage, outgoing: b, incoming: a, style: 'curl', forward: true, side: 1, originY: 400 });
  assert.equal(stage.querySelectorAll('.reader-turn-piece').length, 30);
  normal.destroy();
}));

test('卷页裁剪缩小实际图层，局部坐标补偿保持 LTR / RTL 正反翻页的纸面位置', async () => {
  for (const width of [390, 899, 900, 1440]) for (const side of [1, -1]) for (const forward of [true, false]) {
    await fixture(async ({ stage, a, b, flush }) => {
      const controller = createPageTurn({ stage, outgoing: a, incoming: b, style: 'curl', forward, side, originY: 400, compact: true });
      const pieces = [...stage.querySelectorAll('.reader-turn-piece')];
      const order = pieces.map(piece => piece.style.zIndex);
      const count = pieces.length - 2;
      for (const progress of [0.15, 0.45, 0.85]) {
        controller.move((forward ? -side : side) * width * 2.25 * progress, 0);
        flush();
        const geometry = curlGeometry(width, 400, turnPhase(progress, forward), 0, side);
        let area = 0;
        for (const [index, piece] of pieces.entries()) {
          if (piece.style.visibility === 'hidden') continue;
          const copy = piece.querySelector('.reader-turn-copy');
          const w = parseFloat(piece.style.width), h = parseFloat(piece.style.height);
          const x = -parseFloat(copy.style.left), y = -parseFloat(copy.style.top);
          assert.ok(w > 0 && w <= width && h > 0 && h <= 800);
          assert.equal(copy.style.width, width + 'px');
          assert.equal(copy.style.height, '800px');
          assert.equal(copy.style.opacity, '1');
          area += w * h;
          const circumference = Math.PI * geometry.radius;
          const distance = index === 0 ? 0 : index === count + 1 ? circumference : (index - 0.5) * circumference / count;
          const { matrix: [a, b, c, d, e, f], back } = curlMatrix(geometry, distance);
          const [la, lb, lc, ld, le, lf] = piece.style.transform.slice(7, -1).split(',').map(Number);
          // 包围盒四角换回源纸面坐标后，必须与未裁切的仿射变换完全一致。
          for (const [px, py] of [[0, 0], [w, 0], [w, h], [0, h]]) {
            close(la * px + lc * py + le, a * (px + x) + c * (py + y) + e);
            close(lb * px + ld * py + lf, b * (px + x) + d * (py + y) + f);
          }
          assert.equal(piece.querySelector('.reader-turn-back').style.display, back ? 'block' : 'none');
        }
        // 桌面横向卷页的纹理总面积应接近一张纸，而不是多张整屏副本。
        assert.ok(area <= width * 800 * 1.12, `纹理面积 ${area} 超过预算`);
        assert.deepEqual(pieces.map(piece => piece.style.zIndex), order);
      }
      controller.destroy();
    }, width);
  }
});

test('上角和下角卷页取消后恢复整页；中断收尾不会残留动画或裁剪', () => fixture(async ({ stage, a, b, flush, frames }) => {
  const original = [a.style.cssText, b.style.cssText];
  for (const lowPower of [true, false]) for (const originY of [0, 800]) for (const side of [1, -1]) {
    const controller = createPageTurn({ stage, outgoing: a, incoming: b, style: 'curl', forward: true, side, originY, lowPower });
    controller.move(-side * 250, originY === 0 ? 100 : -100);flush();
    const cancelled = controller.finish(false);flush();
    assert.equal(await cancelled, true);
    const pieces = [...stage.querySelectorAll('.reader-turn-piece')];
    if (lowPower) {
      assert.equal(pieces[0].style.opacity, '1');
      assert.equal(pieces[0].querySelector('.reader-turn-surface').style.transform, 'none');
    } else {
      assert.equal(pieces[0].style.visibility, 'visible');
      assert.equal(pieces[0].style.width, '390px');
      assert.equal(pieces[0].style.height, '800px');
      assert.equal(pieces[0].style.clipPath, 'none');
    }
    assert.equal(parseFloat(pieces[0].querySelector('.reader-turn-copy').style.left), 0);
    assert.ok(pieces.slice(1).every(piece => lowPower ? piece.style.opacity === '0' : piece.style.visibility === 'hidden'));
    const finished = controller.finish(true);
    controller.destroy();
    assert.equal(await finished, false);
    assert.equal(frames.size, 0);
    assert.equal(stage.querySelector('.reader-paper-turn'), null);
    assert.deepEqual([a.style.cssText, b.style.cssText], original);
  }
}));

test('卷页副本取消图片的独立合成与背面剔除，原始阅读图层保持加速', () => fixture(async ({ a }) => {
  const css = readFileSync(new URL('../src/assets/styles/canvas.css', import.meta.url), 'utf8');
  const style = document.createElement('style');style.textContent = css;document.head.append(style);
  a.className = 'stage-buffer-layer';
  const image = a.querySelector('img');image.className = 'manga-page-img';
  assert.equal(window.getComputedStyle(image).transform, 'translateZ(0)');
  assert.equal(window.getComputedStyle(image).backfaceVisibility, 'hidden');
  a.classList.add('reader-turn-copy');
  assert.equal(window.getComputedStyle(a).backfaceVisibility, 'visible');
  assert.equal(window.getComputedStyle(image).transform, 'none');
  assert.equal(window.getComputedStyle(image).backfaceVisibility, 'visible');
}));

test('Android 卷页的裁剪窗和纸面尺寸不随拖动改变，收尾保留固定图层', async () => {
  for (const side of [1, -1]) for (const forward of [true, false]) for (const originY of [0, 400, 800]) {
    await fixture(async ({ stage, a, b, flush }) => {
      const controller = createPageTurn({ stage, outgoing: a, incoming: b, style: 'curl', forward, side, originY, lowPower: true });
      const root = stage.querySelector('.reader-paper-turn-stable');
      assert.ok(root);
      const pieces = [...root.querySelectorAll('.reader-turn-piece')];
      const check = () => {
        for (const piece of pieces) {
          assert.equal(piece.style.width, '');
          assert.equal(piece.style.height, '');
          assert.equal(piece.style.clipPath, '');
          assert.equal(piece.style.visibility, '');
          const surface = piece.querySelector('.reader-turn-surface');
          assert.ok(surface);
          assert.equal(surface.style.width, '');
          assert.equal(surface.style.height, '');
          assert.equal(surface.style.clipPath, '');
          const copy = surface.querySelector('.reader-turn-copy');
          assert.equal(parseFloat(copy.style.left), 0);
          assert.equal(parseFloat(copy.style.top), 0);
          assert.equal(copy.style.width, '390px');
          assert.equal(copy.style.height, '800px');
          assert.equal(copy.style.opacity, '1');
          assert.equal(copy.style.transform, 'none');
          assert.ok(piece.style.transform === 'none' || piece.style.transform.startsWith('matrix(') || piece.style.opacity === '0');
        }
      };
      check();
      for (const progress of [0.05, 0.35, 0.7, 0.25, 0]) {
        controller.move((forward ? -side : side) * 390 * 2.25 * progress, Math.sin(progress * Math.PI) * (originY === 800 ? -240 : 240));
        flush();check();
        if (progress === 0.35) {
          assert.ok(Number(root.querySelector('.reader-turn-shadow').style.opacity) > 0);
          assert.ok(Number(root.querySelector('.reader-turn-contact').style.opacity) > 0);
        }
      }
      const finished = controller.finish(true);flush();
      assert.equal(await finished, true);check();
      for (const selector of ['.reader-turn-shadow', '.reader-turn-contact']) {
        const shadow = root.querySelector(selector);
        assert.equal(Number(shadow.style.opacity) > 0, forward);
        assert.ok(shadow.style.transform.startsWith('matrix('));
        assert.equal(shadow.style.clipPath, '');
        assert.equal(shadow.style.width, '');
        assert.equal(shadow.style.height, '');
      }
      controller.destroy();
    });
  }
});
