// Booster: Freeze (đóng băng vật lý trong túi 20 giây), Resize (thu nhỏ 20% món lớn nhất ngoài túi),
// Throw Out (bỏ 1 món thường).
// Mỗi loại có số lượt riêng, hiện badge trên nút.
import Matter from 'matter-js';
import { S, BAG, isHeld, daVao } from './state.js';
import { areaOf } from '../data/items.js';
import { removeBody } from './physics.js';
import { bagZone } from './rules.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../ui/sfx.js';
import { sparkle, ring, floatText } from './fx.js';
import { t, itemName } from '../i18n.js';
import { dungBooster } from './events.js';

const { Body } = Matter;

const els = {
  freeze: document.getElementById('bFreeze'),
  resize: document.getElementById('bResize'),
  throw: document.getElementById('bThrow'),
};

/** Số lượt mặc định mỗi level (GDD "Free ban đầu"); level JSON ghi đè qua level.boosters */
export const DEFAULT_BOOSTS = { freeze: 2, resize: 2, throw: 1 };

// ---------- kho booster của người chơi ----------
// Game thật (web, app): số lượt là KHO CHUNG, lưu trong máy, không hồi lại mỗi màn. Ban đầu có
// DEFAULT_BOOSTS; dùng lượt nào mất lượt đó, sang màn mới hay chơi lại cũng không hồi. Hết thì
// nút xám đi, không bấm được (sau này xem quảng cáo để nhận thêm: gọi themBooster).
// Editor (xem thử) và Creative vẫn đặt lại mỗi màn như cũ, để thử level và quay video không bị hết.
const KHO = 'snug.boosts.v1';
const dungKho = () => !S.preview && new URLSearchParams(location.search).get('creative') !== '1';
function docKho() {
  try { const k = JSON.parse(localStorage.getItem(KHO)); if (k && typeof k === 'object') return { ...DEFAULT_BOOSTS, ...k }; } catch {}
  return { ...DEFAULT_BOOSTS };
}
function luuKho() {
  if (!dungKho() || !S.boosts) return;
  try { localStorage.setItem(KHO, JSON.stringify(S.boosts)); } catch {}
}
/** Cộng thêm lượt vào kho (dùng sau này khi xem quảng cáo nhận booster) */
export function themBooster(loai, n = 1) {
  if (!S.boosts || !(loai in DEFAULT_BOOSTS)) return;
  S.boosts[loai] = (S.boosts[loai] || 0) + n;
  renderBoosts();
}

export function renderBoosts() {
  luuKho();   // mọi lần đổi số lượt đều đi qua đây: ghi kho luôn
  for (const k of Object.keys(els)) {
    const el = els[k];
    const dangBang = k === 'freeze' && freezeLeft() > 0;
    el.querySelector('.badge').textContent = dangBang ? Math.ceil(freezeLeft() / 1000) + 's' : S.boosts[k] ?? 0;
    el.classList.toggle('on', dangBang);
    el.disabled = dangBang || (S.boosts[k] ?? 0) <= 0;
  }
}

// Creative Tool đặt sẵn một con số cho cả ba loại (badge đẹp cho ảnh store, hoặc 0 để
// quay cảnh hết booster). null là theo level như bình thường.
export let boostOverride = null;
export function setBoostOverride(n) { boostOverride = n == null ? null : Math.max(0, n | 0); }

export function resetBoosts() {
  S.freezeUntil = 0; giayCu = -1;
  S.boosts = dungKho() ? docKho() : { ...DEFAULT_BOOSTS, ...(S.LEVEL?.boosters || {}) };
  if (boostOverride != null) S.boosts = { freeze: boostOverride, resize: boostOverride, throw: boostOverride };
  renderBoosts();
}

const largeIds = () => S.ITEMS.slice().sort((a, b) => areaOf(b) - areaOf(a)).slice(0, 3).map(d => d.id);

/** Món được phép bỏ: không phải 3 món lớn nhất, không buộc dây, không phải hộp bí ẩn hay chìa khóa */
function throwableItems() {
  const big = largeIds();
  return S.bodies.filter(b => daVao(b) && !b.tether && !b.locked && b.label !== 'key' && !big.includes(b.itemId) && !isHeld(b));
}

/** Throw Out: bỏ ngẫu nhiên một món thường, ưu tiên món còn nằm ngoài túi */
function useThrow() {
  if (S.boosts.throw <= 0 || S.won || S.lost) return;
  const all = throwableItems();
  if (!all.length) { sfx('nope'); return toast(t('nothingToThrow')); }
  const outside = all.filter(b => !bagZone(b).fullyInside);
  const pool = outside.length ? outside : all;
  const b = pool[Math.floor(Math.random() * pool.length)];
  S.puffs.push({ x: b.position.x, y: b.position.y, t: 0 });
  sfx('trash'); sparkle(b.position.x, b.position.y, { n: 16, color: '#E8434F', speed: 1.3 });
  floatText(b.position.x, b.position.y - 16, t('throwFloat'), { color: '#E8434F' });
  removeBody(b); S.gone.add(b.khoa);
  S.boosts.throw--; renderBoosts(); dungBooster('throw');
  toast(t('threw', { name: itemName(b.realDef) }));
}

// ---------- Đóng băng ----------
// Trong FREEZE_MS, mọi món nằm gọn trong túi và mọi món thả vào túi đều đứng yên đúng chỗ
// (thân tĩnh, không trọng lực, không bị đẩy), để xếp chồng hay kê chênh vênh mà không đổ.
// Hết giờ thì trả tất cả về cho vật lý. Tính theo đồng hồ game nên tạm dừng là băng cũng dừng.
export const FREEZE_MS = 20000;
const freezeLeft = () => Math.max(0, (S.freezeUntil || 0) - S.clock);
export const isFrozenTime = () => freezeLeft() > 0;

/** Đóng băng một món: đứng im ngay chỗ đang nằm */
export function freezeBody(b) {
  Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
  if (!b.isStatic) Body.setStatic(b, true);
  b.frozen = true; b.stuck = 0;
}
function unfreezeBody(b) {
  b.frozen = false;
  if (b.isStatic) Body.setStatic(b, false);
  Matter.Sleeping.set(b, false);
  Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
}

function useFreeze() {
  if (S.boosts.freeze <= 0 || S.won || S.lost || isFrozenTime()) return;
  S.boosts.freeze--; dungBooster('freeze');
  S.freezeUntil = S.clock + FREEZE_MS;
  for (const b of S.bodies) if (daVao(b) && !isHeld(b) && !b.giuToi && bagZone(b).fullyInside) freezeBody(b);
  sfx('shrink', { rate: .7 });
  ring(BAG.cx, (BAG.top + BAG.bottom) / 2, { color: '#7FC8F0', r1: 150, life: 600 });
  sparkle(BAG.cx, (BAG.top + BAG.bottom) / 2, { n: 26, color: '#BFE6FA', speed: 1.6 });
  renderBoosts();
  toast(t('frozen', { s: FREEZE_MS / 1000 }));
}

/** Gọi mỗi khung hình: đếm ngược trên nút, hết giờ thì tan băng */
let giayCu = -1;
export function tickFreeze() {
  if (!S.freezeUntil) return;
  const con = freezeLeft();
  for (const b of S.bodies) if (b.frozen) b.stuck = 0;   // đang băng thì không tính là kẹt mép túi
  if (con > 0) {
    const giay = Math.ceil(con / 1000);
    if (giay !== giayCu) { giayCu = giay; renderBoosts(); }
    return;
  }
  S.freezeUntil = 0; giayCu = -1;
  for (const b of S.bodies) if (b.frozen) unfreezeBody(b);
  renderBoosts();
}

function useResize() {
  if (S.boosts.resize <= 0 || S.won || S.lost) return;
  const cands = S.bodies.filter(b => daVao(b) && !bagZone(b).fullyInside && !isHeld(b) && b.label !== 'key');
  if (!cands.length) { sfx('nope'); return toast(t('nothingOutside')); }
  const b = cands.sort((x, y) => y.area - x.area)[0];
  Body.scale(b, .8, .8); b.artScale *= .8;   // GDD: thu nhỏ 20%
  S.puffs.push({ x: b.position.x, y: b.position.y, t: 0 });
  sfx('shrink'); ring(b.position.x, b.position.y, { color: '#3D8BFF', r1: 40, life: 420 });
  floatText(b.position.x, b.position.y - 18, '−20%', { color: '#2A66C8' });
  S.boosts.resize--; renderBoosts(); dungBooster('resize');
  toast(t('shrunk', { name: itemName(b.realDef) }));
}

export function bindBoosters() {
  els.freeze.addEventListener('click', useFreeze);
  els.resize.addEventListener('click', useResize);
  els.throw.addEventListener('click', useThrow);
}
