import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { prefersReducedMotion } from '../services/spring.ts';

export function usePanelResizeTransition(
  panel: { value: HTMLElement | null },
  page: () => string | undefined,
  resetLayout?: () => void
) {
  const isResizing = ref(false);
  let animation: Animation | null = null;

  function cancelResize() {
    animation?.cancel();
    animation = null;
    isResizing.value = false;
  }

  watch(page, async (current, previous, onCleanup) => {
    const element = panel.value;
    if (!current || !previous || !element) {
      cancelResize();
      return;
    }

    // 从当前屏幕尺寸接续，快速返回时也不会跳到上一次动画的终点。
    const startWidth = element.offsetWidth;
    const startHeight = element.offsetHeight;
    cancelResize();
    resetLayout?.();

    let stale = false;
    onCleanup(() => { stale = true; });
    await nextTick();
    if (stale || element !== panel.value || prefersReducedMotion()) return;

    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width === startWidth && height === startHeight) return;
    const resize = element.animate([
      { width: `${startWidth}px`, height: `${startHeight}px` },
      { width: `${width}px`, height: `${height}px` }
    ], { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' });
    animation = resize;
    isResizing.value = true;
    const clearResize = () => {
      if (animation !== resize) return;
      animation = null;
      isResizing.value = false;
    };
    void resize.finished.then(clearResize, clearResize);
  });

  onBeforeUnmount(cancelResize);
  return { cancelResize, isResizing };
}
