// Sync game content (levels, item / bag / background images, UI icons) from the web game
// repo into the Cocos project. Run again whenever the Level Editor exports a new levels.json or
// art is added:
//   node tools/sync-content.mjs                 (web repo defaults to ../snug)
//   GAME=/path/to/web/repo node tools/sync-content.mjs
//
//   snug/public/content/cozy  → assets/gamecontent/content/cozy (asset bundle "content", loaded per level)
//   snug/public/ui            → assets/resources/uiart                   (UI prefabs reference it; runtime loads e.g. uiart/icons/star-off)
//
// Only new or changed files are copied; existing .meta files are kept (same uuids, prefabs keep
// their references). Files deleted at the source are deleted here together with their .meta,
// except the Cocos-only folders in KEEP (uiart/generated).
// If the editor is open with EF Bridge enabled, it is told to refresh the asset database.
import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = process.env.GAME || resolve(ROOT, '../snug');
// Since 2026-10-23 this Cocos project is the source of the game content (levels and item data are
// edited with its own Level Editor): from the web repo only NEW files are taken (new art), nothing
// is overwritten or deleted there. UI art still follows the web repo. Audio is the Cocos project's
// own since 2026-10-28 (the sound designer's set): never synced, the web files are older.
const PAIRS = [
  [join(GAME, 'public/content/cozy'), join(ROOT, 'assets/gamecontent/content/cozy'), { addOnly: true }],
  [join(GAME, 'public/ui'), join(ROOT, 'assets/resources/uiart')],
];

let added = 0, changed = 0, removed = 0;
// Folders that exist only in the Cocos project (never deleted even though the web side lacks them):
//   generated  SVG icons rasterised for the UI prefabs (tools/web-ui/import-dump.mjs)
const KEEP = new Set(['generated']);
const same = (a, b) => statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));

function copyDir(src, dst, opts = {}) {
  mkdirSync(dst, { recursive: true });
  const seen = new Set();
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const a = join(src, name), b = join(dst, name);
    seen.add(name);
    if (statSync(a).isDirectory()) { copyDir(a, b, opts); continue; }
    if (!existsSync(b)) { copyFileSync(a, b); added++; }
    else if (!opts.addOnly && !same(a, b)) { copyFileSync(a, b); changed++; }
  }
  if (opts.addOnly) return;
  for (const name of readdirSync(dst)) {
    if (name.endsWith('.meta') || seen.has(name)) continue;
    if (KEEP.has(name)) continue;   // made in the Cocos project, not copies of web files
    rmSync(join(dst, name), { recursive: true, force: true });
    rmSync(join(dst, name + '.meta'), { force: true });
    removed++;
  }
}

for (const [a, b, opts] of PAIRS) {
  if (!existsSync(a)) { console.warn('missing', a); continue; }
  copyDir(a, b, opts);
}
console.log(`sync done: ${added} added, ${changed} changed, ${removed} removed`);
// bag frames are drawn over the items: drop the print grain inside the bags (tools/clean-bag-frames.py)
if (added || changed) execFileSync('python3', [join(ROOT, 'tools/clean-bag-frames.py')], { stdio: 'inherit' });

try {
  const r = await fetch('http://127.0.0.1:7461/msg', { method: 'POST', body: JSON.stringify({ module: 'asset-db', message: 'refresh-asset', args: ['db://assets'] }) });
  console.log('editor:', (await r.json()).ok ? 'asset database refreshed' : 'refresh failed');
} catch { console.log('editor not open; Cocos imports on next open'); }
