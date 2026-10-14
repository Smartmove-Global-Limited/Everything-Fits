// Nhập ảnh món mới (AI gen / designer vẽ) vào một bộ art, sẵn để game dùng.
//
// Chạy: node tools/import_items.mjs <thư mục hoặc file PNG…> [--art casual] [--ghi] [--scale 11=1.1 …]
//   không có --ghi thì chỉ in bảng xem trước, không sửa file nào
//
// Mỗi ảnh:
//   1. Nhận món theo mã trong tên file: ITM_011_tablet.png hay 011-tablet.png → món có code ITM_011.
//   2. Làm sạch nền: ảnh xoá nền bằng AI hay để lại hàng nghìn điểm gần trong suốt rải khắp
//      khung, mắt không thấy nhưng làm khung ảnh phình ra gần hết tấm. Chỉ giữ mảng liền lớn
//      nhất cùng viền khử răng cưa quanh nó, còn lại xoá sạch.
//   3. Cắt sát viền món (chừa LE px cho viền mềm).
//   4. Thu về đúng cỡ trong game: GIỮ DIỆN TÍCH món như vùng va chạm hiện có, để độ đầy của level
//      không nhảy lung tung khi đổi art. Dáng thì theo ảnh mới. --scale id=k phóng thêm k lần theo cạnh.
//   5. Ghi PNG đè vào đúng đường dẫn manifest đang trỏ, pixelsPerUnit = PPU, rồi sinh lại vùng
//      va chạm bằng build_colliders.mjs cho đúng những món vừa nhập.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { docPNG, ghiPNG } from './png.mjs';
import { lamSach, thuNho, LE } from './anh.mjs';
import { ART, ARGS, CONTENT } from './art.mjs';

const PPU = 4;            // ảnh lớn gấp 4 lần kích thước logic, như mọi món hiện có

const GHI = ARGS.includes('--ghi');
const SCALE = {};
for (let k = 0; k < ARGS.length; k++) if (ARGS[k] === '--scale') {
  const [id, v] = (ARGS[++k] || '').split('=');
  SCALE[id] = Number(v);
}
const nguon = ARGS.filter((a, k) => !a.startsWith('--') && ARGS[k - 1] !== '--scale');
if (!nguon.length) { console.error('Cần thư mục hoặc file PNG. Xem đầu file để biết cách chạy.'); process.exit(1); }

const files = nguon.flatMap(p => statSync(p).isDirectory()
  ? readdirSync(p).filter(f => /\.png$/i.test(f)).sort().map(f => join(p, f)) : [p]);

// ---------- tìm món theo mã ----------
const index = JSON.parse(readFileSync(resolve(CONTENT, 'assets/index.json'), 'utf8'));
const theoMa = {};
for (const [id, duong] of Object.entries(index.items)) {
  const man = JSON.parse(readFileSync(resolve(CONTENT, duong), 'utf8'));
  if (man.code) theoMa[man.code] = { id, duong, man };
}

// ---------- diện tích vùng va chạm hiện có ----------
function dienTich(c) {
  if (!c) return 0;
  if (c.kind === 'circle') return Math.PI * c.r * c.r;
  if (c.kind === 'rect') return c.w * c.h;
  if (c.kind === 'polys') return c.parts.reduce((t, pts) => t + dienTich({ kind: 'poly', pts }), 0);   // món có lỗ kín
  let s = 0;
  for (let i = 0; i < c.pts.length; i++) {
    const [x1, y1] = c.pts[i], [x2, y2] = c.pts[(i + 1) % c.pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// ---------- chạy ----------
const bang = [], daNhap = [];
for (const f of files) {
  // Tên file kiểu ITM_021_cap.png hay 021-baseball-cap.png đều nhận
  const ma = (basename(f).match(/ITM_(\d+)/i) || basename(f).match(/^(\d{3})[-_]/) || [])[1];
  const mon = ma && theoMa[`ITM_${ma.padStart(3, '0')}`];
  if (!mon) { bang.push({ file: basename(f), ghiChu: 'không tìm thấy món theo mã trong tên file' }); continue; }
  const { id, man } = mon;
  try {
    const anh = docPNG(f);
    const khung = lamSach(anh);
    const dtCu = dienTich(man.collider);
    if (!dtCu) throw new Error('món chưa có vùng va chạm để lấy diện tích');
    // đơn vị logic trên mỗi px ảnh nguồn, sao cho thân món mới rộng đúng bằng diện tích cũ
    const donVi = Math.sqrt(dtCu / khung.dem) * (SCALE[id] || 1);
    const ra = thuNho(anh, khung, donVi * PPU);
    const src = man.sprite?.src || `${mon.duong.replace(/\.json$/, '.png')}`;
    const cuW = man.collider.kind === 'circle' ? 2 * man.collider.r : null;
    bang.push({
      file: basename(f), id: Number(id), ten: man.name,
      'món chiếm': `${(((khung.x1 - khung.x0) * (khung.y1 - khung.y0)) / (anh.w * anh.h) * 100).toFixed(0)}% tấm gốc`,
      'cỡ mới': `${((ra.w - 2 * LE) / PPU).toFixed(0)}×${((ra.h - 2 * LE) / PPU).toFixed(0)}`,
      ảnh: `${ra.w}×${ra.h}`, ...(cuW ? { ghiChu: `trước là hình tròn ⌀${cuW.toFixed(0)}` } : {}),
    });
    if (GHI) {
      ghiPNG(resolve(CONTENT, src), ra);
      man.sprite = { ...(man.sprite || {}), src, pixelsPerUnit: PPU };
      writeFileSync(resolve(CONTENT, mon.duong), JSON.stringify(man, null, 2) + '\n');
      daNhap.push(id);
    }
  } catch (e) {
    bang.push({ file: basename(f), id: Number(id), ghiChu: 'LỖI: ' + e.message });
  }
}
console.log(`Bộ art ${ART}`);
console.table(bang);
if (GHI && daNhap.length) {
  console.log(`\nĐã ghi ${daNhap.length} ảnh. Sinh lại vùng va chạm:`);
  execFileSync(process.execPath, [resolve(CONTENT, '../../../build_colliders.mjs'), '--art', ART, '--ghi', ...daNhap], { stdio: 'inherit' });
  console.log('\nBước tiếp: node tools/refit_levels.mjs --art ' + ART + '  để cân lại lòng túi theo dáng mới.');
} else if (!GHI) console.log('\nXem trước, chưa ghi gì. Thêm --ghi để ghi thật.');
