// Lightweight i18n dictionary for aramcooil — Arabic / English / Russian
// Arabic is the default. RTL is applied at the layout level when lang === 'ar'.

export type Lang = 'ar' | 'en' | 'ru' | 'es' | 'pt' | 'fr' | 'de' | 'tr' | 'zh' | 'hi' | 'id' | 'bn' | 'ja' | 'ko' | 'ur';

export const LANGS: { code: Lang; label: string; flag: string; dir: 'rtl' | 'ltr' }[] = [
  { code: 'ar', label: 'العربية', flag: '🇪🇬', dir: 'rtl' },
  { code: 'en', label: 'English', flag: '🇬🇧', dir: 'ltr' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺', dir: 'ltr' },
  { code: 'es', label: 'Español', flag: '🇪🇸', dir: 'ltr' },
  { code: 'pt', label: 'Português (Brasil)', flag: '🇧🇷', dir: 'ltr' },
  { code: 'fr', label: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷', dir: 'ltr' },
  { code: 'zh', label: '简体中文', flag: '🇨🇳', dir: 'ltr' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩', dir: 'ltr' },
  { code: 'bn', label: 'বাংলা', flag: '🇧🇩', dir: 'ltr' },
  { code: 'ja', label: '日本語', flag: '🇯🇵', dir: 'ltr' },
  { code: 'ko', label: '한국어', flag: '🇰🇷', dir: 'ltr' },
  { code: 'ur', label: 'اردو', flag: '🇵🇰', dir: 'rtl' },
];
type Dict = Record<string, string>;

/**
 * Only English (the fallback) ships in the main bundle. Every other language pack is a
 * separate chunk loaded on demand, which removes ~1,800 lines of strings from first load.
 * t() stays synchronous: call loadLang() (the store does) BEFORE switching the active language.
 */
import en from './i18n-dicts/en';

const loaders: Record<Lang, () => Promise<{ default: Dict }>> = {
  ar: () => import('./i18n-dicts/ar'), en: () => Promise.resolve({ default: en }),
  ru: () => import('./i18n-dicts/ru'), es: () => import('./i18n-dicts/es'), pt: () => import('./i18n-dicts/pt'),
  fr: () => import('./i18n-dicts/fr'), de: () => import('./i18n-dicts/de'), tr: () => import('./i18n-dicts/tr'),
  zh: () => import('./i18n-dicts/zh'), hi: () => import('./i18n-dicts/hi'), id: () => import('./i18n-dicts/id'),
  bn: () => import('./i18n-dicts/bn'), ja: () => import('./i18n-dicts/ja'), ko: () => import('./i18n-dicts/ko'),
  ur: () => import('./i18n-dicts/ur'),
};
const cache: Partial<Record<Lang, Dict>> = { en };
const pending: Partial<Record<Lang, Promise<void>>> = {};

export function isLangLoaded(lang: Lang): boolean { return Boolean(cache[lang]); }

export function loadLang(lang: Lang): Promise<void> {
  if (cache[lang]) return Promise.resolve();
  return (pending[lang] ??= loaders[lang]().then((m) => { cache[lang] = m.default; }).finally(() => { delete pending[lang]; }));
}

export function t(lang: Lang, key: string): string {
  return cache[lang]?.[key] ?? en[key] ?? key;
}

export function dirOf(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr';
}
