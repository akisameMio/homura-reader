/* ============================================================================
   HOMURA · 书架 → 阅读器共享封面
   ========================================================================== */

import { prefersReducedMotion } from './spring.ts';

const OPEN_EASE = 'cubic-bezier(0.27, 0.68, 0.42, 1)';
const SHELF_FLIGHT_MS = 610;
export const READER_OPEN_SPRINT_MS = 105;
export const READER_OPEN_FAST_MS = 80;
export const READER_OPEN_CLEAR_MS = 108;
const EXPAND_MS = 450;

export function advanceReaderProgress(display: number, rendering: boolean, dt: number, trickle: boolean) {
  const stageTarget = rendering ? 68 : 28;
  const softCap = rendering ? 92 : 72;
  const chased = display + Math.max(0, stageTarget - display) * -Math.expm1(-5.4 * dt);
  return trickle ? chased + Math.max(0, softCap - chased) * -Math.expm1(-0.36 * dt) : chased;
}

export function sprintReaderProgress(from: number, elapsed: number) {
  if (elapsed >= READER_OPEN_SPRINT_MS) return 100;
  const t = elapsed / READER_OPEN_SPRINT_MS;
  return from + (100 - from) * Math.expm1(-3.6 * t) / Math.expm1(-3.6);
}

export interface ReaderOpeningFrame {
  surface: HTMLElement;
  cover: HTMLImageElement | null;
  firstPageIsCover: boolean;
}

export function waitForOpeningPaint(signal: AbortSignal) {
  if (signal.aborted || document.hidden) return Promise.resolve();
  return new Promise<void>(resolve => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
    function finish() {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', finish);
      document.removeEventListener('visibilitychange', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
    document.addEventListener('visibilitychange', finish, { once: true });
  });
}

export async function decodeVisibleReaderImages(content: HTMLElement, viewport: HTMLElement) {
  const bounds = viewport.getBoundingClientRect();
  const visible = [...content.querySelectorAll('img')].filter(image => {
    const rect = image.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom
      && rect.right > bounds.left && rect.left < bounds.right;
  });
  await Promise.allSettled(visible.map(image => {
    image.loading = 'eager';
    return image.decode();
  }));
}

export function standaloneCover(flow: HTMLElement | null) {
  if (!flow || flow.textContent?.trim() || flow.querySelector('svg, image, video, canvas, hr')) return null;
  const images = flow.querySelectorAll('img');
  return images.length === 1 ? images[0] : null;
}

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
    filter: 'var(--rlp-flight-shadow)',
    willChange: 'transform'
  });
  const face = target.cloneNode(true) as HTMLElement;
  Object.assign(face.style, { width: '100%', height: '100%', borderRadius: '0' });
  flight.append(face);
  layer.append(flight);

  const sourceOpacity = source.style.opacity;
  const targetOpacity = target.style.opacity;
  const timing = { duration: SHELF_FLIGHT_MS, easing: OPEN_EASE, fill: 'both' } as const;
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
    cancel: finish,
    settleWithin(duration: number) {
      const remaining = timing.duration - Number(movement.currentTime || 0);
      if (remaining <= duration) return;
      movement.updatePlaybackRate(remaining / duration);
      crop.updatePlaybackRate(remaining / duration);
    }
  };
}

function clipFrom(rect: DOMRect, bounds: DOMRect, radius: number) {
  return `inset(${rect.top - bounds.top}px ${bounds.right - rect.right}px ${bounds.bottom - rect.bottom}px ${rect.left - bounds.left}px round ${radius}px)`;
}

function matchCover(source: HTMLImageElement, target: HTMLImageElement, known: boolean) {
  if (!source.naturalWidth || !target.naturalWidth || !source.naturalHeight || !target.naturalHeight) return false;
  const ratio = (source.naturalWidth / source.naturalHeight) / (target.naturalWidth / target.naturalHeight);
  if (Math.abs(ratio - 1) > 0.05) return false;
  if (known || source.currentSrc === target.currentSrc) return true;
  // 书架通常存的是缩略图，URL 不同。小图采样也能区分 EPUB 封面与卷首的其它插图。
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  try {
    context.drawImage(source, 0, 0, 12, 12);
    context.drawImage(target, 0, 12, 12, 12);
    const { data } = context.getImageData(0, 0, 12, 24);
    const half = data.length / 2;
    let error = 0;
    for (let index = 0; index < half; index++) error += Math.abs(data[index] - data[index + half]);
    return error / half < 7;
  } catch {
    return false;
  }
}

function sharedCover(target: HTMLImageElement, bounds: DOMRect) {
  const box = target.getBoundingClientRect();
  const viewport = target.closest('[data-reader-scroll]')?.getBoundingClientRect() || bounds;
  const style = getComputedStyle(target);
  const { objectFit, objectPosition, backgroundColor, boxShadow } = style;
  if (!box.width || !box.height || !['fill', 'contain', 'scale-down'].includes(objectFit)) return null;

  // 窄屏的 img 盒子可能比 object-fit: contain 实际画出的图片更高。
  const scale = Math.min(box.width / target.naturalWidth, box.height / target.naturalHeight);
  const fit = objectFit === 'scale-down' ? Math.min(1, scale) : scale;
  const width = objectFit === 'fill' ? box.width : target.naturalWidth * fit;
  const height = objectFit === 'fill' ? box.height : target.naturalHeight * fit;
  const xInset = (box.width - width) / 2;
  const yInset = (box.height - height) / 2;
  const radius = parseFloat(style.borderTopLeftRadius) || 0;
  if (Math.max(xInset, yInset) > 0.5) {
    if (objectPosition !== '50% 50%' || backgroundColor !== 'rgba(0, 0, 0, 0)' || boxShadow !== 'none'
      || Math.max(xInset, yInset) < radius) return null;
  }
  const rect = new DOMRect(box.left + xInset, box.top + yInset, width, height);
  if (rect.top < viewport.top - 0.5 || rect.bottom > viewport.bottom + 0.5
    || rect.left < viewport.left - 0.5 || rect.right > viewport.right + 0.5) return null;
  return { target, box, rect, style };
}

export function playReaderOpening({
  layer, backdrop, underlay, face, shadow, meta, frame, onExpand, onFinish
}: {
  layer: HTMLElement;
  backdrop: HTMLElement;
  underlay: HTMLElement;
  face: HTMLElement;
  shadow: HTMLElement;
  meta: HTMLElement;
  frame: ReaderOpeningFrame;
  onExpand: () => void;
  onFinish: () => void;
}) {
  if (!frame.surface.isConnected || typeof meta.animate !== 'function' || prefersReducedMotion()) return null;
  const animations: Animation[] = [];
  const restore: Array<() => void> = [];
  let stopped = false;
  const source = face.querySelector('img');
  const target = frame.cover;
  const coverUrl = target?.currentSrc || target?.src || '';
  const checkNativeCover = !frame.firstPageIsCover && /^(asset:\/\/|https?:\/\/asset\.)localhost\//.test(coverUrl);
  const coverCopy = source && target && (checkNativeCover || matchCover(source, target, frame.firstPageIsCover))
    ? new Image() : null;
  let coverLayer: HTMLDivElement | undefined;
  let coverReady = false;
  if (coverCopy) {
    // 原生页图默认不用 CORS。比对时单独复用 asset 协议的跨源响应，保留阅读页原来的图片加载方式。
    if (checkNativeCover) coverCopy.crossOrigin = 'anonymous';
    coverCopy.src = coverUrl;
    coverCopy.alt = '';
    void coverCopy.decode().then(() => {
      if (!stopped) coverReady = !checkNativeCover || !!(source && matchCover(source, coverCopy, false));
    }, () => {});
  }

  function setStyle(element: HTMLElement, property: string, value: string) {
    const original = element.style.getPropertyValue(property);
    element.style.setProperty(property, value);
    restore.push(() => element.style.setProperty(property, original));
  }

  function animate(element: HTMLElement, keyframes: Keyframe[], duration = EXPAND_MS, easing = OPEN_EASE) {
    const animation = element.animate(keyframes, { duration, easing, fill: 'both' });
    animation.finished.catch(() => {});
    animations.push(animation);
    return animation;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('resize', finish);
    animations.forEach(animation => animation.cancel());
    restore.reverse().forEach(reset => reset());
    coverLayer?.remove();
  }

  function finish() {
    if (stopped) return;
    onFinish();
    stop();
  }

  function expand() {
    if (stopped) return;
    const surface = frame.surface;
    const bounds = surface.getBoundingClientRect();
    const layerBounds = layer.getBoundingClientRect();
    const from = face.getBoundingClientRect();
    if (!surface.isConnected || !from.width || !from.height || !bounds.width || !bounds.height) {
      finish();
      return;
    }

    // 仅在清场结束后读取一次起落点。纸面始终在下方，阅读视图从封面边界向外揭开。
    const radius = parseFloat(getComputedStyle(face).borderTopLeftRadius) || 0;
    const shared = coverReady && target?.isConnected ? sharedCover(target, bounds) : null;
    const to = shared?.rect ?? bounds;
    const movement = [
      { transform: 'translate(0px, 0px) scale(1, 1)' },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` }
    ];
    const reveal = animate(surface, [
      { clipPath: clipFrom(from, bounds, radius) },
      { clipPath: 'inset(0px 0px 0px 0px round 0px)' }
    ]);
    setStyle(surface, 'will-change', 'transform, clip-path');
    setStyle(backdrop, 'visibility', 'hidden');
    setStyle(underlay, 'visibility', 'visible');
    setStyle(underlay, 'will-change', 'opacity');
    animate(underlay, [{ opacity: 1 }, { opacity: 0 }], EXPAND_MS * 0.55);
    animate(shadow, movement);
    animate(shadow, [{ opacity: 1 }, { opacity: 0 }], EXPAND_MS * 0.55);

    if (shared && coverCopy) {
      // 用已解码的首屏图片绘制唯一一份封面，末帧与实际图片的盒子、裁切和滤镜相同。
      const { box, style } = shared;
      const { objectFit, objectPosition, filter, backgroundColor, boxShadow, borderRadius } = style;
      const sx = from.width / to.width;
      const sy = from.height / to.height;
      const dx = from.left - box.left - (to.left - box.left) * sx;
      const dy = from.top - box.top - (to.top - box.top) * sy;
      coverLayer = document.createElement('div');
      Object.assign(coverLayer.style, {
        position: 'absolute', inset: '0', pointerEvents: 'none', willChange: 'clip-path'
      });
      Object.assign(coverCopy.style, {
        position: 'absolute', display: 'block',
        left: `${box.left - layerBounds.left}px`, top: `${box.top - layerBounds.top}px`,
        width: `${box.width}px`, height: `${box.height}px`, maxWidth: 'none',
        transformOrigin: 'left top', objectFit, objectPosition, filter, backgroundColor, boxShadow, borderRadius,
        willChange: 'transform'
      });
      coverLayer.append(coverCopy);
      layer.append(coverLayer);
      animate(coverLayer, [
        { clipPath: clipFrom(from, layerBounds, radius) },
        { clipPath: 'inset(0px 0px 0px 0px round 0px)' }
      ]);
      animate(coverCopy, [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: 'none' }
      ]);
      setStyle(face, 'visibility', 'hidden');
      setStyle(shared.target, 'visibility', 'hidden');
    } else {
      animate(face, movement);
      animate(face, [
        { clipPath: `inset(0px round ${radius}px)` },
        { clipPath: 'inset(0px round 0px)' }
      ]);
      animate(face, [{ opacity: 1 }, { opacity: 0 }], EXPAND_MS * 0.45);
    }
    onExpand();
    reveal.finished.then(finish, () => {});
  }

  window.addEventListener('resize', finish, { once: true });
  animate(meta, [{ opacity: 1, transform: 'translate(-50%, 0px)' }, {
    opacity: 0, transform: 'translate(-50%, 7px)'
  }], READER_OPEN_CLEAR_MS).finished.then(expand, () => {});
  return { cancel: stop };
}
