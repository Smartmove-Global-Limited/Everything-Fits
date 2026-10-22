// Turn a web UI dump (tools/web-ui/dumps/<name>.json) into a Cocos prefab:
//   1. rasterised SVGs in the dump are written to assets/resources/uiart/generated/<name>-<n>.png
//   2. the editor imports them, then tools/editor/build-ui.js builds the prefab
//      assets/resources/ui/<prefab>.prefab from the dump.
// Usage: node tools/web-ui/import-dump.mjs <dumpName> <prefabName> [ControllerComponent]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [name, prefab, component] = process.argv.slice(2);
if (!name || !prefab) { console.error('usage: import-dump.mjs <dumpName> <prefabName>'); process.exit(1); }
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dump = JSON.parse(readFileSync(`${ROOT}tools/web-ui/dumps/${name}.json`, 'utf8'));
mkdirSync(`${ROOT}assets/resources/uiart/generated`, { recursive: true });
let n = 0;
(function pull(node) {
  if (node.svgPng) {
    const file = `generated/${prefab}-${n++}.png`;
    writeFileSync(`${ROOT}assets/resources/uiart/${file}`, Buffer.from(node.svgPng.split(',')[1], 'base64'));
    delete node.svgPng; node.src = './ui/' + file;
  }
  for (const c of node.children || []) pull(c);
})(dump.tree);
writeFileSync(`${ROOT}tools/web-ui/dumps/${name}.processed.json`, JSON.stringify(dump));
const post = (path, body) => fetch('http://127.0.0.1:7461' + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
await post('/msg', { module: 'asset-db', message: 'refresh-asset', args: ['db://assets/resources/uiart'] });
await new Promise(r => setTimeout(r, 1500));
const code = `const args = ${JSON.stringify({ dump: `tools/web-ui/dumps/${name}.processed.json`, prefab, component })};\n` + readFileSync(`${ROOT}tools/editor/build-ui.js`, 'utf8');
const out = await post('/scene', { method: 'chay', args: [code] });
if (!out.ok) { console.error(out.error || out.loi); process.exit(1); }
console.log(JSON.stringify(out.result ?? out.kq, null, 1));
