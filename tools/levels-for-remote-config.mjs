// The levels.json shipped in the game, minified for the Firebase Remote Config key "levels"
// (type JSON). Prints the size and writes build/levels.remote-config.json to paste in.
//   node tools/levels-for-remote-config.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const book = JSON.parse(readFileSync(`${ROOT}assets/gamecontent/content/cozy/levels.json`, 'utf8'));
const text = JSON.stringify(book);
mkdirSync(`${ROOT}build`, { recursive: true });
const out = `${ROOT}build/levels.remote-config.json`;
writeFileSync(out, text);
const levels = book.chapters.reduce((n, c) => n + c.levels.length, 0);
console.log(`levels v${book.version}: ${levels} levels, ${(text.length / 1024).toFixed(1)} KB → ${out}`);
