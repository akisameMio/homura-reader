import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSettingsTransition, measureSettingsTransition } from '../src/composables/useSettingsTransition.ts';
import { readSettingsSection } from '../src/services/settingsSectionHistory.ts';

function fixture(run, { reduced = false, clipSupported = true } = {}) {
  const { window } = new JSDOM('<main data-app-scroll><div id="page"><article style="border-top-left-radius: 28px"></article></div></main>');
  const { document } = window;
  Object.assign(globalThis, {
    window, document, getComputedStyle: window.getComputedStyle,
    CSS: { supports: () => clipSupported }
  });
  window.matchMedia = () => ({ matches: reduced });
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1200 });
  Object.defineProperty(window, 'innerHeight', { value: 800 });
  Object.defineProperty(document, 'timeline', { value: { currentTime: 1000 } });
  const page = document.querySelector('#page');
  const card = page.querySelector('article');
  const column = page.parentElement;
  column.getBoundingClientRect = () => ({ left: 220, right: 1200 });
  card.getBoundingClientRect = () => ({ left: 240, right: 620, top: 200, bottom: 560 });

  const effects = [];
  function animate(keyframes, options) {
    const animation = new EventTarget();
    const completion = Promise.withResolvers();
    Object.assign(animation, {
      keyframes, options, currentTime: 0, playbackRate: 1, finished: completion.promise,
      pause: () => { animation.paused = true; },
      play: () => { animation.paused = false; },
      finish: () => completion.resolve(),
      cancel() {
        animation.dispatchEvent(new Event('cancel'));
        completion.reject(new Error('cancelled'));
      }
    });
    completion.promise.catch(() => {});
    effects.push(animation);
    return animation;
  }

  const [clip, surface, content] = Array.from({ length: 3 }, () => Object.assign(document.createElement('div'), { animate }));
  let interrupted = 0;
  const setup = progress => createSettingsTransition(clip, surface, content, measureSettingsTransition(page, card).anchor, progress, () => { interrupted++; });
  return Promise.resolve(run({ page, card, clip, effects, setup, interrupted: () => interrupted })).finally(() => window.close());
}

test('卡片落点相对于主栏裁切，屏外入口没有可动画的区域', () => fixture(({ page, card }) => {
  assert.deepEqual(measureSettingsTransition(page, card), {
    insets: { left: '220px', right: '0px' },
    anchor: {
      inset: '200px 580px 240px 20px', radius: '28px',
      clipPath: 'inset(200px 580px 240px 20px round 28px)',
      transform: 'translate3d(20px, 200px, 0px)'
    }
  });
  card.getBoundingClientRect = () => ({ left: 200, right: 620, top: -180, bottom: 50 });
  assert.equal(measureSettingsTransition(page, card).anchor.clipPath, 'inset(0px 580px 750px 0px round 28px)');
  card.getBoundingClientRect = () => ({ left: 240, right: 620, top: -180, bottom: -10 });
  assert.equal(measureSettingsTransition(page, card).anchor, null);
}));

test('关闭分段淡出真实详情和表面，反向播放使用同一组关键帧', () => fixture(async ({ setup, clip, effects, interrupted }) => {
  const transition = setup(1);
  assert.ok(clip.classList.contains('is-morphing'));
  assert.equal(effects.length, 4);
  assert.ok(effects.every(animation => animation.paused && animation.currentTime === 1000));
  assert.deepEqual(effects[2].keyframes, [
    { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.04 },
    { opacity: 0.3, offset: 0.3 }, { opacity: 0, offset: 0.35 }, { opacity: 0, offset: 1 }
  ]);
  assert.deepEqual(effects[1].keyframes, [
    { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.32 }, { opacity: 0.52, offset: 0.365 },
    { opacity: 0, offset: 0.8 }, { opacity: 0, offset: 1 }
  ]);
  let finished = 0;
  transition.playTo(0, () => { finished++; });
  assert.ok(effects.every(animation => animation.playbackRate < 0));
  transition.pause();
  transition.seek(0.42);
  assert.ok(effects.every(animation => animation.paused && animation.currentTime === 420));
  transition.playTo(1, () => { finished++; }, 250);
  assert.ok(effects.every(animation => Math.abs((1000 - animation.currentTime) / animation.playbackRate - 250) < 0.01));
  effects.forEach(animation => animation.finish());
  await new Promise(queueMicrotask);
  assert.equal(finished, 1);
  transition.destroy();
  assert.ok(!clip.classList.contains('is-morphing'));
  assert.equal(interrupted(), 0);
}));

test('运行中取消和动画初始化失败都能释放转场', () => fixture(async ({ setup, effects, clip, interrupted }) => {
  const transition = setup(0);
  transition.playTo(1, () => assert.fail('已取消动画不能提交结束回调'));
  effects[0].cancel();
  assert.ok(interrupted() >= 1);
  transition.destroy();
  clip.animate = () => { throw new Error('unsupported'); };
  assert.equal(setup(0), null);
}));

test('减少动态效果或 WebView 无裁切支持时直接落地', async () => {
  await fixture(({ setup, effects }) => {
    assert.equal(setup(0), null);
    assert.equal(effects.length, 0);
  }, { reduced: true });
  await fixture(({ setup, effects }) => {
    assert.equal(setup(0), null);
    assert.equal(effects.length, 0);
  }, { clipSupported: false });
});

test('只从 HOMURA 设置详情历史条目读取已知页面', () => {
  assert.equal(readSettingsSection({ homuraSettings: true, subPage: 'storage' }), 'storage');
  for (const state of [null, {}, { subPage: 'storage' }, { homuraSettings: true, subPage: 'toString' },
    { homuraSettings: true, subPage: 'unknown' }, { homuraSettings: true, subPage: 1 }]) {
    assert.equal(readSettingsSection(state), null);
  }
});
