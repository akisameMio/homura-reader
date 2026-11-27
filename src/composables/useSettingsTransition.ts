import type { InjectionKey, ShallowRef } from 'vue';
import { prefersReducedMotion } from '../services/spring.ts';

export const settingsSelectBackKey: InjectionKey<ShallowRef<(() => void) | null>> = Symbol('settings-select-back');

const TIMELINE = 1000;
const FULL_CLIP = 'inset(0px 0px 0px 0px round 0px)';
const IDENTITY = 'translate3d(0px, 0px, 0px)';
const SHAPE_EASE = 'cubic-bezier(0.35, 0.12, 0.45, 1)';

export function measureSettingsTransition(page: HTMLElement, card: HTMLElement | null) {
  const column = page.closest<HTMLElement>('[data-app-scroll]') ?? page;
  const bounds = column.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const left = Math.max(0, bounds.left);
  const right = Math.min(viewportWidth, bounds.right);
  const insets = { left: `${left}px`, right: `${viewportWidth - right}px` };
  const rect = card?.getBoundingClientRect();
  if (!card || !rect) return { insets, anchor: null };
  const x = Math.max(left, rect.left);
  const y = Math.max(0, rect.top);
  const endX = Math.min(right, rect.right);
  const endY = Math.min(window.innerHeight, rect.bottom);
  if (endX <= x || endY <= y) return { insets, anchor: null };
  const radius = `${parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0}px`;
  const inset = `${y}px ${right - endX}px ${window.innerHeight - endY}px ${x - left}px`;
  return {
    insets,
    anchor: {
      inset, radius,
      clipPath: `inset(${inset} round ${radius})`,
      transform: `translate3d(${x - left}px, ${y}px, 0px)`
    }
  };
}

export function createSettingsTransition(
  clip: HTMLElement,
  surface: HTMLElement,
  detail: HTMLElement,
  anchor: NonNullable<ReturnType<typeof measureSettingsTransition>['anchor']>,
  initialProgress: number,
  onInterrupted: () => void
) {
  if (prefersReducedMotion() || typeof clip.animate !== 'function'
    || !CSS.supports('clip-path', anchor.clipPath)) return null;
  const animations: Animation[] = [];
  let settlement = 0;
  let disposed = false;

  function add(element: HTMLElement, frames: Keyframe[]) {
    const animation = element.animate(frames, { duration: TIMELINE, fill: 'both' });
    animations.push(animation);
    animation.addEventListener('cancel', () => {
      if (!disposed) onInterrupted();
    });
    animation.pause();
    animation.currentTime = initialProgress * TIMELINE;
  }

  function destroy() {
    disposed = true;
    for (const animation of animations) animation.cancel();
    clip.classList.remove('is-morphing');
    clip.style.removeProperty('--settings-anchor-clip');
    clip.style.removeProperty('--settings-anchor-inset');
    clip.style.removeProperty('--settings-anchor-radius');
  }

  try {
    // 只在入口卡片的原位置透出概览，其余收缩区域保持不透明。
    clip.style.setProperty('--settings-anchor-clip', anchor.clipPath);
    clip.style.setProperty('--settings-anchor-inset', anchor.inset);
    clip.style.setProperty('--settings-anchor-radius', anchor.radius);
    clip.classList.add('is-morphing');
    add(clip, [{ clipPath: FULL_CLIP, easing: SHAPE_EASE }, { clipPath: anchor.clipPath }]);
    // 入口先于详情完全淡出时开始显现，仅在入口区域短暂交叠。
    add(surface, [
      { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.32 }, { opacity: 0.52, offset: 0.365 },
      { opacity: 0, offset: 0.8 }, { opacity: 0, offset: 1 }
    ]);
    add(detail, [
      { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.04 },
      { opacity: 0.3, offset: 0.3 }, { opacity: 0, offset: 0.35 }, { opacity: 0, offset: 1 }
    ]);
    add(detail, [
      { transform: IDENTITY, offset: 0 },
      { transform: IDENTITY, offset: 0.04, easing: SHAPE_EASE },
      { transform: anchor.transform, offset: 1 }
    ]);
  } catch {
    destroy();
    return null;
  }

  function progress() {
    return Number(animations[0].currentTime ?? 0) / TIMELINE;
  }

  function seek(position: number) {
    for (const animation of animations) animation.currentTime = position * TIMELINE;
  }

  return {
    destroy,
    seek,
    pause() {
      settlement++;
      const position = progress();
      for (const animation of animations) animation.pause();
      seek(position);
      return position;
    },
    playTo(target: 0 | 1, done: () => void, settleDuration?: number) {
      const version = ++settlement;
      const position = progress();
      const distance = target - position;
      if (Math.abs(distance) < 0.001) {
        seek(target);
        done();
        return;
      }
      const duration = settleDuration ?? Math.abs(distance) * (target === 0 ? 380 : 280);
      const rate = distance * TIMELINE / duration;
      try {
        const start = position * TIMELINE;
        const now = document.timeline.currentTime;
        for (const animation of animations) {
          animation.playbackRate = rate;
          animation.currentTime = start;
          animation.play();
          if (typeof now === 'number') animation.startTime = now - start / rate;
        }
        void Promise.all(animations.map(animation => animation.finished)).then(() => {
          if (!disposed && settlement === version) done();
        }, () => {
          if (!disposed && settlement === version) onInterrupted();
        });
      } catch {
        onInterrupted();
      }
    }
  };
}
