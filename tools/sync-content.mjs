// Sync game content (levels, item / bag / background images, UI icons, audio) from the web game
// repo into the Cocos project. Run again whenever the Level Editor exports a new levels.json or
// art is added:
//   node tools/sync-content.mjs                 (web repo defaults to ../snug)
//   GAME=/path/to/web/repo node tools/sync-content.mjs
//
//   snug/public/content/cozy  → assets/resources/content/cozy   (loaded on demand via resources.load)
//   snug/public/audio         → assets/resources/audio
//   snug/public/ui            → assets/art/ui                   (referenced directly by UI prefabs)
//
// Only new or changed files are copied; existing .meta files are kept (same uuids, prefabs keep
// their references). Files deleted at the source are deleted here together with their .meta.
// If the editor is open with EF Bridge enabled, it is told to refresh the asset database.
import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = process.env.GAME || resolve(ROOT, '../snug');
const PAIRS = [
  [join(GAME, 'public/content/cozy'), join(ROOT, 'assets/resources/content/cozy')],
  [join(GAME, 'public/audio'), join(ROOT, 'assets/resources/audio')],
  [join(GAME, 'public/ui'), join(ROOT, 'assets/art/ui')],
];

let added = 0, changed = 0, removed = 0;
const same = (a, b) => statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  const seen = new Set();
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const a = join(src, name), b = join(dst, name);
    seen.add(name);
    if (statSync(a).isDirectory()) { copyDir(a, b); continue; }
    if (!existsSync(b)) { copyFileSync(a, b); added++; }
    else if (!same(a, b)) { copyFileSync(a, b); changed++; }
  }
  for (const name of readdirSync(dst)) {
    if (name.endsWith('.meta') || seen.has(name)) continue;
    rmSync(join(dst, name), { recursive: true, force: true });
    rmSync(join(dst, name + '.meta'), { force: true });
    removed++;
  }
}

for (const [a, b] of PAIRS) {
  if (!existsSync(a)) { console.warn('missing', a); continue; }
  copyDir(a, b);
}
console.log(`sync done: ${added} added, ${changed} changed, ${removed} removed`);

try {
  const r = await fetch('http://127.0.0.1:7461/msg', { method: 'POST', body: JSON.stringify({ module: 'asset-db', message: 'refresh-asset', args: ['db://assets'] }) });
  console.log('editor:', (await r.json()).ok ? 'asset database refreshed' : 'refresh failed');
} catch { console.log('editor not open; Cocos imports on next open'); }
