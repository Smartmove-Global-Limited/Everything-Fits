// Tự chơi: dùng solver tìm chỗ cho từng món rồi lần lượt nhấc và đặt vào, như người chơi thật.
// Dùng để kiểm tra nhanh một level có xếp được không mà không phải ngồi kéo tay,
// và để Creative Tool quay video gameplay.
//
// Hai chế độ:
//   full   xếp một mạch tới hết
//   step   xếp MỘT món rồi đứng chờ; gọi autoStep() thì xếp món tiếp. Dùng khi cần canh
//          đúng khung hình: túi đầy một nửa, món cuối đang bay…
import Matter from 'matter-js';
import { thaVaoSan } from './level.js';
import { S, BAG, isHeld, TABLE_Y, W } from './state.js';
import { KEY_ID, MYSTERY } from '../data/items.js';
import { makeItem } from './physics.js';
import { pickUp, drop } from './input.js';
import { solve, solveAsync } from '../gen/solver.js';
import { loiGiaiHopLe, thuTuDat } from '../gen/solution.js';
import { bagZone } from './rules.js';
import { toast } from '../ui/hud.js';
import { shakeImpulse } from './shake.js';
import { t } from '../i18n.js';

const { Body, World, Bounds, Collision, Vector } = Matter;

// Nhịp của máy tự chơi, tính bằng mili giây THẬT ở tốc độ 1x.
// "nghi" là quãng chờ cho món vừa thả lắng xuống trước khi đặt món tiếp: rút quá tay
// thì món sau đè lên món trước lúc nó còn đang xê dịch, máy xếp được ít đi.
const NHIP = { moDau: 300, bay: 210, nghi: 60, ketThuc: 420, langToiDa: 620, tayToi: 260, tayNhac: 120 };

let running = false;
// Ván mà máy đang chơi. Chơi lại / đổi màn là dựng ván mới (S.phienVan tăng): mọi vòng lặp
// của máy hỏi song() thay vì chỉ hỏi running, nên máy của ván cũ thôi ngay chứ không chạy
// song song với máy mới, cùng nhấc cùng đặt một món.
let vanMay = -1;
const song = () => running && S.phienVan === vanMay;
let dangChay = null;            // Promise của lượt chạy hiện tại, lượt mới chờ nó thoát hẳn
let mode = 'full';
let waitingStep = false;        // step: đang đứng chờ lệnh xếp món tiếp
let releaseStep = null;         // hàm mở khoá cho lần chờ hiện tại
let quiet = false;              // Creative Tool: không hiện toast của máy, lộ ngay là bot

export const isAutoplaying = () => running;
/** 'idle' | 'busy' (đang bay/đang lắng) | 'waiting' (step: chờ bấm tiếp) */
export const autoState = () => (!running ? 'idle' : waitingStep ? 'waiting' : 'busy');
export const autoMode = () => mode;
export function setAutoQuiet(v) { quiet = !!v; }

/** Tốc độ máy chơi nhân với tốc độ game: quay chậm thì tay cũng phải chậm theo */
export let playSpeed = 1;
export function setPlaySpeed(v) { playSpeed = Math.max(.1, Number(v) || 1); }
const heSo = () => playSpeed * (S.timeScale || 1);
const wait = ms => new Promise(r => setTimeout(r, ms / heSo()));
// Chờ theo thời gian GAME (chỉ chia tốc độ thời gian, không chia nhịp tay): dùng cho những
// việc vật lý phải làm xong — lắc túi lắng lại, đồ vừa thu nhỏ rơi xuống — tay nhanh hay
// chậm không đổi được tốc độ của chúng.
const waitGame = ms => new Promise(r => setTimeout(r, ms / (S.timeScale || 1)));
const note = (msg, ms) => { if (!quiet) toast(msg, ms); };

/**
 * Chờ món vừa thả nằm yên hẳn rồi mới xếp món tiếp.
 * Nhịp nghỉ cố định là sai: món rơi từ trên cao xuống đống đồ cần lâu hơn món đặt sát
 * đáy. Đặt món tiếp khi đống đồ còn đang xê dịch thì nó rơi trượt đi, để lại khe hở.
 * Chờ theo tốc độ thật nên vừa chắc vừa không phí thời gian ở những món rơi nhanh.
 */
async function choLang(body) {
  const t0 = performance.now();
  await wait(NHIP.nghi);
  while (song() && performance.now() - t0 < NHIP.langToiDa / heSo()) {
    if (body.speed < .35 && body.angularSpeed < .06) break;
    await wait(32);
  }
}

/**
 * Chờ CẢ ĐỐNG nằm yên (không chỉ món vừa thả): món vừa rơi xuống có thể xô món bên cạnh,
 * nhấc món tiếp lúc món kia còn trượt là kế hoạch lệch dần. Yên = mọi món đứng im liên tục
 * vài nhịp; quá lâu (vật lý cứ rung nhẹ) thì thôi, đi tiếp.
 */
async function choLangHet(toiDa = 3000) {
  const t0 = performance.now();
  let yen = 0;
  await wait(NHIP.nghi);
  while (song() && performance.now() - t0 < toiDa / heSo()) {
    const dong = S.bodies.some(b => !b.isStatic && !b.chuaVao && !isHeld(b) && (b.speed > .12 || b.angularSpeed > .02));
    yen = dong ? 0 : yen + 1;
    if (yen >= 5) break;
    await wait(32);
  }
}

/** Nội suy ease in-out từ 0 tới 1 trong ms mili giây (đã chia tốc độ) */
async function animate(ms, fn) {
  const t0 = performance.now(), dur = ms / heSo();
  for (;;) {
    const k = Math.min(1, (performance.now() - t0) / dur);
    fn(k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
    if (k >= 1) break;
    await wait(16 * heSo());
    if (!song()) return;
  }
}

/** Ngón tay giả bay tới chỗ món trước khi nhấc; không bật ngón tay thì bỏ qua ngay */
async function tayToi(body) {
  if (!S.showFinger) return;
  const from = S.finger || { x: body.position.x, y: body.position.y + 120 };
  const sx = from.x, sy = from.y, tx = body.position.x, ty = body.position.y;
  await animate(NHIP.tayToi, e => { S.finger = { x: sx + (tx - sx) * e, y: sy + (ty - sy) * e, down: false }; });
  S.finger = { x: tx, y: ty, down: true };
  await wait(NHIP.tayNhac);
}

/** Đưa món từ chỗ hiện tại tới đích theo đường cong, trong lúc đó món không va chạm với ai */
async function moveTo(body, tx, ty, targetAngle, ms = NHIP.bay) {
  const sx = body.position.x, sy = body.position.y, sa = body.angle;
  await animate(ms, e => {
    const x = sx + (tx - sx) * e, y = sy + (ty - sy) * e - Math.sin(e * Math.PI) * 26;
    Body.setPosition(body, { x, y });
    Body.setAngle(body, sa + (targetAngle - sa) * e);
    if (S.showFinger) S.finger = { x, y, down: true };
  });
}

/** Món đang được giữ góc sau khi người chơi xoay (đứng yên trên khay) thì thả ra trước khi máy nhấc */
function boGiu(b) { if (b.giuToi) { b.giuToi = 0; if (b.isStatic) Body.setStatic(b, false); Matter.Sleeping.set(b, false); } }

// ---------- KIỂU NGƯỜI ----------
// Máy chơi như người thật, dùng cho Creative quay video. Khác kiểu máy ở chỗ:
//   - nhấc, kéo, thả bằng ĐÚNG đường kéo thả của người chơi (pickUp → S.drag → drop), nên món
//     được nhấc lên cao khỏi ngón, có tiếng nhấc tiếng thả, và thả ra là do vật lý lo: rơi,
//     lăn, va vào món khác, lún vào khe như người thả tay;
//   - thả cao hơn chỗ định một chút rồi để rơi, tay không chính xác tuyệt đối, không nắn lại;
//   - có nhịp nghĩ trước khi nhấc, tay đi đường cong, nhanh chậm theo quãng đường, xoay món
//     dần trong lúc kéo; chỗ định thả đang vướng thì nhấc cao thêm chút rồi mới thả.
let kieuNguoi = false;
export function setAutoHuman(v) { kieuNguoi = !!v; }
export const autoHuman = () => kieuNguoi;

const ngau = (a, b) => a + Math.random() * (b - a);
const lechN = k => (Math.random() - .5) * 2 * k;
const goc0 = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Ngón tay giả đi tới một điểm theo đường cong nhẹ */
async function tayToiDiem(p) {
  if (!S.showFinger) return;
  const from = S.finger || { x: p.x + 40, y: p.y + 140 };
  const sx = from.x, sy = from.y, cong = lechN(30);
  await animate(ngau(200, 320), e => {
    S.finger = { x: sx + (p.x - sx) * e + Math.sin(e * Math.PI) * cong, y: sy + (p.y - sy) * e, down: false };
  });
  S.finger = { x: p.x, y: p.y, down: true };
  await wait(ngau(60, 130));
}

/**
 * Kéo một món bằng tay tới chỗ thân món nằm ở `dich` với góc `goc`, rồi thả. Món đi theo ngón
 * như người chơi kéo (moveHeld đặt món theo d.target mỗi bước vật lý).
 */
async function keoNguoi(body, dich, goc) {
  boGiu(body);
  const cham = { x: body.position.x + lechN(5), y: body.position.y + lechN(5) };   // chạm gần tâm, không đúng tâm
  await tayToiDiem(cham);
  if (!song() || !S.bodies.includes(body) || S.drag) return false;
  // Cầm kiểu CHUỘT: món chỉ nhích lên chút sát con trỏ, như người chơi kéo bằng chuột trên
  // máy tính (Creative quay trên máy tính). Kiểu ngón tay nhấc món cao hẳn khỏi ngón, nhìn
  // như tay và món tách rời nhau.
  pickUp(body, cham, { touch: false });
  const d = S.drag; if (!d || d.body !== body) return false;
  d.target = { ...cham };
  const a0 = body.angle, da = goc0(goc - a0);
  // ngón phải ở đâu để THÂN món nằm đúng `dich`: bù chỗ chạm trên món và mức nhấc khỏi ngón
  const tayCho = () => { const o = Matter.Vector.rotate(d.offsetLocal, body.angle); return { x: dich.x + o.x, y: dich.y + o.y + d.liftTo }; };
  const s0 = { ...d.target }, e0 = tayCho();
  const quang = Math.hypot(e0.x - s0.x, e0.y - s0.y);
  const cong = Math.min(60, quang * .18) * (Math.random() < .5 ? 1 : -1);
  await animate(260 + quang * 1.15 + ngau(0, 120), e => {
    Body.setAngle(body, a0 + da * Math.min(1, e * 1.25));       // xoay xong trước khi tới nơi
    const ee = tayCho();
    // cong nhẹ sang bên theo quãng, như cổ tay vung
    const px = s0.x + (ee.x - s0.x) * e, py = s0.y + (ee.y - s0.y) * e;
    const nx = -(ee.y - s0.y) / (quang || 1), ny = (ee.x - s0.x) / (quang || 1);
    const k = Math.sin(e * Math.PI) * cong;
    d.target = { x: px + nx * k, y: py + ny * k };
    if (S.showFinger) S.finger = { x: d.target.x, y: d.target.y, down: true };
  });
  if (!song() || S.drag !== d) return false;
  Body.setAngle(body, goc);
  d.target = tayCho();
  // ngập ngừng canh chỗ; đang vướng (món chồng lên món khác) thì nhấc cao dần rồi mới thả
  await wait(ngau(70, 160));
  for (let i = 0; i < 10 && d.ghost && song() && S.drag === d; i++) {
    d.target = { x: d.target.x + lechN(1.5), y: d.target.y - 4 };
    if (S.showFinger) S.finger = { x: d.target.x, y: d.target.y, down: true };
    await wait(45);
  }
  if (!song() || S.drag !== d) return false;
  drop();
  if (S.finger) S.finger = { ...S.finger, down: false, y: S.finger.y - 4 };
  return true;
}

async function datMonNguoi(body, step) {
  await wait(ngau(160, 520));                       // nhìn túi, chọn chỗ
  // Theo lời giải lưu sẵn (xếp khít 85–93%): tay chuẩn hơn, lệch nhiều là món sau hết chỗ
  const chuan = !!step.loiGiai;
  const goc = (step.angle || 0) + lechN(chuan ? .008 : .035);
  // thả cao hơn chỗ định cho món tự rơi xuống như buông tay thật, tay lệch vài đơn vị
  const dich = viTriThan(body, step.x + lechN(chuan ? .8 : 2.5), step.y - ngau(14, 24), goc);
  if (!await keoNguoi(body, dich, goc)) return;
  await choLang(body);
  await wait(ngau(80, 260));                        // để mắt thấy món lắng xuống rồi mới sang món sau
}

/**
 * Theo lời giải lưu sẵn (khít 85–93%): khe chỉ vừa đúng bằng món, kéo kiểu chuột thật thì
 * món quệt vào món bên cạnh, tay tự nhấc dần lên rồi mới thả và món nằm cao hơn chỗ định.
 * Nên tay đưa món tới ĐÚNG phía trên chỗ của nó, thả ở độ cao THA_CAO cho món rơi xuống bằng
 * vật lý như buông tay thật, nhịp chậm cho mắt theo kịp; lắng xong lệch chút thì nắn nhẹ.
 */
const THA_CAO = 12, NHIP_GIAI = { bay: 560, truoc: 220, sau: 260 };
async function datMonTheoGiai(body, step) {
  boGiu(body);
  await tayToi(body);
  await wait(NHIP_GIAI.truoc);                       // nhìn túi, chọn chỗ
  World.remove(S.world, body);
  Body.setVelocity(body, { x: 0, y: 0 }); Body.setAngularVelocity(body, 0);
  const goc = step.angle || 0;
  // thả cao nhất có thể mà không chạm món nào: buông tay ngay trong lòng món khác là vật lý
  // hất món kia văng ra. Chỗ (step) đã được kiểm tra trống trước khi gọi.
  const cao = [THA_CAO, 8, 5, 2, 0].find(h => choHopLe(body, step.x, step.y - h, goc)) ?? 0;
  const dich = viTriThan(body, step.x, step.y - cao, goc);
  await moveTo(body, dich.x, dich.y, goc, NHIP_GIAI.bay);
  if (!S.bodies.includes(body)) { if (S.finger) S.finger = { ...S.finger, down: false }; return; }
  World.add(S.world, body);                          // buông tay: món rơi xuống
  Body.setVelocity(body, { x: 0, y: 0 }); Body.setAngularVelocity(body, 0);
  if (S.showFinger && S.finger) S.finger = { ...S.finger, down: false, y: S.finger.y - 6 };
  await choLangHet();
  nanLai(body, step, 9, 10 * Math.PI / 180);
  await wait(NHIP_GIAI.sau);
}

/** Nhấc một món lên, bay tới chỗ, thả xuống, chờ lắng */
async function datMon(body, step) {
  if (step.loiGiai) return datMonTheoGiai(body, step);
  if (kieuNguoi) return datMonNguoi(body, step);
  boGiu(body);
  await tayToi(body);
  World.remove(S.world, body);                       // nhấc lên: tạm rời khỏi thế giới vật lý
  Body.setVelocity(body, { x: 0, y: 0 }); Body.setAngularVelocity(body, 0);
  const dich = viTriThan(body, step.x, step.y - 1, step.angle || 0);   // cao hơn 1 đơn vị: không chèn vào món dưới ngay lúc thả
  await moveTo(body, dich.x, dich.y, step.angle || 0);
  // Hộp bí ẩn bay ngang qua chìa khoá là mở ra ngay giữa đường (checkUnlock chạy mỗi bước):
  // thân cũ đã bị thay, thêm nó lại vào thế giới là có một vật ma không ai quản.
  if (!S.bodies.includes(body)) { if (S.finger) S.finger = { ...S.finger, down: false }; await wait(NHIP.nghi * 3); return; }
  World.add(S.world, body);                          // thả xuống
  Body.setVelocity(body, { x: 0, y: 0 }); Body.setAngularVelocity(body, 0);
  if (S.showFinger && S.finger) S.finger = { ...S.finger, down: false, y: S.finger.y - 4 };
  await choLang(body);                               // chờ nằm yên rồi mới sang món sau
  nanLai(body, step);
}

/**
 * Món vừa đặt nằm xuống lệch kế hoạch chút xíu (vài độ, vài đơn vị) thì nắn về đúng chỗ,
 * như người chơi đẩy nhẹ cho ngay, nếu đúng chỗ đó vẫn trống. Đo trên máy: áo mưa nằm
 * nghiêng 2° là món thứ hai hết vừa chỗ đã định, phải tính lại cả ván bằng kế hoạch kém hơn.
 */
const NAN_GOC = 6 * Math.PI / 180, NAN_XA = 5;
function nanLai(body, step, xaToiDa = NAN_XA, gocToiDa = NAN_GOC) {
  if (!song() || !S.bodies.includes(body) || body.isStatic || isHeld(body)) return;
  const g = gocHinh(body), goc = step.angle || 0;
  const lechGoc = Math.abs(Math.atan2(Math.sin(body.angle - goc), Math.cos(body.angle - goc)));
  const lechXa = Math.hypot(g.x - step.x, g.y - step.y);
  if (lechGoc < .004 && lechXa < .6) return;                 // đã đúng chỗ
  if (lechGoc > gocToiDa || lechXa > xaToiDa) return;        // lệch nhiều: để vật lý quyết
  if (!choHopLe(body, step.x, step.y, goc)) return;
  Body.setAngle(body, goc);
  Body.setPosition(body, viTriThan(body, step.x, step.y, goc));
  Body.setVelocity(body, { x: 0, y: 0 }); Body.setAngularVelocity(body, 0);
  ghi(`  nắn ${body.label} về đúng kế hoạch (lệch ${lechXa.toFixed(1)}, ${(lechGoc * 180 / Math.PI).toFixed(1)}°)`);
}

const ngoaiTui = step => step.x < BAG.left - 40 || step.x > BAG.right + 40 || step.y < BAG.top - 40 || step.y > BAG.bottom + 40;

/**
 * Cửa chờ giữa hai món. Chế độ full đi thẳng; chế độ step đứng lại cho tới khi
 * autoStep() gọi. Món đầu tiên không chờ: bấm nút là phải thấy một món bay ngay.
 */
let daXepMon = 0;
async function cuaCho() {
  if (mode !== 'step' || daXepMon === 0) return;
  waitingStep = true;
  await new Promise(r => { releaseStep = r; });
  releaseStep = null; waitingStep = false;
}

// Danh mục cấu hình máy xếp, thử lần lượt tới khi có kế hoạch TRỌN. Đo trên các level đầy
// 82–89%: không cấu hình nào thắng hết, nhưng level nào cũng có ít nhất một cấu hình xếp
// trọn trong ~2 giây. Lưới thô thử được nhiều phương án hơn nên đứng trước; mặt nạ 'inner'
// (món béo ra chút, không chèn nhau khi thả) đứng trước 'center'. Mỗi cấu hình 2 giây,
// chỉ tính trọn ở đầu ván và khi kế hoạch vỡ; solveAsync nhả nhịp nên game vẫn vẽ đều.
const DANH_MUC = [
  { cell: 5, mask: 'inner', goc: 8 },
  { cell: 5, mask: 'center', goc: 8 },
  { cell: 4, mask: 'inner', goc: 16 },
  { cell: 3, mask: 'inner', goc: 16 },
];
const MOI_CAU_HINH = { tries: 20000, budgetMs: 1500 };
let cauHinhDangDung = DANH_MUC[0];
// Kẹt giữa chừng (còn món mà hết chỗ) thì tháo hết đồ ra khay, tính lại từ đầu bằng kế hoạch
// khác rồi xếp lại, tối đa chừng này lần. Kế hoạch trên lưới là ước lượng, đồ rơi thật lệch
// vài px là món cuối có thể hết chỗ; đổi cách xếp thường là qua.
const SO_LAN_XEP = 5;
let lanThu = 0;

// Có được dùng booster khi hết chỗ không. Mặc định KHÔNG: video quảng cáo cần cảnh xếp
// vừa bằng tay. Bật lên thì máy dùng như người chơi: lắc → thu nhỏ → bỏ.
let dungBoosterKhiKet = false;
export function setAutoBoosters(v) { dungBoosterKhiKet = !!v; }
export const autoBoosters = () => dungBoosterKhiKet;

/**
 * Gốc hình ↔ trọng tâm. Máy xếp tính bằng hình của món quanh GỐC HÌNH (toạ độ trong định
 * nghĩa món), còn thân vật lý xoay quanh TRỌNG TÂM. Với hình sinh từ ảnh hai điểm này lệch
 * nhau vài đơn vị, và độ lệch xoay theo món. Trước đây máy đặt trọng tâm vào chỗ dành cho
 * gốc hình nên món nào cũng rơi trật kế hoạch vài px, sai lệch dồn lại thành khe hở.
 * body.origin = gốc hình − trọng tâm ở góc 0, chưa nhân cỡ (level.js không cập nhật khi scale).
 */
function gocHinh(b) {           // vị trí gốc hình trên màn của một thân đang nằm
  const k = b.artScale || 1, o = b.origin || { x: 0, y: 0 };
  const r = Vector.rotate({ x: o.x * k, y: o.y * k }, b.angle);
  return { x: b.position.x + r.x, y: b.position.y + r.y };
}
function viTriThan(b, x, y, goc) {   // trọng tâm phải ở đâu để gốc hình nằm đúng (x, y) ở góc goc
  const k = b.artScale || 1, o = b.origin || { x: 0, y: 0 };
  const r = Vector.rotate({ x: o.x * k, y: o.y * k }, goc || 0);
  return { x: x - r.x, y: y - r.y };
}

/** Hiện trạng túi cho máy xếp: vật cản là mọi thứ đang nằm trong vùng túi, theo hình và góc thật */
function hienTrang(ungVien) {
  const c = S.LEVEL.container, cx = c.cx ?? 210, bottom = c.bottom ?? 404;
  const dangDat = new Set(ungVien);
  const vatCan = S.bodies.filter(b => !b.chuaVao && !dangDat.has(b) && !isHeld(b) && bagZone(b).inZone);
  return {
    container: c,
    items: [
      // artScale là cỡ THẬT đang có: cỡ riêng trong level nhân với các lần thu nhỏ bằng booster
      ...vatCan.map(b => { const g = gocHinh(b); return { id: b.locked ? -1 : b.itemId, inBag: true, angle: b.angle, scale: b.artScale || 1, x: g.x - cx, y: g.y - bottom }; }),
      ...ungVien.map(b => ({ id: b.locked ? -1 : b.itemId, scale: b.artScale || 1, ref: b })),
    ],
  };
}

/**
 * Kế hoạch đang bám theo: danh sách bước sắp từ dưới lên, mỗi bước mang `ref` là body.
 * Lập trọn một lần từ hiện trạng; mỗi lượt lấy bước kế, KIỂM TRA lại chỗ đó trước hiện
 * trạng mới (đồ rơi vào không nằm đúng như vẽ), nhích vài ô nếu cần; chỗ đó hỏng hẳn thì
 * mới lập lại cả kế hoạch. Nhờ vậy giữ được cái nhìn toàn cục của lần tìm kiếm dài, thay
 * vì mỗi bước lại tham lam chọn món thấp nhất rồi tự dồn mình vào góc.
 */
let keHoach = [];
// Nhật ký gỡ lỗi của máy chơi, đọc ở console: __game.autoLog
export const autoLog = [];
const ghi = (...a) => { if (autoLog.length > 400) autoLog.shift(); autoLog.push(`${(performance.now() / 1000).toFixed(1)}s ` + a.join(' ')); };

// Tìm kỹ (hai hạt giống, không bỏ ngang) chỉ khi lập kế hoạch cho CẢ ván: lúc bắt đầu và
// ngay sau khi tháo đồ ra xếp lại. Tính lại giữa chừng chỉ cần nhanh, lần đo trên máy tốn
// tới 12 giây mỗi lần tính lại vì tìm kỹ cả lúc không cần.
let timKy = false;
let khongTron = 0;   // số lần tìm kỹ liền nhau mà không ra kế hoạch trọn
async function lapKeHoach(ungVien) {
  S.mayNghi = true;
  try { return await lapKeHoachThat(ungVien); } finally { S.mayNghi = false; }
}
/**
 * Level có lời giải lưu sẵn (gen/solution.js) thì lần lập kế hoạch đầu ván đi theo đúng lời
 * giải đó: cách xếp khít 85–90% tính lúc thiết kế, máy xếp trên lưới không tìm lại được.
 * Chỉ dùng khi chưa xếp lại lần nào; đã tháo ra xếp lại thì quay về máy xếp.
 */
const LAP_GIAI_TOI_DA = 3;   // một ván quay lại lời giải tối đa chừng này lần, quá thì để máy xếp tính
let lanLapGiai = 0;
function keHoachTuLoiGiai(ungVien) {
  if (lanThu || lanLapGiai >= LAP_GIAI_TOI_DA) return null;
  const ds = loiGiaiHopLe(S.LEVEL); if (!ds) return null;
  const theoKhoa = new Map(ungVien.map(b => [b.khoa, b]));
  const kh = thuTuDat(ds.filter(st => theoKhoa.has(st.i)))
    .map(st => ({ id: st.id, ref: theoKhoa.get(st.i), x: st.x, y: st.y, angle: st.angle || 0, loiGiai: true }));
  if (!kh.length) return null;
  lanLapGiai++;
  return kh;
}

async function lapKeHoachThat(ungVien) {
  const tuGiai = keHoachTuLoiGiai(ungVien);
  if (tuGiai) {
    timKy = false; keHoach = tuGiai; cauHinhDangDung = DANH_MUC[0];
    ghi(`lập kế hoạch theo LỜI GIẢI LƯU SẴN: ${tuGiai.length} bước`);
    return { solvable: true, plan: tuGiai, placedCount: tuGiai.length, needCount: ungVien.length };
  }
  const ky = timKy; timKy = false;
  const tt = hienTrang(ungVien);
  let best = null;
  const t0 = performance.now();
  // Mỗi lần xếp lại bắt đầu từ một cấu hình khác và gieo ngẫu nhiên khác: lặp lại đúng
  // kế hoạch vừa thất bại thì chỉ thất bại y như cũ.
  // Không tìm ra kế hoạch trọn với hạt giống mới thì quay về hạt giống gốc: kế hoạch gốc
  // thường vẫn đúng, lần trước hỏng là do đồ rơi lệch chứ không phải do kế hoạch.
  const n = DANH_MUC.length, ds = [];
  for (const seed of ky && lanThu ? [1 + lanThu * 7919, 1] : [1 + lanThu * 7919]) for (let i = 0; i < n; i++) ds.push({ ...DANH_MUC[(i + lanThu) % n], seed });
  for (let i = 0; i < ds.length; i++) {
    const ch = ds[i];
    if (!song()) break;
    const sol = await solveAsync(tt, { ...MOI_CAU_HINH, ...ch, huy: () => !song() });
    sol.cauHinh = ch;
    ghi(`  thử cell${ch.cell}/${ch.mask}/${ch.goc}#${ch.seed}: ${sol.placedCount}/${sol.needCount} ${sol.solvable ? 'TRỌN' : ''} (${sol.tries} lần)`);
    const hon = !best || sol.placedCount > best.placedCount;
    if (!best || sol.solvable || hon) best = sol;
    if (sol.solvable) break;                    // có kế hoạch trọn thì thôi, không thử tiếp
    if (i >= 1 && !hon && !ky) break;           // tính lại giữa chừng: hai cấu hình liền không nhích được thì thôi, cho nhanh
  }
  cauHinhDangDung = best?.cauHinh || DANH_MUC[0];
  if (ky) { if (best?.solvable) khongTron = 0; else khongTron++; }
  keHoach = (best?.plan || []).filter(st => !ngoaiTui(st) && st.ref && S.bodies.includes(st.ref));
  // Bóng bay đặt sau cùng: máy xếp tính đồ rơi xuống, bóng lại bay lên, đặt sớm là nó dâng lên
  // chiếm chỗ của món sau. Để cuối thì nó dâng vào khoảng trống còn lại phía trên.
  keHoach.sort((a, b) => (a.ref.bay ? 1 : 0) - (b.ref.bay ? 1 : 0));
  ghi(`lập kế hoạch: ứng viên [${ungVien.map(b => b.label).join(' ')}], vật cản ${tt.items.filter(i => i.inBag).length}, kế hoạch ${keHoach.length} bước [${keHoach.map(st => st.ref.label).join(' ')}], ${Math.round(performance.now() - t0)}ms`);
  return best;
}

/**
 * Chỗ (x, y, góc) có đặt được món này không, đo bằng HÌNH HỌC THẬT chứ không qua lưới:
 * dựng một thân vật lý tạm đúng hình, cỡ, góc rồi xem nó nằm trọn trong lòng túi và lún
 * vào đồ đang nằm trong túi không quá 2 đơn vị (vật lý tự tách được mức đó, không xô ai).
 * Kiểm tra qua lưới thì đồ nằm lệch 1px so với kế hoạch đã đủ lệch một ô, báo "không vừa"
 * sai và kéo theo tính lại vô ích.
 */
// Mặt nạ lưới 5px hụt so với hình thật tới 1,5px mỗi mép, nên hai món cạnh nhau trong kế
// hoạch có thể chồng thật 3px. Vật lý tách 3–4px êm, không xô ai; chặt hơn là chỗ đúng bị
// từ chối, món phải nhích đi, sai lệch dồn tới món cuối thì hết chỗ.
const LUN_DO = 3.5, LUN_TUONG = 3;
let lyDoTuChoi = '';   // vì sao lần kiểm tra gần nhất từ chối, cho chẩn đoán
function choHopLe(body, x, y, goc) {
  const def = body.locked ? MYSTERY : (body.realDef || body.def);
  const tam = makeItem(def, x, y);
  const k = body.artScale || 1;
  if (k !== 1) { Body.scale(tam, k, k); tam.artScale = k; }
  Body.setAngle(tam, goc || 0);
  Body.setPosition(tam, viTriThan(tam, x, y, goc));   // gốc hình đúng chỗ (x, y) sau khi xoay
  lyDoTuChoi = '';
  if (!bagZone(tam).fullyInside) { lyDoTuChoi = `ngoài túi bounds[${Math.round(tam.bounds.min.x)},${Math.round(tam.bounds.min.y)},${Math.round(tam.bounds.max.x)},${Math.round(tam.bounds.max.y)}] túi[${Math.round(BAG.left)},${Math.round(BAG.top)},${Math.round(BAG.right)},${Math.round(BAG.bottom)}]`; return false; }
  const manhTam = tam.parts.length > 1 ? tam.parts.slice(1) : [tam];
  const soat = (khac, nguong, ten) => {
    for (const o of khac) {
      if (!Bounds.overlaps(o.bounds, tam.bounds)) continue;
      const manhO = o.parts.length > 1 ? o.parts.slice(1) : [o];
      for (const a of manhTam) for (const b of manhO) {
        const c = Collision.collides(a, b);
        if (c && c.collided && c.depth > nguong) { lyDoTuChoi = `${ten} ${o.label} lún ${c.depth.toFixed(1)}`; return false; }
      }
    }
    return true;
  };
  if (!soat(S.bodies.filter(o => o !== body && !o.chuaVao && !isHeld(o)), LUN_DO, 'chạm')) return false;
  return soat(S.staticBodies, LUN_TUONG, 'tường');
}

/** Chẩn đoán: lập kế hoạch cho hiện trạng rồi soi từng bước ở đúng chỗ kế hoạch định */
export async function chanDoan() {
  const ungVien = conOKhay();
  const sol = await solveAsync(hienTrang(ungVien), { ...MOI_CAU_HINH, ...DANH_MUC[0] });
  return (sol.plan || []).map(st => {
    const ok = st.ref ? choHopLe(st.ref, st.x, st.y, st.angle || 0) : null;
    return `${st.ref?.label} (${st.x},${st.y}) ${Math.round((st.angle || 0) * 180 / Math.PI)}° → ${ok ? 'ok' : lyDoTuChoi}`;
  });
}

/** Tìm chỗ hợp lệ gần chỗ kế hoạch định: đúng chỗ trước, rồi nhích vài đơn vị, rồi xoay nhẹ */
const LECH_Y = [0, -2, -4, -7, -10, 2], LECH_X = [0, -2, 2, -4, 4, -7, 7];
function timChoGan(body, st) {
  const buocGoc = Math.PI / cauHinhDangDung.goc;
  const nhe = 3 * Math.PI / 180;       // xoay nhẹ vài độ: đủ lách qua món bên dưới nằm hơi nghiêng
  for (const da of [0, -nhe, nhe, -buocGoc / 2, buocGoc / 2]) for (const dy of LECH_Y) for (const dx of LECH_X) {
    const goc = (st.angle || 0) + da;
    if (choHopLe(body, st.x + dx, st.y + dy, goc)) return { ...st, x: st.x + dx, y: st.y + dy, angle: goc, lech: Math.abs(dx) + Math.abs(dy), xoay: da !== 0 };
  }
  return null;
}

/** Như timChoGan nhưng dò rộng hơn (lời giải khít: món trước lệch vài đơn vị là chỗ hẹp đi) */
function timChoRong(body, st) {
  let tot = null;
  for (const da of [0, -.05, .05, -.1, .1]) for (let dy = -16; dy <= 6; dy += 2) for (let dx = -12; dx <= 12; dx += 3) {
    const lech = Math.abs(dx) + Math.abs(dy) + Math.abs(da) * 40;
    if (tot && lech >= tot.lech) continue;
    const goc = (st.angle || 0) + da;
    if (choHopLe(body, st.x + dx, st.y + dy, goc)) tot = { ...st, x: st.x + dx, y: st.y + dy, angle: goc, lech: Math.round(lech) };
  }
  return tot;
}

async function buocTiepTheo(ungVien) {
  if (!S.LEVEL?.container || !ungVien.length) return null;
  const conHopLe = () => { keHoach = keHoach.filter(st => ungVien.includes(st.ref)); return keHoach.length > 0; };
  if (!conHopLe()) await lapKeHoach(ungVien);
  if (!conHopLe()) return null;

  const st = keHoach[0];
  const chinh = timChoGan(st.ref, st);
  if (chinh) { ghi(`đặt ${st.ref.label} theo kế hoạch, lệch ${chinh.lech}${chinh.xoay ? ', xoay nhẹ' : ''}`); keHoach.shift(); return { body: st.ref, step: chinh }; }

  // Theo lời giải lưu sẵn: chỗ đã định bị món trước lấn sang thì dò rộng hơn quanh đó. Không
  // bao giờ ép vào chỗ đang vướng: vật lý sẽ hất món đang nằm đó văng ra ngoài.
  if (st.loiGiai) {
    const rong = timChoRong(st.ref, st);
    if (rong) { ghi(`đặt ${st.ref.label} theo lời giải, dò rộng lệch ${rong.lech}`); keHoach.shift(); return { body: st.ref, step: rong }; }
    ghi(`chỗ của ${st.ref.label} trong lời giải đã bị vướng → bỏ lời giải, máy xếp tính lại`);
    lanLapGiai = LAP_GIAI_TOI_DA;
  }

  // chỗ đã định không còn vừa → lập lại từ hiện trạng
  ghi(`chỗ của ${st.ref.label} không còn vừa → tính lại`);
  await lapKeHoach(ungVien);
  if (!keHoach.length) return null;
  const st2 = keHoach.shift();
  return { body: st2.ref, step: st2 };
}

/**
 * Mở hộp bí ẩn: nhấc hộp, đưa tới chạm chìa khoá đang nằm trong túi. checkUnlock bắt được
 * va chạm là thay hộp bằng món thật; món thật thường to hơn hộp nên game tự trả nó về khay
 * nếu chỗ đó không chứa nổi. Làm việc này TRƯỚC khi xếp món khác: kế hoạch phải biết hình
 * thật của món chứ không phải cái hộp 62×62.
 */
async function moKhoa(hop, chia) {
  ghi(`mở khoá: kéo ${hop.label} (${Math.round(hop.position.x)},${Math.round(hop.position.y)}) tới chìa (${Math.round(chia.position.x)},${Math.round(chia.position.y)})`);
  boGiu(hop);
  await tayToi(hop);
  World.remove(S.world, hop);
  Body.setVelocity(hop, { x: 0, y: 0 }); Body.setAngularVelocity(hop, 0);
  await moveTo(hop, chia.position.x, chia.position.y - 4, hop.angle);
  // chờ vài bước vật lý cho checkUnlock bắt va chạm
  const t0 = performance.now();
  while (song() && S.bodies.includes(hop) && hop.locked && performance.now() - t0 < 700) await wait(32);
  if (S.bodies.includes(hop)) { World.add(S.world, hop); ghi('  mở khoá KHÔNG thành, thả hộp tại chỗ'); }
  else { const moi = S.bodies.find(b => b.khoa === hop.khoa); ghi(`  đã mở: ${moi?.label} giờ ở (${Math.round(moi?.position.x)},${Math.round(moi?.position.y)}), ${moi && bagZone(moi).inZone ? 'trong vùng túi' : 'ngoài khay'}`); }
  if (S.finger) S.finger = { ...S.finger, down: false };
  await wait(NHIP.nghi * 4);
}

/** Những món còn phải xếp: đang ở khay, chưa vào túi, không buộc dây (xếp tay khó mô phỏng) */
// Cộng thêm món KẸT: đã nằm trong vùng túi mà mãi không được tính là vào (lòi nửa ra ngoài
// miệng túi, chèn lệch). Người chơi thấy thì nhấc lên đặt lại; máy cũng vậy: kẹt quá KET_LAU
// thì món đó thành ứng viên, được nhấc ra và tìm chỗ khác, không đứng chờ nó tự trả về khay.
const KET_LAU = 1500;
function ketLau(b) {
  const now = performance.now();
  if (b.isStatic || S.checked.has(b.khoa) || !bagZone(b).inZone || b.speed > .4) { b.ketTu = null; return false; }
  if (b.ketTu == null) b.ketTu = now;
  return now - b.ketTu > KET_LAU / (S.timeScale || 1);
}
const conOKhay = () => S.bodies.filter(b => !b.chuaVao && !b.tether && b.itemId !== KEY_ID
  && !S.checked.has(b.khoa) && !S.gone.has(b.khoa) && !isHeld(b) && (!bagZone(b).inZone || ketLau(b)));

/**
 * Hết chỗ mà đồ còn ở khay: làm đúng việc người chơi làm, theo thứ tự nhẹ tay trước.
 *   thu nhỏ   món to nhất ngoài túi bé đi 20%
 *   bỏ đi     bớt một món thường
 * Bấm qua chính nút trên HUD để số lượt, tiếng và hiệu ứng y như người bấm.
 * Trả về false khi không còn booster nào.
 */
async function dungBooster() {
  const bam = id => { const el = document.getElementById(id); if (!el || el.disabled) return false; el.click(); return true; };
  if (S.boosts.resize > 0 && bam('bResize')) { await waitGame(600); return true; }
  if (S.boosts.throw > 0 && bam('bThrow')) { await waitGame(700); return true; }
  return false;
}

/** Chạy tự chơi cho level đang mở */
export async function autoplay({ mode: m = 'full' } = {}) {
  if (song()) return;                                 // đang chơi chính ván này rồi
  if (dangChay) { stopAutoplay(); await dangChay; }   // máy của ván cũ còn dở: chờ nó thoát hẳn
  if (running || S.won || S.lost || !S.LEVEL) return;
  running = true; vanMay = S.phienVan; mode = m; daXepMon = 0; waitingStep = false; keHoach = []; lanThu = 0; lanLapGiai = 0; timKy = true; lacCon = SO_LAN_LAC; khongTron = 0;
  S.selected = null; S.drag = null;
  dangChay = (async () => {
    try { await chayTuChoi(); }
    catch (e) { console.error('autoplay:', e); ghi('LỖI ' + (e?.message || e)); }
    finally { S.finger = null; running = false; waitingStep = false; S.mayNghi = false; }
  })();
  await dangChay; dangChay = null;
}

/**
 * Hết chỗ mà còn lượt xếp lại: tháo hết đồ đã xếp ra khay rồi báo vòng chính lập kế hoạch mới.
 * Trả về false khi đã xếp lại đủ số lần.
 */
/**
 * Lắc túi như người chơi lắc điện thoại: vài cú qua lại, đồ trong túi nới ra rồi lún xuống
 * khít hơn, thường mở ra đủ chỗ cho món cuối. Rẻ hơn nhiều so với tháo hết ra xếp lại.
 */
let lacCon = 0;
const SO_LAN_LAC = 2;
async function lacTuiThu() {
  ghi('lắc túi cho đồ lún xuống');
  for (const a of [9, -9, 8, -8]) { if (!song()) return; shakeImpulse(a, 150); await waitGame(190); }
  for (let i = 0; i < 40 && song() && S.bodies.some(b => !b.isStatic && b.speed > .4); i++) await waitGame(50);
  keHoach = [];
}

async function xepLai() {
  if (lanThu + 1 >= SO_LAN_XEP || !song()) return false;
  // Tìm kỹ hai lần liền (hai hạt giống khác nhau) vẫn không ra cách xếp trọn: màn này khó
  // quá sức máy hoặc cần booster. Tháo ra xếp lại nữa chỉ phí thời gian.
  if (khongTron >= 2) { ghi('dừng xếp lại: hai lần tìm kỹ đều không ra kế hoạch trọn'); return false; }
  lanThu++;
  ghi(`XẾP LẠI lần ${lanThu + 1}/${SO_LAN_XEP}`);
  note(t('autoRetry', { a: lanThu + 1, b: SO_LAN_XEP }), 2200);
  S.mayNghi = true;
  try { await thaoHet(); } finally { S.mayNghi = false; }
  keHoach = []; timKy = true; lacCon = SO_LAN_LAC;
  return song();
}

/** Chỗ trống trên khay gần (x, y): thử dần lên cao và sang hai bên, không lún vào ai, không chạm túi */
function choTrongKhay(body, x, y, goc) {
  const def = body.locked ? MYSTERY : (body.realDef || body.def);
  const tam = makeItem(def, x, y);
  const k = body.artScale || 1;
  if (k !== 1) { Body.scale(tam, k, k); tam.artScale = k; }
  Body.setAngle(tam, goc);
  const khac = S.bodies.filter(o => o !== body && !o.chuaVao && !isHeld(o)).concat(S.staticBodies);
  const vuong = () => {
    const bb = tam.bounds;
    if (bb.min.x < 4 || bb.max.x > W - 4 || bagZone(tam).inZone) return true;
    const manhTam = tam.parts.length > 1 ? tam.parts.slice(1) : [tam];
    for (const o of khac) {
      if (!Bounds.overlaps(o.bounds, bb)) continue;
      const manhO = o.parts.length > 1 ? o.parts.slice(1) : [o];
      for (const a of manhTam) for (const b of manhO) { const c = Collision.collides(a, b); if (c && c.collided && c.depth > 1) return true; }
    }
    return false;
  };
  for (let dy = 0; dy >= -120; dy -= 20) for (const dx of [0, -36, 36, -72, 72, -110, 110]) {
    Body.setPosition(tam, { x: Math.max(30, Math.min(W - 30, x + dx)), y: y + dy });
    if (!vuong()) return { x: tam.position.x, y: tam.position.y };
  }
  return { x, y: y - 60 };   // chật quá: thả từ trên cao xuống, vật lý tự dàn
}

/** Nhấc từng món trong túi (từ trên xuống) đặt về khay, rồi chờ đống lắng và game gỡ khỏi danh sách đã xếp */
async function thaoHet() {
  const trongTui = S.bodies.filter(b => !b.chuaVao && !b.isStatic && !isHeld(b) && !b.datSan
    && !b.tether && b.itemId !== KEY_ID && bagZone(b).inZone);
  trongTui.sort((a, b) => a.position.y - b.position.y);   // món trên cùng trước, không rút chân đống đồ
  for (const b of trongTui) {
    if (!song()) return;
    if (!S.bodies.includes(b)) continue;
    const goc0 = S.LEVEL.items[b.khoa], goc = goc0 && !goc0.inBag ? goc0 : null;
    const cho = choTrongKhay(b, goc?.x ?? W / 2, goc?.y ?? TABLE_Y + 30, goc?.angle || 0);
    if (kieuNguoi) { await keoNguoi(b, cho, goc?.angle || 0); await wait(ngau(40, 120)); continue; }
    boGiu(b);
    await tayToi(b);
    World.remove(S.world, b);
    Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
    await moveTo(b, cho.x, cho.y, goc?.angle || 0, NHIP.bay * .75);
    if (!song()) { World.add(S.world, b); return; }
    World.add(S.world, b);
    Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0);
    if (S.finger) S.finger = { ...S.finger, down: false };
    await wait(NHIP.nghi);
  }
  const ids = trongTui.map(b => b.khoa);
  for (let i = 0; i < 80 && song() && (ids.some(id => S.checked.has(id)) || S.bodies.some(b => !b.isStatic && b.speed > .6)); i++) await waitGame(50);
  ghi(`đã tháo ${trongTui.length} món ra khay`);
}

async function chayTuChoi() {

  // Đầu màn đồ vào sân lần lượt. Bấm tự chơi ngay lúc đó thì món chưa tới lượt vẫn bị
  // máy nhấc đi đặt, mà nó chưa được vẽ nên nhìn như biến mất. Cho vào sân hết trước đã.
  // Thả bằng đúng hàm của mở màn: món đang chờ nằm trên đỉnh màn, ngoài trần, phải được cho
  // xuyên trần rồi rơi xuống — add thẳng vào thế giới là nó kẹt trên trần mãi.
  for (const b of S.bodies) if (b.chuaVao) thaVaoSan(b);
  // rồi chờ cả đống rơi xuống sân nằm yên, không thì máy nhấc món đang lơ lửng giữa trời
  for (let i = 0; i < 200 && song() && (!S.tuiDaDung || S.bodies.some(b => b.dangRoi || b.speed > .6)); i++) await waitGame(50);

  const uocLuong = loiGiaiHopLe(S.LEVEL) ? { solvable: true } : solve(S.LEVEL, { tries: 120, budgetMs: 120 });
  note(uocLuong.solvable ? t('autoAll') : t('autoSome', { a: uocLuong.placedCount, b: uocLuong.needCount }), 2600);
  await wait(NHIP.moDau);

  // Vòng chính: mỗi lượt tính lại từ hiện trạng, đặt một món, chờ lắng. Kẹt thì booster.
  // Món bị hất ra khay (luật đẩy-ra-khỏi-túi) tự quay lại danh sách ứng viên ở lượt sau.
  let ketKhongLoi = 0;
  while (song() && !S.won && !S.lost) {
    // Còn hộp bí ẩn và còn chìa → mở trước
    const hop = S.bodies.find(b => b.locked && !b.chuaVao && !isHeld(b)), chia = S.bodies.find(b => b.itemId === KEY_ID);
    if (hop && chia) { await cuaCho(); if (!song()) break; await moKhoa(hop, chia); daXepMon++; continue; }

    const ungVien = conOKhay();
    if (!ungVien.length) {
      // Còn món kẹt nửa trong nửa ngoài, hoặc hộp bí ẩn vừa mở ra thành món to hơn chỗ
      // của nó? Luật đẩy-ra-khỏi-túi cần chừng 2 giây THỰC (không theo tốc độ game) để
      // trả món về khay, lúc đó nó mới thành ứng viên. Chờ tới 5 giây rồi mới chịu thua.
      const keCon = S.bodies.some(b => !b.chuaVao && !b.tether && b.itemId !== KEY_ID && !S.checked.has(b.khoa) && !S.gone.has(b.khoa));
      if (!keCon) { ghi('dừng: không còn món nào ở khay'); break; }
      if (++ketKhongLoi > 12) {
        ghi('món kẹt không được trả về khay');
        if (await xepLai()) { ketKhongLoi = 0; continue; }
        break;
      }
      await new Promise(r => setTimeout(r, 400)); continue;   // thời gian thực, không chia tốc độ
    }
    ketKhongLoi = 0;
    const buoc = await buocTiepTheo(ungVien);
    if (!song()) break;
    if (!buoc) {
      if (lacCon > 0) { lacCon--; await lacTuiThu(); continue; } // lắc cho đồ lún xuống, tìm chỗ lại
      if (await xepLai()) continue;                              // tháo ra, xếp lại theo cách khác
      if (dungBoosterKhiKet && await dungBooster()) continue;   // đã dùng booster, tính lại
      note(t('autoStuck', { n: ungVien.length }), 3200);
      break;                                                     // hết cách
    }
    await cuaCho(); if (!song()) break;
    await datMon(buoc.body, buoc.step); daXepMon++;
    const b = buoc.body;
    if (S.bodies.includes(b)) { const gh = gocHinh(b); ghi(`  → ${b.label} gốc hình ở (${Math.round(gh.x)},${Math.round(gh.y)}) ${Math.round(b.angle * 180 / Math.PI)}°, kế hoạch (${buoc.step.x},${buoc.step.y}) ${Math.round((buoc.step.angle || 0) * 180 / Math.PI)}°`); }
  }

  await wait(NHIP.ketThuc);
  if (song()) {
    const left = Math.max(0, S.ITEMS.length - S.checked.size);
    note(left ? t('autoDoneLeft', { n: left }) : t('autoDoneFit'), 3000);
  }
}

/**
 * Chế độ từng món: chưa chạy thì bắt đầu và xếp món đầu; đang chờ thì xếp món tiếp;
 * đang bay thì bỏ qua lần bấm (bấm dồn không làm hai món bay cùng lúc).
 */
export function autoStep() {
  if (!running) return autoplay({ mode: 'step' });
  if (waitingStep && releaseStep) releaseStep();
}

export function stopAutoplay() {
  if (running && kieuNguoi && S.drag) drop();   // đang cầm món giữa chừng thì thả ra, không để treo trên tay
  running = false;
  if (releaseStep) releaseStep();      // đang đứng chờ thì thả ra để vòng lặp thoát
  waitingStep = false;
  S.finger = null;
}
