// Build the web version (web-mobile: Main.scene start, Game.scene) through the open Cocos Creator
// (EF Bridge), like the Build panel. Output: build/web-mobile. Serve it with tools/serve.mjs —
// a Cocos web build does not run from file:// (double-clicking index.html shows a blank page).
//   node tools/build-web.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const msg = (module, message, args = []) => fetch('http://127.0.0.1:7461/msg', { method: 'POST', body: JSON.stringify({ module, message, args }) }).then(r => r.json());
const done = async () => (JSON.stringify((await msg('builder', 'query-tasks-info')).result).match(/build success/g) || []).length;

const cfg = JSON.parse(readFileSync(`${ROOT}tools/web-build.json`, 'utf8'));
const before = await done();
await msg('builder', 'add-task', [cfg]);
console.log(`building ${cfg.platform}…`);
for (let i = 0; (await done()) <= before; i++) {
  if (i > 600) { console.error('build did not finish in 20 minutes: see the Build panel'); process.exit(1); }
  await new Promise(r => setTimeout(r, 2000));
}
console.log(`done: ${ROOT}build/${cfg.outputName}`);
