/* Assemble www/ — the exact set of files that ships inside the Android app.
 *
 * `vite build` emits three pages into dist/: the game (index.html), the Level
 * Editor (editor.html) and the Creative Tool (creative.html). Only the game
 * belongs in an APK — the other two are desktop tools for the team.
 * So www/ is dist/ minus those two pages and the chunks only they pull in.
 *
 * Which chunks those are is read out of the two built HTML files rather than
 * guessed from filenames: Vite hashes names and moves shared code into its own
 * chunk, so "starts with editor-" would be wrong the first time a chunk is
 * split differently.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const WWW = join(ROOT, 'www');

// Every local asset a built page references, transitively: a JS chunk imports
// other chunks, and those names appear nowhere in the HTML.
function assetsOf(htmlName) {
  const seen = new Set();
  const walk = (file, text) => {
    for (const [, rel] of text.matchAll(/["'(]\.?\/?(assets\/[A-Za-z0-9._-]+)["')]/g)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const full = join(DIST, rel);
      if (/\.(js|css)$/.test(rel)) walk(full, readFileSync(full, 'utf8'));
    }
  };
  walk(htmlName, readFileSync(join(DIST, htmlName), 'utf8'));
  return seen;
}

const game = assetsOf('index.html');
const TOOL_PAGES = ['editor.html', 'creative.html'];
const editorOnly = [...new Set(TOOL_PAGES.flatMap(p => [...assetsOf(p)]))].filter(a => !game.has(a));

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });
cpSync(DIST, WWW, {
  recursive: true,
  filter: src => {
    const rel = src.slice(DIST.length + 1);
    if (!rel) return true;
    if (TOOL_PAGES.includes(rel) || rel === '.DS_Store') return false;
    return !editorOnly.includes(rel);
  },
});

// Report the payload so an accidentally huge bundle is impossible to miss.
let bytes = 0, files = 0;
(function count(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? count(p) : (bytes += statSync(p).size, files++);
  }
})(WWW);
console.log(`www/ built — ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB (editor left out: ${editorOnly.join(', ') || 'none'})`);

// ---- Nội dung đóng gói ----
// App Android KHÔNG gọi mạng: chạy cứng bộ art cozy với levels.json + ảnh đóng gói ngay lúc
// build này (bản trong public/content của máy). Sửa level trên editor web xong thì "git pull"
// rồi đồng bộ lại để APK lấy bản mới nhất.
const cfgFile = join(WWW, 'content', 'config.json');
writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(readFileSync(cfgFile, 'utf8')), art: 'cozy' }, null, 2) + '\n');
// Level nhét thẳng vào index.html (window.__LEVELS_MAC_DINH): app mở là có level ngay từ code,
// không đọc file levels.json lúc chạy. Bản lấy là public/content/cozy/levels.json của máy.
const levels = readFileSync(join(ROOT, 'public', 'content', 'cozy', 'levels.json'), 'utf8');
const book = JSON.parse(levels);
const htmlFile = join(WWW, 'index.html');
let nhet = `<script>window.__LEVELS_MAC_DINH=${JSON.stringify(book).replace(/</g, '\\u003c')};</script>`;
// Dev Key AppsFlyer: đọc từ android/appsflyer.properties (ngoài git), chỉ bản Android mới có.
// Không có file thì app vẫn chạy, chỉ không gửi gì lên AppsFlyer (game/events.js).
let afKey = '';
try { afKey = (readFileSync(join(ROOT, 'android', 'appsflyer.properties'), 'utf8').match(/^\s*devKey\s*=\s*(\S+)/m) || [])[1] || ''; } catch {}
if (afKey) nhet += `<script>window.__AF_DEV_KEY=${JSON.stringify(afKey)};</script>`;
else console.warn('!!! Không thấy android/appsflyer.properties (devKey=…): bản này KHÔNG gửi dữ liệu AppsFlyer');
writeFileSync(htmlFile, readFileSync(htmlFile, 'utf8').replace('<head>', '<head>' + nhet));
const soLevel = (book.chapters || []).reduce((n, c) => n + (c.levels?.length || 0), 0);
console.log(`\n>>> App Android: bộ art COZY, ${soLevel} level nhét sẵn trong code, không tải gì từ GitHub · AppsFlyer ${afKey ? 'có Dev Key' : 'KHÔNG có Dev Key'}`);

// Máy còn thiếu commit nội dung (đổi bộ art, sửa level) từ GitHub thì cảnh báo
try {
  execSync('git fetch -q origin', { cwd: ROOT, stdio: 'ignore', timeout: 15000 });
  const thieu = execSync('git log --oneline HEAD..origin/main -- public/content', { cwd: ROOT, encoding: 'utf8' }).trim();
  if (thieu) {
    console.warn(`\n!!! Máy đang THIẾU ${thieu.split('\n').length} commit nội dung trên GitHub (bộ art / level); level đóng gói vào APK sẽ cũ:`);
    console.warn(thieu.split('\n').slice(0, 8).map(l => '    ' + l).join('\n'));
    console.warn('    Chạy "git pull" rồi đồng bộ lại để APK lấy bản mới nhất.\n');
  }
} catch { /* không có mạng hoặc không có git: bỏ qua, chỉ là cảnh báo */ }
