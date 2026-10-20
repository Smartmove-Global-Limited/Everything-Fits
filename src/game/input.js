// Điều khiển cảm ứng:
//  - Chạm nhẹ vào món (không kéo) = CHỌN, hiện nút xoay ở góc món.
//    Bấm nút xoay để xoay từng bước, giữ để xoay liên tục. Món vẫn nằm trong thế giới vật lý
//    nên khi xoay nó đẩy các món xung quanh như thật.
//    Chạm lại chính món đó, hoặc bắt đầu kéo, thì bỏ chọn.
//  - Chạm giữ rồi kéo = NHẤC LÊN: món rời khỏi thế giới vật lý, đi theo ngón tay.
//    Chồng lên món khác hoặc chòi mép túi thì thành ảo ảnh, thả ra sẽ bật ngược ra ngoài.
//  - Món buộc dây được nhấc theo cặp, coi như một khối, để dây không kéo lê món kia.
import Matter from 'matter-js';
import { S, partsOf, daVao } from './state.js';
import { canvas, toLogical } from './canvas.js';
import { computeGhost, findFreeSpot, bagZone, lanVaoLongTui } from './rules.js';
import { tetherSuspend, tetherRestore } from './mechanics.js';
import { isFrozenTime, freezeBody } from './boosters.js';
import { toast, hideHint } from '../ui/hud.js';
import { t } from '../i18n.js';
import { sfx } from '../ui/sfx.js';
import { shake } from './fx.js';
import { gramHieuDung } from './physics.js';

const { Body, World, Query, Vector } = Matter;

const DRAG_PX = 7;                 // di chuyển quá ngưỡng này thì coi là kéo, không phải chạm chọn
// Xoay tự do: đặt ngón lên nút hai mũi tên ở góc món rồi kéo, món quay theo ngón.
/** Bán kính nút xoay: co theo món để không lấn át vật, nhưng vẫn đủ to để chạm trúng */
export function rotButtonR(body) {
  const [x0, y0, x1, y1] = body.def.box, k = body.artScale || 1;
  return Math.max(9, Math.min(14, Math.min(x1 - x0, y1 - y0) * k * .3));
}

/**
 * Vị trí nút xoay: bám đúng GÓC TRÊN PHẢI của món và xoay theo món,
 * nhờ vậy nút luôn nằm ở một góc cố định của vật thay vì nhảy quanh khung bao.
 */
export function rotateButtonPos(body) {
  const [, y0, x1] = body.def.box, k = body.artScale || 1;
  const c = Vector.rotate({ x: x1 * k, y: y0 * k }, body.angle);
  return { x: body.position.x + c.x, y: body.position.y + c.y };
}

/** Các món được nhấc cùng nhau: món buộc dây đi theo cặp */
function groupOf(body) {
  if (!body.tether) return [body];
  const other = body.tether.a === body ? body.tether.b : body.tether.a;
  return other && other !== body ? [body, other] : [body];
}

/**
 * Nhấc món lên tay. `touch` cho biết đang cầm bằng ngón tay hay bằng chuột: mức nhấc
 * tính cho ngón tay (xem liftOf) đem sang chuột là thừa, xem ghi chú ở LIFT_CHUOT.
 */
export function pickUp(body, p, { touch = true } = {}) {
  S.selected = null;
  S.luuTui = null;          // bỏ ảnh chụp của lần thả trước, sắp có lần thả mới
  const group = groupOf(body);
  for (const b of group) {
    b.giuToi = 0;                    // đang giữ góc mà được nhấc lên thì thôi giữ
    b.frozen = false;                // nhấc món đang đóng băng lên thì nó thôi băng, thả lại sẽ băng lại
    if (b.isStatic) Body.setStatic(b, false);
    Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
    World.remove(S.world, b);
  }
  if (body.tether) tetherSuspend(body.tether);
  S.drag = {
    body, group,
    // vị trí tương đối của các món còn lại so với món chính, tính theo hệ toạ độ của món chính
    rel: group.map(b => ({ b, d: Vector.rotate(Vector.sub(b.position, body.position), -body.angle), a: b.angle - body.angle })),
    target: p, startP: p,
    offsetLocal: Vector.rotate(Vector.sub(p, body.position), -body.angle),
    lift: 0, liftTo: touch ? liftOf(body) : LIFT_CHUOT,
    ghost: true, lastValid: null,
  };
  // Đồ nặng (từ 800 g): nhấc thấp hơn, tiếng nhấc trầm hơn, rung máy một nhịp — thấy "có sức nặng"
  const gram = gramHieuDung(body), nang = gram >= 800;
  if (nang) { S.drag.liftTo *= .6; S.drag.nang = true; shake(70); }
  body.pop = 0;                     // món nảy nhẹ một nhịp lúc rời tay khỏi mặt bàn
  sfx('pick', { rate: 1 + (Math.random() - .5) * .12 - Math.min(.3, Math.max(0, Math.log10(gram / 150) * .28)) });
  hideHint();
}

/** Đặt lại vị trí các món phụ trong nhóm theo món chính */
function syncGroup(d) {
  const b0 = d.body;
  for (const r of d.rel) {
    if (r.b === b0) continue;
    const pos = Vector.add(b0.position, Vector.rotate(r.d, b0.angle));
    Body.setPosition(r.b, pos);
    Body.setAngle(r.b, b0.angle + r.a);
  }
}

// Khi kéo, món được nhấc hẳn LÊN TRÊN ngón tay. Món này phải xếp khít vào từng khe hở
// trong túi, nên lúc ướm người chơi cần nhìn thấy trọn cả món lẫn chỗ trống quanh nó;
// che mất một góc là mất luôn thứ duy nhất giúp ngắm.
//
// Mốc đo là ĐÁY món, không phải tâm món. Trước đây mức nhấc tính theo phần trăm chiều
// cao rồi cộng vào tâm, mà tâm cách đáy đúng nửa chiều cao — nhấc 0.55 chiều cao thì đáy
// món chỉ nhích khỏi ngón có 5% chiều cao, tức là vẫn nằm trong vệt ngón tay. Món càng
// to lỗi càng nặng, mà món to lại đúng là món khó ướm nhất.
//
// Mức nhấc KHÔNG phụ thuộc món đang xoay thế nào. Đo bằng bounds của Matter thì tiện,
// nhưng bounds ôm theo góc xoay hiện thời: cùng một món, nằm ngay ngắn dưới sàn thì bề
// cao là một đằng, đã xoay ngang trong túi lại là một nẻo, và người chơi thấy món lúc
// nhấc cao lúc nhấc thấp không theo lý gì cả. Lấy nửa CẠNH DÀI của khung món: con số
// này không đổi dù món quay kiểu gì, nên một món luôn nhấc đúng một mức, và xoay ngang
// rồi thì món vẫn nằm trọn trên ngón.
const HO_NGON_TAY = 46;   // khoảng hở từ chỗ ngón chạm lên tới mép dưới món
const LIFT_MAX = 150;     // chặn trên, phòng món quá khổ bị nhấc vọt khỏi màn hình
// Cầm bằng CHUỘT thì không có ngón tay nào che món, nên mức nhấc trên là thừa: món treo
// cách con trỏ cả trăm đơn vị, và món đang nằm trong túi vọt luôn khỏi miệng túi ngay
// khi vừa chạm — trên editor và Creative Tool nhìn như món trong túi bị nhấc cao hơn món
// dưới sàn. Chuột chỉ nhích một chút cho có cảm giác đã cầm lên.
const LIFT_CHUOT = 8;
function liftOf(b) {
  const box = b.def?.box;
  const r = box ? Math.max(box[2] - box[0], box[3] - box[1]) * (b.artScale || 1) / 2
                : (b.bounds?.max.y ?? b.position.y) - b.position.y;
  return Math.min(LIFT_MAX, r + HO_NGON_TAY);
}

/** Gọi mỗi frame trước Engine.update */
export function moveHeld(dt = 16) {
  const d = S.drag; if (!d) return;
  const b = d.body;
  d.lift += (d.liftTo - d.lift) * .25;          // dâng dần, món theo ngón lên chứ không nhảy cóc
  if (b.pop != null && b.pop < 1) b.pop = Math.min(1, b.pop + dt / 220);
  // Món đặt ĐÚNG chỗ ngón tay, không đuổi theo sau.
  // Trước đây mỗi khung hình chỉ đi 55% quãng đường còn lại. Đứng yên thì không ai thấy,
  // nhưng kéo nhanh là món tụt lại một khoảng tỉ lệ với tốc độ — càng vung tay nhanh càng
  // xa ngón, dừng lại nó mới bò về. Món đang cầm đã bị gỡ khỏi thế giới vật lý rồi, không
  // có gì để nó phải đi từ từ: đặt thẳng vào vị trí ngón là hết trượt.
  const want = Vector.sub(d.target, Vector.rotate(d.offsetLocal, b.angle));
  want.y -= d.lift;
  // Riêng đồ nặng cố ý cho trễ tay một chút (mỗi khung đi 60% quãng còn lại): cảm giác ì của
  // vật nặng; món nhẹ vẫn bám đúng ngón như ghi chú trên.
  if (d.nang) { want.x = b.position.x + (want.x - b.position.x) * .6; want.y = b.position.y + (want.y - b.position.y) * .6; }
  Body.setPosition(b, want);
  syncGroup(d);
  d.ghost = d.group.some(x => computeGhost(x, d.group));
  if (!d.ghost) d.lastValid = { x: b.position.x, y: b.position.y, angle: b.angle };
}

export function drop() {
  const d = S.drag; if (!d) return;
  const b = d.body;
  let bounce = false;

  // Chụp lại thế xếp đang có trong túi TRƯỚC khi món này rơi vào.
  // Túi đầy mà cố nhét thêm thì đống đồ bị ép, món đang nằm gọn có thể bị nặn trào ra
  // khỏi miệng túi. Nếu hoá ra chính món vừa thả mới là món không vừa, ta trả những
  // món kia về đúng chỗ cũ — công sức xếp của người chơi không mất vì một lần thử hỏng.
  S.luuTui = {
    monTha: b,
    list: S.bodies
      .filter(x => !d.group.includes(x) && !x.chuaVao && bagZone(x).fullyInside)
      .map(x => ({ b: x, x: x.position.x, y: x.position.y, a: x.angle })),
  };
  if (d.ghost) {
    if (d.group.some(x => bagZone(x).inZone && lanVaoLongTui(x))) {   // không vừa trong túi → trả ra khay
      // Món bị dời chỗ tức thì, nên đánh dấu cả nơi nó rời đi lẫn nơi nó hiện ra,
      // không thì người chơi chỉ thấy món tự nhiên biến mất rồi mọc ở chỗ khác.
      S.puffs.push({ x: b.position.x, y: b.position.y, t: 0 });
      findFreeSpot(b, d.group); syncGroup(d); bounce = true;
    } else if (d.lastValid) {
      Body.setPosition(b, d.lastValid); Body.setAngle(b, d.lastValid.angle); syncGroup(d);
    } else { findFreeSpot(b, d.group); syncGroup(d); }
  }
  const luc = performance.now();
  for (const x of d.group) {
    x.thaLuc = luc;          // luật đẩy ra khỏi túi chờ món rơi hẳn rồi mới xét
    // Món không vừa đã bị dời hẳn xuống khay rồi; bơm thêm vận tốc ngược lên nữa thì
    // nó vọt lên mấy chục pixel ngay sau khi vừa hiện ra, nhìn như bị hất tung.
    // Chỉ đẩy nhẹ sang ngang để thấy là món vừa bị trả ra, còn lại để trọng lực lo.
    Body.setVelocity(x, bounce ? { x: (Math.random() - .5) * 1.6, y: 0 } : { x: 0, y: 0 });
    Body.setAngularVelocity(x, 0);
    World.add(S.world, x);
    // Đang đóng băng: món thả gọn vào túi đứng yên đúng chỗ vừa thả, không rơi, không bị đẩy
    if (!bounce && isFrozenTime() && bagZone(x).fullyInside) freezeBody(x);
  }
  if (b.tether) tetherRestore(b.tether);
  if (bounce) { S.puffs.push({ x: b.position.x, y: b.position.y, t: 0 }); toast(t('noFit')); sfx('nope'); }
  else sfx('drop', { rate: 1 + (Math.random() - .5) * .1, gain: .9 });
  S.drag = null;
}

// ---------- xoay tự do bằng một ngón ----------
// Chạm vào nút hai mũi tên ở góc món rồi kéo: món quay theo đúng hướng ngón đi,
// giống cách xoay ảnh trong các app dựng video. Thả ngón là dừng ở đúng góc đó.
let spin = null;   // { body, id, startAngle, startPointer, moved }

// Xoay xong buông tay thì món ĐỨNG IM một nhịp, giữ nguyên góc vừa canh.
//
// Không có nhịp này thì vật lý nhận lại món ngay khi ngón rời màn, và món có đáy cong —
// quả chuối là ví dụ rõ nhất — lăn về thế nằm của nó trong chớp mắt. Người chơi xoay
// xong, chưa kịp đặt ngón xuống để kéo đi thì góc vừa canh đã mất, phải xoay lại từ đầu.
// Một giây đủ để với tay tới món, mà chưa đủ lâu để thành ra món treo lơ lửng.
const GIU_SAU_XOAY = 1000;

function giuGocSauXoay(b) {
  if (b.isStatic) return;          // món vốn đã đứng yên sẵn thì không có gì để giữ
  Body.setVelocity(b, { x: 0, y: 0 });
  Body.setAngularVelocity(b, 0);
  // Trên khay (ngoài túi) thì giữ góc luôn tới khi người chơi chạm lại: món cong như quả
  // chuối xoay nghiêng mà thả cho vật lý là đổ lăn về thế nằm, trượt đi cả mấy chục đơn vị,
  // mất góc vừa canh. Không đóng băng hẳn (món còn lơ lửng thì treo luôn trên không), chỉ
  // khoá góc và chỗ ngang, còn rơi xuống sàn thì vẫn rơi. Xem thaGocDaGiu.
  if (!bagZone(b).inZone) { b.giuToi = Infinity; b.khoaGoc = b.angle; b.khoaX = b.position.x; return; }
  // Trong túi thì đóng băng một nhịp rồi để nó lọt vào khe như thật.
  Body.setStatic(b, true);
  b.giuToi = performance.now() + GIU_SAU_XOAY;
}

/** Hết nhịp giữ thì trả món lại cho vật lý */
function thaGocDaGiu() {
  const now = performance.now();
  for (const b of S.bodies) {
    if (!b.giuToi) continue;
    // Luật đẩy-ra-khỏi-túi đếm số khung hình món nằm im mà vẫn chòi mép túi. Món đang bị
    // đóng băng thì khung nào cũng "nằm im", để nguyên là xoay hơi lâu một chút đã bị
    // hất ra khay. Mấy khung này không tính.
    b.stuck = 0;
    if (b.giuToi === Infinity) {         // trên khay: khoá góc và chỗ ngang, rơi dọc vẫn tự nhiên
      Body.setAngle(b, b.khoaGoc); Body.setAngularVelocity(b, 0);
      Body.setPosition(b, { x: b.khoaX, y: b.position.y });
      Body.setVelocity(b, { x: 0, y: b.velocity.y });
      continue;
    }
    if (now < b.giuToi) continue;
    b.giuToi = 0;
    Body.setStatic(b, false);
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
  }
}

function beginSpin(body, p, pointerId) {
  if (body.giuToi === Infinity) body.giuToi = 0;   // đang khoá góc trên khay: gỡ để ngón tay xoay được
  spin = {
    body, id: pointerId, moved: false,
    startAngle: body.angle,
    x0: body.position.x, y0: body.position.y,     // chỗ đứng lúc bắt đầu xoay, xem tickRotation
    startPointer: Math.atan2(p.y - body.position.y, p.x - body.position.x),
  };
  Body.setAngularVelocity(body, 0);
}

function moveSpin(p) {
  const b = spin.body;
  spin.moved = true;
  const now = Math.atan2(p.y - b.position.y, p.x - b.position.x);
  Body.setAngle(b, spin.startAngle + (now - spin.startPointer));
  Body.setAngularVelocity(b, 0);
  if (b.tether) {                       // món buộc cùng không bị giật theo
    const o = b.tether.a === b ? b.tether.b : b.tether.a;
    if (o) Body.setVelocity(o, { x: o.velocity.x * .4, y: o.velocity.y * .4 });
  }
}

export const isSpinning = () => !!spin;

/** Giữ món đang xoay đứng yên, và trả lại cho vật lý những món đã hết nhịp giữ */
export function tickRotation() {
  if (spin) {
    // Đang xoay thì món đứng yên một chỗ như đang bị ngón tay giữ: chỉ đổi góc. Không ghim
    // thì đầu cong của món (quả chuối) lấn vào sàn, vào món bên cạnh, bị vật lý đẩy ngang,
    // món trơn trượt đi cả chục đơn vị trong lúc người chơi còn đang xoay. Cho phép bị đẩy
    // LÊN (không lún vào sàn), còn sang ngang hay rơi xuống thì không.
    const b = spin.body;
    if (!b.isStatic) {
      Body.setPosition(b, { x: spin.x0, y: b.position.y });
      Body.setVelocity(b, { x: 0, y: b.velocity.y });
    }
    Body.setAngularVelocity(b, 0);
  }
  thaGocDaGiu();
  bamKhay();
}

// Món trơn (ma sát thấp: chuối, táo, son…) trơn là để TRONG TÚI nó trượt vào khe cho vừa.
// Nằm ngoài khay mà vẫn trơn thì vừa xoay xong buông tay, hay bị món khác chạm khẽ, là
// trượt đi mất chỗ người chơi vừa đặt. Nên ngoài túi món nào cũng bám khay như thường;
// vào vùng túi thì trả lại đúng độ trơn gốc.
const BAM_KHAY = .6, BAM_KHAY_TINH = .8;
function bamKhay() {
  for (const b of S.bodies) {
    if (b.isStatic || !daVao(b)) continue;
    const ngoai = !bagZone(b).inZone;
    if (ngoai && !b.maSatKhay && b.friction < BAM_KHAY) {
      b.maSatKhay = [b.friction, b.frictionStatic];
      b.friction = BAM_KHAY; b.frictionStatic = Math.max(b.frictionStatic, BAM_KHAY_TINH);
    } else if (!ngoai && b.maSatKhay) {
      b.friction = b.maSatKhay[0]; b.frictionStatic = b.maSatKhay[1];
      b.maSatKhay = null;
    }
  }
}

function hitRotateButton(p) {
  if (!S.selected) return false;
  const c = rotateButtonPos(S.selected);
  return Math.hypot(p.x - c.x, p.y - c.y) <= rotButtonR(S.selected) + 12;   // vùng chạm rộng hơn nút để dễ bấm
}

// ---------- pointer ----------
let pending = null;   // món vừa chạm xuống, chưa biết là chạm chọn hay kéo

function onDown(e) {
  if (S.won || S.lost || S.paused) return;
  try { canvas.setPointerCapture(e.pointerId); } catch {}   // con trỏ giả lập thì bỏ qua
  const p = toLogical(e);
  if (S.drag) return;

  if (hitRotateButton(p)) { beginSpin(S.selected, p, e.pointerId); return; }   // nút ở góc món

  const hit = Query.point(S.bodies.filter(daVao).flatMap(partsOf), p);
  const body = hit.length ? hit[0].parent : null;

  // Đang chọn một món mà chạm ra chỗ trống: kéo ở đâu cũng xoay được món đó.
  // Chạm mà không kéo thì coi như bỏ chọn, xử lý ở onUp.
  if (!body) {
    if (S.selected) beginSpin(S.selected, p, e.pointerId);
    return;
  }
  pending = { body, startP: p, id: e.pointerId };
}

function onMove(e) {
  const p = toLogical(e);
  if (spin && e.pointerId === spin.id) { moveSpin(p); return; }
  if (pending && e.pointerId === pending.id) {
    if (Vector.magnitude(Vector.sub(p, pending.startP)) > DRAG_PX) {   // đã kéo đủ xa → nhấc lên
      // Bút hay con trỏ không rõ loại coi như ngón tay: thà nhấc thừa còn hơn để che mất món
      pickUp(pending.body, pending.startP, { touch: e.pointerType !== 'mouse' });
      S.drag.id = e.pointerId; S.drag.target = p;
      pending = null;
    }
    return;
  }
  if (S.drag && e.pointerId === S.drag.id) S.drag.target = p;
}

function onUp(e) {
  if (spin && e.pointerId === spin.id) {
    if (spin.moved) giuGocSauXoay(spin.body);                               // giữ nguyên góc vừa canh một nhịp
    else if (!hitRotateButton(toLogical(e))) S.selected = null;             // chạm chỗ trống, không kéo → bỏ chọn
    spin = null;
    return;
  }
  if (pending && e.pointerId === pending.id) {          // chạm nhẹ → chọn hoặc bỏ chọn
    S.selected = S.selected === pending.body ? null : pending.body;
    sfx('tap', { gain: .45, rate: S.selected ? 1.3 : 1 });
    pending = null;
    return;
  }
  if (S.drag && e.pointerId === S.drag.id) drop();
}

export function bindInput() {
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
}
