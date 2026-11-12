import { localeLabel, localeNames, UNKNOWN_LOCALE_NAME } from './locales.js';

export function makePrompt(locales) {
  const names = locales.map(localeLabel);
  const known = new Map(Object.entries(localeNames).map(([locale, name]) => [name, locale.toLowerCase()]));
  if (names.includes(UNKNOWN_LOCALE_NAME) || new Set(names).size !== names.length || names.some((name, index) => known.has(name) && known.get(name) !== locales[index].toLowerCase())) {
    throw new Error('Не удалось однозначно определить названия языков черновика. Проверьте локализации в App Store Connect.');
  }
  return `Подготовь короткий текст «Что нового» для App Store.\n\nИзменения: [опишите изменения].\n\nПереведи текст для каждой локализации: ${names.join(', ')}.\nВерни только Markdown-таблицу с двумя столбцами: «Язык» и «Что нового». В первом столбце укажи точное название языка из списка, во втором — перевод. Сохрани смысл и не добавляй неподтверждённых изменений.`;
}
