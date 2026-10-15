// Vẽ túi bằng sprite. Ba lớp PNG cho mỗi kiểu túi, kéo giãn theo khung của từng level:
//
//   body    thân túi, nằm sau đồ
//   lining  lót trong lòng túi, CẮT THEO POLYGON của level nên hình khuyết góc vẫn đúng
//   frame   khung và trang trí, đè lên đồ để che phần đồ thò ra
//
// Những thứ phụ thuộc dữ liệu level thì vẫn vẽ lúc chơi: mép lòng túi, ngăn khoá, chữ gợi ý.
// Toàn bộ phần nhìn của túi đến từ ảnh, không còn hàm vẽ hình nào.
import { ctx } from '../game/canvas.js';
import { BAG, S } from '../game/state.js';
import { theme, rrect } from './helpers.js';
import { BAG_SKINS } from './scene-registry.js';
import { blockPoly, darker } from '../data/blocks.js';
import { t, emptyText } from '../i18n.js';

export const bagSkin = () => BAG_SKINS[BAG.kind] || BAG_SKINS.backpack || null;

const innerPath = c => { c.beginPath(); BAG.poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };

/** Vẽ một lớp ảnh phủ kín khung túi, kéo giãn từ khung chuẩn sang khung của level */
function drawLayer(img, m) {
  if (!img?.complete || !img.naturalWidth) return false;
  const x = BAG.BL - m, y = BAG.BT - m;
  ctx.drawImage(img, x, y, (BAG.BR + m) - x, (BAG.BB + m) - y);
  return true;
}

// Bóng túi đổ xuống sàn. Trước đây là một hình bầu dục đặc bôi qua ctx.filter='blur(6px)';
// bộ lọc canvas bắt trình duyệt dựng riêng một lớp rồi làm mờ thật, lại làm mỗi khung
// hình, và trên máy Android tầm trung một mình nó đã ăn vài mili giây mỗi frame. Vệt
// chuyển màu cho ra đúng mảng mờ ấy mà không tốn gì; bảng màu tạo một lần rồi dùng lại.
let bagShadow = null, bagShadowR = 0;
function drawBagShadow(s) {
  const k = BAG.scale || 1;
  const rx = s?.fixed ? s.image.w * k * .42 : (BAG.BR - BAG.BL) / 2 + 14;
  const day = s?.fixed ? BAG.oy + (s.image.y + s.image.h) * k - 6 : BAG.BB + 10;
  if (!bagShadow || bagShadowR !== rx) {
    bagShadow = ctx.createRadialGradient(0, 0, rx * .45, 0, 0, rx);
    bagShadow.addColorStop(0, 'rgba(60,45,35,.30)');
    bagShadow.addColorStop(1, 'rgba(60,45,35,0)');
    bagShadowR = rx;
  }
  ctx.save();
  ctx.translate(BAG.cx + 3, day); ctx.scale(1, 19 / rx);
  ctx.fillStyle = bagShadow;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/**
 * Túi dáng cố định: ảnh phóng ĐỀU theo cỡ túi của level, neo ở giữa đáy lòng túi.
 * Không kéo giãn nên quai, khoá kéo luôn đúng dáng.
 */
function drawFixed(img, s) {
  if (!img?.complete || !img.naturalWidth) return;
  const k = BAG.scale || 1, r = s.image;
  ctx.drawImage(img, BAG.cx + r.x * k, BAG.oy + r.y * k, r.w * k, r.h * k);
}

export function drawBag() {
  const s = bagSkin(); if (!s) return;
  drawBagShadow(s);
  if (s.fixed) { drawFixed(s.img?.body, s); return; }

  drawLayer(s.img?.body, s.margin);

  // lót cắt theo polygon thật của level: khuyết góc, chữ L… đều đúng hình
  ctx.save(); innerPath(ctx); ctx.clip();
  const li = s.img?.lining;
  if (li?.complete && li.naturalWidth) ctx.drawImage(li, BAG.left, BAG.top, BAG.innerW, BAG.innerH);
  ctx.restore();
}

export function drawBagFront() {
  const s = bagSkin(); if (!s) return;
  if (s.fixed) drawFixed(s.img?.frame, s); else drawLayer(s.img?.frame, s.margin);
  drawBlocks();
  if (s.fixed) { drawEmptyLabel(); return; }   // đường khoá kéo đã vẽ trong ảnh

  // mép lòng túi bám theo polygon của level
  ctx.save(); innerPath(ctx);
  ctx.lineWidth = 5; ctx.strokeStyle = s.edge || '#00000033'; ctx.stroke();
  ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([5, 5]); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();

  drawEmptyLabel();
}

/** Ngăn khoá đặt sẵn trong túi — dữ liệu của level, không bake vào ảnh được */
function drawBlocks() {
  for (const b of BAG.blocks || []) {
    if (b.fixed) continue;   // vách ngăn in sẵn trong ảnh túi
    ctx.save();
    if (!b.kind || b.kind === 'rect') rrect(ctx, b.x, b.y, b.w, b.h, Math.min(8, b.w / 4, b.h / 4));
    else { ctx.beginPath(); blockPoly(b).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
    // Không ghi màu là vật cản kiểu cũ (ô cam viền mực, bộ casual). Có màu thì tô màu đó,
    // thêm bóng sáng mềm phía trên cho có khối và viền đậm cùng tông, không dùng mực đen.
    const mau = b.color || '#E9903B';
    ctx.fillStyle = mau; ctx.fill();
    if (b.color) {
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(b.x, b.y, b.w, b.h * .38);
      ctx.restore();
    }
    ctx.lineWidth = b.color ? 2.4 : 2.6; ctx.strokeStyle = b.color ? darker(mau) : theme.ink; ctx.stroke();
    if ((!b.kind || b.kind === 'rect') && b.w > 46 && b.h > 16) {
      ctx.fillStyle = darker(mau, .5); ctx.globalAlpha = .7; ctx.font = '800 8px Nunito';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('lockedSlot'), b.x + b.w / 2, b.y + b.h / 2);
    }
    ctx.restore();
  }
}

/** Chữ gợi ý khi túi còn trống */
// Creative Tool quay video và chụp ảnh store: chữ hướng dẫn trong túi trống là chữ của
// người chơi mới, lên ảnh quảng cáo chỉ thừa. Đọc thẳng tham số ở đây, không nhập
// game/creative.js cho khỏi kéo cả máy tự chơi vào module vẽ.
const AN_CHU_GOI_Y = new URLSearchParams(location.search).get('creative') === '1';

function drawEmptyLabel() {
  if (AN_CHU_GOI_Y || S.anHud || !S.LEVEL || S.checked.size > 0) return;   // S.anHud: bản ẩn HUD gửi design (main.js)
  const anyInside = S.bodies.some(b => b.bounds.min.y > BAG.top && b.bounds.max.y < BAG.bottom + 4
    && b.bounds.min.x > BAG.left - 4 && b.bounds.max.x < BAG.right + 4 && b.label !== 'key');
  if (anyInside) return;
  ctx.save();
  ctx.globalAlpha = .55; ctx.fillStyle = BAG.kind === 'backpack' ? '#C9D2F5' : '#8A7358';
  ctx.font = '600 15px "Baloo 2", Nunito, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emptyText(S.LEVEL), BAG.cx, (BAG.top + BAG.bottom) / 2);
  ctx.restore();
}
