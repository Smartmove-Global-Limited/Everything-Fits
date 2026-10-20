// Tạo body Matter.js từ định nghĩa món, và dựng thế giới vật lý (tường, thành túi theo polygon, block).
import Matter from 'matter-js';
import * as decompNS from 'poly-decomp';

// Matter chỉ dựng được hình LỒI. Không có thư viện này thì hình lõm (mặt trăng khuyết,
// chữ U, chữ L) bị bọc thành bao lồi, phần khuyết bị lấp kín và món chiếm chỗ nhiều hơn
// trông thấy. Đăng ký decomp thì Matter tự cắt hình lõm thành nhiều mảnh lồi ghép lại.
Matter.Common.setDecomp(decompNS.default ?? decompNS);
import { S, BAG, W, H, FLOOR_Y, PAD } from './state.js';
import { polygonArea } from '../util/geom.js';
import { blockPoly, blocksArea } from '../data/blocks.js';

const { Engine, World, Bodies, Body, Vertices, Events } = Matter;

const MAT = { friction: .6, frictionStatic: .8, restitution: .26, density: .0018 };
/** Nhóm va chạm của trần vô hình ngoài màn (mặc định của Matter là 1): đồ mưa từ trên đỉnh màn
 *  lúc mở màn xuyên qua trần này, còn túi và vật cản thì va như thật. */
export const NHOM_TRAN = 0x0002;

function makePart(p, x, y) {
  const o = { ...MAT };
  if (p.kind === 'circle') return Bodies.circle(x + (p.dx || 0), y + (p.dy || 0), p.r, o);
  if (p.kind === 'rect') {
    return Bodies.rectangle(x + (p.dx || 0), y + (p.dy || 0), p.w, p.h,
      Object.assign({ chamfer: p.chamfer ? { radius: p.chamfer } : undefined }, o));
  }
  if (p.kind === 'poly') { // đặt sao cho đỉnh vật lý trùng đúng toạ độ vẽ cục bộ
    const verts = p.pts.map(([px, py]) => ({ x: px, y: py }));
    const cen = Vertices.centre(verts);
    const b = Bodies.fromVertices(x + cen.x, y + cen.y, [verts], o, true);
    // Matter có một khe hở: đa giác LÕM được tách thành nhiều mảnh, mảnh vụn bị lọc bỏ,
    // còn lại đúng một mảnh thì nó trả về mảnh đó ở toạ độ CỤC BỘ (quanh 0,0) mà không
    // dời tới (x, y) như các nhánh khác. Máy ảnh (mã 39) rơi đúng vào khe này: mở hộp bí
    // ẩn ra là máy ảnh hiện ở góc trên trái màn rồi bị trả về khay. Đặt lại vị trí cho chắc;
    // với thân bình thường đây là lệnh không đổi gì.
    Body.setPosition(b, { x: x + cen.x, y: y + cen.y });
    return b;
  }
  throw new Error('Unknown part kind: ' + p.kind);
}

/** Tạo body cho một món tại (x, y). body.origin = độ lệch từ tâm body về gốc toạ độ vẽ. */
export function makeItem(def, x, y) {
  const bo = { friction: .6, frictionStatic: .8, restitution: def.restitution ?? (def.meta?.physics === 'bouncy' ? .85 : .26) };
  let body;
  if (def.kind === 'compound') body = Body.create({ parts: def.parts.map(p => makePart(p, x, y)), ...bo });
  else if (def.extra) body = Body.create({ parts: [makePart(def, x, y), makePart(def.extra, x, y)], ...bo });
  else body = makePart(def, x, y);
  body.restitution = bo.restitution;
  body.restGoc = bo.restitution;    // độ nảy gốc, để tắt tạm lúc món nằm trong túi rồi trả lại
  apDungCanNang(body, def);
  if (def.meta?.physics === 'rolling') { body.friction = .15; body.frictionStatic = .2; }
  // Bóng bay: nhẹ, trơn, hơi nảy, không khí cản mạnh. Lực nổi đặt mỗi bước ở float.js.
  if (def.meta?.physics === 'float') {
    body.bay = true;
    Body.setDensity(body, body.density * .35);
    body.friction = .08; body.frictionStatic = .1; body.frictionAir = .06;
    body.restitution = body.restGoc = .35;
  }
  body.itemId = def.id;        // khoá chính (số), dùng để so khớp với level JSON
  body.label = def.slug;       // tên ngắn, tiện khi xem log
  body.def = def;
  body.realDef = def;
  body.artScale = 1;
  body.origin = { x: x - body.position.x, y: y - body.position.y };
  return body;
}

// ---------------- cân nặng thật ----------------
// Mỗi món có meta.gram (ước lượng đồ thật, tools/can_nang_mon.csv). Từ đó suy ra:
//   khối lượng   đúng tỉ lệ gram: laptop 1500 g đè bẹp áo 150 g, hất văng gói giấy 30 g.
//                Mốc GRAM_CHUAN giữ nguyên khối lượng cũ (area × 0.0018) cho món ~150 g,
//                để các level đang có không đổi cảm giác nhiều.
//   cản không khí theo gram trên mỗi đơn vị² diện tích hình (như "nặng trên mỗi cm²"):
//                laptop, lon đậu rơi gần như tự do; áo gấp, khăn, giấy to mà nhẹ thì rơi chậm.
//   độ nảy       giảm theo gram: đồ nhẹ nảy nhẹ, đồ nặng gần như không nảy.
// Gram kẹp trong [GRAM_MIN, GRAM_MAX] cho vật lý: tỉ lệ khối lượng quá lớn thì Matter rung.
export const GRAM_CHUAN = 150, GRAM_MIN = 10, GRAM_MAX = 2000, DIEN_TICH_CHUAN = 3500;
export const gramCua = def => Math.max(GRAM_MIN, Math.min(GRAM_MAX, Number(def?.meta?.gram) || GRAM_CHUAN));
const kep = (v, a, b) => Math.max(a, Math.min(b, v));
function apDungCanNang(body, def) {
  const gram = gramCua(def);
  body.gram = gram;
  // khối lượng CHỈ theo gram, không theo diện tích hình: món 150 g nặng đúng bằng món cỡ trung
  // bình (3500 u²) theo mật độ cũ, dù hình to hay nhỏ
  Body.setMass(body, DIEN_TICH_CHUAN * MAT.density * gram / GRAM_CHUAN);
  // cản không khí theo gram / diện tích: mốc 0.04 g/u² (quả táo) giữ ~mặc định 0.01 của Matter;
  // vé, giấy (~0.007) lên 0.06 → lượn xuống chậm; laptop, lon đậu (≥0.15) xuống 0.003 → rơi gần tự do
  const ad = gram / Math.max(1, body.area);
  body.frictionAir = kep(.012 * Math.pow(.04 / ad, .9), .003, .07);
  // độ nảy: món chuẩn giữ nguyên; nặng gấp 10 còn ~0.45 lần; nhẹ hơn thì nảy hơn, kẹp .4
  if (def.meta?.physics !== 'bouncy' && def.meta?.physics !== 'float') {
    body.restitution = body.restGoc = kep(body.restGoc * Math.pow(GRAM_CHUAN / gram, .35), .08, .4);
  }
}

/** Diện tích một món (đơn vị logic²) tính từ hình vật lý */
export function itemArea(def) {
  const b = makeItem(def, 0, 0);
  return b.area;
}

/**
 * Thành túi: một hình chữ nhật mỏng dọc theo mỗi cạnh polygon, đẩy ra ngoài PAD/2, dài
 * ĐÚNG bằng cạnh. Khe ở góc lồi (hai đoạn không chạm nhau ở phía ngoài) bịt bằng một cột
 * tròn đặt hẳn ra ngoài theo phân giác, chỉ chạm đỉnh.
 *
 * Trước đây mỗi đoạn được kéo dài thêm PAD/2 ở hai đầu để bịt khe. Ở góc LÕM (túi chữ L,
 * khuyết góc) phần kéo dài đó chọc vào lòng túi 7 đơn vị: một vật cản vô hình, người chơi
 * không thấy, máy xếp không biết, món đặt sát góc bị hất ra không rõ vì sao.
 */
function polygonWalls(poly, opt, closed = false) {
  const walls = [];
  const n = poly.length;
  // bỏ cạnh miệng túi: cạnh nằm trên đỉnh (y nhỏ nhất) và gần ngang
  const minY = Math.min(...poly.map(p => p[1]));
  // Hướng ra ngoài lấy theo CHIỀU ĐI của polygon (dấu diện tích shoelace), không phải "xa trọng
  // tâm": với lòng túi lõm (đuôi cá, chữ U, chữ L) cạnh ở phần nhô ra có khi nằm gần trọng tâm
  // hơn khi đẩy ra ngoài, tường bị dựng vào trong lòng túi, đồ thả vào đó bị báo không vừa dù
  // còn cách mép kem cả đoạn.
  const chieu = Math.sign(polygonArea2(poly)) || 1;
  const phapTuyen = [];   // pháp tuyến hướng ra ngoài của cạnh i (đỉnh i → i+1); null nếu là miệng túi
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if ((!closed && Math.abs(y1 - minY) < 1 && Math.abs(y2 - minY) < 1) || len < 1) { phapTuyen.push(null); continue; } // miệng túi mở
    const nx = chieu * dy / len, ny = -chieu * dx / len;   // pháp tuyến hướng ra ngoài
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    phapTuyen.push({ nx, ny });
    walls.push(Bodies.rectangle(mx + nx * PAD / 2, my + ny * PAD / 2, len, PAD, { ...opt, angle: Math.atan2(dy, dx) }));
  }
  // Cột bịt khe chỉ ở góc LỒI: ở góc lõm hai đoạn tường đã chồng lên nhau phía ngoài, không có khe.
  // Lồi hay lõm xét bằng dấu tích có hướng của hai cạnh so với chiều đi của polygon.
  for (let i = 0; i < n; i++) {
    const a = phapTuyen[(i - 1 + n) % n], b = phapTuyen[i];
    if (!a || !b) continue;
    const [px, py] = poly[(i - 1 + n) % n], [vx, vy] = poly[i], [qx, qy] = poly[(i + 1) % n];
    const cross = (vx - px) * (qy - vy) - (vy - py) * (qx - vx);
    if (Math.sign(cross) !== chieu) continue;     // góc lõm
    let bx = a.nx + b.nx, by = a.ny + b.ny; const L = Math.hypot(bx, by);
    if (L < 1e-6) continue;                        // hai cạnh thẳng hàng
    walls.push(Bodies.circle(vx + bx / L * PAD / 2, vy + by / L * PAD / 2, PAD / 2, opt));
  }
  return walls;
}
/** Diện tích có dấu ×2 (shoelace): dấu cho biết chiều đi của polygon */
function polygonArea2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; }
  return s;
}

/**
 * Ai muốn biết món vừa va vào cái gì thì đăng ký ở đây.
 * Đi vòng qua callback chứ không gọi thẳng module tiếng và hiệu ứng: file này được
 * Level Editor dùng chung, mà hai module kia lại bám vào canvas của game.
 */
let baoVaCham = null, baoDe = null;
export const onImpact = fn => { baoVaCham = fn; };
/** Ai muốn biết món nào đang NẰM ĐÈ lên món nào (mỗi bước vật lý, cả hai gần như đứng yên) */
export const onPress = fn => { baoDe = fn; };
/** Gram thật của thân đang có trên màn: gram của món nhân với cỡ riêng trong level (bình phương) */
export const gramHieuDung = b => (b.gram || GRAM_CHUAN) * (b.levelScale || 1) ** 2;

/** Thân vật lý của một vật cản: chữ nhật dựng thẳng, hình khác dựng từ đa giác lồi của nó */
const blockBody = opt => b => {
  const o = { ...opt, label: 'block' };
  if (!b.kind || b.kind === 'rect') return Bodies.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, o);
  const verts = blockPoly(b).map(([x, y]) => ({ x, y }));
  const c = Vertices.centre(verts);
  const body = Bodies.fromVertices(c.x, c.y, [verts], o);
  Body.setPosition(body, c);
  return body;
};

/** Đưa thành túi và vật cản vào thế giới: từ lúc này túi có thật với vật lý */
export function dungTui(world = S.world) {
  if (S.tuiDaDung || !world) return;
  World.add(world, S.tuiWalls);
  S.tuiDaDung = true; S.tuiHienLuc = S.clock;
}

/** Engine mới + tường quanh màn + thành túi theo polygon + block chặn */
export function createWorld() {
  const engine = Engine.create({ positionIterations: 8, velocityIterations: 6 });
  engine.gravity.y = 1.1;
  // Sàn và tường màn hình bám chắc, để đồ trên khay không trượt lung tung.
  const wallOpt = { isStatic: true, friction: .8, restitution: .1, label: 'wall' };
  // Thành túi thì trơn. Để dính như sàn thì món bị ép vào thành là ma sát ghì cứng luôn,
  // treo lơ lửng giữa túi không chịu tụt xuống, nhìn như kẹt. Trơn thì nó trượt xuống
  // lấp chỗ trống bên dưới, đống đồ cũng xẹp lại nên đỡ chòi ra khỏi miệng túi.
  const tuiOpt = { ...wallOpt, friction: .04, frictionStatic: .06 };
  const t = 60;
  const walls = [
    Bodies.rectangle(W / 2, FLOOR_Y + t / 2, W + 200, t, wallOpt),
    Bodies.rectangle(-t / 2, H / 2, t, H * 2, wallOpt),
    Bodies.rectangle(W + t / 2, H / 2, t, H * 2, wallOpt),
    // trần: nhóm riêng để đồ mưa từ trên đỉnh màn lúc mở màn xuyên qua được (level.js)
    Bodies.rectangle(W / 2, -t, W * 2, t, { ...wallOpt, collisionFilter: { category: NHOM_TRAN } }),
  ];
  World.add(engine.world, walls);
  // Thành túi và vật cản dựng sẵn nhưng CHƯA đưa vào thế giới: túi ẩn lúc mở màn, đồ mưa
  // xuống sân trước, túi hiện ra rồi mới có thành (dungTui). Khung xem thử của editor thì
  // túi có ngay.
  const thanh = polygonWalls(BAG.poly, tuiOpt, BAG.closed);
  for (const w of thanh) w.thanhTui = true;   // thành lòng túi (khác vật cản): xem computeGhost
  const tuiWalls = [...thanh, ...BAG.blocks.map(blockBody(tuiOpt))];
  S.tuiWalls = tuiWalls; S.tuiDaDung = false; S.tuiHienLuc = 0;
  walls.push(...tuiWalls);
  if (S.preview) dungTui(engine.world);

  // Matter báo cặp va chạm ngay khi vừa chạm nhau, lúc này .speed vẫn là tốc độ
  // trước khi bị giải va chạm triệt tiêu — đúng cái cần để biết cú va mạnh hay nhẹ.
  Events.on(engine, 'collisionStart', e => {
    if (!baoVaCham) return;
    for (const pair of e.pairs) {
      const A = pair.bodyA.parent, B = pair.bodyB.parent;
      const mon = A.isStatic ? B : B.isStatic ? A : (A.speed >= B.speed ? A : B);
      if (mon.isStatic) continue;
      const p = pair.activeContacts?.[0]?.vertex;
      baoVaCham(mon, mon.speed, p ? { x: p.x, y: p.y } : mon.position, A.isStatic || B.isStatic, mon === A ? B : A);
    }
  });
  // Món đè lên món: cặp đang chạm nhau mà cả hai gần đứng yên, món trên cao hơn món dưới.
  // Dùng cho đồ dễ vỡ bị đồ nặng nằm đè lâu (rules.js).
  Events.on(engine, 'collisionActive', e => {
    if (!baoDe) return;
    for (const pair of e.pairs) {
      const A = pair.bodyA.parent, B = pair.bodyB.parent;
      if (A.isStatic || B.isStatic || A.speed > 1.5 || B.speed > 1.5) continue;   // 1.5: đồ nằm đè vẫn hơi nhúc nhích
      const [tren, duoi] = A.position.y < B.position.y ? [A, B] : [B, A];
      if (duoi.position.y - tren.position.y < 4) continue;
      baoDe(tren, duoi);
    }
  });

  S.engine = engine; S.world = engine.world; S.staticBodies = walls;
  return engine;
}

/** Diện tích lòng túi thật (polygon trừ block) */
export function usableArea() {
  return polygonArea(BAG.poly) - blocksArea(BAG.blocks);
}

/** Thay body cũ bằng body mới cùng vị trí/góc, giữ label, dây buộc, trạng thái đóng băng */
export function replaceBody(old, def) {
  const nb = makeItem(def, old.position.x, old.position.y);
  Body.setAngle(nb, old.angle);
  nb.itemId = old.itemId; nb.khoa = old.khoa; nb.label = old.label; nb.realDef = old.realDef;
  if (old.tether) {
    const t = old.tether; nb.tether = t;
    if (t.a === old) { t.a = nb; t.c.bodyA = nb; } else { t.b = nb; t.c.bodyB = nb; }
  }
  World.remove(S.world, old);
  S.bodies.splice(S.bodies.indexOf(old), 1, nb);
  World.add(S.world, nb);
  return nb;
}

export function removeBody(b) {
  World.remove(S.world, b);
  S.bodies.splice(S.bodies.indexOf(b), 1);
}
