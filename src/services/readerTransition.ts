/* ============================================================================
   HOMURA · 书架 → 阅读器共享封面
   ========================================================================== */

import { prefersReducedMotion } from './spring.ts';

export function playShelfToReaderSplash(source: HTMLElement, target: HTMLElement, layer: HTMLElement) {
  if (prefersReducedMotion() || typeof target.animate !== 'function') return null;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const bounds = layer.getBoundingClientRect();
  if (!from.width || !from.height || !to.width || !to.height) return null;

  // 保持图片等比缩放。起点用书架的裁切范围，沿途逐步展开至完整封面。
  const scale = Math.max(from.width / to.width, from.height / to.height);
  const x = from.left + from.width / 2 - (to.left + to.width / 2);
  const y = from.top + from.height / 2 - (to.top + to.height / 2);
  const clipX = Math.max(0, (to.width - from.width / scale) / 2);
  const clipY = Math.max(0, (to.height - from.height / scale) / 2);
  const sourceRadius = parseFloat(getComputedStyle(source).borderTopLeftRadius) || 0;
  const targetRadius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;

  const flight = document.createElement('div');
  flight.className = 'rlp-flying-cover';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, {
    position: 'absolute',
    left: `${to.left - bounds.left}px`,
    top: `${to.top - bounds.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    pointerEvents: 'none',
    filter: getComputedStyle(target.parentElement!).filter
  });
  const face = target.cloneNode(true) as HTMLElement;
  Object.assign(face.style, { width: '100%', height: '100%', borderRadius: '0' });
  flight.append(face);
  layer.append(flight);

  const sourceOpacity = source.style.opacity;
  const targetOpacity = target.style.opacity;
  const timing = { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' } as const;
  const movement = flight.animate([
    { transform: `translate(${x}px, ${y}px) scale(${scale})` },
    { transform: 'translate(0, 0) scale(1)' }
  ], timing);
  const crop = face.animate([
    { clipPath: `inset(${clipY}px ${clipX}px round ${sourceRadius / scale}px)` },
    { clipPath: `inset(0px 0px round ${targetRadius}px)` }
  ], timing);
  source.style.opacity = '0';
  target.style.opacity = '0';

  function finish() {
    if (!flight.isConnected) return;
    window.removeEventListener('resize', finish);
    source.style.opacity = sourceOpacity;
    target.style.opacity = targetOpacity;
    flight.remove();
    movement.cancel();
    crop.cancel();
  }

  window.addEventListener('resize', finish, { once: true });
  return {
    // 落位和静态封面交接在同一次 DOM 更新中完成。
    finished: movement.finished.then(finish, () => {}),
    cancel: finish
  };
}
