export const localeNames = Object.freeze({
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
export const UNKNOWN_LOCALE_NAME = 'неизвестный язык';
const displayNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames('ru', { type: 'language', fallback: 'none' }) : null;

export function localeName(locale) {
  if (typeof locale !== 'string') return UNKNOWN_LOCALE_NAME;
  const code = locale.trim().replaceAll('_', '-');
  const match = Object.keys(localeNames).find((key) => key.toLowerCase() === code.toLowerCase());
  if (match) return localeNames[match];
  try {
    const name = displayNames?.of(code);
    return name && /[а-яё]/i.test(name) && !/[a-z]/i.test(name) ? name : UNKNOWN_LOCALE_NAME;
  } catch {
    return UNKNOWN_LOCALE_NAME;
  }
}

export function localeLabel(locale) {
  return localeName(locale);
}
