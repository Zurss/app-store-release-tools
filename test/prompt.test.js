import test from 'node:test';
import assert from 'node:assert/strict';
import { makePrompt as makePromptLanguage } from '../public/prompt.js';

test('промпт использует только понятные названия языков', () => {
  const prompt = makePrompt(['en-US', 'fr-FR', 'fr-CA']);
  assert.match(prompt, /английский \(США\), французский, французский \(Канада\)/);
  assert.doesNotMatch(prompt, /en-US|fr-FR|fr-CA/);
});

test('промпт не выдаёт неизвестные или неоднозначные названия', () => {
  for (const locales of [['zz'], ['fr', 'fr-FR'], ['fr']]) {
    assert.throws(() => makePrompt(locales), /Не удалось однозначно определить названия языков/);
  }
});

function makePrompt(locales) { return makePromptLanguage(locales, 'ru'); }
