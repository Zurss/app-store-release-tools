import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { createWebServer } from '../src/web-server.js';

const makeVersion = (id, state, number) => ({ id, attributes: { platform: 'IOS', appVersionState: state, versionString: number } });
const makeLocale = (id, locale, text) => ({ id, attributes: { locale, whatsNew: text } });

async function fixture({ published = true, multipleEnglish = false, multipleFrench = false, failLog = false, language = 'ru', preferencesPath } = {}) {
  const live = makeVersion('live', 'READY_FOR_DISTRIBUTION', '1.0');
  const older = makeVersion('older', 'READY_FOR_DISTRIBUTION', '0.9');
  const draft = makeVersion('draft', 'PREPARE_FOR_SUBMISSION', '1.1');
  let oldText = 'Старый текст';
  const writes = [];
  const logs = [];
  const api = {
    apps: async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' } }],
    versions: async () => published ? [live, older, draft] : [draft],
    localizations: async (id) => id === 'live' ? [makeLocale('source', 'ru', 'Новый текст')]
      : id === 'older' ? [makeLocale('old-source', 'ru', 'Текст прошлой версии')]
        : [makeLocale('target', 'ru', oldText), ...(multipleEnglish ? [makeLocale('en-us', 'en-US', 'Old'), makeLocale('en-gb', 'en-GB', 'Old')] : []), ...(multipleFrench ? [makeLocale('fr-fr', 'fr-FR', 'Ancien'), makeLocale('fr-ca', 'fr-CA', 'Ancien')] : [])],
    updateWhatsNew: async (id, text) => { writes.push({ id, text }); },
  };
  const server = createWebServer(api, async () => live, (message) => {
    if (failLog) throw new Error('Журнал недоступен');
    logs.push(message);
  }, { language, preferencesPath });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(base)).text();
  const token = page.match(/name="local-token" content="([a-f0-9]+)"/)[1];
  const call = async (path, body = {}, options = {}) => {
    const response = await fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: { Origin: options.origin ?? base, 'Content-Type': 'application/json', 'X-Local-Token': options.token ?? token },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { server, call, writes, api, base, logs, setDraft: (value) => { oldText = value; } };
}

test('журнал показывает приложение, сравнение и результат без текстов', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  await f.call('apps');
  await f.call('versions', { appId: '123' });
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS' })).body;
  assert.match(f.logs.join('\n'), /Игра/);
  assert.match(f.logs.join('\n'), /1\.0/);
  assert.match(f.logs.join('\n'), /Изменений: 1/);
  assert.equal(f.writes.length, 0);
  await f.call('apply', { planId: plan.planId });
  assert.match(f.logs.join('\n'), /Сохранено: 1/);
  assert.doesNotMatch(f.logs.join('\n'), /Старый текст|Новый текст/);
});

test('журнал сообщает о частичной ошибке и не раскрывает подробности API', async (t) => {
  const f = await fixture({ multipleEnglish: true });
  t.after(() => f.server.close());
  f.api.updateWhatsNew = async (id) => { if (id === 'en-us') throw new Error('СЕКРЕТНЫЙ ТЕКСТ'); };
  await f.call('apps');
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Язык | Текст\nанглийский (США) | Secret translation\nрусский | Новый перевод' })).body;
  const result = await f.call('apply', { planId: plan.planId });
  assert.equal(result.body.updated, 1);
  assert.match(f.logs.join('\n'), /Сохранено: 1/);
  assert.match(f.logs.join('\n'), /Не удалось: 1.*английский \(США\)/);
  assert.doesNotMatch(f.logs.join('\n'), /СЕКРЕТНЫЙ ТЕКСТ|Secret translation|Новый перевод/);
});

test('журнал сообщает об ошибке сравнения и отмене устаревшего сохранения', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  await f.call('apps');
  const invalid = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'ЛИЧНЫЙ ТЕКСТ' });
  assert.equal(invalid.status, 400);
  assert.match(f.logs.join('\n'), /Не удалось подготовить сравнение/);
  assert.doesNotMatch(f.logs.join('\n'), /ЛИЧНЫЙ ТЕКСТ/);
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS' })).body;
  f.setDraft('Другой текст');
  assert.equal((await f.call('apply', { planId: plan.planId })).status, 409);
  assert.match(f.logs.join('\n'), /Сохранение отменено/);
  assert.deepEqual(f.writes, []);
});

test('ошибка журнала не прерывает сравнение и сохранение', async (t) => {
  const f = await fixture({ failLog: true });
  t.after(() => f.server.close());
  assert.equal((await f.call('apps')).status, 200);
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS' })).body;
  assert.equal((await f.call('apply', { planId: plan.planId })).body.updated, 1);
  assert.deepEqual(f.writes, [{ id: 'target', text: 'Новый текст' }]);
});

test('отклоняет некорректный адрес и продолжает работу', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  const status = await new Promise((resolve, reject) => {
    get({ hostname: '127.0.0.1', port: f.server.address().port, path: '//[' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(status, 400);
  assert.equal((await f.call('apps')).status, 200);
});

test('страница использует логотип, который сервер отдаёт как PNG', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  const base = `http://127.0.0.1:${f.server.address().port}`;
  const html = await (await fetch(base)).text();
  assert.match(html, /rel="icon"[^>]*href="\/logo\.png"/);
  assert.match(html, /<img[^>]*src="\/logo\.png"/);
  const response = await fetch(`${base}/logo.png`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('веб-интерфейс показывает план и сохраняет только после подтверждения', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  assert.equal((await f.call('apps')).body.apps[0].name, 'Игра');
  assert.deepEqual((await f.call('versions', { appId: '123' })).body.platforms, ['IOS']);
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS' })).body;
  assert.equal(plan.source, '1.0');
  assert.equal(plan.draft, '1.1');
  assert.deepEqual(plan.changes, [{ id: 'target', locale: 'ru', previous: 'Старый текст', text: 'Новый текст' }]);
  assert.deepEqual(f.writes, []);
  const result = await f.call('apply', { planId: plan.planId });
  assert.deepEqual(result.body, { updated: 1, failed: [] });
  assert.deepEqual(f.writes, [{ id: 'target', text: 'Новый текст' }]);
  assert.equal((await f.call('apply', { planId: plan.planId })).status, 409);
});

test('таблица сравнивается с черновиком и сохраняется только после подтверждения', async (t) => {
  const f = await fixture({ published: false });
  t.after(() => f.server.close());
  await f.call('apps');
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Язык | Текст\nru | Новый перевод' })).body;
  assert.equal(plan.source, 'Вставленная таблица');
  assert.equal(plan.sourceType, 'clipboard');
  assert.equal(plan.changes[0].text, 'Новый перевод');
  assert.deepEqual(f.writes, []);
  assert.equal((await f.call('apply', { planId: plan.planId })).status, 200);
  assert.deepEqual(f.writes, [{ id: 'target', text: 'Новый перевод' }]);
});

test('таблица с названиями и кодами обновляет только выбранные регионы', async (t) => {
  const f = await fixture({ multipleEnglish: true });
  t.after(() => f.server.close());
  await f.call('apps');
  const clipboard = 'Язык | Текст\nанглийский (США) [en-US] | New\nрусский [ru] | Новый';
  const response = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.changes.map((item) => item.locale), ['en-US', 'ru']);
  assert.deepEqual(response.body.missing, ['en-GB']);
  assert.deepEqual(f.writes, []);
  await f.call('apply', { planId: response.body.planId });
  assert.deepEqual(f.writes, [{ id: 'en-us', text: 'New' }, { id: 'target', text: 'Новый' }]);
});

test('человекочитаемые названия сопоставляются с правильными французскими регионами', async (t) => {
  const f = await fixture({ multipleFrench: true });
  t.after(() => f.server.close());
  await f.call('apps');
  const clipboard = 'Язык | Текст\nфранцузский | Bonjour\nфранцузский (Канада) | Allô';
  const response = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.changes.map((item) => item.locale), ['fr-FR', 'fr-CA']);
  assert.deepEqual(f.writes, []);
  await f.call('apply', { planId: response.body.planId });
  assert.deepEqual(f.writes, [{ id: 'fr-fr', text: 'Bonjour' }, { id: 'fr-ca', text: 'Allô' }]);
});

test('лишние и отсутствующие переводы не создают локализации', async (t) => {
  const f = await fixture({ multipleEnglish: true });
  t.after(() => f.server.close());
  await f.call('apps');
  const response = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Язык | Текст\nru | Новый перевод\nja | 新しい' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.sourceOnly, ['ja']);
  assert.deepEqual(response.body.missing, ['en-US', 'en-GB']);
  assert.deepEqual(response.body.changes.map((item) => item.locale), ['ru']);
  assert.deepEqual(f.writes, []);
  await f.call('apply', { planId: response.body.planId });
  assert.deepEqual(f.writes, [{ id: 'target', text: 'Новый перевод' }]);
});

test('показывает локализации черновика для промпта в нужном порядке', async (t) => {
  const f = await fixture({ published: false, multipleEnglish: true });
  t.after(() => f.server.close());
  await f.call('apps');
  const result = await f.call('locales', { appId: '123', platform: 'IOS' });
  assert.deepEqual(result.body.locales, ['en-US', 'en-GB', 'ru']);
  assert.deepEqual(f.writes, []);
});

test('если ни один язык не совпадает, сравнение и сохранение невозможны', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  await f.call('apps');
  const response = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Язык | Текст\nja | 新しい' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /японский/);
  assert.deepEqual(f.writes, []);
});

test('таблица не сохраняется, если черновик изменился после сравнения', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  await f.call('apps');
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Язык | Текст\nru | Новый перевод' })).body;
  f.setDraft('Новый черновик');
  assert.equal((await f.call('apply', { planId: plan.planId })).status, 409);
  assert.deepEqual(f.writes, []);
});

test('неоднозначная таблица блокирует сохранение даже старого предпросмотра', async (t) => {
  const f = await fixture({ multipleEnglish: true });
  t.after(() => f.server.close());
  await f.call('apps');
  const oldPlan = (await f.call('preview', { appId: '123', platform: 'IOS' })).body;
  const response = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Язык | Текст\nEN | New\nru | Новый' });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /английский \(США\)/);
  assert.equal((await f.call('apply', { planId: oldPlan.planId })).status, 409);
  assert.deepEqual(f.writes, []);
});

test('принимает большую таблицу Unicode и сортирует изменения', async (t) => {
  const f = await fixture({ multipleEnglish: true });
  t.after(() => f.server.close());
  await f.call('apps');
  const russian = 'Исправления '.repeat(250);
  const english = 'Improvements '.repeat(190);
  const response = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: `Язык | Текст\nru | ${russian}\nen-US | ${english}` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.changes.map((change) => change.locale), ['en-US', 'ru']);
  assert.equal(response.body.changes[1].text, russian.trim());
  assert.deepEqual(f.writes, []);
});

test('выбирает текущую версию по умолчанию и позволяет взять другую', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  await f.call('apps');
  const sources = (await f.call('sources', { appId: '123', platform: 'IOS' })).body;
  assert.equal(sources.sourceId, 'live');
  assert.deepEqual(sources.sources.map((source) => source.id), ['live', 'older']);
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS', sourceId: 'older' })).body;
  assert.equal(plan.source, '0.9');
  assert.equal(plan.changes[0].text, 'Текст прошлой версии');
  assert.deepEqual(f.writes, []);
  await f.call('apply', { planId: plan.planId });
  assert.deepEqual(f.writes, [{ id: 'target', text: 'Текст прошлой версии' }]);
});

test('запрещает чужой origin и устаревший предпросмотр', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  assert.equal((await f.call('apps', {}, { origin: 'https://example.com' })).status, 403);
  assert.equal((await f.call('apps', {}, { token: 'wrong' })).status, 403);
  await f.call('apps');
  const plan = (await f.call('preview', { appId: '123', platform: 'IOS' })).body;
  f.setDraft('Изменено другим пользователем');
  const result = await f.call('apply', { planId: plan.planId });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /изменились/);
  assert.deepEqual(f.writes, []);
});

test('предлагает выбрать опубликованную версию, если магазин не ответил', async (t) => {
  const baseServer = createWebServer({
    apps: async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' } }],
    versions: async () => [makeVersion('live', 'READY_FOR_DISTRIBUTION', '1.0'), makeVersion('draft', 'PREPARE_FOR_SUBMISSION', '1.1')],
    localizations: async (id) => [makeLocale(id, 'ru', id === 'live' ? 'Новый' : 'Старый')],
  }, async () => null);
  baseServer.listen(0, '127.0.0.1');
  await once(baseServer, 'listening');
  t.after(() => baseServer.close());
  const base = `http://127.0.0.1:${baseServer.address().port}`;
  const html = await (await fetch(base)).text();
  const token = html.match(/name="local-token" content="([a-f0-9]+)"/)[1];
  const post = (path, data) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Local-Token': token }, body: JSON.stringify(data) });
  await post('apps', {});
  const sources = await post('sources', { appId: '123', platform: 'IOS' });
  const sourceList = await sources.json();
  assert.equal(sourceList.sourceId, null);
  assert.equal(sourceList.sources[0].version, '1.0');
  const response = await post('preview', { appId: '123', platform: 'IOS' });
  assert.equal((await response.json()).sources[0].version, '1.0');
  const chosen = await post('preview', { appId: '123', platform: 'IOS', sourceId: 'live' });
  assert.equal((await chosen.json()).source, '1.0');
  const unknown = await post('preview', { appId: '123', platform: 'IOS', sourceId: 'unknown' });
  assert.equal(unknown.status, 400);
});

const iconPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const iconAddress = 'https://is1.mzstatic.com/image/thumb/icon/96x96bb.png';
const iconGet = (f, id = '123', headers = { 'Sec-Fetch-Site': 'same-origin' }) => fetch(`${f.base}/api/app-icon/${id}`, { headers });

test('список отдаёт только локальные пути; иконки загружаются лениво и кэшируются до обновления списка', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  let calls = 0;
  f.api.appsWithIcons = async () => [
    { id: '123', attributes: { name: 'Игра', bundleId: 'example.game' }, iconUrl: iconAddress },
    { id: 'none', attributes: { name: 'Без иконки', bundleId: 'example.none' }, iconUrl: null },
  ];
  f.api.appIcon = async (address) => { calls++; assert.equal(address, iconAddress); return iconPng; };
  const result = await f.call('apps');
  assert.deepEqual(result.body.apps.map((app) => app.iconUrl), ['/api/app-icon/123', null]);
  assert.equal(JSON.stringify(result.body).includes('mzstatic'), false);
  assert.equal(calls, 0);
  for (let i = 0; i < 2; i++) {
    const image = await iconGet(f);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), iconPng);
  }
  assert.equal(calls, 1);
  assert.equal((await iconGet(f, 'none')).status, 404);
  await f.call('apps');
  assert.equal((await iconGet(f)).status, 200);
  assert.equal(calls, 2);
});

test('простые API-моки без поддержки иконок продолжают отдавать список с iconUrl:null', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  assert.equal((await f.call('apps')).body.apps[0].iconUrl, null);
  assert.equal((await iconGet(f)).status, 404);
});

test('иконки доступны только same-origin запросам для приложений из загруженного списка', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  let calls = 0;
  f.api.appsWithIcons = async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' }, iconUrl: iconAddress }];
  f.api.appIcon = async () => { calls++; return iconPng; };
  assert.equal((await iconGet(f)).status, 404);
  await f.call('apps');
  for (const headers of [{}, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://evil.example' }]) {
    assert.equal((await iconGet(f, '123', headers)).status, 403);
  }
  for (const id of ['unknown', 'https%3A%2F%2Fevil.example', '123%2Fsecret', '%E0%A4%A']) {
    assert.equal((await iconGet(f, id)).status, 404);
  }
  assert.equal(calls, 0);
  const status = await new Promise((resolve, reject) => {
    get({ hostname: '127.0.0.1', port: f.server.address().port, path: '/api/app-icon/123', headers: { Host: 'localhost', 'Sec-Fetch-Site': 'same-origin' } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal(calls, 0);
});

test('ошибка CDN даёт недоступную иконку без раскрытия подробностей и сохраняет возможность выбрать приложение', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  f.api.appsWithIcons = async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' }, iconUrl: iconAddress }];
  f.api.appIcon = async () => { throw new Error('CDN private metadata'); };
  assert.equal((await f.call('apps')).status, 200);
  const image = await iconGet(f);
  assert.equal(image.status, 404);
  assert.equal((await image.json()).error, 'Иконка недоступна.');
  assert.equal((await f.call('versions', { appId: '123' })).status, 200);
});

test('GET иконки не сбрасывает подготовленный план', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  f.api.appsWithIcons = async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' }, iconUrl: iconAddress }];
  f.api.appIcon = async () => iconPng;
  await f.call('apps');
  const preview = await f.call('preview', { appId: '123', platform: 'IOS' });
  assert.equal((await iconGet(f)).status, 200);
  assert.equal((await f.call('apply', { planId: preview.body.planId })).status, 200);
  assert.equal(f.writes.length, 1);
});

test('обновление списка отзывает доступ к старым иконкам, в том числе уже загружаемым', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  f.api.appsWithIcons = async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' }, iconUrl: iconAddress }];
  let complete;
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  f.api.appIcon = () => { started(); return new Promise((resolve) => { complete = resolve; }); };
  await f.call('apps');
  const image = iconGet(f);
  await waiting;
  f.api.appsWithIcons = async () => [];
  await f.call('apps');
  complete(iconPng);
  assert.equal((await image).status, 404);
  assert.equal((await iconGet(f)).status, 404);
});

async function languageFixture(t) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'release-web-language-'));
  const preferencesPath = join(dir, '.release-tools-preferences.json');
  const f = await fixture({ language: null, preferencesPath });
  t.after(async () => { f.server.close(); await rm(dir, { recursive: true, force: true }); });
  return { ...f, preferencesPath };
}

test('web and CLI share persistent language; a language change preserves a prepared plan', async (t) => {
  const { configureLanguage, readLanguage } = await import('../src/preferences.js');
  const f = await languageFixture(t);
  const html = () => fetch(f.base).then((response) => response.text());
  assert.match(await html(), /name="app-language" content="en"/);
  await f.call('apps');
  const preview = await f.call('preview', { appId: '123', platform: 'IOS' });
  assert.deepEqual(await f.call('language', { language: 'ru' }), { status: 200, body: { language: 'ru' } });
  assert.equal(await configureLanguage([], f.preferencesPath), 'ru');
  assert.match(await html(), /name="app-language" content="ru"/);
  assert.equal((await f.call('apply', { planId: preview.body.planId })).body.updated, 1);
  await configureLanguage(['--lang', 'en'], f.preferencesPath);
  assert.match(await html(), /name="app-language" content="en"/);
  assert.equal((await f.call('apply', { planId: preview.body.planId })).body.error, 'The preview is stale. Prepare a new preview.');
  assert.equal(await readLanguage(f.preferencesPath), 'en');
});

test('language endpoint retains origin/token protections and validates before persisting', async (t) => {
  const { readLanguage } = await import('../src/preferences.js');
  const f = await languageFixture(t);
  assert.equal((await f.call('language', { language: 'ru' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.call('language', { language: 'ru' }, { token: 'wrong' })).status, 403);
  for (const body of [{}, { language: 'de' }, { language: '../ru' }, null, []]) {
    assert.equal((await f.call('language', body)).status, 400);
  }
  assert.equal(await readLanguage(f.preferencesPath), 'en');
  assert.equal((await f.call('language', { language: 'ru' })).status, 200);
  for (const file of ['i18n.js', 'web-i18n.js']) assert.equal((await fetch(`${f.base}/${file}`)).status, 200);
});

test('concurrent per-request languages isolate delayed errors and do not overwrite preferences', async (t) => {
  const { AppError } = await import('../src/i18n.js');
  const { readLanguage } = await import('../src/preferences.js');
  const f = await languageFixture(t);
  let count = 0;
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  f.api.apps = async () => {
    if (++count === 1) { started(); await wait; }
    else release();
    throw new AppError('emptyDraft');
  };
  const russian = f.call('apps', { language: 'ru' });
  await ready;
  const english = f.call('apps', { language: 'en' });
  const [ru, en] = await Promise.all([russian, english]);
  assert.equal(ru.body.error, 'В черновике нет локализаций.');
  assert.equal(en.body.error, 'The draft has no localizations.');
  assert.equal(ru.body.errorKey, 'emptyDraft');
  assert.equal(en.body.errorKey, 'emptyDraft');
  assert.equal(await readLanguage(f.preferencesPath), 'en');
});

for (const language of ['en', 'ru']) {
  test(`stale plans and partial write failures remain safe (${language})`, async (t) => {
    const f = await fixture({ language, multipleEnglish: true });
    t.after(() => f.server.close());
    await f.call('apps', { language });
    const preview = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Language | Text\nEnglish (United States) | New\nRussian | Новое', language });
    f.setDraft('Changed');
    const stale = await f.call('apply', { planId: preview.body.planId, language });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.errorKey, 'draftChanged');
    assert.deepEqual(f.writes, []);
    const next = await f.call('preview', { appId: '123', platform: 'IOS', sourceType: 'clipboard', clipboard: 'Language | Text\nEnglish (United States) | New\nRussian | Новое', language });
    f.api.updateWhatsNew = async (id, text) => {
      if (id === 'en-us') throw new Error('APPLE_UNMODIFIED_DETAIL');
      f.writes.push({ id, text });
    };
    const result = await f.call('apply', { planId: next.body.planId, language });
    assert.equal(result.body.updated, 1);
    assert.deepEqual(result.body.failed, [{ locale: 'en-US', error: 'APPLE_UNMODIFIED_DETAIL' }]);
    assert.deepEqual(f.writes, [{ id: 'target', text: 'Новое' }]);
    assert.doesNotMatch(f.logs.join('\n'), /APPLE_UNMODIFIED_DETAIL|Новое/);
    assert.match(f.logs.join('\n'), language === 'en' ? /Failed: 1 \(English \(United States\)\)/ : /Не удалось: 1 \(английский \(США\)\)/);
  });
}
