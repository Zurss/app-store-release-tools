import { localeLabel, localeNamesByLanguage, unknownLocaleName } from './locales.js';
import { translate } from './i18n.js';

export function makePrompt(locales, language = 'en') {
  language = language === 'ru' ? 'ru' : 'en';
  const names = locales.map((locale) => localeLabel(locale, language));
  const known = new Map(Object.entries(localeNamesByLanguage[language]).map(([locale, name]) => [name, locale.toLowerCase()]));
  if (names.includes(unknownLocaleName(language)) || new Set(names).size !== names.length || names.some((name, index) => known.has(name) && known.get(name) !== locales[index].toLowerCase())) {
    const error = new Error(translate(language, 'promptNames'));
    error.key = 'promptNames';
    throw error;
  }
  return translate(language, 'prompt', { names: names.join(', ') });
}
