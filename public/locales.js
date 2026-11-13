export const russianLocaleNames = Object.freeze({
  'en-US': 'английский (США)', 'en-AU': 'английский (Австралия)',
  'en-GB': 'английский (Великобритания)', 'en-CA': 'английский (Канада)',
  'ar-SA': 'арабский', vi: 'вьетнамский', da: 'датский', id: 'индонезийский',
  'es-ES': 'испанский (Испания)', 'es-MX': 'испанский (Мексика)', it: 'итальянский',
  'zh-Hant': 'китайский (традиционный)', 'zh-Hans': 'китайский (упрощённый)',
  ko: 'корейский', 'de-DE': 'немецкий', 'nl-NL': 'нидерландский', no: 'норвежский',
  pl: 'польский', 'pt-BR': 'португальский (Бразилия)', 'pt-PT': 'португальский (Португалия)',
  ru: 'русский', uk: 'украинский', 'fr-FR': 'французский', 'fr-CA': 'французский (Канада)',
  hr: 'хорватский', sv: 'шведский', ja: 'японский',
});
export const localeNames = Object.freeze({
  "en-US": "English (United States)",
  "en-AU": "English (Australia)",
  "en-GB": "English (United Kingdom)",
  "en-CA": "English (Canada)",
  "ar-SA": "Arabic",
  "vi": "Vietnamese",
  "da": "Danish",
  "id": "Indonesian",
  "es-ES": "Spanish (Spain)",
  "es-MX": "Spanish (Mexico)",
  "it": "Italian",
  "zh-Hant": "Chinese (Traditional)",
  "zh-Hans": "Chinese (Simplified)",
  "ko": "Korean",
  "de-DE": "German",
  "nl-NL": "Dutch",
  "no": "Norwegian",
  "pl": "Polish",
  "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)",
  "ru": "Russian",
  "uk": "Ukrainian",
  "fr-FR": "French",
  "fr-CA": "French (Canada)",
  "hr": "Croatian",
  "sv": "Swedish",
  "ja": "Japanese"
});
export const localeNamesByLanguage = Object.freeze({ en: localeNames, ru: russianLocaleNames });
export const UNKNOWN_LOCALE_NAME = 'unknown language';
export const unknownLocaleName = (language = 'en') => language === 'ru' ? 'неизвестный язык' : UNKNOWN_LOCALE_NAME;
const displayNames = Object.fromEntries(['en', 'ru'].map((language) => [language,
  typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(language, { type: 'language', fallback: 'none' }) : null,
]));

export function localeName(locale, language = 'en') {
  language = language === 'ru' ? 'ru' : 'en';
  const unknown = unknownLocaleName(language);
  if (typeof locale !== 'string') return unknown;
  const code = locale.trim().replaceAll('_', '-');
  const match = Object.keys(localeNames).find((key) => key.toLowerCase() === code.toLowerCase());
  if (match) return localeNamesByLanguage[language][match];
  try {
    const name = displayNames[language]?.of(code);
    // Не показываем частично распознанные коды регионов и письменностей.
    if (!name || name === code || /\((?:[A-Z][a-z]{3}|[A-Z0-9-]{2,})\)/.test(name)) return unknown;
    return language === 'ru' && (/[a-z]/i.test(name) || !/[а-яё]/i.test(name)) ? unknown : name;
  } catch {
    return unknown;
  }
}

export function localeLabel(locale, language = 'en') {
  return localeName(locale, language);
}
