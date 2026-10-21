// Luật của túi: đồ có nằm gọn trong lòng túi (polygon) không, ảo ảnh khi chồng lấn, đẩy đồ chòi mép ra, tính tiến độ.
import Matter from 'matter-js';
import { KEY_ID } from '../data/items.js';
import { S, BAG, PAD, W, TABLE_Y, FLOOR_Y, partsOf, isHeld, daVao } from './state.js';
import { pointInPolygon, pointInPolygonTolerant } from '../util/geom.js';
import { toast, renderList, showWin, showLose } from '../ui/hud.js';
import { sfx, duckMusic } from '../ui/sfx.js';
import { sparkle, ring, confetti, shake, floatText, dust } from './fx.js';
import { onImpact, onPress, gramHieuDung } from './physics.js';
import { markDone, setSpot } from './progress.js';
import { addGold } from './wallet.js';
import { chamDiem } from './score.js';
import { t, itemName } from '../i18n.js';
import { ketThucLuot } from './events.js';

const { Body, Bounds, Collision } = Matter;

// Dung sai khi kiểm tra đồ nằm trong lòng túi.
// Matter.js cho phép vật lún nhẹ vào tường (collision slop), nên đỉnh của món nằm sát đáy/thành
// thường vượt biên polygon vài phần trăm pixel. Không có dung sai thì món xếp đúng vẫn bị coi là không vừa.
const FIT_TOL = 3;

/** Mọi đỉnh của mọi part nằm trong polygon lòng túi (có dung sai) */
function allVerticesInside(body) {
  for (const p of partsOf(body)) {
    if (p.circleRadius) { // xấp xỉ hình tròn bằng 12 điểm trên biên
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        if (!pointInPolygonTolerant(p.position.x + Math.cos(a) * p.circleRadius, p.position.y + Math.sin(a) * p.circleRadius, BAG.poly, FIT_TOL)) return false;
      }
    } else for (const v of p.vertices) if (!pointInPolygonTolerant(v.x, v.y, BAG.poly, FIT_TOL)) return false;
  }
  return true;
}

/** inZone: đồ đang "dính" vào vùng túi. fullyInside: nằm gọn hẳn trong lòng túi. */
export function bagZone(body) {
  const bb = body.bounds;
  const inZone = bb.max.x > BAG.left - PAD && bb.min.x < BAG.right + PAD
    && bb.max.y > BAG.top - 14 && bb.min.y < BAG.bottom + PAD - 2;
  const fullyInside = inZone && bb.min.y >= BAG.top - FIT_TOL && allVerticesInside(body);
  return { inZone, fullyInside };
}

/** Đồ đang cầm có bị "ảo ảnh" không: chòi mép túi, hoặc chồng lên đồ khác / tường / block */
export function computeGhost(body, group = [body]) {
  const z = bagZone(body);
  // Viền đỏ khi món lấn vào lòng túi mà không nằm gọn. Không dùng z.inZone (hình chữ nhật
  // bao túi nới mép): túi bầu dục như giỏ picnic có bốn góc chữ nhật trùm ra vành và bóng
  // đổ bên ngoài, món để ở đó bị báo sai và bị trả về khay.
  const lan = z.inZone && lanVaoLongTui(body);
  if (lan && !z.fullyInside) return true;
  // Món nằm NGOÀI lòng túi chạm vào thành túi (dải mỏng ngay ngoài mép lòng, nằm dưới vành
  // túi) thì không báo đỏ: người chơi thả cạnh túi, trên vành, vào bóng đổ là chuyện bình
  // thường; thả ra vật lý tự đẩy món ra ngoài thành.
  const boQuaThanh = !lan;
  const mine = partsOf(body);
  // Tường và vật cản cũng lấy từng mảnh: vật cản kiểu 'poly' (vách ngăn in sẵn trong ảnh túi) là
  // thân ghép nhiều mảnh lồi, đem thân cha đi dò thì Matter dùng bao lồi của cả mạng vách — với
  // khay chia múi, tổ ong là cả lòng túi, món nào thả vào cũng bị báo không vừa.
  const others = S.bodies.filter(b => !group.includes(b) && daVao(b)).flatMap(partsOf).concat(S.staticBodies.flatMap(partsOf));
  for (const a of mine) {
    for (const b of others) {
      if (!Bounds.overlaps(a.bounds, b.bounds)) continue;
      if (boQuaThanh && b.thanhTui) continue;
      const c = Collision.collides(a, b);
      const isWall = b.label === 'wall' || b.label === 'block';
      if (c && c.collided && c.depth > (isWall ? 2.5 : 0.5)) return true;
    }
  }
  return false;
}

/**
 * Tìm một chỗ trống trên khay để đặt đồ.
 * Ưu tiên chỗ ngay dưới nơi món vừa bị trả ra, tìm mãi không được mới nới rộng dần:
 * quăng món sang tận đầu kia của khay thì mắt người chơi không kịp bám theo,
 * nhìn cứ như món tự nhiên biến mất.
 */
export function findFreeSpot(b, group = [b]) {
  const pad = group.length > 1 ? 46 : 0;   // cặp buộc dây cần chỗ rộng hơn
  const hx = (b.bounds.max.x - b.bounds.min.x) / 2 + pad, hy = (b.bounds.max.y - b.bounds.min.y) / 2 + pad;
  const xCu = b.position.x;
  const traiNhat = 20 + hx, phaiNhat = Math.max(traiNhat, W - 20 - hx);
  for (let t = 0; t < 40; t++) {
    const toaRa = 46 + (t / 40) * W;       // vòng đầu bám sát chỗ cũ, sau đó lan rộng ra
    const x = xCu + (Math.random() - .5) * 2 * toaRa;
    Body.setPosition(b, {
      x: Math.max(traiNhat, Math.min(phaiNhat, x)),
      y: TABLE_Y + 10 + hy + Math.random() * Math.max(10, FLOOR_Y - TABLE_Y - 20 - hy * 2),
    });
    if (!computeGhost(b, group)) return;
  }
  Body.setPosition(b, { x: W / 2, y: TABLE_Y + 15 });
}

function ejectOne(b) {
  S.puffs.push({ x: b.position.x, y: b.position.y, t: 0 });   // chỗ món rời đi
  // Rung nhẹ thôi: túi đầy thì chuyện này xảy ra luôn, rung mạnh mỗi lần thành ra
  // như bị phạt, trong khi đây chỉ là món không vừa nên được trả lại khay.
  sfx('eject', { gain: .7 }); shake(150);
  findFreeSpot(b);
  Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
  S.puffs.push({ x: b.position.x, y: b.position.y, t: 0 });   // chỗ món hiện ra
  b.stuck = 0;
}

/**
 * Trả đống đồ trong túi về đúng thế trước lần thả vừa rồi.
 * Chỉ dùng khi chính món vừa thả là món không vừa: lúc đó những món bị nó xô ra
 * không có lỗi gì, không việc gì phải mất chỗ.
 */
function hoanTacTui() {
  const luu = S.luuTui; if (!luu) return 0;
  S.luuTui = null;
  const now = performance.now();
  let n = 0;
  for (const m of luu.list) {
    const b = m.b;
    if (!S.bodies.includes(b) || isHeld(b) || bagZone(b).fullyInside) continue;
    // Nhớ chỗ hiện tại: chỗ cũ có thể đã bị món khác chiếm trong lúc xô đẩy vừa rồi,
    // đặt bừa về là hai món lồng vào nhau. Chèn được thì mới nhận, không thì để nguyên.
    const cu = { x: b.position.x, y: b.position.y, a: b.angle };
    Body.setPosition(b, { x: m.x, y: m.y });
    Body.setAngle(b, m.a);
    if (computeGhost(b)) {                      // chỗ cũ không còn trống
      Body.setPosition(b, { x: cu.x, y: cu.y });
      Body.setAngle(b, cu.a);
      continue;
    }
    Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
    b.stuck = 0; b.thaLuc = now;
    n++;
  }
  return n;
}

/** Đẩy đồ không vừa ra khay. Đồ buộc chung thì đẩy cả cặp, giữ nguyên khoảng cách. */
export function eject(b) {
  const pair = b.tether ? [b, b.tether.a === b ? b.tether.b : b.tether.a] : [b];
  if (pair.some(x => isHeld(x))) return;
  const d = pair.length > 1 ? Matter.Vector.sub(pair[1].position, pair[0].position) : null;
  ejectOne(pair[0]);
  if (d) {
    Body.setPosition(pair[1], Matter.Vector.add(pair[0].position, d));
    Body.setVelocity(pair[1], { x: 0, y: 0 }); Body.setAngularVelocity(pair[1], 0); pair[1].stuck = 0;
    S.puffs.push({ x: pair[1].position.x, y: pair[1].position.y, t: 0 });
    toast(t('pairTogether'));
  } else toast(t('noFitPushed'));

  // Chính món vừa thả là món không vừa → trả lại thế xếp cũ cho những món bị nó xô.
  if (S.luuTui && pair.includes(S.luuTui.monTha)) {
    const n = hoanTacTui();
    if (n) toast(t('noFitReturned', { n }), 1800);
  }
}

// Trước khi kết luận món chòi ra khỏi miệng túi, phải chắc là nó đã rơi hẳn và nằm im.
// Thả tay xong món còn chạm món khác, nảy lên, trườn xuống khe — trong lúc đó có thể nó
// vướng mép túi một nhịp, nhưng đó chưa phải chỗ nằm cuối cùng của nó.
const CHO_SAU_THA = 700;   // mili giây sau khi buông tay mới bắt đầu xét
const YEN_TOC = .25;       // chậm hơn mức này mới tính là đã nằm, không còn trườn
const YEN_XOAY = .03;
const YEN_DU_LAU = 75;     // số khung nằm im liên tục, khoảng 1,2 giây

/** Đồ đã nằm hẳn mà vẫn chòi ra khỏi miệng túi → trả lại khay */
/**
 * Món có phần nào lấn vào TRONG lòng túi không (một đỉnh của hình va chạm nằm trong đa giác
 * lòng túi). Vùng túi của bagZone là hình chữ nhật bao quanh túi nới thêm một mép, nên món
 * nằm ngoài tựa vào thành túi (áo thả cạnh vai túi, món chạm quai) cũng lọt vào đó; lấy vùng
 * ấy để đẩy ra là đẩy nhầm món người chơi cố ý để ngoài.
 */
export function lanVaoLongTui(b) {
  if (!BAG.poly) return false;
  const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
  for (const p of parts) {
    if (p.circleRadius && pointInPolygon(p.position.x, p.position.y, BAG.poly)) return true;
    for (const v of p.vertices) if (pointInPolygon(v.x, v.y, BAG.poly)) return true;
    // món dài vắt ngang mép lòng túi cong: không đỉnh nào của món ở trong, nhưng mép lòng
    // túi chọc vào giữa món
    if (Matter.Bounds.overlaps(p.bounds, BAG_BB()) && BAG.poly.some(([x, y]) => Matter.Vertices.contains(p.vertices, { x, y }))) return true;
  }
  return false;
}
const BAG_BB = () => ({ min: { x: BAG.left, y: BAG.top }, max: { x: BAG.right, y: BAG.bottom } });

export function checkEject() {
  const now = performance.now();
  theoDoiMonVuaTha(now);
  for (const b of S.bodies) {
    if (b.chuaVao) continue;
    const z = bagZone(b);

    // Trong lòng túi thì đồ thôi nảy. Túi chật mà đồ còn nảy thì thả một món xuống là
    // hất luôn món đang nằm gọn bay khỏi miệng túi — Matter lấy độ nảy LỚN NHẤT của hai
    // vật, nên chỉ tắt nảy ở món vừa thả thì không ăn thua. Ra khay thì trả lại như cũ,
    // món "bouncy" vẫn nảy đúng chất của nó ở ngoài.
    if (b.restGoc != null) b.restitution = z.inZone ? Math.min(b.restGoc, .02) : b.restGoc;

    if (isHeld(b)) continue;
    if (b.thaLuc > now - CHO_SAU_THA) { b.stuck = 0; continue; }   // vừa buông, còn đang rơi
    // Chỉ đẩy món KẸT ở miệng túi: có phần lấn vào lòng túi mà không nằm gọn hẳn. Món nằm
    // ngoài tựa vào thành túi thì để yên chỗ người chơi thả.
    if (z.inZone && !z.fullyInside && b.speed < YEN_TOC && b.angularSpeed < YEN_XOAY && lanVaoLongTui(b)) {
      if (++b.stuck > YEN_DU_LAU) eject(b);
    } else b.stuck = 0;
  }
}

/**
 * Canh món vừa thả. Luật đẩy-ra-khỏi-túi chỉ chạy với món còn nằm trong vùng túi, nên
 * món trượt hẳn ra ngoài rồi thì không ai gọi hoàn tác. Ở đây canh riêng: món vừa thả
 * mà rốt cuộc nằm ngoài túi thì cũng là một lần thả hỏng, trả những món bị nó xô về chỗ cũ.
 */
function theoDoiMonVuaTha(now) {
  const luu = S.luuTui; if (!luu) return;
  const b = luu.monTha;
  if (!S.bodies.includes(b)) { S.luuTui = null; return; }
  if (isHeld(b)) return;
  const tuKhiTha = now - (b.thaLuc || 0);
  if (tuKhiTha < 900) return;                 // còn đang rơi, chưa biết kết quả
  const z = bagZone(b);
  if (!z.inZone) {                            // đã văng hẳn ra ngoài túi
    const n = hoanTacTui();
    if (n) toast(t('noFitReturned', { n }), 1800);
    return;
  }
  if (z.fullyInside && b.speed < YEN_TOC) S.luuTui = null;   // vào được rồi, thôi canh
  else if (tuKhiTha > 8000) S.luuTui = null;                 // treo lơ lửng quá lâu thì bỏ qua
}

// ---------- va chạm: tiếng tiếp đất và bụi tung lên ----------
const VA_NHE = 1.6;        // dưới mức này là món chỉ cọ vào nhau, không phải cú rơi
const NGHI_MOI_MON = 130;  // một món không kêu hai lần sát nhau
const TOI_DA_MOT_NHIP = 3; // nhiều món chạm đất cùng lúc thì chỉ lấy vài tiếng, tránh ù

let nhipMoc = 0, nhipDem = 0;

/** Bật tiếng và bụi mỗi khi có món tiếp đất. Chỉ game gọi, editor không. */
// ---------- đồ dễ vỡ ----------
// meta.fragile (đồ thuỷ tinh: lọ mứt, gương, khung ảnh, đèn lồng, kính râm, chai nước chanh): bị đồ nặng rơi
// trúng, rơi mạnh xuống sàn, hay bị đồ nặng NẰM ĐÈ lâu là nứt. Nứt lần hai là vỡ → thua ván.
const doVo = b => !!(b.realDef || b.def)?.meta?.fragile;
const GRAM_DE_NUT = 300;      // món từng này gram rơi trúng là nứt
const GRAM_DE_LAU = 500;      // món từng này gram nằm đè 1,5 s là nứt
const DE_LAU_MS = 1500;
let deTheoDoi = new Map();    // món dễ vỡ → { tu, moi } thời điểm bắt đầu bị đè và lần báo đè gần nhất
const DAU_MAN_KHONG_NUT = 2500;   // ms đầu ván: đồ đang mưa xuống, món đặt sẵn rơi xuống đáy túi — không tính nứt
function nut(b, diem) {
  const now = performance.now();
  if (b.vo || S.won || S.lost || (b.nutLuc && now - b.nutLuc < 600)) return;
  if (!S.tuiDaDung || now - S.startTime < DAU_MAN_KHONG_NUT) return;
  b.nutLuc = now; b.nut = (b.nut || 0) + 1;
  const p = diem || b.position;
  if (b.nut < 2) {
    sfx('crack', { gain: .85 }); shake(130);
    dust(p.x, p.y, { n: 5, manh: .6 }); floatText(p.x, p.y - 20, t('cracked'), '#E5484D');
    return;
  }
  b.vo = true;
  sfx('break', { gain: .95 }); shake(420);
  dust(p.x, p.y, { n: 14, manh: 1 }); sparkle(p.x, p.y, 14);
  S.lost = true; ketThucLuot('lose');
  showLose({ lyDo: t('broken', { name: itemName(b.realDef || b.def) }), choThemGio: false });
}
/** Gọi mỗi khung hình: đồ dễ vỡ bị đồ nặng nằm đè đủ lâu thì nứt */
export function theoDoiDe() {
  const now = performance.now();
  for (const [b, d] of deTheoDoi) {
    if (b.vo || !S.bodies.includes(b)) { deTheoDoi.delete(b); continue; }
    if (now - d.moi > 250) { deTheoDoi.delete(b); continue; }        // không còn bị đè
    if (now - d.tu >= DE_LAU_MS) { nut(b); d.tu = now; }               // nứt, rồi đếm lại cho lần vỡ
  }
}
export function resetDoVo() { deTheoDoi = new Map(); }

// Tiếng chạm theo chất liệu (meta.material): thuỷ tinh/sứ lanh canh, kim loại keng, giấy sột
// soạt, vải/đồ ăn phịch đục; nhựa, gỗ, điện tử là tiếng cộp mặc định.
const TIENG = { glass: 'glass', ceramic: 'glass', metal: 'metal', paper: 'paper', fabric: 'drop', food: 'drop' };
const MEM = new Set(['fabric', 'paper', 'food']);

export function bindImpacts() {
  onPress((tren, duoi) => {
    if (!doVo(duoi) || isHeld(tren) || isHeld(duoi) || gramHieuDung(tren) < GRAM_DE_LAU) return;
    const now = performance.now(), d = deTheoDoi.get(duoi);
    if (d && now - d.moi <= 250) d.moi = now; else deTheoDoi.set(duoi, { tu: now, moi: now });
  });
  onImpact((b, v, diem, vaoTuong, khac) => {
    if (v < VA_NHE || b.chuaVao || isHeld(b)) return;
    // đồ dễ vỡ: bị món nặng rơi trúng / rơi mạnh xuống sàn / rơi trúng món nặng cứng
    const gramB = gramHieuDung(b);
    if (khac && !khac.isStatic && doVo(khac) && !isHeld(khac) && gramB >= GRAM_DE_NUT && v >= 5) nut(khac, diem);
    if (doVo(b) && ((vaoTuong && v >= 9) || (khac && !khac.isStatic && gramHieuDung(khac) >= GRAM_DE_NUT && v >= 7))) nut(b, diem);
    const now = performance.now();
    if (b.vaLuc > now - NGHI_MOI_MON) return;
    b.vaLuc = now;
    if (now - nhipMoc > 90) { nhipMoc = now; nhipDem = 0; }
    if (++nhipDem > TOI_DA_MOT_NHIP) return;

    // Cú va mạnh hay nhẹ theo ĐỘNG NĂNG (gram × tốc độ²): laptop rơi là "thụp" to, gói giấy
    // rơi cùng tốc độ chỉ "phịch" khẽ. Thang log để 30 g và 1500 g đều còn nghe được.
    const gram = b.gram || 150, k = b.levelScale || 1;
    const nangLuong = gram * k * k * v * v / 1000;          // ~5 cho món 150 g rơi vừa, ~100 cho laptop
    const manh = Math.min(1, Math.max(0, Math.log10(nangLuong + 1) / 2));
    const vatLieu = (b.realDef || b.def)?.meta?.material;
    const mem = MEM.has(vatLieu) || (!vatLieu && gram / Math.max(1, b.area) < .03 && gram < 300);
    sfx(TIENG[vatLieu] || 'land', {
      gain: (mem ? .12 : .18) + manh * .6,
      // càng nặng càng trầm
      rate: Math.max(.66, Math.min(1.4, 1.35 - .22 * Math.log10(gram))) + (Math.random() - .5) * .08,
    });
    // Chạm sàn thì bụi bốc rõ, rơi trúng món khác thì chỉ lơ thơ vài hạt. Đồ mềm không bốc bụi mấy.
    const buiK = mem ? .35 : 1;
    dust(diem.x, diem.y, vaoTuong
      ? { n: Math.round((2 + manh * 8) * buiK), manh }
      : { n: Math.round((1 + manh * 3) * buiK), manh: manh * .5 });
    // Đồ nặng (từ 400 g) rơi mạnh xuống sàn / đáy túi: màn rung nhẹ, ngắn
    if (vaoTuong && gram * k * k >= 400 && v >= 4.5) shake(gram >= 1000 ? 220 : 150);
  });
}

// Số khung hình liên tiếp cần có trước khi đổi kết luận "món đã nằm gọn trong túi".
// Khoảng 60 khung một giây, nên đây là chừng 0,07 giây để vào và 0,3 giây để bị loại.
const VAO_TUI = 4, RA_KHOI = 18;

// Quãng lặng đầu màn. Vừa vào màn, đồ còn đang rơi từ trên xuống và những món đặt sẵn
// trong túi vừa chạm đáy — không phải người chơi xếp được nên không có gì để reo.
const LANG_DAU_MAN = 1000;

/** Cập nhật packing list + điều kiện thắng */
export function updateChecked() {
  theoDoiDe();
  let changed = false;
  const now = performance.now();
  for (const b of S.bodies) {
    if (b.itemId === KEY_ID || b.chuaVao) continue;
    const was = S.checked.has(b.khoa);
    const roiTay = isHeld(b) || b.locked;
    const inside = !roiTay && bagZone(b).fullyInside;

    // Chống rung. Trong túi chật, món bị hàng xóm xô nên đỉnh của nó chớp ra chớp vào
    // mép lòng túi liên tục; nếu tin ngay kết quả từng khung hình thì món bị loại ra
    // rồi tính vào lại hàng chục lần, mỗi lần vào lại là một tiếng chuông.
    // Muốn VÀO danh sách: phải nằm gọn vài khung liền và đã đi chậm lại.
    // Muốn BỊ LOẠI: phải ra khỏi lòng túi liên tục một quãng, chứ chớp một cái thì bỏ qua.
    // Riêng cầm lên tay hay bị khoá lại là hành động rõ ràng, loại ngay.
    if (roiTay) { b.inN = 0; b.outN = RA_KHOI; }
    else { b.inN = inside ? (b.inN || 0) + 1 : 0; b.outN = inside ? 0 : (b.outN || 0) + 1; }

    const ok = was ? b.outN < RA_KHOI
                   : inside && b.inN >= VAO_TUI && (b.speed < .9 || b.isStatic);
    if (ok !== was) {
      if (ok) {
        S.checked.add(b.khoa);
        // vừa khít: tiếng chuông cao dần theo số món đã xếp, kèm vòng sáng và tia.
        // Chặn thêm một nhịp nghỉ phòng khi món nằm đúng sát mép dung sai của lòng túi
        // và trạng thái "nằm gọn" tự chớp tắt.
        if (!(b.fitAt > now - 900) && now - S.startTime > LANG_DAU_MAN) {
          b.fitAt = now;
          const n = S.checked.size;
          sfx('fit', { rate: 1 + Math.min(6, n - 1) * .045 });
          ring(b.position.x, b.position.y, { color: '#5FBF9B', r1: 46 });
          sparkle(b.position.x, b.position.y, { n: 10, color: '#8FE0C1', life: 520 });
        }
      } else S.checked.delete(b.khoa);
      changed = true;
    }
  }
  for (const id of S.gone) if (!S.checked.has(id)) { S.checked.add(id); changed = true; }
  if (changed) renderList(false);

  if (S.checked.size === S.ITEMS.length && !S.drag && !S.lost) {
    if (++S.winFrames > 45 && !S.won) {
      S.won = true;
      ketThucLuot('win');   // event level_end win, ngay lúc thắng
      if (S.map) {
        const lanDau = markDone(S.map.id, S.levelIdx);
        setSpot(S.map.id, Math.min(S.levelIdx + 1, S.map.levels.length - 1));
        // lần đầu qua được và còn level phía sau → báo có màn mới mở
        if (lanDau && S.levelIdx + 1 < S.map.levels.length) sfx('unlockLv', { delay: 1.15, gain: .9 });
      }
      // thưởng cơ bản của level, cộng đúng một lần mỗi lần thắng (số hiện ở bảng thắng)
      if (!S.preview) addGold(S.LEVEL?.reward?.coin ?? 20);
      confetti(90); sfx('win'); duckMusic(true);
      floatText(210, 300, t('fits'), { color: '#5FBF9B', size: 26, life: 1200 });
      // Bảng thắng có lớp mờ phủ kín màn: hiện ngay thì che mất pháo giấy vừa bắn.
      // Chờ một nhịp cho người chơi nhìn thấy ăn mừng rồi bảng mới trượt vào.
      const diem = chamDiem();
      setTimeout(() => { if (S.won) showWin(diem); }, 700);
    }
  } else S.winFrames = 0;
}
