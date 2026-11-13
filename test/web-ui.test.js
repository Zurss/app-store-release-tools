import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { diffText } from '../public/diff.js';
import { makePrompt } from '../public/prompt.js';
import { localeName, localeLabel } from '../public/locales.js';
import { translate } from '../public/web-i18n.js';
import { translate as translateError } from '../public/i18n.js';

class Element {
  constructor(tag = '') { this.tag = tag; this.options = []; this.children = []; this.value = ''; this.hidden = false; this.listeners = {}; this.attributes = {}; this._text = ''; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  replaceChildren(...children) { this.children = children; this.options = children; this.value = children[0]?.value ?? ''; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  dispatchEvent(event) { return this.listeners[event.type]?.(event); }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() {}
  focus() { this.focused = true; }
  select() { this.selected = true; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
}

async function page(sourceId, changes = [], { copyFails = false, respond = () => undefined, apps = [{ id: '123', name: 'Игра', bundleId: 'example' }], selectApp = true, language = 'ru', timers = { setTimeout, clearTimeout } } = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  for (const id of ['source-field', 'clipboard-field', 'prompt-field', 'source-type-field']) get(id).hidden = true;
  get('app-list').hidden = true;
  get('loading-overlay').hidden = true;
  get('prompt-details').open = false;
  get('source-type').value = 'version';
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const translatedElements = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    if (!match[2].includes('data-i18n')) continue;
    const id = match[2].match(/\bid="([^"]*)"/)?.[1];
    const element = id ? get(id) : new Element(match[1]);
    for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attribute[1], attribute[2]);
    translatedElements.push(element);
  }
  const requests = [];
  const fetch = async (path, options) => {
    const body = JSON.parse(options.body);
    requests.push({ path, body });
    const override = await respond(path, body);
    if (override) return override;
    const response = {
      '/api/language': { language: body.language },
      '/api/apps': { apps },
      '/api/versions': { platforms: ['IOS'] },
      '/api/sources': { sourceId, sources: [{ id: 'live', version: '1.0' }, { id: 'older', version: '0.9' }] },
      '/api/locales': { locales: ['en-US', 'ru'] },
      '/api/preview': { planId: 'plan', source: body.sourceType === 'clipboard' ? 'Вставленная таблица' : body.sourceId === 'older' ? '0.9' : '1.0', sourceType: body.sourceType, draft: '1.1', changes, missing: [], unchanged: [], sourceOnly: [] },
    }[path];
    return { ok: true, json: async () => response };
  };
  const document = { documentElement: new Element('html'), addEventListener() {}, getElementById: get, querySelector: (selector) => ({ content: selector.includes('app-language') ? language : 'token' }), querySelectorAll: (selector) => translatedElements.filter((element) => element.getAttribute(selector.slice(1, -1))), createElement: (tag) => new Element(tag), createTextNode: (text) => { const node = new Element('#text'); node.textContent = text; return node; } };
  const Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  const script = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace("import { diffText } from './diff.js';", '').replace("import { makePrompt } from './prompt.js';", '').replace("import { localeName, localeLabel } from './locales.js';", '').replace("import { translate } from './web-i18n.js';", '').replace("import { translate as translateError } from './i18n.js';", '');
  const navigator = { clipboard: { writeText: async (text) => { if (copyFails) throw new Error('Clipboard unavailable'); get('copied-prompt').value = text; } } };
  runInNewContext(script, { document, fetch, Option, diffText, makePrompt, localeName, localeLabel, translate, translateError, navigator, Event, ...timers });
  await new Promise((resolve) => setImmediate(resolve));
  if (selectApp) {
    get('app-select').value = '123';
    await get('app-select').listeners.change();
  }
  return { get, requests, document, translatedElements };
}

test('веб-страница выбирает текущую версию и сравнивает выбранную вручную', async () => {
  const { get, requests } = await page('live');
  assert.equal(get('source-field').hidden, false);
  assert.equal(get('source-select').value, 'live');
  assert.equal(get('preview-button').disabled, false);
  get('source-select').value = 'older';
  get('source-select').listeners.change();
  await get('preview-button').listeners.click();
  assert.equal(requests.at(-1).body.sourceId, 'older');
  assert.equal(get('source-version').textContent, '0.9');
  assert.equal(requests.some((request) => request.path === '/api/apply'), false);
});

test('при отказе доступа к буферу промпт можно скопировать вручную', async () => {
  const { get } = await page('live', [], { copyFails: true });
  get('source-type').value = 'clipboard';
  await get('source-type').listeners.change();
  await get('copy-prompt').listeners.click();
  assert.equal(get('prompt-details').open, true);
  assert.equal(get('prompt-output').focused, true);
  assert.equal(get('prompt-output').selected, true);
  assert.match(get('notice').textContent, /вручную/);
});

test('веб-страница отправляет вставленную таблицу на сравнение', async () => {
  const { get, requests } = await page('live');
  get('source-type').value = 'clipboard';
  await get('source-type').listeners.change();
  assert.equal(get('clipboard-field').hidden, false);
  assert.match(get('prompt-output').value, /английский \(США\), русский/);
  assert.doesNotMatch(get('prompt-output').value, /en-US|\[ru\]/);
  await get('copy-prompt').listeners.click();
  assert.equal(get('copied-prompt').value, get('prompt-output').value);
  assert.equal(get('preview-button').disabled, true);
  get('clipboard-input').value = 'Язык | Текст\nru | Перевод';
  get('clipboard-input').listeners.input();
  assert.equal(get('preview-button').disabled, false);
  await get('preview-button').listeners.click();
  assert.equal(requests.at(-1).body.sourceType, 'clipboard');
  assert.equal(requests.at(-1).body.clipboard, 'Язык | Текст\nru | Перевод');
  assert.equal(get('source-version').textContent, 'Вставленная таблица');
  assert.equal(requests.some((request) => request.path === '/api/apply'), false);
});

test('веб-страница выделяет изменённые фрагменты и сохраняет текст', async () => {
  const { get } = await page('live', [{ locale: 'en-GB', previous: 'Train maths skills!', text: 'Train math skills!' }]);
  await get('preview-button').listeners.click();
  const row = get('changes').children[0];
  const before = row.children[1].children[0];
  const after = row.children[2].children[0];
  assert.equal(row.children[0].textContent, 'английский (Великобритания)');
  assert.equal(row.children[0].children.length, 0);
  assert.equal(before.textContent, 'Train maths skills!');
  assert.equal(after.textContent, 'Train math skills!');
  assert.equal(before.children.find((node) => node.tag === 'del').textContent, 'maths');
  assert.equal(after.children.find((node) => node.tag === 'ins').textContent, 'math');
});

test('сообщает, если подсветка длинного текста упрощена', async () => {
  const { get } = await page('live', [{ locale: 'ru', previous: 'а'.repeat(25_000), text: 'б'.repeat(25_000) }]);
  await get('preview-button').listeners.click();
  assert.match(get('skipped').textContent, /Крупная подсветка.*русский/);
  assert.doesNotMatch(get('skipped').textContent, /\[ru\]/);
});

test('веб-страница просит выбрать источник, если текущая версия не определена', async () => {
  const { get } = await page(null);
  assert.equal(get('source-select').value, '');
  assert.equal(get('preview-button').disabled, true);
  assert.match(get('notice').textContent, /Выберите/);
  get('source-select').value = 'live';
  get('source-select').listeners.change();
  assert.equal(get('preview-button').disabled, false);
});

for (const sourceType of ['version', 'clipboard']) {
  test(`промпт доступен без раскрытия текста: ${sourceType}`, async () => {
    const { get, requests } = await page('live');
    if (sourceType === 'clipboard') {
      get('source-type').value = sourceType;
      await get('source-type').listeners.change();
    }
    assert.equal(get('prompt-field').hidden, false);
    assert.equal(get('prompt-details').open, false);
    assert.equal(get('copy-prompt').disabled, false);
    assert.deepEqual(requests.filter(({ path }) => path === '/api/locales'), [
      { path: '/api/locales', body: { appId: '123', platform: 'IOS', language: 'ru' } },
    ]);
    await get('copy-prompt').listeners.click();
    assert.equal(get('copied-prompt').value, get('prompt-output').value);
    assert.match(get('notice').textContent, /Промпт скопирован/);
  });
}

test('кнопка копирования находится вне закрытого details и источника таблицы', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const prompt = html.slice(html.indexOf('id="prompt-field"'), html.indexOf('id="clipboard-field"'));
  assert.match(prompt, /id="copy-prompt"/);
  assert.ok(prompt.indexOf('id="copy-prompt"') < prompt.indexOf('<details'));
  assert.doesNotMatch(html, /\[en-US\]|\[ru\]|Названия с кодами/);
});

test('редактирование промпта сохраняется при смене источника', async () => {
  const { get } = await page('live');
  get('prompt-output').value = 'Мой промпт';
  get('source-type').value = 'clipboard';
  await get('source-type').listeners.change();
  await get('copy-prompt').listeners.click();
  assert.equal(get('copied-prompt').value, 'Мой промпт');
  get('prompt-output').value = '   ';
  get('prompt-output').listeners.input();
  assert.equal(get('copy-prompt').disabled, true);
});

test('ошибка локалей отключает копирование, но не сравнение опубликованной версии', async () => {
  const { get } = await page('live', [], { respond: (path) => path === '/api/locales'
    ? { ok: false, json: async () => ({ error: 'Локали недоступны' }) } : undefined });
  assert.equal(get('prompt-field').hidden, false);
  assert.equal(get('prompt-output').value, '');
  assert.equal(get('copy-prompt').disabled, true);
  assert.equal(get('preview-button').disabled, false);
  assert.match(get('notice').textContent, /Локали недоступны/);
  assert.equal(get('notice').className, 'notice error');
  await get('copy-prompt').listeners.click();
  assert.equal(get('copied-prompt').value, '');
});

test('смена приложения очищает промпт до загрузки и игнорирует устаревший ответ', async () => {
  let resolveOld;
  let block = false;
  const { get } = await page('live', [], { respond: (path, body) => {
    if (path !== '/api/locales' || !block) return undefined;
    if (body.appId === '456') return new Promise((resolve) => { resolveOld = resolve; });
    return { ok: true, json: async () => ({ locales: ['ja'] }) };
  } });
  block = true;
  get('app-select').value = '456';
  const oldLoad = get('app-select').listeners.change();
  assert.equal(get('prompt-output').value, '');
  assert.equal(get('copy-prompt').disabled, true);
  await new Promise((resolve) => setImmediate(resolve));
  get('app-select').value = '789';
  await get('app-select').listeners.change();
  assert.match(get('prompt-output').value, /японский/);
  resolveOld({ ok: true, json: async () => ({ locales: ['ru'] }) });
  await oldLoad;
  assert.match(get('prompt-output').value, /японский/);
  assert.doesNotMatch(get('prompt-output').value, /русский/);
  await get('copy-prompt').listeners.click();
  assert.match(get('copied-prompt').value, /японский/);
});

test('сброс платформы скрывает и очищает промпт', async () => {
  const { get } = await page('live');
  get('platform-select').value = '';
  await get('platform-select').listeners.change();
  assert.equal(get('prompt-field').hidden, true);
  assert.equal(get('prompt-output').value, '');
  assert.equal(get('copy-prompt').disabled, true);
});

test('смена платформы загружает языки её черновика', async () => {
  let resolveLocales;
  const { get, requests } = await page('live', [], { respond: (path, body) => path === '/api/locales' && body.platform === 'MAC_OS'
    ? new Promise((resolve) => { resolveLocales = resolve; }) : undefined });
  get('platform-select').value = 'MAC_OS';
  const loading = get('platform-select').listeners.change();
  assert.equal(get('prompt-output').value, '');
  assert.equal(get('copy-prompt').disabled, true);
  await new Promise((resolve) => setImmediate(resolve));
  resolveLocales({ ok: true, json: async () => ({ locales: ['fr-CA'] }) });
  await loading;
  assert.deepEqual(requests.filter(({ path }) => path === '/api/locales').at(-1).body, { appId: '123', platform: 'MAC_OS', language: 'ru' });
  assert.match(get('prompt-output').value, /французский \(Канада\)/);
  assert.doesNotMatch(get('prompt-output').value, /английский|русский/);
  assert.equal(get('copy-prompt').disabled, false);
});

test('информационные списки показывают названия языков без кодов', async () => {
  const { get } = await page('live', [], { respond: (path) => path === '/api/preview' ? { ok: true, json: async () => ({
    planId: 'plan', source: '1.0', draft: '1.1', changes: [],
    unchanged: ['en-US'], missing: ['fr-CA'], sourceOnly: ['ru'],
  }) } : undefined });
  await get('preview-button').listeners.click();
  assert.equal(get('skipped').textContent, 'Без изменений: английский (США).\nНет текста в опубликованной версии: французский (Канада).\nНет языка в черновике: русский.');
});

const pickerApps = [
  { id: '123', name: 'Игра', bundleId: 'example.game', iconUrl: '/api/app-icon/123' },
  { id: '456', name: 'Редактор', bundleId: 'example.editor', iconUrl: null },
];

function key(element, key) {
  const event = { key, preventDefault() { this.prevented = true; } };
  element.listeners.keydown(event);
  return event;
}

test('выбор приложения показывает иконку и заглушку при отсутствии или ошибке загрузки', async () => {
  const { get } = await page('live', [], { apps: pickerApps });
  const options = get('app-list').children;
  const icon = options[0].children[0];
  const image = icon.children[1];
  assert.equal(image.src, '/api/app-icon/123');
  assert.equal(image.alt, '');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(options[1].children[0].children.length, 1);
  assert.equal(options[1].children[0].textContent, 'Р');
  image.listeners.error();
  assert.equal(image.hidden, true);
  assert.equal(icon.children[0].textContent, 'И');
  assert.equal(get('app-picker-value').textContent, 'Играexample.game');
  get('app-picker-icon').children[0].children[1].listeners.error();
  assert.equal(get('app-picker-icon').children[0].children[1].hidden, true);
});

test('список приложений поддерживает стрелки, Enter, Escape и Tab', async () => {
  const { get, requests } = await page('live', [], { apps: pickerApps });
  const picker = get('app-picker');
  assert.equal(key(picker, 'ArrowDown').prevented, true);
  assert.equal(picker.getAttribute('aria-expanded'), 'true');
  assert.equal(picker.getAttribute('aria-activedescendant'), 'app-option-0');
  key(picker, 'ArrowDown');
  assert.equal(picker.getAttribute('aria-activedescendant'), 'app-option-1');
  key(picker, 'Escape');
  assert.equal(get('app-list').hidden, true);
  assert.equal(get('app-select').value, '123');
  key(picker, 'ArrowDown');
  key(picker, 'End');
  key(picker, 'Home');
  assert.equal(picker.getAttribute('aria-activedescendant'), 'app-option-0');
  key(picker, 'ArrowDown');
  key(picker, 'Enter');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get('app-select').value, '456');
  assert.equal(get('app-picker-value').textContent, 'Редакторexample.editor');
  assert.equal(get('app-list').hidden, true);
  assert.equal(get('app-list').children[1].getAttribute('aria-selected'), 'true');
  assert.ok(requests.some(({ path, body }) => path === '/api/versions' && body.appId === '456'));
  key(picker, 'ArrowUp');
  assert.equal(key(picker, 'Tab').prevented, undefined);
  assert.equal(get('app-list').hidden, true);
  assert.equal(picker.getAttribute('aria-activedescendant'), null);
});

test('клик выбирает приложение, а пустой список и загрузка блокируют компонент', async () => {
  const { get } = await page('live', [], { apps: pickerApps, selectApp: false });
  get('app-picker').listeners.click();
  get('app-list').children[1].listeners.click();
  assert.equal(get('app-select').value, '456');
  assert.equal(get('app-picker').disabled, true);
  assert.equal(get('app-list').hidden, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get('app-picker').disabled, false);
  const empty = await page('live', [], { apps: [], selectApp: false });
  assert.equal(empty.get('app-picker').disabled, true);
});

async function switchLanguage(get, language) {
  get('language-select').value = language;
  await get('language-select').listeners.change();
}

test('интерфейс использует EN по умолчанию и переводит подписи, aria и подсказки', async () => {
  const { get, document, translatedElements, requests } = await page('live', [], { language: '__APP_LANGUAGE__' });
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(get('preview-button').textContent, 'Compare texts');
  assert.equal(get('language-select').getAttribute('aria-label'), 'Interface language');
  assert.match(get('clipboard-input').placeholder, /Language \| Text/);
  assert.ok(translatedElements.find((element) => element.getAttribute('data-i18n') === 'heading').textContent.includes('New'));
  assert.ok(requests.every(({ body }) => body.language === 'en'));
  await switchLanguage(get, 'ru');
  assert.equal(document.documentElement.lang, 'ru');
  assert.equal(get('preview-button').textContent, 'Сравнить тексты');
  assert.equal(get('language-select').getAttribute('aria-label'), 'Язык интерфейса');
  assert.equal(get('comparison-table').getAttribute('aria-label'), 'Сравнение текстов');
  assert.match(get('clipboard-input').placeholder, /Язык \| Текст/);
  assert.deepEqual(requests.at(-1), { path: '/api/language', body: { language: 'ru' } });
});

test('смена языка сохраняет сравнение, выбор и введённые тексты без повторного чтения локалей', async () => {
  const { get, requests } = await page('live', [{ locale: 'ru', previous: '', text: 'Новый текст' }], { language: 'en' });
  get('prompt-output').value = 'My edited prompt';
  get('prompt-output').listeners.input();
  get('clipboard-input').value = 'Language | Text\nRussian | New text';
  get('source-select').value = 'older';
  await get('preview-button').listeners.click();
  const before = requests.length;
  await switchLanguage(get, 'ru');
  assert.equal(get('prompt-output').value, 'My edited prompt');
  assert.equal(get('clipboard-input').value, 'Language | Text\nRussian | New text');
  assert.equal(get('app-select').value, '123');
  assert.equal(get('platform-select').value, 'IOS');
  assert.equal(get('source-select').value, 'older');
  assert.equal(get('preview').hidden, false);
  assert.equal(get('apply-button').disabled, false);
  assert.equal(get('changes').children[0].children[0].textContent, 'русский');
  assert.equal(get('changes').children[0].children[1].textContent, '(пусто)');
  assert.equal(get('list-count').textContent, 'Изменений: 1');
  assert.deepEqual(requests.slice(before).map(({ path }) => path), ['/api/language']);
  assert.equal(requests.filter(({ path }) => path === '/api/locales').length, 1);
  await switchLanguage(get, 'en');
  assert.equal(get('prompt-output').value, 'My edited prompt');
  assert.equal(get('changes').children[0].children[0].textContent, 'Russian');
  assert.equal(get('list-count').textContent, 'Changes: 1');
  assert.equal(requests.some(({ path }) => path === '/api/apply'), false);
});

test('неизменённый промпт переводится из кэша и статус копирования меняет язык', async () => {
  const { get, requests } = await page('live', [], { language: 'en' });
  const original = get('prompt-output').value;
  assert.equal(original, makePrompt(['en-US', 'ru'], 'en'));
  await get('copy-prompt').listeners.click();
  assert.equal(get('notice').textContent, 'Prompt copied.');
  await switchLanguage(get, 'ru');
  assert.equal(get('notice').textContent, 'Промпт скопирован.');
  assert.equal(get('prompt-output').value, makePrompt(['en-US', 'ru'], 'ru'));
  await switchLanguage(get, 'en');
  assert.equal(get('prompt-output').value, original);
  assert.equal(requests.filter(({ path }) => path === '/api/locales').length, 1);
});

test('ошибка сохранения языка возвращает прежний интерфейс и сохраняет готовый план', async () => {
  const { get, requests, document } = await page('live', [{ locale: 'ru', previous: '', text: 'Text' }], {
    language: 'en', respond: (path) => path === '/api/language'
      ? { ok: false, json: async () => ({ error: 'Settings unavailable' }) } : undefined,
  });
  await get('preview-button').listeners.click();
  await switchLanguage(get, 'ru');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(get('language-select').value, 'en');
  assert.equal(get('language-select').disabled, false);
  assert.equal(get('preview').hidden, false);
  assert.equal(get('apply-button').disabled, false);
  assert.equal(get('notice').className, 'notice error');
  assert.match(get('notice').textContent, /Could not save.*restored/);
  assert.equal(requests.some(({ path }) => path === '/api/apply'), false);
});

test('отложенное сравнение использует новый язык, а устаревшее сравнение не восстанавливает план', async () => {
  let resolvePreview;
  const { get } = await page('live', [], { language: 'en', respond: (path) => path === '/api/preview'
    ? new Promise((resolve) => { resolvePreview = resolve; }) : undefined });
  const plan = { planId: 'old', source: '1.0', draft: '1.1', changes: [{ locale: 'ru', previous: '', text: 'X' }], unchanged: [], missing: [], sourceOnly: [] };
  const pending = get('preview-button').listeners.click();
  await switchLanguage(get, 'ru');
  resolvePreview({ ok: true, json: async () => plan });
  await pending;
  assert.equal(get('changes').children[0].children[0].textContent, 'русский');
  const stale = get('preview-button').listeners.click();
  get('source-select').value = 'older';
  get('source-select').listeners.change();
  resolvePreview({ ok: true, json: async () => plan });
  await stale;
  assert.equal(get('preview').hidden, true);
  assert.equal(get('apply-button').disabled, true);
});

test('ответ старого списка версий не заменяет источник выбранного приложения', async () => {
  let resolveSources;
  const { get } = await page('live', [], { language: 'en', respond: (path, body) => path === '/api/sources' && body.appId === '456'
    ? new Promise((resolve) => { resolveSources = resolve; }) : undefined });
  get('app-select').value = '456';
  const old = get('app-select').listeners.change();
  await new Promise((resolve) => setImmediate(resolve));
  get('app-select').value = '789';
  await get('app-select').listeners.change();
  resolveSources({ ok: true, json: async () => ({ sourceId: 'stale', sources: [{ id: 'stale', version: '0.1' }] }) });
  await old;
  assert.equal(get('source-select').value, 'live');
  assert.equal(get('source-select').options.some(({ value }) => value === 'stale'), false);
  assert.equal(get('preview-button').disabled, false);
});

test('подробности ошибки Apple сохраняются, а статусы частичного сохранения переводятся', async () => {
  const { get, requests } = await page('live', [{ locale: 'ru', previous: '', text: 'Text' }], {
    language: 'en', respond: (path) => path === '/api/apply'
      ? { ok: true, json: async () => ({ updated: 1, failed: [{ locale: 'ru', error: 'Apple: field is locked' }] }) } : undefined,
  });
  await get('preview-button').listeners.click();
  get('apply-button').listeners.click();
  assert.equal(get('confirm-dialog').open, true);
  get('cancel-save').listeners.click();
  assert.equal(requests.some(({ path }) => path === '/api/apply'), false);
  get('apply-button').listeners.click();
  await get('confirm-save').listeners.click();
  assert.match(get('result').textContent, /Saved: 1.*Russian.*Apple: field is locked/);
  await switchLanguage(get, 'ru');
  assert.match(get('result').textContent, /Сохранено: 1.*русский.*Apple: field is locked/);
  assert.equal(requests.filter(({ path }) => path === '/api/apply').length, 1);
  assert.equal(get('apply-button').disabled, true);
});

test('выбор языка блокируется до сохранения настройки и не допускает перестановки ответов', async () => {
  let resolveLanguage;
  const { get, document, requests } = await page('live', [], { language: 'en', respond: (path) => path === '/api/language'
    ? new Promise((resolve) => { resolveLanguage = resolve; }) : undefined });
  const saving = switchLanguage(get, 'ru');
  assert.equal(document.documentElement.lang, 'ru');
  assert.equal(get('language-select').disabled, true);
  await switchLanguage(get, 'en');
  assert.equal(requests.filter(({ path }) => path === '/api/language').length, 1);
  resolveLanguage({ ok: true, json: async () => ({ language: 'ru' }) });
  await saving;
  assert.equal(document.documentElement.lang, 'ru');
  assert.equal(get('language-select').disabled, false);
});

test('ошибка сохранения не оживляет устаревший план при смене языка и переводит причины', async () => {
  const { get, requests } = await page('live', [{ locale: 'ru', previous: '', text: 'Text' }], {
    language: 'en', respond: (path) => path === '/api/apply'
      ? { ok: false, json: async () => ({ error: 'The preview is stale.', errorKey: 'stalePreview', errorParams: {} }) } : undefined,
  });
  await get('preview-button').listeners.click();
  await get('confirm-save').listeners.click();
  assert.equal(get('apply-button').disabled, true);
  assert.match(get('notice').textContent, /preview is stale/);
  await switchLanguage(get, 'ru');
  assert.equal(get('apply-button').disabled, true);
  assert.ok(get('notice').textContent.startsWith(translateError('ru', 'stalePreview')));
  await get('confirm-save').listeners.click();
  assert.equal(requests.filter(({ path }) => path === '/api/apply').length, 1);
});

function fakeTimers() {
  const pending = new Map();
  let next = 0;
  return {
    setTimeout(callback, delay) { const id = ++next; pending.set(id, { callback, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    fire() { const entries = [...pending.values()]; pending.clear(); for (const entry of entries) { assert.equal(entry.delay, 250); entry.callback(); } },
    count() { return pending.size; },
  };
}

test('индикатор загрузки появляется с задержкой и скрывается после ошибки', async () => {
  const timers = fakeTimers();
  let rejectPreview;
  const { get } = await page('live', [], { language: 'en', timers, respond: (path) => path === '/api/preview'
    ? new Promise((resolve, reject) => { rejectPreview = reject; }) : undefined });
  assert.equal(timers.count(), 0);
  const pending = get('preview-button').listeners.click();
  assert.equal(get('loading-overlay').hidden, true);
  assert.equal(get('notice').hidden, true);
  assert.equal(get('loading-text').textContent, 'Loading versions and texts…');
  timers.fire();
  assert.equal(get('loading-overlay').hidden, false);
  assert.equal(get('main').inert, true);
  assert.equal(get('topbar').inert, true);
  rejectPreview(new Error('Example failure'));
  await pending;
  assert.equal(get('loading-overlay').hidden, true);
  assert.equal(get('main').inert, false);
  assert.equal(get('topbar').inert, false);
  assert.match(get('notice').textContent, /Example failure/);
});

test('быстрая загрузка не показывает индикатор и не сдвигает уведомление', async () => {
  const timers = fakeTimers();
  const { get } = await page('live', [], { timers });
  await get('preview-button').listeners.click();
  assert.equal(timers.count(), 0);
  timers.fire();
  assert.equal(get('loading-overlay').hidden, true);
  assert.equal(get('notice').textContent, 'Изменения не требуются.');
});

test('индикатор сохранения блокирует интерфейс и скрывается при частичной ошибке', async () => {
  const timers = fakeTimers();
  let resolveSave;
  const { get } = await page('live', [{ locale: 'ru', previous: 'Старый', text: 'Новый' }], {
    timers,
    respond: (path) => path === '/api/apply' ? new Promise((resolve) => { resolveSave = resolve; }) : undefined,
  });
  await get('preview-button').listeners.click();
  get('apply-button').listeners.click();
  const saving = get('confirm-save').listeners.click();
  assert.match(get('loading-text').textContent, /Сохран/);
  timers.fire();
  assert.equal(get('loading-overlay').hidden, false);
  assert.equal(get('apply-button').disabled, true);
  resolveSave({ ok: true, json: async () => ({ updated: 0, failed: [{ locale: 'ru', error: 'Example failure' }] }) });
  await saving;
  assert.equal(get('loading-overlay').hidden, true);
  assert.equal(get('main').inert, false);
  assert.equal(get('result').className, 'result error');
  assert.match(get('result').textContent, /Example failure/);
});
