/* ============================================================================
   HOMURA · 真实纸面的覆盖滑动与跟手卷页
   ----------------------------------------------------------------------------
   直接变形双缓冲中的 DOM 副本，不截图、不重绘正文，不依赖额外渲染库。
   分片、动画、指针状态均由普通对象持有；取消时恢复两槽，调用方决定最终落页。
   ========================================================================== */

import { clampTurnProgress, curlGeometry, curlMatrix, curlPoint, curlPolygon, slideGeometry, turnPhase, type TurnPoint, type TurnSide } from './pageTurnGeometry.ts';
import { prefersReducedMotion } from './spring.ts';

export type PaperTurnStyle = 'slide' | 'curl';
export interface PageTurnController {
  move(dx: number, dy: number): void;
  finish(commit: boolean): Promise<boolean>;
  destroy(): void;
}
interface PageTurnOptions {
  stage: HTMLElement;
  outgoing: HTMLElement;
  incoming: HTMLElement;
  style: PaperTurnStyle;
  forward: boolean;
  side: TurnSide;
  originY: number;
  compact?: boolean;
}
interface Piece { element: HTMLDivElement; copy: HTMLElement; shade: HTMLDivElement; }

function polygonStyle(points: TurnPoint[]) {
  return `polygon(${points.map(p => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})`;
}

export function createPageTurn(options: PageTurnOptions): PageTurnController {
  const { stage, outgoing, incoming, style, forward, side } = options;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const originY = Math.max(0, Math.min(height, options.originY));
  const top = forward ? outgoing : incoming;
  const bottom = forward ? incoming : outgoing;
  const originalStyles = [outgoing.style.cssText, incoming.style.cssText];
  let destroyed = false;
  let progress = 0;
  let lift = 0;
  let raf = 0;
  let resolveAnimation: ((completed: boolean) => void) | null = null;

  const root = document.createElement('div');
  root.className = 'reader-paper-turn';
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  root.style.setProperty('--turn-width', width + 'px');
  root.style.setProperty('--turn-height', height + 'px');
  const shadow = document.createElement('div');
  shadow.className = 'reader-turn-shadow';
  root.appendChild(shadow);

  function makePiece(): Piece {
    const element = document.createElement('div');
    element.className = 'reader-turn-piece';
    const copy = top.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.classList.add('reader-turn-copy');
    Object.assign(copy.style, { position: 'absolute', inset: 'auto', left: '0', top: '0', width: width + 'px', height: height + 'px', opacity: '1', transform: 'none', zIndex: 'auto', clipPath: 'none', borderRadius: '0', boxShadow: 'none' });
    const shade = document.createElement('div');
    shade.className = 'reader-turn-shade';
    element.append(copy, shade);
    root.appendChild(element);
    return { element, copy, shade };
  }

  const pieces = Array.from({ length: style === 'curl' ? (options.compact ? 20 : 28) + 2 : 1 }, makePiece);
  outgoing.style.opacity = '0';
  incoming.style.opacity = '0';
  bottom.style.opacity = '1';
  bottom.style.transform = 'none';
  stage.appendChild(root);

  function draw() {
    if (destroyed) return;
    const phase = turnPhase(progress, forward);
    if (style === 'slide') {
      const frame = slideGeometry(width, height, progress, forward, side);
      shadow.className = 'reader-turn-dimmer';
      shadow.style.opacity = String(frame.shade);
      const piece = pieces[0];
      piece.element.style.transform = `translate3d(${frame.x}px,0,0)`;
      const corners = side === 1 ? `0 ${frame.radius}px ${frame.radius}px 0` : `${frame.radius}px 0 0 ${frame.radius}px`;
      piece.element.style.borderRadius = corners;
      piece.element.style.boxShadow = `${side * width * 0.014}px 0 ${width * 0.038}px var(--md-shadow-color-soft)`;
      piece.element.style.visibility = phase === 1 ? 'hidden' : 'visible';
      piece.shade.style.opacity = '0';
      return;
    }

    const geometry = curlGeometry(width, originY, phase, lift, side);
    if (!geometry) {
      pieces.forEach((piece, index) => {
        piece.element.style.visibility = index === 0 ? 'visible' : 'hidden';
        if (index === 0) {
          piece.element.style.transform = 'none';
          piece.element.style.clipPath = 'none';
          piece.copy.style.opacity = '1';
          piece.shade.style.opacity = '0';
        }
      });
      shadow.style.opacity = '0';
      return;
    }

    const count = pieces.length - 2;
    const circumference = Math.PI * geometry.radius;
    pieces.forEach((piece, index) => {
      const min = index === 0 ? -Infinity : index === count + 1 ? circumference : (index - 1) * circumference / count;
      const max = index === 0 ? 0 : index === count + 1 ? Infinity : index * circumference / count;
      const polygon = curlPolygon(width, height, geometry, min - 0.12, max + 0.12);
      piece.element.style.visibility = polygon.length >= 3 ? 'visible' : 'hidden';
      if (polygon.length < 3) return;
      const distance = index === 0 ? 0 : index === count + 1 ? circumference : (min + max) / 2;
      const frame = curlMatrix(geometry, distance);
      piece.element.style.clipPath = polygonStyle(polygon);
      piece.element.style.transform = `matrix(${frame.matrix.join(',')})`;
      piece.element.style.zIndex = String(Math.round(frame.height * 10));
      piece.copy.style.opacity = frame.back ? '0.19' : '1';
      piece.shade.style.opacity = String(frame.shade);
    });

    const boundary: TurnPoint[] = [];
    const steps = 16;
    const append = (x: number, y: number) => {
      const p = curlPoint({ x, y }, geometry);
      boundary.push({ x: p.x + p.z * 0.18, y: p.y + p.z * 0.12 });
    };
    for (let i = 0; i <= steps; i++) append(width * i / steps, 0);
    for (let i = 1; i <= steps; i++) append(width, height * i / steps);
    for (let i = steps - 1; i >= 0; i--) append(width * i / steps, height);
    for (let i = steps - 1; i >= 0; i--) append(0, height * i / steps);
    shadow.style.clipPath = polygonStyle(boundary);
    shadow.style.opacity = String(0.17 * Math.min(1, geometry.length / (width * 0.15)));
  }

  draw();

  function cancelAnimation() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    resolveAnimation?.(false);
    resolveAnimation = null;
  }

  return {
    move(dx, dy) {
      if (destroyed) return;
      cancelAnimation();
      const motion = forward ? -side : side;
      progress = clampTurnProgress(dx * motion / (width * (style === 'curl' ? 2.25 : 1)));
      lift = style === 'curl' ? Math.max(-height * 0.6 - originY, Math.min(height * 1.6 - originY, dy)) : 0;
      raf = requestAnimationFrame(() => { raf = 0; draw(); });
    },
    finish(commit) {
      if (destroyed) return Promise.resolve(false);
      cancelAnimation();
      const start = progress;
      const target = commit ? 1 : 0;
      const startLift = lift;
      const startPhase = turnPhase(start, forward);
      const amplitude = originY < height * 0.28 ? height * 0.34 : originY > height * 0.72 ? -height * 0.34 : height * 0.05;
      const duration = prefersReducedMotion() ? 0 : Math.max(100, (commit ? (style === 'curl' ? 600 : 380) : 220) * Math.sqrt(Math.abs(target - start)));
      const startedAt = performance.now();
      return new Promise<boolean>(resolve => {
        resolveAnimation = resolve;
        const tick = (now: number) => {
          if (destroyed) return;
          const t = duration ? clampTurnProgress((now - startedAt) / duration) : 1;
          const eased = t * t * (3 - 2 * t);
          progress = start + (target - start) * eased;
          const phase = turnPhase(progress, forward);
          lift = startLift * (1 - eased) + amplitude * (Math.sin(Math.PI * phase) - (1 - eased) * Math.sin(Math.PI * startPhase));
          draw();
          if (t < 1) raf = requestAnimationFrame(tick);
          else {
            raf = 0;
            resolveAnimation = null;
            resolve(true);
          }
        };
        raf = requestAnimationFrame(tick);
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimation();
      root.remove();
      outgoing.style.cssText = originalStyles[0];
      incoming.style.cssText = originalStyles[1];
    }
  };
}
