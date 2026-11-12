import { parseClipboard } from './clipboard.js';
import { localeLabel } from '../public/locales.js';

const LOCALE_ORDER = [
  'en-US', 'en-AU', 'en-GB', 'en-CA', 'ar-SA', 'vi', 'da', 'id', 'es-ES',
  'it', 'zh-Hant', 'zh-Hans', 'ko', 'de-DE', 'nl-NL', 'no', 'pl',
  'pt-BR', 'pt-PT', 'ru', 'uk', 'fr-FR', 'fr-CA', 'hr', 'sv', 'ja',
];
const LOCALE_RANK = new Map(LOCALE_ORDER.map((locale, index) => [locale, index]));

function compareLocales(a, b) {
  const rank = (locale) => LOCALE_RANK.get(locale) ?? LOCALE_ORDER.length;
  return rank(a) - rank(b) || a.localeCompare(b, 'en');
}

export function findDraft(versions, platform) {
  const drafts = versions.filter((v) => v?.attributes?.platform === platform && v.attributes.appVersionState === 'PREPARE_FOR_SUBMISSION');
  if (drafts.length !== 1) throw new Error(`Для ${platform} нужен один черновик Prepare for Submission. Найдено: ${drafts.length}.`);
  return drafts[0];
}

export function draftLocales(localizations) {
  if (!localizations.length) throw new Error('В черновике нет локализаций.');
  const locales = localizations.map((item) => item?.attributes?.locale);
  if (locales.some((locale) => typeof locale !== 'string' || !locale) || new Set(locales).size !== locales.length) {
    throw new Error('Некорректные локализации черновика.');
  }
  return locales.sort(compareLocales);
}

export function findVersionPair(versions, platform) {
  const matching = versions.filter((v) => v?.attributes?.platform === platform);
  const live = matching.filter((v) => v.attributes.appVersionState === 'READY_FOR_DISTRIBUTION')
    .sort((a, b) => (Date.parse(b.attributes.createdDate) || 0) - (Date.parse(a.attributes.createdDate) || 0));
  const draft = matching.filter((v) => v.attributes.appVersionState === 'PREPARE_FOR_SUBMISSION');
  if (!live.length || draft.length !== 1) {
    throw new Error(`Для ${platform} нужна опубликованная версия и один черновик Prepare for Submission. Найдено: ${live.length} и ${draft.length}.`);
  }
  return { live, draft: draft[0] };
}

export function makePlan(source, target) {
  const sourceByLocale = new Map();
  const targetLocales = new Set();
  for (const item of source) {
    const locale = item?.attributes?.locale;
    if (typeof locale !== 'string' || !locale || sourceByLocale.has(locale)) throw new Error('Некорректные локализации опубликованной версии.');
    sourceByLocale.set(locale, item.attributes.whatsNew);
  }
  const changes = [];
  const missing = [];
  const unchanged = [];
  for (const item of target) {
    const locale = item?.attributes?.locale;
    if (typeof locale !== 'string' || !locale || typeof item.id !== 'string' || !item.id || targetLocales.has(locale)) {
      throw new Error('Некорректные локализации черновика.');
    }
    targetLocales.add(locale);
    const text = sourceByLocale.get(locale);
    const previous = item.attributes.whatsNew ?? '';
    if (typeof previous !== 'string') throw new Error(`Некорректный текст черновика: ${localeLabel(locale)}.`);
    if (typeof text !== 'string' || !text.trim()) missing.push(locale);
    else if (text === previous) unchanged.push(locale);
    else changes.push({ id: item.id, locale, previous, text });
  }
  changes.sort((a, b) => compareLocales(a.locale, b.locale));
  missing.sort(compareLocales);
  unchanged.sort(compareLocales);
  const sourceOnly = [...sourceByLocale.keys()].filter((locale) => !targetLocales.has(locale)).sort(compareLocales);
  return { changes, missing, unchanged, sourceOnly };
}

export function makeClipboardPlan(text, target) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Вставьте таблицу с переводами.');
  const parsed = parseClipboard(text, draftLocales(target));
  if (parsed.issues.length) throw new Error(parsed.issues.join('\n'));
  if (!parsed.translations.length) throw new Error(`Во вставленной таблице нет подходящих переводов.${parsed.skipped?.length ? ` Нет в черновике: ${parsed.skipped.map(localeLabel).join(', ')}.` : ''}`);
  const plan = makePlan(parsed.translations.map(({ locale, text: whatsNew }) => ({ attributes: { locale, whatsNew } })), target);
  plan.sourceOnly = (parsed.skipped ?? []).sort(compareLocales);
  return plan;
}

export async function planConflict(api, { appId, platform, sourceId, draftId, plan }) {
  const versions = await api.versions(appId);
  const { live, draft } = sourceId ? findVersionPair(versions, platform) : { live: [], draft: findDraft(versions, platform) };
  if (draft.id !== draftId || (sourceId && !live.some((version) => version.id === sourceId))) {
    return 'Состояние версий изменилось. Подготовьте предпросмотр заново.';
  }
  const current = await api.localizations(draft.id);
  const currentById = new Map(current.map((item) => [item.id, item.attributes.whatsNew ?? '']));
  if (plan.changes.some((change) => currentById.get(change.id) !== change.previous)) {
    return 'Тексты в черновике изменились. Подготовьте предпросмотр заново.';
  }
  return null;
}

export async function applyPlan(api, plan, report = () => {}) {
  const failed = [];
  let updated = 0;
  for (const change of plan.changes) {
    try {
      await api.updateWhatsNew(change.id, change.text);
      updated++;
      report(change.locale, null);
    } catch (error) {
      failed.push({ locale: change.locale, error: error.message });
      report(change.locale, error);
    }
  }
  return { updated, failed };
}
