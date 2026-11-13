import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findDraft, draftLocales, findVersionPair, makePlan, makeClipboardPlan, applyPlan, planConflict } from './release-notes.js';
import { findStoreVersion } from './store-lookup.js';
import { localeLabel } from '../public/locales.js';
import { t, AppError, errorData, getLanguage, withLanguage } from './i18n.js';
import { isLanguage, readLanguage, saveLanguage } from './preferences.js';

const publicDir = new URL('../public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/diff.js', ['diff.js', 'text/javascript; charset=utf-8']],
  ['/prompt.js', ['prompt.js', 'text/javascript; charset=utf-8']],
  ['/locales.js', ['locales.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/web-i18n.js', ['web-i18n.js', 'text/javascript; charset=utf-8']],
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
    if (data.length > 512_000) throw new AppError('requestTooLarge');
  }
  try { return JSON.parse(data || '{}'); } catch { throw new AppError('invalidJson'); }
}

export function createWebServer(api, lookup = findStoreVersion, log = () => {}, options = {}) {
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

  return createServer(async (req, res) => withLanguage(options.language ?? await readLanguage(options.preferencesPath), async () => {
    const origin = `http://127.0.0.1:${res.socket.localPort}`;
    if (req.headers.host !== `127.0.0.1:${res.socket.localPort}`) return send(res, 403, errorData(new AppError('invalidAddress')));
    let url;
    try { url = new URL(req.url, origin); } catch { return send(res, 400, errorData(new AppError('invalidAddress'))); }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");

    if (req.method === 'GET' && files.has(url.pathname)) {
      const [file, type] = files.get(url.pathname);
      try {
        let body = await readFile(fileURLToPath(new URL(file, publicDir)));
        if (file === 'index.html') body = Buffer.from(body.toString().replace('__LOCAL_TOKEN__', token).replaceAll('__APP_LANGUAGE__', getLanguage()));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(body);
      } catch {
        return send(res, 500, errorData(new AppError('pageUnavailable')));
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/app-icon/')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      if (req.headers['sec-fetch-site'] !== 'same-origin' || (req.headers.origin && req.headers.origin !== origin)) {
        return send(res, 403, errorData(new AppError('forbidden')));
      }
      let appId;
      try { appId = decodeURIComponent(url.pathname.slice('/api/app-icon/'.length)); } catch { return send(res, 404, errorData(new AppError('iconUnavailable'))); }
      const address = appIcons.get(appId);
      if (!allowedApps.has(appId) || !address || typeof api.appIcon !== 'function') return send(res, 404, errorData(new AppError('iconUnavailable')));
      const icons = appIcons;
      if (!iconCache.has(appId)) iconCache.set(appId, Promise.resolve().then(() => api.appIcon(address)).catch(() => null));
      const bytes = await iconCache.get(appId);
      if (!bytes || appIcons !== icons || !allowedApps.has(appId)) return send(res, 404, errorData(new AppError('iconUnavailable')));
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(bytes);
    }

    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, errorData(new AppError('pageNotFound')));
    if (req.headers.origin !== origin || req.headers['x-local-token'] !== token || req.headers['content-type'] !== 'application/json') {
      return send(res, 403, errorData(new AppError('forbidden')));
    }

    let language = getLanguage();
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('invalidJson');
      if (body.language !== undefined && !isLanguage(body.language)) throw new AppError('invalidLanguage');
      language = body.language ?? language;
      return await withLanguage(language, async () => {
        if (url.pathname === '/api/language') {
          if (!isLanguage(body.language)) throw new AppError('invalidLanguage');
          await saveLanguage(body.language, options.preferencesPath);
          return send(res, 200, { language: body.language });
        }
        if (url.pathname === '/api/apps') {
          const apps = await (typeof api.appsWithIcons === 'function' ? api.appsWithIcons() : api.apps());
          allowedApps = new Set(apps.map((a) => a.id));
          appNames = new Map(apps.map((a) => [a.id, label(a.attributes.name)]));
          appIcons = new Map(apps.filter((a) => typeof a.iconUrl === 'string').map((a) => [a.id, a.iconUrl]));
          iconCache = new Map();
          pending = null;
          record(t('logApps', { count: apps.length }));
          return send(res, 200, { apps: apps.map((a) => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId, iconUrl: appIcons.has(a.id) ? `/api/app-icon/${encodeURIComponent(a.id)}` : null })) });
        }
        if (url.pathname === '/api/versions') {
          if (!allowedApps.has(body.appId)) return send(res, 400, errorData(new AppError('selectApp')));
          pending = null;
          const versions = await api.versions(body.appId);
          record(t('logApp', { app: appNames.get(body.appId) }));
          return send(res, 200, { platforms: [...new Set(versions.map((v) => v.attributes.platform))] });
        }
        if (url.pathname === '/api/sources') {
          if (!allowedApps.has(body.appId) || typeof body.platform !== 'string') return send(res, 400, errorData(new AppError('selectPlatform')));
          pending = null;
          const { live } = findVersionPair(await api.versions(body.appId), body.platform);
          const source = await lookup(body.appId, body.platform, live);
          return send(res, 200, {
            sourceId: source?.id ?? null,
            sources: live.map((v) => ({ id: v.id, version: v.attributes.versionString, createdDate: v.attributes.createdDate })),
          });
        }
        if (url.pathname === '/api/locales') {
          if (!allowedApps.has(body.appId) || typeof body.platform !== 'string') return send(res, 400, errorData(new AppError('selectPlatform')));
          pending = null;
          const draft = findDraft(await api.versions(body.appId), body.platform);
          return send(res, 200, { locales: draftLocales(await api.localizations(draft.id)) });
        }
        if (url.pathname === '/api/preview') {
          if (!allowedApps.has(body.appId) || typeof body.platform !== 'string') return send(res, 400, errorData(new AppError('selectPlatform')));
          pending = null;
          const versions = await api.versions(body.appId);
          if (body.sourceType === 'clipboard') {
            const draft = findDraft(versions, body.platform);
            const targetTexts = await api.localizations(draft.id);
            const plan = makeClipboardPlan(body.clipboard, targetTexts);
            const planId = randomUUID();
            pending = { planId, appId: body.appId, platform: body.platform, sourceId: null, draftId: draft.id, plan };
            record(t('logTablePreview', { app: appNames.get(body.appId), platform: label(body.platform), draft: label(draft.attributes.versionString), count: plan.changes.length }));
            return send(res, 200, { planId, source: t('pastedTable'), sourceType: 'clipboard', draft: draft.attributes.versionString, ...plan });
          }
          const { live, draft } = findVersionPair(versions, body.platform);
          const source = body.sourceId ? live.find((v) => v.id === body.sourceId) : await lookup(body.appId, body.platform, live);
          if (!source && body.sourceId) return send(res, 400, errorData(new AppError('sourceUnavailable')));
          if (!source) return send(res, 200, { sources: live.map((v) => ({ id: v.id, version: v.attributes.versionString, createdDate: v.attributes.createdDate })) });
          const [sourceTexts, targetTexts] = await Promise.all([api.localizations(source.id), api.localizations(draft.id)]);
          if (!targetTexts.length) throw new AppError('emptyDraft');
          const plan = makePlan(sourceTexts, targetTexts);
          const planId = randomUUID();
          pending = { planId, appId: body.appId, platform: body.platform, sourceId: source.id, draftId: draft.id, plan };
          record(t('logVersionPreview', { app: appNames.get(body.appId), platform: label(body.platform), source: label(source.attributes.versionString), draft: label(draft.attributes.versionString), count: plan.changes.length }));
          return send(res, 200, { planId, source: source.attributes.versionString, draft: draft.attributes.versionString, ...plan });
        }
        if (url.pathname === '/api/apply') {
          if (!pending || body.planId !== pending.planId) {
            record(t('logStale'));
            return send(res, 409, errorData(new AppError('stalePreview')));
          }
          const saved = pending;
          pending = null;
          const conflict = await planConflict(api, saved);
          if (conflict) {
            record(t('logConflict'));
            return send(res, 409, errorData(new AppError(conflict === t('draftChanged') ? 'draftChanged' : 'versionsChanged')));
          }
          record(t('logSaving', { app: appNames.get(saved.appId), platform: label(saved.platform), count: saved.plan.changes.length }));
          const result = await applyPlan(api, saved.plan);
          record(t('logSaved', { count: result.updated }) + (result.failed.length ? t('logFailed', { count: result.failed.length, locales: result.failed.map((item) => localeLabel(item.locale, getLanguage())).join(', ') }) : ''));
          return send(res, 200, result);
        }
        return send(res, 404, errorData(new AppError('commandNotFound')));
      });
    } catch (error) {
      return withLanguage(language, () => {
        if (url.pathname === '/api/apps') record(t('logAppsError'));
        if (url.pathname === '/api/versions') record(t('logVersionsError'));
        if (url.pathname === '/api/sources' || url.pathname === '/api/locales') record(t('logSourcesError'));
        if (url.pathname === '/api/preview') record(t('logPreviewError'));
        if (url.pathname === '/api/apply') record(t('logApplyError'));
        return send(res, 400, errorData(error));
      });
    }
  }));
}
