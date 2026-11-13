import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localeName, localeNames, unknownLocaleName } from '../public/locales.js';
import { makePrompt } from '../public/prompt.js';
import { catalogs, translate } from '../public/i18n.js';
import { parseClipboard } from '../src/clipboard.js';
import { configureLanguage, readLanguage, saveLanguage } from '../src/preferences.js';
import { withLanguage, AppError, errorData } from '../src/i18n.js';
import { loadConfig } from '../src/api.js';
import { makeClipboardPlan, applyPlan } from '../src/release-notes.js';

async function preferences(t) {
  const dir = await mkdtemp(join(tmpdir(), 'release-language-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, '.release-tools-preferences.json');
}

test('English is the default; language catalogs have identical keys', () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.ru).sort());
  assert.equal(localeName('en-US'), 'English (United States)');
  assert.equal(localeName('ru'), 'Russian');
  assert.match(makePrompt(['en-US', 'ru']), /Language and What’s New/);
  assert.doesNotMatch(makePrompt(['en-US', 'ru']), /[а-яё]/i);
});

for (const language of ['en', 'ru']) {
  test(`all displayed names round-trip in both table layouts regardless of interface (${language})`, () => {
    const locales = [...Object.keys(localeNames), 'fi', 'th', 'tr', 'es-419'];
    const names = locales.map((locale) => localeName(locale, language));
    assert.equal(names.includes(unknownLocaleName(language)), false);
    assert.equal(new Set(names).size, names.length);
    const vertical = ['Language\tWhat’s New', ...names.map((name, i) => `${name}\tText ${i}`)].join('\n');
    const horizontal = [names.join('\t'), names.map((_, i) => `Text ${i}`).join('\t')].join('\n');
    const expected = locales.map((locale, i) => ({ locale, text: `Text ${i}` }));
    for (const uiLanguage of ['en', 'ru']) {
      for (const table of [vertical, horizontal]) {
        const result = parseClipboard(table, locales, uiLanguage);
        assert.deepEqual(result.translations, expected);
        assert.deepEqual(result.issues, []);
      }
    }
  });

  test(`regional names never create or substitute missing locales (${language})`, () => {
    const text = `Language | Text\n${localeName('en-US', language)} | Hello\n${localeName('fr-FR', language)} | Bonjour`;
    const parsed = parseClipboard(text, ['en-GB', 'fr-CA'], language);
    assert.deepEqual(parsed.translations, []);
    assert.deepEqual(parsed.skipped, ['en-US', 'fr-FR']);
    const ambiguous = parseClipboard('Language | Text\nEN | Hello', ['en-US', 'en-GB'], language);
    assert.equal(ambiguous.translations.length, 0);
    assert.equal(ambiguous.issues.length, 1);
    assert.match(ambiguous.issues[0], language === 'en' ? /several available locales/ : /нескольким доступным локалям/);
  });

  test(`partial failures retain exact API details and structured local errors (${language})`, async () => {
    const locales = ['en-US', 'ru'];
    const target = locales.map((locale) => ({ id: locale, attributes: { locale, whatsNew: 'Old' } }));
    const table = ['Language | Text', ...locales.map((locale) => `${localeName(locale, language)} | New`)].join('\n');
    const plan = makeClipboardPlan(table, target, language);
    const writes = [];
    const result = await withLanguage(language, () => applyPlan({ updateWhatsNew: async (id) => {
      if (id === 'ru') throw new Error('APPLE_RAW_DETAIL: unchanged');
      writes.push(id);
    } }, plan));
    assert.deepEqual(writes, ['en-US']);
    assert.deepEqual(result, { updated: 1, failed: [{ locale: 'ru', error: 'APPLE_RAW_DETAIL: unchanged' }] });
    const structured = await withLanguage(language, () => applyPlan({ updateWhatsNew: async () => { throw new AppError('hint403'); } }, { changes: [plan.changes[0]] }));
    assert.equal(structured.failed[0].errorKey, 'hint403');
    assert.equal(structured.failed[0].error, translate(language, 'hint403'));
  });
}

test('preferences persist independently of credential configuration and reject invalid flags', async (t) => {
  const path = await preferences(t);
  assert.equal(await readLanguage(path), 'en');
  assert.equal(await configureLanguage(['--lang', 'ru'], path), 'ru');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { language: 'ru' });
  assert.equal(await configureLanguage([], path), 'ru');
  await assert.rejects(configureLanguage(['--lang', 'de'], path), /Допустимые языки/);
  assert.equal(await readLanguage(path), 'ru');
  assert.equal(await configureLanguage(['--lang', 'en'], path), 'en');
  assert.equal(await configureLanguage([], path), 'en');
  await writeFile(path, 'invalid JSON');
  assert.equal(await readLanguage(path), 'en');
  await writeFile(path, '{"language":"unknown"}');
  assert.equal(await readLanguage(path), 'en');
  await assert.rejects(saveLanguage('de', path), /Supported languages/);
});

test('asynchronous language contexts remain isolated', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const russian = withLanguage('ru', async () => { await waiting; return errorData(new AppError('emptyDraft')); });
  const english = withLanguage('en', async () => { release(); await Promise.resolve(); return errorData(new AppError('emptyDraft')); });
  const [ru, en] = await Promise.all([russian, english]);
  assert.equal(ru.error, 'В черновике нет локализаций.');
  assert.equal(en.error, 'The draft has no localizations.');
  assert.equal(translate('en', ru.errorKey, ru.errorParams), en.error);
});

test('mock configuration errors are localized without exposing malformed configuration contents', async (t) => {
  const path = await preferences(t);
  await writeFile(path, '{"keyId":"PRIVATE_TEST_MARKER", broken }');
  for (const language of ['en', 'ru']) {
    await assert.rejects(withLanguage(language, () => loadConfig(path)), (error) => {
      assert.equal(error.message, translate(language, 'configRead'));
      assert.doesNotMatch(error.message, /PRIVATE_TEST_MARKER|release-language-/);
      return true;
    });
  }
});

test('structured table errors and locale parameters retranslate without discarding details', () => {
  const target = ['en-US', 'en-GB'].map((locale) => ({ id: locale, attributes: { locale, whatsNew: '' } }));
  assert.throws(() => makeClipboardPlan('Language | Text\nEN | Hello', target, 'en'), (error) => {
    assert.equal(error.key, 'tableIssues');
    assert.match(translate('ru', error.key, error.params), /английский \(США\).*английский \(Великобритания\)/);
    assert.match(translate('en', error.key, error.params), /English \(United States\).*English \(United Kingdom\)/);
    return true;
  });
  assert.throws(() => makeClipboardPlan('Language | Text\nJapanese | Hello', target, 'en'), (error) => {
    assert.match(translate('ru', error.key, error.params), /Нет в черновике: японский/);
    assert.match(translate('en', error.key, error.params), /Not in the draft: Japanese/);
    return true;
  });
});
