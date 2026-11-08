<template>
  <!-- 阅读器顶栏：通栏书眉，左工具组 / 中书眉 / 右排版与收藏 -->
  <header class="md-reader-topbar" aria-label="阅读器工具栏">
    <div class="md-reader-topbar-side">
      <button
        type="button"
        @click="emit('back')"
        class="md-icon-button"
        title="返回书架 (Esc)"
        aria-label="返回书架"
      >
        <MdIcon name="arrow_back" />
      </button>
      <div class="md-reader-topbar-group">
        <button
          type="button"
          @click="ui.openToc()"
          class="md-icon-button md-hit-target"
          title="目录"
          aria-label="目录"
          aria-controls="reader-toc-drawer"
          :aria-expanded="ui.tocOpen"
        >
          <MdIcon name="toc" />
        </button>
        <template v-if="reader.currentCollection">
          <span class="md-reader-topbar-divider" aria-hidden="true"></span>
          <button
            type="button"
            class="md-icon-button md-hit-target"
            title="本目录"
            aria-label="本目录"
            aria-controls="reader-collection-drawer"
            :aria-expanded="ui.collectionTocOpen"
            @click="ui.openCollectionToc()"
          >
            <MdIcon name="collections_bookmark" />
          </button>
        </template>
      </div>
    </div>

    <p class="md-reader-topbar-title" :title="bookTitle">{{ bookTitle }}</p>

    <div class="md-reader-topbar-side is-end">
      <!-- 可重排的正文用 Aa 开字体浮层；漫画 / PDF 没有字体可换，用齿轮开显示设置 -->
      <button
        v-if="isReflowable"
        ref="typeButton"
        type="button"
        class="md-reader-type-button md-icon-button"
        :class="{ 'is-active': ui.fontMenuOpen }"
        title="字体"
        aria-label="字体"
        aria-haspopup="menu"
        aria-controls="reader-font-menu"
        :aria-expanded="ui.fontMenuOpen"
        @click="ui.toggleFontMenu()"
      >
        <span class="md-reader-type-glyph" aria-hidden="true">Aa</span>
      </button>
      <button
        v-else
        type="button"
        class="md-icon-button"
        :class="{ 'is-active': ui.settingsOpen }"
        title="阅读设置"
        aria-label="阅读设置"
        aria-controls="reader-settings-drawer"
        :aria-expanded="ui.settingsOpen"
        @click="ui.openSettings()"
      >
        <MdIcon name="settings" />
      </button>

      <Transition
        enter-active-class="md-fade-enter-active"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="md-fade-leave-active"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isReflowable && ui.fontMenuOpen"
          id="reader-font-menu"
          ref="fontMenu"
          class="md-menu md-reader-font-menu"
          role="menu"
          aria-label="正文字体"
        >
          <p class="md-menu-label">字体</p>
          <button
            v-for="option in fontOptions"
            :key="option.value"
            type="button"
            role="menuitemradio"
            :aria-checked="reader.layoutConfig.fontFamily === option.value"
            class="md-menu-item md-reader-font-item"
            @click="pickFont(option.value)"
          >
            <span class="md-reader-font-sample" :style="{ fontFamily: option.stack }" aria-hidden="true">永</span>
            <span class="md-reader-font-name">{{ option.label }}</span>
            <MdIcon v-if="reader.layoutConfig.fontFamily === option.value" name="check" class="md-menu-check" />
          </button>
          <span class="md-reader-font-menu-divider" role="separator"></span>
          <button type="button" role="menuitem" class="md-menu-item" @click="openFullSettings">
            <MdIcon name="settings" />
            <span class="md-reader-font-name">更多排版设置</span>
          </button>
        </div>
      </Transition>

      <button
        type="button"
        class="md-icon-button"
        :class="{ 'is-favorite': isFavorite }"
        :title="isFavorite ? '取消收藏' : '收藏本书'"
        :aria-label="isFavorite ? '取消收藏' : '收藏本书'"
        :aria-pressed="isFavorite"
        :disabled="favoriteBusy"
        @click="toggleFavorite"
      >
        <MdIcon name="star" :filled="isFavorite" />
      </button>
      <!-- 全屏切换：默认仅 Windows 桌面显示，移动端窗口本身即全屏，不占位 -->
      <button
        v-if="settings.showFullscreenButton"
        type="button"
        @click="ui.toggleFullscreen()"
        class="md-icon-button is-desktop-only"
        :title="ui.fullscreen ? '退出全屏 (F)' : '全屏 (F)'"
        :aria-label="ui.fullscreen ? '退出全屏 (F)' : '全屏 (F)'"
        :aria-pressed="ui.fullscreen"
      >
        <MdIcon :name="ui.fullscreen ? 'fullscreen_exit' : 'fullscreen'" />
      </button>
    </div>

    <Transition
      enter-active-class="md-fade-enter-active"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="md-fade-leave-active"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <p v-if="favoriteError" role="alert" class="md-reader-alert">{{ favoriteError }}</p>
    </Transition>
  </header>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useReaderStore } from '../stores/reader.js';
import { useShelfStore } from '../stores/shelf.js';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import { READER_FONT_OPTIONS } from '../services/readerLayout.js';
import MdIcon from './MdIcon.vue';

const reader = useReaderStore();
const shelf = useShelfStore();
const settings = useSettingsStore();
const ui = useUiStore();
const emit = defineEmits(['back']);

const favoriteBusy = ref(false);
const favoriteError = ref('');
const isFavorite = computed(() => !!shelf.library.find(book => book.id === reader.currentBook?.id)?.favorite);
// 漫画与 PDF 的页面是位图，没有字体 / 行距可调
const isReflowable = computed(() => reader.currentBook?.type !== 'manga');
const bookTitle = computed(() => reader.currentBook?.title || '');
const fontOptions = READER_FONT_OPTIONS;
const typeButton = ref(null);
const fontMenu = ref(null);

watch(() => reader.currentBook?.id, () => {
  favoriteError.value = '';
  ui.closeFontMenu();
});

function onDocumentPointerDown(event) {
  if (!ui.fontMenuOpen) return;
  const target = event.target;
  if (fontMenu.value?.contains(target) || typeButton.value?.contains(target)) return;
  ui.closeFontMenu();
}

function onDocumentKeydown(event) {
  if (!ui.fontMenuOpen || event.key !== 'Escape') return;
  // 浮层优先吃掉 Esc，别让全局快捷键顺手关掉阅读器
  event.preventDefault();
  event.stopPropagation();
  ui.closeFontMenu();
  typeButton.value?.focus();
}

document.addEventListener('pointerdown', onDocumentPointerDown, true);
document.addEventListener('keydown', onDocumentKeydown, true);
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
});

function pickFont(value) {
  reader.setFontFamily(value);
  ui.closeFontMenu();
  nextTick(() => typeButton.value?.focus());
}

function openFullSettings() {
  ui.closeFontMenu();
  ui.openSettings();
}

async function toggleFavorite() {
  const id = reader.currentBook?.id;
  if (!id || favoriteBusy.value) return;
  favoriteBusy.value = true;
  favoriteError.value = '';
  try {
    await shelf.toggleFavorite(id);
  } catch (err) {
    if (reader.currentBook?.id === id) favoriteError.value = err.message || '收藏保存失败，请重试';
    console.warn('[HOMURA] 收藏保存失败', err);
  } finally {
    favoriteBusy.value = false;
  }
}
</script>
