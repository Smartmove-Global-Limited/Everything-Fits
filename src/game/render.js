// Vòng lặp game: cập nhật vật lý + cơ chế + timer, rồi vẽ bối cảnh → túi → đồ → dây → khung túi → hiệu ứng.
import Matter from 'matter-js';
import { S, BAG, partsOf, isHeld } from './state.js';
import { ctx, VIEW } from './canvas.js';
import { drawScene } from '../art/scenes.js';
import { drawBag, drawBagFront } from '../art/bags.js';
import { blockPoly } from '../data/blocks.js';
import { moveHeld, tickRotation, rotateButtonPos, rotButtonR } from './input.js';
import { checkEject, updateChecked } from './rules.js';
import { tickPhone, checkUnlock, drawStrings } from './mechanics.js';
import { tickFloat } from './float.js';
import { ketThucLuot } from './events.js';
import { tickFreeze } from './boosters.js';
import { tickShake, lacTui } from './shake.js';
import { updateClock, showLose } from '../ui/hud.js';
import { drawFx } from './fx.js';
import { tickEntrance } from './level.js';

const { Engine } = Matter;

// Mở game kèm ?colliders=1 để xem vùng va chạm vẽ chồng lên ảnh —
// cách nhanh nhất để soi ảnh và vùng va chạm có khớp nhau không.
const HIEN_COLLIDER = new URLSearchParams(location.search).get('colliders') === '1';

/** Nền trơn cho lúc chưa có gì để vẽ, cùng tông với trang chủ */
export function xoaNen() {
  ctx.fillStyle = '#EADFD6';
  ctx.fillRect(VIEW.x0, VIEW.y0, VIEW.x1 - VIEW.x0, VIEW.y1 - VIEW.y0);
}

/**
 * Vẽ đường viền NGOÀI của món theo đúng hình va chạm gốc (def.pts), không theo từng mảnh.
 * Món lõm (bịt mắt, chuối, gói bánh…) bị Matter tách thành nhiều mảnh lồi; vẽ theo mảnh là
 * lộ các đường cắt giữa mảnh chạy ngang qua giữa món. Viền gốc nằm trong hệ toạ độ ảnh
 * (tâm ảnh), đặt đúng như lúc vẽ ảnh: vị trí thân, góc, lệch gốc, cỡ.
 * `to` = true thì tô kín (lớp băng), không thì chỉ nét. Món không có viền gốc thì vẽ theo mảnh.
 */
function veVien(b, { grow = 0, to = false } = {}) {
  const d = b.def;
  // 'compound' có pts = viền ngoài (món có lỗ kín, thân cắt thành nhiều mảnh): vẽ theo viền ngoài
  // cho khỏi lộ các đường cắt giữa mảnh.
  const coVien = d && (((d.kind === 'poly' || d.kind === 'compound') && d.pts?.length > 2) || d.kind === 'circle' || d.kind === 'rect');
  // có viền vẽ riêng (bám mép ảnh) thì dùng nó cho mọi kiểu hình, kể cả hình tròn
  const vienRieng = d?.outline;
  if (!coVien) {
    if (to) for (const p of partsOf(b)) { ctx.beginPath(); p.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath(); ctx.fill(); }
    return strokeShape(b, grow);
  }
  const k = b.artScale || 1, o = b.origin || { x: 0, y: 0 };
  ctx.save();
  ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
  ctx.translate(o.x * k, o.y * k); ctx.scale(k, k);
  ctx.lineWidth /= k;                                          // nét giữ đúng độ dày trên màn
  const dash = ctx.getLineDash(); if (dash.length) ctx.setLineDash(dash.map(v => v / k));
  const g = grow / k;
  ctx.beginPath();
  if (vienRieng) { vienRieng.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  else if (d.kind === 'circle') ctx.arc(0, 0, d.r + g, 0, Math.PI * 2);
  else if (d.kind === 'rect') ctx.rect(-d.w / 2 - g, -d.h / 2 - g, d.w + 2 * g, d.h + 2 * g);
  else { d.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  if (to) ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function strokeShape(b, grow = 1) {
  for (const p of partsOf(b)) {
    ctx.beginPath();
    if (p.circleRadius) ctx.arc(p.position.x, p.position.y, p.circleRadius + grow, 0, Math.PI * 2);
    else { p.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath(); }
    ctx.stroke();
  }
}

/** Mọi món đều vẽ bằng sprite. Ảnh căn giữa theo trọng tâm body, đúng cách sinh ở tools/gen-sprites. */
function drawArt(b) {
  const sp = b.def.sprite;
  if (!sp?.ready) return;
  const w = sp.img.width / sp.ppu, h = sp.img.height / sp.ppu;
  ctx.drawImage(sp.img, -w / 2, -h / 2, w, h);
}

function drawBody(b) {
  if (b.chuaVao) return;                 // chưa tới lượt rơi xuống thì chưa có gì để vẽ
  const held = isHeld(b), ghost = held && S.drag.ghost;
  ctx.save();
  if (ghost) ctx.globalAlpha = .6;
  else if (held) { ctx.shadowColor = 'rgba(59,42,74,.4)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 8; }
  // Món không vừa KHÔNG rung hình: rung ngẫu nhiên mỗi khung hình trông như hai món đang va
  // nhau giật giật. Viền đỏ đã đủ báo.
  ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
  // Matter đặt thân theo trọng tâm, còn ảnh phải căn giữa tại GỐC HÌNH (tâm ảnh). Hai điểm này
  // lệch nhau một đoạn body.origin (đo ở góc 0, chưa nhân cỡ): món cong như quả chuối lệch hàng
  // chục px, không bù thì ảnh trượt khỏi vùng va chạm.
  const k = b.artScale || 1, o = b.origin || { x: 0, y: 0 };
  ctx.translate(o.x * k, o.y * k);
  // vừa nhấc lên thì phồng ra một nhịp rồi về cỡ cũ, cho cảm giác món rời khỏi mặt bàn
  const pop = held && b.pop != null && b.pop < 1 ? 1 + Math.sin(b.pop * Math.PI) * .09 : 1;
  ctx.scale(k * pop, k * pop);
  ctx.lineJoin = 'round';
  drawArt(b);
  ctx.restore();

  if (b.frozen && !held) {   // đang đóng băng: phủ một lớp băng mỏng theo đúng hình món
    ctx.save(); ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(170,222,248,.30)'; ctx.strokeStyle = 'rgba(120,196,240,.9)'; ctx.lineWidth = 2;
    veVien(b, { to: true });
    ctx.restore();
  }

  if (held) { // GDD: vừa → viền xanh sáng, không vừa → đỏ
    ctx.save(); ctx.lineJoin = 'round';
    // Một nét mảnh liền: xanh là thả được, đỏ là không vừa. Không dùng quầng sáng shadowBlur:
    // đó là lần làm mờ thứ hai trong khung hình, chạy đúng lúc đang kéo, lúc cần mượt nhất.
    ctx.strokeStyle = ghost ? '#E5484D' : '#3DBE78'; ctx.lineWidth = 2;
    veVien(b, { grow: 1 });
    ctx.restore();
  }
  // Món nằm gọn trong túi không có viền "đã vừa" nữa: hình sạch hơn, tiếng và lấp lánh lúc xếp vừa là đủ.
  if (HIEN_COLLIDER) {
    ctx.save();
    ctx.strokeStyle = '#FF2D7A'; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    strokeShape(b, 0);
    ctx.restore();
  }
  if (b.vibrating) {
    ctx.save(); ctx.strokeStyle = '#4A90D9'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const j = (Math.random() - .5) * 3;
    for (const s of [-1, 1]) for (const r of [30, 38]) {
      ctx.beginPath(); ctx.arc(b.position.x + j, b.position.y, r, s > 0 ? -.5 : Math.PI - .5, s > 0 ? .5 : Math.PI + .5); ctx.stroke();
    }
    ctx.restore();
  }
}

/** ?colliders=1: lòng túi (đỏ) và vật cản (vách in sẵn xanh, vật cản level cam) vẽ đè lên túi */
function veVungTui() {
  if (BAG.poly.length < 3) return;
  ctx.save(); ctx.lineJoin = 'round';
  const neo = pts => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  ctx.strokeStyle = '#FF2D7A'; ctx.lineWidth = 2; neo(BAG.poly); ctx.stroke();
  for (const b of BAG.blocks || []) {
    ctx.strokeStyle = b.fixed ? '#1E5BE6' : '#FB8C00'; ctx.lineWidth = 1.6; neo(blockPoly(b)); ctx.stroke();
  }
  ctx.restore();
}

/** Món đang chọn: viền nét đứt + nút xoay ở góc trên phải */
function drawSelection() {
  const b = S.selected;
  if (!b || !S.bodies.includes(b) || isHeld(b)) return;
  ctx.save();
  ctx.strokeStyle = '#E2637F'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineJoin = 'round';
  veVien(b, { grow: 3 });
  ctx.setLineDash([]);
  const c = rotateButtonPos(b), R = rotButtonR(b);
  ctx.beginPath(); ctx.arc(c.x, c.y + R * .18, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(59,42,74,.22)'; ctx.fill();                        // bóng nút
  ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.fillStyle = '#E2637F'; ctx.fill();
  ctx.lineWidth = Math.max(1.6, R * .18); ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
  // hai mũi tên cong đối nhau, kiểu nút xoay tự do trong app dựng video
  ctx.save(); ctx.translate(c.x, c.y);
  const rr = R * .46, lw = Math.max(1.7, R * .22), t = R * .34;
  ctx.strokeStyle = '#FFFFFF'; ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  for (const s0 of [0, Math.PI]) {
    const a0 = s0 + .55, a1 = s0 + Math.PI - .18;
    ctx.beginPath(); ctx.arc(0, 0, rr, a0, a1); ctx.stroke();
    // đầu mũi tên: tam giác đặc, hướng theo tiếp tuyến ở cuối cung
    const ex = Math.cos(a1) * rr, ey = Math.sin(a1) * rr;
    const tx = -Math.sin(a1), ty = Math.cos(a1);
    const nx = Math.cos(a1), ny = Math.sin(a1);
    ctx.beginPath();
    ctx.moveTo(ex + tx * t, ey + ty * t);
    ctx.lineTo(ex + nx * t * .62, ey + ny * t * .62);
    ctx.lineTo(ex - nx * t * .62, ey - ny * t * .62);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function drawPuffs(dt) {
  for (let i = S.puffs.length - 1; i >= 0; i--) {
    const p = S.puffs[i]; p.t += dt / 380;
    if (p.t >= 1) { S.puffs.splice(i, 1); continue; }
    ctx.save(); ctx.globalAlpha = 1 - p.t; ctx.strokeStyle = '#E2637F'; ctx.lineWidth = 4 * (1 - p.t) + 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 10 + p.t * 46, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3 + .4, r = 14 + p.t * 40;
      ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 3.5 * (1 - p.t), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function tickTimer(dt) {
  // S.mayNghi: máy tự chơi đang ngồi tính kế hoạch hoặc tháo đồ ra xếp lại. Người thật
  // không mất mấy giây đó, nên đồng hồ đứng chờ, không để máy thua vì nghĩ lâu.
  if (S.won || S.lost || !S.timerOn || S.mayNghi || S.anHud) return;   // S.anHud: bản ẩn HUD, xem main.js
  S.timeLeft -= dt;
  if (S.timeLeft <= 0) { S.timeLeft = 0; S.lost = true; ketThucLuot('lose'); showLose(); }   // event level_end lose ngay lúc hết giờ
}

// Ngón tay giả: Creative Tool bật khi máy tự chơi, để video trông như có người kéo.
// Hình bàn tay lấy từ icon "touch_app" (Material), vẽ bằng Path2D, tô trắng viền mực.
const HAND = new Path2D('M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74c-3.6-.76-3.54-.75-3.67-.75-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z');
function drawFinger() {
  const f = S.finger; if (!f || !S.showFinger) return;
  ctx.save();
  // Không vẽ vòng chạm to quanh đầu ngón: icon đã có sẵn vòng nhỏ, vòng to che mất món đang
  // nhấc. Ấn thì bàn tay nhún nhẹ, giống bàn tay thay con trỏ chuột (game/creative.js).
  // đầu ngón tay (điểm 11.5,3 của icon) đặt đúng vào toạ độ chạm; ấn thì bàn tay hạ thấp một chút
  const k = 2.6 * (f.down ? .92 : 1), lift = f.down ? 0 : 6;
  ctx.translate(f.x - 11.5 * k, f.y - 3 * k + lift);
  ctx.scale(k, k);
  ctx.shadowColor = 'rgba(59,42,74,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#FFFFFF'; ctx.fill(HAND);
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.1; ctx.lineJoin = 'round'; ctx.strokeStyle = '#3B2A4A'; ctx.stroke(HAND);
  ctx.restore();
}

/**
 * Một bước mô phỏng dài `dt` mili giây game. Tách riêng để tua nhanh chạy được nhiều bước
 * trong một khung hình: đưa thẳng dt = 66ms vào Matter là đồ xuyên qua nhau.
 */
function step(dt) {
  moveHeld(dt);
  tickEntrance(); tickPhone(dt); tickRotation(dt); tickShake(); tickFloat(); Engine.update(S.engine, dt); checkUnlock(); tickTimer(dt);
  S.clock += dt;
}

let last = performance.now();
const BUOC = 1000 / 60;   // độ dài một bước vật lý, luôn bằng nhau
let du = 0;               // thời gian thực dồn lại chưa chạy thành bước
function frame(now) {
  const dt = Math.min(now - last, 33); last = now;
  const active = !S.won && !S.lost && !S.paused && S.engine;

  // Chưa có level thì canvas vẫn phải có màu. Ngữ cảnh dựng với alpha:false nên canvas
  // chưa vẽ gì là một mảng ĐEN đặc, không phải trong suốt — đó chính là màn đen chớp lên
  // lúc mở app và mỗi lần về trang chủ.
  if (!S.engine) { xoaNen(); requestAnimationFrame(frame); return; }

  {
    if (active) {
      // Tốc độ 1x: đúng MỘT bước bằng dt, y như trước khi có Creative Tool. Quay chậm: một
      // bước ngắn hơn. Tua nhanh: ceil(timeScale) bước bằng nhau.
      //
      // Độ dài bước phải đều từ khung này sang khung sau. Matter suy vận tốc từ quãng
      // đường của bước trước nhân tỉ lệ độ dài hai bước, nên bước dài ngắn xen kẽ là mọi
      // cú đẩy tách va chạm bị nhân đôi rồi chia đôi liên tục: đồ chèn nhau trong túi chật
      // rung mãi không nằm yên. Đã thử chia theo mốc 16,7ms — khung hình dài 17ms bị chia
      // thành hai bước 8,5ms, xen với khung 16,6ms không chia, và ra đúng cái rung đó.
      // Một bước lẻ cực ngắn (0,3ms) còn tệ hơn: nhân 50 lần, đồ bay khỏi sân.
      //
      // Nhưng ngay cả "một bước bằng dt" cũng chưa đều: khung hình thật dài 16–18ms (màn
      // 120Hz thì 8 rồi 16ms), đủ để đồ chèn nhau quanh món nhẹ, dễ xoay như chùm chìa khoá
      // rung rung mãi. Nên giờ vật lý chạy theo bước CỐ ĐỊNH 1/60 giây, dồn thời gian thực
      // vào quỹ `du` rồi rút ra từng bước (như màn Splash). Cho phép non 1,5ms để màn 60Hz
      // có khung 16,4ms vẫn đi đúng một bước, không lúc 0 lúc 2 bước làm hình giật.
      const ts = S.timeScale || 1;
      const n = Math.max(1, Math.ceil(ts)), d = BUOC * ts / n;
      du = Math.min(du + dt, BUOC * 3);
      while (du >= BUOC - 1.5) { du -= BUOC; for (let i = 0; i < n; i++) step(d); }
    } else du = 0;
    tickFreeze();
    checkEject();
    updateChecked();
    updateClock();

    drawScene();          // phủ kín canvas, không cần xoá trước

    // Túi: ẩn tới khi đồ nằm yên hết (level.js dungTui), rồi nảy lên như đặt xuống bàn;
    // đang chơi thì lệch và nghiêng theo cú lắc điện thoại.
    const veTui = draw => {
      if (!S.tuiDaDung) return;
      const p = Math.min(1, (S.clock - S.tuiHienLuc) / 520);
      const nay = 1 + Math.sin(p * Math.PI) * .12 * (1 - p);        // phồng lên rồi về cỡ thật
      const co = p < 1 ? .55 + .45 * (1 - Math.pow(1 - p, 3)) : 1;  // từ 55% nở ra
      const lac = active ? lacTui(dt) : { x: 0, y: 0, rot: 0 };
      ctx.save();
      if (p < 1) ctx.globalAlpha = Math.min(1, p * 3);
      ctx.translate(BAG.cx + lac.x, BAG.bottom + (lac.y || 0) - (1 - p) * 26);
      ctx.rotate(lac.rot);
      ctx.scale(co * nay, co * nay);
      ctx.translate(-BAG.cx, -BAG.bottom);
      draw();
      ctx.restore();
    };
    veTui(drawBag);
    const order = S.bodies.slice().sort((a, b) => (isHeld(a) ? 1 : isHeld(b) ? -1 : 0));
    for (const b of order) drawBody(b);
    drawStrings();
    veTui(drawBagFront);
    if (HIEN_COLLIDER) veTui(veVungTui);
    drawSelection();
    drawPuffs(dt);
    drawFx(dt);
    drawFinger();
  }
  requestAnimationFrame(frame);
}

export function startLoop() { last = performance.now(); requestAnimationFrame(frame); }
