<template>
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
      class="md-drawer reader-settings-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-settings-title"
      @keydown="onSheetKeydown"
    >
      <ReaderDrawerHeader
        :is-compact="isCompact"
        prominent
        title="阅读设置"
        title-id="reader-settings-title"
        close-label="关闭阅读设置"
        @close="ui.closeSettings()"
        @drag-start="onSheetDragStart"
        @drag-move="onSheetDragMove"
        @drag-end="onSheetDragEnd"
        @drag-cancel="onSheetDragCancel"
      >
        <template #status>
          <span class="reader-settings-saved"><MdIcon name="check" :size="14" />自动保存</span>
        </template>
      </ReaderDrawerHeader>

      <div class="reader-settings-tabs" role="tablist" aria-label="阅读设置分类">
        <button
          v-for="(tab, index) in tabs"
          :id="`reader-settings-tab-${tab.value}`"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.value"
          :aria-controls="`reader-settings-panel-${tab.value}`"
          :tabindex="activeTab === tab.value ? 0 : -1"
          @click="selectTab(tab.value)"
          @keydown="onTabKeydown($event, index)"
        >{{ tab.label }}</button>
      </div>

      <div ref="scrollRef" class="md-drawer-body reader-settings-scroll">
        <div
          v-show="activeTab === 'layout'"
          id="reader-settings-panel-layout"
          role="tabpanel"
          aria-labelledby="reader-settings-tab-layout"
        >
          <!-- 预览随设置一起滚动，给实际控件留足空间。 -->
          <template v-if="!isManga">
            <section class="reader-settings-card reader-settings-preview" :style="{ paddingInline: previewPadX }" aria-label="排版预览">
              <div class="reader-settings-preview-head">
                <span><MdIcon name="auto_stories" :size="14" />排版预览</span>
                <span>{{ config.fontSize }} px · {{ fontLabel }}</span>
              </div>
              <p :style="previewTextStyle">夜色漫上来，海风把纸页吹得沙沙作响。</p>
            </section>

            <section class="reader-settings-card reader-settings-font" aria-labelledby="reader-font-size-label">
              <div class="reader-settings-row-head">
                <h3 id="reader-font-size-label">字号</h3>
                <span>{{ config.fontSize }} px</span>
              </div>
              <div class="reader-font-control">
                <button type="button" class="reader-font-step" :disabled="config.fontSize <= NOVEL_FONT_MIN" title="减小字号" aria-label="减小字号" @click="reader.changeFontSize(-NOVEL_FONT_STEP)">A−</button>
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
                <button type="button" class="reader-font-step" :disabled="config.fontSize >= NOVEL_FONT_MAX" title="增大字号" aria-label="增大字号" @click="reader.changeFontSize(NOVEL_FONT_STEP)">A+</button>
              </div>
              <p class="reader-settings-hint">{{ NOVEL_FONT_MIN }}–{{ NOVEL_FONT_MAX }} px · 自动分页，按书记忆</p>
            </section>

            <section class="reader-settings-card reader-settings-selects" aria-label="文字排版">
              <SettingsSelectRow label="字体" :model-value="config.fontFamily" :options="fontOptions" @update:model-value="value => reader.setFontFamily(String(value))" />
              <SettingsSelectRow label="行距" :model-value="config.lineHeight" :options="lineHeightOptions" @update:model-value="value => reader.setLineHeight(String(value))" />
              <SettingsSelectRow v-if="!isVertical" label="页边距" :model-value="config.pageMargin" :options="pageMarginOptions" @update:model-value="value => reader.setPageMargin(String(value))" />
            </section>
          </template>

          <template v-if="!isVertical || isManga">
            <h3 class="reader-settings-group-label">{{ isVertical ? '滚动尺寸' : '翻页布局' }}</h3>
            <section class="reader-settings-card">
              <div v-if="!isVertical" class="reader-settings-row">
                <h4 class="reader-settings-control-label">阅读方向</h4>
                <MdSegmentedControl class="reader-settings-segment" :model-value="config.direction" :options="directions" aria-label="阅读方向" @update:model-value="reader.setDirection" />
              </div>
              <div v-if="!isVertical" class="reader-settings-row">
                <h4 class="reader-settings-control-label">页面布局</h4>
                <MdSegmentedControl v-if="allowSpreadChoice" class="reader-settings-segment" :model-value="config.spread" :options="spreadOptions" aria-label="翻页布局" @update:model-value="value => reader.setSpreadCount(Number(value))" />
                <p v-else class="reader-settings-hint">当前屏幕按单页显示，窗口变宽后可选择双页。</p>
              </div>
              <div v-if="!isManga && !isVertical" class="reader-settings-row reader-settings-switch">
                <MdSwitch :model-value="config.verticalText" title="文字从上往下，各列从右往左排列" @update:model-value="reader.setVerticalText">竖排文字</MdSwitch>
              </div>
              <div v-if="!isVertical && allowSpreadChoice && config.spread === 2" class="reader-settings-row reader-settings-switch">
                <MdSwitch :model-value="config.coverOffset" title="双页模式下首页单独显示，确保后续跨页大图对齐" @update:model-value="reader.toggleCoverOffset()">首页单排</MdSwitch>
              </div>
              <div v-if="isVertical && isManga" class="reader-settings-row">
                <MdSegmentedControl class="reader-settings-segment" :model-value="config.webtoonFit" :options="webtoonFits" aria-label="滚动尺寸" @update:model-value="reader.setWebtoonFit" />
              </div>
            </section>
          </template>

          <template v-if="isAndroid">
            <h3 class="reader-settings-group-label">翻页控制</h3>
            <section class="reader-settings-card reader-settings-row">
              <MdSwitch :model-value="settings.volumeKeysTurnPage" title="音量加键上一页、音量减键下一页" @update:model-value="settings.setVolumeKeysTurnPage">音量键翻页</MdSwitch>
              <p class="reader-settings-hint">音量加键上一页、音量减键下一页；该设置全局生效。</p>
            </section>
          </template>
        </div>

        <div
          v-show="activeTab === 'appearance'"
          id="reader-settings-panel-appearance"
          role="tabpanel"
          aria-labelledby="reader-settings-tab-appearance"
        >
          <h3 class="reader-settings-group-label">阅读纸面</h3>
          <SurfaceModePreview surface="reader" cards />
          <p class="reader-settings-paper-hint">只调整阅读纸面，应用外观仍沿用全局设置。</p>
          <h3 class="reader-settings-group-label">翻页方式</h3>
          <section class="reader-settings-card">
            <div class="reader-settings-animation" :class="`is-${reader.transitionStyle}`" aria-hidden="true">
              <span class="reader-settings-page"><i></i><i></i><i></i><i></i><i></i></span>
              <span class="reader-settings-page"><i></i><i></i><i></i><i></i><i></i></span>
            </div>
            <div class="reader-settings-row">
              <MdSegmentedControl class="reader-settings-segment" :model-value="reader.transitionStyle" :options="transitionOptions" aria-label="翻页方式" @update:model-value="reader.setTransitionStyle" />
            </div>
          </section>
        </div>

        <div
          v-show="activeTab === 'cover'"
          id="reader-settings-panel-cover"
          role="tabpanel"
          aria-labelledby="reader-settings-tab-cover"
        >
          <h3 class="reader-settings-group-label">当前书本</h3>
          <section class="reader-settings-card reader-settings-cover">
            <div class="reader-cover-preview">
              <img v-if="currentCover" :src="currentCover" alt="当前书本封面" />
              <div v-else class="reader-cover-placeholder" aria-hidden="true"><MdIcon name="auto_stories" :size="32" /><span>{{ reader.currentBook?.title }}</span></div>
            </div>
            <h3>{{ reader.currentBook?.title }}</h3>
            <p class="reader-settings-hint">为这本书换一张喜欢的封面</p>
            <input ref="coverInput" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.bmp" class="hidden" aria-label="选择自定义封面图片" @change="onCoverSelected" />
            <button type="button" class="md-tonal-button reader-settings-upload" :disabled="coverBusy" @click="coverInput?.click()"><MdIcon name="upload_file" :size="18" />{{ coverBusy ? '正在保存…' : '选择封面图片' }}</button>
            <button v-if="hasCustomCover" type="button" class="md-text-button reader-settings-restore-cover" :disabled="coverBusy" @click="saveCover(null)">恢复原封面</button>
            <p v-if="reader.currentBook?.id.startsWith('demo_')" class="reader-settings-hint">示例书封面仅在本次打开期间保留。</p>
            <p v-if="coverError" role="alert" class="reader-settings-cover-error">{{ coverError }}</p>
          </section>
          <div class="reader-settings-card reader-settings-cover-note">
            <MdIcon name="folder_open" :size="20" />
            <div><p>仅保存在本机</p><p class="reader-settings-hint">更换封面不会修改原书文件。</p></div>
          </div>
        </div>
      </div>

      <div class="md-drawer-actions reader-settings-actions">
        <button type="button" class="md-text-button reader-settings-reset" @click="resetDefaults">恢复默认</button>
        <button type="button" class="md-filled-button" @click="ui.closeSettings()">完成</button>
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
import { TRANSITION_OPTIONS } from '../stores/theme.ts';
import { useUiStore } from '../stores/ui.ts';
import { useViewport } from '../composables/useViewport.ts';
import { useSheetDrag } from '../composables/useSheetDrag.ts';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import MdRange from './MdRange.vue';
import MdSegmentedControl from './MdSegmentedControl.vue';
import MdSwitch from './MdSwitch.vue';
import SurfaceModePreview from './SurfaceModePreview.vue';
import SettingsSelectRow from './SettingsSelectRow.vue';
import MdIcon from './MdIcon.vue';

const reader = useReaderStore();
const shelf = useShelfStore();
const scrollRef = shallowRef<HTMLElement | null>(null);
const coverInput = shallowRef<HTMLInputElement | null>(null);
const coverBusy = ref(false);
const coverError = ref('');
const coverBook = computed(() => shelf.library.find(book => book.id === reader.currentBook?.id));
const currentCover = computed(() => coverBook.value?.cover || null);
const hasCustomCover = computed(() => !!(coverBook.value)?.customCoverBlob);
watch(() => reader.currentBook?.id, () => { coverError.value = ''; });

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
const ui = useUiStore();
const settings = useSettingsStore();
const { isPhone, isCompact } = useViewport();
const config = reader.layoutConfig;
const lineHeightOptions = READER_LINE_HEIGHT_OPTIONS.map(option => ({ value: option.value, label: option.label }));
const pageMarginOptions = READER_MARGIN_OPTIONS.map(option => ({ value: option.value, label: option.label }));
const fontLabel = computed(() => (READER_FONT_OPTIONS.find(option => option.value === config.fontFamily) || READER_FONT_OPTIONS[0]).label);
const previewTextStyle = computed(() => ({
  fontFamily: resolveFontStack(config.fontFamily),
  fontSize: `${config.fontSize}px`,
  lineHeight: String(resolveLineHeight(config.lineHeight))
}));
const settingsOpen = computed(() => ui.settingsOpen);
const {
  sheetRef: settingsSheetRef,
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
const isManga = computed(() => reader.currentBook?.type === 'manga' || reader.currentBook?.format === 'pdf');
const allowSpreadChoice = computed(() => isManga.value ? !isPhone.value : !isCompact.value);

const directions = [
  { value: 'ltr', label: '从左到右', title: '普通排版', icon: 'chevron_right' },
  { value: 'rtl', label: '从右到左', title: '日漫', icon: 'chevron_left' }
];

const transitionOptions = TRANSITION_OPTIONS;

const spreadOptions = [
  { value: 1, label: '单页', icon: 'article' },
  { value: 2, label: '双页', icon: 'auto_stories' }
];

const webtoonFits = [
  { value: 'screen', label: WEBTOON_FIT_LABELS.screen },
  { value: 'medium', label: WEBTOON_FIT_LABELS.medium },
  { value: 'wide', label: WEBTOON_FIT_LABELS.wide }
];

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

type SettingsTab = 'layout' | 'appearance' | 'cover';
const activeTab = ref<SettingsTab>('layout');
const tabs: { value: SettingsTab; label: string }[] = [
  { value: 'layout', label: '排版' },
  { value: 'appearance', label: '外观' },
  { value: 'cover', label: '封面' }
];
const fontOptions = READER_FONT_OPTIONS;
const previewPadX = computed(() => (config.pageMargin === 'narrow' ? '16px' : config.pageMargin === 'wide' ? '28px' : '20px'));
let settingsTrigger: HTMLElement | null = null;

watch(settingsOpen, async open => {
  if (open) {
    settingsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeTab.value = 'layout';
    await nextTick();
    settingsSheetRef.value?.querySelector<HTMLButtonElement>('[aria-label="关闭阅读设置"]')?.focus({ preventScroll: true });
  } else {
    await nextTick();
    if (settingsTrigger?.isConnected && reader.currentBook && !ui.readerDrawerOpen) {
      settingsTrigger.focus({ preventScroll: true });
    }
    settingsTrigger = null;
  }
});

function selectTab(tab: SettingsTab) {
  activeTab.value = tab;
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  selectTab(tabs[next].value);
  settingsSheetRef.value?.querySelector<HTMLButtonElement>(`#reader-settings-tab-${tabs[next].value}`)?.focus();
}

function onSheetKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    ui.closeSettings();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [...(settingsSheetRef.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<style scoped>
.reader-settings-drawer {
  padding-bottom: 0;
  background: color-mix(in oklab, var(--md-surface-container) 65%, var(--md-surface-low));
}
.reader-settings-saved {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--md-on-surface-variant);
  font-size: 10px;
  white-space: nowrap;
}
.reader-settings-tabs {
  display: flex;
  flex: none;
  gap: 8px;
  padding: 0 20px 20px;
}
.reader-settings-tabs button {
  min-width: 0;
  min-height: 48px;
  flex: 1;
  border-radius: 26px;
  background: var(--md-surface);
  color: var(--md-on-surface-variant);
  font-size: 13px;
  font-weight: 600;
  transition: background-color 200ms var(--md-ease-emphasized), color 200ms var(--md-ease-emphasized);
}
.reader-settings-tabs button[aria-selected='true'] { background: var(--md-primary); color: var(--md-on-primary); }
.reader-settings-tabs button:focus-visible,
.reader-font-step:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 3px; }
.reader-settings-scroll {
  padding: 0 18px 20px;
  scrollbar-width: thin;
  scrollbar-color: var(--md-outline-variant) transparent;
}
.reader-settings-card {
  margin-bottom: 18px;
  overflow: hidden;
  border-radius: 26px;
  background: var(--md-surface);
  color: var(--md-on-surface);
}
.reader-settings-preview { padding-block: 18px; }
.reader-settings-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--md-on-surface-variant);
  font-size: 10px;
}
.reader-settings-preview-head span:first-child { display: inline-flex; align-items: center; gap: 5px; }
.reader-settings-preview p {
  display: -webkit-box;
  margin-top: 10px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  letter-spacing: 0.01em;
}
.reader-settings-font { padding: 18px; }
.reader-settings-row-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.reader-settings-row-head h3 { font-size: 13px; font-weight: 600; }
.reader-settings-row-head > span { color: var(--md-on-surface-variant); font-size: 12px; }
.reader-font-control { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.reader-font-range { min-width: 0; flex: 1; --md-range-halo: var(--md-surface); }
.reader-font-range.is-bubble :deep(.md-range-tick) { display: none; }
.reader-font-range.is-bubble :deep(.md-range-track) { background: var(--md-surface-highest); }
.reader-font-range.is-bubble :deep(.md-range-thumb) {
  background: var(--md-primary);
  color: var(--md-on-primary);
  box-shadow: 0 0 0 4px var(--md-surface);
}
.reader-font-step {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--md-on-surface);
  font-size: 21px;
  cursor: pointer;
}
.reader-font-step:disabled { opacity: 0.35; cursor: default; }
.reader-settings-hint { margin-top: 8px; color: var(--md-on-surface-variant); font-size: 11px; line-height: 1.7; }
.reader-settings-selects :deep(.settings-select-row) { min-height: 60px; padding: 16px 18px; gap: 8px; }
.reader-settings-selects :deep(.settings-select-label) { font-size: 13px; }
.reader-settings-selects :deep(.settings-select-value) { font-size: 12px; }
.reader-settings-selects :deep(.settings-select-row > svg) { width: 18px; height: 18px; }
.reader-settings-selects :deep(.settings-select-row + .settings-select-row)::before,
.reader-settings-row + .reader-settings-row::before {
  position: absolute;
  top: 0;
  right: 18px;
  left: 18px;
  height: 1px;
  background: color-mix(in oklab, var(--md-outline-variant) 55%, transparent);
  content: '';
}
.reader-settings-group-label { margin: 22px 14px 10px; color: var(--md-on-surface-variant); font-size: 12px; font-weight: 600; }
.reader-settings-group-label:first-child { margin-top: 2px; }
.reader-settings-row { position: relative; padding: 16px 18px; }
.reader-settings-control-label { font-size: 13px; font-weight: 600; }
.reader-settings-segment { margin-top: 12px; --md-segmented-bg: var(--md-surface-low); }
.reader-settings-segment :deep(.md-segmented-option) { min-height: 48px; padding-inline: 4px; font-size: 12px; }
.reader-settings-segment :deep(.md-segmented-thumb) { background: var(--md-secondary-container); }
.reader-settings-segment :deep(.md-segmented-option.is-selected) { color: var(--md-on-secondary-container); }
.reader-settings-switch { padding-block: 6px; font-size: 13px; }
.reader-settings-paper-hint { margin: 12px 14px 26px; color: var(--md-on-surface-variant); font-size: 11px; line-height: 1.7; }
.reader-settings-animation { display: flex; justify-content: center; align-items: center; gap: 5px; min-height: 135px; padding: 24px 20px; }
.reader-settings-page { display: block; width: 80px; height: 86px; padding: 15px; border: 1px solid var(--md-outline-variant); border-radius: 6px; background: var(--md-surface-low); }
.reader-settings-page i { display: block; height: 2px; margin-bottom: 8px; background: var(--md-outline-variant); }
.is-curl .reader-settings-page:last-child { transform: perspective(300px) rotateY(-32deg); transform-origin: left; box-shadow: 6px 3px 10px color-mix(in oklab, var(--md-shadow-color-soft) 8%, transparent); }
.is-slide .reader-settings-page:last-child { transform: translateX(8px); }
.is-fade .reader-settings-page:last-child { opacity: 0.45; }
.is-scroll .reader-settings-page { height: 100px; }
.reader-settings-cover { padding: 28px 20px 22px; text-align: center; }
.reader-cover-preview { width: 148px; aspect-ratio: 3 / 4; margin: 0 auto 24px; overflow: hidden; border-radius: 6px 13px 13px 6px; background: var(--md-primary-container); box-shadow: 0 8px 20px color-mix(in oklab, var(--md-shadow-color-soft) 12%, transparent); }
.reader-cover-preview img { width: 100%; height: 100%; object-fit: cover; }
.reader-cover-placeholder { display: flex; height: 100%; flex-direction: column; justify-content: center; align-items: center; gap: 20px; padding: 20px; color: var(--md-on-primary-container); }
.reader-cover-placeholder span { font-family: 'Songti SC', serif; font-size: 20px; line-height: 1.6; overflow-wrap: anywhere; }
.reader-settings-cover > h3 { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.reader-settings-upload { width: 100%; margin-top: 20px; }
.reader-settings-restore-cover { width: 100%; margin-top: 8px; }
.reader-settings-cover-note { display: flex; align-items: flex-start; gap: 12px; padding: 18px; font-size: 12px; }
.reader-settings-cover-note > svg { flex: none; margin-top: 1px; color: var(--md-on-surface-variant); }
.reader-settings-cover-note .reader-settings-hint { margin-top: 3px; }
.reader-settings-cover-error { margin-top: 12px; color: var(--md-error); font-size: 12px; line-height: 1.7; }
.reader-settings-actions { justify-content: space-between; gap: 16px; padding: 16px 20px max(20px, env(safe-area-inset-bottom)); border-top: 0; }
.reader-settings-reset { background: var(--md-surface); color: var(--md-on-surface-variant); }
.reader-settings-actions .md-filled-button { min-width: 106px; }
@media (max-width: 899px) {
  .reader-settings-drawer { height: 78dvh; }
}
@media (hover: hover) and (pointer: fine) {
  .reader-font-step:hover:not(:disabled) { background: var(--md-surface-high); }
  .reader-settings-tabs button:not([aria-selected='true']):hover { background: var(--md-surface-high); }
}
@media (prefers-reduced-motion: reduce) {
  .reader-settings-tabs button { transition: none; }
}
</style>
