// Sinh lại vùng va chạm của từng món BÁM SÁT viền ảnh PNG, ghi vào manifest.
//
// Trước đây vùng va chạm nằm trong bảng viết tay src/data/items.js còn ảnh sinh riêng,
// hai bên không ai biết ai nên lệch nhau vài phần trăm: hai món chạm nhau đúng luật thì
// nét viền vẫn đè lên nhau, còn nhìn thì tưởng còn khe hở.
//
// Chạy: node build_colliders.mjs [--ghi] [--art casual] [mã món…]
//   không có --ghi thì chỉ xem trước; không ghi mã món thì làm mọi món của bộ art
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { docPNG } from './tools/png.mjs';
import { doVien, rutGon, dienTich } from './tools/vien.mjs';

import { CONTENT, ARGS } from './tools/art.mjs';
const CHI = new Set(ARGS.filter(a => /^-?\d+$/.test(a)));
const GHI = process.argv.includes('--ghi');
// --vien: chỉ sinh ĐƯỜNG VIỀN VẼ (outline), giữ nguyên collider đang có. Dùng cho món đã chỉnh
// collider bằng tay (bóng bay chỉ ôm quả bóng) hoặc khi chỉ muốn làm lại nét viền.
const CHI_VIEN = process.argv.includes('--vien');

// ---------------- mặt nạ vùng có màu ----------------
const NGUONG_ALPHA = 24;

/** Giữ lại mảng liền nhau lớn nhất, bỏ những đốm lẻ do khử răng cưa để lại */
function matNa(anh) {
  const { w, h, px } = anh;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = px[i * 4 + 3] > NGUONG_ALPHA ? 1 : 0;

  const nhan = new Int32Array(w * h).fill(-1);
  let nhanTot = -1, toNhat = 0;
  const hangDoi = new Int32Array(w * h);
  let soNhan = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || nhan[s] >= 0) continue;
    let dau = 0, cuoi = 0, dem = 0;
    hangDoi[cuoi++] = s; nhan[s] = soNhan;
    while (dau < cuoi) {
      const p = hangDoi[dau++]; dem++;
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (m[q] && nhan[q] < 0) { nhan[q] = soNhan; hangDoi[cuoi++] = q; }
      }
    }
    if (dem > toNhat) { toNhat = dem; nhanTot = soNhan; }
    soNhan++;
  }
  for (let i = 0; i < w * h; i++) if (nhan[i] !== nhanTot) m[i] = 0;
  return { m, soO: toNhat };
}

// ---------------- lỗ kín ----------------
// Một đa giác chỉ tả được viền ngoài; lỗ kín bên trong (vòng carabiner, lõi cuộn dây, lỗ mở
// chai) sẽ bị lấp dù bao nhiêu đỉnh. Designer muốn lỗ rỗng thật — sau này món nhỏ xếp vào
// được. Cách làm: cắt mặt nạ thân món theo các đường DỌC đi qua tâm từng lỗ; mỗi dải còn lại
// không chứa lỗ kín nào (lỗ nào cũng bị chính đường cắt qua tâm nó xẻ đôi, mảnh lỗ trong dải
// luôn chạm biên dải), nên từng mảnh của dải là một đa giác đơn. Gom các mảnh thành
// collider kiểu "polys"; Matter dựng thân nhiều phần, lỗ rỗng thật.
const LO_TOI_THIEU = 40;        // đơn vị², lỗ nhỏ hơn thì món nào cũng không chui vào được
const TOI_DA_DINH_MANH = 24;    // đỉnh tối đa của một mảnh
const MANH_TOI_THIEU = 24;      // px, mảnh nhỏ hơn là vụn do cắt, bỏ

/** Tách mặt nạ thành các thành phần liền nhau (4 hướng). Trả về [{m, dem, x0, x1, cx}] */
function thanhPhan(mask, w, h) {
  const nhan = new Int32Array(w * h).fill(-1), hang = new Int32Array(w * h);
  const ra = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || nhan[s] >= 0) continue;
    let dau = 0, cuoi = 0, sumX = 0, x0 = w, x1 = -1;
    hang[cuoi++] = s; nhan[s] = ra.length;
    while (dau < cuoi) {
      const p = hang[dau++], x = p % w, y = (p / w) | 0;
      sumX += x; if (x < x0) x0 = x; if (x > x1) x1 = x;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && nhan[q] < 0) { nhan[q] = ra.length; hang[cuoi++] = q; }
      }
    }
    const m = new Uint8Array(w * h);
    for (let i = 0; i < cuoi; i++) m[hang[i]] = 1;
    ra.push({ m, dem: cuoi, x0, x1, cx: sumX / cuoi });
  }
  return ra;
}

/** Các lỗ kín trong thân: thành phần nền KHÔNG chạm biên ảnh và đủ lớn */
function timLo(m, w, h, ppu) {
  const nen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) nen[i] = m[i] ? 0 : 1;
  const toiThieu = LO_TOI_THIEU * ppu * ppu;
  return thanhPhan(nen, w, h).filter(tp => {
    if (tp.dem < toiThieu) return false;
    for (let y = 0; y < h; y++) if (tp.m[y * w] || tp.m[y * w + w - 1]) return false;       // chạm mép trái/phải
    for (let x = 0; x < w; x++) if (tp.m[x] || tp.m[(h - 1) * w + x]) return false;         // chạm mép trên/dưới
    return true;
  });
}

/** Rút gọn một đường viền pixel về ≤ toiDa đỉnh, đổi sang đơn vị game quanh tâm ảnh */
function daGiacTuVien(vien, toiDa, anh, ppu) {
  let eps = Math.max(.9, Math.min(anh.w, anh.h) * 0.004), gon = vien;
  for (let i = 0; i < 24; i++) {
    gon = rutGon([...vien, vien[0]], eps); gon.pop();
    if (gon.length <= toiDa) break;
    eps *= 1.28;
  }
  const cx = anh.w / 2, cy = anh.h / 2;
  return gon.map(([x, y]) => [+((x + .5 - cx) / ppu).toFixed(2), +((y + .5 - cy) / ppu).toFixed(2)]);
}

/** Cắt thân theo đường dọc qua tâm từng lỗ, trả về các mảnh đa giác đơn */
function catTheoLo(m, lo, anh, ppu) {
  const { w, h } = anh;
  const cat = [...new Set(lo.map(l => Math.round(l.cx)))].sort((a, b) => a - b);
  const daiCua = x => cat.filter(c => c <= x).length;
  const soDai = cat.length + 1;
  const manh = [];
  for (let s = 0; s < soDai; s++) {
    const dai = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m[i] && daiCua(x) === s) dai[i] = 1;
    }
    for (const tp of thanhPhan(dai, w, h)) {
      if (tp.dem < MANH_TOI_THIEU) continue;
      const vien = doVien(tp.m, w, h);
      if (vien.length < 6) continue;
      const pts = daGiacTuVien(vien, TOI_DA_DINH_MANH, anh, ppu);
      if (pts.length >= 3 && Math.abs(dienTich(pts)) > 1) manh.push(pts);
    }
  }
  return manh;
}

// ---------------- sinh collider cho một món ----------------
// 16 đỉnh là đủ cho hình đặc, nhưng hình có chỗ lõm cong (tai nghe chụp tai, đồng hồ có chuông,
// mặt trăng khuyết) thì bước rút gọn lấp luôn chỗ lõm thành một cạnh thẳng — vùng va chạm to
// hơn hình thật, người chơi thấy món "chạm" nhau giữa khoảng trống. 40 đỉnh thì ôm được cả vòng
// cong; poly-decomp cắt thành vài mảnh lồi, vật lý vẫn nhẹ với ≤11 món một màn.
const TOI_DA_DINH = 40;
const TOI_DA_DINH_VIEN = 64;   // đường viền vẽ

function sinhCollider(duongDanAnh, ppu, buocLaCircle) {
  const anh = docPNG(duongDanAnh);
  const { m, soO } = matNa(anh);
  if (!soO) throw new Error('ảnh trống');
  const vien = doVien(m, anh.w, anh.h);
  if (vien.length < 8) throw new Error('viền quá ít điểm');

  // rút gọn dần cho tới khi đủ ít đỉnh; sai số tính bằng pixel ảnh
  // Bắt đầu từ sai số nhỏ như đường viền vẽ rồi mới nới dần: khởi đầu thô quá thì lần đầu đã
  // dưới trần đỉnh, loop dừng ngay dù còn dư đỉnh để ôm sát hơn.
  let eps = Math.max(.9, Math.min(anh.w, anh.h) * 0.004), gon = vien;
  for (let i = 0; i < 24; i++) {
    gon = rutGon([...vien, vien[0]], eps);
    gon.pop();
    if (gon.length <= TOI_DA_DINH) break;
    eps *= 1.28;
  }

  // Đổi sang đơn vị game, gốc đặt ở TÂM ẢNH: đa giác nằm đúng chỗ nó nằm trên ảnh.
  // Không dời về trọng tâm nữa. Trước đây có dời, để trọng tâm về (0,0) cho khớp chỗ Matter đặt
  // thân; nhưng dời đa giác là dời nó so với ảnh, món cân đối thì lệch vài px không thấy, quả
  // chuối cong thì vùng va chạm trượt hẳn ra ngoài. Giờ renderer vẽ ảnh bù độ lệch trọng tâm
  // (body.origin), đa giác giữ nguyên chỗ trên ảnh.
  const cx = anh.w / 2, cy = anh.h / 2;
  // Đường viền để VẼ (viền xanh/đỏ khi kéo, viền chọn, lớp băng): bám sát mép ảnh hơn nhiều so
  // với collider (collider rút còn ≤40 đỉnh cho vật lý nhẹ, vẽ ra thì góc bị gãy, lệch mép).
  // Chỉ để vẽ, vật lý không dùng.
  let epsV = Math.max(.9, Math.min(anh.w, anh.h) * 0.004), vienVe = vien;
  for (let i = 0; i < 24; i++) {
    vienVe = rutGon([...vien, vien[0]], epsV); vienVe.pop();
    if (vienVe.length <= TOI_DA_DINH_VIEN) break;
    epsV *= 1.2;
  }
  const outline = vienVe.map(([x, y]) => [+((x + .5 - cx) / ppu).toFixed(2), +((y + .5 - cy) / ppu).toFixed(2)]);
  const pts = gon.map(([x, y]) => [+((x + .5 - cx) / ppu).toFixed(2), +((y + .5 - cy) / ppu).toFixed(2)]);

  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const rong = Math.max(...xs) - Math.min(...xs), cao = Math.max(...ys) - Math.min(...ys);

  // Món vốn là hình tròn thì giữ hình tròn: lăn đúng chất hơn và rẻ hơn nhiều.
  // Chỉ khi ảnh TRÒN THẬT (gần vuông khung, lấp ≥ 95% hình tròn nội tiếp): cuộn tất tròn đạt,
  // còn quả táo có núm và lá (lấp 89%) thì không — vòng tròn bao quanh sẽ hở ở vai táo và
  // chọc qua cái lá, người chơi thấy viền không bám hình. Táo dùng đa giác, vẫn lăn được.
  const tronThat = Math.abs(Math.log(rong / cao)) < Math.log(1.08) && Math.abs(dienTich(pts)) / (Math.PI * (rong + cao) ** 2 / 16) > .95;
  if (buocLaCircle && tronThat) {
    // Hình tròn thì tâm đặt tại tâm ảnh: cách đo bán kính theo gốc chỉ đúng khi món nằm giữa ảnh,
    // mà ảnh đã cắt sát viền nên đúng.
    const r = +(pts.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / pts.length).toFixed(2);
    return { collider: { kind: 'circle', r }, outline, soDinh: 0, rong, cao, dt: Math.PI * r * r };
  }
  // Có lỗ kín → cắt thân thành các mảnh đơn ôm quanh lỗ. Viền ngoài (pts) giữ lại để vẽ và
  // để editor bắt chuột; vật lý dùng các mảnh.
  const lo = timLo(m, anh.w, anh.h, ppu);
  if (lo.length) {
    const parts = catTheoLo(m, lo, anh, ppu);
    if (parts.length) {
      return { collider: { kind: 'polys', parts, outer: pts }, outline, soLo: lo.length,
        soDinh: parts.reduce((s, p) => s + p.length, 0), rong, cao,
        dt: parts.reduce((s, p) => s + Math.abs(dienTich(p)), 0) };
    }
  }
  return { collider: { kind: 'poly', pts }, outline, soLo: 0, soDinh: pts.length, rong, cao, dt: Math.abs(dienTich(pts)) };
}

// ---------------- chạy ----------------
const index = JSON.parse(readFileSync(resolve(CONTENT, 'assets/index.json'), 'utf8'));
const { ITEM_DEFS, defById } = await import('./src/data/items.js');

const bang = [];
let loi = 0;
for (const [id, duong] of Object.entries(index.items)) {
  if (CHI.size && !CHI.has(id)) continue;
  const fileManifest = resolve(CONTENT, duong);
  const man = JSON.parse(readFileSync(fileManifest, 'utf8'));
  if (!man.sprite?.src) { bang.push({ id, ten: man.name, ghiChu: 'không có ảnh' }); continue; }
  const cu = defById(Number(id));
  try {
    const ppu = man.sprite.pixelsPerUnit || 3;
    const kq = sinhCollider(resolve(CONTENT, man.sprite.src), ppu, cu?.kind === 'circle');
    const cuRong = cu ? cu.box[2] - cu.box[0] : 0, cuCao = cu ? cu.box[3] - cu.box[1] : 0;
    bang.push({
      id, ten: man.name || cu?.name, kieu: kq.collider.kind, lo: kq.soLo || 0, dinh: kq.soDinh, vien: kq.outline.length,
      cu: `${cuRong}x${cuCao}`, moi: `${kq.rong.toFixed(0)}x${kq.cao.toFixed(0)}`,
      lech: cuRong ? `${((kq.rong / cuRong - 1) * 100).toFixed(0)}% / ${((kq.cao / cuCao - 1) * 100).toFixed(0)}%` : '—',
    });
    if (GHI) {
      if (!CHI_VIEN) man.collider = kq.collider;
      man.outline = kq.outline;
      writeFileSync(fileManifest, JSON.stringify(man, null, 2) + '\n');
    }
  } catch (e) {
    loi++;
    bang.push({ id, ten: man.name, ghiChu: 'LỖI: ' + e.message });
  }
}

console.table(bang);
console.log(GHI ? `\nĐã ghi collider vào ${bang.length - loi} manifest.` : '\nXem trước, chưa ghi gì. Thêm --ghi để ghi thật.');
if (loi) console.log(`${loi} món lỗi.`);
