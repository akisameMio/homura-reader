/* ============================================================================
   HOMURA · 主题 Store
   ----------------------------------------------------------------------------
   主题色 / 阅读表面 / 翻页过渡效果。
   高亮态不再手动改 DOM，由组件根据 store 状态做 :class / :style 绑定。
   ========================================================================== */

import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import { applyAndroidSystemBars } from '../services/androidSystemBars.ts';

// 原生窗口 / 浏览器地址栏底色，与 homura.css 的 --md-surface 保持一致
const SURFACE_CANVAS = { light: '#F8FAFC', dark: '#0F1115' };
const SURFACE_MODE_ORDER = ['light', 'dark', 'auto'];
const READER_SURFACE_MODE_ORDER = ['parchment', 'green', 'settings'];
const LEGACY_SURFACE_MODES: Record<string, string> = { warm: 'light' };
type SurfaceMode = 'light' | 'dark' | 'auto';
type EffectiveSurfaceMode = 'light' | 'dark';
type ReaderSurfaceMode = 'parchment' | 'green' | 'settings';
export const THEME_OPTIONS = Object.freeze([
  { name: 'green', title: '森系绿', tones: ['#BEF0A7', '#A3D48D', '#6F9D5C'] },
  { name: 'mint', title: '薄荷青', tones: ['#98F4D7', '#7BD7BC', '#42A087'] },
  { name: 'cyan', title: '海盐青', tones: ['#99F0FF', '#74D4E4', '#369EAD'] },
  { name: 'blue', title: '深海蓝', tones: ['#CCE5FF', '#92CCFF', '#5996C7'] },
  { name: 'violet', title: '鸢尾紫', tones: ['#DFE0FF', '#BCC2FF', '#848CD0'] },
  { name: 'orchid', title: '兰花紫 (默认)', tones: ['#F3DAFF', '#E2B6FD', '#A981C3'] },
  { name: 'sakura', title: '樱雾粉', tones: ['#FFD8E8', '#FFAFD5', '#C679A0'] },
  { name: 'red', title: '落日赤陶', tones: ['#FFDBD0', '#FFB59F', '#D07A5F'] },
  { name: 'amber', title: '琥珀金', tones: ['#FFDDB9', '#FDB967', '#C08537'] },
  { name: 'olive', title: '橄榄青', tones: ['#F1E580', '#D4C967', '#9C9338'] }
]);
export const SURFACE_MODE_OPTIONS = Object.freeze([
  { value: 'light', label: '白昼', note: '清透纸白', title: '白昼清爽模式', icon: 'light_mode' },
  { value: 'dark', label: '夜间', note: '深褐低光', title: '夜间深邃模式', icon: 'dark_mode' },
  { value: 'auto', label: '跟随系统设置', note: '随系统切换', title: '跟随系统深浅色', icon: 'contrast' }
]);
export const READER_SURFACE_MODE_OPTIONS = Object.freeze([
  { value: 'parchment', label: '羊皮纸', note: '暖调低蓝', title: '羊皮纸阅读模式', icon: 'auto_stories', theme: 'amber' },
  { value: 'green', label: '护眼绿', note: '柔绿降噪', title: '护眼绿阅读模式', icon: 'light_mode', theme: 'green' },
  { value: 'settings', label: '跟随设置外观', note: '沿用全局表面', title: '跟随设置外观', icon: 'update' }
]);
const SURFACE_REVEAL_DURATION = 720;
// 滚动由每本书的排版方向持有；这里保留上一次分页效果，切回时继续使用。
const TRANSITION_ORDER = ['slide', 'curl', 'fade'];
export const TRANSITION_OPTIONS = Object.freeze([
  { value: 'slide', label: '滑动' },
  { value: 'curl', label: '卷页' },
  { value: 'fade', label: '柔和淡入' },
  { value: 'scroll', label: '滚动' }
]);
export const TRANSITION_LABELS = Object.fromEntries(
  TRANSITION_OPTIONS.map(option => [option.value, option.label])
);

function readTransitionStyle() {
  try {
    const saved = localStorage.getItem('homura_transition_style');
    return saved !== null && TRANSITION_ORDER.includes(saved) ? saved : 'slide';
  } catch (err) {
    return 'slide';
  }
}

function readReaderSurfaceMode(): ReaderSurfaceMode {
  try {
    const saved = localStorage.getItem('homura_reader_surface_mode');
    return saved !== null && READER_SURFACE_MODE_ORDER.includes(saved)
      ? saved as ReaderSurfaceMode
      : 'settings';
  } catch (err) {
    return 'settings';
  }
}

function normalizeSurfaceMode(value: unknown): SurfaceMode {
  if (typeof value !== 'string') return 'light';
  const normalized = LEGACY_SURFACE_MODES[value] || value;
  return SURFACE_MODE_ORDER.includes(normalized) ? normalized as SurfaceMode : 'light';
}

function normalizeReaderSurfaceMode(value: unknown): ReaderSurfaceMode {
  return typeof value === 'string' && READER_SURFACE_MODE_ORDER.includes(value)
    ? value as ReaderSurfaceMode
    : 'settings';
}

function systemPrefersDark() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveEffectiveSurfaceMode(mode: SurfaceMode): EffectiveSurfaceMode {
  if (mode === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

// 同步原生窗口与系统栏外观，避免夜间模式下标题栏、状态栏与内容底色不同步
function applyNativeWindowChrome(modeName: EffectiveSurfaceMode) {
  applyAndroidSystemBars(modeName === 'dark');

  const tauriWindow = window.__TAURI__ && window.__TAURI__.window;
  if (!tauriWindow || typeof tauriWindow.getCurrentWindow !== 'function') return;
  const win = tauriWindow.getCurrentWindow();
  const theme = modeName === 'dark' ? 'dark' : 'light';
  const canvas = SURFACE_CANVAS[modeName];
  if (win.setTheme) win.setTheme(theme).catch(() => {});
  if (win.setBackgroundColor) win.setBackgroundColor(canvas).catch(() => {});
}

export const useThemeStore = defineStore('theme', () => {
  const themeColor = ref('orchid');
  const surfaceMode = ref<SurfaceMode>('light');
  const readerSurfaceMode = ref<ReaderSurfaceMode>(readReaderSurfaceMode());
  const systemDark = ref(systemPrefersDark());
  const transitionStyle = ref(readTransitionStyle());
  const effectiveSurfaceMode = computed<EffectiveSurfaceMode>(() => (
    surfaceMode.value === 'auto' ? (systemDark.value ? 'dark' : 'light') : surfaceMode.value
  ));
  let surfaceModeToken = 0;
  let surfaceRevealFrame = 0;
  let surfaceRevealEl: HTMLDivElement | null = null;

  function setThemeColor(colorName: string) {
    themeColor.value = colorName;
    document.documentElement.setAttribute('data-theme', colorName);
    try { localStorage.setItem('homura_theme_color', colorName); } catch (e) {}
  }

  function setSurfaceMode(modeName: string, silent = false, origin: { x: number; y: number } | null = null) {
    const nextMode = normalizeSurfaceMode(modeName);
    const effectiveMode = resolveEffectiveSurfaceMode(nextMode);
    surfaceMode.value = nextMode;
    const html = document.documentElement;
    const token = ++surfaceModeToken;
    const currentMode = html.getAttribute('data-mode');

    const applyMode = () => {
      // 关闭过渡并强制回流，避免页面颜色渐变而标题栏瞬间换色造成的不同步
      html.classList.add('surface-switching');
      void html.offsetWidth;
      html.setAttribute('data-mode', effectiveMode);
      if (effectiveMode === 'dark') {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
      // 移动端浏览器地址栏 / 状态栏跟随阅读表面底色
      const meta = document.getElementById('homuraThemeColor');
      if (meta) meta.setAttribute('content', SURFACE_CANVAS[effectiveMode]);
      try { localStorage.setItem('homura_surface_mode', nextMode); } catch (e) {}
    };

    const finish = () => {
      if (token !== surfaceModeToken) return;
      if (surfaceRevealFrame) cancelAnimationFrame(surfaceRevealFrame);
      surfaceRevealFrame = 0;
      if (surfaceRevealEl) surfaceRevealEl.remove();
      surfaceRevealEl = null;
      html.classList.remove('surface-switching');
    };

    const finishNextFrame = () => {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    };

    // 启动恢复、自动模式跟随系统或目标颜色没变时，直接落色不做展开动画
    if (silent || currentMode === effectiveMode) {
      applyMode();
      applyNativeWindowChrome(effectiveMode);
      finishNextFrame();
      return;
    }

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      applyMode();
      applyNativeWindowChrome(effectiveMode);
      finishNextFrame();
      return;
    }

    // 旧表面色盖住新配色，再从点击位置打开圆形透明孔，形成新配色展开效果
    const oldCanvas = getComputedStyle(document.body).backgroundColor;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const centerX = origin && Number.isFinite(origin.x) ? origin.x : viewportWidth / 2;
    const centerY = origin && Number.isFinite(origin.y) ? origin.y : viewportHeight / 2;
    const maxRadius = Math.hypot(
      Math.max(centerX, viewportWidth - centerX),
      Math.max(centerY, viewportHeight - centerY)
    ) + 2;

    if (surfaceRevealFrame) cancelAnimationFrame(surfaceRevealFrame);
    if (surfaceRevealEl) surfaceRevealEl.remove();

    const reveal = document.createElement('div');
    reveal.className = 'surface-reveal';
    reveal.style.backgroundColor = oldCanvas;
    surfaceRevealEl = reveal;

    const renderCircle = (radius: number) => {
      const mask = `radial-gradient(circle at ${centerX}px ${centerY}px, transparent ${radius}px, var(--md-on-surface) ${radius + 1}px)`;
      reveal.style.webkitMaskImage = mask;
      reveal.style.maskImage = mask;
    };

    renderCircle(0);
    document.body.appendChild(reveal);
    applyMode();
    // 标题栏与窗口底色和内容区在同一帧切到新色
    applyNativeWindowChrome(effectiveMode);

    const startedAt = performance.now();
    const animate = (now: number) => {
      if (token !== surfaceModeToken) return;
      const progress = Math.min(1, (now - startedAt) / SURFACE_REVEAL_DURATION);
      const eased = 1 - Math.pow(1 - progress, 4);
      renderCircle(maxRadius * eased);
      if (progress < 1) {
        surfaceRevealFrame = requestAnimationFrame(animate);
      } else {
        finish();
      }
    };
    surfaceRevealFrame = requestAnimationFrame(animate);
  }

  function setReaderSurfaceMode(modeName: string) {
    const nextMode = normalizeReaderSurfaceMode(modeName);
    readerSurfaceMode.value = nextMode;
    try { localStorage.setItem('homura_reader_surface_mode', nextMode); } catch (e) {}
  }

  function setTransitionStyle(style: string | null) {
    if (style === null || !TRANSITION_ORDER.includes(style)) return;
    transitionStyle.value = style;
    try { localStorage.setItem('homura_transition_style', style); } catch (e) {}
  }

  function toggleTransitionStyle() {
    const nextIdx = (TRANSITION_ORDER.indexOf(transitionStyle.value) + 1) % TRANSITION_ORDER.length;
    setTransitionStyle(TRANSITION_ORDER[nextIdx]);
  }

  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemModeChange = () => {
      systemDark.value = media.matches;
      if (surfaceMode.value === 'auto') setSurfaceMode('auto', true);
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onSystemModeChange);
      onScopeDispose(() => media.removeEventListener('change', onSystemModeChange));
    } else if (typeof media.addListener === 'function') {
      media.addListener(onSystemModeChange);
      onScopeDispose(() => media.removeListener(onSystemModeChange));
    }
  }

  return {
    themeColor,
    surfaceMode,
    readerSurfaceMode,
    effectiveSurfaceMode,
    transitionStyle,
    setThemeColor,
    setSurfaceMode,
    setReaderSurfaceMode,
    setTransitionStyle,
    toggleTransitionStyle
  };
});
