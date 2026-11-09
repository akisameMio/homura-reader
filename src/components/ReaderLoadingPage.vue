<template>
  <!-- 书架 → 阅读器 加载页：封面居中 + MD3 不定长进度 + 异常重试 -->
  <Transition
    appear
    enter-active-class="rlp-enter-active"
    leave-active-class="rlp-leave-active"
    enter-from-class="rlp-enter-from"
    leave-to-class="rlp-leave-to"
  >
    <div
      v-if="shown"
      class="rlp-root fixed inset-0 z-[55] flex flex-col items-center justify-center px-8"
      :class="{ 'is-leaving': leaving }"
      role="status"
      :aria-busy="phase === 'loading'"
      aria-live="polite"
    >
      <template v-if="phase !== 'error'">
        <div ref="coverEl" class="rlp-cover" :class="{ 'is-art': !cover }">
          <img v-if="cover" :src="cover" alt="" draggable="false" />
          <template v-else>
            <span class="rlp-art-word">HOMURA</span>
            <span class="rlp-art-title">{{ title }}</span>
          </template>
        </div>
        <div class="rlp-meta">
          <p class="rlp-title">{{ title }}</p>
          <p class="rlp-status font-mono">{{ statusText }}</p>
        </div>
        <div class="rlp-bar" aria-hidden="true"><i></i></div>
        <p class="rlp-hint font-mono">加载内容与排版数据</p>
      </template>

      <template v-else>
        <div class="rlp-err-icon" aria-hidden="true">!</div>
        <p class="rlp-err-msg">{{ message }}</p>
        <button type="button" class="rlp-retry md-hit-target" @click="$emit('retry')">重新加载</button>
        <button type="button" class="rlp-back font-mono" @click="$emit('cancel')">返回书架</button>
      </template>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { makeAxis, runSpring, prefersReducedMotion } from '../services/spring.ts';

const props = defineProps({
  visible: { type: Boolean, default: false },
  phase: { type: String as PropType<'loading' | 'error'>, default: 'loading' },
  title: { type: String, default: '' },
  cover: { type: String, default: '' },
  message: { type: String, default: '无法加载这本书，请重试。' }
});

defineEmits(['retry', 'cancel']);

const STEPS = ['正在解析内容…', '构建分页…', '校准排版…'];
const step = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function startTicker() {
  stopTicker();
  step.value = 0;
  timer = setInterval(() => {
    if (step.value < STEPS.length - 1) step.value += 1;
  }, 640);
}
function stopTicker() {
  if (timer) { clearInterval(timer); timer = null; }
}

const statusText = computed(() => props.phase === 'loading' ? STEPS[step.value] : '');

// shown 控制 v-if 挂载；leaving 标记正在播离场弹簧（此期间根背景同步淡出）。
// 用内部状态而非直接绑 props.visible，是为了在离场弹簧跑完后再卸载，让封面展开消散演完。
const shown = ref(props.visible);
const leaving = ref(false);
const coverEl = ref<HTMLElement | null>(null);
let cancelLeaveSpring: (() => void) | null = null;

// 离场弹簧：封面 scale 1 → 3.8、opacity 1 → 0（ζ=1 临界阻尼，无过冲），
// 同时根背景随 is-leaving 类 CSS 淡出。弹簧收敛后再真正卸载组件。
function playLeaveSpring() {
  const el = coverEl.value;
  const reduce = prefersReducedMotion();
  const finish = () => {
    leaving.value = false;
    shown.value = false;
    if (el) el.style.cssText = '';
  };
  if (!el || reduce || typeof window === 'undefined' || !window.requestAnimationFrame) {
    // 减少动效 / 无 DOM：直接淡出卸载
    leaving.value = true;
    window.setTimeout(finish, reduce ? 0 : 200);
    return;
  }
  leaving.value = true;
  const stiffness = 160;
  const axS = makeAxis(1, stiffness);   // scale
  const axO = makeAxis(1, stiffness);   // opacity
  axS.target = 3.8;
  axO.target = 0;
  const axes = [axS, axO];
  const apply = () => {
    el.style.transform = `translateY(-2px) scale(${Math.max(1, axS.pos).toFixed(4)})`;
    el.style.opacity = Math.max(0, Math.min(1, axO.pos)).toFixed(3);
    el.style.filter = `blur(${(Math.max(0, axS.pos - 1) / 2.8 * 10).toFixed(2)}px)`;
  };
  cancelLeaveSpring = runSpring(axes, apply, () => { cancelLeaveSpring = null; finish(); }, { damping: 1, posEpsilon: 0.01, velEpsilon: 0.05 });
}

watch(() => props.visible, (visible) => {
  if (visible) {
    // 入场：取消可能残留的离场弹簧，直接挂载
    if (cancelLeaveSpring) { cancelLeaveSpring(); cancelLeaveSpring = null; }
    leaving.value = false;
    shown.value = true;
    if (coverEl.value) coverEl.value.style.cssText = '';
  } else if (shown.value) {
    playLeaveSpring();
  }
});

watch(() => [props.visible, props.phase] as const, ([visible, phase]) => {
  if (visible && phase === 'loading') startTicker();
  else stopTicker();
}, { immediate: true });

onBeforeUnmount(() => {
  stopTicker();
  if (cancelLeaveSpring) { cancelLeaveSpring(); cancelLeaveSpring = null; }
});

onBeforeUnmount(stopTicker);
</script>

<style scoped>
.rlp-root {
  background: var(--md-reader-paper);
  color: var(--md-on-surface);
  gap: 24px;
}
.rlp-cover {
  /* 与 readerTransition 的 TARGET_COVER_WIDTH / min(176px, 42vw) 保持一致 */
  width: min(176px, 42vw);
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--md-elevation-card-soft);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  position: relative;
  background: var(--md-surface-high);
}
.rlp-cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rlp-cover.is-art {
  background: linear-gradient(160deg, var(--md-primary), color-mix(in oklab, var(--md-primary) 52%, var(--md-tertiary)));
  color: var(--md-on-primary);
}
.rlp-art-word {
  font-family: var(--md-font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.18em;
  opacity: 0.82;
}
.rlp-art-title {
  font-weight: 700;
  font-size: 13px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rlp-meta {
  text-align: center;
  max-width: 248px;
}
.rlp-title {
  font-size: 17px;
  font-weight: 700;
  margin: 0 0 6px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rlp-status {
  font-size: 12px;
  color: var(--md-on-surface-variant);
  margin: 0;
}
.rlp-bar {
  width: 148px;
  height: 3px;
  border-radius: 999px;
  background: var(--md-surface-highest);
  overflow: hidden;
  position: relative;
}
.rlp-bar i {
  position: absolute;
  left: -36%;
  top: 0;
  height: 100%;
  width: 34%;
  border-radius: 999px;
  background: var(--md-primary);
  animation: rlp-indet 1.15s var(--md-ease-emphasized) infinite;
}
@keyframes rlp-indet {
  0% { left: -36%; width: 30%; }
  55% { width: 46%; }
  100% { left: 100%; width: 26%; }
}
.rlp-hint {
  font-size: 11px;
  color: var(--md-on-surface-variant);
  opacity: 0.8;
  margin: 0;
}
.rlp-err-icon {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 700;
  color: var(--md-error);
  background: color-mix(in oklab, var(--md-error) 14%, transparent);
}
.rlp-err-msg {
  font-size: 13px;
  line-height: 1.5;
  max-width: 240px;
  text-align: center;
  margin: 0;
}
.rlp-retry {
  border: 0;
  cursor: pointer;
  padding: 10px 24px;
  border-radius: 999px;
  background: var(--md-primary);
  color: var(--md-on-primary);
  font: 600 13px var(--md-font-sans, inherit);
  box-shadow: var(--md-shadow-color-soft) 0 1px 3px;
  transition: transform 180ms var(--md-ease-emphasized);
}
.rlp-retry:active { transform: scale(0.95); }
.rlp-back {
  border: 0;
  background: transparent;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  cursor: pointer;
  padding: 6px 10px;
}

.rlp-enter-active { transition: opacity 260ms var(--md-ease-emphasized); }
.rlp-leave-active { transition: opacity 520ms var(--md-ease-emphasized); }
.rlp-enter-from, .rlp-leave-to { opacity: 0; }

/* 离场：整页背景淡出，居中的封面由弹簧（ζ=1 临界阻尼）逐帧驱动展开消散，
   逐帧 style 由 playLeaveSpring 写入，这里只管背景与零碎元素的收尾。 */
.rlp-root.is-leaving { transition: opacity 520ms var(--md-ease-emphasized); opacity: 0; }
.rlp-cover { transform-origin: center center; will-change: transform, opacity, filter; }
/* 文字、进度条与提示先行淡出，避免放大时露出底下的零碎元素 */
.rlp-root.is-leaving .rlp-meta,
.rlp-root.is-leaving .rlp-bar,
.rlp-root.is-leaving .rlp-hint {
  transition: opacity 180ms var(--md-ease-emphasized);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .rlp-enter-active, .rlp-leave-active { transition-duration: 0.01ms; }
  .rlp-root.is-leaving { transition-duration: 0.01ms; }
  .rlp-bar i { animation-duration: 2s; }
}
</style>
