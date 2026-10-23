// Thêm MÓN MỚI vào một bộ art từ một thư mục ảnh AI gen (kèm manifest.csv của bộ sinh ảnh).
//
// Khác import_items.mjs: công cụ kia chỉ thay ảnh cho món ĐÃ CÓ (tìm theo mã, giữ diện tích
// va chạm cũ). Ở đây món chưa tồn tại: mã cấp nối tiếp mã lớn nhất đang có của bộ art, manifest
// và mục lục được tạo mới, diện tích lấy theo cỡ mặc định vì chưa có gì để giữ.
//
// Chạy: node tools/add_items.mjs <thư mục nguồn> --vao 04-picnic-home [--art cozy] [--ghi]
//                                [--co Medium] [--ten tools/ten_mon_vi.csv] [--max 110]
//   không có --ghi thì chỉ in bảng xem trước, không sửa file nào
//
// Thứ tự cấp mã = thứ tự cột Entry trong manifest.csv của thư mục nguồn (không phải tên file).
// Mỗi ảnh đi qua đúng các bước của món cũ: làm sạch nền → cắt sát viền → thu về cỡ game
// (pixelsPerUnit = PPU) → ghi PNG + manifest → build_colliders.mjs sinh vùng va chạm và đường
// viền bám đúng viền đã cắt.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { docPNG, ghiPNG } from './png.mjs';
import { lamSach, thuNho, LE } from './anh.mjs';
import { ART, ARGS, CONTENT } from './art.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PPU = 4;            // ảnh lớn gấp 4 lần kích thước logic, như mọi món hiện có

// Diện tích vùng va chạm mục tiêu theo cỡ: trung vị của các món cùng cỡ đang có trong bộ cozy
// (đo 60 món: Small 2392, Medium 3572, Large 8911 đơn vị²). Chưa có sheet cỡ thì mọi món
// dùng chung một cỡ; designer chỉnh lại từng món trong Thư viện art sau.
const DIEN_TICH = { Small: 2392, Medium: 3572, Large: 8911 };

const GHI = ARGS.includes('--ghi');
const giaTri = co => { const i = ARGS.indexOf(co); return i >= 0 ? ARGS[i + 1] : null; };
const VAO = giaTri('--vao');
const CO = giaTri('--co') || 'Medium';
const MAX = Number(giaTri('--max')) || 110;   // cạnh dài tối đa, bằng món lớn nhất đang có (máy tính bảng 110)
const TEN = giaTri('--ten') || resolve(ROOT, 'tools/ten_mon_vi.csv');
const nguon = ARGS.filter((a, k) => !a.startsWith('--') && !['--vao', '--co', '--ten', '--max'].includes(ARGS[k - 1]))[0];
if (!nguon || !VAO) { console.error('Cần <thư mục nguồn> và --vao <thư-mục-chương>. Xem đầu file.'); process.exit(1); }
if (!DIEN_TICH[CO]) { console.error(`--co phải là Small / Medium / Large, nhận "${CO}"`); process.exit(1); }

// ---------- đọc CSV đơn giản (trường có thể bọc trong dấu nháy kép, không chứa dấu phẩy) ----------
function docCSV(duong) {
  // bỏ BOM ở đầu file (bộ sinh ảnh từ 2026-10 ghi CSV kèm BOM)
  const [dau, ...dong] = readFileSync(duong, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cot = dau.split(',').map(s => s.replace(/^"|"$/g, ''));
  return dong.filter(Boolean).map(l => {
    const v = l.split(',').map(s => s.replace(/^"|"$/g, ''));
    return Object.fromEntries(cot.map((c, i) => [c, v[i] ?? '']));
  });
}

// thứ tự món: theo Entry trong manifest.csv của bộ sinh ảnh
const danhSach = docCSV(join(nguon, 'manifest.csv'))
  // cột viết hoa (Entry, Name, File) ở các đợt cũ, viết thường (entry, name, file) từ đợt 2026-10
  .map(r => ({ entry: Number(r.Entry ?? r.entry), tenEn: r.Name ?? r.name, file: r.File ?? r.file }))
  .sort((a, b) => a.entry - b.entry);

// tên tiếng Việt theo tên file
const tenVi = {};
if (existsSync(TEN)) for (const r of docCSV(TEN)) tenVi[r.file] = r.nameVi;

// ---------- mục lục & mã kế tiếp ----------
const indexPath = resolve(CONTENT, 'assets/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
index.items ||= {};
let maKe = Math.max(0, ...Object.keys(index.items).map(Number).filter(n => Number.isFinite(n))) + 1;

// slug đang dùng, để món mới không trùng (i18n tra tên tiếng Anh theo slug)
const slugDaCo = new Set();
for (const duong of Object.values(index.items)) {
  try { slugDaCo.add(JSON.parse(readFileSync(resolve(CONTENT, duong), 'utf8')).slug); } catch {}
}
const slugCua = ten => {
  let s = ten.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let ra = s, n = 2;
  while (slugDaCo.has(ra)) ra = `${s}-${n++}`;
  slugDaCo.add(ra);
  return ra;
};

// ---------- chạy ----------
const bang = [], daThem = [];
for (const mon of danhSach) {
  const id = maKe++;
  const f = join(nguon, mon.file);
  try {
    const anh = docPNG(f);
    const khung = lamSach(anh);
    // đơn vị logic trên mỗi px nguồn, sao cho thân món rộng đúng diện tích mục tiêu của cỡ
    let donVi = Math.sqrt(DIEN_TICH[CO] / khung.dem);
    // Món mảnh (tua vít, nhiệt kế que) muốn đủ diện tích thì phải kéo rất dài — có cái vượt
    // cả lòng túi. Chặn cạnh dài không quá MAX đơn vị, bằng món lớn nhất đang có.
    const canhDai = Math.max(khung.x1 - khung.x0, khung.y1 - khung.y0) * donVi;
    const bịChặn = canhDai > MAX;
    if (bịChặn) donVi *= MAX / canhDai;
    const ra = thuNho(anh, khung, donVi * PPU);
    const slug = slugCua(mon.tenEn);
    const duongManifest = `assets/${VAO}/items/${id}.json`;
    const src = `assets/${VAO}/items/${id}.png`;
    bang.push({
      entry: mon.entry, id, slug, ten: tenVi[mon.file] || mon.tenEn,
      'món chiếm': `${(((khung.x1 - khung.x0) * (khung.y1 - khung.y0)) / (anh.w * anh.h) * 100).toFixed(0)}% tấm gốc`,
      'cỡ mới': `${((ra.w - 2 * LE) / PPU).toFixed(0)}×${((ra.h - 2 * LE) / PPU).toFixed(0)}`,
      ảnh: `${ra.w}×${ra.h}`,
      ...(bịChặn ? { ghiChu: `chặn cạnh dài ${MAX}` } : {}),
    });
    if (GHI) {
      mkdirSync(resolve(CONTENT, `assets/${VAO}/items`), { recursive: true });
      ghiPNG(resolve(CONTENT, src), ra);
      const manifest = {
        id, slug, code: `ITM_${String(id).padStart(3, '0')}`,
        name: tenVi[mon.file] || mon.tenEn, nameEn: mon.tenEn,
        meta: { size: CO, shape: 'Rectangle', physics: 'normal', cost: 1, canLink: true, canLock: true },
        sprite: { src, pixelsPerUnit: PPU },
      };
      writeFileSync(resolve(CONTENT, duongManifest), JSON.stringify(manifest, null, 2) + '\n');
      index.items[id] = duongManifest;
      daThem.push(String(id));
    }
  } catch (e) {
    bang.push({ entry: mon.entry, id, ten: mon.tenEn, ghiChu: 'LỖI: ' + e.message });
  }
}

console.log(`Bộ art ${ART} · thư mục ${VAO} · cỡ mặc định ${CO}`);
console.table(bang);
if (GHI && daThem.length) {
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  console.log(`\nĐã thêm ${daThem.length} món (mã ${daThem[0]}–${daThem[daThem.length - 1]}). Sinh vùng va chạm theo viền đã cắt:`);
  execFileSync(process.execPath, [resolve(ROOT, 'build_colliders.mjs'), '--art', ART, '--ghi', ...daThem], { stdio: 'inherit' });
} else if (!GHI) console.log('\nXem trước, chưa ghi gì. Thêm --ghi để ghi thật.');
