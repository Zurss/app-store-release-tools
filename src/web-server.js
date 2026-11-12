import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findDraft, draftLocales, findVersionPair, makePlan, makeClipboardPlan, applyPlan, planConflict } from './release-notes.js';
import { findStoreVersion } from './store-lookup.js';
import { localeLabel } from '../public/locales.js';

const publicDir = new URL('../public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/diff.js', ['diff.js', 'text/javascript; charset=utf-8']],
  ['/prompt.js', ['prompt.js', 'text/javascript; charset=utf-8']],
  ['/locales.js', ['locales.js', 'text/javascript; charset=utf-8']],
  ['/logo.png', ['logo.png', 'image/png']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
]);

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let data = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 512_000) throw new Error('Слишком большой запрос.');
  }
  return JSON.parse(data || '{}');
}

export function createWebServer(api, lookup = findStoreVersion, log = () => {}) {
  const token = randomBytes(32).toString('hex');
  let allowedApps = new Set();
  let appNames = new Map();
  let appIcons = new Map();
  let iconCache = new Map();
  let pending = null;

  const record = (message) => {
    try { log(message); } catch { /* Журнал не должен прерывать сохранение. */ }
  };
  const label = (value) => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();

  return createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${res.socket.localPort}`;
    if (req.headers.host !== `127.0.0.1:${res.socket.localPort}`) return send(res, 403, { error: 'Недопустимый адрес.' });
    let url;
    try { url = new URL(req.url, origin); } catch { return send(res, 400, { error: 'Недопустимый адрес.' }); }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");

    if (req.method === 'GET' && files.has(url.pathname)) {
      const [file, type] = files.get(url.pathname);
      try {
        let body = await readFile(fileURLToPath(new URL(file, publicDir)));
        if (file === 'index.html') body = Buffer.from(body.toString().replace('__LOCAL_TOKEN__', token));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(body);
      } catch {
        return send(res, 500, { error: 'Не удалось открыть страницу.' });
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/app-icon/')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      if (req.headers['sec-fetch-site'] !== 'same-origin' || (req.headers.origin && req.headers.origin !== origin)) {
        return send(res, 403, { error: 'Доступ запрещён.' });
      }
      let appId;
      try { appId = decodeURIComponent(url.pathname.slice('/api/app-icon/'.length)); } catch { return send(res, 404, { error: 'Иконка недоступна.' }); }
      const address = appIcons.get(appId);
      if (!allowedApps.has(appId) || !address || typeof api.appIcon !== 'function') return send(res, 404, { error: 'Иконка недоступна.' });
      const icons = appIcons;
      if (!iconCache.has(appId)) iconCache.set(appId, Promise.resolve().then(() => api.appIcon(address)).catch(() => null));
      const bytes = await iconCache.get(appId);
      if (!bytes || appIcons !== icons || !allowedApps.has(appId)) return send(res, 404, { error: 'Иконка недоступна.' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(bytes);
    }

    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Страница не найдена.' });
    if (req.headers.origin !== origin || req.headers['x-local-token'] !== token || req.headers['content-type'] !== 'application/json') {
      return send(res, 403, { error: 'Доступ запрещён.' });
    }

    try {
      const body = await readJson(req);
      if (url.pathname === '/api/apps') {
        const apps = await (typeof api.appsWithIcons === 'function' ? api.appsWithIcons() : api.apps());
        allowedApps = new Set(apps.map((a) => a.id));
        appNames = new Map(apps.map((a) => [a.id, label(a.attributes.name)]));
        appIcons = new Map(apps.filter((a) => typeof a.iconUrl === 'string').map((a) => [a.id, a.iconUrl]));
        iconCache = new Map();
        pending = null;
        record(`Приложений доступно: ${apps.length}.`);
        return send(res, 200, { apps: apps.map((a) => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId, iconUrl: appIcons.has(a.id) ? `/api/app-icon/${encodeURIComponent(a.id)}` : null })) });
      }
      if (url.pathname === '/api/versions') {
        if (!allowedApps.has(body.appId)) return send(res, 400, { error: 'Выберите приложение из списка.' });
        pending = null;
        const versions = await api.versions(body.appId);
        record(`Приложение: ${appNames.get(body.appId)}.`);
        return send(res, 200, { platforms: [...new Set(versions.map((v) => v.attributes.platform))] });
      }
      if (url.pathname === '/api/sources') {
        if (!allowedApps.has(body.appId) || typeof body.platform !== 'string') return send(res, 400, { error: 'Выберите приложение и платформу.' });
        pending = null;
        const { live } = findVersionPair(await api.versions(body.appId), body.platform);
        const source = await lookup(body.appId, body.platform, live);
        return send(res, 200, {
          sourceId: source?.id ?? null,
          sources: live.map((v) => ({ id: v.id, version: v.attributes.versionString, createdDate: v.attributes.createdDate })),
        });
      }
      if (url.pathname === '/api/locales') {
        if (!allowedApps.has(body.appId) || typeof body.platform !== 'string') return send(res, 400, { error: 'Выберите приложение и платформу.' });
        pending = null;
        const draft = findDraft(await api.versions(body.appId), body.platform);
        return send(res, 200, { locales: draftLocales(await api.localizations(draft.id)) });
      }
      if (url.pathname === '/api/preview') {
        if (!allowedApps.has(body.appId) || typeof body.platform !== 'string') return send(res, 400, { error: 'Выберите приложение и платформу.' });
        pending = null;
        const versions = await api.versions(body.appId);
        if (body.sourceType === 'clipboard') {
          const draft = findDraft(versions, body.platform);
          const targetTexts = await api.localizations(draft.id);
          const plan = makeClipboardPlan(body.clipboard, targetTexts);
          const planId = randomUUID();
          pending = { planId, appId: body.appId, platform: body.platform, sourceId: null, draftId: draft.id, plan };
          record(`Сравнение: ${appNames.get(body.appId)} (${label(body.platform)}), таблица → черновик ${label(draft.attributes.versionString)}. Изменений: ${plan.changes.length}.`);
          return send(res, 200, { planId, source: 'Вставленная таблица', sourceType: 'clipboard', draft: draft.attributes.versionString, ...plan });
        }
        const { live, draft } = findVersionPair(versions, body.platform);
        const source = body.sourceId ? live.find((v) => v.id === body.sourceId) : await lookup(body.appId, body.platform, live);
        if (!source && body.sourceId) return send(res, 400, { error: 'Выбранная версия больше недоступна.' });
        if (!source) return send(res, 200, { sources: live.map((v) => ({ id: v.id, version: v.attributes.versionString, createdDate: v.attributes.createdDate })) });
        const [sourceTexts, targetTexts] = await Promise.all([api.localizations(source.id), api.localizations(draft.id)]);
        if (!targetTexts.length) throw new Error('В черновике нет локализаций.');
        const plan = makePlan(sourceTexts, targetTexts);
        const planId = randomUUID();
        pending = { planId, appId: body.appId, platform: body.platform, sourceId: source.id, draftId: draft.id, plan };
        record(`Сравнение: ${appNames.get(body.appId)} (${label(body.platform)}), версия ${label(source.attributes.versionString)} → черновик ${label(draft.attributes.versionString)}. Изменений: ${plan.changes.length}.`);
        return send(res, 200, { planId, source: source.attributes.versionString, draft: draft.attributes.versionString, ...plan });
      }
      if (url.pathname === '/api/apply') {
        if (!pending || body.planId !== pending.planId) {
          record('Сохранение отменено: сравнение устарело.');
          return send(res, 409, { error: 'Предпросмотр устарел. Подготовьте его заново.' });
        }
        const saved = pending;
        pending = null;
        const conflict = await planConflict(api, saved);
        if (conflict) {
          record('Сохранение отменено: данные изменились после сравнения.');
          return send(res, 409, { error: conflict });
        }
        record(`Сохранение: ${appNames.get(saved.appId)} (${label(saved.platform)}), языков: ${saved.plan.changes.length}.`);
        const result = await applyPlan(api, saved.plan);
        record(`Сохранено: ${result.updated}.${result.failed.length ? ` Не удалось: ${result.failed.length} (${result.failed.map((item) => localeLabel(item.locale)).join(', ')}). Подробности в веб-интерфейсе.` : ''}`);
        return send(res, 200, result);
      }
      return send(res, 404, { error: 'Команда не найдена.' });
    } catch (error) {
      if (url.pathname === '/api/apps') record('Не удалось получить список приложений. Подробности в веб-интерфейсе.');
      if (url.pathname === '/api/versions') record('Не удалось получить версии приложения. Подробности в веб-интерфейсе.');
      if (url.pathname === '/api/sources' || url.pathname === '/api/locales') record('Не удалось получить данные версии. Подробности в веб-интерфейсе.');
      if (url.pathname === '/api/preview') record('Не удалось подготовить сравнение. Подробности в веб-интерфейсе.');
      if (url.pathname === '/api/apply') record('Сохранение прервано. Проверьте результат в веб-интерфейсе.');
      return send(res, 400, { error: error.message });
    }
  });
}
