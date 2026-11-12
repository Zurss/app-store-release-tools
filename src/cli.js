import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { AppStoreApi, loadConfig } from './api.js';
import { findDraft, draftLocales, findVersionPair, makePlan, makeClipboardPlan, applyPlan, planConflict } from './release-notes.js';
import { findStoreVersion } from './store-lookup.js';
import { diffText } from '../public/diff.js';
import { makePrompt } from '../public/prompt.js';
import { localeLabel } from '../public/locales.js';

export function formatDiff(parts, color, enabled = stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb') {
  return parts.map((part) => part.changed && enabled ? `\x1b[${color}m${part.text}\x1b[0m` : part.text).join('');
}

async function choose(rl, title, items, label, defaultItem = null, defaultPrompt = 'Нажмите Enter для текущей версии или введите номер: ') {
  if (!items.length) throw new Error(`Нет доступных вариантов: ${title}.`);
  console.log(`\n${title}:`);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${label(item)}`));
  while (true) {
    const value = (await rl.question(defaultItem ? defaultPrompt : 'Введите номер и нажмите Enter: ')).trim();
    if (!value && defaultItem) return defaultItem;
    if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= items.length) return items[Number(value) - 1];
    console.log('Введите номер из списка.');
  }
}

function readTable(rl) {
  console.log('\nВставьте таблицу с названиями языков. Для завершения введите точку на отдельной строке и нажмите Enter:');
  return new Promise((resolve, reject) => {
    const lines = [];
    const cleanup = () => { rl.removeListener('line', onLine); rl.removeListener('close', onClose); };
    const onLine = (line) => { if (line === '.') { cleanup(); resolve(lines.join('\n')); } else lines.push(line); };
    const onClose = () => { cleanup(); reject(new Error('Ввод таблицы прерван.')); };
    rl.on('line', onLine);
    rl.once('close', onClose);
  });
}

export async function runCli(api, rl, lookup = findStoreVersion, readClipboard = readTable) {
  console.log('Получаем список приложений из App Store Connect...');
  const apps = await api.apps();
  const app = await choose(rl, 'Выберите приложение', apps, (a) => `${a.attributes.name} (${a.attributes.bundleId})`);
  console.log('\nПолучаем версии приложения...');
  const versions = await api.versions(app.id);
  const platforms = [...new Set(versions.map((v) => v.attributes.platform))];
  const platform = await choose(rl, 'Выберите платформу', platforms, (p) => p);
  const sourceType = await choose(rl, 'Выберите источник', ['version', 'clipboard'], (type) => type === 'version' ? 'Опубликованная версия' : 'Таблица с переводами', 'version', 'Нажмите Enter для опубликованной версии или введите номер: ');
  let draft;
  let sourceId = null;
  let sourceLabel;
  let plan;
  if (sourceType === 'clipboard') {
    draft = findDraft(versions, platform);
    const target = await api.localizations(draft.id);
    console.log(`\nПромпт для нейросети:\n\n${makePrompt(draftLocales(target))}\n`);
    const text = await readClipboard(rl);
    console.log('\nПолучаем тексты для сравнения...');
    plan = makeClipboardPlan(text, await api.localizations(draft.id));
    sourceLabel = 'вставленная таблица';
  } else {
    const pair = findVersionPair(versions, platform);
    draft = pair.draft;
    const current = await lookup(app.id, platform, pair.live);
    if (!current) console.log('\nНе удалось определить текущую версию через App Store.');
    const live = await choose(
      rl,
      'Выберите опубликованную версию (сначала недавно созданные)',
      pair.live,
      (v) => `${v.attributes.versionString}${v.id === current?.id ? ' — текущая' : ''}${v.attributes.createdDate ? ` — создана ${v.attributes.createdDate.slice(0, 10)}` : ''}`,
      current,
    );
    sourceId = live.id;
    sourceLabel = `опубликованная версия ${live.attributes.versionString}`;
    console.log('\nПолучаем тексты для сравнения...');
    const [source, target] = await Promise.all([api.localizations(live.id), api.localizations(draft.id)]);
    if (!target.length) throw new Error('В черновике нет локализаций.');
    plan = makePlan(source, target);
  }
  console.log(`\nПриложение: ${app.attributes.name} (${platform})`);
  console.log(`Источник: ${sourceLabel}. Получатель: черновик ${draft.attributes.versionString}.`);
  for (const c of plan.changes) {
    const diff = diffText(c.previous, c.text);
    console.log(`\n--- ${localeLabel(c.locale)} ---\nСейчас в черновике:\n${formatDiff(diff.before, 31) || '(пусто)'}\nБудет после сохранения:\n${formatDiff(diff.after, 32)}`);
    if (diff.approximate) console.log('Крупная подсветка из-за длины текста. Сравните тексты вручную.');
  }
  if (plan.unchanged.length) console.log(`\nБез изменений: ${plan.unchanged.map(localeLabel).join(', ')}`);
  if (plan.missing.length) console.log(`Пропущены: нет текста ${sourceType === 'clipboard' ? 'в таблице' : 'в опубликованной версии'}: ${plan.missing.map(localeLabel).join(', ')}`);
  if (plan.sourceOnly.length) console.log(`Пропущены: нет языка в черновике: ${plan.sourceOnly.map(localeLabel).join(', ')}`);
  if (!plan.changes.length) return console.log('\nИзменения не требуются.');
  console.log(`\nИзменится только поле «Что нового» в черновике для ${plan.changes.length} языков.`);
  const answer = (await rl.question('Для сохранения введите y и нажмите Enter. Для отмены просто нажмите Enter: ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') return console.log('Отменено. Данные не сохранены.');
  const conflict = await planConflict(api, { appId: app.id, platform, sourceId, draftId: draft.id, plan });
  if (conflict) throw new Error(conflict);
  console.log('\nСохраняем тексты...');
  const result = await applyPlan(api, plan, (locale, error) => console.log(`${localeLabel(locale)}: ${error ? `ошибка — ${error.message}` : 'сохранено'}`));
  console.log(`\nСохранено: ${result.updated}; ошибок: ${result.failed.length}.`);
  if (result.failed.length) process.exitCode = 1;
}

export async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Запустите команду в интерактивном терминале.');
  const api = new AppStoreApi(await loadConfig());
  const rl = createInterface({ input: stdin, output: stdout });
  try { await runCli(api, rl); } finally { rl.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
  });
}
