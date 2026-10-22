// Công cụ thiết kế level "khít": tự chọn đồ và xếp sao cho lấp kín túi 80–93%.
// Không nằm trong game. Chạy trong trang editor (dev server), từ console:
//   const T = await import('/src/editor/thietke.js'); await T.khoiDong();
//   const tk = await T.thietKe('ctr11', [1.5, 1.35, 1.2, 1.05, .9], { giay: 35 });
//   const lv = T.thanhLevel(tk, 'sd-02', 2);   // level đủ: túi, đồ trên khay, độ khó, lời giải
//
// Cách làm, trên lưới ô C đơn vị (2):
//   xay   dựng dần từng món: mỗi lượt thử một mẫu món ở vài cỡ, đặt ở chỗ thấp nhất mà món
//         CHẠM SÁT nhiều mép nhất (mép túi lẫn mép món khác), chọn món vừa khít vừa to
//   lap2  nhét món nhỏ (thu tới 0.5) vào các khe còn lại, cho phép lặp món nhỏ
//   bom   phóng to dần từng món tại chỗ (nhích nhẹ) tới khi chạm kín xung quanh
//   kiemTra  đặt cả lời giải vào khung xem trước, chạy vật lý thật, phải thắng
// Lời giải ghi vào level.solution (gen/solution.js) để Máy chơi xếp lại đúng như vậy.
import { ITEM_DEFS } from '../data/items.js';
import { hinhMon } from '../gen/solver.js';
import { bbox, pointInPolygon, mulberry32 } from '../util/geom.js';
import { resolveContainer, vuaManHinh } from '../data/bag.js';
import { difficulty } from '../gen/difficulty.js';

export const C = 2;

// Không thu món xuống quá nhỏ (cỡ < CO_MIN): thu con con là trên điện thoại khó bấm trúng
// (game nhận chạm đúng theo hình món). Món vốn nhỏ (bút chì, son…) vẫn dùng bình thường.
export const CO_MIN = .8;
export const deBam = (id, s) => s >= CO_MIN - 1e-6;
const dienTich = p => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };
export const areaOf = id => hinhMon(id)?.reduce((t, p) => t + dienTich(p), 0) || 0;

// Lưới đang dùng (túi hoặc khay)
let G = null;
export const luoi = () => G;
export let skins = {}, info = {}, pool = [];

export async function khoiDong(art = 'cozy') {
  const idx = await (await fetch(`/content/${art}/assets/index.json`)).json();
  skins = {};
  for (const [k, p] of Object.entries(idx.bags)) skins[k] = await (await fetch(`/content/${art}/` + p)).json();
  info = {};
  for (const d of ITEM_DEFS) {
    if (d.id <= 0) continue;
    const h = hinhMon(d.id); if (!h) continue;
    const b = bbox(h.flat()); const A = h.reduce((t, p) => t + dienTich(p), 0);
    info[d.id] = { A, day: A / ((b.maxX - b.minX) * (b.maxY - b.minY)), ten: d.name, bay: d.meta?.physics === 'float' };
  }
  pool = Object.keys(info).map(Number).filter(id => !info[id].bay);
  return { tui: Object.keys(skins).length, mon: pool.length };
}

function dungLuoi(sh, extra = {}) {
  const bb = bbox(sh);
  const cols = Math.ceil((bb.maxX - bb.minX) / C), rows = Math.ceil((bb.maxY - bb.minY) / C);
  const bag = new Uint8Array(cols * rows); let tong = 0;
  const chan = (extra.blocks || []).map(b => [[b.x - b.w / 2, b.y - b.h / 2], [b.x + b.w / 2, b.y - b.h / 2], [b.x + b.w / 2, b.y + b.h / 2], [b.x - b.w / 2, b.y + b.h / 2]]);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = bb.minX + (c + .5) * C, y = bb.minY + (r + .5) * C;
    const v = pointInPolygon(x, y, sh) && !chan.some(q => pointInPolygon(x, y, q)) ? 1 : 0;
    bag[r * cols + c] = v; tong += v;
  }
  return { cols, rows, bag, tong, bb, sh, ...extra };
}

export function setBag(key, scale) {
  const sk = skins[key];
  const s = +(scale ?? Math.min(1.3, vuaManHinh(sk))).toFixed(3);
  const cont = resolveContainer({ skin: key, scale: s, cx: 210 }, { [key]: sk });
  G = dungLuoi(cont.shape, { cont, key, scale: s, blocks: cont.blocks || [] });
  return G;
}

// Mặt nạ của món ở góc a, cỡ s: các ô thuộc món + các ô viền ngay ngoài (để đo tiếp xúc)
const cacheMN = new Map();
export function matNa(id, a, s) {
  const k = `${id}|${a.toFixed(3)}|${s.toFixed(3)}`;
  if (cacheMN.has(k)) return cacheMN.get(k);
  const h = hinhMon(id).map(p => p.map(([x, y]) => [(x * Math.cos(a) - y * Math.sin(a)) * s, (x * Math.sin(a) + y * Math.cos(a)) * s]));
  const b = bbox(h.flat());
  const cw = Math.ceil((b.maxX - b.minX) / C), ch = Math.ceil((b.maxY - b.minY) / C);
  const cells = [], set = new Set();
  for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) {
    if (h.some(p => pointInPolygon(b.minX + (c + .5) * C, b.minY + (r + .5) * C, p))) { cells.push([r, c]); set.add(r * 4096 + c); }
  }
  const vien = [];
  for (const [r, c] of cells) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has((r + dr) * 4096 + c + dc)) vien.push([r + dr, c + dc]);
  const m = { cw, ch, cells, vien, minX: b.minX, minY: b.minY, a, s, n: cells.length };
  cacheMN.set(k, m);
  return m;
}

/** Chỗ thấp nhất của từng cột, chọn chỗ chạm sát nhiều mép nhất */
export function datMot(g, id, s, nGoc) {
  let best = null;
  for (let i = 0; i < nGoc; i++) {
    const m = matNa(id, i * 2 * Math.PI / nGoc, s);
    if (m.cw > G.cols || m.ch > G.rows) continue;
    for (let c0 = 0; c0 + m.cw <= G.cols; c0++) {
      for (let r0 = G.rows - m.ch; r0 >= 0; r0--) {
        let ok = true;
        for (const [r, c] of m.cells) if (!g[(r0 + r) * G.cols + c0 + c]) { ok = false; break; }
        if (!ok) continue;
        let tx = 0;
        for (const [r, c] of m.vien) { const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= G.rows || cc >= G.cols || !g[rr * G.cols + cc]) tx++; }
        const t = tx / m.vien.length, diem = t + .4 * (r0 + m.ch) / G.rows;
        if (!best || diem > best.diem) best = { diem, t, m, r0, c0 };
        break;
      }
    }
  }
  return best;
}
const toaDo = b => ({ a: b.m.a, x: G.bb.minX + b.c0 * C - b.m.minX, y: G.bb.minY + b.r0 * C - b.m.minY });
const ghiO = (g, b) => { for (const [r, c] of b.m.cells) g[(b.r0 + r) * G.cols + b.c0 + c] = 0; };
function luoiTu(out) {
  const g = G.bag.slice();
  for (const p of out) {
    const m = matNa(p.id, p.a, p.s);
    const r0 = Math.round((p.y + m.minY - G.bb.minY) / C), c0 = Math.round((p.x + m.minX - G.bb.minX) / C);
    for (const [r, c] of m.cells) { const rr = r0 + r, cc = c0 + c; if (rr >= 0 && cc >= 0 && rr < G.rows && cc < G.cols) g[rr * G.cols + cc] = 0; }
  }
  return g;
}
const doLap = g => { let trong = 0; for (const v of g) trong += v; return 1 - trong / G.tong; };

/** Dựng dần từng món. maxVuong: tỉ lệ tối đa món vuông vức (độ đầy khung ≥ .9) */
export function xay({ ds = pool, scales, mau = 22, nGoc = 8, rand, maxVuong = .5, han = 3000 }) {
  const t0 = performance.now();
  const g = G.bag.slice(), out = []; let daDung = 0;
  const maxA = Math.max(...ds.map(id => info[id].A)) * 1.96;
  while (performance.now() - t0 < han) {
    const nV = out.filter(o => info[o.id].day >= .9).length;
    const ung = ds.filter(id => !out.some(o => o.id === id) && !(info[id].day >= .9 && nV + 1 > Math.max(2, (out.length + 1) * maxVuong)))
      .sort(() => rand() - .5).slice(0, mau);
    let tot = null;
    for (const id of ung) for (const s of scales) {
      if (!deBam(id, s)) continue;
      const A = info[id].A * s * s;
      if (A > G.tong * C * C - daDung) continue;
      const b = datMot(g, id, s, nGoc); if (!b) continue;
      const diem = b.t + .9 * A / maxA;
      if (!tot || diem > tot.diem) tot = { diem, id, s, b, A };
      break;
    }
    if (!tot) break;
    ghiO(g, tot.b); daDung += tot.A;
    out.push({ id: tot.id, s: tot.s, ...toaDo(tot.b) });
  }
  return { out, fill: doLap(g) };
}

/** Nhét món nhỏ vào khe (cho lặp món nhỏ tối đa 2 lần trong một level) */
export async function lap2(out, { scales = [1.1, 1.0, .9, .8], nguong = .3, han = 15000, ds = pool } = {}) {
  const t0 = performance.now();
  const g = luoiTu(out), kq = out.map(o => ({ ...o }));
  const ung = ds.slice().sort((a, b) => info[b].A - info[a].A);
  while (performance.now() - t0 < han) {
    let tot = null;
    for (const id of ung) {
      if (kq.filter(o => o.id === id).length >= 2) continue;
      for (const s of scales) {
        if (!deBam(id, s)) continue;
        const b = datMot(g, id, s, 8);
        if (b && b.t >= nguong) { const A = info[id].A * s * s; if (!tot || A > tot.A) tot = { id, s, b, A }; break; }
      }
      if (performance.now() - t0 > han) break;
    }
    if (!tot) break;
    ghiO(g, tot.b); kq.push({ id: tot.id, s: tot.s, ...toaDo(tot.b) });
    await new Promise(r => setTimeout(r, 0));
  }
  return { out: kq, fill: doLap(g) };
}

/** Phóng to dần từng món tại chỗ (nhích ±dich ô, xoay nhẹ) tới khi chạm kín */
export function bom(out, { smax = 1.6, buoc = .02, dich = 2, vong = 12, xoay = .08 } = {}) {
  const ds = out.map(p => ({ ...p }));
  const g = luoiTu(ds);
  const viTri = (m, x, y) => [Math.round((y + m.minY - G.bb.minY) / C), Math.round((x + m.minX - G.bb.minX) / C)];
  const vua = (m, r0, c0) => { for (const [r, c] of m.cells) { const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= G.rows || cc >= G.cols || !g[rr * G.cols + cc]) return false; } return true; };
  const dat = (m, r0, c0, v) => { for (const [r, c] of m.cells) g[(r0 + r) * G.cols + c0 + c] = v; };
  for (let v = 0; v < vong; v++) {
    let lon = false;
    for (const p of ds) {
      if (p.s >= smax) continue;
      const m0 = matNa(p.id, p.a, p.s); const [r0, c0] = viTri(m0, p.x, p.y);
      dat(m0, r0, c0, 1);
      let tot = null;
      for (const da of [0, -xoay, xoay]) {
        const s = Math.min(smax, p.s + buoc), a = p.a + da, m = matNa(p.id, a, s);
        const [br, bc] = viTri(m, p.x, p.y);
        for (let dr = -dich; dr <= dich && !tot; dr++) for (let dc = -dich; dc <= dich; dc++) {
          if (vua(m, br + dr, bc + dc)) { tot = { s, a, x: p.x + dc * C, y: p.y + dr * C, m, r: br + dr, c: bc + dc }; break; }
        }
        if (tot) break;
      }
      if (tot) { Object.assign(p, { s: tot.s, a: tot.a, x: tot.x, y: tot.y }); dat(tot.m, tot.r, tot.c, 0); lon = true; }
      else dat(m0, r0, c0, 0);
    }
    if (!lon) break;
  }
  return { out: ds, fill: doLap(g) };
}

/** Bày đồ ra khay (dưới túi): thả từng món, to trước, xoay ngẫu nhiên, không chồng nhau */
export function khay(list, seed = 1) {
  const rand = mulberry32(seed);
  const cu = G;
  G = dungLuoi([[6, 452], [414, 452], [414, 629], [6, 629]]);
  const g = G.bag.slice(), out = [];
  const ds = list.map((x, i) => ({ ...x, i })).sort((a, b) => info[b.id].A * b.s * b.s - info[a.id].A * a.s * a.s);
  for (const it of ds) {
    let best = null;
    for (let k = 0; k < 8; k++) {
      const a = +((rand() - .5) * .6 + (rand() < .3 ? Math.PI / 2 : 0)).toFixed(3);
      const m = matNa(it.id, a, it.s);
      for (let c0 = 0; c0 + m.cw <= G.cols; c0 += 2) {
        for (let r0 = G.rows - m.ch; r0 >= 0; r0--) {
          let ok = true;
          for (const [r, c] of m.cells) if (!g[(r0 + r) * G.cols + c0 + c]) { ok = false; break; }
          if (!ok) continue;
          const diem = r0 + m.ch + rand() * 6;
          if (!best || diem > best.diem) best = { diem, m, r0, c0 };
          break;
        }
      }
    }
    if (!best) { G = cu; return null; }
    ghiO(g, best);
    out[it.i] = { id: it.id, s: it.s, ...toaDo(best) };
  }
  G = cu;
  return out;
}

/** Đặt lời giải vào khung xem trước của editor, chạy vật lý thật: phải thắng */
export async function kiemTra(tk, cho = 4000) {
  const c = tk.cont;
  const lv = { id: 'thu', nameEn: 'x', timer: 180, background: 1, mode: 'fixed', container: c,
    items: tk.giai.map(p => ({ id: p.id, x: +(c.cx + p.x).toFixed(1), y: +(c.bottom + p.y).toFixed(1), angle: +p.a.toFixed(3), scale: +p.s.toFixed(3) })) };
  const f = document.querySelector('iframe');
  f.contentWindow.postMessage({ type: 'level', level: lv, index: 0, chapter: { id: 'school-day', no: 1, name: 'School Day' } }, '*');
  await new Promise(r => setTimeout(r, cho));
  const S = f.contentWindow.__game.S;
  const w = f.contentDocument.getElementById('win'); if (w) w.style.display = 'none';
  return { won: !!S.won, lechMax: Math.max(...S.bodies.map(b => { const it = lv.items[b.khoa]; return Math.round(Math.hypot(b.position.x - it.x, b.position.y - it.y)); })) };
}

/** Thiết kế một túi: dò nhiều lượt, lấy 3 phương án kín nhất, nhét khe + bơm cỡ, phải qua vật lý 2 lần */
export async function thietKe(key, scales, { giay = 35, seed = 1, ds = pool } = {}) {
  const nha = () => new Promise(r => setTimeout(r, 0));
  const t0 = performance.now(), dsPA = []; let sd = seed;
  while (performance.now() - t0 < giay * 1000) {
    setBag(key);
    const r = xay({ ds, rand: mulberry32(sd++), scales });
    if (r.out.length >= 4) dsPA.push(r);
    await nha();
  }
  dsPA.sort((a, b) => b.fill - a.fill);
  for (const r of dsPA.slice(0, 3)) {
    setBag(key);
    const l = await lap2(r.out, { han: 15000 });
    const b = bom(l.out, { smax: scales[0] + .15, vong: 12 });
    const tk = { key, scale: G.scale, cont: G.cont, giai: b.out.map(p => ({ ...p, s: p.s * .99 })), fill: b.fill * .98 };
    const k1 = await kiemTra(tk), k2 = await kiemTra(tk);
    if (k1.won && k2.won) return tk;
  }
  return null;
}

/** Level hoàn chỉnh từ một phương án: túi, đồ trên khay, độ khó, lời giải */
export function thanhLevel(tk, id, n) {
  const c = tk.cont, r3 = v => +(+v).toFixed(3), r1 = v => +(+v).toFixed(1);
  let k = null;
  for (let sd = 1; sd <= 12 && !k; sd++) k = khay(tk.giai.map(p => ({ id: p.id, s: r3(p.s) })), sd * 31 + n);
  if (!k) return null;
  const lv = {
    id, name: '', nameEn: 'Level ' + n, timer: 180, background: 1,
    container: { skin: tk.key, scale: r3(tk.scale), blocks: c.blocks || [], cx: c.cx, bottom: c.bottom, shape: c.shape.map(p => p.map(r1)) },
    mode: 'fixed',
    items: k.map(o => ({ id: o.id, x: r1(o.x), y: r1(o.y), angle: +o.a.toFixed(2), scale: r3(o.s) })),
    reward: { coin: 20 }, emptyText: 'Kéo đồ vào túi',
  };
  const d = difficulty(lv, areaOf); lv.difficulty = { points: d.total, tier: d.tier };
  lv.solution = tk.giai.map((p, i) => ({ i, id: p.id, s: r3(p.s), x: r1(c.cx + p.x), y: r1(c.bottom + p.y), angle: r3(p.a) }));
  return lv;
}

/** Cho Máy chơi (kiểu tay người, theo lời giải) chơi level trong khung xem trước: phải thắng */
export async function mayChoi(lv, han = 150000) {
  const f = document.querySelector('iframe');
  f.contentWindow.postMessage({ type: 'level', level: lv, index: 0, chapter: { id: 'school-day', no: 1, name: 'School Day' } }, '*');
  await new Promise(r => setTimeout(r, 3500));
  f.contentWindow.postMessage({ type: 'autoplay', human: true }, '*');
  const t0 = performance.now(); let S;
  while (performance.now() - t0 < han) {
    await new Promise(r => setTimeout(r, 1000));
    S = f.contentWindow.__game?.S; if (S?.won) break;
    if (performance.now() - t0 > 8000 && f.contentWindow.__game?.autoState?.() === 'idle') break;
  }
  f.contentWindow.__game?.stopAutoplay?.();
  return { won: !!S?.won, vao: S?.checked?.size || 0, can: S?.ITEMS?.length || 0, giay: Math.round((performance.now() - t0) / 1000) };
}

/** Thu mọi món nhỏ đi k lần (vị trí giữ nguyên), cho kẽ hở khi đặt lần lượt; không dưới CO_MIN */
export function thuNho(lv, k) {
  const l = JSON.parse(JSON.stringify(lv));
  for (const it of l.items) it.scale = +Math.max(CO_MIN, it.scale * k).toFixed(3);
  for (const st of l.solution) st.s = l.items[st.i].scale;
  return l;
}
