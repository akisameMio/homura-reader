import { readonly, shallowRef } from 'vue';
import {
  isLocale, LOCALE_OPTIONS, LOCALE_STORAGE_KEY, readLocale, translate,
  type MessageParams
} from '../services/i18n.ts';

const activeLocale = shallowRef(readLocale());
const locale = readonly(activeLocale);

export function t(source: unknown, params?: MessageParams): string {
  return translate(source, activeLocale.value, params);
}

function setLocale(value: unknown) {
  if (!isLocale(value)) return;
  activeLocale.value = value;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // 存储受限时仍允许本次会话切换语言。
  }
}

export function useI18n() {
  return { locale, localeOptions: LOCALE_OPTIONS, setLocale, t };
}
