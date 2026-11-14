<template>
  <!-- 阅读器顶栏：通栏书眉，左工具组 / 中书眉 / 右排版与收藏 -->
  <header class="md-reader-topbar" aria-label="阅读器工具栏">
    <div class="md-reader-topbar-side">
      <div class="md-reader-topbar-group">
        <button
          type="button"
          @click="emit('back')"
          class="md-icon-button md-hit-target"
          title="返回书架 (Esc)"
          aria-label="返回书架"
        >
          <MdIcon name="arrow_back" />
        </button>
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
      </div>
    </div>

    <p class="md-reader-topbar-title" :title="bookTitle">{{ bookTitle }}</p>

    <div class="md-reader-topbar-side is-end">
      <!-- 可重排的正文用 Aa 开字体浮层；漫画 / PDF 没有字体可换，用齿轮开显示设置 -->
      <button
        v-if="isReflowable"
        type="button"
        class="md-reader-type-button md-icon-button"
        :class="{ 'is-active': ui.fontMenuOpen }"
        title="字体"
        aria-label="字体"
        aria-haspopup="dialog"
        aria-controls="reader-font-menu"
        :aria-expanded="ui.fontMenuOpen"
        @click="ui.toggleFontMenu()"
      >
        <svg
          class="md-reader-type-glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M2.7 18.2 7.35 5.8h.6l4.65 12.4" />
          <path d="M4.55 13.75h6.8" />
          <circle cx="17.15" cy="14.25" r="3.35" />
          <path d="M20.5 10.9v7.3" />
        </svg>
      </button>
      <button
        type="button"
        class="md-icon-button"
        :class="{ 'is-active': ui.settingsOpen }"
        :title="isReflowable ? '排版与外观' : '阅读设置'"
        :aria-label="isReflowable ? '排版与外观' : '阅读设置'"
        aria-controls="reader-settings-drawer"
        :aria-expanded="ui.settingsOpen"
        @click="ui.openSettings()"
      >
        <MdIcon name="settings" />
      </button>


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

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useReaderStore } from '../stores/reader.ts';
import { useShelfStore } from '../stores/shelf.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useUiStore } from '../stores/ui.ts';
import MdIcon from './MdIcon.vue';

const reader = useReaderStore();
const shelf = useShelfStore();
const settings = useSettingsStore();
const ui = useUiStore();
const emit = defineEmits(['back']);

const favoriteBusy = ref(false);
const favoriteError = ref('');
const isFavorite = computed(() => !!((shelf.library).find(book => book.id === reader.currentBook?.id))?.isFavorite);
// 漫画与 PDF 的页面是位图，没有字体 / 行距可调
const isReflowable = computed(() => reader.currentBook?.type !== 'manga');
const bookTitle = computed(() => reader.currentBook?.title || '');
watch(() => reader.currentBook?.id, () => {
  favoriteError.value = '';
  ui.closeFontMenu();
});

async function toggleFavorite() {
  const id = reader.currentBook?.id;
  if (!id || favoriteBusy.value) return;
  favoriteBusy.value = true;
  favoriteError.value = '';
  try {
    await shelf.toggleFavorite(id);
  } catch (err) {
    if (reader.currentBook?.id === id) favoriteError.value = (err as Error).message || '收藏保存失败，请重试';
    console.warn('[HOMURA] 收藏保存失败', err);
  } finally {
    favoriteBusy.value = false;
  }
}
</script>
