import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAxis, runSpring, stepAxes } from '../src/services/spring.ts';

const MAX_STEP = 1 / 240;
const travelAxis = () => makeAxis(0, 460, 34 / (2 * Math.sqrt(460)));

test('分段滑块在 60Hz 与 120Hz 下保留换向前的速度', () => {
  function simulate(hz) {
    const travel = travelAxis();
    travel.target = 180;
    for (let i = 0; i < hz / 15; i++) stepAxes([travel], 1 / hz, 1, MAX_STEP);
    const before = travel.pos;
    assert.ok(travel.vel > 0);

    travel.target = 0;
    stepAxes([travel], MAX_STEP, 1, MAX_STEP);
    assert.ok(travel.pos > before, '换向后的第一步仍沿原方向前进');
    for (let i = 0; i < hz / 10; i++) stepAxes([travel], 1 / hz, 1, MAX_STEP);
    assert.ok(travel.vel < 0 && travel.pos < before);
    return travel;
  }

  const at60 = simulate(60);
  const at120 = simulate(120);
  assert.ok(Math.abs(at60.pos - at120.pos) < 0.001);
  assert.ok(Math.abs(at60.vel - at120.vel) < 0.001);
});

test('分段滑块继承松手速度，后台长帧后仍收敛并清空动画队列', t => {
  let now = 0;
  let nextFrame = 0;
  const queued = new Map();
  t.mock.method(globalThis.performance, 'now', () => now);
  globalThis.requestAnimationFrame = callback => {
    queued.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = id => queued.delete(id);
  t.after(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });

  function frame(ms) {
    now += ms;
    const callbacks = [...queued.values()];
    queued.clear();
    callbacks.forEach(callback => callback(now));
  }

  const travel = travelAxis();
  travel.target = 100;
  travel.vel = -1000;
  let completed = 0;
  const stop = runSpring([travel], () => {}, () => { completed++; }, {
    maxDt: 0.032, maxStep: MAX_STEP, posEpsilon: 0.05, velEpsilon: 0.1
  });
  frame(4);
  assert.ok(travel.pos < 0);
  frame(30_000);
  assert.ok(Math.abs(travel.pos) < 100);
  assert.ok(Math.abs(travel.vel) < 2500);
  for (let i = 0; i < 90 && queued.size; i++) frame(1000 / 120);
  assert.equal(completed, 1);
  assert.equal(travel.pos, 100);
  assert.equal(travel.vel, 0);
  assert.equal(queued.size, 0);

  travel.target = 0;
  const cancelNext = runSpring([travel], () => assert.fail('取消后不应绘制'), () => {});
  cancelNext();
  assert.equal(queued.size, 0);
  stop();
});
