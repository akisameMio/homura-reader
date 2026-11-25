<template>
  <div
    v-if="shown"
    ref="rootEl"
    class="rlp-root reader-surface fixed inset-0 z-[55]"
    :class="{ 'is-leaving': leaving }"
    :data-reader-mode="theme.readerSurfaceMode"
    @wheel.prevent
  >
    <div class="rlp-surface" @animationend.self="finishReveal">
      <template v-if="phase !== 'error'">
        <div class="rlp-cover-shadow">
          <div ref="coverEl" class="rlp-cover" :class="{ 'is-art': !cover }" :style="{ '--rlp-cover-ratio': coverRatio }">
            <img v-if="cover" :src="cover" alt="" draggable="false" @load="onCoverLoad" />
            <template v-else>
              <span class="rlp-art-word">HOMURA</span>
              <span class="rlp-art-title">{{ title }}</span>
            </template>
          </div>
        </div>
        <div class="rlp-meta" role="status" aria-live="polite">
          <p class="rlp-title">{{ title }}</p>
          <p class="rlp-status font-mono">{{ t(status) }}</p>
          <div class="rlp-bar" aria-hidden="true"><i :class="{ 'is-rendering': rendering }"></i></div>
        </div>
      </template>

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
import { playShelfToReaderSplash } from '../services/readerTransition.ts';
import { useI18n } from '../composables/useI18n.ts';
import { useThemeStore } from '../stores/theme.ts';

const { t } = useI18n();
const theme = useThemeStore();

const props = defineProps({
  visible: { type: Boolean, default: false },
  reveal: { type: Boolean, default: false },
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
const leaving = ref(false);
const rootEl = shallowRef<HTMLElement | null>(null);
const coverEl = shallowRef<HTMLElement | null>(null);
const coverRatio = ref(3 / 4);
let flight: ReturnType<typeof playShelfToReaderSplash> = null;
let revealTimer: number | undefined;

function onCoverLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image.naturalHeight) coverRatio.value = image.naturalWidth / image.naturalHeight;
}

async function flyCoverFrom(source?: HTMLElement | null) {
  if (!source || prefersReducedMotion()) return;
  const image = source.querySelector('img');
  if (image) {
    if (!image.naturalHeight) return;
    coverRatio.value = image.naturalWidth / image.naturalHeight;
  }
  await nextTick();
  if (!props.visible || props.phase !== 'loading' || !rootEl.value || !coverEl.value) return;
  flight = playShelfToReaderSplash(source, coverEl.value, rootEl.value);
  await flight?.finished;
  flight = null;
}

defineExpose({ flyCoverFrom });

function hide() {
  window.clearTimeout(revealTimer);
  leaving.value = false;
  shown.value = false;
  theme.setReaderLoadingActive(false);
}

function finishReveal() {
  if (!leaving.value || props.visible) return;
  hide();
  emit('revealed');
}

watch(() => [props.visible, props.reveal, props.phase] as const, ([visible, reveal, phase]) => {
  window.clearTimeout(revealTimer);
  if (!visible || phase === 'error') flight?.cancel();
  if (visible) {
    leaving.value = false;
    shown.value = true;
    theme.setReaderLoadingActive(true);
  } else if (shown.value && reveal && !prefersReducedMotion()) {
    leaving.value = true;
    // 动画事件不可用时也能结束揭幕。
    revealTimer = window.setTimeout(finishReveal, 360);
  } else if (shown.value) {
    hide();
    if (reveal) emit('revealed');
  }
}, { immediate: true });

watch(() => props.cover, () => { coverRatio.value = 3 / 4; });

onBeforeUnmount(() => {
  flight?.cancel();
  hide();
});
</script>

<style scoped>
.rlp-root {
  --rlp-ease: cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
}
.rlp-surface {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 24px 32px;
  background: color-mix(in oklab, var(--md-reader-paper) 88%, var(--md-surface-low));
  color: var(--md-reader-ink);
}
.rlp-cover-shadow {
  filter: drop-shadow(0 7px 15px color-mix(in oklab, var(--md-shadow-color-soft) 22%, transparent));
}
.rlp-cover {
  width: min(176px, 42vw, calc(40dvh * var(--rlp-cover-ratio)));
  aspect-ratio: var(--rlp-cover-ratio);
  border-radius: 12px;
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
  text-align: center;
  width: min(100%, 248px);
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
  height: 100%;
  border-radius: inherit;
  background: var(--md-primary);
  transform-origin: left center;
  transform: scaleX(0.28);
  transition: transform 200ms var(--rlp-ease);
}
.rlp-bar i.is-rendering { transform: scaleX(0.68); }
.rlp-root.is-leaving .rlp-bar i {
  transform: scaleX(1);
  transition-duration: 32ms;
}
/* 封面先淡出，揭幕时首屏即使也是封面，也只会出现一个构图。 */
.rlp-root.is-leaving .rlp-cover-shadow {
  animation: rlp-cover-out 60ms var(--rlp-ease) 20ms both;
}
.rlp-root.is-leaving .rlp-meta {
  animation: rlp-meta-out 68ms var(--rlp-ease) 32ms both;
}
.rlp-root.is-leaving .rlp-surface {
  animation: rlp-reveal 240ms var(--rlp-ease) 80ms both;
}
@keyframes rlp-cover-out {
  to { opacity: 0; }
}
@keyframes rlp-meta-out {
  to { opacity: 0; transform: translateY(-7px); }
}
@keyframes rlp-reveal {
  to { opacity: 0; transform: scale(1.05); }
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
  .rlp-bar i, .rlp-retry { transition: none; }
  .rlp-root.is-leaving .rlp-cover-shadow,
  .rlp-root.is-leaving .rlp-meta,
  .rlp-root.is-leaving .rlp-surface { animation: none; }
}
</style>
