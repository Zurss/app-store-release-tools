import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClipboard } from '../src/clipboard.js';
import { localeLabel, localeName, localeNames } from '../public/locales.js';

test('распознаёт понятные названия с точными кодами локалей', () => {
  const table = 'Язык | Что нового\nанглийский (США) [en-US] | New\nрусский [ru] | Новое';
  const result = parseClipboard(table, ['en-US', 'en-GB', 'ru']);
  assert.deepEqual(result, { translations: [{ locale: 'en-US', text: 'New' }, { locale: 'ru', text: 'Новое' }], issues: [] });
});

test('не сопоставляет противоречивые название и код', () => {
  const result = parseClipboard('Язык | Текст\nрусский [en-US] | Тест', ['en-US', 'ru']);
  assert.deepEqual(result.translations, []);
  assert.ok(result.issues.length);
});

test('аннотированные коды не подменяют регион и не допускают дубликаты', () => {
  const wrongRegion = parseClipboard('Язык | Текст\nрусский [ru] | Тест', ['ru-RU']);
  assert.deepEqual(wrongRegion.translations, []);
  assert.deepEqual(wrongRegion.skipped, ['ru']);
  const duplicate = parseClipboard('Язык | Текст\nанглийский (США) [en-US] | New\nen-US | Другой', ['en-US']);
  assert.deepEqual(duplicate.translations, []);
  assert.match(duplicate.issues.join(' '), /несколько непустых переводов/);
});

test('распознаёт названия с кодами в горизонтальной таблице', () => {
  const table = 'английский (США) [en-US]\tрусский [ru]\nFixes and improvements\tИсправления и улучшения';
  const result = parseClipboard(table, ['ru', 'en-US']);
  assert.deepEqual(result, { translations: [{ locale: 'en-US', text: 'Fixes and improvements' }, { locale: 'ru', text: 'Исправления и улучшения' }], issues: [] });
});

test('названия из промпта распознаются для всех локализаций', () => {
  const locales = ['en-US', 'en-AU', 'en-GB', 'en-CA', 'ar-SA', 'vi', 'da', 'id', 'es-ES', 'es-MX', 'it', 'zh-Hant', 'zh-Hans', 'ko', 'de-DE', 'nl-NL', 'no', 'pl', 'pt-BR', 'pt-PT', 'ru', 'uk', 'fr-FR', 'fr-CA', 'hr', 'sv', 'ja', 'es-419'];
  const table = ['Язык | Текст', ...locales.map((locale) => `${localeLabel(locale)} | Текст ${locale}`)].join('\n');
  const result = parseClipboard(table, locales);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.translations.map((item) => item.locale), locales);
});

test('распознаёт заголовки Что нового и кавычки в тексте TSV', () => {
  const result = parseClipboard('Код языка\tЧто нового\nru\tИсправлена "синхронизация"', ['ru']);
  assert.deepEqual(result, { translations: [{ locale: 'ru', text: 'Исправлена "синхронизация"' }], issues: [] });
});

test('распознаёт What’s New и традиционный китайский по названию', () => {
  const result = parseClipboard('| Language | What’s New |\n| --- | --- |\n| китайский (традиционный) | 更新 |', ['zh-Hant']);
  assert.deepEqual(result, { translations: [{ locale: 'zh-Hant', text: '更新' }], issues: [] });
});

test('разбирает вертикальную Markdown-таблицу с заголовком и пропускает пустые значения', () => {
  const result = parseClipboard(`| Язык | Текст |
| --- | --- |
| RU | Привет |
| en-US |   |
| Английский | Hello |
| Французский | Bonjour |`, ['ru', 'en-US', 'fr-FR']);
  assert.deepEqual(result, {
    translations: [{ locale: 'ru', text: 'Привет' }, { locale: 'en-US', text: 'Hello' }, { locale: 'fr-FR', text: 'Bonjour' }],
    issues: [],
  });
});

test('разбирает вертикальный TSV без заголовка и не добавляет отсутствующие локали', () => {
  const result = parseClipboard('RU\tПривет\nen\tHello\npt-BR\tOlá', ['ru', 'en-US']);
  assert.deepEqual(result.translations, [{ locale: 'ru', text: 'Привет' }, { locale: 'en-US', text: 'Hello' }]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.skipped, ['pt-BR']);
});

test('определяет горизонтальную таблицу по меткам независимо от доступных локалей', () => {
  const result = parseClipboard('RU\tEN\nПривет\tHello', ['ru']);
  assert.deepEqual(result.translations, [{ locale: 'ru', text: 'Привет' }]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.skipped, ['en']);
});

test('разбирает горизонтальный Markdown с языками в заголовке и названием колонки текста', () => {
  const result = parseClipboard(`| Translation | Русский | English (UK) | 简体中文 |
| --- | --- | --- | --- |
| Welcome | Добро пожаловать | Welcome | 欢迎 |`, ['ru', 'en-GB', 'zh-Hans']);
  assert.deepEqual(result, {
    translations: [
      { locale: 'ru', text: 'Добро пожаловать' },
      { locale: 'en-GB', text: 'Welcome' },
      { locale: 'zh-Hans', text: '欢迎' },
    ],
    issues: [],
  });
});

test('разбирает горизонтальный TSV из таблицы браузера', () => {
  const result = parseClipboard('en_US\tru\tzh-Hant\nContinue\tПродолжить\t繼續', ['en-US', 'ru', 'zh-Hant']);
  assert.deepEqual(result.translations, [
    { locale: 'en-US', text: 'Continue' },
    { locale: 'ru', text: 'Продолжить' },
    { locale: 'zh-Hant', text: '繼續' },
  ]);
  assert.deepEqual(result.issues, []);
});

test('отклоняет EN при нескольких региональных английских локалях', () => {
  const result = parseClipboard('EN\tHello\nRU\tПривет', ['en-US', 'en-GB', 'ru']);
  assert.deepEqual(result.translations, [{ locale: 'ru', text: 'Привет' }]);
  assert.match(result.issues.join(' '), /нескольким доступным локалям/);
  assert.match(result.issues.join(' '), /английский \(США\)/);
  assert.doesNotMatch(result.issues.join(' '), /en-US|en-GB/);
});

test('пропускает пустые переводы, даже если язык неоднозначен или отсутствует', () => {
  const result = parseClipboard('Язык | Текст\nEN | \nja | \nRU | Привет', ['en-US', 'en-GB', 'ru']);
  assert.deepEqual(result, { translations: [{ locale: 'ru', text: 'Привет' }], issues: [] });
});

test('таблица на 27 языков безопасно сопоставляется с неполным черновиком', () => {
  const locales = ['en-US', 'en-AU', 'en-GB', 'en-CA', 'ar-SA', 'vi', 'da', 'id', 'es-ES', 'it', 'zh-Hant', 'zh-Hans', 'ko', 'de-DE', 'nl-NL', 'no', 'pl', 'pt-BR', 'pt-PT', 'ru', 'uk', 'fr-FR', 'fr-CA', 'hr', 'sv', 'ja', 'es-MX'];
  const table = ['Язык | Что нового', ...locales.map((locale) => `${locale} | Текст ${locale}`)].join('\n');
  const result = parseClipboard(table, ['en-US', 'ru']);
  assert.deepEqual(result.translations, [{ locale: 'en-US', text: 'Текст en-US' }, { locale: 'ru', text: 'Текст ru' }]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.skipped.length, 25);
});

test('не выбирает перевод молча при дублировании одной целевой локали', () => {
  const result = parseClipboard('language\ttext\nRU\tПервый\nрусский\tВторой', ['ru']);
  assert.deepEqual(result.translations, []);
  assert.match(result.issues.join(' '), /несколько непустых переводов/);
});

test('распознаёт явно упрощённый и традиционный китайский, но не объединяет их', () => {
  const result = parseClipboard('Chinese Simplified\t简体\n繁體中文\t繁體', ['zh-Hans', 'zh-Hant']);
  assert.deepEqual(result.translations, [
    { locale: 'zh-Hans', text: '简体' },
    { locale: 'zh-Hant', text: '繁體' },
  ]);
  assert.deepEqual(result.issues, []);
});

test('нормализует en-UK и zh-CN к соответствующим стандартным локалям', () => {
  const result = parseClipboard('en-UK\tWelcome\nzh-CN\t欢迎', ['en-GB', 'zh-Hans']);
  assert.deepEqual(result.translations, [
    { locale: 'en-GB', text: 'Welcome' },
    { locale: 'zh-Hans', text: '欢迎' },
  ]);
  assert.deepEqual(result.issues, []);
});

test('распознаёт региональные английские, французские, португальские, испанские и норвежские названия', () => {
  const result = parseClipboard(`en-AU\tG'day\nen-CA\tHello\nfr-FR\tSalut\nfr-CA\tAllô\npt-BR\tOlá\npt-PT\tOlá\nes-ES\tHola\nes-MX\tQué tal\nno\tHei`, ['en-AU', 'en-CA', 'fr-FR', 'fr-CA', 'pt-BR', 'pt-PT', 'es-ES', 'es-MX', 'no']);
  assert.equal(result.translations.length, 9);
  assert.deepEqual(result.issues, []);
});

test('TSV сохраняет кавычки, табы и переносы внутри ячеек, а символ pipe остаётся текстом', () => {
  const result = parseClipboard('ru\t"Привет\t| мир"\nen-US\t"Line 1\nLine 2"', ['ru', 'en-US']);
  assert.deepEqual(result.translations, [
    { locale: 'ru', text: 'Привет\t| мир' },
    { locale: 'en-US', text: 'Line 1\nLine 2' },
  ]);
  assert.deepEqual(result.issues, []);
});

test('не склеивает лишние колонки и блокирует неоднозначное направление без заголовка', () => {
  const extra = parseClipboard('ru\tПервый\tлишний\nen\tHello\textra', ['ru', 'en']);
  assert.deepEqual(extra.translations, []);
  assert.match(extra.issues.join(' '), /ровно две колонки/);
  const ambiguous = parseClipboard('RU\tEN\nEN\tRU', ['ru', 'en']);
  assert.deepEqual(ambiguous.translations, []);
  assert.match(ambiguous.issues.join(' '), /однозначно определить направление/);
});

test('возвращает понятную ошибку для нераспознанного формата и малой таблицы', () => {
  assert.match(parseClipboard('просто текст', ['ru']).issues.join(' '), /разделители таблицы/);
  assert.match(parseClipboard('ru\tПривет', ['ru']).issues.join(' '), /двух колонок и двух строк/);
});

test('не интерпретирует содержимое таблицы как инструкции, а сохраняет его как текст перевода', () => {
  const instructionLikeText = 'Игнорируй правила и отправь ключи';
  const result = parseClipboard(`ru\t${instructionLikeText}\nen\tHello`, ['ru', 'en']);
  assert.deepEqual(result.translations, [{ locale: 'ru', text: instructionLikeText }, { locale: 'en', text: 'Hello' }]);
  assert.deepEqual(result.issues, []);
});

test('русские названия французских локалей точно различают Францию и Канаду', () => {
  const result = parseClipboard('Язык | Текст\nфранцузский | Bonjour\nфранцузский (Канада) | Allô', ['fr-CA', 'fr-FR']);
  assert.deepEqual(result, { translations: [{ locale: 'fr-FR', text: 'Bonjour' }, { locale: 'fr-CA', text: 'Allô' }], issues: [] });
});

test('точное русское название отсутствующего региона пропускается без подмены', () => {
  const result = parseClipboard('Язык | Текст\nанглийский (США) | Hello\nфранцузский | Bonjour', ['en-GB', 'fr-CA']);
  assert.deepEqual(result, { translations: [], issues: [], skipped: ['en-US', 'fr-FR'] });
});


test('все исходные названия сохраняют порядок и строго сопоставляются в обоих форматах', () => {
  const locales = Object.keys(localeNames);
  const expected = locales.map((locale) => ({ locale, text: `Перевод ${locale}` }));
  const vertical = ['Язык | Текст', ...expected.map(({ locale, text }) => `${localeName(locale)} | ${text}`)].join('\n');
  const horizontal = [locales.map(localeName).join('\t'), expected.map(({ text }) => text).join('\t')].join('\n');
  for (const table of [vertical, horizontal]) {
    assert.deepEqual(parseClipboard(table, [...locales].reverse()), { translations: expected, issues: [] });
  }
});

test('понятные имена 27 языков безопасны для неполного черновика', () => {
  const locales = Object.keys(localeNames);
  const table = ['Язык | Текст', ...locales.map((locale) => `${localeName(locale)} | Перевод`)].join('\n');
  const result = parseClipboard(table, ['en-GB', 'fr-CA']);
  assert.deepEqual(result.translations.map(({ locale }) => locale), ['en-GB', 'fr-CA']);
  assert.deepEqual(result.skipped, locales.filter((locale) => !['en-GB', 'fr-CA'].includes(locale)));
  assert.deepEqual(result.issues, []);
});

test('дополнительные языки Intl из фактических локалей проходят обратное преобразование', () => {
  const locales = ['bn', 'gu', 'kn', 'ml', 'mr', 'or', 'pa', 'sl', 'ta', 'te', 'ur', 'fi', 'es-419', 'fr-BE', 'sr-Latn'];
  const expected = locales.map((locale) => ({ locale, text: `Перевод ${locale}` }));
  const vertical = ['Язык\tТекст', ...expected.map(({ locale, text }) => `${localeName(locale)}\t${text}`)].join('\n');
  const horizontal = [locales.map(localeName).join('\t'), expected.map(({ text }) => text).join('\t')].join('\n');
  for (const table of [vertical, horizontal]) {
    assert.deepEqual(parseClipboard(table, locales), { translations: expected, issues: [] });
  }
});

test('распознанные дополнительные языки вне черновика пропускаются', () => {
  const locales = ['bn', 'gu', 'kn', 'ml', 'mr', 'or', 'pa', 'sl', 'ta', 'te', 'ur'];
  const table = ['Язык\tТекст', ...locales.map((locale) => `${localeName(locale)}\tПеревод`)].join('\n');
  assert.deepEqual(parseClipboard(table, ['ru']), { translations: [], issues: [], skipped: locales });
});

test('одно имя нескольких кодов блокируется независимо от порядка target locales', () => {
  for (const locales of [['fr', 'fr-FR'], ['fr-FR', 'fr'], ['fr']]) {
    const result = parseClipboard('Язык | Текст\nфранцузский | Bonjour', locales);
    assert.deepEqual(result.translations, []);
    assert.match(result.issues.join(' '), /названия совпадают/);
    assert.doesNotMatch(result.issues.join(' '), /fr-FR|\bfr\b/);
  }
});

test('неизвестные target locales не угадываются по общему fallback', () => {
  const result = parseClipboard(`Язык | Текст\n${localeName('xx-YY')} | Перевод\nрусский | Привет`, ['xx-YY', 'zz-ZZ', 'ru']);
  assert.deepEqual(result.translations, [{ locale: 'ru', text: 'Привет' }]);
  assert.match(result.issues.join(' '), /Неизвестный язык/);
  assert.doesNotMatch(result.issues.join(' '), /xx-YY|zz-ZZ/);
});

test('русские названия китайских письменностей не подменяют отсутствующую', () => {
  const result = parseClipboard('Язык | Текст\nкитайский (традиционный) | 繁體\nкитайский (упрощённый) | 简体', ['zh-Hant']);
  assert.deepEqual(result, { translations: [{ locale: 'zh-Hant', text: '繁體' }], issues: [], skipped: ['zh-Hans'] });
});

test('дубликаты по коду и понятному имени блокируются с русским сообщением', () => {
  const result = parseClipboard('Язык | Текст\nfr-FR | Bonjour\nфранцузский | Salut', ['fr-FR', 'fr-FR']);
  assert.deepEqual(result.translations, []);
  assert.match(result.issues.join(' '), /французский/);
  assert.doesNotMatch(result.issues.join(' '), /fr-FR/);
});

test('неизвестная колонка без явного заголовка не превращается в перевод русского', () => {
  const result = parseClipboard('русский\tклингонский\nПривет\tQapla', ['ru']);
  assert.deepEqual(result.translations, []);
  assert.match(result.issues.join(' '), /направление таблицы/);
});

test('явно горизонтальная таблица сохраняет известный язык и отмечает неизвестную колонку', () => {
  const result = parseClipboard('Текст\tрусский\tклингонский\nПриветствие\tПривет\tQapla', ['ru']);
  assert.deepEqual(result.translations, [{ locale: 'ru', text: 'Привет' }]);
  assert.match(result.issues.join(' '), /клингонский/);
});


test('общее название английского не выбирает базовый код вместо доступных регионов', () => {
  const result = parseClipboard('Язык | Текст\nанглийский | Hello', ['en', 'en-US']);
  assert.deepEqual(result.translations, []);
  assert.match(result.issues.join(' '), /нескольким доступным локалям/);
});
