import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { AppStoreApi, createToken } from '../src/api.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const config = { keyId: 'TESTKEY', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const decode = (s) => JSON.parse(Buffer.from(s, 'base64url'));

test('подписывает ES256 JWT для individual и team keys', () => {
  for (const issuerId of [undefined, 'issuer']) {
    const [header, payload, signature] = createToken({ ...config, issuerId }, 1000).split('.');
    assert.deepEqual(decode(header), { alg: 'ES256', kid: 'TESTKEY', typ: 'JWT' });
    assert.deepEqual(decode(payload), { ...(issuerId ? { iss: issuerId } : { sub: 'user' }), iat: 1000, exp: 1600, aud: 'appstoreconnect-v1' });
    assert.equal(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  }
});

test('читает все страницы, не отправляя токен на другой сервер', async () => {
  const requests = [];
  const api = new AppStoreApi(config, async (url) => {
    requests.push(url.href);
    return new Response(JSON.stringify(requests.length === 1
      ? { data: [{ id: '1' }], links: { next: 'https://api.appstoreconnect.apple.com/v1/apps?cursor=2' } }
      : { data: [{ id: '2' }], links: {} }), { status: 200 });
  });
  assert.deepEqual(await api.apps(), [{ id: '1' }, { id: '2' }]);
  await assert.rejects(api.request('https://example.com/'), /Invalid API address/);
  assert.equal(requests.length, 2);
});

test('PATCH содержит только whatsNew и ошибки Apple доходят до вызывающего кода', async () => {
  let request;
  const api = new AppStoreApi(config, async (url, options) => {
    request = { url: url.href, ...options };
    return new Response(JSON.stringify({ errors: [{ code: 'STATE_ERROR', detail: 'Not editable' }] }), { status: 409 });
  });
  await assert.rejects(api.updateWhatsNew('locale-1', 'Hello'), /409.*STATE_ERROR.*Not editable/);
  assert.equal(request.method, 'PATCH');
  assert.deepEqual(JSON.parse(request.body), { data: { type: 'appStoreVersionLocalizations', id: 'locale-1', attributes: { whatsNew: 'Hello' } } });
});

test('добавляет понятную подсказку при ошибке прав доступа', async () => {
  const api = new AppStoreApi(config, async () => new Response('{}', { status: 403 }));
  await assert.rejects(api.apps(), /403.*Check key permissions and app access/);
});

const iconTemplate = 'https://is1-ssl.mzstatic.com/image/thumb/Purple123/icon.png/{w}x{h}bb.{f}';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const appWithIcon = (id, iconId = `icon-${id}`) => ({
  type: 'apps', id, attributes: { name: `App ${id}`, bundleId: `example.${id}` },
  relationships: { appStoreIcon: { data: { type: 'buildIcons', id: iconId } } },
});
const buildIcon = (id, templateUrl = iconTemplate) => ({
  type: 'buildIcons', id, attributes: { iconAsset: { templateUrl, width: 1024, height: 1024 }, iconType: 'APP_STORE', masked: false, name: 'AppIcon' },
});

test('веб-список разбирает документированный appStoreIcon → included buildIcons на каждой странице', async () => {
  const calls = [];
  const api = new AppStoreApi(config, async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? {
      data: [appWithIcon('1'), { type: 'apps', id: 'missing', attributes: { name: 'No icon' } }],
      included: [buildIcon('unrelated', 'https://evil.example/icon.png'), buildIcon('icon-1')],
      links: { next: 'https://api.appstoreconnect.apple.com/v1/apps?cursor=2&include=appStoreIcon' },
    } : {
      data: [appWithIcon('2')], included: [buildIcon('icon-2', iconTemplate.replace('Purple123', 'Purple456'))], links: { next: null },
    });
  });
  const apps = await api.appsWithIcons();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('include'), 'appStoreIcon');
  assert.equal(calls[0].url.searchParams.get('fields[buildIcons]'), 'iconAsset');
  assert.equal(apps[0].iconUrl, iconTemplate.replace('{w}', '96').replace('{h}', '96').replace('{f}', 'png'));
  assert.equal(apps[1].iconUrl, null);
  assert.match(apps[2].iconUrl, /Purple456.*96x96bb.png$/);
  assert.ok(calls.every(({ options }) => options.headers.Authorization.startsWith('Bearer ') && options.redirect === 'error'));
});

test('отсутствующий, неподходящий или повреждённый included даёт null вместо чужой иконки', async () => {
  for (const included of [undefined, {}, [null], [buildIcon('another')], [{ ...buildIcon('icon-1'), type: 'apps' }], [buildIcon('icon-1', 'https://evil.example/image/thumb/icon.png')]]) {
    const api = new AppStoreApi(config, async () => Response.json({ data: [appWithIcon('1')], included }));
    assert.equal((await api.appsWithIcons())[0].iconUrl, null);
  }
  const app = appWithIcon('1');
  app.relationships.appStoreIcon.data.type = 'apps';
  const api = new AppStoreApi(config, async () => Response.json({ data: [app], included: [buildIcon('icon-1')] }));
  assert.equal((await api.appsWithIcons())[0].iconUrl, null);
});

test('ошибка include не мешает обычному списку, а CLI apps() не запрашивает иконки', async () => {
  const urls = [];
  const api = new AppStoreApi(config, async (url) => {
    urls.push(url.href);
    return url.searchParams.has('include') ? Response.json({ errors: [{ code: 'FORBIDDEN' }] }, { status: 403 })
      : Response.json({ data: [appWithIcon('1')] });
  });
  assert.equal((await api.appsWithIcons())[0].iconUrl, null);
  assert.equal(urls.length, 2);
  await api.apps();
  assert.equal(urls[2], 'https://api.appstoreconnect.apple.com/v1/apps?limit=200');
});

test('пагинация иконок не запрашивает чужие серверы или другие API, циклы дают fallback', async () => {
  for (const next of ['https://example.com/v1/apps', 'https://api.appstoreconnect.apple.com/v1/users', 'https://user@api.appstoreconnect.apple.com/v1/apps', '/v1/apps?limit=200&include=appStoreIcon&fields%5BbuildIcons%5D=iconAsset', 42]) {
    const urls = [];
    const api = new AppStoreApi(config, async (url) => {
      urls.push(url.href);
      return Response.json(url.searchParams.has('include') ? { data: [appWithIcon('1')], links: { next } } : { data: [{ id: 'fallback' }] });
    });
    assert.deepEqual((await api.appsWithIcons()).map((a) => a.id), ['fallback']);
    assert.equal(urls.length, 2);
    assert.ok(urls.every((url) => url.startsWith('https://api.appstoreconnect.apple.com/v1/apps?')));
  }
});

test('иконка загружается с Apple CDN без bearer token и без перехода по redirect', async () => {
  let request;
  const api = new AppStoreApi(config, async (url, options) => {
    request = { url, options };
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  });
  const address = iconTemplate.replace('{w}', '96').replace('{h}', '96').replace('{f}', 'png');
  assert.deepEqual(await api.appIcon(address), png);
  assert.deepEqual(request.options.headers, { Accept: 'image/png' });
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.url.hostname, 'is1-ssl.mzstatic.com');
  const redirectApi = new AppStoreApi(config, async (url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } });
  });
  await assert.rejects(redirectApi.appIcon(address), /Icon unavailable/);
});

test('блокирует произвольные URL до сетевого запроса', async () => {
  let calls = 0;
  const api = new AppStoreApi(config, async () => { calls++; throw new Error('Unexpected fetch'); });
  for (const address of ['http://is1.mzstatic.com/image/thumb/a.png', 'https://127.0.0.1/image/thumb/a.png', 'https://is1.mzstatic.com.evil.example/image/thumb/a.png', 'https://evil.mzstatic.com/image/thumb/a.png', 'https://is1.mzstatic.com:444/image/thumb/a.png', 'https://user:pass@is1.mzstatic.com/image/thumb/a.png', 'https://is1.mzstatic.com/other/a.png', 'https://is1.mzstatic.com/image/thumb/{unknown}', 'https://is1.mzstatic.com/image/thumb/a.png#fragment', '/api/icon', null]) {
    await assert.rejects(api.appIcon(address));
  }
  assert.equal(calls, 0);
});

test('не отдаёт ошибки CDN, HTML, SVG, повреждённые и слишком большие изображения', async () => {
  const address = 'https://isq11.mzstatic.com/image/thumb/icon/96x96bb.png';
  for (const response of [new Response(null, { status: 404 }), new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }), new Response('<html/>', { headers: { 'Content-Type': 'image/png' } }), new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': '1000001' } }), new Response(Buffer.alloc(1_000_001), { headers: { 'Content-Type': 'image/png' } })]) {
    const api = new AppStoreApi(config, async () => response);
    await assert.rejects(api.appIcon(address));
  }
  const api = new AppStoreApi(config, async () => { throw new Error('Timeout'); });
  await assert.rejects(api.appIcon(address), /Timeout/);
});

test('localizes only the HTTP wrapper and hints; exact Apple details survive language changes', async () => {
  const { withLanguage, errorData } = await import('../src/i18n.js');
  const { translate } = await import('../public/i18n.js');
  const rawDetail = 'Original Apple detail: Что нового / What’s New';
  const api = new AppStoreApi(config, async () => new Response(JSON.stringify({ errors: [{ code: 'FORBIDDEN', detail: rawDetail }] }), { status: 403 }));
  for (const language of ['en', 'ru']) {
    await assert.rejects(withLanguage(language, () => api.apps()), (error) => {
      const data = withLanguage(language, () => errorData(error));
      assert.equal(data.errorKey, 'apple403');
      assert.ok(data.error.includes(rawDetail));
      const other = translate(language === 'en' ? 'ru' : 'en', data.errorKey, data.errorParams);
      assert.ok(other.includes(rawDetail));
      assert.match(data.error, language === 'en' ? /Check key permissions/ : /Проверьте права ключа/);
      return true;
    });
  }
});
