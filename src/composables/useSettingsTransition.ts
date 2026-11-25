import { onBeforeUnmount, type InjectionKey, type ShallowRef } from 'vue';
import { makeAxis, prefersReducedMotion, runSpring } from '../services/spring.ts';
import { cloneSettingsTransitionPage } from '../services/settingsTransitionSnapshot.ts';

export const settingsSelectBackKey: InjectionKey<ShallowRef<(() => void) | null>> = Symbol('settings-select-back');

const OPEN_DURATION = 380;
const RETURN_DURATION = 265;
const DESKTOP_RETURN_DURATION = 255;
const DESKTOP_RETURN_MIN = 240;
const NAV_TRAVEL = 20;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const segment = (value: number, start: number, end: number) => clamp((value - start) / (end - start));

function markSnapshot(node: HTMLElement) {
  node.removeAttribute('id');
  node.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
  node.dataset.settingsSnapshot = '';
  node.inert = true;
}

/* 根浮层同步裁切边界与表面色；桌面详情等比适配当前宽度。 */
export function useSettingsTransition() {
  let cleanup: (() => void) | null = null;
  let navReveal: Animation | undefined;
  const cancel = () => {
    cleanup?.();
    navReveal?.cancel();
    navReveal = undefined;
  };

  function capture(page: HTMLElement | null, card?: HTMLElement | null, onReturn?: (commit: boolean) => Promise<void>) {
    cancel();
    if (!page || prefersReducedMotion()) return null;

    const opening = !!card;
    const bounds = (page.closest<HTMLElement>('[data-app-scroll]') ?? page).getBoundingClientRect();
    const left = Math.max(0, bounds.left);
    const top = Math.max(0, bounds.top);
    const width = Math.min(document.documentElement.clientWidth || window.innerWidth, bounds.right) - left;
    const height = Math.min(window.innerHeight, bounds.bottom) - top;
    if (width <= 0 || height <= 0) return null;

    const root = document.documentElement;
    const android = root.dataset.platform === 'android';
    const desktop = window.innerWidth >= 900;
    const nav = document.getElementById('homura-mobile-nav-root');
    const navContent = nav?.querySelector<HTMLElement>('.mobile-nav');
    const navWasInert = navContent?.inert ?? false;
    const initialInert = page.inert;
    const initialVisibility = page.style.visibility;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const layer = document.createElement('div');
    layer.className = 'settings-transition-layer';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, {
      position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
      overflow: 'hidden', zIndex: '45', contain: 'layout paint', touchAction: 'none'
    });
    layer.addEventListener('wheel', event => event.preventDefault(), { passive: false });

    function snapshot() {
      const clone = android
        ? cloneSettingsTransitionPage(page!, { top, bottom: top + height })
        : page!.cloneNode(true) as HTMLElement;
      markSnapshot(clone);
      const rect = page!.getBoundingClientRect();
      Object.assign(clone.style, {
        position: 'absolute', left: `${rect.left - left}px`, top: `${rect.top - top}px`,
        width: `${rect.width}px`, minHeight: `${height}px`, margin: '0', visibility: 'visible',
        transformOrigin: `${left - rect.left}px ${top - rect.top}px`
      });
      const header = clone.querySelector<HTMLElement>('.settings-topbar');
      const actualHeader = page!.querySelector<HTMLElement>('.settings-topbar');
      if (header && actualHeader) {
        // sticky 顶栏的视觉位置不等于滚动后的文档位置。
        header.style.position = 'relative';
        header.style.top = '0';
        header.style.transform = `translateY(${actualHeader.getBoundingClientRect().top - rect.top}px)`;
      }
      return clone;
    }

    const outgoing = snapshot();
    let overviewHeader = opening && desktop && !android ? outgoing.querySelector<HTMLElement>('.settings-topbar') : null;
    if (card) {
      const index = Array.from(page.querySelectorAll('.settings-card')).indexOf(card);
      const source = outgoing.querySelectorAll<HTMLElement>('.settings-card')[index];
      if (source) source.style.visibility = 'hidden';
      layer.append(outgoing);
    }

    const scrim = document.createElement('div');
    scrim.className = 'settings-transition-scrim';
    Object.assign(scrim.style, { position: 'absolute', inset: '0', background: 'var(--md-shadow-color)' });
    const shadow = document.createElement('div');
    Object.assign(shadow.style, { position: 'absolute', inset: '0', transformOrigin: '0 0' });
    const surface = document.createElement('div');
    surface.className = 'settings-transition-surface';
    Object.assign(surface.style, { position: 'absolute', inset: '0', background: 'var(--md-surface-low)' });
    layer.append(scrim, shadow, surface);
    document.body.append(layer);
    if (android) root.classList.add('settings-card-transition');
    if (navContent) navContent.inert = true;
    page.inert = true;
    if (opening) page.style.visibility = 'hidden';
    else surface.append(outgoing);

    let anchor: HTMLElement | null = null;
    let anchorVisibility = '';
    let detail: HTMLElement | null = opening ? null : outgoing;
    let preview: HTMLElement | null = null;
    let geometry: { x: number; y: number; width: number; height: number; radius: number; scale: number } | null = null;
    let navRevealStart = 0.42;
    let stopAnimation: (() => void) | null = null;
    let progress = 0;
    let ready = false;
    let ending = false;
    let settlement: { target: 0 | 1; velocity: number } | null = null;
    let resolveFinished: () => void;
    const finished = new Promise<void>(resolve => { resolveFinished = resolve; });

    function measure(source: HTMLElement) {
      const rect = source.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const style = getComputedStyle(source);
      const scale = parseFloat(style.scale) || 1;
      geometry = {
        x: rect.left - left, y: rect.top - top, width: rect.width, height: rect.height,
        radius: (parseFloat(style.borderRadius) || 0) * scale, scale
      };
      if (!opening && navContent) {
        // 底栏先等容器让出空间；入口贴近底栏时，等原卡片接手后再上浮。
        const navTop = navContent.getBoundingClientRect().top - NAV_TRAVEL - top;
        if (navTop > 0 && navTop < height) {
          const room = height - geometry.y - geometry.height;
          navRevealStart = room > 0 ? Math.max(0.42, (height - navTop) / room) : 1;
        }
      }
      // 保留容器查询所需的页面宽度，卡片副本只绘制内容，底色和阴影由外层绘制。
      preview = page!.cloneNode(false) as HTMLElement;
      markSnapshot(preview);
      Object.assign(preview.style, {
        position: 'absolute', inset: '0', width: `${page!.getBoundingClientRect().width}px`,
        background: 'transparent', visibility: 'visible', transformOrigin: '0 0'
      });
      const copy = source.cloneNode(true) as HTMLElement;
      markSnapshot(copy);
      Object.assign(copy.style, {
        position: 'absolute', left: '0', top: '0', margin: '0',
        width: `${source.offsetWidth || rect.width}px`, height: `${source.offsetHeight || rect.height}px`,
        background: 'transparent', boxShadow: 'none', scale: 'none'
      });
      preview.append(copy);
      surface.append(preview);
      shadow.style.boxShadow = style.boxShadow;
    }

    function apply(value: number) {
      const p = progress = clamp(value);
      const expanded = opening ? p : 1 - p;
      const cardOpacity = opening ? 1 - segment(p, 0, 0.30) : segment(p, 0.35, 0.80);
      if (overviewHeader) {
        if (cardOpacity > 0) {
          overviewHeader.style.opacity = String(cardOpacity);
        } else {
          // 详情淡入前移除旧标题和模糊层，保留概览网格的位置。
          const spacer = document.createElement('div');
          spacer.style.height = `${overviewHeader.getBoundingClientRect().height}px`;
          overviewHeader.replaceWith(spacer);
          overviewHeader = null;
        }
      }
      scrim.style.opacity = String(0.12 * expanded);
      const navVisibility = opening ? 1 - segment(p, 0, 0.53)
        : navRevealStart > 0.83 ? 0 : segment(p, navRevealStart, Math.max(0.88, (1 + navRevealStart) / 2));
      nav?.style.setProperty('--settings-nav-visibility', String(navVisibility));
      if (detail) detail.style.opacity = String(opening
        ? (desktop ? segment(p, 0.55, 0.89) : segment(p, 0.30, 0.75))
        : 1 - segment(p, 0, 0.35));
      if (preview) preview.style.opacity = String(cardOpacity);
      if (!geometry) return;

      const remaining = 1 - expanded;
      const x = geometry.x * remaining;
      const y = geometry.y * remaining;
      const w = width + (geometry.width - width) * remaining;
      const h = height + (geometry.height - height) * remaining;
      const radius = geometry.radius * remaining;
      surface.style.clipPath = `inset(${y}px ${width - x - w}px ${height - y - h}px ${x}px round ${radius}px)`;
      const tint = desktop ? segment(expanded, 0, 0.60) : expanded;
      surface.style.background = tint === 1 ? 'var(--md-surface-low)'
        : `color-mix(in oklab, var(--md-surface) ${(1 - tint) * 100}%, var(--md-surface-low))`;
      shadow.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${w / width}, ${h / height})`;
      shadow.style.borderRadius = `${radius * width / w}px / ${radius * height / h}px`;
      shadow.style.opacity = String(1 - segment(expanded, 0, 0.93));
      const translation = `translate3d(${x}px, ${y}px, 0)`;
      if (detail) detail.style.transform = desktop ? `${translation} scale(${Math.min(1, w / width)})` : translation;
      if (preview) preview.style.transform = `${translation} scale(${1 + (geometry.scale - 1) * remaining})`;
    }

    function finish() {
      if (cleanup !== finish) return;
      stopAnimation?.();
      window.removeEventListener('resize', interrupt);
      window.removeEventListener('pagehide', interrupt);
      motionQuery.removeEventListener('change', interrupt);
      page!.style.visibility = initialVisibility;
      layer.remove();
      page!.inert = initialInert;
      if (anchor) anchor.style.visibility = anchorVisibility;
      if (navContent) navContent.inert = navWasInert;
      nav?.style.removeProperty('--settings-nav-visibility');
      if (android) root.classList.remove('settings-card-transition');
      cleanup = null;
      resolveFinished();
    }

    function end(target: 0 | 1) {
      if (ending || cleanup !== finish) return;
      ending = true;
      stopAnimation?.();
      // 取消时先在仍覆盖全屏的详情副本下恢复真实页面与滚动位置。
      if (opening || !onReturn) {
        finish();
      } else {
        void onReturn(target === 1).finally(() => {
          if (cleanup !== finish) return;
          finish();
          if (target === 1 && navRevealStart > 0.83 && !motionQuery.matches) {
            navReveal = navContent?.animate([
              { opacity: 0, translate: `0 ${NAV_TRAVEL}px` }, { opacity: 1, translate: '0 0' }
            ], { duration: 120, easing: 'ease-out' });
          }
        });
      }
    }

    function interrupt() {
      const target = opening ? 1 : settlement?.target ?? 0;
      apply(target);
      end(target);
    }

    function playTimeline(duration: number, ease: (t: number) => number, done: () => void, tolerance = 0) {
      const start = performance.now();
      let frame = requestAnimationFrame(function tick(now) {
        const elapsed = now - start;
        const t = clamp(elapsed / duration);
        const p = ease(t);
        const settled = t === 1 || (elapsed >= DESKTOP_RETURN_MIN && 1 - p <= tolerance);
        apply(settled ? 1 : p);
        if (settled) done();
        else frame = requestAnimationFrame(tick);
      });
      stopAnimation = () => cancelAnimationFrame(frame);
    }

    function handoffOpening() {
      if (!desktop) {
        end(1);
        return;
      }
      // 先移除「设置」副本，把真实详情绘制在已经铺满的浮层下，再退掉浮层。
      outgoing.remove();
      page!.style.visibility = initialVisibility;
      const frame = requestAnimationFrame(() => end(1));
      stopAnimation = () => cancelAnimationFrame(frame);
    }

    function startSettlement() {
      if (!settlement || !ready || ending) return;
      const { target, velocity } = settlement;
      if (!geometry || progress === target) {
        end(target);
        return;
      }
      const travel = Math.max(Math.abs(geometry.x), Math.abs(geometry.y),
        Math.abs(width - geometry.x - geometry.width), Math.abs(height - geometry.y - geometry.height), 1);
      const tolerance = 2 / travel;
      if (desktop && !android && target === 1 && progress === 0 && velocity === 0) {
        // 按钮返回从静止缓起；剩余位移进入两像素内就对齐原卡片。
        playTimeline(DESKTOP_RETURN_DURATION, t => t * t * (3 - 2 * t), () => end(1), tolerance);
        return;
      }
      const axis = makeAxis(progress, 900);
      axis.target = target;
      axis.vel = Math.max(-8, Math.min(8, velocity));
      const start = performance.now();
      stopAnimation = runSpring([axis], () => apply(axis.pos), () => end(target), {
        damping: 0.92, maxDt: 0.024, posEpsilon: tolerance, velEpsilon: 0.12,
        stopWhen: () => performance.now() - start >= RETURN_DURATION || (target ? axis.pos >= 1 : axis.pos <= 0)
      });
    }

    cleanup = finish;
    window.addEventListener('resize', interrupt, { once: true });
    window.addEventListener('pagehide', interrupt, { once: true });
    motionQuery.addEventListener('change', interrupt, { once: true });
    if (card) measure(card);
    apply(0);

    return {
      finished,
      play(targetCard?: HTMLElement | null) {
        if (cleanup !== finish || ending) return;
        if (opening) {
          if (!geometry) { finish(); return; }
          detail = snapshot();
          detail.style.background = 'transparent';
          surface.prepend(detail);
          apply(0);
          playTimeline(OPEN_DURATION, t => t * (2 - t), handoffOpening);
        } else {
          if (targetCard) {
            measure(targetCard);
            anchor = targetCard;
            anchorVisibility = anchor.style.visibility;
            if (geometry) anchor.style.visibility = 'hidden';
          }
          outgoing.style.background = 'transparent';
          ready = true;
          apply(geometry ? progress : 0);
          startSettlement();
        }
      },
      update(value: number) {
        if (ending || settlement) return;
        if (ready && geometry) apply(value);
        else progress = clamp(value);
      },
      settle(target: 0 | 1, velocity = 0) {
        if (ending || settlement || cleanup !== finish) return;
        settlement = { target, velocity };
        startSettlement();
      }
    };
  }

  onBeforeUnmount(cancel);
  return { capture, cancel };
}
