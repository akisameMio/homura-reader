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
      <!-- Aa 直接开排版；外观与封面也在同一个抽屉里 -->
      <button
        type="button"
        class="md-reader-type-button md-icon-button"
        :class="{ 'is-active': ui.settingsOpen }"
        title="排版与外观"
        aria-label="排版与外观"
        aria-controls="reader-settings-drawer"
        :aria-expanded="ui.settingsOpen"
        @click="ui.openSettings()"
      >Aa</button>
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
import { computed, ref, watch } from 'vue';
import { useReaderStore } from '../stores/reader.js';
import { useShelfStore } from '../stores/shelf.js';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import MdIcon from './MdIcon.vue';

const reader = useReaderStore();
const shelf = useShelfStore();
const settings = useSettingsStore();
const ui = useUiStore();
const emit = defineEmits(['back']);

const favoriteBusy = ref(false);
const favoriteError = ref('');
const isFavorite = computed(() => !!shelf.library.find(book => book.id === reader.currentBook?.id)?.favorite);
const bookTitle = computed(() => reader.currentBook?.title || '');
watch(() => reader.currentBook?.id, () => { favoriteError.value = ''; });

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
