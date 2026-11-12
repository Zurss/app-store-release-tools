import test from 'node:test';
import assert from 'node:assert/strict';
import { findStoreVersion } from '../src/store-lookup.js';

const live = (versionString) => ({ attributes: { versionString } });
const response = (data, status = 200) => async () => new Response(JSON.stringify(data), { status });

test('определяет текущую iOS-версию по ID и версии в App Store', async () => {
  const versions = [live('1.0'), live('0.12.0')];
  let request;
  const result = await findStoreVersion('123', 'IOS', versions, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ results: [{ trackId: 123, kind: 'software', version: '0.12.0' }] }));
  });
  assert.equal(result, versions[1]);
  assert.equal(request.url.href, 'https://itunes.apple.com/lookup?id=123&country=us');
  assert.equal(request.options.headers, undefined);
});

test('предлагает ручной выбор при недоступном App Store или неподходящем ответе', async () => {
  const versions = [live('0.12.0')];
  const inputs = [
    response({ results: [] }),
    response({ results: [{ trackId: 123, kind: 'software', version: '0.11.0' }] }),
    response({ results: [{ trackId: 456, kind: 'software', version: '0.12.0' }] }),
    response({ results: [{ trackId: 123, kind: 'mac-software', version: '0.12.0' }] }),
    response({ errors: [] }, 503),
    async () => { throw new Error('network error'); },
  ];
  for (const fetchImpl of inputs) assert.equal(await findStoreVersion('123', 'IOS', versions, fetchImpl), null);
  assert.equal(await findStoreVersion('123', 'TV_OS', versions, () => { throw new Error('не должен вызываться'); }), null);
  assert.equal(await findStoreVersion('bad-id', 'IOS', versions, () => { throw new Error('не должен вызываться'); }), null);
});

test('не выбирает версию при неоднозначности и не путает iOS с macOS', async () => {
  const item = { trackId: 123, kind: 'software', version: '1.0' };
  assert.equal(await findStoreVersion('123', 'IOS', [live('1.0'), live('1.0')], response({ results: [item] })), null);
  assert.equal(await findStoreVersion('123', 'IOS', [live('1.0')], response({ results: [item, item] })), null);
  assert.equal(await findStoreVersion('123', 'MAC_OS', [live('1.0')], response({ results: [item] })), null);
  const mac = live('1.0');
  assert.equal(await findStoreVersion('123', 'MAC_OS', [mac], response({ results: [{ ...item, kind: 'mac-software' }] })), mac);
});

test('просит ручной выбор, если App Store может возвращать устаревшую версию', async () => {
  const old = { attributes: { versionString: '1.0', createdDate: '2025-01-01T00:00:00Z' } };
  const newer = { attributes: { versionString: '2.0', createdDate: '2026-01-01T00:00:00Z' } };
  const fetchImpl = response({ results: [{ trackId: 123, kind: 'software', version: '1.0' }] });
  assert.equal(await findStoreVersion('123', 'IOS', [old, newer], fetchImpl), null);
});
