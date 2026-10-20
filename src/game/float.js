// Bóng bay: món có meta.physics === 'float' (đánh dấu body.bay lúc tạo, xem physics.js).
//
// Mô phỏng bóng bay bơm khí nhẹ ngoài đời:
//   - TRONG TÚI: lực nổi lớn hơn trọng lực, bóng dâng lên, ép vào đồ phía trên hoặc vào miệng
//     túi (lòng túi kín), nằm yên ở chỗ cao nhất còn trống. Đồ nặng đè lên thì bóng bị ghì
//     lại hoặc lách sang bên, như bóng thật kẹt giữa đống đồ.
//   - NGOÀI TÚI: bóng cũng bay lên như bóng thật, lên tới sát dưới cụm tên màn + đồng hồ
//     (TRAN) thì lơ lửng nhấp nhô ở đó như chạm trần nhà. Không bay khuất khỏi màn, người
//     chơi luôn với tới được. Đang ở ngay dưới túi thì trôi sang cạnh túi gần hơn rồi mới
//     lên, không kẹt dưới đáy túi.
//   - Không khí cản mạnh (frictionAir), đung đưa nhè nhẹ, và luôn tự dựng thẳng (nút buộc
//     với sợi dây nặng hơn ở dưới), nghiêng đi thì từ từ trở lại.
// Món khác không bị đụng tới: vòng lặp bỏ qua mọi body không có cờ bay.
import Matter from 'matter-js';
import { S, BAG, isHeld, daVao } from './state.js';
import { pointInPolygon } from '../util/geom.js';

const { Body, Query } = Matter;
const CAN_KHI_BI_DE = .22;    // không khí cản khi đang bị đồ đè (bình thường .06): bóng nằm im thay vì giật
const NOI_KHI_BI_DE = .92;    // lực nổi khi bị đè: non trọng lực một chút, bóng nép dưới món đè, không húc lên
const GIU_BI_DE_MS = 350;     // thôi bị đè rồi vẫn giữ trạng thái này thêm chút cho khỏi bật tắt liên tục

const NOI_TRONG_TUI = 1.45;   // lực nổi trong túi, tính theo trọng lực: 1.45 = dâng lên với 0,45g
// Trần của bóng ngoài túi (tâm bóng): ngay dưới cụm tên màn + đồng hồ (kết thúc ~y 100)
const TRAN = 142;
const LACH_DAY_TUI = .8;      // lực đẩy sang cạnh túi khi bóng đang ở ngay dưới đáy túi (theo g)
const LO_LUNG_CUNG = .014;    // lệch 1 đơn vị so với độ cao đó thì lực đổi chừng này (theo g)
const LO_LUNG_TRAN = .7;      // lực chỉnh độ cao không quá chừng này (theo g)
const DUNG_THANG = .0035;     // độ mạnh tự dựng thẳng
const DUNG_THANG_CAN = .9;    // hãm quay mỗi bước khi đang dựng thẳng

const goc0 = a => Math.atan2(Math.sin(a), Math.cos(a));   // góc về khoảng (-π, π]

/** Gọi mỗi bước vật lý, trước Engine.update */
export function tickFloat() {
  if (!S.engine || S.won || S.lost || S.paused) return;
  const g = S.engine.gravity, gA = g.y * g.scale;    // gia tốc trọng lực trên mỗi đơn vị khối lượng
  const t = S.clock || 0;
  for (const b of S.bodies) {
    if (!b.bay || b.isStatic || !daVao(b) || isHeld(b)) continue;
    let noi;
    // trong túi = TÂM bóng nằm trong lòng túi; vùng túi nới rộng của luật xếp thì quá rộng
    if (BAG.poly && pointInPolygon(b.position.x, b.position.y, BAG.poly)) noi = NOI_TRONG_TUI;
    else {
      // bay lên hết cỡ khi còn xa trần, tới gần trần thì lực nổi dịu lại, vượt trần thì kéo xuống
      const lech = b.position.y - TRAN;              // dương: còn ở dưới trần
      noi = 1 + Math.max(-LO_LUNG_TRAN, Math.min(LO_LUNG_TRAN, lech * LO_LUNG_CUNG));
    }
    // Bị đồ đè: có món khác đang CHẠM bóng mà tâm nằm cao hơn tâm bóng. Bóng thật bị đè thì nép
    // dưới, không bay; lực nổi cứ húc lên món đè là hai bên giật tung mãi (đo thực tế trên Level 4).
    const tren = S.bodies.filter(o => o !== b && !o.isStatic && daVao(o) && !isHeld(o) && o.position.y < b.position.y - 2
      && Matter.Bounds.overlaps(o.bounds, b.bounds));
    if (tren.length && Query.collides(b, tren).length) b.biDeToi = t + GIU_BI_DE_MS;
    const biDe = b.biDeToi > t;
    b.frictionAir = biDe ? CAN_KHI_BI_DE : .06;
    // Bóng bị đè thì CHO NGỦ như món thường: bóng thức là vật đang "chuyển động" với Matter, món
    // nào chạm nó cũng bị đánh thức theo, cả khay đồ không món nào ngủ được, rung li ti mãi (đo
    // Level 4: 0/9 món ngủ khi bóng kẹt dưới máy tính bảng). Món đè bị nhấc đi là cả đám được
    // đánh thức (physics.js afterRemove), bóng lại bay.
    b.sleepThreshold = biDe ? 60 : Infinity;
    if (biDe) noi = Math.min(noi, NOI_KHI_BI_DE);
    const pha = (b.khoa ?? b.itemId) * 1.7;
    if (!biDe) noi += Math.sin(t * .0021 + pha) * .05;          // nhấp nhô
    let gio = biDe ? 0 : Math.sin(t * .0013 + pha * 2.3) * .035;   // đung đưa ngang
    // ngay dưới đáy túi (trong bề ngang túi, thấp hơn đáy): trôi sang cạnh gần hơn
    if (noi !== NOI_TRONG_TUI && BAG.poly && b.position.y > BAG.bottom - 4
        && b.position.x > BAG.left - 24 && b.position.x < BAG.right + 24) {
      gio += (b.position.x < (BAG.left + BAG.right) / 2 ? -1 : 1) * LACH_DAY_TUI;
    }
    Body.applyForce(b, b.position, { x: gio * gA * b.mass, y: -noi * gA * b.mass });
    // tự dựng thẳng: xoay về góc 0, hãm dần cho khỏi lắc qua lắc lại
    const a = goc0(b.angle);
    Body.setAngularVelocity(b, b.angularVelocity * DUNG_THANG_CAN - a * DUNG_THANG);
  }
}
