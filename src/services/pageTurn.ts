/* ============================================================================
   HOMURA · 真实纸面的覆盖滑动与跟手卷页
   ----------------------------------------------------------------------------
   直接变形双缓冲中的 DOM 副本，不截图、不重绘正文，不依赖额外渲染库。
   分片、动画、指针状态均由普通对象持有；取消时恢复两槽，调用方决定最终落页。
   ========================================================================== */

import { clampTurnProgress, curlGeometry, curlLighting, curlMatrix, curlPolygon, curlStripTransforms, slideGeometry, turnPhase, type TurnPoint, type TurnSide } from './pageTurnGeometry.ts';
import { prefersReducedMotion } from './spring.ts';
import type { ReaderFolio } from './readerLayout.ts';

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
  lowPower?: boolean;
  pageNumbers?: { label: HTMLElement; outgoing: ReaderFolio[]; incoming: ReaderFolio[]; total: number; showTotal: boolean; };
}
interface Piece { element: HTMLDivElement; surface: HTMLElement; copy: HTMLElement; back: HTMLDivElement; shade: HTMLDivElement; visible?: boolean; }

// Android 保留较少的固定纸面副本，避免卷页缓存占用过多显存。
const CURL_SEGMENTS = { default: 28, compact: 20, lowPower: 6 };

function polygonStyle(points: TurnPoint[]) {
  return `polygon(${points.map(p => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})`;
}

export function createPageTurn(options: PageTurnOptions): PageTurnController {
  const { stage, outgoing, incoming, style, forward, side } = options;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const stableCurl = style === 'curl' && !!options.lowPower;
  const clipExtent = Math.ceil(Math.hypot(width, height)) + 1;
  const originY = Math.max(0, Math.min(height, options.originY));
  const top = forward ? outgoing : incoming;
  const bottom = forward ? incoming : outgoing;
  const originalStyles = [outgoing.style.cssText, incoming.style.cssText];
  let destroyed = false;
  let progress = 0;
  let lift = 0;
  let raf = 0;
  let resolveAnimation: ((completed: boolean) => void) | null = null;

  // 页码属于各自纸面；预览和纸背都使用冻结的槽位页码，底栏继续负责交互。
  const folio = options.pageNumbers;
  const originalLabelOpacity = folio?.label.style.opacity ?? '';
  const pageNumbers: HTMLElement[] = [];
  if (folio) {
    const stageBounds = stage.getBoundingClientRect();
    const bounds = folio.label.getBoundingClientRect();
    const fontFamily = document.defaultView?.getComputedStyle(folio.label).fontFamily ?? '';
    for (const [paper, numbers] of [[outgoing, folio.outgoing], [incoming, folio.incoming]] as const) {
      const numberLayer = document.createElement('div');
      numberLayer.className = 'reader-turn-page-number';
      numberLayer.setAttribute('aria-hidden', 'true');
      Object.assign(numberLayer.style, { position: 'absolute', left: bounds.left - stageBounds.left + 'px', top: bounds.top - stageBounds.top + 'px', width: bounds.width + 'px', height: bounds.height + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily, whiteSpace: 'nowrap', pointerEvents: 'none' });
      for (const number of numbers) {
        const holder = document.createElement('div');
        holder.className = `md-reader-footer-folio is-${number.position}`;
        holder.dataset.readerFolio = number.position;
        const label = document.createElement('span');
        label.className = 'md-reader-footer-page-label';
        label.textContent = folio.showTotal ? `${number.pageNumber}/${folio.total}页` : `${number.pageNumber}页`;
        holder.appendChild(label);
        numberLayer.appendChild(holder);
      }
      paper.appendChild(numberLayer);
      pageNumbers.push(numberLayer);
    }
    folio.label.style.opacity = '0';
  }

  const root = document.createElement('div');
  root.className = 'reader-paper-turn';
  if (stableCurl) root.classList.add('reader-paper-turn-stable');
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  root.style.setProperty('--turn-width', width + 'px');
  root.style.setProperty('--turn-height', height + 'px');
  root.style.setProperty('--turn-clip-extent', clipExtent + 'px');
  const shadow = document.createElement('div');
  shadow.className = 'reader-turn-shadow';
  root.appendChild(shadow);
  const contact = document.createElement('div');
  contact.className = 'reader-turn-contact';
  if (style === 'curl') root.appendChild(contact);

  function makePiece(): Piece {
    const element = document.createElement('div');
    element.className = 'reader-turn-piece';
    const copy = top.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.classList.add('reader-turn-copy');
    Object.assign(copy.style, { position: 'absolute', inset: 'auto', left: '0', top: '0', width: width + 'px', height: height + 'px', opacity: '1', transform: 'none', zIndex: 'auto', clipPath: 'none', borderRadius: '0', boxShadow: 'none' });
    const back = document.createElement('div');
    back.className = 'reader-turn-back';
    const shade = document.createElement('div');
    shade.className = 'reader-turn-shade';
    const surface = stableCurl ? document.createElement('div') : element;
    if (stableCurl) {
      surface.className = 'reader-turn-surface';
      element.appendChild(surface);
    }
    surface.append(copy, back, shade);
    root.appendChild(element);
    return { element, surface, copy, back, shade };
  }

  const segments = options.lowPower ? CURL_SEGMENTS.lowPower : options.compact ? CURL_SEGMENTS.compact : CURL_SEGMENTS.default;
  const pieces = Array.from({ length: style === 'curl' ? segments + 2 : 1 }, makePiece);
  pieces.forEach((piece, index) => { piece.element.style.zIndex = String(index + 1); });
  outgoing.style.opacity = '0';
  incoming.style.opacity = '0';
  bottom.style.opacity = '1';
  bottom.style.transform = 'none';
  stage.appendChild(root);

  // 每帧都改 visibility 会让 WebView 反复销毁 / 重建图层，只在状态真变时写样式。
  function setVisibility(piece: Piece, visible: boolean) {
    if (piece.visible === visible) return;
    piece.visible = visible;
    if (stableCurl) piece.element.style.opacity = visible ? '1' : '0';
    else piece.element.style.visibility = visible ? 'visible' : 'hidden';
  }

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
      setVisibility(piece, phase !== 1);
      piece.shade.style.opacity = '0';
      return;
    }

    const geometry = curlGeometry(width, originY, phase, lift, side);
    if (!geometry) {
      pieces.forEach((piece, index) => {
        setVisibility(piece, index === 0);
        if (index === 0) {
          piece.element.style.transform = 'none';
          if (stableCurl) piece.surface.style.transform = 'none';
          else {
            piece.element.style.clipPath = 'none';
            piece.element.style.width = width + 'px';
            piece.element.style.height = height + 'px';
            piece.copy.style.left = '0';
            piece.copy.style.top = '0';
          }
          piece.back.style.display = 'none';
          piece.shade.style.opacity = '0';
        }
      });
      shadow.style.opacity = '0';
      contact.style.opacity = '0';
      return;
    }

    const count = pieces.length - 2;
    const circumference = Math.PI * geometry.radius;
    const lighting = curlLighting(geometry, clipExtent);
    shadow.style.transform = `matrix(${lighting.cast.join(',')})`;
    contact.style.transform = `matrix(${lighting.contact.join(',')})`;
    shadow.style.opacity = String(lighting.opacity * 0.48);
    contact.style.opacity = String(lighting.opacity * 0.38);
    pieces.forEach((piece, index) => {
      const min = index === 0 ? -Infinity : index === count + 1 ? circumference : (index - 1) * circumference / count;
      const max = index === 0 ? 0 : index === count + 1 ? Infinity : index * circumference / count;
      const polygon = curlPolygon(width, height, geometry, min - 0.12, max + 0.12);
      setVisibility(piece, polygon.length >= 3);
      if (polygon.length < 3) return;
      const distance = index === 0 ? 0 : index === count + 1 ? circumference : (min + max) / 2;
      if (stableCurl) {
        // Android 不逐帧改 clip-path / 宽高 / 正文位置，避免裁剪纹理持续失效。
        // 固定矩形窗口和纸面互相抵消卷轴旋转，只把裁剪结果交给合成器。
        const frame = curlStripTransforms(geometry, polygon, distance, clipExtent);
        piece.element.style.transform = `matrix(${frame.clip.join(',')})`;
        piece.surface.style.transform = `matrix(${frame.content.join(',')})`;
        piece.back.style.display = frame.back ? 'block' : 'none';
        piece.shade.style.transform = `matrix(${lighting.surface.join(',')})`;
        piece.shade.style.opacity = '1';
        return;
      }
      const frame = curlMatrix(geometry, distance);
      // clip-path 不会缩小合成纹理；用源分片的包围盒作为真实图层尺寸，
      // 正文仍保留整屏排版，偏移副本并补偿矩阵平移，保证纸面位置不变。
      const x = Math.floor(Math.min(...polygon.map(p => p.x)));
      const y = Math.floor(Math.min(...polygon.map(p => p.y)));
      const right = Math.ceil(Math.max(...polygon.map(p => p.x)));
      const bottom = Math.ceil(Math.max(...polygon.map(p => p.y)));
      piece.element.style.width = right - x + 'px';
      piece.element.style.height = bottom - y + 'px';
      piece.copy.style.left = -x + 'px';
      piece.copy.style.top = -y + 'px';
      piece.element.style.clipPath = polygonStyle(polygon.map(p => ({ x: p.x - x, y: p.y - y })));
      const [a, b, c, d, e, f] = frame.matrix;
      piece.element.style.transform = `matrix(${[a, b, c, d, e + a * x + c * y, f + b * x + d * y].join(',')})`;
      // 用纸色覆盖出背面透字，避免整屏副本的 opacity 再生成离屏合成层。
      piece.back.style.display = frame.back ? 'block' : 'none';
      const shadeMatrix = [...lighting.surface];
      shadeMatrix[4] -= x;
      shadeMatrix[5] -= y;
      piece.shade.style.transform = `matrix(${shadeMatrix.join(',')})`;
      piece.shade.style.opacity = '1';
    });
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
      pageNumbers.forEach(label => label.remove());
      if (folio) folio.label.style.opacity = originalLabelOpacity;
      outgoing.style.cssText = originalStyles[0];
      incoming.style.cssText = originalStyles[1];
    }
  };
}
