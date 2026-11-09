/* ============================================================================
   HOMURA · 书架 → 阅读器 共享元素转场
   ----------------------------------------------------------------------------
   点击书封时抛出一个飞行封面副本，从卡片位置放大到加载页封面位置，
   给"封面卡展开为全屏加载页"一个自然的连续感。

   动画采用弹簧物理（半隐式欧拉积分，ζ=1 临界阻尼，无过冲）驱动，
   逐帧补间副本的 left/top/width/height/opacity，落点处彻底淡出交给加载页封面。

   约束：
   - 只做颜色 / 位移 / 尺寸 / 圆角补间，不碰布局属性之外的响应式状态；
   - 动画状态用普通局部变量持有，绝不进 Vue 深层代理（AGENTS.md 第 4/14 条）；
   - 尊重 prefers-reduced-motion：不播动画，直接返回，由加载页自己淡入；
   - 不依赖任何 store，纯 DOM 操作，services 层允许触碰 DOM（如 PDF/canvas）。
   ========================================================================== */

import { makeAxis, runSpring, prefersReducedMotion } from './spring.ts';

export interface CoverRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SplashOptions {
  rect: CoverRect;
  cover: string;
  title?: string;
  duration?: number;
}

// 加载页居中封面的稳定宽度（与 ReaderLoadingPage 的 .rlp-cover 宽度一致）
const TARGET_COVER_WIDTH = 128;
const COVER_RATIO = 4 / 3;
// 弹簧刚度：越大越快、越"急"。ζ=1 临界阻尼下，90 的刚度飞行约 0.65s，
// 起步柔和、匀速感更好；150 会显得太冲。觉得还不够从容可继续降到 70。
const SPLASH_STIFFNESS = 120;

/**
 * 播放飞行封面。返回的对象可用来取消动画（例如立刻被返回手势打断）。
 * 若环境不支持或用户要求减少动效，则静默不做。
 */
export function playShelfToReaderSplash({ rect, cover }: SplashOptions) {
  if (typeof document === 'undefined') return null;
  if (prefersReducedMotion() || typeof window === 'undefined' || !window.requestAnimationFrame) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const targetW = Math.min(TARGET_COVER_WIDTH, vw * 0.42);
  const targetH = targetW * COVER_RATIO;
  const targetLeft = (vw - targetW) / 2;
  const targetTop = (vh - targetH) / 2;

  const node = document.createElement('div');
  node.className = 'md-shelf-splash-cover';
  if (cover) {
    const img = document.createElement('img');
    img.src = cover;
    img.alt = '';
    img.draggable = false;
    node.appendChild(img);
  }
  node.style.cssText = [
    'position:fixed', 'z-index:52', 'pointer-events:none',
    'overflow:hidden', 'will-change:left,top,width,height,opacity',
    'background:var(--md-surface-high)',
    `left:${rect.left}px`, `top:${rect.top}px`,
    `width:${rect.width}px`, `height:${rect.height}px`,
    'border-radius:12px',
    'box-shadow:var(--md-shadow-color-soft) 0 10px 30px'
  ].join(';');
  document.body.appendChild(node);

  // 几何轴：起点 = 卡片矩形，终点 = 居中封面矩形。opacity: 1 → 0（落点彻底淡出）。
  const axL = makeAxis(rect.left, SPLASH_STIFFNESS);
  const axT = makeAxis(rect.top, SPLASH_STIFFNESS);
  const axW = makeAxis(rect.width, SPLASH_STIFFNESS);
  const axH = makeAxis(rect.height, SPLASH_STIFFNESS);
  const axO = makeAxis(1, SPLASH_STIFFNESS);
  axL.target = targetLeft;
  axT.target = targetTop;
  axW.target = targetW;
  axH.target = targetH;
  axO.target = 0;
  const axes = [axL, axT, axW, axH, axO];

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    node.remove();
  };

  const apply = () => {
    node.style.left = axL.pos.toFixed(2) + 'px';
    node.style.top = axT.pos.toFixed(2) + 'px';
    node.style.width = axW.pos.toFixed(2) + 'px';
    node.style.height = axH.pos.toFixed(2) + 'px';
    node.style.opacity = Math.max(0, axO.pos).toFixed(3);
  };

  // 收敛判定以 opacity 为主：副本一旦接近全透明就看不见了，几何差几像素无所谓，
  // 加载页居中封面已在它身后（z-55）就位接棒。若等几何轴完全对齐，临界阻尼尾部
  // 会拖到 ~0.85s，且尾段完全不可见——浪费。所以用 runSpring 跑，但 done 由 opacity 触发。
  // 注意：收尾时不 snap 几何（否则落点处会半透明副本闪一下），直接按当前帧移除。
  const cancelSpring = runSpring(
    axes,
    apply,
    cleanup,
    { damping: 1, posEpsilon: 0.5, velEpsilon: 2, stopWhen: () => axO.pos < 0.06 }
  );
  // 兜底：极端情况下弹簧迟迟不收敛也强制清掉
  const guard = window.setTimeout(cleanup, 1400);

  return {
    cancel() {
      try { cancelSpring(); } catch { /* 忽略 */ }
      window.clearTimeout(guard);
      cleanup();
    }
  };
}
