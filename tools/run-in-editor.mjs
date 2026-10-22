// Run a script inside the open Cocos editor's scene process (through the EF Bridge extension).
//   node tools/run-in-editor.mjs tools/editor/<script>.js [jsonArgs]
// The script file is the BODY of an async function receiving (cc, Editor, args); its return value
// is printed as JSON.
import { readFileSync } from 'node:fs';
const [file, argJson] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/run-in-editor.mjs <script.js> [jsonArgs]'); process.exit(1); }
const body = readFileSync(file, 'utf8');
const args = argJson ? JSON.parse(argJson) : null;
const code = `const args = ${JSON.stringify(args)};\n${body}`;
const res = await fetch('http://127.0.0.1:7461/scene', { method: 'POST', body: JSON.stringify({ method: 'chay', args: [code] }) });
const out = await res.json();
if (!out.ok) { console.error(out.error || out.loi); process.exit(1); }
console.log(JSON.stringify(out.result ?? out.kq, null, 2));
