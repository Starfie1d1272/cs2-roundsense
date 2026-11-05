import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/hud.css', ['hud.css', 'text/css; charset=utf-8']],
  ['/hud.js', ['hud.js', 'text/javascript; charset=utf-8']],
  ['/fixtures.js', ['fixtures.js', 'text/javascript; charset=utf-8']],
]);
const port = Number(process.env.ROUNDSENSE_PREVIEW_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ROUNDSENSE_PREVIEW_PORT');
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const route = files.get(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500).end();
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`RoundSense HUD design preview: http://127.0.0.1:${port}`));
