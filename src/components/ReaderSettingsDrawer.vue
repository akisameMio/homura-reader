<template>
  <!-- 阅读设置：桌面右侧 Side Sheet（372px）/ 手机 Bottom Sheet（最大 78dvh） -->
  <Transition
    enter-active-class="md-fade-enter-active"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="md-fade-leave-active"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="ui.settingsOpen" class="absolute inset-0 z-40 md-scrim" @click="ui.closeSettings()"></div>
  </Transition>

  <Transition
    enter-active-class="md-sheet-enter-active"
    :enter-from-class="isCompact ? 'translate-y-full' : 'translate-x-full'"
    :enter-to-class="isCompact ? 'translate-y-0' : 'translate-x-0'"
    leave-active-class="md-sheet-leave-active"
    :leave-from-class="isCompact ? 'translate-y-0' : 'translate-x-0'"
    :leave-to-class="isCompact ? 'translate-y-full' : 'translate-x-full'"
  >
    <aside
      v-if="ui.settingsOpen"
      ref="settingsSheetRef"
      id="reader-settings-drawer"
      class="md-drawer"
      aria-labelledby="reader-settings-title"
    >
      <ReaderDrawerHeader
        :is-compact="isCompact"
        title="阅读设置"
        subtitle="排版、外观与自定义封面"
        title-id="reader-settings-title"
        close-label="关闭阅读设置"
        @close="ui.closeSettings()"
        @drag-start="onSheetDragStart"
        @drag-move="onSheetDragMove"
        @drag-end="onSheetDragEnd"
        @drag-cancel="onSheetDragCancel"
      />

      <!-- 字号预览：固定顶在控件上方，改字号 / 字体 / 行距时即时反馈 -->
      <div v-if="!isManga" class="reader-type-preview-wrap">
        <div class="reader-type-preview" :style="{ '--reader-preview-pad': previewPadX }" aria-hidden="true">
          <div class="reader-type-preview-head">
            <span class="reader-type-preview-glyph"><b>大</b><span>小</span></span>
            <span class="reader-type-preview-meta">{{ config.fontSize }} px · {{ fontLabel }}</span>
          </div>
          <p class="reader-type-preview-text" :style="previewTextStyle">
            吃完晚饭，沿着海滩散步，找一个完美地点来读完目前看的书并开始新书。夜色漫上来，海风把纸页吹得沙沙作响。
          </p>
        </div>
      </div>

      <div
        ref="scrollRef"
        class="md-drawer-body reader-settings-scroll px-5 min-[900px]:px-6"
        :class="{ 'has-overflow': hasOverflow }"
        :style="{ overflowY: hasOverflow ? 'auto' : 'hidden' }"
      >
        <div ref="contentRef" class="pb-2">
        <!-- 字号 -->
        <section v-if="!isManga" class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">字号</span>
            <b class="md-drawer-group-value">{{ config.fontSize }} px</b>
          </div>
          <div class="reader-font-control">
            <button
              type="button"
              class="reader-font-step"
              @click="reader.changeFontSize(-NOVEL_FONT_STEP)"
              :disabled="config.fontSize <= NOVEL_FONT_MIN"
              title="减小字号"
              aria-label="减小字号"
            >A−</button>
            <MdRange
              class="reader-font-range"
              variant="bubble"
              :model-value="config.fontSize"
              :min="NOVEL_FONT_MIN"
              :max="NOVEL_FONT_MAX"
              :step="NOVEL_FONT_STEP"
              :value-label="String(config.fontSize)"
              aria-label="小说字号滑块"
              @update:model-value="reader.setFontSize"
            />
            <button
              type="button"
              class="reader-font-step"
              @click="reader.changeFontSize(NOVEL_FONT_STEP)"
              :disabled="config.fontSize >= NOVEL_FONT_MAX"
              title="增大字号"
              aria-label="增大字号"
            >A+</button>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]">{{ NOVEL_FONT_MIN }}–{{ NOVEL_FONT_MAX }} px · 每页行数随字号和窗口自动调整，按书记忆。</p>
        </section>

        <!-- 行距 -->
        <section v-if="!isManga" class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">行距</span>
            <b class="md-drawer-group-value">{{ lineHeightLabel }}</b>
          </div>
          <MdSegmentedControl
            class="w-full"
            :model-value="config.lineHeight"
            :options="lineHeightOptions"
            aria-label="行距"
            @update:model-value="reader.setLineHeight"
          />
        </section>

        <!-- 页边距：只影响分页排版，条漫长卷保持卡片宽度 -->
        <section v-if="!isManga && !isVertical" class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">页边距</span>
            <b class="md-drawer-group-value">{{ pageMarginLabel }}</b>
          </div>
          <MdSegmentedControl
            class="w-full"
            :model-value="config.pageMargin"
            :options="pageMarginOptions"
            aria-label="页边距"
            @update:model-value="reader.setPageMargin"
          />
        </section>

        <!-- 阅读方向 -->
        <section v-if="!isVertical" class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">阅读方向</span>
            <b class="md-drawer-group-value">{{ directionLabel }}</b>
          </div>
          <MdSegmentedControl
            class="w-full"
            :model-value="config.direction"
            :options="directions"
            aria-label="阅读方向"
            @update:model-value="reader.setDirection"
          />
        </section>

        <!-- 翻页布局 -->
        <section v-if="!isVertical || isManga" class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">{{ isVertical ? '滚动尺寸' : '翻页布局' }}</span>
            <b class="md-drawer-group-value">{{ spreadLabel }}</b>
          </div>
          <MdSegmentedControl
            v-if="!isVertical && allowSpreadChoice"
            class="w-full"
            :model-value="config.spread"
            :options="spreadOptions"
            aria-label="翻页布局"
            @update:model-value="value => reader.setSpreadCount(Number(value))"
          />

          <p v-if="!isVertical && !allowSpreadChoice" class="mt-3 text-[13px] leading-relaxed text-[var(--md-on-surface-variant)]">
            当前屏幕按单页显示，窗口变宽后可选择双页。
          </p>

          <MdSwitch
            v-if="!isManga && !isVertical"
            class="mt-3.5"
            :model-value="config.verticalText"
            title="文字从上往下，各列从右往左排列"
            @update:model-value="reader.setVerticalText"
          >
            <span class="text-[13px] font-medium">竖排文字</span>
          </MdSwitch>

          <MdSwitch
            v-if="!isVertical && allowSpreadChoice && config.spread === 2"
            class="mt-3.5"
            :model-value="config.coverOffset"
            title="双页模式下首页单独显示，确保后续跨页大图对齐"
            @update:model-value="reader.toggleCoverOffset()"
          >
            <span class="text-[13px] font-medium">首页单排</span>
          </MdSwitch>

          <MdSegmentedControl
            v-if="isVertical && isManga"
            class="w-full mt-3.5"
            :model-value="config.webtoonFit"
            :options="webtoonFits"
            aria-label="滚动尺寸"
            @update:model-value="reader.setWebtoonFit"
          />
        </section>

        <!-- 音量键翻页：仅 Android 原生插件提供，音量键在 WebView 里收不到 keydown -->
        <section v-if="isAndroid" class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">音量键翻页</span>
            <b class="md-drawer-group-value">{{ settings.volumeKeysTurnPage ? '已开启' : '已关闭' }}</b>
          </div>
          <MdSwitch
            :model-value="settings.volumeKeysTurnPage"
            title="音量加键上一页、音量减键下一页"
            @update:model-value="settings.setVolumeKeysTurnPage"
          >
            <span class="text-[13px] font-medium">用音量键翻页</span>
          </MdSwitch>
          <p class="mt-2 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]">音量加键上一页、音量减键下一页；该设置全局生效，关闭后音量键照常调节系统音量。</p>
        </section>

        <!-- 外观 -->
        <section class="md-drawer-section">
          <div class="md-drawer-group-head">
            <span class="md-drawer-group-label">阅读模式</span>
            <b class="md-drawer-group-value">{{ modeLabel }}</b>
          </div>
          <SurfaceModePreview surface="reader" />

          <div class="md-drawer-group-head mt-4">
            <span class="md-drawer-group-label">翻页方式</span>
            <b class="md-drawer-group-value">{{ TRANSITION_LABELS[reader.transitionStyle] }}</b>
          </div>
          <MdSegmentedControl
            class="w-full"
            :model-value="reader.transitionStyle"
            :options="transitionOptions"
            aria-label="翻页方式"
            @update:model-value="reader.setTransitionStyle"
          />
        </section>
        <section class="md-drawer-section">
          <h3 class="md-drawer-group-label mb-3">自定义封面</h3>
          <div class="flex items-center gap-3">
            <div class="reader-cover-preview">
              <img v-if="currentCover" :src="currentCover" alt="当前书本封面" />
              <span v-else class="text-[11px] text-center px-1">暂无封面</span>
            </div>
            <div class="flex-1 min-w-0">
              <input ref="coverInput" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.bmp" class="hidden" aria-label="选择自定义封面图片" @change="onCoverSelected" />
              <button type="button" class="md-tonal-button w-full" :disabled="coverBusy" @click="coverInput?.click()">{{ coverBusy ? '正在保存…' : '选择封面图片' }}</button>
              <button v-if="hasCustomCover" type="button" class="md-text-button w-full mt-1" :disabled="coverBusy" @click="saveCover(null)">恢复原封面</button>
              <p class="mt-2 text-[11px] leading-relaxed text-[var(--md-on-surface-variant)]">图片仅保存在本机，不修改原书文件。</p>
            </div>
          </div>
          <p v-if="reader.currentBook?.id.startsWith('demo_')" class="mt-2 text-[11px] text-[var(--md-on-surface-variant)]">示例书封面仅在本次打开期间保留。</p>
          <p v-if="coverError" role="alert" class="mt-2 text-[13px] text-[var(--md-error)]">{{ coverError }}</p>
        </section>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="md-drawer-actions">
        <button
          type="button"
          @click="resetDefaults"
          class="md-text-button"
        >恢复默认</button>
        <button
          type="button"
          @click="ui.closeSettings()"
          class="md-filled-button"
        >完成</button>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, nextTick } from 'vue';
import { useReaderStore, WEBTOON_FIT_LABELS, NOVEL_FONT_MIN, NOVEL_FONT_MAX, NOVEL_FONT_STEP } from '../stores/reader.ts';
import {
  READER_FONT_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  READER_MARGIN_OPTIONS,
  resolveFontStack,
  resolveLineHeight
} from '../services/readerLayout.ts';
import { isAndroid } from '../services/platform.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useShelfStore } from '../stores/shelf.ts';
import {
  READER_SURFACE_MODE_OPTIONS,
  TRANSITION_LABELS,
  TRANSITION_OPTIONS,
  useThemeStore
} from '../stores/theme.ts';
import { useUiStore } from '../stores/ui.ts';
import { useViewport } from '../composables/useViewport.ts';
import { useSheetDrag } from '../composables/useSheetDrag.ts';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import MdRange from './MdRange.vue';
import MdSegmentedControl from './MdSegmentedControl.vue';
import MdSwitch from './MdSwitch.vue';
import SurfaceModePreview from './SurfaceModePreview.vue';

const reader = useReaderStore();
const shelf = useShelfStore();
const scrollRef = shallowRef<HTMLElement | null>(null);
const contentRef = shallowRef<HTMLElement | null>(null);
const coverInput = shallowRef<HTMLInputElement | null>(null);
const hasOverflow = ref(false);
const coverBusy = ref(false);
const coverError = ref('');
const coverBook = computed(() => shelf.library.find(book => book.id === reader.currentBook?.id));
const currentCover = computed(() => coverBook.value?.cover || null);
const hasCustomCover = computed(() => !!(coverBook.value)?.customCoverBlob);
watch(() => reader.currentBook?.id, () => { coverError.value = ''; });
watch([scrollRef, contentRef], ([scroll, content], _previous, onCleanup) => {
  if (!scroll || !content) return;
  const update = () => { hasOverflow.value = scroll.scrollHeight > scroll.clientHeight + 1; };
  const observer = new ResizeObserver(update);
  observer.observe(scroll);
  observer.observe(content);
  nextTick(update);
  onCleanup(() => observer.disconnect());
}, { flush: 'post' });

async function saveCover(file: File | null) {
  if (coverBusy.value) return;
  coverError.value = '';
  coverBusy.value = true;
  try {
    await reader.setCustomCover(file);
  } catch (err) {
    coverError.value = (err as Error).message || '封面保存失败，请重试';
  } finally {
    coverBusy.value = false;
  }
}

function onCoverSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) saveCover(file);
}
const theme = useThemeStore();
const ui = useUiStore();
const settings = useSettingsStore();
const { isPhone, isCompact } = useViewport();
const config = reader.layoutConfig;
const lineHeightOptions = READER_LINE_HEIGHT_OPTIONS.map(option => ({ value: option.value, label: option.label }));
const pageMarginOptions = READER_MARGIN_OPTIONS.map(option => ({ value: option.value, label: option.label }));
const lineHeightLabel = computed(() => (READER_LINE_HEIGHT_OPTIONS.find(option => option.value === config.lineHeight) || READER_LINE_HEIGHT_OPTIONS[1]).label);
const pageMarginLabel = computed(() => (READER_MARGIN_OPTIONS.find(option => option.value === config.pageMargin) || READER_MARGIN_OPTIONS[1]).label);
const fontLabel = computed(() => (READER_FONT_OPTIONS.find(option => option.value === config.fontFamily) || READER_FONT_OPTIONS[0]).label);
const previewTextStyle = computed(() => ({
  fontFamily: resolveFontStack(config.fontFamily),
  fontSize: `${config.fontSize}px`,
  lineHeight: String(resolveLineHeight(config.lineHeight))
}));
const previewPadX = computed(() => (config.pageMargin === 'narrow' ? '16px' : config.pageMargin === 'wide' ? '32px' : '24px'));
const settingsOpen = computed(() => ui.settingsOpen);
const {
  onDragStart: onSheetDragStart,
  onDragMove: onSheetDragMove,
  onDragEnd: onSheetDragEnd,
  onDragCancel: onSheetDragCancel
} = useSheetDrag({
  isCompact,
  isOpen: settingsOpen,
  onClose: () => ui.closeSettings()
});

const isVertical = computed(() => config.direction === 'vertical');
const isManga = computed(() => reader.currentBook && reader.currentBook.type === 'manga');
const allowSpreadChoice = computed(() => isManga.value ? !isPhone.value : !isCompact.value);

const directions = [
  { value: 'ltr', label: '从左到右', title: '普通排版' },
  { value: 'rtl', label: '从右到左', title: '日漫' }
];

const transitionOptions = TRANSITION_OPTIONS;

const spreadOptions = [
  { value: 1, label: '单页' },
  { value: 2, label: '双页' }
];

const webtoonFits = [
  { value: 'screen', label: WEBTOON_FIT_LABELS.screen },
  { value: 'medium', label: WEBTOON_FIT_LABELS.medium },
  { value: 'wide', label: WEBTOON_FIT_LABELS.wide }
];

const directionLabel = computed(() => (directions.find(d => d.value === config.direction) || directions[0]).label);
const spreadLabel = computed(() => (isVertical.value ? '长卷' : (allowSpreadChoice.value && config.spread === 2 ? '双页' : '单页')));
const modeLabel = computed(() => (READER_SURFACE_MODE_OPTIONS.find(option => option.value === theme.readerSurfaceMode) || READER_SURFACE_MODE_OPTIONS[2]).label);

// 恢复默认：全部走 store 已有的公开动作，不改动 store API
function resetDefaults() {
  reader.setDirection('ltr');
  reader.setVerticalText(false);
  if (reader.layoutConfig.spread !== 2) reader.setSpreadCount(2);
  if (!reader.layoutConfig.coverOffset) reader.toggleCoverOffset();
  reader.setWebtoonFit('screen');
  reader.setFontSize(18);
  reader.setFontFamily('song');
  reader.setLineHeight('normal');
  reader.setPageMargin('normal');
}
</script>

<style scoped>
.reader-settings-scroll { scrollbar-gutter: auto; }
.reader-settings-scroll:not(.has-overflow) { scrollbar-width: none; }
.reader-settings-scroll:not(.has-overflow)::-webkit-scrollbar { display: none; }
.reader-settings-scroll::-webkit-scrollbar-thumb { background: var(--md-outline); }
.reader-font-control {
  display: flex;
  align-items: center;
  gap: 8px;
}
.reader-font-range {
  min-width: 0;
  flex: 1;
}
.reader-font-step {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 21px;
  font-weight: 420;
  letter-spacing: -0.02em;
  cursor: pointer;
  transition: background-color var(--md-duration-short) var(--md-ease-emphasized);
}
.reader-font-step:disabled {
  opacity: 0.35;
  cursor: default;
}
@media (hover: hover) and (pointer: fine) {
  .reader-font-step:hover:not(:disabled) { background: var(--md-surface-high); }
}
.reader-cover-preview {
  display: grid;
  width: 60px;
  aspect-ratio: 3 / 4;
  flex-shrink: 0;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--md-outline-variant);
  border-radius: 12px;
  background: var(--md-surface-high);
  color: var(--md-on-surface-variant);
}
.reader-cover-preview img { width: 100%; height: 100%; object-fit: cover; }
</style>
