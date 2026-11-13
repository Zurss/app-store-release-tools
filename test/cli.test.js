import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiff, runCli as runCliLanguage } from '../src/cli.js';

const version = (id, appVersionState, versionString) => ({ id, attributes: { platform: 'IOS', appVersionState, versionString } });
const locale = (id, whatsNew) => ({ id, attributes: { locale: 'ru', whatsNew } });

test('терминальная подсветка доступна с цветом и без него', () => {
  const parts = [{ text: 'Без ', changed: false }, { text: 'замена', changed: true }];
  assert.equal(formatDiff(parts, 31, true), 'Без \x1b[31mзамена\x1b[0m');
  assert.equal(formatDiff(parts, 31, false), 'Без замена');
});

function fixture(answers) {
  const current = version('live', 'READY_FOR_DISTRIBUTION', '1.0');
  const older = version('older', 'READY_FOR_DISTRIBUTION', '0.9');
  const draft = version('draft', 'PREPARE_FOR_SUBMISSION', '1.1');
  const state = { versions: [current, older, draft], text: 'Черновик', writes: [], prompts: [] };
  const api = {
    apps: async () => [{ id: '123', attributes: { name: 'Игра', bundleId: 'example.game' } }],
    versions: async () => state.versions,
    localizations: async (id) => [locale(id === 'draft' ? 'target' : id, id === 'live' ? 'Текущий текст' : id === 'older' ? 'Прошлый текст' : state.text)],
    updateWhatsNew: async (id, text) => { state.writes.push({ id, text }); },
  };
  const rl = { question: async (prompt) => {
    state.prompts.push(prompt);
    const answer = answers.shift();
    assert.notEqual(answer, undefined, `Нет ответа на: ${prompt}`);
    return typeof answer === 'function' ? answer(state) : answer;
  } };
  return { api, rl, current, state };
}

test('терминал выбирает текущую версию по Enter и сохраняет после подтверждения', async (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture(['1', '1', '', '', 'y']);
  await runCli(f.api, f.rl, async () => f.current);
  assert.match(f.state.prompts[3], /Enter для текущей/);
  assert.deepEqual(f.state.writes, [{ id: 'target', text: 'Текущий текст' }]);
});

test('терминал показывает понятное имя языка', async (t) => {
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  const f = fixture(['1', '1', '', '', '']);
  await runCli(f.api, f.rl, async () => f.current);
  assert.match(output.join('\n'), /--- русский ---/);
  assert.deepEqual(f.state.writes, []);
});

test('терминал позволяет выбрать другую версию или вручную выбрать при сбое определения', async (t) => {
  t.mock.method(console, 'log', () => {});
  for (const lookup of [async (f) => f.current, async () => null]) {
    const f = fixture(['1', '1', '', '2', 'y']);
    await runCli(f.api, f.rl, () => lookup(f));
    assert.deepEqual(f.state.writes, [{ id: 'target', text: 'Прошлый текст' }]);
  }
});

test('терминал не сохраняет, если черновик изменился после сравнения', async (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture(['1', '1', '', '', (state) => { state.text = 'Изменён'; return 'y'; }]);
  await assert.rejects(runCli(f.api, f.rl, async () => f.current), /Тексты в черновике изменились/);
  assert.deepEqual(f.state.writes, []);
});

test('терминал предупреждает об упрощённой подсветке длинного текста', async (t) => {
  let warning = false;
  t.mock.method(console, 'log', (line) => { if (String(line).includes('Крупная подсветка')) warning = true; });
  const f = fixture(['1', '1', '', '', '']);
  f.state.text = 'а'.repeat(40_001);
  await runCli(f.api, f.rl, async () => f.current);
  assert.equal(warning, true);
  assert.deepEqual(f.state.writes, []);
});

test('терминал не сохраняет, если после сравнения изменилась версия', async (t) => {
  t.mock.method(console, 'log', () => {});
  const f = fixture(['1', '1', '', '', (state) => { state.versions = state.versions.filter((item) => item.id !== 'live'); return 'y'; }]);
  await assert.rejects(runCli(f.api, f.rl, async () => f.current), /Состояние версий изменилось/);
  assert.deepEqual(f.state.writes, []);
});

test('терминал сравнивает и сохраняет таблицу без опубликованной версии', async (t) => {
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  const f = fixture(['1', '1', '2', 'y']);
  f.state.versions = f.state.versions.filter((item) => item.id === 'draft');
  await runCli(f.api, f.rl, async () => { throw new Error('Магазин не должен запрашиваться'); }, async () => 'Язык | Текст\nru | Перевод');
  assert.deepEqual(f.state.writes, [{ id: 'target', text: 'Перевод' }]);
  assert.match(output.join('\n'), /Промпт для нейросети:[\s\S]*локализации: русский\./);
});

function runCli(api, rl, lookup, clipboard) { return runCliLanguage(api, rl, lookup, clipboard, 'ru'); }

for (const language of ['en', 'ru']) {
  test(`CLI interaction, prompt and cancellation remain localized (${language})`, async (t) => {
    const output = [];
    t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
    const f = fixture(['1', '1', '2', '']);
    await runCliLanguage(f.api, f.rl, async () => null, async () => 'Language | Text\nRussian | Translation', language);
    assert.deepEqual(f.state.writes, []);
    assert.match(output.join('\n'), language === 'en' ? /AI prompt:[\s\S]*Russian\.[\s\S]*Cancelled/ : /Промпт для нейросети:[\s\S]*русский\.[\s\S]*Отменено/);
    assert.match(f.state.prompts.at(-1), language === 'en' ? /To save, type y/ : /Для сохранения введите y/);
  });
}

test('CLI defaults to English and preserves stale-draft protection', async (t) => {
  const output = [];
  t.mock.method(console, 'log', (text) => output.push(text));
  const f = fixture(['1', '1', '', '', (state) => { state.text = 'changed'; return 'y'; }]);
  await assert.rejects(runCliLanguage(f.api, f.rl, async () => f.current), /Draft texts have changed/);
  assert.match(output.join('\n'), /Loading apps from App Store Connect/);
  assert.deepEqual(f.state.writes, []);
});
