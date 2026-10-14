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

// ---------------- sinh collider cho một món ----------------
// 16 đỉnh là đủ cho hình đặc, nhưng hình có chỗ lõm cong (tai nghe chụp tai, đồng hồ có chuông,
// mặt trăng khuyết) thì bước rút gọn lấp luôn chỗ lõm thành một cạnh thẳng — vùng va chạm to
// hơn hình thật, người chơi thấy món "chạm" nhau giữa khoảng trống. 40 đỉnh thì ôm được cả vòng
// cong; poly-decomp cắt thành vài mảnh lồi, vật lý vẫn nhẹ với ≤11 món một màn.
const TOI_DA_DINH = 40;
// Chỉ dò VIỀN NGOÀI. Lỗ kín bên trong (vòng carabiner, lõi cuộn dây, lỗ mở chai) cố ý để lấp:
// chạm viền ngoài là đã tính va chạm, lỗ rỗng không có giá trị gì trong luật chơi — quyết định
// của designer (2026-10-14). Đừng thêm dò lỗ.
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
  return { collider: { kind: 'poly', pts }, outline, soDinh: pts.length, rong, cao, dt: Math.abs(dienTich(pts)) };
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
      id, ten: man.name || cu?.name, kieu: kq.collider.kind, dinh: kq.soDinh, vien: kq.outline.length,
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
