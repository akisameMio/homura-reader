<template>
  <Teleport to="body">
    <Transition
      :css="false"
      @before-enter="onSheetBeforeEnter"
      @enter="onSheetEnter"
      @before-leave="onSheetBeforeLeave"
      @leave="onSheetLeave"
      @after-leave="onSheetAfterLeave"
      @leave-cancelled="onSheetLeaveCancelled"
    >
      <div
        v-if="open"
        class="changelog-layer"
        :class="{ 'is-compact': compact }"
        @mousedown.self="$emit('close')"
      >
        <aside
          ref="sheetRef"
          class="changelog-panel"
          :class="{ 'is-compact': compact }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="changelog-title"
          :aria-busy="status === 'loading'"
        >
          <ReaderDrawerHeader
            :is-compact="compact"
            prominent
            :title="t('更新日志')"
            title-id="changelog-title"
            :close-label="t('关闭更新日志')"
            @close="$emit('close')"
            @drag-start="onDragStart"
            @drag-move="onDragMove"
            @drag-end="onDragEnd"
            @drag-cancel="onDragCancel"
          >
            <template #status>
              <span class="changelog-status"><MdIcon :name="statusIcon" :size="14" />{{ statusLabel }}</span>
            </template>
          </ReaderDrawerHeader>

          <div class="changelog-scroll">
            <p class="changelog-intro">{{ t('查看 HOMURA 每个稳定版本带来的变化。') }}</p>

            <div v-if="status === 'loading'" class="changelog-state" role="status">
              <div v-for="index in 2" :key="index" class="changelog-card">
                <span class="changelog-skeleton is-version"></span>
                <span class="changelog-skeleton is-copy"></span>
                <span class="changelog-skeleton is-copy-short"></span>
              </div>
            </div>

            <div v-else-if="status === 'error'" class="changelog-state is-error" role="alert">
              <div class="changelog-card changelog-message">
                <span class="changelog-error-icon" aria-hidden="true">
                  <MdIcon name="error" />
                </span>
                <b>{{ t('暂时无法读取更新日志') }}</b>
                <p>{{ t(errorMessage) }}</p>
                <button type="button" class="md-filled-button" @click="$emit('retry')">{{ t('重试') }}</button>
              </div>
            </div>

            <template v-else-if="releases.length">
              <article
                v-for="(release, index) in releases"
                :key="release.id || release.version"
                class="changelog-entry"
                :class="{ 'is-current': isCurrent(release) }"
              >
                <div class="changelog-version-row">
                  <strong>{{ release.tag }}</strong>
                  <span v-if="index === 0" class="changelog-badge">{{ t('最新') }}</span>
                  <span v-if="isCurrent(release)" class="changelog-badge is-current">{{ t('当前版本') }}</span>
                  <span class="changelog-date">{{ release.dateLabel }}</span>
                </div>
                <p v-if="releaseSummary(release)" class="changelog-summary">{{ releaseSummary(release) }}</p>
                <div v-if="release.notes.groups.length" class="changelog-groups">
                  <div v-for="group in release.notes.groups" :key="group.title" class="changelog-group">
                    <h3>{{ t(group.title) }}</h3>
                    <ul>
                      <li v-for="item in group.items" :key="item">{{ item }}</li>
                    </ul>
                  </div>
                </div>
                <p v-else class="changelog-empty">{{ t('该版本没有提供可展示的更新说明。') }}</p>
              </article>
            </template>

            <div v-else class="changelog-state">
              <div class="changelog-card changelog-message">
                <b>{{ t('还没有版本记录') }}</b>
                <p>{{ t('GitHub Releases 中暂时没有可展示的稳定版本。') }}</p>
              </div>
            </div>
          </div>

          <footer class="changelog-foot">
            <p v-if="linkError" class="changelog-link-error" role="alert">{{ linkError }}</p>
            <div class="changelog-actions">
              <button
                type="button"
                class="md-text-button changelog-releases"
                :title="t('在 GitHub 查看全部发布')"
                @click="openReleasesPage"
              >
                {{ t('全部发布') }}
                <MdIcon name="open_in_new" :size="16" />
              </button>
            </div>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type PropType } from 'vue';
import { useSheetDrag } from '../composables/useSheetDrag.ts';
import { useSheetSpring } from '../composables/useSheetSpring.ts';
import { openGitHubUrl } from '../services/external.ts';
import MdIcon from './MdIcon.vue';
import ReaderDrawerHeader from './ReaderDrawerHeader.vue';
import {
  getUpdateErrorMessage,
  RELEASES_PAGE_URL
} from '../services/updates.ts';
import { useI18n } from '../composables/useI18n.ts';

const { t } = useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  status: { type: String, default: 'idle' },
  releases: { type: Array as PropType<ChangelogRelease[]>, default: () => [] },
  currentVersion: { type: String, required: true },
  error: { type: Object, default: null }
});

const emit = defineEmits(['close', 'retry']);

const linkError = ref('');
let sheetTrigger: HTMLElement | null = null;

const openModel = computed(() => props.open);
const compactModel = computed(() => props.compact);
const errorMessage = computed(() => getUpdateErrorMessage(props.error));
const statusLabel = computed(() => {
  if (props.status === 'loading') return t('读取中');
  if (props.status === 'error') return t('读取失败');
  if (!props.releases.length) return t('暂无版本');
  return t('{0} 个版本', { 0: props.releases.length });
});
const statusIcon = computed(() => {
  if (props.status === 'loading') return 'history';
  if (props.status === 'error') return 'error';
  return 'check';
});
const sheetSpring = useSheetSpring({
  isCompact: compactModel,
  panel: root => root.querySelector<HTMLElement>('.changelog-panel'),
  fadeRoot: true
});
const {
  onBeforeEnter: onSheetBeforeEnter,
  onEnter: onSheetEnter,
  onBeforeLeave: onSheetBeforeLeave,
  onLeave: onSheetLeave,
  onAfterLeave: onSheetAfterLeave,
  onLeaveCancelled: onSheetLeaveCancelled
} = sheetSpring;
const {
  sheetRef,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel
} = useSheetDrag({
  isCompact: compactModel,
  isOpen: openModel,
  onClose: () => emit('close'),
  onDragBegin: sheetSpring.cancel
});

interface ChangelogRelease {
  id?: string;
  version: string;
  tag?: string;
  dateLabel?: string;
  notes: { intro?: string; itemCount: number; groups: Array<{ title: string; items: string[] }> };
}

function isCurrent(release: ChangelogRelease) {
  return release.version === props.currentVersion.replace(/^v/i, '');
}

function releaseSummary(release: ChangelogRelease) {
  if (release.notes.intro) return release.notes.intro;
  if (release.notes.itemCount > 0) return t('{0} 项更新', { 0: release.notes.itemCount });
  return '';
}

async function openReleasesPage() {
  linkError.value = '';
  try {
    await openGitHubUrl(RELEASES_PAGE_URL);
  } catch (error) {
    linkError.value = t('无法打开系统浏览器，请稍后再试。');
    console.warn('打开 Releases 页面失败', error);
  }
}

function focusableElements(): HTMLElement[] {
  const panel = sheetRef.value as HTMLElement | null;
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')
  ) as HTMLElement[];
}

function onPanelKeydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = focusableElements();
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (open, previous) => {
    if (open) {
      linkError.value = '';
      sheetTrigger = document.activeElement as HTMLElement | null;
      window.addEventListener('keydown', onPanelKeydown);
      await nextTick();
      sheetRef.value?.querySelector<HTMLButtonElement>('.md-drawer-header button')?.focus();
      return;
    }
    window.removeEventListener('keydown', onPanelKeydown);
    if (previous) {
      await nextTick();
      if (sheetTrigger && typeof sheetTrigger.focus === 'function') sheetTrigger.focus();
      sheetTrigger = null;
    }
  }
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPanelKeydown);
});
</script>

<style scoped>
.changelog-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in oklab, var(--md-shadow-color) 32%, transparent);
}

.changelog-panel {
  width: min(372px, calc(100% - 24px));
  height: 100%;
  overflow: hidden;
  color: var(--md-on-surface);
  display: flex;
  flex-direction: column;
  background: color-mix(in oklab, var(--md-surface-container) 65%, var(--md-surface-low));
  box-shadow: -24px 0 70px -34px color-mix(in oklab, var(--md-shadow-color-soft) 52%, transparent);
}

@media (min-width: 900px) {
  .changelog-panel {
    border-radius: 28px 0 0 28px;
  }
}

.changelog-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--md-on-surface-variant);
  font-size: 10px;
  white-space: nowrap;
}

.changelog-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 18px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: var(--md-outline-variant) transparent;
}

.changelog-intro {
  margin: 0 14px 12px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  line-height: 1.7;
}

.changelog-entry {
  margin-bottom: 12px;
  padding: 18px;
  border-radius: 26px;
  background: var(--md-surface);
}

.changelog-entry.is-current {
  box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--md-primary) 38%, transparent);
}

.changelog-version-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.changelog-version-row strong {
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  font-weight: 700;
}

.changelog-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  font-size: 9.5px;
  font-weight: 650;
}

.changelog-badge.is-current {
  background: var(--md-surface-high);
  color: var(--md-on-surface-variant);
}

.changelog-date {
  margin-left: auto;
  color: var(--md-on-surface-variant);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9.5px;
}

.changelog-summary {
  margin: 11px 0 0;
  color: var(--md-on-surface-variant);
  font-size: 11.5px;
  line-height: 1.7;
}

.changelog-groups {
  margin-top: 12px;
  display: grid;
  gap: 12px;
}

.changelog-group {
  position: relative;
}

.changelog-group + .changelog-group {
  padding-top: 12px;
}

.changelog-group + .changelog-group::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: color-mix(in oklab, var(--md-outline-variant) 55%, transparent);
}

.changelog-group h3 {
  margin: 0;
  color: var(--md-on-surface);
  font-size: 12px;
  font-weight: 600;
}

.changelog-group ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 5px;
  color: var(--md-on-surface-variant);
  font-size: 11.5px;
  line-height: 1.65;
}

.changelog-group li {
  position: relative;
  padding-left: 11px;
}

.changelog-group li::before {
  content: "";
  position: absolute;
  top: 0.72em;
  left: 0;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}

.changelog-empty {
  margin: 9px 0 0;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  line-height: 1.65;
}

.changelog-state {
  display: flex;
  flex-direction: column;
}

.changelog-message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 22px 18px;
}

.changelog-message b {
  font-size: 13px;
  font-weight: 650;
}

.changelog-message p {
  margin: 0;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.65;
}

.changelog-message .md-filled-button {
  margin-top: 2px;
}

.changelog-error-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--md-surface-high);
  color: var(--md-on-surface-variant);
}

.changelog-error-icon svg {
  width: 21px;
  height: 21px;
}

.changelog-skeleton {
  display: block;
  border-radius: 999px;
  background: var(--md-surface-high);
  animation: changelog-pulse 1.2s ease-in-out infinite alternate;
}

.changelog-skeleton.is-version {
  width: 74px;
  height: 16px;
  margin-top: 7px;
}

.changelog-skeleton.is-copy {
  width: 92%;
  height: 10px;
  margin-top: 9px;
}

.changelog-skeleton.is-copy-short {
  width: 68%;
  height: 10px;
  margin-bottom: 4px;
}

.changelog-foot {
  flex: none;
  padding: 4px 20px max(20px, env(safe-area-inset-bottom));
}

.changelog-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.changelog-releases {
  min-width: 0;
  flex: 1;
  justify-content: center;
  background: var(--md-surface);
  color: var(--md-on-surface-variant);
}

.changelog-link-error {
  margin: 0 4px 8px;
  color: var(--md-error);
  font-size: 10.5px;
  text-align: center;
}

@keyframes changelog-pulse {
  from { opacity: 0.48; }
  to { opacity: 1; }
}

@media (max-width: 899px) {
  .changelog-layer.is-compact {
    align-items: flex-end;
  }

  .changelog-panel.is-compact {
    width: 100%;
    height: 78dvh;
    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - 8px);
    border-radius: 28px 28px 0 0;
    box-shadow: 0 -24px 70px -34px color-mix(in oklab, var(--md-shadow-color-soft) 52%, transparent);
  }

  .changelog-panel.is-compact .changelog-scroll {
    padding: 0 16px 16px;
  }

  .changelog-panel.is-compact .changelog-intro {
    margin-inline: 12px;
  }

  .changelog-panel.is-compact .changelog-foot {
    padding: 4px 16px calc(14px + env(safe-area-inset-bottom));
  }

}

@media (prefers-reduced-motion: reduce) {
  .changelog-skeleton {
    animation: none;
  }
}
</style>
