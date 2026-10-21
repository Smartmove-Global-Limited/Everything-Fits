// Lắc điện thoại: đồ TRONG TÚI lắc theo tay người chơi, mọi thứ khác đứng yên.
//
// Đọc gia tốc ngang của máy (devicemotion). Máy giật sang phải thì đồ trong túi, theo quán
// tính, bị dồn sang trái so với túi: đặt lên mỗi món một lực NGƯỢC chiều gia tốc, tỉ lệ với
// độ mạnh của cú lắc. Lắc nhẹ thì đồ chỉ lắc lư, trượt vào khe hở bên cạnh; lắc mạnh thì
// thêm một chút lực nhấc cho đồ đang chèn nhau nới ra rồi rơi xuống khít hơn.
//
// Chỉ đẩy ngang thì không đủ: đồ nằm chồng lên nhau ghì bằng ma sát tĩnh ~0,8 trọng lực, cú lắc
// thật lại ngắn (vài chục mili giây) và đổi chiều liên tục, nên đo trên máy thật đồ đứng im.
// Ngoài đời lắc túi thì đồ nảy khẽ, lúc lơ lửng không còn bị ghì. Làm giống vậy: trong lúc lắc
// hạ tạm ma sát của đồ trong túi và rung dọc rất nhẹ, thôi lắc một nhịp thì trả ma sát như cũ.
// Túi, đồ trên sàn, món đang cầm và món đang đóng băng không bị ảnh hưởng.
//
// iOS chỉ cho đọc cảm biến sau khi người chơi đồng ý, và chỉ hỏi được trong một lần chạm:
// lần chạm đầu tiên vào game sẽ xin quyền. Không có cảm biến (máy tính) thì dùng phím mũi tên
// để thử, và Creative Tool / console gọi lacHuong() hoặc shakeImpulse() được.
//
// Đọc cả hai trục trên mặt màn hình nên lắc ngang, dọc hay chéo đều ra đúng hướng. Trục dọc
// riêng một bộ số: tay người đi bộ hay nghiêng máy cũng tạo gia tốc dọc, nên vùng chết cao
// hơn; hất LÊN thì chặn nhẹ vì túi hở miệng, mạnh quá là đồ bay khỏi túi rồi bị trả về khay.
import Matter from 'matter-js';
import { S, isHeld, daVao } from './state.js';
import { bagZone } from './rules.js';
import { Haptics } from '@capacitor/haptics';
import { isVibOn } from '../ui/sfx.js';

const { Body } = Matter;

const G = 9.81;              // m/s², để đổi gia tốc thật sang đơn vị trọng lực của game
const VUNG_CHET = .7;        // m/s²: tay cầm run nhẹ dưới mức này thì bỏ qua
const TRAN = 14;             // m/s²: lắc mạnh hơn nữa cũng chỉ tính bằng chừng này
// Khuếch đại cú lắc: theo tỉ lệ vật lý của game chiếc túi to cỡ 1,6 m ngoài đời, lắc tay thật
// chỉ làm đồ nhích chưa tới 1 cm, mắt không thấy. Nhân lên cho đồ lắc lư rõ mà không văng.
const DO_NHAY = 4.5;
const NHAC_TU = 5;           // m/s²: từ mức này trở lên thì thêm lực nhấc cho đồ nới ra
const NHAC = .22;            // độ mạnh lực nhấc so với lực ngang
const RUNG = .35;            // rung dọc ngẫu nhiên, theo phần của lực ngang
const MA_SAT_KHI_LAC = .15;  // ma sát còn lại khi đang lắc, theo phần ma sát gốc
const GIU_NOI = 280;         // thôi lắc chừng này mili giây thì trả ma sát như cũ
const LOC = .8;              // hệ số lọc bỏ trọng lực khi máy chỉ báo gia tốc kèm trọng lực

// Trục dọc: game khoá màn dọc, trục y của cảm biến chạy dọc màn, dương là hướng lên đầu máy.
const VUNG_CHET_DOC = 1.2;   // m/s²: nhún tay khi đi bộ, nghiêng máy dưới mức này thì bỏ qua
const TRAN_LEN = 4;          // m/s²: hất đồ lên tối đa chừng này (gần 2 lần trọng lực sau khuếch đại)

let ax = 0;                  // gia tốc ngang đã lọc, m/s², dương = máy giật sang phải
let ay = 0;                  // gia tốc dọc đã lọc, m/s², dương = máy giật lên (đồ bị dằn xuống)
let trongLuc = 0, trongLucY = 0;   // thành phần trọng lực trên hai trục (khi phải tự lọc)
let giaLap = 0, giaLapY = 0, giaLapToi = 0;   // lắc giả lập (phím, Creative Tool), m/s²
let batDau = false;

function onMotion(e) {
  const a = e.acceleration;
  if (a && a.x != null) { ax = a.x; ay = a.y ?? 0; return; }
  // Máy chỉ có gia tốc kèm trọng lực: lọc thông thấp lấy trọng lực rồi trừ đi, từng trục.
  // Trục dọc gánh gần trọn 9,8 m/s² trọng lực khi cầm dọc, lọc thế này thì nghiêng máy
  // chậm là trôi theo bộ lọc, chỉ cú giật nhanh mới còn lại.
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  trongLuc = LOC * trongLuc + (1 - LOC) * g.x;
  ax = g.x - trongLuc;
  if (g.y != null) { trongLucY = LOC * trongLucY + (1 - LOC) * g.y; ay = g.y - trongLucY; }
}

/** Bật cảm biến. Gọi một lần lúc khởi động game. */
export function bindShake() {
  if (batDau) return; batDau = true;
  const lang = () => window.addEventListener('devicemotion', onMotion);
  const DM = window.DeviceMotionEvent;
  if (DM && typeof DM.requestPermission === 'function') {
    // iOS 13+: phải xin quyền trong một lần chạm của người chơi
    const xin = () => DM.requestPermission().then(r => { if (r === 'granted') lang(); }).catch(() => {});
    window.addEventListener('pointerdown', xin, { once: true, capture: true });
  } else if (DM) lang();

  // Máy tính: phím mũi tên lắc thử, giữ phím là lắc liên tục. Mũi tên chỉ hướng ĐỒ bị hất đi.
  // Giữ hai phím cùng lúc (← và ↑) là lắc chéo.
  window.addEventListener('keydown', e => {
    if (e.target?.matches?.('input,select,textarea')) return;
    if (!MUI_TEN[e.key]) return;
    e.preventDefault();          // không để trang cuộn theo phím
    dangGiu.add(e.key);
    const [dx, dy] = huongPhim(dangGiu);
    if (dx || dy) lacHuong(dx, dy);
  });
  window.addEventListener('keyup', e => dangGiu.delete(e.key));
  window.addEventListener('blur', () => dangGiu.clear());
}
const MUI_TEN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const dangGiu = new Set();
/** Hướng gộp của các phím mũi tên đang giữ: ← + ↑ là chéo lên trái. Dùng chung cho Creative Tool. */
export function huongPhim(keys) {
  let dx = 0, dy = 0;
  for (const k of keys) { const h = MUI_TEN[k]; if (h) { dx += h[0]; dy += h[1]; } }
  return [Math.sign(dx), Math.sign(dy)];
}

// Độ mạnh của một cú lắc theo hướng, m/s². Ngang lấy đúng mức phím ← → trước nay. Dọc lên nhẹ
// hơn hẳn: túi hở miệng ở trên, hất mạnh là đồ bay khỏi túi rồi bị trả về khay. Dọc xuống là
// dằn đồ lún xuống, mạnh được.
const MANH_NGANG = 7, MANH_LEN = 3.2, MANH_XUONG = 7;

/**
 * Lắc giả lập theo HƯỚNG ĐỒ BỊ HẤT: (dx, dy) trên màn hình, dy = −1 là lên, chéo thì cả hai
 * khác 0 (được chuẩn hoá nên lắc chéo không mạnh hơn lắc thẳng). Đồ bị hất sang trái nghĩa
 * là túi vừa bị giật sang phải, nên gia tốc máy ngược dấu. `k` nhân độ mạnh, mặc định 1.
 */
export function lacHuong(dx, dy, { k = 1, ms = 180 } = {}) {
  const dai = Math.hypot(dx, dy); if (!dai) return;
  const ux = dx / dai, uy = dy / dai;
  const mY = uy < 0 ? MANH_LEN : MANH_XUONG;
  // ngang: lực lên đồ = −a nên a ngược dấu hướng; dọc: lực lên đồ = +ay nên ay cùng dấu
  shakeImpulse(-ux * MANH_NGANG * k, ms, uy * mY * k);
}

/**
 * Một tràng lắc qua lại như tay người: vài cú đổi chiều, nhỏ dần. Trả về khi lắc xong.
 *   'x'     trái ↔ phải          'y'     lên ↕ xuống
 *   'cheo'  hai đường chéo xen nhau (↖↘ rồi ↗↙): đồ bị xốc theo mọi hướng, lún khít nhất
 */
const TRANG_LAC = {
  x: [[-1, 0], [1, 0]],
  y: [[0, 1], [0, -1]],
  cheo: [[-1, -1], [1, 1], [1, -1], [-1, 1]],
};
export async function lacQuaLai(truc = 'x', { lan = 6, k = 1.2 } = {}) {
  const cho = ms => new Promise(r => setTimeout(r, ms / (S.timeScale || 1)));
  const mau = TRANG_LAC[truc] || TRANG_LAC.x;
  const n = Math.max(lan, mau.length * 2);
  for (let i = 0; i < n; i++) {
    const [dx, dy] = mau[i % mau.length], nho = 1 - i / (n * 1.6);
    lacHuong(dx, dy, { k: k * nho, ms: 120 });
    await cho(150);
  }
}

/**
 * Mách người chơi một lần trên máy có cảm biến: lắc máy là đồ trong túi xê dịch.
 * Nhớ trong máy để không nhắc lại mỗi màn.
 */
export function goiYLacMotLan(toast, text) {
  const KEY = 'snug.shakeHint.v1';
  if (!('ontouchstart' in window) || !window.DeviceMotionEvent) return;
  try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, '1'); } catch { return; }
  setTimeout(() => toast(text, 3200), 1200);
}

/**
 * Túi lắc theo tay: hình túi lệch ngược chiều gia tốc (quán tính, như đồ bên trong) và nghiêng
 * nhẹ, bám theo bằng lò xo có giảm chấn nên lắc nhanh hay chậm đều ra nhịp đúng. Chỉ là hình
 * vẽ, thành túi vật lý đứng yên; lệch tối đa vài đơn vị nên không thấy đồ hở ra khỏi thành.
 */
const tui = { x: 0, v: 0, y: 0, vy: 0 };
export function lacTui(dt = 16) {
  let a = ax, b = ay;
  if (giaLapToi > performance.now()) { a = giaLap; b = giaLapY; }
  if (Math.abs(a) < VUNG_CHET) a = 0;
  if (Math.abs(b) < VUNG_CHET_DOC) b = 0;
  const muc = Math.max(-1, Math.min(1, -a / TRAN)) * 12;          // đích: tối đa 12 đơn vị
  const mucY = Math.max(-1, Math.min(1, b / TRAN)) * 8;           // dọc: tối đa 8 đơn vị, cùng chiều đồ
  const k = .12, c = .28;                                          // độ cứng, giảm chấn
  const f = Math.min(2, dt / 16);
  tui.v += (muc - tui.x) * k - tui.v * c;
  tui.x += tui.v * f;
  tui.vy += (mucY - tui.y) * k - tui.vy * c;
  tui.y += tui.vy * f;
  return { x: tui.x, y: tui.y, rot: tui.x * .0035 };
}

/**
 * Lắc giả lập trong ms mili giây. a (m/s²) dương là máy giật sang phải, đồ bị hất sang trái.
 * ay (m/s²) dương là máy giật lên, đồ bị dằn XUỐNG (+y màn hình); âm là đồ bị hất lên.
 */
export function shakeImpulse(a, ms = 200, ay = 0) { giaLap = a; giaLapY = ay; giaLapToi = performance.now() + ms; }

/** Gọi mỗi bước vật lý, trước Engine.update */
/** Trả ma sát gốc cho món đã thôi bị lắc một lúc */
function traMaSat(now, tatCa = false) {
  for (const b of S.bodies) {
    if (!b.maSatGoc || (!tatCa && now < b.noiToi)) continue;
    b.friction = b.maSatGoc[0]; b.frictionStatic = b.maSatGoc[1];
    b.maSatGoc = null;
  }
}

// ---------- năng lượng lắc ----------
// Thanh "Shake energy" trên HUD (Figma: EF / Shake energy). Mỗi ván bắt đầu đầy; lắc thật
// (có đồ trong túi bị lắc) thì tụt dần, đủ CAN_SAU mili giây lắc là cạn. Cạn thì khoá lắc và
// gọi khiCan ĐÚNG MỘT LẦN để mở popup "Shake energy empty"; lắc tiếp không bật lại nữa (user chốt
// 2026-10-21), muốn xem quảng cáo hồi thì bấm vào viên năng lượng trên HUD (xem quảng cáo để
// hồi đầy). Creative Tool và khung xem thử của editor không tính năng lượng.
const CAN_SAU = 8000;
const KHONG_TINH = new URLSearchParams(location.search).get('creative') === '1';
let nangLuong = 1, tickTruoc = 0;
let khiCan = () => {}, khiDoi = () => {};
export const nangLuongLac = () => nangLuong;
export function datNangLuong(v) { nangLuong = Math.max(0, Math.min(1, v)); khiDoi(nangLuong); }
/** Đăng ký: fnCan khi người chơi lắc lúc thanh đã cạn; fnDoi mỗi khi mức năng lượng đổi */
export function onShakeEnergy({ can, doi }) { if (can) khiCan = can; if (doi) khiDoi = doi; }

export function tickShake() {
  if (!S.world) return;
  const now = performance.now();
  const dt = Math.min(50, now - (tickTruoc || now)); tickTruoc = now;
  if (S.won || S.lost || S.paused) { traMaSat(now, true); return; }
  traMaSat(now);
  let a = ax, doc = ay;
  if (giaLapToi > now) { a = giaLap; doc = giaLapY; }
  if (Math.abs(a) < VUNG_CHET) a = 0;
  if (Math.abs(doc) < VUNG_CHET_DOC) doc = 0;
  if (!a && !doc) return;
  const tinhNangLuong = !KHONG_TINH && !S.preview;
  if (tinhNangLuong && nangLuong <= 0) return;   // cạn: không lắc được nữa
  a = Math.max(-TRAN, Math.min(TRAN, a));
  doc = Math.max(-TRAN_LEN, Math.min(TRAN, doc));      // âm là hất đồ lên: chặn thấp hơn

  // Trọng lực của game (gravity.y × scale trên mỗi đơn vị khối lượng) ứng với 9,81 m/s² ngoài đời
  const g = S.engine.gravity, don = g.y * g.scale * DO_NHAY / G;
  const manh = Math.hypot(a, doc);
  // lực nhấc chỉ thêm cho lắc ngang; lắc dọc tự nó đã nhấc hoặc dằn đồ rồi
  const nhac = Math.abs(a) >= NHAC_TU ? (Math.abs(a) - NHAC_TU) * NHAC : 0;
  let co = false;
  for (const b of S.bodies) {
    if (!daVao(b) || b.isStatic || isHeld(b)) continue;
    if (!bagZone(b).inZone) continue;          // chỉ đồ trong túi, đồ trên sàn đứng yên
    // Nới ma sát trong lúc lắc (nhớ giá trị gốc để trả lại)
    if (!b.maSatGoc) b.maSatGoc = [b.friction, b.frictionStatic];
    b.friction = b.maSatGoc[0] * MA_SAT_KHI_LAC; b.frictionStatic = b.maSatGoc[1] * MA_SAT_KHI_LAC;
    b.noiToi = now + GIU_NOI;
    // Quán tính: máy giật sang phải thì đồ dồn sang trái so với túi; thêm rung dọc khẽ
    const rung = (Math.random() - .5) * 2 * RUNG * Math.abs(a);
    // Tổng lực hướng LÊN (hất dọc + lực nhấc của lắc ngang + rung) không vượt TRAN_LEN:
    // lắc chéo mạnh mà để hai trục cộng dồn thì đồ bay cao gấp rưỡi, túi đầy là văng khỏi miệng.
    let len = Math.max(0, -doc) + nhac + Math.max(0, rung);
    if (len > TRAN_LEN) len = TRAN_LEN;
    const y = doc > 0 ? doc - Math.min(len, nhac + Math.max(0, rung)) : -len;
    if (b.isSleeping) Matter.Sleeping.set(b, false);   // vật ngủ không nhận lực
    Body.applyForce(b, b.position, { x: -a * don * b.mass, y: y * don * b.mass });
    co = true;
  }
  // Rung máy như lắc túi thật (thay tiếng sột soạt cũ, nghe rè rè khó chịu): mỗi lần ĐỔI
  // CHIỀU lắc là lúc đồ trong túi đập vào thành, rung một nhịp ngắn, lắc càng mạnh nhịp càng dài.
  // Không rung đều liên tục, giữa hai nhịp có quãng nghỉ cho khỏi thành rè rè.
  if (co) rungTheoLac(a, doc, manh, now);
  if (co && tinhNangLuong) {
    const truoc = Math.round(nangLuong * 100);
    nangLuong = Math.max(0, nangLuong - dt / CAN_SAU);
    if (Math.round(nangLuong * 100) !== truoc || nangLuong === 0) khiDoi(nangLuong);
    if (nangLuong === 0) khiCan();   // vừa cạn: báo một lần (lần sau đã return ở trên)
  }
}

const RUNG_TU = 3.5;          // m/s²: đổi chiều mạnh hơn mức này mới rung
const RUNG_NGHI = 85;         // mili giây nghỉ tối thiểu giữa hai nhịp rung
let chieuNgang = 0, chieuDoc = 0, rungToi = 0;
function rungTheoLac(a, doc, manh, now) {
  const cn = Math.sign(a), cd = Math.sign(doc);
  const doiChieu = (cn && chieuNgang && cn !== chieuNgang) || (cd && chieuDoc && cd !== chieuDoc);
  if (cn) chieuNgang = cn;
  if (cd) chieuDoc = cd;
  if (!doiChieu || manh < RUNG_TU || now < rungToi) return;
  rungToi = now + RUNG_NGHI;
  rung(Math.round(Math.min(48, 12 + manh * 2.4)));
}
/** Rung máy ms mili giây: app dùng bộ rung thật qua plugin Haptics, web dùng navigator.vibrate */
function rung(ms) {
  if (!isVibOn()) return;   // Settings › Vibration tắt
  Haptics.vibrate({ duration: ms }).catch(() => { try { navigator.vibrate?.(ms); } catch {} });
}
