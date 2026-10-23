// API of the local server (tools/serve.mjs) used by the Level Editor web build to read and write
// the project files. Only listens on this computer (serve.mjs binds 127.0.0.1 unless --lan).
//   GET  /api/ping                 → { ok, write } (write: false for other computers, see serve.mjs)
//   GET  /api/levels               → assets/gamecontent/content/cozy/levels.json
//   PUT  /api/levels   (JSON)      → writes it (the previous file is kept in temp/editor-backup/)
//   GET  /api/items                → every item manifest of the content index, as in the project now
//   PUT  /api/item/:id (JSON)      → writes that item's manifest; the open Cocos Creator (EF Bridge)
//                                    rebuilds the item prefab when it sees the file change
// After a write, an open Cocos Creator is told to refresh the file (asset database).
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONTENT = join(ROOT, 'assets/gamecontent/content/cozy');
const LEVELS = join(CONTENT, 'levels.json');
const BRIDGE = 'http://127.0.0.1:7461';
// backups stay out of assets/ (Cocos would import them as assets)
const BACKUP = join(ROOT, 'temp/editor-backup');
function backup(file, tag) {
  if (!existsSync(file)) return;
  mkdirSync(BACKUP, { recursive: true });
  copyFileSync(file, join(BACKUP, `${tag}-${new Date().toISOString().replace(/[:.]/g, '-')}-${basename(file)}`));
}

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, fail) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => ok(b)); req.on('error', fail); });
const bridge = (path, body) => fetch(BRIDGE + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json()).catch(() => null);
const refresh = url => bridge('/msg', { module: 'asset-db', message: 'refresh-asset', args: [url] });

export async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/ping') return send(res, 200, { ok: true, write: true });

  if (p === '/api/levels' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(readFileSync(LEVELS));
  }
  if (p === '/api/levels' && req.method === 'PUT') {
    const text = await readBody(req);
    const book = JSON.parse(text);                       // refuse anything that is not JSON
    if (!Array.isArray(book.chapters)) return send(res, 400, { error: 'not a level book (no chapters)' });
    backup(LEVELS, 'levels');
    writeFileSync(LEVELS, text);
    await refresh('db://assets/gamecontent/content/cozy/levels.json');
    return send(res, 200, { ok: true, version: book.version });
  }

  if (p === '/api/items' && req.method === 'GET') {
    const index = JSON.parse(readFileSync(join(CONTENT, 'assets/index.json'), 'utf8'));
    const out = [];
    for (const rel of Object.values(index.items || {})) { try { out.push(JSON.parse(readFileSync(join(CONTENT, rel), 'utf8'))); } catch { /* missing file */ } }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(out));
  }

  const m = p.match(/^\/api\/item\/(\d+)$/);
  if (m && req.method === 'PUT') {
    const id = Number(m[1]);
    const index = JSON.parse(readFileSync(join(CONTENT, 'assets/index.json'), 'utf8'));
    const rel = index.items?.[id];
    if (!rel) return send(res, 404, { error: `item ${id} not in the content index` });
    const manifest = JSON.parse(await readBody(req));
    if (manifest.id !== id) return send(res, 400, { error: 'id mismatch' });
    const file = join(CONTENT, rel);
    backup(file, 'item');
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    // the game reads item physics from the prefab: the EF Bridge extension rebuilds it when
    // Cocos Creator sees the manifest change (needs Cocos Creator open)
    const out = await refresh('db://assets/gamecontent/content/cozy/' + rel);
    return send(res, 200, { ok: true, prefab: out?.ok ? 'rebuilt' : 'Cocos Creator not open: open it and run tools/editor/item-prefabs.js for this item' });
  }

  send(res, 404, { error: 'unknown api ' + p });
}
