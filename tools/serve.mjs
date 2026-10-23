// Local server for the web builds of the Cocos project:
//   /           the game          (build/web-mobile, tools/build-web.mjs)
//   /editor/    the Level Editor  (build/web-editor)
//   /api/...    what the Editor saves into the project (see API below)
// A Cocos web build must be served over http: opening index.html from the disk shows a blank page.
//   node tools/serve.mjs            http://localhost:8088   (this computer only)
//   node tools/serve.mjs --lan      also reachable from phones / computers on the same wifi (read only for them)
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT) || 8088;
const LAN = process.argv.includes('--lan');
const SITES = [['/editor/', join(ROOT, 'build/web-editor')], ['/', join(ROOT, 'build/web-mobile')]];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream',
};

/** Editor API, registered by tools/editor-api.mjs when present */
let api = null;
try { api = (await import('./editor-api.mjs')).handle; } catch { /* the game only */ }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      if (!api) { res.writeHead(404); return res.end('no editor api'); }
      // other computers on the wifi (--lan) read the project but never write into it: their
      // editor keeps edits in its draft and hands them over with "Tải JSON"
      const local = /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');
      if (!local && req.method !== 'GET') { res.writeHead(403); return res.end('read only from other computers'); }
      if (!local && url.pathname === '/api/ping') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"write":false}'); }
      return await api(req, res, url);
    }
    const [prefix, dir] = SITES.find(([p]) => url.pathname.startsWith(p));
    if (url.pathname === prefix.slice(0, -1)) { res.writeHead(302, { location: prefix }); return res.end(); }
    let file = normalize(join(dir, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); return res.end(`not found (build it first: ${prefix === '/' ? 'node tools/build-web.mjs' : 'node tools/build-web.mjs editor'})`); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message || e));
  }
});

server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`game    http://localhost:${PORT}/`);
  console.log(`editor  http://localhost:${PORT}/editor/`);
  if (LAN) for (const list of Object.values(networkInterfaces())) for (const a of list || [])
    if (a.family === 'IPv4' && !a.internal) console.log(`phones on the same wifi: http://${a.address}:${PORT}/`);
});
