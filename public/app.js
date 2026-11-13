import { diffText } from './diff.js';
import { makePrompt } from './prompt.js';
import { localeName, localeLabel } from './locales.js';
import { translate } from './web-i18n.js';
import { translate as translateError } from './i18n.js';

const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="local-token"]').content;
let language = document.querySelector('meta[name="app-language"]')?.content === 'ru' ? 'ru' : 'en';
const languageSelect = $('language-select');
const t = (key, values) => translate(language, key, values);
const labelLocale = (code) => localeLabel(code, language);
let notice = null;
let currentPlan = null;
let savedResult = null;
let promptLocales = null;
let generatedPrompt = '';
let sourcesCache = [];
let currentSourceId = null;
let sourceRequest = 0;
let selectionRevision = 0;
let previewRequest = 0;
let appsLoaded = false;
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
let loadingMessage = null;
let loadingTimer = null;
let focusedBeforeLoading = null;
let planId = null;
let promptContext = null;
let promptRequest = 0;

async function request(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Local-Token': token },
    body: JSON.stringify({ ...body, language }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || t('requestFailed')), { errorKey: result.errorKey, errorParams: result.errorParams });
  return result;
}

function setBusy(value, text) {
  const wasBusy = busy;
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
  if (value && text) {
    loadingMessage = text;
    $('loading-text').textContent = t(text);
    showNotice('');
  }
  if (value && !wasBusy) {
    loadingTimer = setTimeout(() => {
      focusedBeforeLoading = document.activeElement;
      $('topbar').inert = true;
      $('main').inert = true;
      $('loading-overlay').hidden = false;
    }, 250);
  } else if (!value) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
    $('loading-overlay').hidden = true;
    $('topbar').inert = false;
    $('main').inert = false;
    if (focusedBeforeLoading?.isConnected && !focusedBeforeLoading.disabled) focusedBeforeLoading.focus({ preventScroll: true });
    focusedBeforeLoading = null;
    loadingMessage = null;
  }
}

function errorText(error) {
  if (error.errors) return error.errors.map(errorText).join(' ');
  if (error.errorKey) return translateError(language, error.errorKey, error.errorParams);
  const text = error.message || error.error;
  return text ? t('serverError', { error: text }) : t('requestFailed');
}

function showNotice(message, error = false, values = {}) {
  notice = message ? { message, error, values } : null;
  renderNotice();
}

function renderNotice() {
  $('notice').hidden = !notice;
  $('notice').className = notice?.error ? 'notice error' : 'notice';
  $('notice').textContent = !notice ? '' : typeof notice.message === 'string'
    ? t(notice.message, notice.values)
    : notice.message.retry ? t('retryPreview', { error: errorText(notice.message) }) : errorText(notice.message);
}

function fillSources() {
  const selected = sourceSelect.value;
  fillSelect(sourceSelect, t('choosePublished'), sourcesCache, (v) => `${v.version}${v.id === currentSourceId ? t('current') : ''}${v.createdDate ? t('created', { date: v.createdDate.slice(0, 10) }) : ''}`);
  sourceSelect.value = selected;
}

function renderResult() {
  if (!savedResult) return;
  $('result').textContent = savedResult.failed.length
    ? t('partialSave', { count: savedResult.updated, failures: savedResult.failed.map((f) => `${labelLocale(f.locale)} — ${errorText(f)}`).join('; ') })
    : t('saved', { count: savedResult.updated });
}

function renderLanguage() {
  document.documentElement.lang = language;
  languageSelect.value = language;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.getAttribute('data-i18n'));
  for (const element of document.querySelectorAll('[data-i18n-aria]')) element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria')));
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.getAttribute('data-i18n-placeholder'));
  if (appSelect.options[0]) appSelect.options[0].text = t(appsLoaded ? 'chooseApp' : 'loading');
  if (platformSelect.options[0]) platformSelect.options[0].text = t(appSelect.value ? 'choosePlatform' : 'chooseApp');
  fillSources();
  if (!appSelect.value) syncAppPicker();
  if (promptLocales && promptOutput.value === generatedPrompt) {
    generatedPrompt = makePrompt(promptLocales, language);
    promptOutput.value = generatedPrompt;
  }
  if (currentPlan && !$('preview').hidden) renderPlan(currentPlan);
  renderResult();
  renderNotice();
  if (loadingMessage) $('loading-text').textContent = t(loadingMessage);
}

languageSelect.addEventListener('change', async () => {
  const previous = language;
  const next = languageSelect.value;
  if (!['en', 'ru'].includes(next) || next === previous || languageSelect.disabled) {
    languageSelect.value = language;
    return;
  }
  language = next;
  renderLanguage();
  languageSelect.disabled = true;
  try {
    await request('language');
  } catch {
    language = previous;
    renderLanguage();
    showNotice('preferenceFailed', true);
  } finally {
    languageSelect.disabled = false;
  }
});

function resetPreview() {
  previewRequest += 1;
  planId = null;
  currentPlan = null;
  savedResult = null;
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
  $('app-picker-value').replaceChildren(...(app ? [appCopy(app)] : [document.createTextNode(t(appsLoaded ? 'chooseApp' : 'loading'))]));
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
  if (!parts.length) text.textContent = t('empty');
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
  $('source-version').textContent = plan.sourceType === 'clipboard' ? t('clipboardSource') : plan.source;
  $('draft-version').textContent = plan.draft;
  $('change-count').textContent = String(plan.changes.length);
  $('list-count').textContent = t('changes', { count: plan.changes.length });
  $('comparison-table').hidden = !plan.changes.length;
  const approximate = [];
  $('changes').replaceChildren(...plan.changes.map((change) => {
    const row = document.createElement('tr');
    const title = document.createElement('th');
    title.scope = 'row';
    title.textContent = localeName(change.locale, language);
    const diff = diffText(change.previous, change.text);
    if (diff.approximate) approximate.push(change.locale);
    row.append(title, textCell(diff.before, 'del', change.locale), textCell(diff.after, 'ins', change.locale));
    return row;
  }));
  const messages = [];
  if (approximate.length) messages.push(t('approximate', { locales: approximate.map(labelLocale).join(', ') }));
  if (plan.unchanged.length) messages.push(t('unchanged', { locales: plan.unchanged.map(labelLocale).join(', ') }));
  if (plan.missing.length) messages.push(t(plan.sourceType === 'clipboard' ? 'missingTable' : 'missingVersion', { locales: plan.missing.map(labelLocale).join(', ') }));
  if (plan.sourceOnly.length) messages.push(t('sourceOnly', { locales: plan.sourceOnly.map(labelLocale).join(', ') }));
  $('skipped').textContent = messages.join('\n');
  $('skipped').hidden = !messages.length;
  $('preview').hidden = false;
}

async function loadApps() {
  setBusy(true, 'loadingApps');
  try {
    ({ apps } = await request('apps'));
    appsLoaded = true;
    fillSelect(appSelect, t('chooseApp'), apps, (a) => `${a.name} (${a.bundleId})`);
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
    showNotice(apps.length ? '' : 'noApps', !apps.length);
  } catch (error) {
    showNotice(error, true);
  } finally {
    setBusy(false);
  }
}

async function loadSources() {
  const requestId = ++sourceRequest;
  const context = `${appSelect.value}:${platformSelect.value}:${sourceType.value}`;
  $('source-field').hidden = true;
  sourcesCache = [];
  currentSourceId = null;
  fillSources();
  const { sources, sourceId } = await request('sources', { appId: appSelect.value, platform: platformSelect.value });
  if (requestId !== sourceRequest || context !== `${appSelect.value}:${platformSelect.value}:${sourceType.value}`) return;
  sourcesCache = sources;
  currentSourceId = sourceId;
  fillSources();
  sourceSelect.value = sourceId || '';
  $('source-field').hidden = false;
  showNotice(sourceId ? '' : 'unknownCurrent');
}

function resetPrompt() {
  promptRequest += 1;
  promptContext = null;
  promptLocales = null;
  generatedPrompt = '';
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
  generatedPrompt = makePrompt(locales, language);
  promptLocales = locales;
  promptOutput.value = generatedPrompt;
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
  if (errors.length) throw { errors: errors.map((result) => result.reason) };
}

appSelect.addEventListener('change', async () => {
  const revision = ++selectionRevision;
  sourceRequest += 1;
  syncAppPicker();
  resetPreview();
  resetPrompt();
  $('source-field').hidden = true;
  $('clipboard-field').hidden = true;
  $('source-type-field').hidden = true;
  fillSelect(platformSelect, t('choosePlatform'), [], (p) => p.id);
  if (!appSelect.value) { showNotice(''); setBusy(false); return; }
  setBusy(true, 'loadingPlatforms');
  try {
    const { platforms } = await request('versions', { appId: appSelect.value });
    if (revision !== selectionRevision) return;
    fillSelect(platformSelect, t('choosePlatform'), platforms.map((id) => ({ id })), (p) => ({ IOS: 'iOS', MAC_OS: 'macOS', TV_OS: 'tvOS', VISION_OS: 'visionOS' }[p.id] || p.id));
    if (platforms.length === 1) {
      platformSelect.value = platforms[0];
      setBusy(true, 'loadingSource');
      await activateSource();
    } else {
      showNotice(platforms.length ? '' : 'noVersions', !platforms.length);
    }
  } catch (error) {
    if (revision === selectionRevision) showNotice(error, true);
  } finally {
    if (revision === selectionRevision) setBusy(false);
  }
});

platformSelect.addEventListener('change', async () => {
  const revision = ++selectionRevision;
  sourceRequest += 1;
  resetPreview();
  resetPrompt();
  $('source-field').hidden = true;
  $('clipboard-field').hidden = true;
  $('source-type-field').hidden = true;
  if (!platformSelect.value) { showNotice(''); setBusy(false); return; }
  setBusy(true, 'loadingSource');
  try {
    await activateSource();
  } catch (error) {
    if (revision === selectionRevision) showNotice(error, true);
  } finally {
    if (revision === selectionRevision) setBusy(false);
  }
});
sourceType.addEventListener('change', async () => {
  const revision = ++selectionRevision;
  sourceRequest += 1;
  resetPreview();
  setBusy(true, 'loadingSource');
  try { await activateSource(); } catch (error) { if (revision === selectionRevision) showNotice(error, true); } finally { if (revision === selectionRevision) setBusy(false); }
});
sourceSelect.addEventListener('change', () => { resetPreview(); showNotice(''); setBusy(false); });
clipboardInput.addEventListener('input', () => { resetPreview(); showNotice(''); setBusy(false); });
promptOutput.addEventListener('input', () => setBusy(busy));
copyPrompt.addEventListener('click', async () => {
  if (copyPrompt.disabled) return;
  try {
    await navigator.clipboard.writeText(promptOutput.value);
    showNotice('copied');
  } catch {
    $('prompt-details').open = true;
    promptOutput.focus();
    promptOutput.select();
    showNotice('copyManually');
  }
});

previewButton.addEventListener('click', async () => {
  resetPreview();
  const requestId = previewRequest;
  setBusy(true, 'loadingPreview');
  try {
    const source = sourceType.value === 'clipboard' ? { sourceType: 'clipboard', clipboard: clipboardInput.value } : { sourceId: sourceSelect.value };
    const data = await request('preview', { appId: appSelect.value, platform: platformSelect.value, ...source });
    if (requestId !== previewRequest) return;
    showNotice('');
    if (data.sources) {
      sourcesCache = data.sources;
      currentSourceId = null;
      fillSources();
      $('source-field').hidden = false;
      showNotice('chooseSource');
    } else {
      currentPlan = data;
      planId = data.changes.length ? data.planId : null;
      renderPlan(data);
      if (!data.changes.length) showNotice('noChanges');
    }
  } catch (error) {
    if (requestId === previewRequest) showNotice(error, true);
  } finally {
    if (requestId === previewRequest) setBusy(false);
  }
});

applyButton.addEventListener('click', () => { if (planId) $('confirm-dialog').showModal(); });
$('cancel-save').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-save').addEventListener('click', async () => {
  $('confirm-dialog').close();
  if (!planId) return;
  setBusy(true, 'saving');
  try {
    const result = await request('apply', { planId });
    planId = null;
    $('preview').hidden = true;
    $('result').hidden = false;
    $('result').className = result.failed.length ? 'result error' : 'result';
    currentPlan = null;
    savedResult = result;
    renderResult();
    showNotice('');
  } catch (error) {
    planId = null;
    showNotice(Object.assign(error, { retry: true }), true);
  } finally {
    setBusy(false);
  }
});

renderLanguage();
loadApps();
