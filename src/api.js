import { createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { t, AppError } from './i18n.js';

const API_ORIGIN = 'https://api.appstoreconnect.apple.com';
const MAX_ICON_BYTES = 1_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function iconAddress(value) {
  if (typeof value !== 'string' || /[{}]/.test(value)) throw new AppError('invalidIconAddress');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^isq?\d+(?:-ssl)?\.mzstatic\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.hash || !url.pathname.startsWith('/image/thumb/')) {
    throw new AppError('invalidIconAddress');
  }
  return url;
}

function appIconAddress(app, included) {
  const link = app.relationships?.appStoreIcon?.data;
  if (link?.type !== 'buildIcons' || typeof link.id !== 'string') return null;
  const template = included.find((item) => item.type === link.type && item.id === link.id)?.attributes?.iconAsset?.templateUrl;
  if (typeof template !== 'string') return null;
  try {
    return iconAddress(template.replaceAll('{w}', '96').replaceAll('{h}', '96').replaceAll('{f}', 'png')).href;
  } catch {
    return null;
  }
}

export function createToken({ keyId, issuerId, privateKey }, now = Math.floor(Date.now() / 1000)) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new AppError('keyFormat');
  }
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const payload = encode({ ...(issuerId ? { iss: issuerId } : { sub: 'user' }), iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const input = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

export async function loadConfig(path = '.asc-config.json') {
  let config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new AppError('configRead');
  }
  if (!config || typeof config.keyId !== 'string' || !config.keyId.trim() ||
      typeof config.privateKeyPath !== 'string' || !config.privateKeyPath.trim() ||
      (config.issuerId !== undefined && (typeof config.issuerId !== 'string' || !config.issuerId.trim()))) {
    throw new AppError('configFields');
  }
  const pathToKey = config.privateKeyPath.startsWith('~/')
    ? `${homedir()}/${config.privateKeyPath.slice(2)}` : config.privateKeyPath;
  let privateKey;
  try {
    privateKey = await readFile(pathToKey, 'utf8');
  } catch (error) {
    throw new AppError('keyRead');
  }
  return { keyId: config.keyId.trim(), issuerId: config.issuerId?.trim(), privateKey };
}

export class AppStoreApi {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN || url.username || url.password) throw new AppError('invalidApiAddress');
    const response = await this.fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${createToken(this.config)}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const details = result?.errors?.map((e) => [e.code, e.detail || e.title].filter(Boolean).join(': ')).join('; ');
      const key = [401, 403, 409, 429].includes(response.status) ? `apple${response.status}` : 'appleError';
      throw new AppError(key, { status: response.status, details: details ? ` — ${details}` : '' });
    }
    if (!result || typeof result !== 'object') throw new AppError('invalidApiResponse');
    return result;
  }

  async list(path) {
    const data = [];
    const visited = new Set();
    let next = path;
    while (next) {
      const url = new URL(next, API_ORIGIN).href;
      if (visited.has(url)) throw new AppError('apiPagination');
      visited.add(url);
      const result = await this.request(url);
      if (!Array.isArray(result.data)) throw new AppError('invalidApiList');
      data.push(...result.data);
      next = result.links?.next ?? null;
      if (next !== null && typeof next !== 'string') throw new AppError('invalidPagination');
    }
    return data;
  }

  apps() { return this.list('/v1/apps?limit=200'); }

  async appsWithIcons() {
    try {
      const apps = [];
      const visited = new Set();
      let next = '/v1/apps?limit=200&include=appStoreIcon&fields%5BbuildIcons%5D=iconAsset';
      while (next) {
        const url = new URL(next, API_ORIGIN);
        if (url.origin !== API_ORIGIN || url.pathname !== '/v1/apps' || url.username || url.password || visited.has(url.href)) {
          throw new AppError('invalidAppPagination');
        }
        visited.add(url.href);
        const result = await this.request(url.href);
        if (!Array.isArray(result.data)) throw new AppError('invalidApiList');
        const included = Array.isArray(result.included) ? result.included.filter((item) => item && typeof item === 'object') : [];
        apps.push(...result.data.map((app) => ({ ...app, iconUrl: appIconAddress(app, included) })));
        next = result.links?.next ?? null;
        if (next !== null && typeof next !== 'string') throw new AppError('invalidPagination');
      }
      return apps;
    } catch {
      // Иконки необязательны: отказ include не должен скрывать доступные приложения.
      return (await this.apps()).map((app) => ({ ...app, iconUrl: null }));
    }
  }

  async appIcon(address) {
    const response = await this.fetch(iconAddress(address), {
      headers: { Accept: 'image/png' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/png' ||
        Number(response.headers.get('content-length')) > MAX_ICON_BYTES) {
      await response.body?.cancel();
      throw new AppError('iconUnavailable');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > MAX_ICON_BYTES) throw new AppError('iconTooLarge');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new AppError('invalidIcon');
    return bytes;
  }

  versions(appId) { return this.list(`/v1/apps/${encodeURIComponent(appId)}/appStoreVersions?limit=200&fields%5BappStoreVersions%5D=platform%2CversionString%2CappVersionState%2CcreatedDate`); }
  localizations(versionId) { return this.list(`/v1/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=50`); }

  updateWhatsNew(id, text) {
    return this.request(`/v1/appStoreVersionLocalizations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { data: { type: 'appStoreVersionLocalizations', id, attributes: { whatsNew: text } } },
    });
  }
}
