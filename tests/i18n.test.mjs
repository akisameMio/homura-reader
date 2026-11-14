import test from 'node:test';
import assert from 'node:assert/strict';
import { computed } from 'vue';
import en from '../src/locales/en.ts';
import ja from '../src/locales/ja.ts';
import {
  DEFAULT_LOCALE, LOCALE_OPTIONS, LOCALE_STORAGE_KEY, isLocale, readLocale, translate
} from '../src/services/i18n.ts';
import { useI18n } from '../src/composables/useI18n.ts';

test('英语和日语词典的键及插值参数保持完整一致', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [source, english] of Object.entries(en)) {
    const japanese = ja[source];
    assert.ok(english.trim(), source);
    assert.ok(japanese.trim(), source);
    assert.deepEqual(placeholders(english), placeholders(source), `en: ${source}`);
    assert.deepEqual(placeholders(japanese), placeholders(source), `ja: ${source}`);
  }
});

test('三种语言翻译完整句子，保留参数与原始书名', () => {
  assert.equal(translate('第 {0} 页', 'zh-CN', { 0: 12 }), '第 12 页');
  assert.equal(translate('第 {0} 页', 'en', { 0: 12 }), 'Page 12');
  assert.equal(translate('第 {0} 页', 'ja', { 0: 12 }), '12 ページ');
  assert.equal(translate('阅读：{0}', 'en', { 0: '设置 <img src=x onerror=alert(1)>' }),
    'Read: 设置 <img src=x onerror=alert(1)>');
});

test('缺失文案回退源文本，插值不解释替换字符或继承属性', () => {
  assert.equal(translate('未翻译的句子 {count}', 'ja', { count: 3 }), '未翻译的句子 3');
  assert.equal(translate('toString', 'en'), 'toString');
  assert.equal(translate('{name}', 'en', { name: '$& {other}' }), '$& {other}');
  assert.equal(translate('{count}', 'en', Object.create({ count: 8 })), '{count}');
  assert.equal(translate('第 {0} 页', 'en'), 'Page {0}');
});

test('语言白名单与原生名称稳定，默认保留简体中文', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.deepEqual(LOCALE_OPTIONS.map(option => option.label), ['简体中文', 'English', '日本語']);
  for (const value of ['zh-CN', 'en', 'ja']) assert.equal(isLocale(value), true);
  for (const value of ['', 'en-US', 'toString', null, undefined]) assert.equal(isLocale(value), false);
});

test('语言记忆读取有效值，无效或受限存储回退中文', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: key => key === LOCALE_STORAGE_KEY ? 'ja' : null }
    });
    assert.equal(readLocale(), 'ja');
    globalThis.localStorage.getItem = () => 'invalid';
    assert.equal(readLocale(), 'zh-CN');
    globalThis.localStorage.getItem = () => { throw new Error('Storage denied'); };
    assert.equal(readLocale(), 'zh-CN');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('切换语言即时更新派生文案，持久化失败也能继续切换', () => {
  const { t, locale, setLocale } = useI18n();
  const previousLocale = locale.value;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { setItem: (key, value) => saved.set(key, value) }
    });
    const label = computed(() => t('阅读默认值'));
    setLocale('en');
    assert.equal(label.value, 'Reading defaults');
    assert.equal(saved.get(LOCALE_STORAGE_KEY), 'en');
    setLocale('ja');
    assert.equal(label.value, '読書の初期設定');
    setLocale('unknown');
    assert.equal(locale.value, 'ja');
    globalThis.localStorage.setItem = () => { throw new Error('Storage denied'); };
    setLocale('zh-CN');
    assert.equal(label.value, '阅读默认值');
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    setLocale(previousLocale);
  }
});
