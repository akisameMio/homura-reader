/* ============================================================================
   HOMURA · 覆盖滑动 / 跟手卷页的纸面几何
   ----------------------------------------------------------------------------
   同一张纸只有一条展开 → 翻出的轨迹；上一页沿这条轨迹逆行。
   卷曲面按圆柱截面分片，用仿射矩阵变形真实 DOM，保留原始正文与图片。
   ========================================================================== */

export interface TurnPoint { x: number; y: number; }
export type TurnSide = 1 | -1;
export interface CurlGeometry {
  normal: TurnPoint;
  axis: TurnPoint;
  radius: number;
  length: number;
}
export type TurnMatrix = [number, number, number, number, number, number];

export function clampTurnProgress(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function turnPhase(progress: number, forward: boolean) {
  const value = clampTurnProgress(progress);
  return forward ? value : 1 - value;
}

export function slideGeometry(width: number, height: number, progress: number, forward: boolean, side: TurnSide) {
  const phase = turnPhase(progress, forward);
  return {
    phase,
    x: -side * width * phase,
    radius: Math.min(width * 0.15, height * 0.09) * Math.min(1, phase / 0.07),
    shade: 0.24 * (1 - phase)
  };
}

export function curlGeometry(width: number, originY: number, phase: number, lift: number, side: TurnSide): CurlGeometry | null {
  const corner = { x: side === 1 ? width : 0, y: originY };
  const finger = { x: corner.x - side * width * 2.25 * clampTurnProgress(phase), y: originY + lift };
  const dx = corner.x - finger.x;
  const dy = corner.y - finger.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.35) return null;
  const normal = { x: dx / length, y: dy / length };
  const radius = Math.max(0.04, Math.min(width * 0.075, length * 0.18));
  const distance = (length + Math.PI * radius) / 2;
  return { normal, axis: { x: corner.x - normal.x * distance, y: corner.y - normal.y * distance }, radius, length };
}

export function curlPoint(point: TurnPoint, geometry: CurlGeometry) {
  const { normal: n, axis, radius } = geometry;
  const distance = (point.x - axis.x) * n.x + (point.y - axis.y) * n.y;
  if (distance <= 0) return { ...point, z: 0 };
  const angle = Math.min(Math.PI, distance / radius);
  const projected = radius * Math.sin(angle) - Math.max(0, distance - Math.PI * radius);
  return {
    x: point.x + (projected - distance) * n.x,
    y: point.y + (projected - distance) * n.y,
    z: radius * (1 - Math.cos(angle))
  };
}

/** 128×1 渐变纹理沿卷轴缩放，避免每张纸面副本再生成一张整屏阴影纹理。 */
export function curlLighting(geometry: CurlGeometry, extent: number) {
  const { normal: n, axis, radius, length } = geometry;
  const strip = (start: number, width: number): TurnMatrix => [
    n.x * width / 128, n.y * width / 128, -n.y * extent * 2, n.x * extent * 2,
    axis.x + n.x * start + n.y * extent,
    axis.y + n.y * start - n.x * extent
  ];
  return {
    cast: strip(0, radius * 4),
    contact: strip(-radius * 2.4, radius * 2.4),
    surface: strip(0, Math.PI * radius),
    opacity: Math.min(1, length / (radius * 6))
  };
}

/** 裁剪源纸面到卷曲轴上的一段；裁剪发生在变形前，不会把正文重新排版。 */
export function curlPolygon(width: number, height: number, geometry: CurlGeometry, min: number, max: number): TurnPoint[] {
  const { normal: n, axis } = geometry;
  let polygon: TurnPoint[] = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const distance = (p: TurnPoint) => (p.x - axis.x) * n.x + (p.y - axis.y) * n.y;
  for (const [bound, lower] of [[min, true], [max, false]] as const) {
    if (!Number.isFinite(bound) || !polygon.length) continue;
    const next: TurnPoint[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const da = distance(a) - bound;
      const db = distance(b) - bound;
      const insideA = lower ? da >= 0 : da <= 0;
      const insideB = lower ? db >= 0 : db <= 0;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const ratio = da / (da - db);
        next.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
      }
    }
    polygon = next;
  }
  return polygon;
}

/** 在分片中心对曲面求切线；平面和纸背是精确矩阵，弯曲带细分后连续衔接。 */
export function curlMatrix(geometry: CurlGeometry, distance: number): { matrix: TurnMatrix; height: number; back: boolean; shade: number } {
  const { normal: n, axis, radius } = geometry;
  const angle = Math.max(0, Math.min(Math.PI, distance / radius));
  const k = Math.cos(angle);
  const projected = distance <= 0 ? distance : radius * Math.sin(angle) - Math.max(0, distance - Math.PI * radius);
  const shift = projected - k * distance - (k - 1) * (n.x * axis.x + n.y * axis.y);
  return {
    matrix: [1 + (k - 1) * n.x * n.x, (k - 1) * n.x * n.y, (k - 1) * n.x * n.y, 1 + (k - 1) * n.y * n.y, n.x * shift, n.y * shift],
    height: radius * (1 - k),
    back: angle > Math.PI / 2,
    shade: Math.sin(angle) * 0.22
  };
}

/** 固定大小的矩形裁剪窗：外层沿卷轴变形，内层逆变换，合成后仍是原纸面矩阵。 */
export function curlStripTransforms(geometry: CurlGeometry, polygon: TurnPoint[], distance: number, extent: number) {
  const { normal: n, axis } = geometry;
  const distances = polygon.map(p => (p.x - axis.x) * n.x + (p.y - axis.y) * n.y);
  const min = Math.min(...distances);
  const span = Math.max(0.0001, Math.max(...distances) - min);
  const scale = span / extent;
  const x = axis.x + n.x * min + n.y * extent;
  const y = axis.y + n.y * min - n.x * extent;
  const frame = curlMatrix(geometry, distance);
  const [a, b, c, d, e, f] = frame.matrix;
  const clip: TurnMatrix = [
    (a * n.x + c * n.y) * scale, (b * n.x + d * n.y) * scale,
    -a * n.y + c * n.x, -b * n.y + d * n.x,
    a * x + c * y + e, b * x + d * y + f
  ];
  const content: TurnMatrix = [
    n.x / scale, -n.y, n.y / scale, n.x,
    -(n.x * axis.x + n.y * axis.y + min) / scale,
    n.y * axis.x - n.x * axis.y + extent
  ];
  return { ...frame, clip, content };
}

export function pageTurnTarget(index: number, count: number, step: number, forward: boolean) {
  const target = Math.max(0, Math.min(count - 1, index + (forward ? step : -step)));
  return count > 0 && target !== index ? target : null;
}
