import { parseClipboard } from './clipboard.js';
import { localeLabel as displayLocale } from '../public/locales.js';
import { t, AppError, getLanguage, withLanguage, errorData } from './i18n.js';
const localeLabel = (locale) => displayLocale(locale, getLanguage());

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

function findDraftInternal(versions, platform) {
  const drafts = versions.filter((v) => v?.attributes?.platform === platform && v.attributes.appVersionState === 'PREPARE_FOR_SUBMISSION');
  if (drafts.length !== 1) throw new AppError('oneDraft', { platform: platform, count: drafts.length });
  return drafts[0];
}

function draftLocalesInternal(localizations) {
  if (!localizations.length) throw new AppError('emptyDraft');
  const locales = localizations.map((item) => item?.attributes?.locale);
  if (locales.some((locale) => typeof locale !== 'string' || !locale) || new Set(locales).size !== locales.length) {
    throw new AppError('invalidDraftLocales');
  }
  return locales.sort(compareLocales);
}

function findVersionPairInternal(versions, platform) {
  const matching = versions.filter((v) => v?.attributes?.platform === platform);
  const live = matching.filter((v) => v.attributes.appVersionState === 'READY_FOR_DISTRIBUTION')
    .sort((a, b) => (Date.parse(b.attributes.createdDate) || 0) - (Date.parse(a.attributes.createdDate) || 0));
  const draft = matching.filter((v) => v.attributes.appVersionState === 'PREPARE_FOR_SUBMISSION');
  if (!live.length || draft.length !== 1) {
    throw new AppError('versionPair', { platform: platform, live: live.length, draft: draft.length });
  }
  return { live, draft: draft[0] };
}

function makePlanInternal(source, target) {
  const sourceByLocale = new Map();
  const targetLocales = new Set();
  for (const item of source) {
    const locale = item?.attributes?.locale;
    if (typeof locale !== 'string' || !locale || sourceByLocale.has(locale)) throw new AppError('invalidSourceLocales');
    sourceByLocale.set(locale, item.attributes.whatsNew);
  }
  const changes = [];
  const missing = [];
  const unchanged = [];
  for (const item of target) {
    const locale = item?.attributes?.locale;
    if (typeof locale !== 'string' || !locale || typeof item.id !== 'string' || !item.id || targetLocales.has(locale)) {
      throw new AppError('invalidDraftLocales');
    }
    targetLocales.add(locale);
    const text = sourceByLocale.get(locale);
    const previous = item.attributes.whatsNew ?? '';
    if (typeof previous !== 'string') throw new AppError('invalidDraftText', { locale: { en: displayLocale(locale, 'en'), ru: displayLocale(locale, 'ru') } });
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

function makeClipboardPlanInternal(text, target) {
  if (typeof text !== 'string' || !text.trim()) throw new AppError('pasteTable');
  const parsed = parseClipboard(text, draftLocales(target));
  if (parsed.issues.length) {
    const other = getLanguage() === 'en' ? 'ru' : 'en';
    throw new AppError('tableIssues', { messages: {
      [getLanguage()]: parsed.issues.join('\n'),
      [other]: parseClipboard(text, draftLocales(target), other).issues.join('\n'),
    } });
  }
  if (!parsed.translations.length) {
    const missing = (language) => withLanguage(language, () => parsed.skipped?.length
      ? t('notInDraft', { locales: parsed.skipped.map(localeLabel).join(', ') }) : '');
    throw new AppError('noTranslations', { missing: { en: missing('en'), ru: missing('ru') } });
  }
  const plan = makePlan(parsed.translations.map(({ locale, text: whatsNew }) => ({ attributes: { locale, whatsNew } })), target);
  plan.sourceOnly = (parsed.skipped ?? []).sort(compareLocales);
  return plan;
}

export async function planConflict(api, { appId, platform, sourceId, draftId, plan }) {
  const versions = await api.versions(appId);
  const { live, draft } = sourceId ? findVersionPair(versions, platform) : { live: [], draft: findDraft(versions, platform) };
  if (draft.id !== draftId || (sourceId && !live.some((version) => version.id === sourceId))) {
    return t('versionsChanged');
  }
  const current = await api.localizations(draft.id);
  const currentById = new Map(current.map((item) => [item.id, item.attributes.whatsNew ?? '']));
  if (plan.changes.some((change) => currentById.get(change.id) !== change.previous)) {
    return t('draftChanged');
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
      failed.push({ locale: change.locale, ...errorData(error) });
      report(change.locale, error);
    }
  }
  return { updated, failed };
}

export function findDraft(versions, platform, language = getLanguage()) {
  return withLanguage(language, () => findDraftInternal(versions, platform));
}

export function draftLocales(localizations, language = getLanguage()) {
  return withLanguage(language, () => draftLocalesInternal(localizations));
}

export function findVersionPair(versions, platform, language = getLanguage()) {
  return withLanguage(language, () => findVersionPairInternal(versions, platform));
}

export function makePlan(source, target, language = getLanguage()) {
  return withLanguage(language, () => makePlanInternal(source, target));
}

export function makeClipboardPlan(text, target, language = getLanguage()) {
  return withLanguage(language, () => makeClipboardPlanInternal(text, target));
}
