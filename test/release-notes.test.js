import test from 'node:test';
import assert from 'node:assert/strict';
import { findVersionPair, makePlan, makeClipboardPlan, applyPlan } from '../src/release-notes.js';

const version = (id, platform, appVersionState) => ({ id, attributes: { platform, appVersionState } });
const locale = (id, name, text) => ({ id, attributes: { locale: name, whatsNew: text } });

test('предлагает опубликованные версии по дате создания, если их несколько', () => {
  const older = version('older', 'IOS', 'READY_FOR_DISTRIBUTION');
  older.attributes.versionString = '1.0';
  older.attributes.createdDate = '2024-11-22T00:28:11-08:00';
  const current = version('current', 'IOS', 'READY_FOR_DISTRIBUTION');
  current.attributes.versionString = '0.12.0';
  current.attributes.createdDate = '2026-04-30T15:22:35-07:00';
  const draft = version('draft', 'IOS', 'PREPARE_FOR_SUBMISSION');
  assert.deepEqual(findVersionPair([older, draft, current], 'IOS'), { live: [current, older], draft });
});

test('находит опубликованную версию и черновик только выбранной платформы', () => {
  const live = version('live', 'IOS', 'READY_FOR_DISTRIBUTION');
  const draft = version('draft', 'IOS', 'PREPARE_FOR_SUBMISSION');
  assert.deepEqual(findVersionPair([version('other', 'MAC_OS', 'READY_FOR_DISTRIBUTION'), live, draft], 'IOS'), { live: [live], draft });
  assert.throws(() => findVersionPair([live, draft, version('duplicate', 'IOS', 'PREPARE_FOR_SUBMISSION')], 'IOS'));
  assert.throws(() => findVersionPair([draft], 'IOS'));
});

test('готовит только изменившиеся тексты и отдельно перечисляет пропуски', () => {
  const plan = makePlan(
    [locale('a', 'en-US', 'Fixed bugs'), locale('b', 'ru', 'Исправления'), locale('c', 'fr', ''), locale('d', 'it', 'Ciao')],
    [locale('1', 'en-US', 'Old'), locale('2', 'ru', 'Исправления'), locale('3', 'fr', 'Старый текст'), locale('4', 'de', '')],
  );
  assert.deepEqual(plan, {
    changes: [{ id: '1', locale: 'en-US', previous: 'Old', text: 'Fixed bugs' }],
    missing: ['de', 'fr'], unchanged: ['ru'], sourceOnly: ['it'],
  });
  assert.throws(() => makePlan([locale('1', 'en-US', 'a'), locale('2', 'en-US', 'b')], []));
});

test('сортирует языки по порядку App Store, остальные — по коду', () => {
  const languages = ['sv', 'ja', 'es-MX', 'zh-Hans', 'en-GB', 'uk', 'en-US', 'ru', 'fr-CA', 'ar-SA'];
  const source = languages.map((name) => locale(`s-${name}`, name, 'Новый'));
  const target = languages.map((name) => locale(`t-${name}`, name, 'Старый'));
  assert.deepEqual(makePlan(source, target).changes.map((c) => c.locale), ['en-US', 'en-GB', 'ar-SA', 'zh-Hans', 'ru', 'uk', 'fr-CA', 'sv', 'ja', 'es-MX']);
});

test('сортирует пропущенные, совпавшие и отсутствующие в черновике языки', () => {
  const source = ['it', 'en-GB', 'ru', 'en-US', 'es-MX', 'zh-Hans'].map((name) => locale(`s-${name}`, name, 'Текст'));
  const target = ['ru', 'en-GB', 'es-ES', 'ja', 'en-US'].map((name) => locale(`t-${name}`, name, 'Текст'));
  const plan = makePlan(source, target);
  assert.deepEqual(plan.unchanged, ['en-US', 'en-GB', 'ru']);
  assert.deepEqual(plan.missing, ['es-ES', 'ja']);
  assert.deepEqual(plan.sourceOnly, ['it', 'zh-Hans', 'es-MX']);
});

test('перечисляет неоднозначные локали в том же порядке', () => {
  const target = [locale('gb', 'en-GB', 'Old'), locale('us', 'en-US', 'Old')];
  assert.throws(() => makeClipboardPlan('Language | Text\nEN | New', target), /английский \(США\), английский \(Великобритания\)/);
});

test('ошибки показывают названия языков без кодов', () => {
  assert.throws(() => makeClipboardPlan('Язык | Текст\nанглийский (США) | New', [locale('ru', 'ru', 'Старый')]), /Нет в черновике: английский \(США\)/);
  assert.throws(() => makePlan([], [locale('ru', 'ru', 123)]), /черновика: русский\./);
});

test('сохраняет каждый язык отдельно и сообщает о частичном отказе', async () => {
  const calls = [];
  const api = { updateWhatsNew: async (id, text) => { calls.push([id, text]); if (id === '2') throw new Error('HTTP 409'); } };
  const plan = { changes: [{ id: '1', locale: 'en', text: 'One' }, { id: '2', locale: 'ru', text: 'Два' }] };
  assert.deepEqual(await applyPlan(api, plan), { updated: 1, failed: [{ locale: 'ru', error: 'HTTP 409' }] });
  assert.deepEqual(calls, [['1', 'One'], ['2', 'Два']]);
});
