// Nhập một loạt túi/khay DÁNG CỐ ĐỊNH vẽ phẳng (bộ CTR_11–50: lòng túi là mảng màu phẳng,
// quanh là dải viền, có thể chia NHIỀU NGĂN bằng vách mỏng).
//
// Chạy: node tools/import_containers.mjs <thư mục ảnh> [--art cozy] [--vao 01-school-day]
//        [--ten tools/ten_tui_vi.csv] [--dt 34000] [--ke 28] [--bang out.png] [--ghi] [ctr11 ctr37 …]
//   không có --ghi thì chỉ in bảng và vẽ ảnh kiểm tra (--bang), không sửa file nào
//
// Mỗi ảnh:
//   1. Làm sạch nền, lấy mặt nạ phần đục.
//   2. Dò NGĂN: chia điểm đục thành các vùng cùng màu (điểm kề nhau lệch màu ít thì cùng vùng).
//      Vùng chạm nền trong suốt là dải viền ngoài. Vùng còn lại đủ to và đủ "mập" (co 2% cạnh
//      vẫn còn) là ngăn; vùng mỏng là vách.
//   3. Lòng túi (`inner`) = các ngăn nối lại qua vách (phép đóng hình thái) → một đa giác.
//      Vách giữa các ngăn (`walls`) = lòng túi trừ các ngăn → từng mảng thành đa giác (mảng có
//      lỗ thì cắt dọc qua tâm lỗ thành các mảnh đơn). Game coi vách như vật cản cố định của túi.
//   4. Cỡ: lòng túi (kể cả vách) có diện tích --dt đơn vị² ở scale 1, như các túi đang có
//      (24–42 nghìn, trung vị ~34 nghìn); kẹp thêm để cả túi ≤ 340×300 đơn vị.
//   5. Hai lớp ảnh như import_bag: body nguyên tấm, frame = tấm trừ các ngăn (vẽ đè lên đồ).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { docPNG, ghiPNG } from './png.mjs';
import { lamSach, thuNho, no, LE, NGUONG } from './anh.mjs';
import { doVien, rutGon, dienTich, trongTam } from './vien.mjs';
import { ART, ARGS, CONTENT } from './art.mjs';

const opt = (k, mac) => { const i = ARGS.indexOf('--' + k); return i >= 0 ? ARGS[i + 1] : mac; };
const CO = new Set(['vao', 'ten', 'dt', 'ke', 'phang', 'bang']);
const tuDo = ARGS.filter((a, i) => !a.startsWith('--') && !(ARGS[i - 1]?.startsWith('--') && CO.has(ARGS[i - 1].slice(2))));
const DIR = tuDo.find(a => existsSync(a) && statSync(a).isDirectory());
const CHON = new Set(tuDo.filter(a => a !== DIR));
const VAO = opt('vao', '01-school-day'), TEN = opt('ten', 'tools/ten_tui_vi.csv');
const DT = Number(opt('dt', 34000));
const BANG = opt('bang'), GHI = ARGS.includes('--ghi');
const PPU = 3, DINH_LONG = 48, DINH_VACH = 90;   // vách là mạng lưới mỏng (tổ ong, xoắn ốc) cần nhiều đỉnh mới bám được
const TOL_KE = Number(opt('ke', 40));   // điểm lệch màu với điểm gốc của vùng quá mức này là khác vùng
const PHANG = Number(opt('phang', 14)); // điểm lệch màu với điểm kề quá mức này là mép răng cưa, không thuộc vùng nào
const MAX_W = 340, MAX_H = 300;
if (!DIR) { console.error('Cần thư mục ảnh. Xem đầu file để biết cách chạy.'); process.exit(1); }

// ---------- tên ----------
const ten = {};
for (const dong of readFileSync(TEN, 'utf8').trim().split('\n').slice(1)) {
  const [file, id, nameEn, nameVi] = dong.split(',');
  ten[file] = { id, nameEn, nameVi };
}

// ---------- hình thái ----------
const dao = m => { const r = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) r[i] = m[i] ? 0 : 1; return r; };
const co = (m, w, h, r) => dao(no(dao(m), w, h, r));          // co lại r px
const dong = (m, w, h, r) => co(no(m, w, h, r), w, h, r);      // đóng: nở rồi co, lấp khe < 2r

/** Mảng liền 4 hướng của mặt nạ */
function thanhPhan(m, w, h) {
  const nhan = new Int32Array(w * h).fill(-1), hang = new Int32Array(w * h), ra = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || nhan[s] >= 0) continue;
    let dau = 0, cuoi = 0; hang[cuoi++] = s; nhan[s] = ra.length;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, chamBien = false;
    while (dau < cuoi) {
      const p = hang[dau++], x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (!x || !y || x === w - 1 || y === h - 1) chamBien = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (m[q] && nhan[q] < 0) { nhan[q] = ra.length; hang[cuoi++] = q; }
      }
    }
    ra.push({ idx: hang.slice(0, cuoi), dem: cuoi, x0, x1, y0, y1, chamBien });
  }
  return ra;
}
/**
 * Mảng liền 4 hướng của điểm đục PHẲNG (lệch màu với mọi điểm kề ≤ `phang`), nối hai điểm kề
 * khi màu gần nhau. Mép khử răng cưa giữa hai mảng màu đổi dần từng px, không loại ra thì
 * vùng này "chảy" sang vùng kia qua mép. Vùng có điểm cách nền trong suốt ≤ `gan` px là dải viền ngoài.
 */
function vungMau(px, duc, w, h, tol, phang, gan) {
  const ganNen = no(dao(duc), w, h, gan);
  const laPhang = new Uint8Array(w * h), p2 = phang * phang;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!duc[i]) continue;
    let ok = 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx; if (!duc[q]) continue;
      const dr = px[i * 4] - px[q * 4], dg = px[i * 4 + 1] - px[q * 4 + 1], db = px[i * 4 + 2] - px[q * 4 + 2];
      if (dr * dr + dg * dg + db * db > p2) { ok = 0; break; }
    }
    laPhang[i] = ok;
  }
  const nhan = new Int32Array(w * h).fill(-1), hang = new Int32Array(w * h), ra = [];
  const t2 = tol * tol;
  for (let s = 0; s < w * h; s++) {
    if (!laPhang[s] || nhan[s] >= 0) continue;
    let dau = 0, cuoi = 0; hang[cuoi++] = s; nhan[s] = ra.length;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, chamNen = false;
    const s4 = s * 4, mau = [px[s4], px[s4 + 1], px[s4 + 2]];
    while (dau < cuoi) {
      const p = hang[dau++], x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (ganNen[p]) chamNen = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!laPhang[q] || nhan[q] >= 0) continue;
        const q4 = q * 4, dr = mau[0] - px[q4], dg = mau[1] - px[q4 + 1], db = mau[2] - px[q4 + 2];
        if (dr * dr + dg * dg + db * db > t2) continue;   // so với màu điểm gốc, không trôi dần
        nhan[q] = ra.length; hang[cuoi++] = q;
      }
    }
    ra.push({ idx: hang.slice(0, cuoi), dem: cuoi, x0, x1, y0, y1, chamNen });
  }
  return { vung: ra, nhan };
}
const matNaCua = (tp, w, h) => { const m = new Uint8Array(w * h); for (const i of tp.idx) m[i] = 1; return m; };

function loang(batDau, duoc, w, h) {
  const m = new Uint8Array(w * h), hang = new Int32Array(w * h);
  let dau = 0, cuoi = 0;
  for (const s of batDau) if (duoc(s) && !m[s]) { m[s] = 1; hang[cuoi++] = s; }
  while (dau < cuoi) {
    const p = hang[dau++], x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!m[q] && duoc(q)) { m[q] = 1; hang[cuoi++] = q; }
    }
  }
  return m;
}
/** Lấp lỗ: điểm nền không đi ra tới mép ảnh được thì thuộc mặt nạ */
function lapLo(m, w, h) {
  const mep = [];
  for (let x = 0; x < w; x++) mep.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) mep.push(y * w, y * w + w - 1);
  const ngoai = loang(mep, i => !m[i], w, h);
  const r = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) r[i] = ngoai[i] ? 0 : 1;
  return r;
}

/** Lấp những lỗ li ti (nền giấy nhám) trong mặt nạ một vùng; lỗ to (ruột vòng) giữ nguyên */
function lapLoNho(m, v, w, h) {
  const nen = new Uint8Array(w * h);
  for (let y = v.y0; y <= v.y1; y++) for (let x = v.x0; x <= v.x1; x++) if (!m[y * w + x]) nen[y * w + x] = 1;
  const r = Uint8Array.from(m), nho = Math.max(200, v.dem * .01);
  for (const c of thanhPhan(nen, w, h)) {
    if (c.dem >= nho || c.x0 <= v.x0 || c.x1 >= v.x1 || c.y0 <= v.y0 || c.y1 >= v.y1) continue;
    for (const i of c.idx) r[i] = 1;
  }
  return r;
}

// ---------- đa giác ----------
function daGiac(mask, w, h, toiDa, epsDau = 1.5) {
  const vien = doVien(mask, w, h);
  if (vien.length < 6) return null;
  let eps = epsDau, gon = vien;
  for (let i = 0; i < 40; i++) {
    gon = rutGon([...vien, vien[0]], eps); gon.pop();
    if (gon.length <= toiDa) break;
    eps *= 1.2;
  }
  return gon.length >= 3 ? gon : null;
}
/** Một mảng (có thể có lỗ) → các đa giác đơn (px ảnh) */
function daGiacManh(tp, w, h, toiDa) {
  const m = matNaCua(tp, w, h);
  // lỗ: mảng nền nằm trong khung của mảng, không chạm mép ảnh, đủ to
  const nen = new Uint8Array(w * h);
  for (let y = tp.y0; y <= tp.y1; y++) for (let x = tp.x0; x <= tp.x1; x++) if (!m[y * w + x]) nen[y * w + x] = 1;
  const lo = thanhPhan(nen, w, h).filter(c => c.dem >= 60 && c.x0 > tp.x0 && c.x1 < tp.x1 && c.y0 > tp.y0 && c.y1 < tp.y1);
  if (!lo.length) { const p = daGiac(m, w, h, toiDa); return p ? [p] : []; }
  const cat = [...new Set(lo.map(c => Math.round(c.idx.reduce((s, i) => s + i % w, 0) / c.dem)))].sort((a, b) => a - b);
  const ra = [];
  for (let s = 0; s <= cat.length; s++) {
    const dai = new Uint8Array(w * h);
    for (const i of tp.idx) { const x = i % w; if (cat.filter(c => c <= x).length === s) dai[i] = 1; }
    for (const c of thanhPhan(dai, w, h)) {
      if (c.dem < 40) continue;
      const p = daGiac(matNaCua(c, w, h), w, h, toiDa);
      if (p && Math.abs(dienTich(p)) > 20) ra.push(p);
    }
  }
  return ra;
}

// ---------- xử lý một túi ----------
function xuLy(file) {
  const anh = docPNG(file);
  const { w, h, px } = anh;
  const khung = lamSach(anh);
  const duc = new Uint8Array(w * h);
  let soDuc = 0;
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > NGUONG) { duc[i] = 1; soDuc++; }
  const canh = Math.min(khung.x1 - khung.x0, khung.y1 - khung.y0);

  // 2. vùng cùng màu: hai điểm kề nhau cùng vùng khi màu gần nhau (nền giấy nhám lệch ít,
  //    sang dải viền hay vách là nhảy màu). Vùng chạm nền trong suốt là dải viền ngoài.
  const { vung, nhan: nhanVung } = vungMau(px, duc, w, h, TOL_KE, PHANG, Math.round(canh * .012));   // mép ảnh mềm, dải viền phẳng bắt đầu cách nền vài px
  const rNgan = Math.round(canh * .02);
  const W = new Uint8Array(w * h), nhanNgan = new Int32Array(w * h).fill(-1), ngan = [];
  for (const v of vung) {
    if (v.chamNen || v.dem < soDuc * .01) continue;
    // ngăn phải "mập" (vách, vòng ngăn mỏng thì co là mất)
    const m = matNaCua(v, w, h);
    // co rNgan px phải còn ≥ 30% diện tích: mạng vách (nan hoa + vòng) chỗ giao nhau dày hơn 2·rNgan
    // nên co vẫn sót lại một chấm, nhưng mất gần hết diện tích
    let conLai = 0; for (const x of co(lapLoNho(m, v, w, h), w, h, rNgan)) conLai += x;
    if (conLai < v.dem * .3) continue;
    let R = 0, G = 0, B = 0; for (const i of v.idx) { R += px[i * 4]; G += px[i * 4 + 1]; B += px[i * 4 + 2]; }
    for (const i of v.idx) { W[i] = 1; nhanNgan[i] = ngan.length; }
    ngan.push({ dem: v.dem, mau: [R, G, B].map(x => Math.round(x / v.dem)), khung: `${v.x0}-${v.x1},${v.y0}-${v.y1}` });
  }
  if (process.env.DEBUG) console.error('vùng', vung.length, 'ngăn', ngan, 'to nhất', [...vung].sort((a, b) => b.dem - a.dem).slice(0, 8).map(v => `${v.dem}${v.chamNen ? ' chạm nền' : ''} ${v.x0}-${v.x1},${v.y0}-${v.y1} ${co(lapLoNho(matNaCua(v, w, h), v, w, h), w, h, rNgan).some(x => x) ? 'mập' : 'mỏng'}`));
  if (!ngan.length) throw new Error('không dò được ngăn nào');
  // nuốt viền khử răng cưa quanh ngăn
  const W2 = no(W, w, h, 2); for (let i = 0; i < w * h; i++) if (!duc[i]) W2[i] = 0;

  // 3. lòng túi = các ngăn nối lại, phép đóng bắc cầu qua vách giữa các ngăn (khe < 2d).
  //    Không gộp các vùng khác (vòng viền trong của dải viền ngoài không phải lòng túi).
  const d = Math.round(canh * .035);
  const H0 = W2;
  let H = dong(H0, w, h, d);
  H = lapLo(H, w, h);
  for (let i = 0; i < w * h; i++) if (!duc[i]) H[i] = 0;
  const tpH = thanhPhan(H, w, h).sort((a, b) => b.dem - a.dem)[0];
  H = matNaCua(tpH, w, h);
  const V = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (H[i] && !W2[i]) V[i] = 1;
  // giữ mảng vách chạm ≥ 2 ngăn, nằm lọt giữa các ngăn (không ra tới mép lòng túi), hoặc phần lớn
  // điểm thuộc vùng màu bên trong (nét xoắn ốc nối với viền). Mảng toàn điểm của dải viền ngoài
  // chỉ là góc lõm bị phép đóng lấp, không phải vách thật
  const vachGiu = thanhPhan(V, w, h).filter(c => {
    if (c.dem < tpH.dem * .001) return false;
    const chamNgan = new Set(); let raMep = false, benTrong = 0;
    for (const i of c.idx) {
      const vg = nhanVung[i]; if (vg >= 0 && !vung[vg].chamNen) benTrong++;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { raMep = true; continue; }
        const q = ny * w + nx;
        if (!H[q]) raMep = true;
        if (nhanNgan[q] >= 0) chamNgan.add(nhanNgan[q]);
        else if (W2[q]) { // viền nuốt: tìm nhãn ngăn gần đó
          for (const [ex, ey] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const qq = (ny + ey) * w + nx + ex; if (qq >= 0 && qq < w * h && nhanNgan[qq] >= 0) chamNgan.add(nhanNgan[qq]); }
        }
      }
    }
    // mảng nhỏ nằm lọt trong một ngăn là hoạ tiết (mắt cá), không phải vách
    return chamNgan.size >= 2 || (c.dem >= tpH.dem * .01 && (!raMep || benTrong > c.dem * .5));
  });
  const vachPx = vachGiu.flatMap(c => daGiacManh(c, w, h, DINH_VACH));
  const longPx = daGiac(H, w, h, DINH_LONG);
  if (!longPx) throw new Error('không dò được viền lòng túi');

  // 4. cỡ
  let donVi = Math.sqrt(DT / tpH.dem);
  donVi = Math.min(donVi, MAX_W / (khung.x1 - khung.x0), MAX_H / (khung.y1 - khung.y0));
  const goc = [(tpH.x0 + tpH.x1 + 1) / 2, tpH.y1 + 1];
  const sangDonVi = p => p.map(([x, y]) => [+((x + .5 - goc[0]) * donVi).toFixed(1), +((y + .5 - goc[1]) * donVi).toFixed(1)]);
  const inner = sangDonVi(longPx), walls = vachPx.map(sangDonVi);

  // 5. ảnh
  const f = donVi * PPU;
  const body = thuNho(anh, khung, f);
  const frameSrc = { w, h, px: Buffer.from(px) };
  for (let i = 0; i < w * h; i++) if (W[i]) frameSrc.px[i * 4 + 3] = 0;
  const frame = thuNho(frameSrc, khung, f);
  const image = {
    x: +((khung.x0 - goc[0]) * donVi - LE / PPU).toFixed(2),
    y: +((khung.y0 - goc[1]) * donVi - LE / PPU).toFixed(2),
    w: +(body.w / PPU).toFixed(2), h: +(body.h / PPU).toFixed(2),
  };
  return { anh, khung, W, longPx, vachPx, ngan, inner, walls, image, body, frame, donVi, dtLong: tpH.dem * donVi * donVi, dtVach: walls.reduce((s, p) => s + Math.abs(dienTich(p)), 0) };
}

// ---------- ảnh kiểm tra ----------
const SO = { // font 3×5 cho chữ số
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};
function veBang(ketQua, duong) {
  const O = 300, CAO = O + 30, COT = 8, HANG = Math.ceil(ketQua.length / COT);
  const BW = COT * O, BH = HANG * CAO, px = Buffer.alloc(BW * BH * 4, 255);
  const cham = (x, y, c) => { if (x < 0 || y < 0 || x >= BW || y >= BH) return; const i = (y * BW + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const to = (x, y, c, a) => { if (x < 0 || y < 0 || x >= BW || y >= BH) return; const i = (y * BW + x) * 4; for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a); };
  const diem = (x, y, c, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) cham(Math.round(x + dx), Math.round(y + dy), c); };
  const doan = (a, b, c, r) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let i = 0; i <= n; i++) diem(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, c, r); };
  const chu = (s, x, y, c, k) => { let ox = x; for (const ch of s) { const g = SO[ch]; if (!g) { ox += 2 * k; continue; } g.forEach((row, gy) => [...row].forEach((v, gx) => { if (v === '1') for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) cham(ox + gx * k + a, y + gy * k + b, c); })); ox += 4 * k; } };
  ketQua.forEach((kq, n) => {
    const ox = (n % COT) * O, oy = Math.floor(n / COT) * CAO;
    chu(kq.so, ox + 8, oy + 6, [40, 40, 40], 4);
    if (!kq.r) { chu('0', ox + 60, oy + 6, [220, 0, 0], 4); return; }
    const { anh, khung, longPx, vachPx, W } = kq.r;
    const f = (O - 20) / Math.max(khung.x1 - khung.x0, khung.y1 - khung.y0);
    const nho = thuNho(anh, khung, f);
    const dx = ox + Math.round((O - nho.w) / 2), dy = oy + 30 + Math.round((O - nho.h) / 2);
    for (let y = 0; y < nho.h; y++) for (let x = 0; x < nho.w; x++) {
      const i = (y * nho.w + x) * 4, a = nho.px[i + 3] / 255; if (!a) continue;
      to(dx + x, dy + y, [nho.px[i], nho.px[i + 1], nho.px[i + 2]], a);
    }
    const toCell = ([x, y]) => [dx + LE + (x + .5 - khung.x0) * f, dy + LE + (y + .5 - khung.y0) * f];
    for (const p of vachPx) { const q = p.map(toCell); for (let i = 0; i < q.length; i++) doan(q[i], q[(i + 1) % q.length], [30, 90, 230], 1); }
    const q = longPx.map(toCell); for (let i = 0; i < q.length; i++) doan(q[i], q[(i + 1) % q.length], [230, 0, 0], 1);
  });
  ghiPNG(duong, { w: BW, h: BH, px });
}

// ---------- chạy ----------
const files = readdirSync(DIR).filter(f => /\.png$/i.test(f)).sort();
const bang = [], ketQua = [];
for (const f of files) {
  const t = ten[f];
  if (!t) { bang.push({ file: f, ghiChu: 'không có trong bảng tên' }); continue; }
  if (CHON.size && !CHON.has(t.id)) continue;
  const so = (f.match(/\d+/) || [''])[0];
  try {
    const r = xuLy(join(DIR, f));
    const xs = r.inner.map(p => p[0]), ys = r.inner.map(p => p[1]);
    bang.push({ id: t.id, ten: t.nameVi, 'ngăn': r.ngan.length, 'vách': r.walls.length, 'đỉnh lòng': r.inner.length,
      'lòng túi': `${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}×${(Math.max(...ys) - Math.min(...ys)).toFixed(0)}`,
      'dt lòng': Math.round(r.dtLong), 'dt vách': Math.round(r.dtVach), 'cả túi': `${r.image.w.toFixed(0)}×${r.image.h.toFixed(0)}` });
    ketQua.push({ so, t, f, r });
  } catch (e) { bang.push({ id: t.id, ten: t.nameVi, ghiChu: 'LỖI: ' + e.message }); ketQua.push({ so, t, f, r: null }); }
}
console.log(`Bộ art ${ART} · ${ketQua.length} túi`);
console.table(bang);
if (BANG) { veBang(ketQua, BANG); console.log('Ảnh kiểm tra:', BANG); }
if (!GHI) { console.log('\nXem trước, chưa ghi gì. Thêm --ghi để ghi thật.'); process.exit(0); }

const thuMuc = `assets/${VAO}/bags`;
mkdirSync(resolve(CONTENT, thuMuc), { recursive: true });
const idxFile = resolve(CONTENT, 'assets/index.json');
const index = JSON.parse(readFileSync(idxFile, 'utf8'));
index.bags = index.bags || {};
let n = 0;
for (const { t, r } of ketQua) {
  if (!r) continue;
  ghiPNG(resolve(CONTENT, thuMuc, `${t.id}-body.png`), r.body);
  ghiPNG(resolve(CONTENT, thuMuc, `${t.id}-frame.png`), r.frame);
  const man = {
    id: t.id, name: t.nameVi, nameEn: t.nameEn, fixed: true, pixelsPerUnit: PPU,
    edge: null, inner: r.inner, walls: r.walls, image: r.image,
    layers: { body: `${thuMuc}/${t.id}-body.png`, frame: `${thuMuc}/${t.id}-frame.png` },
  };
  const duong = `${thuMuc}/${t.id}.json`;
  writeFileSync(resolve(CONTENT, duong), JSON.stringify(man, null, 2) + '\n');
  index.bags[t.id] = duong; n++;
}
writeFileSync(idxFile, JSON.stringify(index, null, 2) + '\n');
console.log(`\nĐã ghi ${n} túi vào ${thuMuc}, cập nhật mục lục.`);
