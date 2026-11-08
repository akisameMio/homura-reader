/* ============================================================================
   HOMURA · 应用设置 Store
   ----------------------------------------------------------------------------
   保存全局外观之外的用户偏好。阅读默认值只影响尚未留下排版记录的作品，
   已读作品继续使用各自的排版记忆；调试开关用于覆盖平台界面能力与启动行为。
   ========================================================================== */

import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { isWindows } from '../services/platform.js';
import { resolveFontValue } from '../services/readerLayout.js';

const READER_DEFAULTS_KEY = 'homura_reader_defaults';
const DEBUG_FORCE_FULLSCREEN_KEY = 'homura_debug_force_fullscreen';
const DEBUG_AUTO_UPDATE_CHECK_KEY = 'homura_debug_auto_update_check';
const IMPORT_COLLECTION_PROMPT_KEY = 'homura_import_collection_prompt';
const DIRECTIONS = ['ltr', 'rtl', 'vertical'];
const WEBTOON_FITS = ['screen', 'medium', 'wide'];
const LINE_HEIGHTS = ['tight', 'normal', 'loose'];
const PAGE_MARGINS = ['narrow', 'normal', 'wide'];

export const DEFAULT_READER_SETTINGS = Object.freeze({
  direction: 'ltr',
  spread: 2,
  coverOffset: true,
  fontSize: 18,
  webtoonFit: 'screen',
  fontFamily: 'song',
  lineHeight: 'normal',
  pageMargin: 'normal'
});

function normalizeReaderDefaults(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rawFontSize = Number(source.fontSize);
  const fontSize = Number.isFinite(rawFontSize)
    ? Math.min(28, Math.max(14, Math.round(rawFontSize / 2) * 2))
    : DEFAULT_READER_SETTINGS.fontSize;

  return {
    direction: DIRECTIONS.includes(source.direction)
      ? source.direction
      : DEFAULT_READER_SETTINGS.direction,
    spread: source.spread === 1 ? 1 : 2,
    coverOffset: typeof source.coverOffset === 'boolean'
      ? source.coverOffset
      : DEFAULT_READER_SETTINGS.coverOffset,
    fontSize,
    webtoonFit: WEBTOON_FITS.includes(source.webtoonFit)
      ? source.webtoonFit
      : DEFAULT_READER_SETTINGS.webtoonFit,
    fontFamily: resolveFontValue(source.fontFamily),
    lineHeight: LINE_HEIGHTS.includes(source.lineHeight)
      ? source.lineHeight
      : DEFAULT_READER_SETTINGS.lineHeight,
    pageMargin: PAGE_MARGINS.includes(source.pageMargin)
      ? source.pageMargin
      : DEFAULT_READER_SETTINGS.pageMargin
  };
}

function readReaderDefaults() {
  try {
    const raw = localStorage.getItem(READER_DEFAULTS_KEY);
    return raw ? normalizeReaderDefaults(JSON.parse(raw)) : { ...DEFAULT_READER_SETTINGS };
  } catch (err) {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

function writeReaderDefaults(value) {
  try {
    localStorage.setItem(READER_DEFAULTS_KEY, JSON.stringify(value));
  } catch (err) {
    console.warn('[HOMURA] 阅读默认值保存失败', err);
  }
}

function readDebugForceFullscreen() {
  try {
    return localStorage.getItem(DEBUG_FORCE_FULLSCREEN_KEY) === '1';
  } catch (err) {
    return false;
  }
}

function readDebugAutoUpdateCheck() {
  try {
    return localStorage.getItem(DEBUG_AUTO_UPDATE_CHECK_KEY) === '1';
  } catch (err) {
    return false;
  }
}

function readImportCollectionPrompt() {
  try {
    return localStorage.getItem(IMPORT_COLLECTION_PROMPT_KEY) === '1';
  } catch (err) {
    return false;
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const readerDefaults = reactive(readReaderDefaults());
  const debugForceFullscreen = ref(readDebugForceFullscreen());
  const debugAutoUpdateCheck = ref(readDebugAutoUpdateCheck());
  const importCollectionPrompt = ref(readImportCollectionPrompt());
  const showFullscreenButton = computed(() => isWindows || debugForceFullscreen.value);

  function persistReaderDefaults() {
    writeReaderDefaults(readerDefaults);
  }

  function setReaderDefault(key, value) {
    const next = normalizeReaderDefaults({ ...readerDefaults, [key]: value });
    Object.assign(readerDefaults, next);
    persistReaderDefaults();
  }

  function resetReaderDefaults() {
    Object.assign(readerDefaults, DEFAULT_READER_SETTINGS);
    persistReaderDefaults();
  }

  function setDebugForceFullscreen(value) {
    const next = !!value;
    debugForceFullscreen.value = next;
    try {
      localStorage.setItem(DEBUG_FORCE_FULLSCREEN_KEY, next ? '1' : '0');
    } catch (err) {
      console.warn('[HOMURA] 调试开关保存失败', err);
    }
  }

  function setDebugAutoUpdateCheck(value) {
    const next = !!value;
    debugAutoUpdateCheck.value = next;
    try {
      localStorage.setItem(DEBUG_AUTO_UPDATE_CHECK_KEY, next ? '1' : '0');
    } catch (err) {
      console.warn('[HOMURA] 更新检测开关保存失败', err);
    }
  }

  function setImportCollectionPrompt(value) {
    const next = !!value;
    importCollectionPrompt.value = next;
    try {
      localStorage.setItem(IMPORT_COLLECTION_PROMPT_KEY, next ? '1' : '0');
    } catch (err) {
      console.warn('[HOMURA] 导入书库提示开关保存失败', err);
    }
  }

  return {
    readerDefaults,
    debugForceFullscreen,
    debugAutoUpdateCheck,
    importCollectionPrompt,
    showFullscreenButton,
    setReaderDefault,
    resetReaderDefaults,
    setDebugForceFullscreen,
    setDebugAutoUpdateCheck,
    setImportCollectionPrompt
  };
});
