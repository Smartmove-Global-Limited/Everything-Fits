// Level Editor: điều phối tab, level hiện tại, live preview (iframe game), bảng đo, lưu content.
import { ITEM_DEFS, defById } from '../data/items.js';
import { loadBook, loadItemManifests, loadBackgrounds, loadBags, saveContent, whenSpriteReady, setAssetChapter, setArtStyle, artStyle, loadConfig, saveConfig, soThuTuLevel } from '../content/loader.js';
import { sceneOptions, BAG_KINDS, BAG_SKINS } from '../art/scene-registry.js';
import { isFixedSkin, placeFixed, maxScale, MIN_SCALE, resolveContainer } from '../data/bag.js';
import { itemArea } from '../game/physics.js';
import { difficulty } from '../gen/difficulty.js';
import { solve } from '../gen/solver.js';
import { pointInPolygon } from '../util/geom.js';
import { initDraw } from './draw.js';
import { initGenerate } from './generate.js';
import { initPool } from './pool.js';
import { initManage, nextLevelId } from './manage.js';
import * as gh from './github.js';

const $ = id => document.getElementById(id);

// Trình duyệt tự điền lại ô nhập khi tải lại trang, khớp theo THỨ TỰ ô trong trang. Thêm một ô
// mới là thứ tự lệch, giá trị cũ rơi nhầm chỗ: số giây 120 từng rơi vào ô tìm kho đồ, lọc
// sạch món nào cũng không khớp. Mọi ô của editor đều nạp từ dữ liệu level, nên tắt hẳn.
for (const el of document.querySelectorAll('input, select, textarea')) el.autocomplete = 'off';

// Bộ art đang sửa: ?art=casual. Mỗi bộ có level, ảnh và mục lục riêng nên đổi bộ là mở lại
// trang, không trộn hai bộ trong một phiên.
setArtStyle(new URLSearchParams(location.search).get('art') || 'cozy');
/** Cho thấy rõ đang sửa bộ nào (màu thanh trên, nút Lưu) và game đang chạy bộ nào */
function veBoArt() {
  for (const b of $('artSeg').children) b.classList.toggle('on', b.dataset.art === artStyle());
  $('artTag').textContent = artStyle().toUpperCase();
  document.body.dataset.editArt = artStyle();
  $('gameArt').textContent = E.liveArt.toUpperCase();
  $('gameArt').dataset.art = E.liveArt;
  const khac = E.liveArt !== artStyle();
  $('useArtBtn').hidden = !khac;
  $('useArtBtn').textContent = `Cho game chạy ${artStyle().toUpperCase()}`;
}
$('artSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.dataset.art === artStyle()) return;
  if (!$('dirtyDot').hidden && !confirm('Level đang sửa chưa lưu. Vẫn đổi bộ art?')) return;
  const u = new URL(location.href);
  u.searchParams.set('art', b.dataset.art);
  location.href = u.toString();
});
// Đổi bộ art của game: ghi config.json NGAY, không chờ bấm Lưu level
$('useArtBtn').addEventListener('click', async () => {
  const art = artStyle(), btn = $('useArtBtn');
  if (!canWrite && !gh.hasToken()) return status('Chưa nối GitHub — bấm nút 🔑 để dán token', 'bad');
  btn.disabled = true;
  try {
    const cfg = { ...(E.config || {}), art };
    if (canWrite) await saveConfig(cfg); else await gh.putConfig(cfg);
    E.config = cfg; E.liveArt = art; veBoArt();
    if (canWrite) status(`Game đã chuyển sang ${art.toUpperCase()}. Tải lại trang game là thấy.`, 'ok');
    else theoDoiWeb(`Game chuyển sang ${art.toUpperCase()}`, async () => (await docWeb('config.json'))?.art === art);
  } catch (e) { status('Lỗi đổi bộ art: ' + e.message, 'bad'); }
  finally { btn.disabled = false; }
});

/** Đọc một file nội dung đang chạy trên chính trang web này, bỏ qua cache */
async function docWeb(path) {
  try { const r = await fetch(`./content/${path}?t=${Date.now()}`, { cache: 'no-store' }); return r.ok ? r.json() : null; }
  catch { return null; }
}
/**
 * Trên web, commit xong GitHub còn phải build và deploy lại (thường 1–2 phút) thì người chơi
 * mới thấy. Không báo gì là người ta tưởng hỏng rồi bấm lại. Dò chính trang web mỗi 5 giây,
 * hiện đồng hồ chờ, tới khi thấy bản mới thì báo xong.
 */
let dongHoWeb = 0;
function theoDoiWeb(viec, daXong) {
  clearInterval(dongHoWeb);
  const el = $('webSync'), t0 = Date.now();
  el.hidden = false; el.className = 'websync wait';
  const ve = () => { el.textContent = `⏳ ${viec}: đang đưa lên web… ${Math.round((Date.now() - t0) / 1000)}s`; };
  ve();
  let dangDo = false;
  dongHoWeb = setInterval(async () => {
    ve();
    if (dangDo) return; dangDo = true;
    const ok = await daXong(); dangDo = false;
    if (ok) {
      clearInterval(dongHoWeb);
      el.className = 'websync ok'; el.textContent = `✅ ${viec}: web đã cập nhật, tải lại trang game là thấy`;
      setTimeout(() => { el.hidden = true; }, 12000);
    } else if (Date.now() - t0 > 240000) {
      clearInterval(dongHoWeb);
      el.className = 'websync bad'; el.textContent = `⚠️ ${viec}: sau 4 phút web vẫn chưa cập nhật — xem tab Actions trên GitHub`;
    }
  }, 5000);
}

const areaCache = new Map();
export const areaOf = id => { if (!areaCache.has(id)) { const d = defById(id); areaCache.set(id, d ? itemArea(d) : 0); } return areaCache.get(id); };
export const clearAreaCache = () => areaCache.clear();

// liveArt: bộ art game đang chạy (config.json)
export const E = { mapId: null, book: null, map: null, level: null, previewReady: false, liveArt: 'cozy' };

// ---------- status ----------
export function status(text, cls = '', ms = 3000) { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; if (text) setTimeout(() => { if (s.textContent === text) s.textContent = ''; }, ms); }

// ---------- level model ----------
export function blankLevel(id) {
  return {
    id, timer: 90, background: 'vanity',
    container: { skin: 'backpack', cx: 210, bottom: 404, shape: [[-127, -220], [127, -220], [127, 0], [-127, 0]], blocks: [] },
    mode: 'fixed', items: [], reward: { coin: 20 }, background: 1,
  };
}
const clone = o => JSON.parse(JSON.stringify(o));

let draw, gen, pool;
/**
 * Túi dáng cố định: hình lòng túi và chỗ đặt túi luôn tính lại từ ảnh túi hiện có, để level
 * dựng từ bản ảnh cũ (hay chưa từng có cỡ) khớp đúng túi đang vẽ.
 */
function dongBoTui(level) {
  const sk = BAG_SKINS[level.container?.skin];
  // Đổi sang túi khác thì cỡ cũ có thể quá to với túi mới (túi bè ngang, túi cao): kẹp lại
  if (isFixedSkin(sk)) level.container = placeFixed(level.container, sk, Math.min(maxScale(sk), Math.max(MIN_SCALE, level.container.scale || 1)));
}

export function setLevel(level, { keepId = false } = {}) {
  if (keepId && E.level) level.id = E.level.id;
  dongBoTui(level);
  E.level = level;
  draw?.syncBagUi();
  veSoLevel(); $('lvTimer').value = level.timer || 90;
  refreshPickers();
  $('lvCoin').value = level.reward?.coin ?? 20;
  veCoDo();
  onChange();
}
/** Thanh "Cỡ đồ": cỡ chung của mọi món trong level (level.itemScale), 1 thì không ghi vào file */
function veCoDo() { const v = Math.round((Number(E.level?.itemScale) || 1) * 100); $('itemScale').value = $('itemScaleNum').value = v; }
function datCoDo(pct) {
  const v = Math.min(150, Math.max(50, Math.round(pct || 100)));
  if (v === 100) delete E.level.itemScale; else E.level.itemScale = v / 100;
  veCoDo(); onChange();
}
$('itemScale').addEventListener('input', e => datCoDo(+e.target.value));
$('itemScaleNum').addEventListener('change', e => datCoDo(+e.target.value));
$('itemScaleReset').addEventListener('click', () => datCoDo(100));
/** Gọi sau mỗi thay đổi: vẽ lại, đo lại, đẩy preview */
export function onChange() {
  draw?.render();
  metrics();
  pushPreview();
  markDirty();
}

/**
 * Báo level đang sửa đã khác bản đã lưu hay chưa.
 * Khung Xem thử hiện ngay thứ đang sửa, còn game đọc từ file, nên không có dấu này
 * rất dễ tưởng đã lưu rồi.
 */
// ---------- sửa nhiều level, lưu một lần ----------
// E.level là bản chép riêng của level đang mở. Chuyển sang level / chương khác thì chép nó trả
// về đúng chỗ trong E.book trước (luuTam), nên sửa level 3 rồi sang 4, 5, 6 vẫn giữ đủ cả bốn;
// bấm Lưu một lần là ghi hết. GOC là bản đã lưu (lúc tải hoặc lần lưu gần nhất) để biết level
// nào đã sửa: so bằng JSON, level chưa có trong GOC là level mới.
let GOC = new Map();                 // id level → JSON bản đã lưu
const DA_SUA = new Set();            // level KHÁC level đang mở đã sửa mà chưa lưu
function chupGoc() {
  GOC = new Map();
  for (const c of E.book?.chapters || []) for (const lv of c.levels) GOC.set(lv.id, JSON.stringify(lv));
  DA_SUA.clear();
}
function daSua(id) {
  if (id === E.level?.id) return GOC.get(id) !== JSON.stringify(E.level);
  return DA_SUA.has(id);
}
/** Chép level đang sửa về chỗ của nó trong chương (chỉ cập nhật, không thêm level đã bị xoá) */
function luuTam() {
  if (!E.level || !E.map) return;
  const i = E.map.levels.findIndex(l => l.id === E.level.id);
  if (i < 0) return;
  E.map.levels[i] = clone(E.level);
  if (GOC.get(E.level.id) !== JSON.stringify(E.level)) DA_SUA.add(E.level.id); else DA_SUA.delete(E.level.id);
}
/**
 * Mở một level từ chương: setLevel tự chuẩn hoá nó (tính lại chỗ đặt túi theo mốc hiện tại…), nên
 * bản đang mở khác file một chút dù người dùng chưa sửa gì. Level chưa sửa thì lấy luôn bản đã
 * chuẩn hoá làm gốc, để mở ra thôi không bị đếm là "đã sửa".
 */
function moLevel(lv) {
  const sach = !DA_SUA.has(lv.id) && GOC.get(lv.id) === JSON.stringify(lv);
  setLevel(clone(lv));
  if (sach) GOC.set(lv.id, JSON.stringify(E.level));
}
const soChuaLuu = () => DA_SUA.size - (DA_SUA.has(E.level?.id) ? 1 : 0) + (daSua(E.level?.id) ? 1 : 0);

// ---------- bản nháp trong trình duyệt ----------
// Editor trên web không ghi lên GitHub được nữa (repo đã sang tài khoản công ty). Mọi chỗ sửa —
// sửa level, chuyển level, thêm / xoá / nhân bản / đổi thứ tự — được giữ trong localStorage, nên
// tải lại trang hay đóng tab cũng không mất. Cách đưa vào game: bấm "Tải JSON" → push levels.json.
// Bản nháp gắn với dấu vân tay của levels.json trên web lúc bắt đầu sửa: file trên web đổi (đã
// push bản mới) thì lần mở sau bỏ bản nháp, nhận file mới.
const KHOA_NHAP = () => `snug.editor.nhap.${E.bookArt}`;
let VAN_TAY = '';                    // dấu vân tay levels.json trên web lúc mở editor
function vanTay(sach) {
  const t = JSON.stringify(sach);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + '.' + t.length;
}
let henNhap = 0;
function ghiNhap(ngay = false) {
  const lam = () => {
    if (!E.book || !VAN_TAY) return;
    luuTam();
    const sua = [...DA_SUA]; if (daSua(E.level?.id) && !sua.includes(E.level.id)) sua.push(E.level.id);
    try { localStorage.setItem(KHOA_NHAP(), JSON.stringify({ goc: VAN_TAY, luc: Date.now(), mo: [E.mapId, E.level?.id], sua, book: E.book })); }
    catch (e) { console.warn('không ghi được bản nháp', e); }
  };
  clearTimeout(henNhap);
  if (ngay) lam(); else henNhap = setTimeout(lam, 400);
}
function docNhap() {
  try {
    const d = JSON.parse(localStorage.getItem(KHOA_NHAP()));
    if (!d?.book?.chapters?.length) return null;
    if (d.goc !== VAN_TAY) { localStorage.removeItem(KHOA_NHAP()); return 'cu'; }   // web đã có levels.json mới
    return d;
  } catch { return null; }
}
// đóng tab / chuyển app trên điện thoại: ghi ngay, không chờ hẹn giờ
window.addEventListener('pagehide', () => ghiNhap(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) ghiNhap(true); });

export function markDirty() {
  ghiNhap();
  const n = E.level ? soChuaLuu() : 0;
  $('publishBtn').classList.toggle('dirty', n > 0);
  $('dirtyDot').hidden = n === 0;
  $('dirtyCount').textContent = n > 1 ? ` (${n})` : '';
  $('publishBtn').title = n ? `${n} level đã sửa chưa lưu. Bấm để lưu tất cả (Cmd/Ctrl + S)` : 'Không có gì cần lưu (Cmd/Ctrl + S)';
  // dấu • trước level đang mở trong danh sách, không dựng lại cả danh sách mỗi lần kéo món
  const o = $('levelSelect')?.selectedOptions?.[0];
  if (o) { const co = o.textContent.startsWith('• '), can = daSua(E.level?.id); if (co !== can) o.textContent = (can ? '• ' : '') + o.textContent.replace(/^• /, ''); }
}
// còn level chưa lưu mà đóng / tải lại trang thì trình duyệt hỏi lại
window.addEventListener('beforeunload', e => { if (canWrite && E.level && soChuaLuu() > 0) { e.preventDefault(); e.returnValue = ''; } });
/** Số "Level N" và mã level của level đang mở (thay cho hai ô tên cũ) */
function veSoLevel() {
  if (!E.level || !E.map) return;
  const i = E.map.levels.findIndex(l => l.id === E.level.id);
  $('lvSo').textContent = `Level ${soThuTuLevel(E.map.id, i < 0 ? E.map.levels.length : i, E.book)}`;
  $('lvMa').textContent = E.level.id;
}

// ---------- live preview ----------
// Khung xem thử là chính game, chạy trong iframe cùng origin
const frame = $('game');
/**
 * Khung xem thử chạy đúng bản game thật, chỉ khác tham số preview=1.
 * Bật "Hiện vùng va chạm" thì nạp lại kèm colliders=1 để soi hình vật lý có bám sát
 * ảnh không — cùng một công tắc với game, không phải chế độ vẽ riêng của editor.
 */
const napKhungXemThu = () => {
  E.previewReady = false;
  const them = ($('colliderToggle')?.checked ? '&colliders=1' : '')
             + ($('audioToggle')?.checked ? '&audio=1' : '');
  // Kèm mốc thời gian để luôn lấy bản index.html mới.
  // GitHub Pages đặt cache-control max-age=600 cho file HTML, mà mỗi lần build thì
  // index.html lại trỏ sang một tên file CSS/JS khác (có mã băm). Deploy xong, file cũ
  // bị xoá nhưng bản index.html còn trong cache vẫn trỏ vào nó → khung xem thử mất sạch
  // CSS, hiện ra chữ trần. Cmd+Shift+R không cứu được vì địa chỉ khung do script gán,
  // mà điều hướng do script khởi tạo thì không thừa hưởng lệnh bỏ qua cache.
  frame.src = `./index.html?preview=1&art=${artStyle()}${them}&t=${Date.now()}`;
};
napKhungXemThu();
let pushT = null;
function pushPreview() {
  clearTimeout(pushT);
  pushT = setTimeout(() => {
    if (!E.previewReady || !E.level) return;
    const idx = E.map ? Math.max(0, E.map.levels.findIndex(l => l.id === E.level.id)) : 0;
    frame.contentWindow.postMessage({ type: 'level', level: clone(E.level), index: idx, chapter: { id: E.map.id, no: E.map.no || 1, name: E.map.name || '' } }, '*');
    frame.contentWindow.postMessage({ type: 'timer', on: $('timerToggle').checked }, '*');
  }, 200);
}
window.addEventListener('message', e => { if (e.data?.type === 'ready') { E.previewReady = true; pushPreview(); } });

// ---------- lưu sắp xếp ----------
// Mọi chương và level nằm trong MỘT file: content/<bộ art>/levels.json của repo game.
// Bấm Phát hành là ghi lại file đó, game đọc thẳng từ máy, không qua mạng.
export async function publish(note = '') {
  // Chặn ghi nhầm bộ: level đang mở đọc từ bộ nào thì chỉ ghi trả về đúng bộ đó
  if (E.bookArt !== artStyle()) throw new Error(`level đang mở thuộc bộ ${E.bookArt}, không ghi vào bộ ${artStyle()}. Tải lại trang.`);
  const b = chuanBiSach(note);
  if (!canWrite) { ghiNhap(true); return b.version; }   // web: giữ trong bản nháp, Tải JSON để lấy file
  const text = JSON.stringify(b, null, 2);
  await saveContent('levels.json', text);                // chạy ở máy: ghi thẳng ra file
  VAN_TAY = vanTay(b);                                   // file đã đổi: bản nháp từ giờ gắn với bản này
  chupGoc();                                             // mọi level đã sửa giờ đã lưu
  ghiNhap(true);
  return b.version;
}

/**
 * Chép level đang sửa về chương, tăng số bản, tính lại danh sách ảnh mỗi chương cần nạp
 * (ch.assets: thiếu món mới ở đây thì game không nạp ảnh của nó). Dùng cho Lưu và Tải JSON.
 */
function chuanBiSach(note = '') {
  syncLevelIntoChapter();     // level đang sửa là bản chép riêng, phải trả về chương trước khi ghi
  const b = E.book;
  b.version = (b.version || 0) + 1;
  b.publishedAt = new Date().toISOString();
  if (note) b.note = note;
  for (const ch of b.chapters) {
    const items = new Set(), bgs = new Set(), bags = new Set();
    for (const lv of ch.levels) {
      for (const it of lv.items || []) items.add(Number(it.id));
      if (lv.background != null) bgs.add(Number(lv.background));
      if (lv.container?.skin) bags.add(lv.container.skin);
    }
    ch.assets = { items: [...items].sort((a, c) => a - c), backgrounds: [...bgs].sort((a, c) => a - c), bags: [...bags].sort() };
  }
  return b;
}

// Trang tĩnh (GitHub Pages, vite preview) không có cầu ghi file. Dò một lần lúc khởi động.
let canWrite = false;
async function probeWriter() {
  try { canWrite = (await (await fetch('/__content/ping')).json())?.ok === true; }
  catch { canWrite = false; }
  return canWrite;
}

/** Một nút Lưu duy nhất: chép level đang sửa về chương rồi ghi cả file sắp xếp */
async function saveAll() {
  const btn = $('publishBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const v = await publish();
    indexChapter();
    refreshLevelSelect();
    $('liveTag').textContent = `v${v}`;
    markDirty();
    const art = artStyle(), bo = art.toUpperCase();
    if (canWrite) status(`Đã lưu level ${bo} · bản v${v}`, 'ok');
    else status('Đã giữ trong bản nháp của trình duyệt (tải lại trang không mất). Bấm Tải JSON → push levels.json để đưa vào game.', 'ok');
    frame.contentWindow.postMessage({ type: 'assets' }, '*');
  } catch (e) { status('Lỗi lưu: ' + e.message, 'bad'); }
  finally { btn.disabled = false; }
}

$('publishBtn').addEventListener('click', saveAll);
// Cmd/Ctrl + S lưu như mọi công cụ khác
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveAll(); }
});

// Tải file JSON về máy, dùng khi editor chạy trên web và không ghi thẳng được
$('downloadBtn').addEventListener('click', () => {
  const b = chuanBiSach();
  ghiNhap(true);
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  // Giờ chỉ làm bộ cozy: file tải về đúng tên levels.json, chép thẳng vào public/content/cozy/ không cần đổi tên
  a.href = URL.createObjectURL(blob); a.download = 'levels.json'; a.click();
  URL.revokeObjectURL(a.href);
  status(`Đã tải levels.json — chép vào public/content/${artStyle()}/ của game, Creative tool và sync Android`, 'ok');
});

// ---------- nối GitHub ----------
// Bản trên web không ghi file được, nên lưu bằng cách commit levels.json lên repo.
function paintGhTag() {
  $('ghTag').textContent = gh.hasToken() ? `${gh.REPO.owner}/${gh.REPO.repo}` : 'chưa nối';
  $('ghBtn').classList.toggle('warn', !gh.hasToken());
}
function openGh() {
  $('ghRepoName').textContent = `${gh.REPO.owner}/${gh.REPO.repo}`;
  $('ghBranchName').textContent = gh.REPO.branch;
  $('ghPath').textContent = gh.REPO.path;
  $('ghToken').value = gh.hasToken() ? '••••••••' : '';
  $('ghStatus').textContent = '';
  $('ghModal').hidden = false;
}
$('ghBtn').addEventListener('click', openGh);
$('ghClose').addEventListener('click', () => { $('ghModal').hidden = true; });
$('ghModal').addEventListener('click', e => { if (e.target === $('ghModal')) $('ghModal').hidden = true; });
$('ghSave').addEventListener('click', async () => {
  const typed = $('ghToken').value.trim();
  const token = typed === '••••••••' ? gh.readToken() : typed;
  if (!token) { $('ghStatus').textContent = 'Chưa dán token'; return; }
  $('ghStatus').textContent = 'đang kiểm tra…';
  try {
    const name = await gh.check(token);
    gh.writeToken(token);
    paintGhTag();
    $('ghStatus').textContent = `Đã nối ${name}`;
    setTimeout(() => { $('ghModal').hidden = true; }, 900);
  } catch (e) { $('ghStatus').textContent = 'Lỗi: ' + e.message; }
});
$('ghForget').addEventListener('click', () => {
  gh.clearToken(); paintGhTag();
  $('ghToken').value = '';
  $('ghStatus').textContent = 'Đã xoá token khỏi trình duyệt này';
});

// ---------- metrics ----------
/**
 * Chạy máy xếp và ghi kết luận.
 * Tách riêng và cho chạy trễ vì kéo một món gọi onChange mỗi khung hình, mà máy xếp
 * nay dò hình thật ở tám góc nên tốn cả trăm mili giây — chạy thẳng thì kéo bị giật.
 * Các con số còn lại vẫn cập nhật tức thì.
 */
let hen = null;
function chayMayXep() {
  const L = daDung(E.level); if (!L) return;
  const sv = $('solvable');
  if (!L.items.length) { sv.textContent = 'Chưa có món'; sv.className = 'solv'; return; }
  const d = difficulty(L, areaOf);
  const sol = solve(L, { tries: 300 });
  if (sol.solvable) { sv.textContent = `Xếp được · ${sol.needCount}/${sol.needCount} món, sau ${sol.tries} lần thử`; sv.className = 'solv ok'; }
  else if (d.density <= .88) { sv.textContent = `Chặt tay · máy chỉ xếp được ${sol.placedCount}/${sol.needCount} món`; sv.className = 'solv warn'; }
  else { sv.textContent = `Rất có thể không xếp nổi · ${sol.placedCount}/${sol.needCount} món, density ${(d.density * 100).toFixed(0)}%`; sv.className = 'solv bad'; }
}

/** Level với túi đã dựng như lúc chơi: túi dáng cố định có thêm vách ngăn in sẵn (data/bag.js) */
const daDung = L => L && { ...L, container: resolveContainer(L.container || {}, BAG_SKINS) };
function metrics() {
  const L = daDung(E.level); if (!L) return;
  const d = difficulty(L, areaOf);
  const sv = $('solvable');
  if (!L.items.length) { sv.textContent = 'Chưa có món'; sv.className = 'solv'; }
  else { sv.textContent = 'Đang thử xếp…'; sv.className = 'solv'; }
  clearTimeout(hen); hen = setTimeout(chayMayXep, 220);
  const pct = Math.min(100, d.density * 100);
  const bar = $('densBar'); bar.style.width = pct + '%'; bar.style.background = pct > 92 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--ok)';
  $('kv').innerHTML = [
    ['density', `${(d.density * 100).toFixed(1)}%`],
    ['usable area', `${Math.round(d.usable).toLocaleString()} px²`],
    ['items area', `${Math.round(d.itemArea).toLocaleString()} px²`],
    ['items', `${d.count}`],
    ['timer', `${L.timer}s`],
    ['coin', `${L.reward?.coin ?? 0}`],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('diffTotal').textContent = `${d.total} · ${d.tier}`;
  $('diffRows').innerHTML = d.rows.map(r => `<tr><td>${r.label}<span class="c">${r.cond}</span></td><td>${r.pts ? '+' + r.pts : 0}</td></tr>`).join('');

  // cảnh báo
  const warns = [];
  const locked = L.items.filter(i => i.locked), key = L.items.find(i => i.id === 'key');
  if (locked.length && !key) warns.push('Có hộp bí ẩn nhưng chưa có chìa khóa.');
  if (key && !key.inBag) warns.push('GDD: chìa khóa phải nằm sẵn trong túi (bật "In bag").');
  if (key?.inBag && !pointInPolygon(key.x ?? 0, key.y ?? -30, L.container.shape)) warns.push('Chìa khóa nằm ngoài lòng túi.');
  for (const it of L.items) if (it.link && !L.items.find(j => j.id === it.link)) warns.push(`${it.id} buộc dây với ${it.link} nhưng món đó không có trong level.`);
  const ids = L.items.map(i => i.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) warns.push('Trùng id: ' + [...new Set(dup)].join(', ') + ' (mỗi món chỉ 1 lần).');
  if (d.density > .95) warns.push('Density > 95%: gần như không xếp được với physics.');
  const wc = $('warnCard'); wc.hidden = !warns.length; wc.innerHTML = warns.map(w => `<div>⚠ ${w}</div>`).join('');
}

/** Đổ danh sách túi và nền vào hai ô chọn */
export function refreshPickers() {
  const skin = $('lvSkin');
  // Chỉ những túi CÓ ẢNH trong bộ art đang sửa (theo thứ tự mục lục ảnh). Bộ art chưa có
  // túi ảnh nào thì mới lùi về danh mục kiểu túi vẽ bằng code.
  const coAnh = Object.values(BAG_SKINS).filter(isFixedSkin).sort((a, b) => (a.thuTu ?? 99) - (b.thuTu ?? 99));
  const ds = coAnh.length ? coAnh.map(s => ({ id: s.id, name: s.name || s.id })) : BAG_KINDS;
  const dangDung = E.level?.container?.skin;
  if (dangDung && !ds.some(b => b.id === dangDung)) ds.push({ id: dangDung, name: `${dangDung} (chưa có ảnh ở bộ này)` });
  skin.innerHTML = ds.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const bgs = sceneOptions();
  $('lvBg').innerHTML = bgs.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  if (E.level) { skin.value = E.level.container.skin || 'backpack'; $('lvBg').value = String(E.level.background ?? 1); }
  // lưới ảnh túi: tên không thì không biết túi nào với túi nào
  $('skinGrid').replaceChildren(...ds.map(b => {
    const el = document.createElement('button'); el.type = 'button'; el.dataset.id = b.id; el.title = b.name;
    const src = BAG_SKINS[b.id]?.img?.body?.src;
    el.innerHTML = `${src ? `<img src="${src}" alt="">` : '<i class="no-img">chưa có ảnh</i>'}<span>${b.name}</span>`;
    el.addEventListener('click', () => { skin.value = b.id; skin.dispatchEvent(new Event('change')); $('skinPick').hidden = true; });
    return el;
  }));
  veNutTui();
}
/** Nút "Chiếc túi": ảnh + tên túi đang chọn, và đánh dấu túi đó trong lưới */
function veNutTui() {
  const id = $('lvSkin').value, sk = BAG_SKINS[id];
  const img = $('lvSkinImg'), src = sk?.img?.body?.src;
  img.hidden = !src; if (src) img.src = src;
  $('lvSkinName').textContent = sk?.name || id || '—';
  for (const b of $('skinGrid').children) b.classList.toggle('on', b.dataset.id === id);
}
$('lvSkinBtn').addEventListener('click', () => { veNutTui(); $('skinPick').hidden = false; });
$('skinPickClose').addEventListener('click', () => { $('skinPick').hidden = true; });
$('skinPick').addEventListener('click', e => { if (e.target === $('skinPick')) $('skinPick').hidden = true; });

// ---------- form ----------
// Tên tiếng Anh: game mặc định nói tiếng Anh, bỏ trống thì hiện tên tiếng Việt
$('lvTimer').addEventListener('change', e => { E.level.timer = +e.target.value; onChange(); });
$('lvBg').addEventListener('change', e => { E.level.background = Number(e.target.value); onChange(); });
$('lvSkin').addEventListener('change', e => { E.level.container.skin = e.target.value; dongBoTui(E.level); draw?.syncBagUi(); veNutTui(); onChange(); });
$('lvCoin').addEventListener('change', e => { E.level.reward = { ...(E.level.reward || {}), coin: +e.target.value }; onChange(); });

// ---------- tabs ----------
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab-page').forEach(p => (p.hidden = p.id !== 'tab-' + b.dataset.tab));
});

// ---------- xem thử: máy chơi hộ ----------
$('autoplayBtn').addEventListener('click', () => {
  frame.contentWindow.postMessage({ type: 'autoplay' }, '*');
  status('Máy đang xếp thử…', '');
});
// Chơi lại: dừng máy (nếu đang chạy) rồi dựng lại màn từ đầu, đồ mưa xuống như mở màn
$('restartBtn').addEventListener('click', () => {
  frame.contentWindow.postMessage({ type: 'restart' }, '*');
  status('Đã dựng lại màn', 'ok');
});

// ---------- hộp thoại máy chọn đồ ----------
const genModal = $('genModal');
$('genBtn').addEventListener('click', () => { genModal.hidden = false; gen.refresh(); });
$('genClose').addEventListener('click', () => { genModal.hidden = true; });
genModal.addEventListener('click', e => { if (e.target === genModal) genModal.hidden = true; });
window.addEventListener('keydown', e => { if (e.key === 'Escape') genModal.hidden = true; });

// ---------- level list / save / assign ----------
const levelNames = new Map();   // id → tên hiển thị
/** Chương và level đều nằm trong E.book, không phải tải từng file nữa */
const levelItemIds = new Map();
function indexChapter() {
  levelNames.clear(); levelItemIds.clear();
  for (const lv of E.map.levels) {
    levelNames.set(lv.id, `Level ${soThuTuLevel(E.map.id, E.map.levels.indexOf(lv), E.book)}`);
    levelItemIds.set(lv.id, (lv.items || []).map(i => Number(i.id)));
  }
  E.levelNames = levelNames;
  E.levelItemIds = levelItemIds;
}

function refreshChapterSelect() {
  const sel = $('chapterSelect');
  sel.innerHTML = E.book.chapters.map(c => `<option value="${c.id}">Chương ${c.no} — ${c.name}</option>`).join('');
  sel.value = E.mapId;
}
function refreshLevelSelect() {
  const sel = $('levelSelect');
  // số thứ tự liền qua các chương, đúng như game hiện; dấu • là level đã sửa mà chưa lưu
  sel.innerHTML = E.map.levels.map((lv, i) => `<option value="${lv.id}">${daSua(lv.id) ? '• ' : ''}Level ${soThuTuLevel(E.map.id, i, E.book)}</option>`).join('');
  if (E.level) sel.value = E.level.id;
  veSoLevel();
}

/** Mở một chương, kèm level chỉ định hoặc level đầu tiên */
export async function openChapter(mapId, levelId) {
  luuTam();
  E.mapId = mapId;
  E.map = E.book.chapters.find(c => c.id === mapId) || E.book.chapters[0];
  E.mapId = E.map.id;
  setAssetChapter(`assets/${String(E.map.no || 1).padStart(2, '0')}-${E.mapId}`);
  indexChapter();
  let pick = E.map.levels.find(l => l.id === levelId) || E.map.levels[0];
  if (!pick) { pick = blankLevel(nextLevelId(E.mapId, [])); E.map.levels.push(pick); }   // chương trống: tạo sẵn level đầu
  moLevel(pick);
  refreshChapterSelect(); refreshLevelSelect(); draw?.clearSelection();
  draw?.computeChapterItems();
  markDirty(); pool?.computeChapterItems();
}
export async function openLevel(id) {
  luuTam();                                        // trước khi tìm: mở lại đúng level đang sửa cũng không mất gì
  const lv = E.map.levels.find(l => l.id === id);
  if (!lv) return;
  moLevel(lv);
  refreshLevelSelect(); draw?.clearSelection(); markDirty();
}

$('chapterSelect').addEventListener('change', e => openChapter(e.target.value));
$('levelSelect').addEventListener('change', e => openLevel(e.target.value));
$('newLevel').addEventListener('click', () => {
  luuTam();
  // Thêm thẳng vào chương để xoá được ngay; chưa bấm Lưu thì chỉ nằm trong bộ nhớ
  const id = nextLevelId(E.mapId, E.map.levels.map(l => l.id));
  const lv = blankLevel(id); if (E.level) lv.container = clone(E.level.container);
  E.map.levels.push(lv);
  indexChapter();
  setLevel(clone(lv));
  refreshLevelSelect();
  status(`Đã thêm level ${E.map.levels.length}, chưa lưu. Bấm Lưu để ghi vào game.`, '');
});

/**
 * Trả level đang sửa về đúng chỗ của nó trong chương.
 * E.level là bản chép riêng để sửa thoải mái, nên không tự động vào E.book.
 * Mọi đường lưu đều phải đi qua đây, nếu không file ghi ra sẽ thiếu đúng phần vừa sửa.
 */
export function syncLevelIntoChapter() {
  if (!E.level || !E.map) return;
  // Chỉ cập nhật level còn trong chương. Trước đây không thấy thì đẩy thêm vào cuối, nên xoá
  // đúng level đang mở trong bảng Quản lý rồi lưu là nó sống lại.
  luuTam();
}


$('copyJson').addEventListener('click', async () => { await navigator.clipboard.writeText(JSON.stringify(E.level, null, 2)); status('Đã chép JSON', 'ok'); });
/** Thử đọc clipboard; trình duyệt chặn hoặc nội dung không phải level thì hỏi tay */
async function readLevelJson() {
  let txt = '';
  try { txt = (await navigator.clipboard.readText()) || ''; } catch {}
  const parse = t => { const lv = JSON.parse(t); if (!lv.container || !Array.isArray(lv.items)) throw new Error('thiếu container hoặc items'); return lv; };
  if (txt.trim()) {
    try { return parse(txt); } catch {}          // clipboard có nhưng không phải level → hỏi tay
  }
  const typed = prompt('Dán JSON của level vào đây:');
  if (typed == null) return null;                // người dùng bấm Huỷ
  return parse(typed);
}

$('pasteJson').addEventListener('click', async () => {
  try {
    const lv = await readLevelJson();
    if (!lv) return;
    setLevel(lv, { keepId: true });
    status(`Đã dán level · ${lv.items.length} món`, 'ok');
  } catch (e) { status('Không dán được: ' + e.message, 'bad'); }
});

// ---------- boot ----------
async function boot() {
  E.config = await loadConfig();
  E.liveArt = E.config.art === 'casual' ? 'casual' : 'cozy';
  E.book = await loadBook({ fresh: true });
  chupGoc();
  // loadBook có thể đã lùi về cozy nếu bộ được chọn chưa có level
  E.bookArt = artStyle();       // file sắp xếp này thuộc bộ nào: chỉ được ghi trả về đúng bộ đó
  VAN_TAY = vanTay(E.book);
  const nhap = docNhap();
  let moLai = null, coNhap = false;
  const sachWeb = E.book;
  if (nhap && nhap !== 'cu') {
    // Level không nằm trong danh sách đã sửa thì lấy lại đúng bản trên web (GOC), để dấu • chỉ
    // đánh vào level sửa thật. Level mới / đã sửa / thứ tự / chương lấy theo bản nháp.
    const web = new Map(); for (const c of E.book.chapters) for (const lv of c.levels) web.set(lv.id, lv);
    const sua = new Set(nhap.sua || []);
    for (const c of nhap.book.chapters) c.levels = c.levels.map(lv => (!sua.has(lv.id) && web.has(lv.id) ? web.get(lv.id) : lv));
    E.book = nhap.book;
    DA_SUA.clear(); for (const id of sua) DA_SUA.add(id);
    moLai = nhap.mo;
    coNhap = sua.size > 0 || JSON.stringify(E.book.chapters) !== JSON.stringify(sachWeb.chapters);   // có gì khác bản trên web
  }
  veBoArt();
  if (!E.book?.chapters?.length) throw new Error('levels.json chưa có chương nào');
  E.mapId = new URLSearchParams(location.search).get('map') || moLai?.[0] || E.book.chapters[0].id;

  await Promise.all([loadItemManifests(), loadBackgrounds(), loadBags()]);
  refreshPickers();

  // hai công tắc này đổi cách khung xem thử khởi động nên phải nạp lại nó
  $('colliderToggle')?.addEventListener('change', napKhungXemThu);
  $('audioToggle')?.addEventListener('change', napKhungXemThu);

  draw = initDraw({ E, onChange, status, areaOf });
  whenSpriteReady(() => { clearAreaCache(); draw.refreshPalette(); onChange(); });
  gen = initGenerate({ E, setLevel, areaOf, status });
  pool = initPool({ E, status, onSaved: () => { clearAreaCache(); draw.refreshPalette(); onChange(); frame.contentWindow.postMessage({ type: 'assets' }, '*'); } });
  initManage({
    E, status, blankLevel, clone, publish,
    onReload: (mapId, levelId) => openChapter(mapId || E.mapId, levelId),
    onLevelPicked: id => openLevel(id),
  });

  await openChapter(E.mapId, moLai?.[1]);
  $('liveTag').textContent = `v${E.book.version || 1}`;

  await probeWriter();
  const soSua = soChuaLuu();
  if (coNhap) status(`Đã mở lại bản nháp chưa đưa vào game${soSua ? ` (${soSua} level đã sửa)` : ''}. Bấm Tải JSON → push levels.json khi xong.`, 'ok', 8000);
  else if (nhap === 'cu') status('levels.json trên web đã đổi: bỏ bản nháp cũ, đang sửa trên bản mới.', 'ok', 8000);
  else if (!canWrite) status('Sửa thoải mái, Editor tự giữ bản nháp. Xong thì bấm Tải JSON → push levels.json.', '', 8000);
  markDirty();
}
boot().catch(e => { console.error(e); status('Lỗi khởi động: ' + e.message, 'bad'); });
