import { messages } from '../locales/messages.ts';

export const LOCALE_STORAGE_KEY = 'homura_locale';
export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALE_OPTIONS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' }
] as const;
export type Locale = typeof LOCALE_OPTIONS[number]['value'];
export type MessageParams = Readonly<Record<string, unknown>>;

export function isLocale(value: unknown): value is Locale {
  return LOCALE_OPTIONS.some(option => option.value === value);
}

export function readLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function translate(source: unknown, locale: Locale, params: MessageParams = {}): string {
  const key = String(source ?? '');
  const catalog = locale === 'zh-CN' ? undefined : messages[locale];
  const text = catalog && Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] || key : key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? '') : placeholder
  );
}
