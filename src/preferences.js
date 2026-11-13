import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError, withLanguage } from './i18n.js';

export const preferencesPath = new URL('../.release-tools-preferences.json', import.meta.url);
export const isLanguage = (value) => value === 'en' || value === 'ru';

export async function readLanguage(path = preferencesPath) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return isLanguage(value?.language) ? value.language : 'en';
  } catch {
    return 'en';
  }
}

export async function saveLanguage(language, path = preferencesPath) {
  if (!isLanguage(language)) throw new AppError('invalidLanguage');
  const temp = typeof path === 'string' ? `${path}.${randomUUID()}.tmp` : new URL(`${path.href}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify({ language }) + '\n', { mode: 0o600 });
    await rename(temp, path);
  } catch {
    await unlink(temp).catch(() => {});
    throw new AppError('preferencesWrite');
  }
  return language;
}

export async function configureLanguage(args = [], path = preferencesPath) {
  const previous = await readLanguage(path);
  return withLanguage(previous, async () => {
    if (!args.length) return previous;
    if (args.length !== 2 || args[0] !== '--lang' || !isLanguage(args[1])) throw new AppError('invalidLanguage');
    return withLanguage(args[1], () => saveLanguage(args[1], path));
  });
}
