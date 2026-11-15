import { onBeforeUnmount } from 'vue';
import { makeAxis, prefersReducedMotion, runSpring } from '../services/spring.ts';
import { cloneSettingsTransitionPage } from '../services/settingsTransitionSnapshot.ts';

const CARD_SPRING = { damping: 0.5, posEpsilon: 0.015, velEpsilon: 0.12 };

function setCardLift(card: HTMLElement, lift: number) {
  card.style.transform = `translate3d(0, ${-16 * lift}px, 0) scale(${1 + 0.045 * lift})`;
}

function suspendAndroidEffects() {
  const root = document.documentElement;
  if (root.dataset.platform !== 'android') return () => {};
  root.classList.add('settings-card-transition');
  return () => root.classList.remove('settings-card-transition');
}

/* 设置卡片与二级页共享一个浮动容器，只补间 transform，避免逐帧重排真实页面。 */
export function useSettingsTransition() {
  let cleanup: (() => void) | null = null;
  let restoreRaisedCard: (() => void) | null = null;
  let raisedVelocity = 0;
  let bouncing = false;

  function cancel() {
    cleanup?.();
    cleanup = null;
    restoreRaisedCard?.();
    restoreRaisedCard = null;
    raisedVelocity = 0;
  }

  function bounce(card: HTMLElement | null): Promise<boolean> {
    cancel();
    if (!card) return Promise.resolve(false);
    if (prefersReducedMotion()) return Promise.resolve(true);
    return new Promise(resolve => {
      const restoreEffects = suspendAndroidEffects();
      const originalTransform = card.style.transform;
      const originalOrigin = card.style.transformOrigin;
      const originalWillChange = card.style.willChange;
      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      let cancelSpring: (() => void) | null = null;
      let guard = 0;
      let finished = false;
      const progress = makeAxis(0, 360);
      progress.target = 1;
      const restore = () => {
        card.style.transform = originalTransform;
        card.style.transformOrigin = originalOrigin;
        card.style.willChange = originalWillChange;
        restoreEffects();
      };
      const finish = (proceed: boolean) => {
        if (finished) return;
        finished = true;
        cancelSpring?.();
        window.clearTimeout(guard);
        window.removeEventListener('resize', interrupt);
        window.removeEventListener('pagehide', interrupt);
        motionQuery.removeEventListener('change', onMotionChange);
        if (proceed && card.isConnected && !prefersReducedMotion()) {
          setCardLift(card, progress.pos);
          restoreRaisedCard = restore;
          raisedVelocity = Math.max(0, progress.vel) * 0.12;
        } else {
          restore();
        }
        bouncing = false;
        if (cleanup === interrupt) cleanup = null;
        resolve(proceed && card.isConnected);
      };
      const interrupt = () => finish(false);
      const complete = () => finish(true);
      const onMotionChange = () => finish(motionQuery.matches);
      cleanup = interrupt;
      bouncing = true;
      card.style.transformOrigin = 'center center';
      card.style.willChange = 'transform';
      window.addEventListener('resize', interrupt, { once: true });
      window.addEventListener('pagehide', interrupt, { once: true });
      motionQuery.addEventListener('change', onMotionChange, { once: true });
      // 弹起途中就交给展开，沿用当帧姿态与速度，不等待弹簧落稳。
      cancelSpring = runSpring([progress], () => {
        setCardLift(card, progress.pos);
        if (progress.pos >= 0.85 && progress.vel > 0) queueMicrotask(complete);
      }, complete, CARD_SPRING);
      guard = window.setTimeout(complete, 900);
    });
  }

  function dismissBounce() {
    if (!bouncing) return false;
    cancel();
    return true;
  }

  function capture(page: HTMLElement | null, card?: HTMLElement | null) {
    const restoreLift = restoreRaisedCard;
    const handoffVelocity = raisedVelocity;
    restoreRaisedCard = null;
    cancel();
    if (!page || prefersReducedMotion()) {
      restoreLift?.();
      return null;
    }
    const column = page.closest<HTMLElement>('[data-app-scroll]');
    const bounds = (column ?? page).getBoundingClientRect();
    const left = Math.max(0, bounds.left);
    const top = Math.max(0, bounds.top);
    const width = Math.min(window.innerWidth, bounds.right) - left;
    const height = Math.min(window.innerHeight, bounds.bottom) - top;
    if (width <= 0 || height <= 0) {
      restoreLift?.();
      return null;
    }

    const layer = document.createElement('div');
    layer.className = 'settings-transition-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    Object.assign(layer.style, {
      position: 'fixed', left: `${left}px`, top: `${top}px`,
      width: `${width}px`, height: `${height}px`, overflow: 'hidden',
      pointerEvents: 'none', zIndex: '30', contain: 'layout paint'
    });

    function snapshot() {
      const clone = document.documentElement.dataset.platform === 'android'
        ? cloneSettingsTransitionPage(page!, { top, bottom: top + height })
        : page!.cloneNode(true) as HTMLElement;
      // 副本只负责绘制，移除 ID，避免干扰焦点恢复和表单标签。
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      clone.dataset.settingsSnapshot = '';
      clone.setAttribute('aria-hidden', 'true');
      clone.inert = true;
      const rect = page!.getBoundingClientRect();
      Object.assign(clone.style, {
        position: 'absolute', left: `${rect.left - left}px`, top: `${rect.top - top}px`,
        width: `${rect.width}px`, minHeight: `${height}px`, margin: '0',
        pointerEvents: 'none'
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
    // 入口 DOM 在 nextTick 后可能已被 v-if 卸载。
    const cardRect = card?.getBoundingClientRect();
    const cardRadius = card ? parseFloat(getComputedStyle(card).borderRadius) || 28 : 0;
    const cardPreview = card?.cloneNode(true) as HTMLElement | undefined;
    cardPreview?.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    // 几何和副本都取自弹起状态，随后恢复即将卸载的原 DOM。
    restoreLift?.();
    const restoreEffects = suspendAndroidEffects();
    layer.appendChild(outgoing);
    document.body.appendChild(layer);
    let cancelSpring: (() => void) | null = null;
    let restoreContent: (() => void) | null = null;
    let restoreLivePage: (() => void) | null = null;
    const originalOpacity = page.style.opacity;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let guard = 0;
    const finish = () => {
      cancelSpring?.();
      window.clearTimeout(guard);
      window.removeEventListener('resize', finish);
      window.removeEventListener('pagehide', finish);
      motionQuery.removeEventListener('change', finish);
      restoreLivePage?.();
      layer.remove();
      page.style.opacity = originalOpacity;
      restoreContent?.();
      restoreEffects();
      if (cleanup === finish) cleanup = null;
    };
    cleanup = finish;
    window.addEventListener('resize', finish, { once: true });
    window.addEventListener('pagehide', finish, { once: true });
    motionQuery.addEventListener('change', finish, { once: true });

    return {
      play(targetCard?: HTMLElement | null) {
        if (cleanup !== finish) return;
        const opening = !!card;
        const anchor = card ?? targetCard;
        if (!opening && anchor) {
          const originalTransform = anchor.style.transform;
          const originalOrigin = anchor.style.transformOrigin;
          const originalWillChange = anchor.style.willChange;
          const originalAnchorOpacity = anchor.style.opacity;
          restoreContent = () => {
            anchor.style.transform = originalTransform;
            anchor.style.transformOrigin = originalOrigin;
            anchor.style.willChange = originalWillChange;
            anchor.style.opacity = originalAnchorOpacity;
          };
          anchor.style.transformOrigin = 'center center';
          anchor.style.willChange = 'transform';
          anchor.style.opacity = '0';
          setCardLift(anchor, 1);
        }
        // 打开时入口已被 v-if 卸载，所以提前保存卡片几何。
        const rect = opening ? cardRect : anchor?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0 || prefersReducedMotion()) {
          finish();
          return;
        }
        const radius = opening ? cardRadius : parseFloat(getComputedStyle(anchor!).borderRadius) || 28;
        const surface = document.createElement('div');
        Object.assign(surface.style, {
          position: 'absolute', inset: '0', overflow: 'hidden',
          transformOrigin: '0 0', background: 'var(--md-surface-low)',
          willChange: 'transform, opacity', boxShadow: 'var(--md-elevation-card-soft)'
        });
        const isAndroid = document.documentElement.dataset.platform === 'android';
        // Android 保留静态圆角裁切，让整张表面复用合成纹理，避免每帧重绘文字与阴影。
        if (isAndroid) surface.style.borderRadius = `${radius}px`;
        const livePage = opening && isAndroid;
        let liveFocus: HTMLElement | null = null;
        let content: HTMLElement;
        if (livePage) {
          // Android 直接复用新页面，避免先绘制副本、交接时又光栅化整张真实页面。
          const pageRect = page.getBoundingClientRect();
          const header = page.querySelector<HTMLElement>('.settings-topbar');
          const headerTop = header?.getBoundingClientRect().top ?? pageRect.top;
          const originalStyle = page.getAttribute('style');
          const originalHeaderStyle = header?.getAttribute('style') ?? null;
          liveFocus = page.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
          const placeholder = page.cloneNode(false) as HTMLElement;
          placeholder.removeAttribute('id');
          placeholder.setAttribute('aria-hidden', 'true');
          placeholder.inert = true;
          Object.assign(placeholder.style, { height: `${pageRect.height}px`, flex: 'none' });
          page.replaceWith(placeholder);
          restoreLivePage = () => {
            const focused = page.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
            if (placeholder.parentNode) placeholder.replaceWith(page);
            if (originalStyle === null) page.removeAttribute('style');
            else page.setAttribute('style', originalStyle);
            if (header) {
              if (originalHeaderStyle === null) header.removeAttribute('style');
              else header.setAttribute('style', originalHeaderStyle);
            }
            focused?.focus({ preventScroll: true });
            restoreLivePage = null;
          };
          Object.assign(page.style, {
            position: 'absolute', left: `${pageRect.left - left}px`, top: `${pageRect.top - top}px`,
            width: `${pageRect.width}px`, minHeight: `${height}px`, margin: '0', pointerEvents: 'auto'
          });
          if (header) {
            header.style.position = 'relative';
            header.style.top = '0';
            header.style.transform = `translateY(${headerTop - pageRect.top}px)`;
          }
          layer.inert = false;
          layer.removeAttribute('aria-hidden');
          content = page;
        } else {
          content = opening ? snapshot() : outgoing;
        }
        content.style.willChange = 'opacity';
        outgoing.style.willChange = 'opacity';
        surface.appendChild(content);
        let preview: HTMLElement | null = null;
        const previewCard = opening ? cardPreview : anchor?.cloneNode(true) as HTMLElement | undefined;
        if (previewCard) {
          // 进出都保留原卡片的文字与示意图，收回时先还原弹起的卡片。
          previewCard.removeAttribute('id');
          previewCard.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
          preview = page.cloneNode(false) as HTMLElement;
          preview.dataset.settingsSnapshot = '';
          preview.setAttribute('aria-hidden', 'true');
          preview.inert = true;
          Object.assign(preview.style, {
            position: 'absolute', inset: '0', width: `${width}px`, height: `${height}px`, margin: '0',
            willChange: 'opacity', pointerEvents: 'none'
          });
          Object.assign(previewCard.style, {
            position: 'absolute', left: '0', top: '0', margin: '0',
            width: `${rect.width}px`, height: `${rect.height}px`, overflow: 'hidden',
            opacity: '1',
            transformOrigin: '0 0', transform: `scale(${width / rect.width}, ${height / rect.height})`
          });
          preview.appendChild(previewCard);
          surface.appendChild(preview);
        }
        layer.appendChild(surface);
        liveFocus?.focus({ preventScroll: true });
        if (opening) page.style.opacity = '0';
        const progress = makeAxis(0, 160);
        progress.target = 1;
        if (opening) progress.vel = handoffVelocity;
        let morphComplete = false;
        const clamp = (value: number) => Math.max(0, Math.min(1, value));
        const apply = () => {
          const p = progress.pos;
          const expanded = opening ? p : 1 - p;
          const sx = Math.max(0.01, rect.width / width + (1 - rect.width / width) * expanded);
          const sy = Math.max(0.01, rect.height / height + (1 - rect.height / height) * expanded);
          const x = (rect.left - left) * (1 - expanded);
          const y = (rect.top - top) * (1 - expanded);
          surface.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${sx}, ${sy})`;
          if (!isAndroid) {
            const corner = radius * clamp(1 - expanded);
            surface.style.borderRadius = `${corner / sx}px / ${corner / sy}px`;
          }
          if (opening) {
            const handoff = clamp((p - 0.7) / 0.3);
            if (preview) preview.style.opacity = String(1 - clamp(p / 0.4));
            outgoing.style.opacity = String(1 - clamp(p * 3));
            content.style.opacity = String(clamp((p - 0.15) / 0.65));
            if (!livePage) page.style.opacity = String(handoff);
            surface.style.opacity = livePage ? '1' : String(1 - handoff);
          } else {
            if (preview) preview.style.opacity = String(1 - clamp(expanded / 0.4));
            content.style.opacity = String(clamp((expanded - 0.15) / 0.65));
            surface.style.opacity = '1';
            if (p >= 0.96 && progress.vel > 0 && !morphComplete) queueMicrotask(completeMorph);
          }
        };
        apply();
        const completeMorph = () => {
          if (morphComplete || cleanup !== finish) return;
          morphComplete = true;
          cancelSpring?.();
          if (opening || !anchor?.isConnected || prefersReducedMotion()) {
            finish();
            return;
          }
          // 收缩途中按当帧几何和速度交给原卡片，省去等待收敛的长尾。
          const current = surface.getBoundingClientRect();
          layer.remove();
          page.style.opacity = originalOpacity;
          restoreContent?.();
          const base = anchor.getBoundingClientRect();
          if (base.width <= 0 || base.height <= 0) {
            finish();
            return;
          }
          anchor.style.transformOrigin = '0 0';
          anchor.style.willChange = 'transform';
          const x = makeAxis(current.left - base.left, 240);
          const y = makeAxis(current.top - base.top, 240);
          const scaleX = makeAxis(current.width / base.width, 240);
          const scaleY = makeAxis(current.height / base.height, 240);
          x.target = y.target = 0;
          scaleX.target = scaleY.target = 1;
          x.vel = (rect.left - left) * progress.vel;
          y.vel = (rect.top - top) * progress.vel;
          scaleX.vel = (rect.width - width) * progress.vel / base.width;
          scaleY.vel = (rect.height - height) * progress.vel / base.height;
          const applyLanding = () => {
            anchor.style.transform = `translate3d(${x.pos}px, ${y.pos}px, 0) scale(${scaleX.pos}, ${scaleY.pos})`;
          };
          applyLanding();
          cancelSpring = runSpring([x, y, scaleX, scaleY], applyLanding, finish, CARD_SPRING);
          window.clearTimeout(guard);
          guard = window.setTimeout(finish, 1200);
        };
        cancelSpring = runSpring([progress], apply, completeMorph, {
          damping: 1, posEpsilon: 0.001, velEpsilon: 0.01
        });
        // 后台 rAF 暂停、旋转或系统临时切换减少动效时，也能立即恢复真实页面。
        guard = window.setTimeout(finish, 1800);
      }
    };
  }

  onBeforeUnmount(cancel);
  return { bounce, dismissBounce, capture, cancel };
}
