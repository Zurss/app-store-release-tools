import { AsyncLocalStorage } from 'node:async_hooks';
import { translate } from '../public/i18n.js';

const context = new AsyncLocalStorage();
export const getLanguage = () => context.getStore() ?? 'en';
export const withLanguage = (language, callback) => context.run(language === 'ru' ? 'ru' : 'en', callback);
export const t = (key, params) => translate(getLanguage(), key, params);
export class AppError extends Error {
  constructor(key, params = {}) {
    super(t(key, params));
    this.language = getLanguage();
    this.key = key;
    this.params = params;
  }
}
export const errorData = (error) => error instanceof AppError
  ? { error: t(error.key, error.params), errorKey: error.key, errorParams: error.params }
  : { error: error.message };
