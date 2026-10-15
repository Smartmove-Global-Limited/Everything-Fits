// Tab Draw: canvas sắp xếp level. Tool Items (kéo/xoay/buộc dây/khóa), Shape (kéo điểm polygon), Block (vẽ block chặn).
// Túi dáng cố định (manifest túi có `fixed`) thì không có tool Shape: chỉ đổi cỡ túi bằng thanh kéo,
// vật cản chọn được hình và màu, bấm vào vật cản đã đặt để chọn, kéo để dời chỗ.
import { ITEM_DEFS, MYSTERY, defById, labelOf, coTrongLevel } from '../data/items.js';
import { theme } from '../art/helpers.js';
import { W, H, TABLE_Y, FLOOR_Y } from '../game/state.js';
import { pointInPolygon, polygonArea } from '../util/geom.js';
import { chapterItemIds, byChapterFirst } from './chapter-items.js';
import { BAG_SKINS } from '../art/scene-registry.js';
import { isFixedSkin, placeFixed, maxScale, MIN_SCALE, fixedWalls } from '../data/bag.js';
import { blockPoly, blocksArea, BLOCK_KINDS, BLOCK_COLOR, darker } from '../data/blocks.js';

const $ = id => document.getElementById(id);
const INK = { 1: '#3B2A4A', 2: '#3B2A4A', 3: '#4A2F3A' };

export function initDraw({ E, onChange, status, areaOf: areaOfItem }) {
  const cv = $('edit'), ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr;
  let tool = 'item', sel = null, linkMode = false, dragging = null, hoverPt = -1, selBlock = -1;
  const skinOf = () => BAG_SKINS[E.level?.container.skin];
  const fixed = () => isFixedSkin(skinOf());
  /** Bộ art đang sửa có ảnh hộp bí ẩn và chìa khoá chưa; chưa có thì không cho giấu món */
  const coHopBiAn = () => !!(MYSTERY.sprite && defById(0)?.sprite);

  const abs = (x, y) => ({ x: E.level.container.cx + x, y: E.level.container.bottom + y });
  const loc = (x, y) => ({ x: x - E.level.container.cx, y: y - E.level.container.bottom });
  const toLogical = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const itemPos = it => it.inBag ? abs(it.x ?? 0, it.y ?? -30) : { x: it.x, y: it.y };

  /**
   * Đường viền vùng va chạm THẬT của một món, trong hệ toạ độ riêng của nó.
   * Vùng va chạm nay sinh từ viền ảnh nên phần lớn là đa giác; lấy khung chữ nhật bao
   * ngoài mà dùng thì người dựng level nhìn món to hơn thực tế và bấm trúng cả góc trống.
   */
  function vienHinh(def) {
    // 'compound' (món có lỗ kín, thân nhiều mảnh) cũng mang pts = viền ngoài: chọn và bắt chuột theo đó
    if ((def.kind === 'poly' || def.kind === 'compound') && def.pts?.length) return def.pts;
    if (def.kind === 'circle') {
      const r = def.r, n = 20, pts = [];
      for (let i = 0; i < n; i++) pts.push([Math.cos(i / n * 2 * Math.PI) * r, Math.sin(i / n * 2 * Math.PI) * r]);
      return pts;
    }
    const [x0, y0, x1, y1] = def.box;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  /** Điểm (lx, ly) trong hệ toạ độ món có nằm trong hình không */
  function trongHinh(def, lx, ly) {
    const pts = vienHinh(def);
    let trong = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > ly) !== (yj > ly) && lx < (xj - xi) * (ly - yi) / (yj - yi) + xi) trong = !trong;
    }
    return trong;
  }

  // ---------- vẽ ----------
  function drawDef(def, x, y, angle, alpha = 1, scale = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(angle || 0);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    const sp = def.sprite;
    if (sp && sp.ready) { const w = sp.img.width / sp.ppu, h = sp.img.height / sp.ppu; ctx.drawImage(sp.img, -w / 2, -h / 2, w, h); }
    else { const [x0, y0, x1, y1] = def.box; ctx.fillStyle = '#ccc'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    ctx.restore();
  }
  function render() {
    demSoCai();
    const L = E.level; if (!L) return;
    theme.ink = L.ink || INK[Number(L.background)] || '#3B2A4A';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // nền đơn giản
    ctx.fillStyle = '#FBF3EC'; ctx.fillRect(0, 0, W, TABLE_Y);
    ctx.fillStyle = '#E4B98F'; ctx.fillRect(0, TABLE_Y, W, H - TABLE_Y);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
    ctx.strokeRect(16, TABLE_Y + 16, W - 32, FLOOR_Y - TABLE_Y - 6); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.font = '700 11px Nunito'; ctx.fillText('khay đồ (spawn)', 22, TABLE_Y + 30);
    ctx.fillText('sàn vật lý', 22, FLOOR_Y - 6);
    // túi: dáng cố định thì vẽ chính ảnh túi (phóng đều theo cỡ), rồi viền lòng túi đè lên
    const poly = L.container.shape.map(([x, y]) => { const p = abs(x, y); return [p.x, p.y]; });
    const sk = skinOf(), body = sk?.img?.body;
    if (fixed() && body?.complete && body.naturalWidth) {
      const k = L.container.scale || 1, r = sk.image, o = abs(0, 0);
      ctx.drawImage(body, o.x + r.x * k, o.y + r.y * k, r.w * k, r.h * k);
    }
    ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    if (!fixed()) { ctx.fillStyle = L.container.skin === 'tote' ? 'rgba(63,184,175,.25)' : 'rgba(110,79,174,.28)'; ctx.fill(); }
    ctx.lineWidth = fixed() ? 1.6 : 3; ctx.strokeStyle = fixed() ? 'rgba(255,255,255,.7)' : theme.ink; ctx.stroke();
    // miệng túi (túi dáng cố định kín bốn bề, không có miệng)
    if (!fixed()) {
      const minY = Math.min(...poly.map(p => p[1]));
      ctx.strokeStyle = '#E2B04A'; ctx.lineWidth = 4; ctx.beginPath();
      poly.forEach(([x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; if (Math.abs(y - minY) < 1 && Math.abs(y2 - minY) < 1) { ctx.moveTo(x, y); ctx.lineTo(x2, y2); } });
      ctx.stroke();
    }
    // vật cản: đúng hình và màu như trong game
    (L.container.blocks || []).forEach((b, i) => {
      const o = abs(0, 0);
      ctx.beginPath(); blockPoly(b).forEach(([x, y], j) => (j ? ctx.lineTo(o.x + x, o.y + y) : ctx.moveTo(o.x + x, o.y + y))); ctx.closePath();
      ctx.fillStyle = b.color || 'rgba(233,144,59,.95)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = b.color ? darker(b.color) : theme.ink; ctx.stroke();
      if (tool === 'block' && i === selBlock) { ctx.setLineDash([5, 4]); ctx.strokeStyle = '#E2637F'; ctx.lineWidth = 2.4; ctx.strokeRect(o.x + b.x - 3, o.y + b.y - 3, b.w + 6, b.h + 6); ctx.setLineDash([]); }
    });
    // dây buộc
    for (const it of L.items) if (it.link) {
      const o = L.items.find(j => j.id === it.link); if (!o) continue;
      const a = itemPos(it), b = itemPos(o);
      ctx.strokeStyle = L.string || '#E2637F'; ctx.lineWidth = 3; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 20, b.x, b.y); ctx.stroke();
    }
    // items
    for (const it of L.items) {
      const def = defById(it.id); if (!def) continue;
      const p = itemPos(it);
      drawDef(it.locked ? MYSTERY : def, p.x, p.y, it.angle, it.inBag ? .9 : 1, coTrongLevel(L, it));
      if (it.inBag) { ctx.fillStyle = '#E2B04A'; ctx.font = '800 10px Nunito'; ctx.fillText('IN BAG', p.x - 18, p.y - 26); }
      if (sel === it) {
        const d2 = it.locked ? MYSTERY : def, k = coTrongLevel(L, it);
        const pts = vienHinh(d2);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(it.angle || 0); ctx.scale(k, k);
        ctx.strokeStyle = '#E2637F'; ctx.lineWidth = 2 / k; ctx.setLineDash([5 / k, 4 / k]); ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
    }
    // control points
    if (tool === 'shape') {
      poly.forEach(([x, y], i) => { ctx.beginPath(); ctx.arc(x, y, i === hoverPt ? 8 : 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#E2637F'; ctx.stroke(); });
      // điểm giữa cạnh: click để thêm
      poly.forEach(([x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; ctx.beginPath(); ctx.arc((x + x2) / 2, (y + y2) / 2, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(226,99,127,.6)'; ctx.fill(); });
    }
    if (dragging?.kind === 'block') { const p = abs(dragging.x, dragging.y); ctx.strokeStyle = '#E2637F'; ctx.setLineDash([4, 4]); ctx.strokeRect(p.x, p.y, dragging.w, dragging.h); ctx.setLineDash([]); }
  }

  // ---------- hit test ----------
  function hitItem(p) {
    const L = E.level;
    for (let i = L.items.length - 1; i >= 0; i--) {
      const it = L.items[i], def = it.locked ? MYSTERY : defById(it.id); if (!def) continue;
      const c = itemPos(it), dx = p.x - c.x, dy = p.y - c.y, a = -(it.angle || 0);
      const k = coTrongLevel(E.level, it);
      const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / k, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / k;
      if (trongHinh(def, lx, ly)) return it;
    }
    return null;
  }
  const polyAbs = () => E.level.container.shape.map(([x, y]) => { const q = abs(x, y); return [q.x, q.y]; });
  function hitPoint(p) { return polyAbs().findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < 10); }
  function hitMid(p) { const pa = polyAbs(); return pa.findIndex(([x, y], i) => { const [x2, y2] = pa[(i + 1) % pa.length]; return Math.hypot((x + x2) / 2 - p.x, (y + y2) / 2 - p.y) < 8; }); }
  function hitBlock(p) {
    const q = loc(p.x, p.y), bs = E.level.container.blocks || [];
    for (let i = bs.length - 1; i >= 0; i--) if (pointInPolygon(q.x, q.y, blockPoly(bs[i]))) return i;
    return -1;
  }

  // ---------- events ----------
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    const p = toLogical(e); try { cv.setPointerCapture(e.pointerId); } catch {}
    const L = E.level;
    if (tool === 'shape') {
      const i = hitPoint(p);
      if (e.button === 2) { if (i >= 0 && L.container.shape.length > 3) { L.container.shape.splice(i, 1); onChange(); } return; }
      if (i >= 0) { dragging = { kind: 'pt', i }; return; }
      const m = hitMid(p);
      if (m >= 0) { const q = loc(p.x, p.y); L.container.shape.splice(m + 1, 0, [Math.round(q.x), Math.round(q.y)]); dragging = { kind: 'pt', i: m + 1 }; onChange(); return; }
      return;
    }
    if (tool === 'block') {
      const bi = hitBlock(p);
      if (e.button === 2) { if (bi >= 0) { L.container.blocks.splice(bi, 1); selBlock = -1; onChange(); } return; }
      const q = loc(p.x, p.y);
      if (bi >= 0) {   // bấm vào vật cản có sẵn: chọn nó, kéo thì dời chỗ
        selBlock = bi; syncBlockOpts();
        const b = L.container.blocks[bi];
        dragging = { kind: 'moveBlock', b, dx: b.x - q.x, dy: b.y - q.y, x0: b.x, y0: b.y }; render(); return;
      }
      selBlock = -1;
      dragging = { kind: 'block', x: Math.round(q.x), y: Math.round(q.y), w: 0, h: 0, sx: q.x, sy: q.y }; return;
    }
    // item tool
    const it = hitItem(p);
    if (linkMode && sel && it && it !== sel) {
      if (!defById(it.id).meta.canLink || !defById(sel.id).meta.canLink) { status('Món này không buộc dây được', 'bad'); }
      else { for (const j of L.items) { if (j.link === sel.id || j.link === it.id) delete j.link; } delete it.link; sel.link = it.id; status(`Đã buộc ${defById(sel.id).name} với ${defById(it.id).name}`, 'ok'); }
      linkMode = false; showSel(); onChange(); return;
    }
    linkMode = false;
    if (e.button === 2) { if (it) removeItem(it); return; }
    sel = it; showSel();
    if (it) { const c = itemPos(it); dragging = { kind: 'item', it, dx: c.x - p.x, dy: c.y - p.y }; }
    render();
  });
  cv.addEventListener('pointermove', e => {
    const p = toLogical(e);
    if (tool === 'shape' && !dragging) { const h = hitPoint(p); if (h !== hoverPt) { hoverPt = h; render(); } }
    if (!dragging) return;
    const L = E.level;
    if (dragging.kind === 'pt') { const q = loc(p.x, p.y); L.container.shape[dragging.i] = [Math.round(q.x), Math.round(q.y)]; onChange(); }
    else if (dragging.kind === 'moveBlock') { const q = loc(p.x, p.y); dragging.b.x = Math.round(q.x + dragging.dx); dragging.b.y = Math.round(q.y + dragging.dy); onChange(); }
    else if (dragging.kind === 'block') { const q = loc(p.x, p.y); dragging.x = Math.round(Math.min(q.x, dragging.sx)); dragging.y = Math.round(Math.min(q.y, dragging.sy)); dragging.w = Math.round(Math.abs(q.x - dragging.sx)); dragging.h = Math.round(Math.abs(q.y - dragging.sy)); render(); }
    else if (dragging.kind === 'item') {
      const it = dragging.it, nx = p.x + dragging.dx, ny = p.y + dragging.dy;
      if (it.inBag) { const q = loc(nx, ny); it.x = Math.round(q.x); it.y = Math.round(q.y); } else { it.x = Math.round(nx); it.y = Math.round(ny); }
      onChange();
    }
  });
  /** Vật cản phải nằm trọn trong lòng túi: chòi ra ngoài thì vừa vô nghĩa vừa làm sai diện tích */
  const trongTui = b => blockPoly(b).every(([x, y]) => pointInPolygon(x, y, E.level.container.shape));
  const endDrag = () => {
    if (dragging?.kind === 'moveBlock' && !trongTui(dragging.b)) {
      dragging.b.x = dragging.x0; dragging.b.y = dragging.y0;
      status('Vật cản phải nằm trọn trong lòng túi, đã trả về chỗ cũ', 'bad'); onChange();
    }
    if (dragging?.kind === 'block' && dragging.w > 8 && dragging.h > 8 && !trongTui(dragging)) {
      status('Vật cản phải nằm trọn trong lòng túi', 'bad');
    } else if (dragging?.kind === 'block' && dragging.w > 8 && dragging.h > 8) {
      const bs = E.level.container.blocks = E.level.container.blocks || [];
      const b = { x: dragging.x, y: dragging.y, w: dragging.w, h: dragging.h };
      // túi cozy (dáng cố định) dùng vật cản có hình và màu; túi kiểu cũ giữ ô chữ nhật như trước
      if (fixed() || $('blockKind').value !== 'rect') { b.kind = $('blockKind').value; b.color = $('blockColor').value; }
      bs.push(b); selBlock = bs.length - 1; onChange();
    }
    dragging = null; render();
  };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', e => {
    const p = toLogical(e); const it = hitItem(p) || sel; if (!it) return;
    e.preventDefault(); it.angle = Math.round(((it.angle || 0) + (e.deltaY > 0 ? 1 : -1) * Math.PI / 12) * 100) / 100; onChange();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'block' && selBlock >= 0) { E.level.container.blocks.splice(selBlock, 1); selBlock = -1; onChange(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) removeItem(sel);
    if (e.key === 'r' && sel) { sel.angle = Math.round(((sel.angle || 0) + Math.PI / 2) * 100) / 100; onChange(); }
  });
  function removeItem(it) { const L = E.level; L.items.splice(L.items.indexOf(it), 1); for (const j of L.items) if (j.link === it.id) delete j.link; if (sel === it) sel = null; showSel(); onChange(); }

  // ---------- tool seg / preset ----------
  const hints = {
    item: 'Kéo món để đặt · lăn chuột hoặc R để xoay · Delete hoặc chuột phải để xoá',
    shape: 'Kéo điểm tròn để đổi hình · bấm điểm giữa cạnh để thêm điểm · chuột phải để xoá',
    block: 'Kéo một vùng trong túi để tạo vật cản · bấm vào vật cản để chọn rồi kéo dời chỗ, đổi hình, đổi màu · Delete hoặc chuột phải để xoá',
  };
  // ---------- vật cản: hình và màu ----------
  $('blockKind').innerHTML = BLOCK_KINDS.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
  $('blockColor').value = BLOCK_COLOR;
  function syncBlockOpts() {
    const b = E.level?.container.blocks?.[selBlock];
    if (!b) return;
    $('blockKind').value = b.kind || 'rect'; $('blockColor').value = b.color || BLOCK_COLOR;
  }
  const doiVatCan = () => {
    const b = E.level?.container.blocks?.[selBlock]; if (!b) return;
    b.kind = $('blockKind').value; b.color = $('blockColor').value; onChange();
  };
  $('blockKind').addEventListener('change', doiVatCan);
  $('blockColor').addEventListener('input', doiVatCan);
  $('toolHint').textContent = hints.item;
  function chonTool(t) {
    tool = t;
    [...$('toolSeg').children].forEach(x => x.classList.toggle('on', x.dataset.tool === t));
    $('toolHint').textContent = hints[t]; $('blockOpts').hidden = t !== 'block';
    render();
  }
  $('toolSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) chonTool(b.dataset.tool); });

  // ---------- túi dáng cố định: chỉ đổi cỡ ----------
  /** Hiện đúng bộ điều khiển cho kiểu túi đang chọn; gọi mỗi khi đổi level hoặc đổi túi */
  function syncBagUi() {
    const f = fixed();
    $('fixedRow').hidden = !f; $('freeRow').hidden = f;
    $('bagHint').textContent = f ? 'Hình túi đi theo ảnh. Chỉ chỉnh cỡ, đặt vật cản ở bước 3' : 'Kéo điểm để đổi hình, hoặc chọn mẫu có sẵn';
    const shapeBtn = $('toolSeg').querySelector('[data-tool="shape"]');
    shapeBtn.hidden = f;
    if (f && tool === 'shape') chonTool('item');
    if (f) {
      const max = Math.floor(maxScale(skinOf()) * 100), pct = Math.round((E.level.container.scale || 1) * 100);
      for (const id of ['bagScale', 'bagScaleNum']) { $(id).min = MIN_SCALE * 100; $(id).max = max; $(id).value = pct; }
    }
    selBlock = -1;
  }
  function datCo(s) {
    const sk = skinOf(); if (!sk) return;
    s = Math.min(maxScale(sk), Math.max(MIN_SCALE, s));
    E.level.container = placeFixed(E.level.container, sk, s);
    $('bagScale').value = $('bagScaleNum').value = Math.round(s * 100);
    onChange();
    return s;
  }
  $('bagScale').addEventListener('input', e => datCo(+e.target.value / 100));
  $('bagScaleNum').addEventListener('change', e => datCo((+e.target.value || 100) / 100));
  $('bagScaleReset').addEventListener('click', () => datCo(1));
  $('fitBagFixed').addEventListener('click', e => {
    if (e.target.tagName === 'INPUT') return;
    const L = E.level, want = Math.max(.3, Math.min(.98, (+$('fitDensityFixed').value || 80) / 100));
    const items = L.items.filter(i => i.id !== 0);
    if (!items.length) return status('Chưa có món nào để tính', 'bad');
    const itemArea = items.reduce((s, it) => { const k = coTrongLevel(L, it); return s + areaOfItem(it.id) * k * k; }, 0);
    // lòng túi và vật cản phóng cùng nhau nên chỗ trống tỉ lệ bình phương cỡ túi; vách ngăn in sẵn
    // trong ảnh túi cũng chiếm chỗ (fixedWalls)
    const s0 = L.container.scale || 1, cur = polygonArea(L.container.shape) - blocksArea([...(L.container.blocks || []), ...fixedWalls(skinOf(), s0)]);
    const s = datCo(s0 * Math.sqrt(itemArea / want / cur));
    if (Math.abs(s - s0 * Math.sqrt(itemArea / want / cur)) > .005) status(`Túi đã ở cỡ giới hạn ${Math.round(s * 100)}%, chưa đạt ${(want * 100).toFixed(0)}%. Bớt món hoặc giảm độ đầy.`, 'bad');
    else status(`Đã chọn cỡ túi ${Math.round(s * 100)}% cho độ đầy ${(want * 100).toFixed(0)}%`, 'ok');
  });
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { E.level.container.shape = preset(b.dataset.preset, E.level.container.shape); onChange(); }));
  function preset(kind, cur) {
    const xs = cur.map(p => p[0]), ys = cur.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) || 260, h = Math.max(...ys) - Math.min(...ys) || 220, hw = w / 2;
    const T = -h;
    switch (kind) {
      case 'rect': return [[-hw, T], [hw, T], [hw, 0], [-hw, 0]];
      case 'rounded': { const r = 28; return [[-hw, T], [hw, T], [hw, -r], [hw - r * .45, -r * .1], [hw - r, 0], [-hw + r, 0], [-hw + r * .45, -r * .1], [-hw, -r]].map(([x, y]) => [Math.round(x), Math.round(y)]); }
      case 'notch': return [[-hw, T], [hw, T], [hw, -h * .45], [hw - w * .3, -h * .45], [hw - w * .3, 0], [-hw, 0]].map(([x, y]) => [Math.round(x), Math.round(y)]);
      case 'L': return [[-hw, T], [-hw + w * .55, T], [-hw + w * .55, -h * .5], [hw, -h * .5], [hw, 0], [-hw, 0]].map(([x, y]) => [Math.round(x), Math.round(y)]);
      case 'wide': return [[-hw - 20, T + 40], [hw + 20, T + 40], [hw + 20, 0], [-hw - 20, 0]];
    }
    return cur;
  }

  // ---------- Fit bag: scale polygon quanh đáy để đạt density mong muốn ----------
  $('fitBag').addEventListener('click', e => {
    if (e.target.tagName === 'INPUT') return;
    const L = E.level;
    const want = Math.max(.3, Math.min(.98, (+$('fitDensity').value || 80) / 100));
    const items = L.items.filter(i => i.id !== 'key');
    if (!items.length) return status('Chưa có món nào để tính', 'bad');
    const itemArea = items.reduce((s, it) => { const k = coTrongLevel(L, it); return s + areaOfItem(it.id) * k * k; }, 0);
    const cur = polygonArea(L.container.shape) - blocksArea(L.container.blocks);
    const target = itemArea / want;
    const k = Math.sqrt(target / cur);
    // scale quanh gốc (giữa đáy túi), giới hạn để không tràn màn hình
    const scaled = L.container.shape.map(([x, y]) => [Math.round(x * k), Math.round(y * k)]);
    const maxHalf = 190, maxH = 300;
    const w = Math.max(...scaled.map(p => Math.abs(p[0]))), h = Math.max(...scaled.map(p => -p[1]));
    if (w > maxHalf || h > maxH) return status(`Cần túi lớn hơn khung cho phép (${Math.round(w * 2)}×${Math.round(h)}). Bớt món hoặc giảm density.`, 'bad');
    L.container.shape = scaled;
    for (const b of L.container.blocks || []) { b.x = Math.round(b.x * k); b.y = Math.round(b.y * k); b.w = Math.round(b.w * k); b.h = Math.round(b.h * k); }
    onChange();
    status(`Đã chỉnh lòng túi về density ${(want * 100).toFixed(0)}%`, 'ok');
  });

  // ---------- selection panel ----------
  function showSel() {
    const box = $('selBox');
    if (!sel) { box.innerHTML = '<em>Chưa chọn món</em>'; return; }
    const def = defById(sel.id), m = def.meta;
    const pct = Math.round((Number(sel.scale) || 1) * 100);
    box.innerHTML = `<b>${def.name}</b> <span class="hint">#${def.id} · ${m.size} · ${m.physics}</span>
      <div class="hint">góc ${((sel.angle || 0) * 180 / Math.PI).toFixed(0)}°</div>
      <div class="scale-row">
        <span>Cỡ riêng ở level này</span>
        <button data-s="-10" title="Nhỏ đi 10%">−</button>
        <input id="selScale" type="number" min="25" max="300" step="5" value="${pct}">
        <span>%</span>
        <button data-s="10" title="To thêm 10%">+</button>
        <button data-s="reset" class="ghost" title="Về 100%">↺</button>
      </div>
      <div class="mech">
        <button data-m="link" class="${sel.link ? 'on' : ''}" ${m.canLink ? '' : 'disabled'}
          title="Nối món này với một món khác bằng dây. Hai món phải nhấc và xếp cùng nhau.">${sel.link ? 'Buộc với #' + sel.link : 'Buộc dây…'}</button>
        <button data-m="locked" class="${sel.locked ? 'on' : ''}" ${m.canLock && coHopBiAn() ? '' : 'disabled'}
          title="${coHopBiAn() ? 'Giấu món này trong hộp bí ẩn. Người chơi phải kéo chìa khoá chạm vào hộp mới mở ra.' : 'Bộ art này chưa có ảnh hộp bí ẩn và chìa khoá'}">Hộp bí ẩn</button>
        <button data-m="inBag" class="${sel.inBag ? 'on' : ''}"
          title="Món nằm sẵn trong túi từ đầu màn, không phải xếp. Dùng cho chìa khoá hoặc đồ vướng chỗ.">Đặt sẵn trong túi</button>
        <button data-m="del" title="Bỏ món khỏi level này">Xoá</button>
      </div>`;
    const setScale = v => {
      const k = Math.min(300, Math.max(25, Math.round(v))) / 100;
      if (k === 1) delete sel.scale; else sel.scale = +k.toFixed(2);
      showSel(); onChange();
    };
    $('selScale').addEventListener('change', e => setScale(+e.target.value || 100));
    box.querySelectorAll('button[data-s]').forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.s;
      setScale(d === 'reset' ? 100 : (Number(sel.scale) || 1) * 100 + Number(d));
    }));
    box.querySelectorAll('button[data-m]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.m;
      if (k === 'link') { if (sel.link) { delete sel.link; } else { linkMode = true; status('Bấm tiếp món thứ hai để buộc dây', ''); } }
      if (k === 'locked') { sel.locked = !sel.locked; if (!sel.locked) delete sel.locked; }
      if (k === 'inBag') { if (sel.inBag) { delete sel.inBag; const a = abs(sel.x, sel.y); sel.x = Math.round(a.x); sel.y = Math.round(a.y + 200); } else { sel.inBag = true; sel.x = 0; sel.y = -40; } }
      if (k === 'del') return removeItem(sel);
      showSel(); onChange();
    }));
  }

  // ---------- palette ----------
  let chapterItems = null, chapterOwn = null;
  let tuKhoa = '';   // chữ người dùng gõ vào ô tìm kho đồ
  async function computeChapterItems() {
    ({ all: chapterItems, own: chapterOwn } = await chapterItemIds(E));
    refreshPalette();
  }

  /** Dấu trên ô kho đồ: ✓ khi level có một cái, ×2 ×3… khi có nhiều cái cùng loại */
  function demSoCai() {
    const dem = new Map();
    for (const it of E.level?.items || []) dem.set(Number(it.id), (dem.get(Number(it.id)) || 0) + 1);
    for (const b of $('palette').querySelectorAll('button[data-id]')) {
      const n = dem.get(Number(b.dataset.id)) || 0;
      let t = b.querySelector('.pal-count');
      if (!n) { t?.remove(); continue; }
      if (!t) { t = document.createElement('i'); t.className = 'pal-count'; b.appendChild(t); }
      t.textContent = n > 1 ? `×${n}` : '✓';
    }
  }
  function refreshPalette() {
    const pal = $('palette'), q = tuKhoa.toLowerCase(); pal.innerHTML = '';
    // Kho đồ luôn hiện CẢ kho: không chia món theo chương (thư mục ảnh của món chỉ để cất file)
    const scope = 'all';
    // Món riêng của chương lên trước, món mượn từ chương khác xuống sau
    const order = scope === 'chapter' && chapterOwn ? [...ITEM_DEFS].sort(byChapterFirst(chapterOwn)) : ITEM_DEFS;
    for (const def of order) {
      if (scope === 'chapter' && chapterItems && !chapterItems.has(def.id) && def.id > 0) continue;
      // Món chưa có ảnh ở bộ art đang sửa thì không hiện: đặt vào level là một ô xám, trong game
      // thì vô hình. Casual còn thiếu 11–15 và 51–59; nhập ảnh ở Thư viện art là tự hiện ra.
      if (!def.sprite) continue;
      if (q && !`${def.id} ${def.name} ${def.slug}`.toLowerCase().includes(q)) continue;
      const b = document.createElement('button'); b.title = labelOf(def);
      const c = document.createElement('canvas'); c.width = c.height = 80;
      const g = c.getContext('2d'); const [x0, y0, x1, y1] = def.box, sc = 64 / Math.max(x1 - x0, y1 - y0);
      g.translate(40, 40); g.scale(sc, sc); g.translate(-(x0 + x1) / 2, -(y0 + y1) / 2); g.lineJoin = 'round';
      const sp = def.sprite; if (sp && sp.ready) { const w = sp.img.width / sp.ppu, h = sp.img.height / sp.ppu; g.drawImage(sp.img, -w / 2, -h / 2, w, h); } else { const [x0, y0, x1, y1] = def.box; g.fillStyle = '#ccc'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
      const s = document.createElement('span'); s.textContent = def.name;
      if (scope === 'chapter' && chapterOwn && !chapterOwn.has(def.id) && def.id > 0) b.classList.add('borrowed');
      b.append(c, s); pal.appendChild(b);
      b.dataset.id = def.id;
      b.addEventListener('click', () => addItem(def));
    }
    demSoCai();
    // Lọc không ra món nào thì nói rõ, chứ để trắng trơn là tưởng hỏng
    if (!pal.children.length) {
      const p = document.createElement('p');
      p.className = 'pal-empty';
      p.textContent = q ? `Không có món nào khớp "${q}" ` : 'Chương này chưa có món nào';
      if (q) {   // lọc nhầm thì một nút là về lại đủ kho
        const b = document.createElement('button');
        b.className = 'ghost'; b.textContent = 'Xoá lọc';
        b.addEventListener('click', () => { tuKhoa = ''; $('palSearch').value = ''; refreshPalette(); });
        p.appendChild(b);
      }
      pal.appendChild(p);
    }
  }
  // Kho đồ chỉ lọc theo chữ người dùng TỰ GÕ (sự kiện input), không đọc thẳng giá trị trong ô.
  // Chrome điền lại giá trị cũ vào ô SAU khi trang tải xong, và thường lờ autocomplete="off":
  // từng có số giây 120 của ô Thời gian rơi vào đây, kho đồ lọc sạch không còn món nào.
  // Giá trị nào chen vào ô mà không qua bàn phím thì bị xoá đi ở các mốc dưới.
  $('palSearch').addEventListener('input', e => { tuKhoa = e.target.value; refreshPalette(); });
  const xoaTuDien = () => { if ($('palSearch').value !== tuKhoa) $('palSearch').value = tuKhoa; };
  xoaTuDien();
  window.addEventListener('load', xoaTuDien);
  window.addEventListener('pageshow', xoaTuDien);
  for (const ms of [300, 1000, 2500]) setTimeout(xoaTuDien, ms);
  $('palSearch').addEventListener('focus', xoaTuDien);
  function addItem(def) {
    const L = E.level;
    // Một level được có nhiều món cùng loại (hai quả táo, ba đôi tất…). Riêng chìa khoá chỉ
    // một cái: nó là công cụ mở hộp bí ẩn, hai chìa thì không biết chìa nào mở hộp nào.
    if (def.id === 0 && L.items.some(i => i.id === 0)) return status('Level chỉ có một chìa khoá', 'bad');
    const n = L.items.filter(i => !i.inBag).length, col = n % 6, row = Math.floor(n / 6);
    const it = { id: def.id, x: 40 + col * 68, y: TABLE_Y + 40 + row * 70, angle: 0 };
    if (def.id === 0) { it.inBag = true; it.x = 0; it.y = -40; }   // chìa khoá luôn nằm sẵn trong túi
    L.items.push(it); sel = it; showSel(); onChange();
    const n2 = L.items.filter(i => i.id === def.id).length;
    if (n2 > 1) status(`Đã thêm ${def.name} thứ ${n2}`, 'ok');
  }

  refreshPalette();
  computeChapterItems();
  return { render, refreshPalette, computeChapterItems, syncBagUi, clearSelection: () => { sel = null; showSel(); } };
}
