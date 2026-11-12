import test from 'node:test';
import assert from 'node:assert/strict';
import { localeLabel, localeName, localeNames, UNKNOWN_LOCALE_NAME } from '../public/locales.js';

test('показывает только русские названия с регионом при необходимости', () => {
  assert.equal(localeLabel('en-US'), 'английский (США)');
  assert.equal(localeLabel('en-GB'), 'английский (Великобритания)');
  assert.equal(localeLabel('zh-Hant'), 'китайский (традиционный)');
  assert.equal(localeLabel('zh-Hans'), 'китайский (упрощённый)');
  assert.equal(localeLabel('fr-FR'), 'французский');
  assert.equal(localeLabel('fr-CA'), 'французский (Канада)');
  assert.equal(localeLabel('ar-SA'), 'арабский');
  for (const [code, name] of Object.entries(localeNames)) {
    assert.equal(localeName(code), name);
    assert.equal(localeLabel(code), name);
    assert.doesNotMatch(name, /[a-z]/i);
  }
});

test('нормализует регистр и разделитель кода, дополнительные языки берёт из Intl', () => {
  assert.equal(localeName(' EN_us '), 'английский (США)');
  assert.equal(localeName('es-419'), new Intl.DisplayNames('ru', { type: 'language', fallback: 'none' }).of('es-419'));
  assert.doesNotMatch(localeName('es-419'), /[a-z]/i);
  assert.equal(localeName('fi'), 'финский');
});

test('неизвестные и некорректные коды получают безопасное имя без кода', () => {
  for (const code of ['xx-YY', 'bad--tag', 'en-Qaaa', '', null, undefined]) {
    assert.equal(localeName(code), UNKNOWN_LOCALE_NAME);
    assert.equal(localeLabel(code), UNKNOWN_LOCALE_NAME);
  }
});
