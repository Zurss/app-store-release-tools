import { spawn } from 'node:child_process';
import { AppStoreApi, loadConfig } from './api.js';
import { createWebServer } from './web-server.js';

try {
  const api = new AppStoreApi(await loadConfig());
  const server = createWebServer(api, undefined, (message) => console.log(`[${new Date().toLocaleTimeString('ru-RU', { hour12: false })}] ${message}`));
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`Откройте в браузере: ${url}\nЧтобы остановить, нажмите Ctrl+C.`);
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => {});
  });
  server.on('error', (error) => { console.error(`Ошибка сервера: ${error.message}`); process.exitCode = 1; });
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
}
