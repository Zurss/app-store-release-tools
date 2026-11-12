import test from 'node:test';
import assert from 'node:assert/strict';
import { diffText } from '../public/diff.js';

const text = (parts) => parts.map((part) => part.text).join('');
const changed = (parts) => parts.filter((part) => part.changed).map((part) => part.text).join('');

test('подсвечивает только изменённые слова', () => {
  const diff = diffText('Train your maths skills!', 'Train your math skills!');
  assert.equal(changed(diff.before), 'maths');
  assert.equal(changed(diff.after), 'math');
  assert.equal(text(diff.before), 'Train your maths skills!');
  assert.equal(text(diff.after), 'Train your math skills!');
});

test('сохраняет точный текст и сравнивает разные письменности', () => {
  const cases = [
    ['我们添加了新关卡。', '我們添加了新關卡。'],
    ['استمتع باللعبة ونمِّ مهاراتك!', 'استمتع باللعبة وطوّر مهاراتك!'],
    ['Ми додали нові рівні.', 'Мы добавили новые уровни.'],
    ['', 'Новый текст'],
    ['Один\nдва  три', 'Один\nтри'],
  ];
  for (const [before, after] of cases) {
    const diff = diffText(before, after);
    assert.equal(text(diff.before), before);
    assert.equal(text(diff.after), after);
    assert.ok(diff.before.some((part) => part.changed) || diff.after.some((part) => part.changed));
  }
});

test('не подсвечивает совпадающий текст', () => {
  const value = '新しいレベル 😊\nأهلاً';
  const diff = diffText(value, value);
  assert.equal(text(diff.before), value);
  assert.equal(text(diff.after), value);
  assert.equal(changed(diff.before), '');
  assert.equal(changed(diff.after), '');
});

test('ограничивает память при сравнении очень длинных текстов', () => {
  const Original = globalThis.Uint16Array;
  globalThis.Uint16Array = class extends Original {
    constructor(size) {
      if (size > 2_000_000) throw new Error('Слишком большая матрица');
      super(size);
    }
  };
  try {
    const before = `Начало ${'старый '.repeat(1200)}конец`;
    const after = `Начало ${'новый '.repeat(1200)}конец`;
    const diff = diffText(before, after);
    assert.equal(text(diff.before), before);
    assert.equal(text(diff.after), after);
    assert.equal(diff.before[0].changed, false);
    assert.equal(diff.after.at(-1).changed, false);
    assert.equal(diff.approximate, true);
  } finally {
    globalThis.Uint16Array = Original;
  }
});

test('очень длинные тексты сохраняются целиком при упрощённой подсветке', () => {
  const before = 'а'.repeat(25_000);
  const after = 'б'.repeat(25_000);
  const diff = diffText(before, after);
  assert.equal(text(diff.before), before);
  assert.equal(text(diff.after), after);
  assert.equal(changed(diff.before), before);
  assert.equal(changed(diff.after), after);
  assert.equal(diff.approximate, true);
  assert.equal(changed(diffText(before, before).before), '');
});
