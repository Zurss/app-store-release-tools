import { spawn } from 'node:child_process';
import { AppStoreApi, loadConfig } from './api.js';
import { createWebServer } from './web-server.js';
import { configureLanguage, readLanguage } from './preferences.js';
import { t, withLanguage } from './i18n.js';

let language = await readLanguage();
try {
  language = await configureLanguage(process.argv.slice(2));
  await withLanguage(language, async () => {
    const api = new AppStoreApi(await loadConfig());
    const server = createWebServer(api, undefined, (message) => console.log(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`));
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      console.log(t('openBrowser', { url }));
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
      const child = spawn(command, args, { stdio: 'ignore' });
      child.on('error', () => {});
    });
    server.on('error', (error) => { console.error(t('serverError', { message: error.message })); process.exitCode = 1; });
  });
} catch (error) {
  withLanguage(language, () => console.error(t('error', { message: error.message })));
  process.exitCode = 1;
}
