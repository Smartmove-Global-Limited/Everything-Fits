// Chấm điểm một ván thắng.
//
// Đo bốn thứ, mỗi thứ người chơi đều tác động được:
//   - Xếp gọn: đồ có sát nhau không, hay để hở nhiều khe giữa các món.
//   - Chỗ trống còn lại: túi còn dư bao nhiêu chỗ chưa dùng tới.
//   - Thời gian: còn lại bao nhiêu so với giờ cho phép.
//   - Booster: dùng càng ít càng khéo.
//
// Hai điều phải cẩn thận ở "xếp gọn":
//
// 1. Phải tính theo VÙNG ĐỒ CHIẾM chứ không theo cả lòng túi. Tổng diện tích các món
//    là con số cố định của level, chia cho diện tích lòng túi thì ván nào cũng ra đúng
//    một kết quả — chấm kiểu đó không phản ánh gì về người chơi.
//
// 2. Kín đặc 100% là bất khả thi: đồ hình tròn, hình cong ghép vào nhau thì luôn còn khe.
//    Mà trần này lại KHÁC NHAU theo từng màn — đo thực tế các ván xếp trọn thấy màn
//    "Chuẩn bị đồ dùng" đạt 92% còn "Hộp cơm đầy" chỉ 76%, vì bộ đồ của nó tròn hơn.
//    Nên lấy chuẩn riêng cho từng màn: cách xếp tốt nhất máy tìm được chính là mốc 100%.
//    Người chơi xếp bằng máy là điểm tuyệt đối; xếp hơn máy cũng chỉ tính tối đa.
import Matter from 'matter-js';
import { S, BAG, partsOf } from './state.js';
import { gramHieuDung } from './physics.js';
import { itemName, t } from '../i18n.js';
import { coTrongLevel } from '../data/items.js';
import { pointInPolygon, pointInPolygonTolerant } from '../util/geom.js';
import { DEFAULT_BOOSTS } from './boosters.js';
import { solve, hinhMon, xoay } from '../gen/solver.js';

const O = 4;   // cạnh ô lưới khi đo, đơn vị logic

/**
 * Quét lưới lòng túi cho một cách xếp bất kỳ.
 * `trong(x, y)` trả về true nếu điểm đó nằm trong một món nào đó.
 *
 * - trongTui:  ô nằm trong lòng túi
 * - coDo:      ô bị món chiếm
 * - vungChiem: ô nằm trong lòng túi và ở ngang hoặc dưới món cao nhất của cột đó
 *              — tức phần túi mà đống đồ đang trải ra, kể cả khe hở giữa các món.
 */
function quetLuoi(trong) {
  let trongTui = 0, coDo = 0, vungChiem = 0;
  for (let x = BAG.left; x <= BAG.right; x += O) {
    let dinhCot = -1, soO = 0, soDo = 0;
    for (let y = BAG.top; y <= BAG.bottom; y += O) {
      if (!pointInPolygonTolerant(x, y, BAG.poly, 0)) continue;
      const co = trong(x, y);
      if (co) { soDo++; if (dinhCot < 0) dinhCot = soO; }
      soO++;
    }
    trongTui += soO; coDo += soDo;
    if (dinhCot >= 0) vungChiem += soO - dinhCot;
  }
  return { trongTui, coDo, vungChiem, gon: vungChiem > 0 ? coDo / vungChiem : 0 };
}

/** Cách xếp hiện tại trên màn */
function docHienTai() {
  const than = S.bodies.filter(b => !b.chuaVao).flatMap(partsOf);
  return quetLuoi((x, y) => than.some(p => Matter.Vertices.contains(p.vertices, { x, y })));
}

/**
 * Độ gọn của cách xếp tốt nhất máy tìm được — dùng làm mốc 100% của riêng màn này.
 * Máy xếp trên lưới nên có thể hơi khác thực tế, vì vậy kẹp lại trong khoảng hợp lý
 * để một lần máy xếp tồi không biến điểm của người chơi thành vô nghĩa.
 */
function docChuanCuaMan() {
  try {
    const sol = solve(S.LEVEL, { tries: 300 });
    if (!sol.plan?.length) return null;
    const theoId = new Map();
    for (const it of S.LEVEL.items) if (!theoId.has(it.id)) theoId.set(it.id, coTrongLevel(S.LEVEL, it));
    const manh = [];
    for (const p of sol.plan) {
      const hinh = hinhMon(p.id); if (!hinh) continue;
      for (const dg of hinh) manh.push(xoay(dg, p.angle || 0, theoId.get(p.id) || 1).map(([x, y]) => [x + p.x, y + p.y]));
    }
    // món đặt sẵn trong túi cũng chiếm chỗ
    for (const b of S.bodies) {
      if (!b.datSan) continue;
      for (const part of partsOf(b)) manh.push(part.vertices.map(v => [v.x, v.y]));
    }
    if (!manh.length) return null;
    return quetLuoi((x, y) => manh.some(dg => pointInPolygon(x, y, dg))).gon;
  } catch { return null; }
}

const kep = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * "Xếp đúng kiểu": nặng dưới, nhẹ trên, đồ dễ vỡ không bị đè. Xét từng cặp món A nằm NGAY TRÊN
 * món B (đáy A sát đỉnh B, chồng nhau theo chiều ngang). Lỗi khi:
 *   - B dễ vỡ mà A từ 300 g đè lên
 *   - A từ 500 g nằm trên B dưới 120 g (laptop đè áo phông)
 * Trả về danh sách câu mô tả lỗi để hiện ở bảng thắng.
 */
export function loiXep() {
  const ds = S.bodies.filter(b => !b.chuaVao && b.itemId > 0);
  const loi = [];
  for (const A of ds) for (const B of ds) {
    if (A === B) continue;
    if (A.position.y >= B.position.y) continue;
    const dayA = A.bounds.max.y, dinhB = B.bounds.min.y;
    if (dayA < dinhB - 6 || dayA > dinhB + 14) continue;
    const chong = Math.min(A.bounds.max.x, B.bounds.max.x) - Math.max(A.bounds.min.x, B.bounds.min.x);
    const rongNho = Math.min(A.bounds.max.x - A.bounds.min.x, B.bounds.max.x - B.bounds.min.x);
    if (chong < rongNho * .3) continue;
    const gA = gramHieuDung(A), gB = gramHieuDung(B), defA = A.realDef || A.def, defB = B.realDef || B.def;
    if (defB.meta?.fragile && gA >= 300) loi.push(t('onFragile', { a: itemName(defA), b: itemName(defB) }));
    else if (gA >= 500 && gB < 120) loi.push(t('onTop', { a: itemName(defA), b: itemName(defB) }));
  }
  return loi;
}

/** Chấm ván vừa thắng. Trả về các tỉ lệ 0..1, điểm 0..100 và số sao 1..3. */
export function chamDiem() {
  const cua = docHienTai();
  const chuanTho = docChuanCuaMan();
  // Chuẩn kẹp trong 0,62–0,95: thấp hơn thì một lần máy xếp tồi làm điểm phồng lên vô lý,
  // cao hơn thì lại quay về cái trần không ai với tới.
  const chuan = kep(chuanTho ?? 0.88, 0.62, 0.95);
  const gonThuc = cua.gon;
  // Tỉ lệ so với chuẩn của màn luôn nằm gần 1 (đo thực tế: 0,83 khi xếp lệch hẳn một
  // món, 1,0 khi xếp bằng máy). Lấy thẳng tỉ lệ thì ván nào cũng gần trọn điểm, không
  // phân biệt được ai khéo hơn ai. Trải khoảng 0,65–1,0 ra cả thang điểm.
  const SAN = .65;
  const gon = kep((kep(gonThuc / chuan) - SAN) / (1 - SAN));

  const trong = cua.trongTui > 0 ? kep(1 - cua.coDo / cua.trongTui) : 0;

  const tongGiay = S.LEVEL?.timer || 0;
  const conGiay = Math.max(0, Math.ceil(S.timeLeft / 1000));
  const dungGiay = Math.max(0, tongGiay - conGiay);
  // Cùng cái bẫy như "xếp gọn": lấy thẳng thời gian còn lại chia tổng thì muốn trọn điểm
  // phải xong trong 0 giây. Xong trong NỬA thời gian cho phép đã là rất nhanh — tính
  // trọn điểm từ mốc đó, rồi giảm dần về 0 khi dùng hết giờ.
  const NHANH = .5;
  const tiLeDung = tongGiay > 0 ? dungGiay / tongGiay : 1;
  const thoiGian = kep((1 - tiLeDung) / (1 - NHANH));

  const daCap = { ...DEFAULT_BOOSTS, ...(S.LEVEL?.boosters || {}) };
  const tongBooster = Object.values(daCap).reduce((s, v) => s + v, 0);
  const conBooster = Object.values(S.boosts).reduce((s, v) => s + v, 0);
  const dungBooster = Math.max(0, tongBooster - conBooster);
  const tietKiem = tongBooster > 0 ? kep(conBooster / tongBooster) : 1;

  // Xếp đúng kiểu (nặng dưới nhẹ trên, không đè đồ dễ vỡ): không lỗi trọn điểm, 1 lỗi nửa, từ 2 lỗi là 0
  const loi = loiXep();
  const dungKieu = loi.length === 0 ? 1 : loi.length === 1 ? .5 : 0;

  // Xếp gọn nặng nhất: đó mới là kỹ năng chính của trò này.
  const diem = Math.round(gon * 50 + thoiGian * 25 + tietKiem * 10 + dungKieu * 15);
  // Năm sao, bước nửa sao. Thắng rồi thì ít nhất cũng được một sao, không để trắng tay.
  const sao = Math.max(1, Math.round(diem / 100 * 5 * 2) / 2);

  return { gon, gonThuc, chuan, tiLeDung, tiLeGon: chuan ? kep(gonThuc / chuan) : 0, trong, thoiGian, tietKiem, dungKieu, loi, diem, sao,
           dungGiay, tongGiay, dungBooster, tongBooster };
}
