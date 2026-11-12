import { diffText } from './diff.js';
import { makePrompt } from './prompt.js';
import { localeName, localeLabel } from './locales.js';

const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="local-token"]').content;
const appSelect = $('app-select');
const appPicker = $('app-picker');
const appList = $('app-list');
let apps = [];
let activeApp = -1;
const platformSelect = $('platform-select');
const sourceType = $('source-type');
const sourceSelect = $('source-select');
const clipboardInput = $('clipboard-input');
const promptOutput = $('prompt-output');
const copyPrompt = $('copy-prompt');
const previewButton = $('preview-button');
const applyButton = $('apply-button');
let busy = false;
let planId = null;
let promptContext = null;
let promptRequest = 0;

async function request(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Token': token },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.');
  return result;
}

function setBusy(value, text) {
  busy = value;
  appSelect.disabled = value || appSelect.options.length <= 1;
  appPicker.disabled = appSelect.disabled;
  if (appPicker.disabled) closeAppList();
  platformSelect.disabled = value || !appSelect.value || platformSelect.options.length <= 1;
  sourceType.disabled = value || !platformSelect.value;
  sourceSelect.disabled = value || $('source-field').hidden;
  clipboardInput.disabled = value;
  promptOutput.disabled = value;
  copyPrompt.disabled = value || !promptContext || !promptOutput.value.trim();
  const sourceReady = sourceType.value === 'clipboard' ? !$('clipboard-field').hidden && clipboardInput.value.trim() : !$('source-field').hidden && sourceSelect.value;
  previewButton.disabled = value || !appSelect.value || !platformSelect.value || !sourceReady;
  applyButton.disabled = value || !planId;
  if (text) showNotice(text);
}

function showNotice(text, error = false) {
  $('notice').hidden = !text;
  $('notice').className = error ? 'notice error' : 'notice';
  $('notice').textContent = text || '';
}

function resetPreview() {
  planId = null;
  $('preview').hidden = true;
  $('result').hidden = true;
  $('changes').replaceChildren();
}

function fillSelect(element, placeholder, values, label) {
  element.replaceChildren(new Option(placeholder, ''), ...values.map((value) => new Option(label(value), value.id)));
}

function appIcon(app) {
  const icon = document.createElement('span');
  icon.className = 'app-icon';
  icon.setAttribute('aria-hidden', 'true');
  const placeholder = document.createElement('span');
  placeholder.textContent = app.name.slice(0, 1).toLocaleUpperCase() || '?';
  icon.append(placeholder);
  if (app.iconUrl) {
    const image = document.createElement('img');
    image.alt = '';
    image.addEventListener('error', () => { image.hidden = true; });
    image.src = app.iconUrl;
    icon.append(image);
  }
  return icon;
}

function appCopy(app) {
  const copy = document.createElement('span');
  copy.className = 'app-copy';
  const name = document.createElement('span');
  name.className = 'app-name';
  name.textContent = app.name;
  const bundle = document.createElement('span');
  bundle.className = 'app-bundle';
  bundle.textContent = app.bundleId;
  copy.append(name, bundle);
  return copy;
}

function syncAppPicker() {
  const app = apps.find((app) => app.id === appSelect.value);
  $('app-picker-icon').replaceChildren(...(app ? [appIcon(app)] : []));
  $('app-picker-value').replaceChildren(...(app ? [appCopy(app)] : [document.createTextNode('Выберите приложение')]));
  for (let i = 0; i < apps.length; i += 1) {
    appList.children[i].setAttribute('aria-selected', String(apps[i].id === appSelect.value));
  }
}

function closeAppList() {
  appList.hidden = true;
  appPicker.setAttribute('aria-expanded', 'false');
  appPicker.removeAttribute('aria-activedescendant');
}

function highlightApp(index) {
  activeApp = Math.max(0, Math.min(apps.length - 1, index));
  for (let i = 0; i < apps.length; i += 1) {
    appList.children[i].className = i === activeApp ? 'app-option active' : 'app-option';
  }
  const option = appList.children[activeApp];
  appPicker.setAttribute('aria-activedescendant', option.id);
  option.scrollIntoView({ block: 'nearest' });
}

function openAppList(last = false) {
  if (appPicker.disabled) return;
  appList.hidden = false;
  appPicker.setAttribute('aria-expanded', 'true');
  const selected = apps.findIndex((app) => app.id === appSelect.value);
  highlightApp(selected < 0 ? (last ? apps.length - 1 : 0) : selected);
}

function chooseApp(index) {
  const app = apps[index];
  closeAppList();
  appPicker.focus();
  if (app.id === appSelect.value) return;
  appSelect.value = app.id;
  appSelect.dispatchEvent(new Event('change', { bubbles: true }));
}

appPicker.addEventListener('click', () => {
  if (appList.hidden) openAppList();
  else closeAppList();
});
appPicker.addEventListener('keydown', (event) => {
  if (appPicker.disabled) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (appList.hidden) openAppList(event.key === 'ArrowUp');
    else highlightApp(activeApp + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (!appList.hidden && (event.key === 'Home' || event.key === 'End')) {
    event.preventDefault();
    highlightApp(event.key === 'Home' ? 0 : apps.length - 1);
  } else if (!appList.hidden && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    chooseApp(activeApp);
  } else if (event.key === 'Escape') {
    if (!appList.hidden) event.preventDefault();
    closeAppList();
  } else if (event.key === 'Tab') {
    closeAppList();
  }
});
document.addEventListener('click', (event) => {
  if (!$('app-picker-field').contains(event.target)) closeAppList();
});

function textCell(parts, tag, locale) {
  const cell = document.createElement('td');
  const text = document.createElement('p');
  text.dir = 'auto';
  text.lang = locale;
  if (!parts.length) text.textContent = '(пусто)';
  for (const part of parts) {
    if (!part.changed) text.append(document.createTextNode(part.text));
    else {
      const highlight = document.createElement(tag);
      highlight.textContent = part.text;
      text.append(highlight);
    }
  }
  cell.append(text);
  return cell;
}

function renderPlan(plan) {
  planId = plan.changes.length ? plan.planId : null;
  $('source-version').textContent = plan.source;
  $('draft-version').textContent = plan.draft;
  $('change-count').textContent = String(plan.changes.length);
  $('list-count').textContent = `Изменений: ${plan.changes.length}`;
  $('comparison-table').hidden = !plan.changes.length;
  const approximate = [];
  $('changes').replaceChildren(...plan.changes.map((change) => {
    const row = document.createElement('tr');
    const title = document.createElement('th');
    title.scope = 'row';
    title.textContent = localeName(change.locale);
    const diff = diffText(change.previous, change.text);
    if (diff.approximate) approximate.push(change.locale);
    row.append(title, textCell(diff.before, 'del', change.locale), textCell(diff.after, 'ins', change.locale));
    return row;
  }));
  const messages = [];
  if (approximate.length) messages.push(`Крупная подсветка из-за длины текста: ${approximate.map(localeLabel).join(', ')}. Сравните тексты вручную.`);
  if (plan.unchanged.length) messages.push(`Без изменений: ${plan.unchanged.map(localeLabel).join(', ')}.`);
  if (plan.missing.length) messages.push(`Нет текста ${plan.sourceType === 'clipboard' ? 'в таблице' : 'в опубликованной версии'}: ${plan.missing.map(localeLabel).join(', ')}.`);
  if (plan.sourceOnly.length) messages.push(`Нет языка в черновике: ${plan.sourceOnly.map(localeLabel).join(', ')}.`);
  $('skipped').textContent = messages.join('\n');
  $('skipped').hidden = !messages.length;
  $('preview').hidden = false;
  if (!plan.changes.length) showNotice('Изменения не требуются.');
}

async function loadApps() {
  setBusy(true, 'Получаем приложения из App Store Connect…');
  try {
    ({ apps } = await request('apps'));
    fillSelect(appSelect, 'Выберите приложение', apps, (a) => `${a.name} (${a.bundleId})`);
    appList.replaceChildren(...apps.map((app, index) => {
      const option = document.createElement('div');
      option.id = `app-option-${index}`;
      option.className = 'app-option';
      option.setAttribute('role', 'option');
      option.append(appIcon(app), appCopy(app));
      option.addEventListener('click', () => chooseApp(index));
      return option;
    }));
    syncAppPicker();
    showNotice(apps.length ? '' : 'Приложения не найдены. Проверьте доступ к App Store Connect.', !apps.length);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadSources() {
  $('source-field').hidden = true;
  fillSelect(sourceSelect, 'Выберите опубликованную версию', [], (v) => v.version);
  const { sources, sourceId } = await request('sources', { appId: appSelect.value, platform: platformSelect.value });
  fillSelect(sourceSelect, 'Выберите опубликованную версию', sources, (v) => `${v.version}${v.id === sourceId ? ' — текущая' : ''}${v.createdDate ? ` — создана ${v.createdDate.slice(0, 10)}` : ''}`);
  sourceSelect.value = sourceId || '';
  $('source-field').hidden = false;
  showNotice(sourceId ? '' : 'Не удалось определить текущую версию. Выберите её из списка.');
}

function resetPrompt() {
  promptRequest += 1;
  promptContext = null;
  promptOutput.value = '';
  $('prompt-field').hidden = true;
  $('prompt-details').open = false;
  copyPrompt.disabled = true;
}

async function loadPrompt() {
  const context = `${appSelect.value}:${platformSelect.value}`;
  if (promptContext === context) return;
  const requestId = ++promptRequest;
  const { locales } = await request('locales', { appId: appSelect.value, platform: platformSelect.value });
  if (requestId !== promptRequest || context !== `${appSelect.value}:${platformSelect.value}`) return;
  promptOutput.value = makePrompt(locales);
  promptContext = context;
}

async function activateSource() {
  $('source-field').hidden = true;
  $('clipboard-field').hidden = true;
  $('source-type-field').hidden = !platformSelect.value;
  $('prompt-field').hidden = !platformSelect.value;
  if (!platformSelect.value) { showNotice(''); return; }
  const clipboard = sourceType.value === 'clipboard';
  $('clipboard-field').hidden = !clipboard;
  if (clipboard) showNotice('');
  const results = await Promise.allSettled([loadPrompt(), ...(clipboard ? [] : [loadSources()])]);
  const errors = results.filter((result) => result.status === 'rejected');
  if (errors.length) throw new Error(errors.map((result) => result.reason.message).join(' '));
}

appSelect.addEventListener('change', async () => {
  syncAppPicker();
  resetPreview();
  resetPrompt();
  $('source-field').hidden = true;
  $('clipboard-field').hidden = true;
  $('source-type-field').hidden = true;
  fillSelect(platformSelect, 'Выберите платформу', [], (p) => p.id);
  if (!appSelect.value) { showNotice(''); setBusy(false); return; }
  setBusy(true, 'Получаем доступные платформы…');
  try {
    const { platforms } = await request('versions', { appId: appSelect.value });
    fillSelect(platformSelect, 'Выберите платформу', platforms.map((id) => ({ id })), (p) => ({ IOS: 'iOS', MAC_OS: 'macOS', TV_OS: 'tvOS', VISION_OS: 'visionOS' }[p.id] || p.id));
    if (platforms.length === 1) {
      platformSelect.value = platforms[0];
      await activateSource();
    } else {
      showNotice(platforms.length ? '' : 'Для приложения нет версий.', !platforms.length);
    }
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    setBusy(false);
  }
});

platformSelect.addEventListener('change', async () => {
  resetPreview();
  resetPrompt();
  $('source-field').hidden = true;
  $('clipboard-field').hidden = true;
  $('source-type-field').hidden = true;
  if (!platformSelect.value) { showNotice(''); setBusy(false); return; }
  setBusy(true, 'Подготавливаем источник…');
  try {
    await activateSource();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    setBusy(false);
  }
});
sourceType.addEventListener('change', async () => {
  resetPreview();
  setBusy(true);
  try { await activateSource(); } catch (error) { showNotice(error.message, true); } finally { setBusy(false); }
});
sourceSelect.addEventListener('change', () => { resetPreview(); showNotice(''); setBusy(false); });
clipboardInput.addEventListener('input', () => { resetPreview(); showNotice(''); setBusy(false); });
promptOutput.addEventListener('input', () => setBusy(busy));
copyPrompt.addEventListener('click', async () => {
  if (copyPrompt.disabled) return;
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    showNotice('Промпт скопирован.');
  } catch {
    $('prompt-details').open = true;
    promptOutput.focus();
    promptOutput.select();
    showNotice('Скопируйте выделенный промпт вручную.');
  }
});

previewButton.addEventListener('click', async () => {
  resetPreview();
  setBusy(true, 'Получаем версии и тексты…');
  try {
    const source = sourceType.value === 'clipboard' ? { sourceType: 'clipboard', clipboard: clipboardInput.value } : { sourceId: sourceSelect.value };
    const data = await request('preview', { appId: appSelect.value, platform: platformSelect.value, ...source });
    showNotice('');
    if (data.sources) {
      fillSelect(sourceSelect, 'Выберите опубликованную версию', data.sources, (v) => `${v.version}${v.createdDate ? ` — создана ${v.createdDate.slice(0, 10)}` : ''}`);
      $('source-field').hidden = false;
      showNotice('Не удалось определить опубликованную версию автоматически. Выберите её из списка.');
    } else {
      renderPlan(data);
    }
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    setBusy(false);
  }
});

applyButton.addEventListener('click', () => { if (planId) $('confirm-dialog').showModal(); });
$('cancel-save').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-save').addEventListener('click', async () => {
  $('confirm-dialog').close();
  if (!planId) return;
  setBusy(true, 'Сохраняем тексты в App Store Connect…');
  try {
    const result = await request('apply', { planId });
    planId = null;
    $('preview').hidden = true;
    $('result').hidden = false;
    $('result').className = result.failed.length ? 'result error' : 'result';
    $('result').textContent = result.failed.length
      ? `Сохранено: ${result.updated}. Не удалось сохранить: ${result.failed.map((f) => `${localeLabel(f.locale)} — ${f.error}`).join('; ')}. Подготовьте сравнение заново.`
      : `Готово. Сохранено языков: ${result.updated}.`;
    showNotice('');
  } catch (error) {
    planId = null;
    showNotice(`${error.message} Подготовьте сравнение заново.`, true);
  } finally {
    setBusy(false);
  }
});

loadApps();
