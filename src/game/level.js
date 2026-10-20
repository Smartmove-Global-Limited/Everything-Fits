// Dựng level từ JSON (content pack): túi polygon, block, rải đồ, dây buộc, hộp bí ẩn, chìa trong túi, HUD.
import Matter from 'matter-js';
import { S, BAG, setContainer, toAbs, W, TABLE_Y } from './state.js';
import { MYSTERY, defById, KEY_ID, coTrongLevel } from '../data/items.js';
import { theme } from '../art/helpers.js';
import { makeItem, createWorld, dungTui, NHOM_TRAN } from './physics.js';
import { dust, ring } from './fx.js';
import { resolveContainer } from '../data/bag.js';
import { batDauLuot } from './events.js';
import { resetDoVo } from './rules.js';
import { soThuTuLevel } from '../content/loader.js';
import { BAG_SKINS } from '../art/scene-registry.js';
import { createTethers } from './mechanics.js';
import { resetBoosts } from './boosters.js';
import { renderHeader, renderList, hideWin, hideLose, hidePause } from '../ui/hud.js';
import { clearFx } from './fx.js';
import { duckMusic, sfx } from '../ui/sfx.js';
import { setSpot } from './progress.js';
import { t, chapterName, onLangChange } from '../i18n.js';

const { Body, World } = Matter;

// Màu mực và bảng màu HUD theo mã bối cảnh; không khai báo thì dùng mặc định
const SCENE_INK = { 1: '#3B2A4A', 2: '#3B2A4A', 3: '#4A2F3A' };
const SCENE_CLS = {};

/** Dựng level từ object JSON */
export function build(level) {
  // Túi dáng cố định: hình lòng túi và chỗ đặt tính từ ảnh túi lúc chạy. Giữ luôn bản đã tính
  // trong S.LEVEL để máy xếp, máy tự chơi đọc đúng hình đang vẽ, kể cả level không ghi sẵn
  // `shape` (Creative đổi túi, level sửa tay).
  const cTui = resolveContainer(level.container || {}, BAG_SKINS);
  if (cTui !== level.container) level = { ...level, container: cTui };
  S.LEVEL = level;
  S.phienVan = (S.phienVan || 0) + 1; S.mayNghi = false;   // máy tự chơi đang chạy cho ván cũ thấy số này đổi thì tự dừng
  setContainer(level.container);
  theme.ink = level.ink || SCENE_INK[Number(level.background)] || '#3B2A4A';
  // Chìa khoá là công cụ mở hộp bí ẩn, không phải món phải xếp → không tính vào packing list
  const playable = level.items.filter(it => it.id !== KEY_ID);
  const missing = playable.filter(it => !defById(it.id)).map(it => it.id);
  if (missing.length) console.warn('Level dùng món chưa có định nghĩa art:', missing.join(', '));
  S.ITEMS = playable.map(it => defById(it.id)).filter(Boolean);

  // HUD
  veThanhTen();
  hideWin(); hideLose(); hidePause();

  // trạng thái
  S.drag = null; S.selected = null; S.luuTui = null;
  S.checked = new Set(); S.gone = new Set(); S.winFrames = 0; S.won = false; S.lost = false; S.paused = false;
  resetDoVo();   // đồ dễ vỡ của ván trước không còn bị theo dõi
  S.unlockFrames = 0; S.unlockHinted = false; S.puffs = [];
  clearFx(); duckMusic(false);
  S.startTime = performance.now(); S.shownSec = -1;
  S.timeLeft = (level.timer || 90) * 1000;
  resetBoosts();

  // vật lý
  createWorld();
  S.bodies = [];
  level.items.forEach((it, i) => {
    const def = defById(it.id); if (!def) return;
    let x = it.x, y = it.y;
    if (it.inBag) { const a = toAbs(it.x ?? 0, it.y ?? -30); x = a.x; y = a.y; }
    if (x == null || y == null) { const col = i % 6, row = Math.floor(i / 6); x = 40 + col * ((W - 80) / 5); y = TABLE_Y + 30 + row * 70; }
    const b = makeItem(it.locked ? MYSTERY : def, x, y);
    b.itemId = def.id; b.label = def.slug; b.realDef = def; b.locked = !!it.locked;
    // Khoá riêng của TỪNG món trong level (thứ tự trong level.items). Một level có thể có
    // hai quả táo cùng itemId; đếm đã xếp / đã bỏ theo itemId thì hai quả chỉ tính là một.
    b.khoa = i;
    b.datSan = !!it.inBag;
    // Cỡ riêng của món trong CHÍNH level này, không đụng tới món ở level khác
    const k = coTrongLevel(level, it);
    if (k !== 1) { Body.scale(b, k, k); b.artScale *= k; b.levelScale = k; }
    Body.setAngle(b, it.angle || 0);
    S.bodies.push(b);
  });
  thaDoVaoSan();
  sfx('whoosh', { gain: .34, rate: .88 });   // một nhịp mở màn trước khi đồ đổ xuống
  createTethers();
  renderList(true);
  batDauLuot();   // event level_start (chỉ app Android, xem game/events.js)
}

/** Thanh tên level trên HUD; gọi lại khi đổi ngôn ngữ giữa ván */
function veThanhTen() {
  const level = S.LEVEL; if (!level) return;
  renderHeader({
    eyebrow: S.map ? t('eyebrow', { no: S.map.no || 1, name: chapterName(S.map), n: S.levelIdx + 1 }) : t('level', { n: S.levelIdx + 1 }),
    title: `Level ${soThuTuLevel(S.mapId, S.levelIdx)}`,   // không còn tên level riêng
    cls: SCENE_CLS[Number(level.background)] || '',
  });
}
onLangChange(veThanhTen);

// Mở màn: đồ mưa từ trên đỉnh màn xuống sân, lần lượt chứ không đổ ụp một lúc.
// Rơi cùng lúc thì mấy chục cú va chạm dồn vào một phần tư giây, nghe thành một tiếng ù
// và mắt cũng không kịp thấy gì. Món giữ cột x người thiết kế đặt, chỉ khởi hành từ trên
// cao và va vào túi như thật: trúng vai túi thì trượt xuống hai bên. Món nào xuất phát ngay
// trên chóp túi thì dời sang bên một chút, không thì nó nằm cân bằng trên chóp.
const NHIP_THA = 110;         // mili giây giữa hai món
const CHO_DAU = 150;          // nghỉ một nhịp trước khi món đầu tiên rơi
const CAO_ROI = 90;           // món xuất phát cách đỉnh màn chừng này phía trên
const TRANH_CHOP = 62;        // không thả món trong dải rộng chừng này hai bên tâm túi

function thaDoVaoSan() {
  const datSan = S.bodies.filter(b => b.datSan);
  const roiXuong = S.bodies.filter(b => !b.datSan).sort((a, b) => b.position.y - a.position.y);
  World.add(S.world, datSan);                      // món đặt sẵn trong túi có mặt ngay
  const t0 = S.clock + CHO_DAU;
  roiXuong.forEach((b, i) => {
    b.chuaVao = true; b.vaoLuc = t0 + i * NHIP_THA;
    // Khung xem thử của editor: đồ nằm đúng chỗ người dựng đặt, không mưa từ trên đỉnh —
    // mỗi lần chỉnh một chi tiết là khung dựng lại, mưa lại một lượt thì không nhìn được gì.
    if (S.preview) return;
    // đưa lên trên đỉnh màn, giữ cột x (tránh dải ngay trên chóp túi); góc xoay như người thiết kế đặt
    let x = b.position.x;
    const lech = x - BAG.cx;
    if (Math.abs(lech) < TRANH_CHOP) x = BAG.cx + (lech === 0 ? (i % 2 ? 1 : -1) : Math.sign(lech)) * TRANH_CHOP;
    Body.setPosition(b, { x, y: -CAO_ROI - Math.random() * 40 });
  });
}

/** Thả một món đang chờ vào thế giới vật lý ngay lúc này (mở màn dùng lần lượt, máy tự chơi dùng một lượt) */
export function thaVaoSan(b) {
  b.chuaVao = false;
  // Xuyên qua trần vô hình ở ngoài màn; vào tới màn rồi thì va chạm bình thường (kể cả với túi)
  b.dangRoi = true;
  b.collisionFilter = { ...b.collisionFilter, mask: (b.collisionFilter.mask ?? 0xFFFFFFFF) & ~NHOM_TRAN };
  for (const p of b.parts) if (p !== b) p.collisionFilter = { ...p.collisionFilter, mask: b.collisionFilter.mask };
  Body.setVelocity(b, { x: (Math.random() - .5) * 1.2, y: 2 + Math.random() * 2 });
  Body.setAngularVelocity(b, (Math.random() - .5) * .08);
  World.add(S.world, b);
}

/** Gọi mỗi khung hình: thả những món đã tới lượt vào thế giới vật lý */
export function tickEntrance() {
  if (!S.world) return;
  const now = S.clock;
  for (const b of S.bodies) {
    if (!b.chuaVao || now < b.vaoLuc) continue;
    thaVaoSan(b);
  }
  tickTuiHien();
  for (const b of S.bodies) {
    if (!b.dangRoi) continue;
    if (b.bounds.min.y > 0) {
      b.dangRoi = false;
      b.collisionFilter = { ...b.collisionFilter, mask: 0xFFFFFFFF };
      for (const p of b.parts) if (p !== b) p.collisionFilter = { ...p.collisionFilter, mask: 0xFFFFFFFF };
    }
  }
}

// Túi hiện ra khi cả đống đồ đã xuống sân và nằm yên (hoặc quá CHO_TUI_TOI_DA sau món cuối,
// kẻo một món lăn mãi giữ túi ẩn hoài). Hiệu ứng nảy lên và bụi vẽ ở art/bags.js + render.js.
const YEN = .7, CHO_TUI_TOI_DA = 2600;
function tickTuiHien() {
  if (S.tuiDaDung || !S.bodies.length) return;
  const conRoi = S.bodies.some(b => b.chuaVao || b.dangRoi || b.speed > YEN);
  const cuoi = Math.max(0, ...S.bodies.map(b => b.vaoLuc || 0));
  if (conRoi && S.clock < cuoi + CHO_TUI_TOI_DA) return;
  dungTui();
  sfx('whoosh', { gain: .45, rate: 1.05 });
  sfx('land', { gain: .5, rate: .7, delay: .22 });      // đúng lúc túi chạm đáy ở cuối cú nảy
  const y = BAG.bottom + 8;
  dust(BAG.cx - 40, y, { n: 6, manh: .8 }); dust(BAG.cx + 40, y, { n: 6, manh: .8 });
  ring(BAG.cx, (BAG.top + BAG.bottom) / 2, { color: 'rgba(255,255,255,.7)', r0: 20, r1: 130, life: 520, width: 3 });
}

/** Tải level thứ idx của map hiện tại rồi dựng */
export async function loadAndBuild(idx) {
  S.levelIdx = Math.max(0, Math.min(idx, S.map.levels.length - 1));
  if (S.map && !S.preview) setSpot(S.map.id, S.levelIdx);
  const level = S.map.levels[S.levelIdx];   // level nằm sẵn trong file sắp xếp
  build(level);
  return level;
}

export function restart() { build(S.LEVEL); }
export function nextLevel() { return loadAndBuild((S.levelIdx + 1) % S.map.levels.length); }
export function prevLevel() { return loadAndBuild((S.levelIdx - 1 + S.map.levels.length) % S.map.levels.length); }
