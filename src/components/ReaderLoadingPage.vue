<template>
  <div v-if="shown" class="rlp-paper reader-surface" :data-reader-mode="theme.readerSurfaceMode" aria-hidden="true">
    <div ref="underlayEl" class="rlp-backdrop rlp-underlay"></div>
  </div>
  <div
    v-if="shown"
    ref="rootEl"
    class="rlp-root reader-surface fixed inset-0 z-[55]"
    :data-opening-motion="motion"
    :data-reader-mode="theme.readerSurfaceMode"
    @wheel.prevent
  >
    <div ref="backdropEl" class="rlp-backdrop"></div>
    <div class="rlp-surface" :class="{ 'has-error': phase === 'error' }">
      <div v-if="phase !== 'error'" class="rlp-cover-stack">
        <div ref="shadowEl" class="rlp-cover-shadow"></div>
        <div ref="coverEl" class="rlp-cover" :class="{ 'is-art': !cover }" :style="{ '--rlp-cover-ratio': coverRatio }">
          <img v-if="cover" :src="cover" alt="" draggable="false" @load="onCoverLoad" />
          <template v-else>
            <span class="rlp-art-word">HOMURA</span>
            <span class="rlp-art-title">{{ title }}</span>
          </template>
        </div>
        <div ref="metaEl" class="rlp-meta">
          <p class="rlp-title">{{ title }}</p>
          <p class="rlp-status font-mono" role="status">{{ t(status) }}</p>
          <div ref="barEl" class="rlp-bar" role="progressbar" :aria-label="t(status)" aria-valuenow="0">
            <i ref="fillEl"></i>
          </div>
        </div>
      </div>

      <template v-else>
        <div class="rlp-err-icon" aria-hidden="true">!</div>
        <p class="rlp-err-msg" role="alert">{{ message }}</p>
        <button type="button" class="rlp-retry md-hit-target" @click="$emit('retry')">{{ t('重新加载') }}</button>
        <button v-if="canRelink" type="button" class="rlp-back md-hit-target" @click="$emit('relink')">{{ t('重新定位原文件') }}</button>
        <button type="button" class="rlp-back font-mono" @click="$emit('cancel')">{{ t('返回书架') }}</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { PropType } from 'vue';
import { prefersReducedMotion } from '../services/spring.ts';
import {
  advanceReaderProgress, playReaderOpening, playShelfToReaderSplash, sprintReaderProgress,
  READER_OPEN_CLEAR_MS, READER_OPEN_FAST_MS, READER_OPEN_SPRINT_MS, type ReaderOpeningFrame
} from '../services/readerTransition.ts';
import { useI18n } from '../composables/useI18n.ts';
import { useThemeStore } from '../stores/theme.ts';

const { t } = useI18n();
const theme = useThemeStore();

const props = defineProps({
  visible: { type: Boolean, default: false },
  reveal: { type: Boolean, default: false },
  frame: { type: Object as PropType<ReaderOpeningFrame | null>, default: null },
  rendering: { type: Boolean, default: false },
  phase: { type: String as PropType<'loading' | 'error'>, default: 'loading' },
  title: { type: String, default: '' },
  cover: { type: String, default: '' },
  canRelink: { type: Boolean, default: false },
  message: { type: String, default: '无法加载这本书，请重试。' }
});

const emit = defineEmits(['retry', 'cancel', 'relink', 'revealed']);
const status = computed(() => props.rendering ? '正在准备首屏…' : '正在解析内容…');
const shown = ref(false);
const motion = ref<'waiting' | 'sprint' | 'clear' | 'expand'>('waiting');
const rootEl = shallowRef<HTMLElement | null>(null);
const backdropEl = shallowRef<HTMLElement | null>(null);
const underlayEl = shallowRef<HTMLElement | null>(null);
const coverEl = shallowRef<HTMLElement | null>(null);
const shadowEl = shallowRef<HTMLElement | null>(null);
const metaEl = shallowRef<HTMLElement | null>(null);
const barEl = shallowRef<HTMLElement | null>(null);
const fillEl = shallowRef<HTMLElement | null>(null);
const coverRatio = ref(3 / 4);
let flight: ReturnType<typeof playShelfToReaderSplash> = null;
let opening: ReturnType<typeof playReaderOpening> = null;
let progressFrame: number | undefined;
let displayProgress = 0;
let shownAt = 0;
let lastFrame = 0;
let sprintAt = 0;
let sprintFrom = 0;
let lastAnnounced = 0;

function onCoverLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image.naturalHeight) coverRatio.value = image.naturalWidth / image.naturalHeight;
}

async function flyCoverFrom(source?: HTMLElement | null) {
  if (!source || prefersReducedMotion()) return;
  const image = source.querySelector('img');
  if (image && !image.naturalHeight) return;
  if (image) coverRatio.value = image.naturalWidth / image.naturalHeight;
  await nextTick();
  if (!props.visible || props.phase !== 'loading' || !source.isConnected || !rootEl.value || !coverEl.value || !shadowEl.value) return;
  const shadow = shadowEl.value;
  const running = playShelfToReaderSplash(source, coverEl.value, rootEl.value);
  if (!running) return;
  shadow.style.visibility = 'hidden';
  flight = running;
  await running.finished;
  // 旧飞行动画的清理不能改写重试时的新封面。
  if (!flight || flight === running) shadow.style.visibility = '';
  if (flight === running) flight = null;
}

defineExpose({ flyCoverFrom });

function stopMotion() {
  if (progressFrame !== undefined) cancelAnimationFrame(progressFrame);
  progressFrame = undefined;
  flight?.cancel();
  flight = null;
  opening?.cancel();
  opening = null;
}

function hide() {
  stopMotion();
  shown.value = false;
  theme.setReaderLoadingActive(false);
}

function finishReveal() {
  if (!shown.value || !props.reveal || props.visible) return;
  hide();
  emit('revealed');
}

function clearLoadingContent() {
  progressFrame = undefined;
  const layer = rootEl.value;
  const backdrop = backdropEl.value;
  const underlay = underlayEl.value;
  const face = coverEl.value;
  const shadow = shadowEl.value;
  const meta = metaEl.value;
  const frame = props.frame;
  if (layer && backdrop && underlay && face && shadow && meta && frame) {
    motion.value = 'clear';
    opening = playReaderOpening({
      layer, backdrop, underlay, face, shadow, meta, frame,
      onExpand: () => {
        flight?.cancel();
        flight = null;
        motion.value = 'expand';
      },
      onFinish: finishReveal
    });
  }
  if (!opening) finishReveal();
}

function paintProgress() {
  if (fillEl.value) fillEl.value.style.transform = `scaleX(${displayProgress / 100})`;
  const announced = Math.floor(displayProgress);
  if (announced !== lastAnnounced) {
    lastAnnounced = announced;
    barEl.value?.setAttribute('aria-valuenow', String(announced));
  }
}

function tickProgress(now: number) {
  if (props.reveal) {
    displayProgress = prefersReducedMotion() ? 100 : sprintReaderProgress(sprintFrom, Math.max(0, now - sprintAt));
  } else {
    const dt = Math.max(0, (now - lastFrame) / 1000);
    displayProgress = advanceReaderProgress(displayProgress, props.rendering, dt, now - shownAt >= READER_OPEN_FAST_MS);
  }
  lastFrame = now;
  paintProgress();
  // 留出完整的满格帧，再开始清场。
  progressFrame = requestAnimationFrame(displayProgress === 100 ? clearLoadingContent : tickProgress);
}

function startProgress() {
  motion.value = 'waiting';
  displayProgress = lastAnnounced = 0;
  shownAt = lastFrame = performance.now();
  if (fillEl.value) fillEl.value.style.transform = 'scaleX(0)';
  barEl.value?.setAttribute('aria-valuenow', '0');
  progressFrame = requestAnimationFrame(tickProgress);
}

watch(() => [props.visible, props.reveal, props.phase] as const, ([visible, reveal, phase], previous) => {
  if (visible) {
    shown.value = true;
    theme.setReaderLoadingActive(true);
    if (phase === 'error') stopMotion();
    else if (!previous?.[0] || previous[2] === 'error') {
      stopMotion();
      startProgress();
    }
  } else if (shown.value && reveal && phase === 'loading') {
    motion.value = 'sprint';
    sprintAt = performance.now();
    sprintFrom = displayProgress;
    // 首屏秒开时，封面可在进度冲刺和文案退场期间继续飞行。
    flight?.settleWithin(READER_OPEN_SPRINT_MS + READER_OPEN_CLEAR_MS);
  } else if (shown.value) {
    hide();
  }
}, { immediate: true });

watch(() => props.cover, () => { coverRatio.value = 3 / 4; });
onBeforeUnmount(hide);
</script>

<style scoped>
.rlp-root {
  --rlp-flight-shadow: drop-shadow(0 7px 15px color-mix(in oklab, var(--md-shadow-color-soft) 22%, transparent));
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
}
.rlp-paper {
  position: fixed;
  inset: 0;
  z-index: 49;
  pointer-events: none;
  background: var(--md-reader-paper);
}
.rlp-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at center, color-mix(in oklab, var(--md-primary) 8%, transparent), transparent 62%),
    color-mix(in oklab, var(--md-reader-paper) 88%, var(--md-surface-low));
}
.rlp-underlay {
  visibility: hidden;
}
.rlp-surface {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px 32px;
  color: var(--md-reader-ink);
}
.rlp-surface.has-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}
.rlp-cover-stack { position: relative; }
.rlp-cover-shadow {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  box-shadow: 0 7px 20px color-mix(in oklab, var(--md-shadow-color-soft) 30%, transparent);
  transform-origin: left top;
}
.rlp-root[data-opening-motion="clear"] .rlp-meta,
.rlp-root[data-opening-motion="expand"] .rlp-meta,
.rlp-root[data-opening-motion="expand"] .rlp-cover-shadow {
  will-change: transform, opacity;
}
.rlp-root[data-opening-motion="expand"] .rlp-cover {
  will-change: transform, opacity, clip-path;
}
.rlp-cover {
  width: min(176px, 42vw, calc(40dvh * var(--rlp-cover-ratio)));
  aspect-ratio: var(--rlp-cover-ratio);
  border-radius: 12px;
  transform-origin: left top;
  overflow: hidden;
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
  object-fit: contain;
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
  position: absolute;
  top: calc(100% + 24px);
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  width: min(calc(100vw - 64px), 248px);
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
  overflow-wrap: anywhere;
}
.rlp-status {
  font-size: 12px;
  color: var(--md-reader-ink-soft);
  margin: 0;
}
.rlp-bar {
  width: min(148px, 100%);
  height: 3px;
  margin: 16px auto 0;
  border-radius: 999px;
  background: var(--md-reader-rule);
  overflow: hidden;
}
.rlp-bar i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--md-primary);
  transform-origin: left center;
  transform: scaleX(0);
  will-change: transform;
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
  color: var(--md-reader-ink-soft);
  font-size: 12px;
  cursor: pointer;
  padding: 6px 10px;
}


@media (prefers-reduced-motion: reduce) {
  .rlp-retry { transition: none; }
}
</style>
