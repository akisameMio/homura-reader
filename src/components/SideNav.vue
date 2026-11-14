<template>
  <!-- 桌面：浮动圆角侧栏，可在「图标 + 文字」与折叠窄栏之间切换 -->
  <aside
    v-if="!isCompact"
    class="sidenav"
    :class="{ 'is-collapsed': collapsed }"
  >
    <div class="sidenav-head">
      <button
        type="button"
        class="sidenav-icon-btn"
        :title="collapsed ? t('展开侧栏') : t('折叠侧栏')"
        :aria-label="collapsed ? t('展开侧栏') : t('折叠侧栏')"
        :aria-expanded="!collapsed"
        @click="toggleSidebar"
      >
        <MdIcon :name="collapsed ? 'menu' : 'menu_open'" />
      </button>

      <button
        type="button"
        class="sidenav-avatar"
        :title="t('HOMURA · 返回主页')"
        :aria-label="t('HOMURA，返回主页')"
        @click="select('shelf')"
      >
        <img :src="logoUrl" alt="" draggable="false" />
      </button>
    </div>

    <nav ref="desktopNavRef" class="sidenav-list" :aria-label="t('主导航')">
      <span
        class="sidenav-indicator"
        :class="{ 'is-ready': desktopReady }"
        :style="{ transform: `translate3d(0, ${desktopIndicatorY}px, 0)` }"
        aria-hidden="true"
      ></span>
      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="sidenav-item"
        :class="{ 'is-active': active === item.key }"
        :title="t(item.label)"
        :aria-current="active === item.key ? 'page' : undefined"
        @click="select(item.key)"
      >
        <MdIcon :name="item.icon" :filled="active === item.key" />
        <span class="sidenav-label sidenav-label-wide">{{ t(item.label) }}</span>
        <span class="sidenav-label sidenav-label-compact" aria-hidden="true">{{ t(item.label) }}</span>
      </button>
    </nav>

  </aside>

  <!-- 手机：悬浮胶囊底栏 -->
  <Teleport v-else to="#homura-mobile-nav-root">
    <nav
      ref="mobileNavRef"
      class="mobile-nav"
      :aria-label="t('主导航')"
      @pointerdown="onMobilePointerDown"
    >
      <span
        class="mobile-nav-indicator"
        :class="{ 'is-ready': mobileReady, 'is-pressed': indicatorPressed, 'is-dragging': indicatorDragging }"
        :style="{ transform: mobileIndicatorTransform }"
        aria-hidden="true"
      ></span>
      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="mobile-nav-item"
        :class="{ 'is-active': active === item.key }"
        :title="t(item.label)"
        :aria-current="active === item.key ? 'page' : undefined"
        @click="select(item.key)"
      >
        <MdIcon :name="item.icon" :filled="active === item.key" />
        <span>{{ t(item.label) }}</span>
      </button>
    </nav>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useViewport } from '../composables/useViewport.ts';
import MdIcon from './MdIcon.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const SIDEBAR_STORAGE_KEY = 'homura_sidenav_collapsed';

const { isCompact } = useViewport();
const props = defineProps({
  active: { type: String, default: 'shelf' }
});
const emit = defineEmits(['nav']);

const logoUrl = import.meta.env.BASE_URL + 'splash-icon.png';

// 记住上次的展开/折叠选择，第一次使用默认展开。
function readCollapsed() {
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch (e) {}
  return false;
}

const collapsed = ref(readCollapsed());

const desktopNavRef = ref<HTMLElement | null>(null);
const mobileNavRef = ref<HTMLElement | null>(null);
const desktopReady = ref(false);
const mobileReady = ref(false);
const desktopIndicatorY = ref(0);
const indicatorDragging = ref(false);
const indicatorPressed = ref(false);
const mobileIndicatorTransform = ref('translate3d(0, 4px, 0)');

let measureFrame = 0;

// ---------------- 手机底栏：Q 弹欠阻尼弹簧引擎 ----------------
// 半隐式欧拉积分：a = -k·x - c·v，c = 2ζ√k。ζ=1（临界阻尼，无过冲，最快回正）。
const MOBILE_DAMPING = 1.0; // ζ
const MOBILE_STIFF = 46; // 基础刚度 k
const NAV_SCALE = 1.04; // 交互态导航栏放大倍数（与 .is-interacting 的 transform 一致）
const MOBILE_PILL_W = 82; // 指示器胶囊宽度

const springs = {
  x: { pos: 0, vel: 0, target: 0, stiffness: 90 },
  sx: { pos: 1, vel: 0, target: 1, stiffness: 42 },
  sy: { pos: 1, vel: 0, target: 1, stiffness: 42 }
};

let metrics = { tabCenters: [] as number[], minX: 0, maxX: 0, step: 1 };
let mobileActiveIndex = 0;
let springRaf = 0;
let springLastT = 0;

function measureMobileMetrics() {
  const nav = mobileNavRef.value;
  if (!nav) return;
  const items = Array.from(nav.querySelectorAll<HTMLElement>('.mobile-nav-item'));
  if (!items.length) return;
  const centers = items.map((it) => it.offsetLeft + (it.offsetWidth - MOBILE_PILL_W) / 2);
  metrics = {
    tabCenters: centers,
    minX: centers[0],
    maxX: centers[centers.length - 1],
    step: centers.length > 1 ? centers[1] - centers[0] : 1
  };
}

function springStep(s: { pos: number; vel: number; target: number; stiffness: number }, dt: number) {
  const k = s.stiffness;
  const c = 2 * MOBILE_DAMPING * Math.sqrt(k);
  const h = dt * 0.5;
  for (let i = 0; i < 2; i++) {
    const disp = s.pos - s.target;
    const acc = -k * disp - c * s.vel;
    s.vel += acc * h;
    s.pos += s.vel * h;
  }
}

function renderMobileIndicator() {
  const x = springs.x.pos;
  const scaleX = springs.sx.pos;
  const scaleY = springs.sy.pos;
  const speed = Math.min(Math.abs(springs.x.vel) / 300, 1);
  const stretchX = scaleX + speed * 0.3;
  const squashY = scaleY - speed * 0.16;
  // 拖拽态：气泡随挤压量上浮，探出导航栏上沿
  const rise = indicatorDragging.value ? -Math.max(0, squashY - 1) * 52 : 0;
  mobileIndicatorTransform.value =
    `translate3d(${x.toFixed(2)}px, ${(4 + rise).toFixed(2)}px, 0) scale(${stretchX.toFixed(4)}, ${squashY.toFixed(4)})`;
}

function startSpringLoop() {
  if (springRaf) return;
  springLastT = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - springLastT) / 1000, 0.032);
    springLastT = now;
    springStep(springs.x, dt);
    springStep(springs.sx, dt);
    springStep(springs.sy, dt);
    renderMobileIndicator();
    const settled =
      Math.abs(springs.x.vel) < 0.5 && Math.abs(springs.x.pos - springs.x.target) < 0.1 &&
      Math.abs(springs.sx.vel) < 0.01 && Math.abs(springs.sx.pos - springs.sx.target) < 0.002 &&
      Math.abs(springs.sy.vel) < 0.01 && Math.abs(springs.sy.pos - springs.sy.target) < 0.002;
    if (settled) {
      springs.x.pos = springs.x.target; springs.x.vel = 0;
      springs.sx.pos = springs.sx.target; springs.sx.vel = 0;
      springs.sy.pos = springs.sy.target; springs.sy.vel = 0;
      renderMobileIndicator();
      springRaf = 0;
    } else {
      springRaf = requestAnimationFrame(tick);
    }
  };
  springRaf = requestAnimationFrame(tick);
}

function vibrateMobile(ms: number) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}

function mobileNearestIndexAt(x: number) {
  let best = 0;
  let bd = Infinity;
  metrics.tabCenters.forEach((c, i) => {
    const d = Math.abs(c - x);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function mobileSnapTo(i: number, mode: 'snap' | 'click') {
  mobileActiveIndex = i;
  springs.x.stiffness = Math.max(70, MOBILE_STIFF * 2.1);
  springs.sx.stiffness = MOBILE_STIFF;
  springs.sy.stiffness = MOBILE_STIFF;
  if (mode === 'snap') {
    springs.x.vel += mobileDrag.vx * 380; // 惯性吸附
    springs.sx.vel -= 1.0; springs.sy.vel -= 1.0;
  } else {
    springs.sx.vel += 1.6; springs.sy.vel += 1.6;
  }
  springs.x.target = metrics.tabCenters[i];
  springs.sx.target = 1.0; springs.sy.target = 1.0;
  startSpringLoop();
}

const mobileDrag = {
  down: false, dragging: false, pid: -1,
  startX: 0, startIndicatorX: 0, lastX: 0, lastT: 0, vx: 0
};
// 轻点（按下到抬起常不足 100ms）也要让玻璃气泡亮一下，否则实机只看到一闪而过或干脆没有。
const PRESS_MIN_VISIBLE_MS = 180;
let pressStartedAt = 0;
let pressReleaseTimer: ReturnType<typeof setTimeout> | null = null;

function onMobilePointerDown(e: PointerEvent) {
  if (e.button !== undefined && e.button !== 0) return;
  measureMobileMetrics();
  if (!metrics.tabCenters.length) return;
  if (pressReleaseTimer) { clearTimeout(pressReleaseTimer); pressReleaseTimer = null; }
  pressStartedAt = performance.now();
  mobileDrag.down = true;
  mobileDrag.dragging = false;
  indicatorDragging.value = false;
  mobileDrag.pid = e.pointerId;
  mobileDrag.startX = e.clientX;
  mobileDrag.lastX = e.clientX;
  mobileDrag.lastT = performance.now();
  mobileDrag.vx = 0;
  mobileDrag.startIndicatorX = springs.x.pos;
  indicatorPressed.value = true; // 一按下就切中性玻璃，无需拖动
  // 立即同步一次 transform：清掉上一次拖拽留下的上浮位移，气泡从贴合槽位的位置开始膨胀
  renderMobileIndicator();
  mobileNavRef.value?.classList.add('is-interacting');
  // 按下即膨胀：点击与拖动都从第一帧开始鼓起来，不再等长按
  springs.sx.stiffness = 120; springs.sy.stiffness = 120;
  springs.sx.target = 1.12; springs.sy.target = 1.28;
  springs.sx.vel += 3.2; springs.sy.vel += 3.6;
  vibrateMobile(12); // 落到槽位上的触感
  try { mobileNavRef.value?.setPointerCapture(e.pointerId); } catch (err) {}
  window.addEventListener('pointermove', onMobilePointerMove);
  window.addEventListener('pointerup', onMobilePointerUp);
  window.addEventListener('pointercancel', onMobilePointerUp);
  startSpringLoop();
}

function onMobilePointerMove(e: PointerEvent) {
  if (!mobileDrag.down || e.pointerId !== mobileDrag.pid) return;
  const dx = e.clientX - mobileDrag.startX;
  const now = performance.now();
  const dt = now - mobileDrag.lastT;
  if (!mobileDrag.dragging && Math.abs(dx) > 4) {
    mobileDrag.dragging = true;
    indicatorDragging.value = true; // 进入拖拽：气泡上浮溢出导航栏
    springs.x.stiffness = 160;
    springs.sx.stiffness = 46;
    springs.sy.stiffness = 46;
  }
  if (!mobileDrag.dragging) return;
  if (dt > 0) {
    const iv = (e.clientX - mobileDrag.lastX) / dt;
    mobileDrag.vx = mobileDrag.vx * 0.65 + iv * 0.35;
    mobileDrag.lastX = e.clientX;
    mobileDrag.lastT = now;
  }
  const rawX = mobileDrag.startIndicatorX + dx / NAV_SCALE;
  const clampedX = Math.max(metrics.minX, Math.min(metrics.maxX, rawX));
  springs.x.target = clampedX;
  // 槽位之间：横向鼓起
  const progress = (clampedX - metrics.minX) / metrics.step;
  const dist = Math.abs(progress - Math.round(progress));
  const bulge = Math.sin(dist * Math.PI);
  springs.sx.target = 1.12 + bulge * 0.12;
  springs.sy.target = 1.3 - bulge * 0.08;
  // 每拖过一个槽位震一下
  const nearest = mobileNearestIndexAt(clampedX);
  if (nearest !== mobileActiveIndex) {
    vibrateMobile(9);
    mobileActiveIndex = nearest;
  }
  startSpringLoop();
}

function onMobilePointerUp(e: PointerEvent) {
  if (!mobileDrag.down || e.pointerId !== mobileDrag.pid) return;
  mobileDrag.down = false;
  indicatorDragging.value = false;
  // 松手恢复主题色；轻点时延后到最短可见时长，避免玻璃来不及出现就被收回
  const remain = PRESS_MIN_VISIBLE_MS - (performance.now() - pressStartedAt);
  if (pressReleaseTimer) { clearTimeout(pressReleaseTimer); pressReleaseTimer = null; }
  if (remain > 0) {
    pressReleaseTimer = setTimeout(() => {
      indicatorPressed.value = false;
      pressReleaseTimer = null;
    }, remain);
  } else {
    indicatorPressed.value = false;
  }
  const nav = mobileNavRef.value;
  try { if (nav?.hasPointerCapture(e.pointerId)) nav.releasePointerCapture(e.pointerId); } catch (err) {}
  window.removeEventListener('pointermove', onMobilePointerMove);
  window.removeEventListener('pointerup', onMobilePointerUp);
  window.removeEventListener('pointercancel', onMobilePointerUp);
  if (!mobileDrag.dragging) {
    // 轻点：按点击位置落槽
    const navRect = nav?.getBoundingClientRect();
    if (navRect) {
      const ratio = (e.clientX - navRect.left) / navRect.width;
      const idx = Math.max(0, Math.min(metrics.tabCenters.length - 1, Math.floor(ratio * metrics.tabCenters.length)));
      mobileSnapTo(idx, 'click');
    }
  } else {
    const projected = springs.x.pos + mobileDrag.vx * 105;
    const targetIndex = e.type === 'pointerup'
      ? mobileNearestIndexAt(Math.max(metrics.minX, Math.min(metrics.maxX, projected)))
      : Math.max(0, navItems.findIndex((item) => item.key === props.active));
    mobileSnapTo(targetIndex, 'snap');
    // 拖拽果冻到新槽位时同步切换导航项；否则胶囊会停在新位置，图标仍保留旧选中态。
    if (e.type === 'pointerup') select(navItems[targetIndex].key);
  }
  mobileDrag.dragging = false;
  setTimeout(() => nav?.classList.remove('is-interacting'), 120);
}

function measureIndicators() {
  const desktopActive = desktopNavRef.value?.querySelector<HTMLElement>('.sidenav-item.is-active');
  if (desktopActive) {
    desktopIndicatorY.value = desktopActive.offsetTop;
    if (!desktopReady.value) {
      requestAnimationFrame(() => {
        desktopReady.value = true;
      });
    }
  }

  // 手机：量槽位并让指示器弹簧对准当前激活项
  measureMobileMetrics();
  if (metrics.tabCenters.length) {
    const activeKey = props.active;
    const idx = Math.max(0, navItems.findIndex((it) => it.key === activeKey));
    const target = metrics.tabCenters[idx];
    if (!mobileReady.value) {
      springs.x.pos = springs.x.target = target;
      mobileActiveIndex = idx;
      renderMobileIndicator();
      requestAnimationFrame(() => {
        mobileReady.value = true;
      });
    } else if (!mobileDrag.dragging) {
      springs.x.target = target;
      startSpringLoop();
    }
  }
}

function scheduleMeasure() {
  cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(measureIndicators);
}

function toggleSidebar() {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed.value ? '1' : '0');
  } catch (e) {}
}

const navItems = [
  { key: 'shelf', label: '书架', icon: 'local_library' },
  { key: 'recent', label: '最近', icon: 'history' },
  { key: 'favorite', label: '收藏', icon: 'star' },
  { key: 'settings', label: '设置', icon: 'settings' }
];

function select(key: string) {
  emit('nav', key);
}

watch(() => props.active, () => nextTick(measureIndicators));
watch(collapsed, () => nextTick(scheduleMeasure));
watch(isCompact, () => nextTick(scheduleMeasure));

onMounted(() => {
  measureIndicators();
  window.addEventListener('resize', scheduleMeasure);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleMeasure);
  cancelAnimationFrame(measureFrame);
  cancelAnimationFrame(springRaf);
  springRaf = 0;
  if (pressReleaseTimer) clearTimeout(pressReleaseTimer);
  window.removeEventListener('pointermove', onMobilePointerMove);
  window.removeEventListener('pointerup', onMobilePointerUp);
  window.removeEventListener('pointercancel', onMobilePointerUp);
});
</script>

<style scoped>
  /* ---------------- 桌面：浮动侧栏 ---------------- */
  .sidenav {
    position: sticky;
    top: 16px;
    z-index: 30;
    flex: 0 0 220px;
    width: 220px;
    margin: 16px;
    height: calc(100vh - 32px);
    height: calc(100dvh - 32px);
    padding: 12px;
    display: flex;
    flex-direction: column;
    border-radius: 28px;
    background: var(--md-surface-low);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--md-outline-variant) 56%, transparent),
      0 14px 34px -20px color-mix(in oklab, var(--md-shadow-color-soft) 55%, transparent);
    transition:
      flex-basis 280ms cubic-bezier(0.2, 0, 0, 1),
      width 280ms cubic-bezier(0.2, 0, 0, 1),
      padding 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav.is-collapsed {
    flex-basis: 104px;
    width: 104px;
    padding: 12px 8px;
    align-items: center;
  }

  .sidenav-head {
    position: relative;
    flex: 0 0 auto;
    width: 100%;
    height: 68px;
    transition: height 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav.is-collapsed .sidenav-head {
    height: 118px;
  }

  .sidenav-icon-btn,
  .sidenav-avatar {
    position: absolute;
    top: 4px;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    color: var(--md-on-surface);
    transition:
      background-color 200ms cubic-bezier(0.2, 0, 0, 1),
      transform 280ms cubic-bezier(0.2, 0, 0, 1),
      top 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav-icon-btn {
    left: 6px;
    border-radius: 999px;
  }

  .sidenav-avatar {
    left: calc(50% - 24px);
    width: 48px;
    height: 48px;
    border-radius: 16px;
  }

  .sidenav.is-collapsed .sidenav-icon-btn {
    transform: translateX(16px);
  }

  .sidenav.is-collapsed .sidenav-avatar {
    top: 62px;
  }

  .sidenav-icon-btn svg {
    width: 24px;
    height: 24px;
  }

  .sidenav-icon-btn:hover {
    background: color-mix(in oklab, var(--md-surface-low) 65%, transparent);
  }

  .sidenav-avatar {
    overflow: hidden;
  }

  .sidenav-avatar img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .sidenav-list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
  }

  .sidenav-indicator {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 0;
    width: 100%;
    height: 56px;
    border-radius: 30px;
    background: var(--md-secondary-container);
    opacity: 0;
    pointer-events: none;
  }

  .sidenav-indicator.is-ready {
    opacity: 1;
    transition:
      transform 300ms cubic-bezier(0.2, 0, 0, 1),
      opacity 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav-item {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 56px;
    border-radius: 30px;
    background: transparent;
    font-weight: 600;
    color: var(--md-on-surface);
    transition:
      background-color 200ms cubic-bezier(0.2, 0, 0, 1),
      color 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav-item svg {
    position: absolute;
    top: calc(50% - 10px);
    left: 17px;
    width: 20px;
    height: 20px;
    transition:
      top 280ms cubic-bezier(0.2, 0, 0, 1),
      left 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav-label {
    position: absolute;
    line-height: 1.2;
    white-space: nowrap;
  }

  .sidenav-label-wide {
    top: 50%;
    left: 54px;
    transform: translateY(-50%);
    font-size: 13px;
    opacity: 1;
    transition: opacity 100ms cubic-bezier(0.2, 0, 0, 1) 40ms;
  }

  .sidenav-label-compact {
    top: 35px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    opacity: 0;
    transition: opacity 80ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav.is-collapsed .sidenav-label-wide {
    opacity: 0;
    transition: opacity 80ms cubic-bezier(0.2, 0, 0, 1);
  }

  .sidenav.is-collapsed .sidenav-label-compact {
    opacity: 1;
    transition: opacity 100ms cubic-bezier(0.2, 0, 0, 1) 40ms;
  }

  @media (hover: hover) and (pointer: fine) {
    .sidenav-item:hover {
      background: var(--md-surface-container);
    }
  }

  .sidenav-item.is-active {
    background: transparent;
    color: var(--md-on-secondary-container);
  }

  .sidenav.is-collapsed .sidenav-item {
    height: 56px;
  }

  .sidenav.is-collapsed .sidenav-item svg {
    top: 9px;
    left: calc(50% - 10px);
  }

  @media (prefers-reduced-motion: reduce) {
    .sidenav,
    .sidenav-head,
    .sidenav-icon-btn,
    .sidenav-avatar,
    .sidenav-indicator.is-ready,
    .sidenav-item,
    .sidenav-item svg,
    .sidenav-label-wide,
    .sidenav-label-compact {
      transition: none;
    }
  }

  /* ---------------- 手机：悬浮胶囊底栏 ---------------- */
  .mobile-nav {
    position: absolute;
    left: 24px;
    right: 24px;
    bottom: env(safe-area-inset-bottom);
    z-index: 40;
    height: 64px;
    max-width: 560px;
    margin-inline: auto;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: space-around;
    border-radius: 32px;
    /* 内部浅填充（比页面略淡）+ 外圈淡描边 */
    background: color-mix(in oklab, var(--md-surface-container) 70%, var(--md-outline-variant) 30%);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--md-outline-variant) 45%, transparent),
      inset 0 0 0 1px color-mix(in oklab, var(--md-surface) 40%, transparent),
      0 18px 36px -16px color-mix(in oklab, var(--md-shadow-color-soft) 55%, transparent);
    transform-origin: center center;
    transition:
      transform 400ms cubic-bezier(0.25, 1, 0.5, 1),
      box-shadow 400ms cubic-bezier(0.25, 1, 0.5, 1);
    will-change: transform;
    /* 底栏自己吃掉触摸手势：否则轻微滑动会被浏览器判成滚动并派发 pointercancel，
       按下态立刻被取消，实机就只剩「用力按住」才看得到玻璃 */
    touch-action: none;
    /* 允许拖拽时气泡溢出上沿 */
    overflow: visible;
  }

  .mobile-nav.is-interacting {
    transform: scale(1.04);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--md-outline-variant) 56%, transparent),
      0 26px 48px -18px color-mix(in oklab, var(--md-shadow-color-soft) 78%, transparent);
  }

  /* 果冻指示器：静止态纯色无边框胶囊；拖拽态切中性玻璃并上浮溢出 */
  .mobile-nav-indicator {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 0;
    width: 82px;
    height: 56px;
    border-radius: 28px;
    background: var(--md-secondary-container);
    border: none;
    box-shadow: none;
    pointer-events: none;
    opacity: 0;
    transform-origin: center center;
    will-change: transform, width, border-radius;
    transition: background 220ms ease, box-shadow 200ms ease;
  }

  .mobile-nav-indicator::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 16%;
    right: 16%;
    height: 40%;
    border-radius: 28px 28px 60% 60%;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--md-surface) 68%, transparent) 0%,
      color-mix(in oklab, var(--md-surface) 0%, transparent) 100%
    );
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  /* 按下 / 拖拽：去主题色，切换为中性玻璃质感（按住即生效，不需拖动） */
  .mobile-nav-indicator.is-pressed,
  .mobile-nav-indicator.is-dragging {
    /* 轻点只有几十毫秒，220ms 的底色过渡还没走到位就抬起了，玻璃看起来只有半透明；
       按下瞬间直接切到完整玻璃，松手再走回过渡 */
    transition: background 0s, box-shadow 90ms ease;
    background:
      radial-gradient(
        125% 82% at 50% 10%,
        color-mix(in oklab, var(--md-surface) 66%, transparent) 0%,
        color-mix(in oklab, var(--md-surface) 30%, transparent) 42%,
        color-mix(in oklab, var(--md-outline-variant) 22%, transparent) 100%
      ),
      color-mix(in oklab, var(--md-surface-container) 16%, transparent);
    backdrop-filter: blur(9px) saturate(165%) contrast(1.02) brightness(1.02);
    -webkit-backdrop-filter: blur(9px) saturate(165%) contrast(1.02) brightness(1.02);
    border: 1px solid color-mix(in oklab, var(--md-surface) 82%, transparent);
    box-shadow:
      inset 0 2px 3px color-mix(in oklab, var(--md-surface) 96%, transparent),
      inset 0 -2.5px 4px color-mix(in oklab, var(--md-shadow-color) 30%, transparent),
      0 14px 30px -8px color-mix(in oklab, var(--md-shadow-color) 22%, transparent);
  }

  .mobile-nav-indicator.is-pressed::after,
  .mobile-nav-indicator.is-dragging::after {
    opacity: 1;
  }

  .mobile-nav-indicator.is-ready {
    opacity: 1;
  }

  .mobile-nav-item {
    position: relative;
    z-index: 1;
    width: 58px;
    height: 64px;
    border-radius: 32px;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 11px;
    font-weight: 600;
    background: transparent;
    color: var(--md-on-surface-variant);
    touch-action: none; /* 槽位按钮上也不要让浏览器抢走按压手势 */
    transition:
      color 260ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mobile-nav-item svg {
    width: 24px;
    height: 24px;
  }

  .mobile-nav-item.is-active {
    background: transparent;
    color: var(--md-primary);
    transform: translateY(-1px) scale(1.03);
  }

  @media (prefers-reduced-motion: reduce) {
    .mobile-nav,
    .mobile-nav-indicator,
    .mobile-nav-indicator::after,
    .mobile-nav-item {
      transition: none;
    }
  }
</style>
