import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { AppStoreApi, loadConfig } from './api.js';
import { findDraft, draftLocales, findVersionPair, makePlan, makeClipboardPlan, applyPlan, planConflict } from './release-notes.js';
import { findStoreVersion } from './store-lookup.js';
import { diffText } from '../public/diff.js';
import { makePrompt } from '../public/prompt.js';
import { localeLabel as displayLocale } from '../public/locales.js';
import { t, getLanguage, withLanguage, AppError } from './i18n.js';
import { configureLanguage, readLanguage } from './preferences.js';
const localeLabel = (locale) => displayLocale(locale, getLanguage());

export function formatDiff(parts, color, enabled = stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb') {
  return parts.map((part) => part.changed && enabled ? `\x1b[${color}m${part.text}\x1b[0m` : part.text).join('');
}

async function choose(rl, title, items, label, defaultItem = null, defaultPrompt = t('chooseCurrent')) {
  if (!items.length) throw new AppError('noOptions', { title });
  console.log(`\n${title}:`);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${label(item)}`));
  while (true) {
    const value = (await rl.question(defaultItem ? defaultPrompt : t('chooseNumber'))).trim();
    if (!value && defaultItem) return defaultItem;
    if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= items.length) return items[Number(value) - 1];
    console.log(t('numberFromList'));
  }
}

function readTable(rl) {
  console.log(t('pasteCli'));
  return new Promise((resolve, reject) => {
    const lines = [];
    const cleanup = () => { rl.removeListener('line', onLine); rl.removeListener('close', onClose); };
    const onLine = (line) => { if (line === '.') { cleanup(); resolve(lines.join('\n')); } else lines.push(line); };
    const onClose = () => { cleanup(); reject(new AppError('inputInterrupted')); };
    rl.on('line', onLine);
    rl.once('close', onClose);
  });
}

async function runCliInternal(api, rl, lookup = findStoreVersion, readClipboard = readTable) {
  console.log(t('loadingApps'));
  const apps = await api.apps();
  const app = await choose(rl, t('chooseApp'), apps, (a) => `${a.attributes.name} (${a.attributes.bundleId})`);
  console.log(t('loadingVersions'));
  const versions = await api.versions(app.id);
  const platforms = [...new Set(versions.map((v) => v.attributes.platform))];
  const platform = await choose(rl, t('choosePlatform'), platforms, (p) => p);
  const sourceType = await choose(rl, t('chooseSource'), ['version', 'clipboard'], (type) => type === 'version' ? t('publishedVersion') : t('translationTable'), 'version', t('defaultPublished'));
  let draft;
  let sourceId = null;
  let sourceLabel;
  let plan;
  if (sourceType === 'clipboard') {
    draft = findDraft(versions, platform);
    const target = await api.localizations(draft.id);
    console.log(t('aiPrompt', { prompt: makePrompt(draftLocales(target), getLanguage()) }));
    const text = await readClipboard(rl);
    console.log(t('loadingTexts'));
    plan = makeClipboardPlan(text, await api.localizations(draft.id));
    sourceLabel = t('pastedTableLower');
  } else {
    const pair = findVersionPair(versions, platform);
    draft = pair.draft;
    const current = await lookup(app.id, platform, pair.live);
    if (!current) console.log(t('currentLookupFailed'));
    const live = await choose(
      rl,
      t('choosePublished'),
      pair.live,
      (v) => `${v.attributes.versionString}${v.id === current?.id ? t('currentSuffix') : ''}${v.attributes.createdDate ? t('createdSuffix', { date: v.attributes.createdDate.slice(0, 10) }) : ''}`,
      current,
    );
    sourceId = live.id;
    sourceLabel = t('publishedSource', { version: live.attributes.versionString });
    console.log(t('loadingTexts'));
    const [source, target] = await Promise.all([api.localizations(live.id), api.localizations(draft.id)]);
    if (!target.length) throw new AppError('emptyDraft');
    plan = makePlan(source, target);
  }
  console.log(t('cliApp', { app: app.attributes.name, platform }));
  console.log(t('cliTarget', { source: sourceLabel, draft: draft.attributes.versionString }));
  for (const c of plan.changes) {
    const diff = diffText(c.previous, c.text);
    console.log(t('cliDiff', { locale: localeLabel(c.locale), before: formatDiff(diff.before, 31) || t('empty'), after: formatDiff(diff.after, 32) }));
    if (diff.approximate) console.log(t('approximateDiff'));
  }
  if (plan.unchanged.length) console.log(t('unchanged', { locales: plan.unchanged.map(localeLabel).join(', ') }));
  if (plan.missing.length) console.log(t('missingSource', { source: sourceType === 'clipboard' ? t('inTable') : t('inPublished'), locales: plan.missing.map(localeLabel).join(', ') }));
  if (plan.sourceOnly.length) console.log(t('missingTarget', { locales: plan.sourceOnly.map(localeLabel).join(', ') }));
  if (!plan.changes.length) return console.log(t('noChanges'));
  console.log(t('onlyWhatsNew', { count: plan.changes.length }));
  const answer = (await rl.question(t('confirmSave'))).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') return console.log(t('cancelled'));
  const conflict = await planConflict(api, { appId: app.id, platform, sourceId, draftId: draft.id, plan });
  if (conflict) throw new Error(conflict);
  console.log(t('savingTexts'));
  const result = await applyPlan(api, plan, (locale, error) => console.log(`${localeLabel(locale)}: ${error ? t('cliSaveError', { message: error.message }) : t('saved')}`));
  console.log(t('cliResult', { updated: result.updated, failed: result.failed.length }));
  if (result.failed.length) process.exitCode = 1;
}

export function runCli(api, rl, lookup = findStoreVersion, readClipboard = readTable, language = 'en') {
  return withLanguage(language, () => runCliInternal(api, rl, lookup, readClipboard));
}

export async function main() {
  const language = await configureLanguage(process.argv.slice(2));
  return withLanguage(language, async () => {
    if (!stdin.isTTY || !stdout.isTTY) throw new AppError('ttyRequired');
    const api = new AppStoreApi(await loadConfig());
    const rl = createInterface({ input: stdin, output: stdout });
    try { await runCliInternal(api, rl); } finally { rl.close(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    const language = error.language ?? await readLanguage();
    withLanguage(language, () => console.error(t('error', { message: error.message })));
    process.exitCode = 1;
  });
}
