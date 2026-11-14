import en from './en.ts';
import ja from './ja.ts';

// 中文源文案作键，缺少译文时保持界面可读。
export const messages: Readonly<Record<'en' | 'ja', Readonly<Record<string, string>>>> = { en, ja };
