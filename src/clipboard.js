import { localeName as displayLocale, localeNamesByLanguage, unknownLocaleName } from '../public/locales.js';
import { t, getLanguage, withLanguage } from './i18n.js';
const localeName = (locale) => displayLocale(locale, getLanguage());

const HEADER_LANGUAGE = new Set(['language', 'language code', 'язык', 'язык код', 'код языка', 'локаль', 'locale', 'locale code', 'locales', 'lang']);
const HEADER_TEXT = new Set(['text', 'translation', 'перевод', 'текст', 'value', 'what\'s new', 'whats new', 'что нового', 'release notes', 'release note', 'changelog']);

const LANGUAGE_ALIASES = new Map();
function addAliases(locale, aliases) {
  for (const alias of aliases) LANGUAGE_ALIASES.set(normalizeLabel(alias), locale);
}

addAliases('ru', ['ru', 'русский', 'русский язык', 'russian']);
addAliases('en', ['en', 'english', 'английский', 'английский язык']);
addAliases('en-US', ['en-us', 'en_us', 'english us', 'english usa', 'english united states', 'english united states of america', 'английский сша', 'английский соединенные штаты', 'английский соединённые штаты']);
addAliases('en-GB', ['en-gb', 'en_gb', 'en-uk', 'en_uk', 'english uk', 'english united kingdom', 'english great britain', 'английский великобритания', 'английский соединенное королевство', 'английский соединённое королевство']);
addAliases('en-AU', ['en-au', 'en_au', 'english australia', 'английский австралия']);
addAliases('en-CA', ['en-ca', 'en_ca', 'english canada', 'английский канада']);
addAliases('fr-FR', ['fr-fr', 'fr_fr', 'french france', 'французский франция']);
addAliases('fr-CA', ['fr-ca', 'fr_ca', 'french canada', 'французский канада']);
addAliases('pt-BR', ['pt-br', 'pt_br', 'portuguese brazil', 'brazilian portuguese', 'португальский бразилия', 'бразильский португальский']);
addAliases('pt-PT', ['pt-pt', 'pt_pt', 'portuguese portugal', 'european portuguese', 'португальский португалия']);
addAliases('es-ES', ['es-es', 'es_es', 'spanish spain', 'castilian spanish', 'испанский испания']);
addAliases('es-MX', ['es-mx', 'es_mx', 'spanish mexico', 'mexican spanish', 'испанский мексика']);
addAliases('zh-Hans', ['zh-hans', 'zh_hans', 'zh-cn', 'zh_cn', 'zh-sg', 'zh_sg', 'chinese simplified', 'simplified chinese', '中文 简体', '简体中文', 'упрощенный китайский', 'упрощённый китайский', 'китайский упрощенный', 'китайский упрощённый']);
addAliases('zh-Hant', ['zh-hant', 'zh_hant', 'zh-tw', 'zh_tw', 'zh-hk', 'zh_hk', 'zh-mo', 'zh_mo', 'chinese traditional', 'traditional chinese', 'китайский традиционный', 'традиционный китайский', '中文 繁體', '繁體中文', '繁体中文']);
addAliases('zh', ['zh', 'chinese', 'китайский', 'китайский язык', '中文']);

const COMMON_LANGUAGES = {
  fr: ['fr', 'french', 'французский', 'французский язык'],
  de: ['de', 'german', 'немецкий', 'немецкий язык'],
  es: ['es', 'spanish', 'испанский', 'испанский язык'],
  it: ['it', 'italian', 'итальянский', 'итальянский язык'],
  ja: ['ja', 'japanese', 'японский', 'японский язык'],
  ko: ['ko', 'korean', 'корейский', 'корейский язык'],
  pt: ['pt', 'portuguese', 'португальский', 'португальский язык'],
  nl: ['nl', 'dutch', 'нидерландский', 'голландский'],
  pl: ['pl', 'polish', 'польский'],
  uk: ['uk', 'ukrainian', 'украинский'],
  ar: ['ar', 'arabic', 'арабский'],
  tr: ['tr', 'turkish', 'турецкий'],
  sv: ['sv', 'swedish', 'шведский'],
  da: ['da', 'danish', 'датский'],
  fi: ['fi', 'finnish', 'финский'],
  no: ['no', 'norwegian', 'норвежский', 'норвежский язык'],
  nb: ['nb', 'bokmal', 'бокмол'],
  th: ['th', 'thai', 'тайский'],
  vi: ['vi', 'vietnamese', 'вьетнамский'],
  id: ['id', 'indonesian', 'индонезийский'],
  ms: ['ms', 'malay', 'малайский'],
  el: ['el', 'greek', 'греческий'],
  he: ['he', 'hebrew', 'иврит', 'еврейский'],
  cs: ['cs', 'czech', 'чешский'],
  hu: ['hu', 'hungarian', 'венгерский'],
  ro: ['ro', 'romanian', 'румынский'],
  sk: ['sk', 'slovak', 'словацкий'],
  hr: ['hr', 'croatian', 'хорватский'],
  sr: ['sr', 'serbian', 'сербский'],
  hi: ['hi', 'hindi', 'хинди'],
  bn: ['bn', 'bengali', 'бенгальский'],
  gu: ['gu', 'gujarati', 'гуджарати'],
  kn: ['kn', 'kannada', 'каннада'],
  ml: ['ml', 'malayalam', 'малаялам'],
  mr: ['mr', 'marathi', 'маратхи'],
  or: ['or', 'odia', 'ория'],
  pa: ['pa', 'punjabi', 'панджаби'],
  sl: ['sl', 'slovenian', 'словенский'],
  ta: ['ta', 'tamil', 'тамильский'],
  te: ['te', 'telugu', 'телугу'],
  ur: ['ur', 'urdu', 'урду'],
};
for (const [locale, aliases] of Object.entries(COMMON_LANGUAGES)) addAliases(locale, aliases);

function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

function localeParts(locale) {
  const normalized = String(locale).trim().replaceAll('_', '-');
  const parts = normalized.split('-');
  return { normalized, language: parts[0].toLowerCase(), region: parts.slice(1).join('-').toLowerCase() };
}

function splitMarkdownRow(line) {
  let value = line.trim();
  const leadingPipe = value.startsWith('|');
  if (leadingPipe) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|') && (leadingPipe || value.indexOf('|') < value.length - 1)) value = value.slice(0, -1);
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const char of value) {
    if (char === '|' && !escaped) {
      cells.push(cell.trim().replaceAll('\\|', '|'));
      cell = '';
    } else {
      cell += char;
      if (char === '\\') escaped = !escaped;
      else escaped = false;
    }
  }
  cells.push(cell.trim().replaceAll('\\|', '|'));
  return cells;
}

function hasUnquotedTab(text) {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (text[index] === '\t' && !quoted) return true;
  }
  return false;
}

function parseTsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  let atCellStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        cell += char === '\r' && text[index + 1] === '\n' ? (index += 1, '\n') : char === '\r' ? '\n' : char;
      }
      continue;
    }
    if (closedQuote && char !== '\t' && char !== '\r' && char !== '\n' && !/\s/.test(char)) {
      return { error: t('tsvQuotes') };
    }
    if (char === '"') {
      if (!atCellStart || cell.trim()) {
        cell += char;
        atCellStart = false;
      } else {
        cell = '';
        quoted = true;
        closedQuote = false;
      }
    } else if (char === '\t' || char === '\r' || char === '\n') {
      row.push(cell.trim());
      cell = '';
      closedQuote = false;
      atCellStart = true;
      if (char === '\t') continue;
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      rows.push(row);
      row = [];
    } else {
      if (!/\s/.test(char) || cell) atCellStart = false;
      if (!closedQuote) cell += char;
    }
  }
  if (quoted) return { error: t('tsvUnclosed') };
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  const filtered = rows.filter((value) => value.some((part) => part.trim()));
  if (filtered.length && filtered.some((value) => value.length !== filtered[0].length)) {
    return { error: t('tsvColumns') };
  }
  return { rows: filtered };
}

function parseRows(text) {
  if (typeof text !== 'string') return { rows: [], format: null, error: t('tableFormat') };
  const input = text.replace(/^\uFEFF/, '');
  if (!input.trim()) return { rows: [], format: null, error: t('tableEmpty') };
  let rows;
  let format;
  if (hasUnquotedTab(input)) {
    const parsedTsv = parseTsv(input);
    if (parsedTsv.error) return { rows: [], format: null, error: parsedTsv.error };
    rows = parsedTsv.rows;
    format = 'TSV';
  } else {
    const lines = input.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim());
    if (!lines.some((line) => line.includes('|'))) return { rows: [], format: null, error: t('tableSeparators') };
    rows = lines.map(splitMarkdownRow);
    rows = rows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
    format = 'Markdown';
  }
  if (rows.some((row) => row.length !== rows[0]?.length)) {
    return { rows: [], format: null, error: t('tableColumns') };
  }
  if (rows[0]?.length < 2 || rows.length < 2) {
    return { rows: [], format: null, error: t('tableSize') };
  }
  return { rows, format };
}

function isHeaderPair(row) {
  return row.length >= 2 && HEADER_LANGUAGE.has(normalizeLabel(row[0])) && HEADER_TEXT.has(normalizeLabel(row[1]));
}

function isTextHeader(value) {
  return HEADER_TEXT.has(normalizeLabel(value));
}

function nameIndex(targets) {
  const index = new Map();
  for (const language of ['en', 'ru']) for (const [locale, name] of [...Object.entries(localeNamesByLanguage[language]), ...targets.map((locale) => [locale, displayLocale(locale, language)])]) {
    if (name === unknownLocaleName(language)) continue;
    const key = normalizeLabel(name);
    if (!index.has(key)) index.set(key, new Map());
    index.get(key).set(localeParts(locale).normalized.toLowerCase(), locale);
  }
  return index;
}

function ambiguousName(label, locales) {
  const names = [...new Set(locales.map(localeName))];
  return t('ambiguousLanguage', { label: label, locales: names.join(', ') });
}

function sourceLocale(label, index) {
  const raw = String(label ?? '').trim();
  const labelKey = normalizeLabel(raw);
  const named = index.get(labelKey);
  if (named) {
    const locales = [...named.values()];
    if (locales.length > 1) return { recognized: true, error: ambiguousName(raw, locales) };
    return { canonical: locales[0], explicit: locales[0].toLowerCase() !== 'en', recognized: true };
  }
  if (['en', 'ru'].some((language) => labelKey === normalizeLabel(unknownLocaleName(language)))) return { recognized: true, error: t('unknownLanguage') };
  const alias = LANGUAGE_ALIASES.get(labelKey);
  if (alias) return { canonical: alias, explicit: alias.includes('-'), recognized: true };
  const annotated = raw.match(/^(.+?)\s*(?:\[([a-z]{2,3}(?:[-_][a-z0-9]{2,8})*)\]|\(([a-z]{2,3}(?:[-_][a-z0-9]{2,8})*)\))$/i);
  if (annotated) {
    const parts = (annotated[2] || annotated[3]).replaceAll('_', '-').split('-');
    const canonical = [parts[0].toLowerCase(), ...parts.slice(1).map((part) => part.length === 4 ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part.length === 2 ? part.toUpperCase() : part)].join('-');
    const name = annotated[1].trim();
    const named = sourceLocale(name, index);
    const consistent = !named.error && (named.recognized
      ? named.explicit ? named.canonical.toLowerCase() === canonical.toLowerCase() : localeParts(named.canonical).language === localeParts(canonical).language
      : ['en', 'ru'].some((language) => normalizeLabel(name) === normalizeLabel(displayLocale(canonical, language))));
    if (!consistent) return { recognized: false, error: t('inconsistentLanguage', { name: name, locale: localeName(canonical) }) };
    return { canonical, explicit: true, recognized: true };
  }
  const code = raw.replaceAll('_', '-');
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code)) {
    const parts = code.split('-');
    const canonical = [parts[0].toLowerCase(), ...parts.slice(1).map((part) => part.length === 4 ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part.length === 2 ? part.toUpperCase() : part)].join('-');
    return { canonical, explicit: parts.length > 1, recognized: true };
  }
  return { recognized: false };
}

function canBeLocaleHeader(value, index) {
  return sourceLocale(value, index).recognized;
}

function targetList(targetLocales) {
  if (!Array.isArray(targetLocales)) return [];
  return [...new Map(targetLocales.filter((locale) => typeof locale === 'string' && locale.trim()).map((locale) => [localeParts(locale).normalized.toLowerCase(), locale.trim()])).values()];
}

function resolveLocale(label, targets, index) {
  const source = sourceLocale(label, index);
  if (source.error) return { error: source.error };
  if (!source.recognized) return { error: source.error || t('unrecognizedLanguage', { name: String(label).trim() }) };
  const candidates = targets.filter((target) => {
    const targetCode = String(target).trim().replaceAll('_', '-');
    if (source.explicit) return targetCode.toLowerCase() === source.canonical.toLowerCase();
    return localeParts(targetCode).language === source.canonical.toLowerCase();
  });
  if (candidates.length === 1) return { locale: candidates[0] };
  if (candidates.length > 1) return { ambiguous: true, error: ambiguousName(localeName(source.canonical), candidates) };
  return { missing: source.canonical };
}

function collect(entries, issues) {
  const byLocale = new Map();
  for (const entry of entries) {
    if (!entry.text.trim()) continue;
    const prior = byLocale.get(entry.locale);
    if (prior) {
      prior.duplicate = true;
      issues.push(t('duplicateTranslation', { locale: localeName(entry.locale) }));
    } else {
      byLocale.set(entry.locale, { ...entry, duplicate: false });
    }
  }
  return [...byLocale.values()].filter((entry) => !entry.duplicate).map(({ locale, text }) => ({ locale, text }));
}

/** Разбирает Markdown-таблицу или TSV в переводы только для существующих целевых локалей. */
function parseClipboardInternal(text, targetLocales) {
  const parsed = parseRows(text);
  if (parsed.error) return { translations: [], issues: [parsed.error] };
  const targets = targetList(targetLocales);
  if (!targets.length) return { translations: [], issues: [t('noTargetLocales')] };

  const index = nameIndex(targets);
  const isLocaleHeader = (value) => canBeLocaleHeader(value, index);
  const { rows } = parsed;
  const issues = [];
  const entries = [];
  const skipped = [];
  let orientation;
  let startRow = 0;
  let columns = [];

  if (isHeaderPair(rows[0])) {
    orientation = 'vertical';
    startRow = 1;
  } else {
    const horizontalWithTextColumn = isTextHeader(rows[0][0]);
    const horizontalLanguages = rows[0].every(isLocaleHeader);
    const couldAlsoBeVertical = horizontalLanguages && rows.every((row) => row.length === 2 && isLocaleHeader(row[0]));
    const incompleteHeader = rows[0].some(isLocaleHeader) && !rows.slice(1).some((row) => isLocaleHeader(row[0]));
    if (couldAlsoBeVertical || (!horizontalWithTextColumn && !horizontalLanguages && incompleteHeader)) {
      return { translations: [], issues: [t('tableOrientation')] };
    }
    if (horizontalWithTextColumn || horizontalLanguages) {
      orientation = 'horizontal';
      columns = horizontalWithTextColumn ? rows[0].slice(1) : rows[0];
      startRow = 1;
    } else {
      orientation = 'vertical';
    }
  }

  if (orientation === 'vertical') {
    for (const row of rows.slice(startRow)) {
      if (row.length !== 2) {
        issues.push(t('twoColumns'));
        continue;
      }
      const [label, ...textParts] = row;
      if (!textParts[0].trim()) continue;
      const resolved = resolveLocale(label, targets, index);
      if (resolved.error) {
        issues.push(resolved.error);
        continue;
      }
      if (resolved.missing) { skipped.push(resolved.missing); continue; }
      entries.push({ locale: resolved.locale, text: textParts[0].trim() });
    }
  } else {
    for (const row of rows.slice(startRow)) {
      const values = columns.length === rows[0].length ? row : row.slice(1);
      if (values.length !== columns.length) {
        issues.push(t('headerCount'));
        continue;
      }
      columns.forEach((label, columnIndex) => {
        if (!values[columnIndex].trim()) return;
        const resolved = resolveLocale(label, targets, index);
        if (resolved.error) issues.push(resolved.error);
        else if (resolved.missing) skipped.push(resolved.missing);
        else entries.push({ locale: resolved.locale, text: values[columnIndex].trim() });
      });
    }
  }

  return { translations: collect(entries, issues), issues: [...new Set(issues)], ...(skipped.length ? { skipped: [...new Set(skipped)] } : {}) };
}

export function parseClipboard(text, targetLocales, language = getLanguage()) {
  return withLanguage(language, () => parseClipboardInternal(text, targetLocales));
}
