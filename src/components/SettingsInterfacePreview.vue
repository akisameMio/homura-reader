<template>
  <div
    class="settings-interface-preview"
    :class="{ 'is-thumbnail': thumbnail, 'is-auto': mode === 'auto' }"
    :data-mode="mode === 'auto' ? 'light' : mode || undefined"
    :data-theme="mode ? theme.themeColor : undefined"
    :data-black="black || (mode === 'dark' && theme.pureBlackMode ? 'pure' : mode ? 'standard' : undefined)"
    aria-hidden="true"
  >
    <div class="preview-top">
      <i></i>
      <span></span>
    </div>
    <div class="preview-feature">
      <div class="preview-cover"></div>
      <div class="preview-copy">
        <i></i>
        <i></i>
        <i></i>
      </div>
    </div>
    <div class="preview-books">
      <i></i>
      <i></i>
      <i></i>
    </div>
    <div class="preview-settings">
      <i></i>
      <i></i>
      <i></i>
    </div>
    <div class="preview-settings">
      <i></i>
      <i></i>
    </div>
    <div class="preview-nav">
      <i></i>
      <i></i>
      <i></i>
      <i></i>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useThemeStore } from '../stores/theme.ts';

const theme = useThemeStore();
defineProps({
  mode: { type: String, default: '' },
  thumbnail: { type: Boolean, default: false },
  black: { type: String, default: '' }
});
</script>

<style scoped>
.settings-interface-preview {
  position: relative;
  width: 174px;
  height: 264px;
  flex: none;
  padding: 14px 12px;
  overflow: hidden;
  border-radius: 22px;
  background: var(--md-surface-container);
  box-shadow: 0 10px 20px -15px color-mix(in oklab, var(--md-shadow-color-soft) 24%, transparent);
}

.is-auto {
  background: linear-gradient(115deg, var(--md-surface-container) 50%, var(--md-canvas-dark) 50%);
}

.preview-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.preview-top i {
  width: 59px;
  height: 6px;
  border-radius: 8px;
  background: var(--md-on-surface-variant);
}

.preview-top span {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--md-surface);
}

.preview-feature {
  display: flex;
  gap: 9px;
  height: 65px;
  padding: 9px;
  border-radius: 13px;
  background: var(--md-surface);
}

.preview-cover {
  width: 38px;
  border-radius: 6px;
  background: var(--md-primary-container);
}

.preview-copy {
  flex: 1;
  padding-top: 8px;
}

.preview-copy i {
  display: block;
  height: 5px;
  margin-bottom: 7px;
  border-radius: 5px;
  background: var(--md-outline-variant);
}

.preview-copy i:first-child {
  width: 80%;
  background: var(--md-primary);
}

.preview-copy i:last-child {
  width: 55%;
}

.preview-books {
  display: flex;
  gap: 7px;
  height: 61px;
  margin-top: 9px;
  padding: 9px;
  border-radius: 12px;
  background: var(--md-surface);
}

.preview-books i {
  flex: 1;
  border-radius: 5px;
  background: var(--md-secondary-container);
}

.preview-books i:first-child {
  background: var(--md-primary-container);
}

.preview-settings {
  display: flex;
  gap: 7px;
  height: 30px;
  margin-top: 8px;
  padding: 9px;
  border-radius: 10px;
  background: var(--md-surface);
}

.preview-settings i {
  flex: 1;
  height: 10px;
  border-radius: 8px;
  background: var(--md-surface-high);
}

.preview-settings i:first-child {
  background: var(--md-primary);
}

.preview-nav {
  position: absolute;
  bottom: 9px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 29px;
  border-radius: 20px;
  background: var(--md-surface);
  box-shadow: 0 4px 10px color-mix(in oklab, var(--md-shadow-color-soft) 10%, transparent);
}

.preview-nav i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--md-on-surface-variant);
}

.preview-nav i:first-child {
  background: var(--md-primary);
}

.is-thumbnail {
  width: 66px;
  height: 66px;
  padding: 7px;
  border-radius: 14px;
  box-shadow: none;
}

.is-thumbnail .preview-top {
  margin-bottom: 5px;
}

.is-thumbnail .preview-top i {
  width: 25px;
  height: 4px;
}

.is-thumbnail .preview-top span {
  width: 7px;
  height: 7px;
}

.is-thumbnail .preview-feature {
  height: 22px;
  padding: 4px;
  border-radius: 5px;
  gap: 3px;
}

.is-thumbnail .preview-cover {
  width: 14px;
  border-radius: 3px;
}

.is-thumbnail .preview-copy {
  padding-top: 2px;
}

.is-thumbnail .preview-copy i {
  height: 2px;
  margin-bottom: 3px;
}

.is-thumbnail .preview-books {
  height: 14px;
  margin-top: 4px;
  padding: 3px;
  gap: 3px;
}

.is-thumbnail .preview-books i {
  border-radius: 2px;
}

.is-thumbnail .preview-settings, .is-thumbnail .preview-nav {
  display: none;
}
</style>
