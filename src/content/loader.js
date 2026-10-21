// Đọc nội dung game. Mọi thứ nằm ngay trong bản build, không gọi mạng lúc chơi.
//
//   public/content/<bộ art>/            cozy | casual, mỗi bộ đủ mọi thứ dưới đây
//     levels.json                 sắp xếp chương và level — Level Editor xuất ra file này
//     assets/index.json           mục lục: mã số → đường dẫn file mô tả
//     assets/<chương>/items/…     ảnh và mô tả từng món
//     assets/<chương>/bags/…      ảnh ba lớp của từng kiểu túi
//     assets/<chương>/backgrounds/…
//
// Editor dùng lại đúng module này, chỉ khác ROOT trỏ sang địa chỉ của game.
import { ITEM_DEFS, defById } from '../data/items.js';
import { registerImageScene, registerBagSkin } from '../art/scene-registry.js';
import { applyCollider } from '../data/collider.js';

let ROOT = './content/';

// Hai bộ art tách riêng HOÀN TOÀN, mỗi bộ một thư mục gốc:
//   content/cozy/     levels.json + assets/ (mục lục, món, túi, bối cảnh)
//   content/casual/   cùng cấu trúc
// Dáng món khác nhau thì vùng va chạm khác, level phải cân riêng, nên không chung gì cả.
// Chọn bằng ?art=casual. Bộ nào chưa có levels.json thì loader lặng lẽ dùng bộ cozy.
export const ART_STYLES = ['cozy', 'casual'];
let ART = 'cozy';
export const artStyle = () => ART;
export function setArtStyle(s) {
  const moi = ART_STYLES.includes(s) ? s : 'cozy';
  if (moi !== ART) { cache.clear(); assetIndex = null; }
  ART = moi;
}
/**
 * Cấu hình chung của game, nằm ngoài hai bộ art: content/config.json.
 *   art   bộ art người chơi thấy khi mở game (editor đổi bằng nút "Game dùng", bấm Lưu là ghi)
 * Luôn bỏ qua cache như levels.json, để đổi xong người chơi nhận được ngay.
 */
export async function loadConfig() {
  try {
    const res = await fetch(`${ROOT}config.json?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}
/** Ghi config.json (chỉ editor dùng, qua cầu ghi của server dev) */
export async function saveConfig(cfg) { return post('/__content/save', { path: 'config.json', text: JSON.stringify(cfg, null, 2) + '\n' }); }

/** Thư mục gốc của bộ art đang chọn */
const base = () => `${ROOT}${ART}/`;
/** Địa chỉ đầy đủ của một file art, dùng cả ở trang chủ (thẻ <img>, background) */
// Số bản của levels.json gắn vào địa chỉ mọi ảnh và file mô tả. GitHub Pages cho trình duyệt giữ
// file tới 10 phút theo tên, mà đổi art thì tên file giữ nguyên (1.png vẫn là 1.png): không có số
// này, người chơi thấy level mới mà đồ vẫn là ảnh cũ cho tới khi hết hạn cache. Kèm thêm mốc
// build (vite.config.js) để đổi ảnh mà không đổi level cũng được tải mới sau mỗi lần deploy.
let STAMP = '';
const dauBan = () => (STAMP ? `?v=${STAMP}` : '');
export const artUrl = p => (/^(https?:)?\/\//.test(p) ? p : base() + p + dauBan());
/** Đường dẫn của file trong thư mục content/ (cho cầu ghi của editor) */
export const contentPath = p => `${ART}/${p}`;

const cache = new Map();
const assetPath = src => artUrl(src);

async function getJSON(path, { fresh = false, noStore = false } = {}) {
  if (!fresh && !noStore && cache.has(path)) return cache.get(path);
  const tai = async (boCache) => {
    const res = await fetch(base() + path + (fresh || noStore || boCache ? `?t=${Date.now()}` : dauBan()),
      noStore || boCache ? { cache: 'no-store' } : undefined);
    if (!res.ok) throw new Error(`Không tải được ${path} (${res.status})`);
    return res.json();
  };
  let data;
  // Lỗi lần đầu (mạng chập, bản cache hỏng trên GitHub Pages) thì tải lại một lần bỏ qua cache:
  // một manifest hỏng là món đó thành ô xám trong editor lẫn game suốt phiên.
  try { data = await tai(false); } catch (e) { console.warn('tải lại', path, e.message); data = await tai(true); }
  cache.set(path, data);
  return data;
}

// ---------- sắp xếp chương và level ----------
let BOOK = null;

/**
 * Nạp file sắp xếp. LUÔN bỏ qua cache của trình duyệt: đây là file duy nhất thay đổi
 * mỗi lần sửa level, mà GitHub Pages lại đặt max-age 600 giây nên không ép thì mười phút
 * sau người chơi mới thấy. File chỉ khoảng 40 KB nên tải lại không đáng kể.
 */
export async function loadBook(opts) {
  // App Android: level đã nhét sẵn vào index.html lúc build (tools/build-www.mjs), lấy luôn
  const macDinh = window.Capacitor?.isNativePlatform?.() && window.__LEVELS_MAC_DINH;
  if (macDinh && ART === 'cozy') BOOK = structuredClone(macDinh);
  else try { BOOK = await getJSON('levels.json', { ...opts, noStore: true }); }
  catch (e) {
    if (ART === 'cozy') throw e;
    console.warn(`Bộ art ${ART} chưa có levels.json, dùng bộ cozy`);
    setArtStyle('cozy');
    BOOK = await getJSON('levels.json', { ...opts, noStore: true });
  }
  STAMP = `${ART}-${BOOK?.version || 0}-${typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : 'dev'}`;
  return BOOK;
}
export const book = () => BOOK;
/**
 * Số thứ tự của level, tính LIỀN qua mọi chương theo thứ tự trong levels.json: chương 1 có
 * 12 level thì level đầu của chương 2 là Level 13. Level không còn tên riêng, tiêu đề ở game,
 * editor và Creative đều là "Level N" theo số này. `sach` để editor/Creative dùng sách của mình.
 */
export function soThuTuLevel(chapterId, idx, sach = BOOK) {
  let n = 0;
  for (const c of sach?.chapters || []) {
    if (c.id === chapterId) return n + idx + 1;
    n += c.levels?.length || 0;
  }
  return idx + 1;
}
export const chapters = () => BOOK?.chapters || [];
export const chapterById = id => chapters().find(c => c.id === id) || chapters()[0] || null;

// ---------- art ----------
let assetIndex = null, indexInFlight = null;
/**
 * Mục lục art. Món, nền và túi nạp song song nên ba lời gọi tới đây gần như cùng lúc;
 * chỉ có MỘT lượt tải thật, các lời gọi sau chờ chung.
 */
export function loadAssetIndex(force) {
  if (assetIndex && !force) return Promise.resolve(assetIndex);
  if (indexInFlight) return indexInFlight;
  indexInFlight = (async () => {
    cache.delete('assets/index.json');
    let idx;
    try { idx = await getJSON('assets/index.json', { fresh: true }); }
    catch { idx = {}; }
    for (const k of ['items', 'backgrounds', 'bags']) idx[k] = idx[k] || {};
    assetIndex = idx;
    return idx;
  })().finally(() => { indexInFlight = null; });
  return indexInFlight;
}

/**
 * Ảnh giao diện của bộ art (nhóm "ui" trong mục lục): phần tử nào có data-art-icon="tên" mà
 * bộ art có ảnh tên đó thì nhận ảnh qua biến CSS --art và lớp .has-art. Không có thì bỏ lớp,
 * nút quay về hình vẽ sẵn.
 */
export async function applyArtIcons(root = document) {
  const ui = (await loadAssetIndex()).ui || {};
  for (const el of root.querySelectorAll('[data-art-icon]')) {
    const p = ui[el.dataset.artIcon];
    el.classList.toggle('has-art', !!p);
    // địa chỉ tuyệt đối: url() trong biến CSS tính theo file CSS dùng nó, không theo trang
    if (p) el.style.setProperty('--art', `url("${new URL(artUrl(p), location.href).href}")`); else el.style.removeProperty('--art');
  }
}

/** Nạp ảnh món. Truyền danh sách mã thì chỉ nạp bấy nhiêu. */
export async function loadItemManifests(ids) {
  const index = await loadAssetIndex();
  const list = ids || Object.keys(index.items).map(Number);
  await Promise.all(list.map(async id => {
    const path = index.items[id];
    if (!path) return;
    try {
      const def = applyManifest(await getJSON(path));
      if (def.sprite) await def.sprite.whenReady;
    } catch (e) { console.warn('manifest lỗi', id, e); }
  }));
}

/** Nạp ảnh nền. */
export async function loadBackgrounds(only) {
  const index = await loadAssetIndex();
  const ids = only || Object.keys(index.backgrounds).map(Number);
  await Promise.all(ids.map(async id => {
    const path = index.backgrounds[id];
    if (!path) return;
    try {
      const m = await getJSON(path);
      const layers = (m.layers || []).map(l => ({ ...l, img: loadImage(l.src) }));
      await Promise.all(layers.map(l => whenLoaded(l.img)));
      registerImageScene(id, { ...m, layers });
    } catch (e) { console.warn('nền lỗi', id, e); }
  }));
  return ids;
}

/** Nạp ảnh ba lớp của từng kiểu túi. */
export async function loadBags(only) {
  const index = await loadAssetIndex();
  const kinds = only || Object.keys(index.bags);
  await Promise.all(kinds.map(async kind => {
    const path = index.bags[kind];
    if (!path) return;
    try {
      const def = await getJSON(path);
      const img = {};
      for (const [k, src] of Object.entries(def.layers || {})) img[k] = loadImage(src);
      await Promise.all(Object.values(img).map(whenLoaded));
      registerBagSkin(def.id, { ...def, img, thuTu: Object.keys(index.bags).indexOf(kind) });   // thuTu: thứ tự trong mục lục, cho editor xếp danh sách
    } catch (e) { console.warn('túi lỗi', kind, e); }
  }));
  return kinds;
}

/**
 * Nạp đúng phần art một chương cần; bỏ trống thì nạp cả kho.
 * Hộp bí ẩn (-1) và chìa khoá (0) luôn nạp kèm: level chỉ ghi mã món THẬT bị giấu,
 * không ghi mã hộp, nên chúng không bao giờ xuất hiện trong danh sách tính tự động.
 */
const LUON_CAN = [-1, 0];
export async function loadChapterAssets(ch) {
  const a = ch?.assets;
  const items = a?.items ? [...new Set([...a.items, ...LUON_CAN])] : undefined;
  await Promise.all([loadItemManifests(items), loadBackgrounds(a?.backgrounds), loadBags(a?.bags)]);
}

const loadImage = src => { const el = new Image(); el.src = assetPath(src); return el; };
// Ảnh lỗi (mạng chập, cache hỏng) thì thử lại một lần bỏ qua cache rồi mới chịu; không thì món
// hiện ô xám suốt phiên, cả editor lẫn khung xem thử.
const whenLoaded = el => new Promise(res => {
  if (el.complete && el.naturalWidth) return res();
  let daThu = false;
  el.onload = res;
  el.onerror = () => {
    if (daThu) return res();
    daThu = true; console.warn('tải lại ảnh', el.src);
    el.src = el.src.replace(/([?&])r=\d+/, '').replace(/\?$/, '') + (el.src.includes('?') ? '&' : '?') + 'r=' + Date.now();
  };
});

/** Gộp manifest vào ITEM_DEFS: tạo def mới nếu mã chưa có (món chỉ có ảnh) */
export function applyManifest(m) {
  let def = defById(m.id);
  if (!def) {
    def = { id: Number(m.id), slug: m.slug || `item${m.id}`, code: m.code || null,
            name: m.name || `Món ${m.id}`, kind: 'rect', w: 40, h: 40, box: [-20, -20, 20, 20],
            meta: { size: 'Medium', shape: 'Rectangle', physics: 'normal', cost: 1, canLink: true, canLock: true } };
    ITEM_DEFS.push(def);
  }
  if (m.name) def.name = m.name;
  if (m.nameEn) def.nameEn = m.nameEn;   // tên tiếng Anh cho giao diện English (i18n itemName)
  if (m.meta) def.meta = { ...def.meta, ...m.meta };
  applyCollider(def, m.collider);
  def.outline = m.outline?.length > 2 ? m.outline : null;   // viền để vẽ, bám mép ảnh hơn collider
  if (m.sprite) {
    const img = loadImage(m.sprite.src);
    const sprite = { img, ppu: m.sprite.pixelsPerUnit || 3, ready: false };
    sprite.whenReady = whenLoaded(img).then(() => {
      sprite.ready = !!img.naturalWidth;
      onSpriteReady.forEach(fn => fn(def));
      return def;
    });
    def.sprite = sprite;
  }
  return def;
}

const onSpriteReady = [];
export function whenSpriteReady(fn) { onSpriteReady.push(fn); }

// ---------- ghi (chỉ editor dùng, qua cầu ghi của server dev) ----------
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ghi thất bại');
  return res.json();
}
export async function saveContent(path, text) { cache.delete(path); return post('/__content/save', { path: contentPath(path), text }); }
export async function deleteContent(path) { cache.delete(path); return post('/__content/delete', { path: contentPath(path) }); }

/** Thư mục chương mà art MỚI sẽ được đặt vào. Editor đặt lại mỗi khi đổi chương. */
let assetChapter = 'assets/01-school-day';
export function setAssetChapter(folder) { if (folder) assetChapter = folder.replace(/^assets\//, 'assets/'); }

/** Art này đang nằm ở file nào; chưa có thì trả chỗ mặc định trong thư mục chương hiện tại */
export async function assetHome(kind, id) {
  const index = await loadAssetIndex();
  return index[kind]?.[id] || `${assetChapter}/${kind}/${id}.json`;
}

/** Ghi một mục vào mục lục art rồi lưu lại */
export async function indexAsset(kind, id, path) {
  const index = await loadAssetIndex(true);
  index[kind][id] = path;
  await saveContent('assets/index.json', JSON.stringify(index, null, 2));
  assetIndex = index;
  return index;
}
