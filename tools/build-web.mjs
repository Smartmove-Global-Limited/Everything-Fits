// Build a web version through the open Cocos Creator (EF Bridge), like the Build panel. Serve it
// with tools/serve.mjs — a Cocos web build does not run from file:// (index.html shows a blank page).
//   node tools/build-web.mjs           the game (web-mobile: Main.scene start, Game.scene) → build/web-mobile
//   node tools/build-web.mjs editor    the Level Editor (web-desktop, Editor.scene)       → build/web-editor
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const msg = (module, message, args = []) => fetch('http://127.0.0.1:7461/msg', { method: 'POST', body: JSON.stringify({ module, message, args }) }).then(r => r.json());
const done = async () => { try { return (JSON.stringify((await msg('builder', 'query-tasks-info')).result).match(/build success/g) || []).length; } catch { return -1; } };

const which = process.argv[2] === 'editor' ? 'web-editor-build' : 'web-build';
const cfg = JSON.parse(readFileSync(`${ROOT}tools/${which}.json`, 'utf8'));
const before = await done();
// add-task answers only when Cocos Creator is free (it can take minutes while it imports): do not
// wait for the answer, watch the task list instead
msg('builder', 'add-task', [cfg]).catch(() => {});
console.log(`building ${cfg.platform}…`);
for (let i = 0; (await done()) <= before; i++) {
  if (i > 600) { console.error('build did not finish in 20 minutes: see the Build panel'); process.exit(1); }
  await new Promise(r => setTimeout(r, 2000));
}
console.log(`done: ${ROOT}build/${cfg.outputName}`);
