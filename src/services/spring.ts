/* ============================================================================
   HOMURA · 轻量弹簧补间
   ----------------------------------------------------------------------------
   半隐式欧拉积分的物理弹簧：a = -k·x - c·v，阻尼 c = 2ζ√k。
   默认 ζ = 1（临界阻尼）：无过冲、最快回到目标值，适合「飞入 / 展开消散」这类
   需要干净收束且不带 Q 弹的转场。

   约定：
   - 纯数值补间，不依赖 Vue / Pinia；由调用方在 rAF 里改 DOM style；
   - 回调 getSettled() 判定是否停下，停下时把值钉到 target，避免浮点长尾；
   - 尊重 prefers-reduced-motion：调用方应自行判断并跳过（本模块只负责算数）。
   ========================================================================== */

export interface SpringAxis {
  pos: number;
  vel: number;
  target: number;
  stiffness: number;
}

export interface SpringOptions {
  /** 弹簧刚度 k，越大越快。默认 120。 */
  stiffness?: number;
  /** 阻尼比 ζ，1 = 临界阻尼（无过冲）。默认 1。 */
  damping?: number;
  /** 每次积分的最大时间步（秒），防止切后台回来后大步长炸开。默认 0.032。 */
  maxDt?: number;
  /** 位置收敛阈值，默认 0.002。 */
  posEpsilon?: number;
  /** 速度收敛阈值，默认 0.02。 */
  velEpsilon?: number;
  /** 额外的提前停止条件：返回 true 时立即收尾（优先于收敛判定）。 */
  stopWhen?: () => boolean;
}

export function makeAxis(initial: number, stiffness: number): SpringAxis {
  return { pos: initial, vel: 0, target: initial, stiffness };
}

/** 对所有轴做一次半隐式欧拉子步积分（内部再分两半，精度更高）。 */
export function stepAxes(axes: SpringAxis[], dt: number, damping = 1): void {
  const h = dt * 0.5;
  for (const s of axes) {
    const k = s.stiffness;
    const c = 2 * damping * Math.sqrt(k);
    for (let i = 0; i < 2; i++) {
      const disp = s.pos - s.target;
      const acc = -k * disp - c * s.vel;
      s.vel += acc * h;
      s.pos += s.vel * h;
    }
  }
}

/** 是否所有轴都已收敛。 */
export function axesSettled(axes: SpringAxis[], posEps = 0.002, velEps = 0.02): boolean {
  return axes.every(s => Math.abs(s.vel) < velEps && Math.abs(s.pos - s.target) < posEps);
}

/** 把所有轴钉到目标值并清零速度。 */
export function snapAxes(axes: SpringAxis[]): void {
  for (const s of axes) {
    s.pos = s.target;
    s.vel = 0;
  }
}

/**
 * 通用弹簧驱动：从各轴当前 pos 出发，跑到 converges 后回调 done。
 * 返回一个取消函数。调用方负责在每帧 onStep 里读取 axes[].pos 写 DOM。
 */
export function runSpring(
  axes: SpringAxis[],
  onStep: () => void,
  done: () => void,
  opts: SpringOptions = {}
): () => void {
  const damping = opts.damping ?? 1;
  const maxDt = opts.maxDt ?? 0.032;
  const posEps = opts.posEpsilon ?? 0.002;
  const velEps = opts.velEpsilon ?? 0.02;
  let raf = 0;
  let lastT = performance.now();
  let cancelled = false;

  const tick = (now: number) => {
    if (cancelled) return;
    const dt = Math.min((now - lastT) / 1000, maxDt);
    lastT = now;
    stepAxes(axes, dt, damping);
    onStep();
    if ((opts.stopWhen && opts.stopWhen()) || axesSettled(axes, posEps, velEps)) {
      snapAxes(axes);
      onStep();
      raf = 0;
      done();
    } else {
      raf = requestAnimationFrame(tick);
    }
  };
  raf = requestAnimationFrame(tick);

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
