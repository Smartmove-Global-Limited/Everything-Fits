'use strict';
// Editor control port for external tools. Listens on 127.0.0.1:7461 ONLY.
//   POST /msg    {"module","message","args":[...]}  → Editor.Message.request(module, message, ...args)
//   POST /scene  {"method","args":[...]}           → call a method of scene.js (scene process, has cc)
//   POST /main   {"code"}                           → run code in the editor main process (Editor available)
//   GET  /log                                       → recent editor console lines
// Also: when an item manifest (assets/gamecontent/content/cozy/assets/<chapter>/items/<id>.json)
// changes — saved by the Level Editor or copied over by hand — the item prefab is rebuilt with
// tools/editor/item-prefabs.js, so the game uses the new size / physics.
const http = require('http');
let server = null;
const logLines = [];
function record(kind, args) {
  try { logLines.push({ t: Date.now(), kind, msg: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') }); } catch { }
  if (logLines.length > 300) logLines.shift();
}
function readBody(req) { return new Promise((ok, fail) => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { fail(e); } }); }); }
function reply(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }

exports.load = function () {
  server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url.startsWith('/log')) return reply(res, 200, logLines.slice(-120));
      if (req.method !== 'POST') return reply(res, 404, { error: 'POST /msg, /scene, /main; GET /log' });
      const body = await readBody(req);
      if (req.url === '/msg') return reply(res, 200, { ok: true, result: await Editor.Message.request(body.module, body.message, ...(body.args || [])) });
      if (req.url === '/scene') return reply(res, 200, { ok: true, result: await Editor.Message.request('scene', 'execute-scene-script', { name: 'ef-bridge', method: body.method, args: body.args || [] }) });
      if (req.url === '/main') { const fn = new Function('Editor', 'require', `return (async () => { ${body.code} })();`); return reply(res, 200, { ok: true, result: await fn(Editor, require) }); }
      reply(res, 404, { error: 'unknown route' });
    } catch (e) { record('error', [String(e && e.stack || e)]); reply(res, 500, { ok: false, error: String(e && e.stack || e) }); }
  });
  server.listen(7461, '127.0.0.1', () => console.log('[ef-bridge] listening on 127.0.0.1:7461'));
  server.on('error', e => console.error('[ef-bridge]', e));
  for (const kind of ['log', 'warn', 'error']) {
    const orig = console[kind];
    console[kind] = function (...a) { record(kind, a); return orig.apply(console, a); };
  }
};
exports.unload = function () { if (server) server.close(); server = null; };
// ---- item manifest changed → rebuild its prefab (batched, after the import settles) ----
const fs = require('fs'), path = require('path');
const ITEM_JSON = /\/gamecontent\/content\/cozy\/assets\/[^/]+\/items\/(\d+)\.json$/;
const pending = new Set();
let timer = null;
async function rebuildPending() {
  const ids = [...pending]; pending.clear(); timer = null;
  if (!ids.length) return;
  try {
    const script = fs.readFileSync(path.join(Editor.Project.path, 'tools/editor/item-prefabs.js'), 'utf8');
    const code = `const args = ${JSON.stringify({ ids })};\n` + script;
    await Editor.Message.request('scene', 'execute-scene-script', { name: 'ef-bridge', method: 'chay', args: [code] });
    console.log('[ef-bridge] rebuilt item prefab(s)', ids.join(', '));
  } catch (e) { console.error('[ef-bridge] item prefab rebuild failed', ids, e); }
}
exports.methods = {
  onAssetChange(uuid, info) {
    const m = String(info && (info.url || info.source) || '').match(ITEM_JSON);
    if (!m) return;
    pending.add(Number(m[1]));
    clearTimeout(timer); timer = setTimeout(rebuildPending, 800);
  },
};
