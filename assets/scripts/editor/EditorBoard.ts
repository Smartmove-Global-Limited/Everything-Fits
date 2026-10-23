// The level board of the Level Editor page (port of the web editor src/editor/draw.js): an HTML
// canvas showing the level on its 420×760 field. Tools: Items (drag / turn / tether / lock), Shape
// (drag the points of a bag without a picture), Block (draw blocks inside the bag). Bags with a
// picture (`fixed`) have no Shape tool: only their size changes, and blocks get a shape and colour.
// Also the selection box and the item store (palette).
import type { EditorPage } from './EditorPage';
import { $ } from './EditorPage';
import type { Picture } from './EditorCatalog';
import { isFixedSkin, placeFixed, maxScale, MIN_SCALE, fixedWalls, pointInPolygon, polygonArea, blockPoly, blocksArea, BLOCK_KINDS, BLOCK_COLOR, darker, effectiveScale, labelOf, MYSTERY_ID, KEY_ID } from './logic';

const W = 420, H = 760, TABLE_Y = 492, FLOOR_Y = 630;
const INK = '#3B2A4A';

/** Draw a picture centred on (0, 0) at `k` units per image pixel (trim offset kept) */
export function drawPicture(ctx: CanvasRenderingContext2D, p: Picture, k: number) {
  const dx = (-p.ow / 2 + (p.ow - p.sw) / 2 + p.ox) * k, dy = (-p.oh / 2 + (p.oh - p.sh) / 2 - p.oy) * k;
  ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, dx, dy, p.sw * k, p.sh * k);
}

export class EditorBoard {
  private cv: HTMLCanvasElement = $('edit');
  private ctx = this.cv.getContext('2d')!;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  tool = 'item';
  private sel: any = null;
  private linkMode = false;
  private dragging: any = null;
  private hoverPt = -1;
  private selBlock = -1;
  private query = '';   // what the user typed in the store search

  constructor(private app: EditorPage) {
    this.cv.width = W * this.dpr; this.cv.height = H * this.dpr;
    this.wire();
    this.refreshPalette();
  }

  private get E() { return this.app; }
  private get L() { return this.app.level; }
  private skinOf() { return this.app.skins[this.L?.container.skin]; }
  private fixed() { return isFixedSkin(this.skinOf()); }
  /** this art set has the mystery box and key pictures; otherwise nothing can be hidden */
  private hasMystery() { return this.app.catalog.items.has(MYSTERY_ID) && this.app.catalog.items.has(KEY_ID); }
  private def(id: any) { return this.app.items.defById(id); }

  private abs(x: number, y: number) { return { x: this.L.container.cx + x, y: this.L.container.bottom + y }; }
  private loc(x: number, y: number) { return { x: x - this.L.container.cx, y: y - this.L.container.bottom }; }
  private toLogical(e: any) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
  private itemPos(it: any) { return it.inBag ? this.abs(it.x ?? 0, it.y ?? -30) : { x: it.x, y: it.y }; }

  /** Outline of an item's real collision shape, in its own units (draw.js vienHinh) */
  private outline(def: any): number[][] {
    if ((def.kind === 'poly' || def.kind === 'compound') && def.pts?.length) return def.pts;
    if (def.kind === 'circle') { const pts: number[][] = []; for (let i = 0; i < 20; i++) pts.push([Math.cos(i / 20 * 2 * Math.PI) * def.r, Math.sin(i / 20 * 2 * Math.PI) * def.r]); return pts; }
    const [x0, y0, x1, y1] = def.box;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  private inShape(def: any, lx: number, ly: number) { return pointInPolygon(lx, ly, this.outline(def) as any); }
  /** Picture of an item and its units per pixel */
  private look(id: number): { pic: Picture | null; ppu: number } {
    const m = this.app.catalog.items.get(Number(id));
    return { pic: this.app.catalog.itemPicture(Number(id)), ppu: m?.sprite?.pixelsPerUnit || 3 };
  }

  // ---------- drawing ----------
  private drawDef(def: any, x: number, y: number, angle: number, alpha = 1, scale = 1) {
    const ctx = this.ctx;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(angle || 0);
    if (scale !== 1) ctx.scale(scale, scale);
    const { pic, ppu } = this.look(def.id);
    if (pic) drawPicture(ctx, pic, 1 / ppu);
    else { const [x0, y0, x1, y1] = def.box; ctx.fillStyle = '#ccc'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    ctx.restore();
  }

  render() {
    this.countBadges();
    const L = this.L; if (!L) return;
    const ctx = this.ctx, fixed = this.fixed();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // plain background
    ctx.fillStyle = '#FBF3EC'; ctx.fillRect(0, 0, W, TABLE_Y);
    ctx.fillStyle = '#E4B98F'; ctx.fillRect(0, TABLE_Y, W, H - TABLE_Y);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
    ctx.strokeRect(16, TABLE_Y + 16, W - 32, FLOOR_Y - TABLE_Y - 6); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.font = '700 11px Nunito'; ctx.fillText('khay đồ (spawn)', 22, TABLE_Y + 30);
    ctx.fillText('sàn vật lý', 22, FLOOR_Y - 6);
    // bag: a fixed bag draws its picture (scaled), then the interior outline over it
    const poly = L.container.shape.map(([x, y]: number[]) => { const p = this.abs(x, y); return [p.x, p.y]; });
    const sk: any = this.skinOf();
    if (fixed && sk?.image) {
      const pic = this.app.catalog.bagPicture(L.container.skin);
      if (pic) {
        const k = L.container.scale || 1, r = sk.image, o = this.abs(0, 0);
        ctx.save(); ctx.translate(o.x + (r.x + r.w / 2) * k, o.y + (r.y + r.h / 2) * k);
        drawPicture(ctx, pic, r.w * k / pic.ow);
        ctx.restore();
      }
    }
    ctx.beginPath(); poly.forEach(([x, y]: number[], i: number) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    if (!fixed) { ctx.fillStyle = L.container.skin === 'tote' ? 'rgba(63,184,175,.25)' : 'rgba(110,79,174,.28)'; ctx.fill(); }
    ctx.lineWidth = fixed ? 1.6 : 3; ctx.strokeStyle = fixed ? 'rgba(255,255,255,.7)' : INK; ctx.stroke();
    // bag mouth (fixed bags are closed all round)
    if (!fixed) {
      const minY = Math.min(...poly.map((p: number[]) => p[1]));
      ctx.strokeStyle = '#E2B04A'; ctx.lineWidth = 4; ctx.beginPath();
      poly.forEach(([x, y]: number[], i: number) => { const [x2, y2] = poly[(i + 1) % poly.length]; if (Math.abs(y - minY) < 1 && Math.abs(y2 - minY) < 1) { ctx.moveTo(x, y); ctx.lineTo(x2, y2); } });
      ctx.stroke();
    }
    // blocks: shape and colour as in the game
    (L.container.blocks || []).forEach((b: any, i: number) => {
      const o = this.abs(0, 0);
      ctx.beginPath(); blockPoly(b).forEach(([x, y], j) => (j ? ctx.lineTo(o.x + x, o.y + y) : ctx.moveTo(o.x + x, o.y + y))); ctx.closePath();
      ctx.fillStyle = b.color || 'rgba(233,144,59,.95)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = b.color ? darker(b.color) : INK; ctx.stroke();
      if (this.tool === 'block' && i === this.selBlock) { ctx.setLineDash([5, 4]); ctx.strokeStyle = '#E2637F'; ctx.lineWidth = 2.4; ctx.strokeRect(o.x + b.x - 3, o.y + b.y - 3, b.w + 6, b.h + 6); ctx.setLineDash([]); }
    });
    // tethers
    for (const it of L.items) if (it.link) {
      const o = L.items.find((j: any) => j.id === it.link); if (!o) continue;
      const a = this.itemPos(it), b = this.itemPos(o);
      ctx.strokeStyle = L.string || '#E2637F'; ctx.lineWidth = 3; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 20, b.x, b.y); ctx.stroke();
    }
    // items
    for (const it of L.items) {
      const def = this.def(it.id); if (!def) continue;
      const p = this.itemPos(it), k = effectiveScale(L, it);
      const shown = it.locked ? (this.def(MYSTERY_ID) || def) : def;
      this.drawDef(shown, p.x, p.y, it.angle, it.inBag ? .9 : 1, k);
      if (it.inBag) { ctx.fillStyle = '#E2B04A'; ctx.font = '800 10px Nunito'; ctx.fillText('IN BAG', p.x - 18, p.y - 26); }
      if (this.sel === it) {
        const pts = this.outline(shown);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(it.angle || 0); ctx.scale(k, k);
        ctx.strokeStyle = '#E2637F'; ctx.lineWidth = 2 / k; ctx.setLineDash([5 / k, 4 / k]); ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
    }
    // control points
    if (this.tool === 'shape') {
      poly.forEach(([x, y]: number[], i: number) => { ctx.beginPath(); ctx.arc(x, y, i === this.hoverPt ? 8 : 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#E2637F'; ctx.stroke(); });
      // edge midpoints: click to add a point
      poly.forEach(([x, y]: number[], i: number) => { const [x2, y2] = poly[(i + 1) % poly.length]; ctx.beginPath(); ctx.arc((x + x2) / 2, (y + y2) / 2, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(226,99,127,.6)'; ctx.fill(); });
    }
    const d = this.dragging;
    if (d?.kind === 'block') { const p = this.abs(d.x, d.y); ctx.strokeStyle = '#E2637F'; ctx.setLineDash([4, 4]); ctx.strokeRect(p.x, p.y, d.w, d.h); ctx.setLineDash([]); }
  }

  // ---------- hit tests ----------
  private hitItem(p: { x: number; y: number }) {
    const L = this.L;
    for (let i = L.items.length - 1; i >= 0; i--) {
      const it = L.items[i], def = it.locked ? (this.def(MYSTERY_ID) || this.def(it.id)) : this.def(it.id); if (!def) continue;
      const c = this.itemPos(it), dx = p.x - c.x, dy = p.y - c.y, a = -(it.angle || 0);
      const k = effectiveScale(L, it);
      const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / k, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / k;
      if (this.inShape(def, lx, ly)) return it;
    }
    return null;
  }
  private polyAbs() { return this.L.container.shape.map(([x, y]: number[]) => { const q = this.abs(x, y); return [q.x, q.y]; }); }
  private hitPoint(p: any) { return this.polyAbs().findIndex(([x, y]: number[]) => Math.hypot(x - p.x, y - p.y) < 10); }
  private hitMid(p: any) { const pa = this.polyAbs(); return pa.findIndex(([x, y]: number[], i: number) => { const [x2, y2] = pa[(i + 1) % pa.length]; return Math.hypot((x + x2) / 2 - p.x, (y + y2) / 2 - p.y) < 8; }); }
  private hitBlock(p: any) {
    const q = this.loc(p.x, p.y), bs = this.L.container.blocks || [];
    for (let i = bs.length - 1; i >= 0; i--) if (pointInPolygon(q.x, q.y, blockPoly(bs[i]))) return i;
    return -1;
  }
  /** a block must lie fully inside the bag interior */
  private insideBag(b: any) { return blockPoly(b).every(([x, y]) => pointInPolygon(x, y, this.L.container.shape)); }

  // ---------- events ----------
  private wire() {
    const cv = this.cv, onChange = () => this.app.onChange(), status = (t: string, c = '') => this.app.status(t, c);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      if (!this.L) return;
      const p = this.toLogical(e); try { cv.setPointerCapture(e.pointerId); } catch { /* old browser */ }
      const L = this.L;
      if (this.tool === 'shape') {
        const i = this.hitPoint(p);
        if (e.button === 2) { if (i >= 0 && L.container.shape.length > 3) { L.container.shape.splice(i, 1); onChange(); } return; }
        if (i >= 0) { this.dragging = { kind: 'pt', i }; return; }
        const m = this.hitMid(p);
        if (m >= 0) { const q = this.loc(p.x, p.y); L.container.shape.splice(m + 1, 0, [Math.round(q.x), Math.round(q.y)]); this.dragging = { kind: 'pt', i: m + 1 }; onChange(); }
        return;
      }
      if (this.tool === 'block') {
        const bi = this.hitBlock(p);
        if (e.button === 2) { if (bi >= 0) { L.container.blocks.splice(bi, 1); this.selBlock = -1; onChange(); } return; }
        const q = this.loc(p.x, p.y);
        if (bi >= 0) {   // a block already there: select it, drag to move
          this.selBlock = bi; this.syncBlockOpts();
          const b = L.container.blocks[bi];
          this.dragging = { kind: 'moveBlock', b, dx: b.x - q.x, dy: b.y - q.y, x0: b.x, y0: b.y }; this.render(); return;
        }
        this.selBlock = -1;
        this.dragging = { kind: 'block', x: Math.round(q.x), y: Math.round(q.y), w: 0, h: 0, sx: q.x, sy: q.y }; return;
      }
      // item tool
      const it = this.hitItem(p), sel = this.sel;
      if (this.linkMode && sel && it && it !== sel) {
        if (!this.def(it.id).meta.canLink || !this.def(sel.id).meta.canLink) status('Món này không buộc dây được', 'bad');
        else { for (const j of L.items) { if (j.link === sel.id || j.link === it.id) delete j.link; } delete it.link; sel.link = it.id; status(`Đã buộc ${this.def(sel.id).name} với ${this.def(it.id).name}`, 'ok'); }
        this.linkMode = false; this.showSel(); onChange(); return;
      }
      this.linkMode = false;
      if (e.button === 2) { if (it) this.removeItem(it); return; }
      this.sel = it; this.showSel();
      if (it) { const c = this.itemPos(it); this.dragging = { kind: 'item', it, dx: c.x - p.x, dy: c.y - p.y }; }
      this.render();
    });
    cv.addEventListener('pointermove', e => {
      if (!this.L) return;
      const p = this.toLogical(e), d = this.dragging, L = this.L;
      if (this.tool === 'shape' && !d) { const h = this.hitPoint(p); if (h !== this.hoverPt) { this.hoverPt = h; this.render(); } }
      if (!d) return;
      if (d.kind === 'pt') { const q = this.loc(p.x, p.y); L.container.shape[d.i] = [Math.round(q.x), Math.round(q.y)]; onChange(); }
      else if (d.kind === 'moveBlock') { const q = this.loc(p.x, p.y); d.b.x = Math.round(q.x + d.dx); d.b.y = Math.round(q.y + d.dy); onChange(); }
      else if (d.kind === 'block') { const q = this.loc(p.x, p.y); d.x = Math.round(Math.min(q.x, d.sx)); d.y = Math.round(Math.min(q.y, d.sy)); d.w = Math.round(Math.abs(q.x - d.sx)); d.h = Math.round(Math.abs(q.y - d.sy)); this.render(); }
      else if (d.kind === 'item') {
        const it = d.it, nx = p.x + d.dx, ny = p.y + d.dy;
        if (it.inBag) { const q = this.loc(nx, ny); it.x = Math.round(q.x); it.y = Math.round(q.y); } else { it.x = Math.round(nx); it.y = Math.round(ny); }
        onChange();
      }
    });
    const endDrag = () => {
      const d = this.dragging;
      if (d?.kind === 'moveBlock' && !this.insideBag(d.b)) {
        d.b.x = d.x0; d.b.y = d.y0;
        status('Vật cản phải nằm trọn trong lòng túi, đã trả về chỗ cũ', 'bad'); onChange();
      }
      if (d?.kind === 'block' && d.w > 8 && d.h > 8 && !this.insideBag(d)) status('Vật cản phải nằm trọn trong lòng túi', 'bad');
      else if (d?.kind === 'block' && d.w > 8 && d.h > 8) {
        const bs = this.L.container.blocks = this.L.container.blocks || [];
        const b: any = { x: d.x, y: d.y, w: d.w, h: d.h };
        // fixed (cozy) bags use shaped, coloured blocks; old-style bags keep plain rectangles
        if (this.fixed() || $('blockKind').value !== 'rect') { b.kind = $('blockKind').value; b.color = $('blockColor').value; }
        bs.push(b); this.selBlock = bs.length - 1; onChange();
      }
      this.dragging = null; this.render();
    };
    cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('wheel', e => {
      if (!this.L) return;
      const p = this.toLogical(e); const it = this.hitItem(p) || this.sel; if (!it) return;
      e.preventDefault(); it.angle = Math.round(((it.angle || 0) + (e.deltaY > 0 ? 1 : -1) * Math.PI / 12) * 100) / 100; onChange();
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (!this.L || (e.target as any)?.matches?.('input,select,textarea')) return;
      // keys typed into the game canvas belong to the game (arrows shake the bag)
      if ((e.target as any)?.id === 'GameCanvas') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'block' && this.selBlock >= 0) { this.L.container.blocks.splice(this.selBlock, 1); this.selBlock = -1; onChange(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) this.removeItem(this.sel);
      if (e.key === 'r' && this.sel) { this.sel.angle = Math.round(((this.sel.angle || 0) + Math.PI / 2) * 100) / 100; onChange(); }
    });

    // ---------- tools ----------
    $('blockKind').innerHTML = BLOCK_KINDS.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
    $('blockColor').value = BLOCK_COLOR;
    const changeBlock = () => {
      const b = this.L?.container.blocks?.[this.selBlock]; if (!b) return;
      b.kind = $('blockKind').value; b.color = $('blockColor').value; onChange();
    };
    $('blockKind').addEventListener('change', changeBlock);
    $('blockColor').addEventListener('input', changeBlock);
    $('toolHint').textContent = HINTS.item;
    $('toolSeg').addEventListener('click', (e: any) => { const b = e.target.closest('button'); if (b) this.chooseTool(b.dataset.tool); });

    // ---------- fixed bags: size only ----------
    $('bagScale').addEventListener('input', (e: any) => this.setBagScale(+e.target.value / 100));
    $('bagScaleNum').addEventListener('change', (e: any) => this.setBagScale((+e.target.value || 100) / 100));
    $('bagScaleReset').addEventListener('click', () => this.setBagScale(1));
    $('fitBagFixed').addEventListener('click', (e: any) => {
      if (e.target.tagName === 'INPUT') return;
      const L = this.L, want = Math.max(.3, Math.min(.98, (+$('fitDensityFixed').value || 80) / 100));
      const items = L.items.filter((i: any) => Number(i.id) !== KEY_ID);
      if (!items.length) return status('Chưa có món nào để tính', 'bad');
      const area = items.reduce((s: number, it: any) => { const k = effectiveScale(L, it); return s + this.app.areaOf(it.id) * k * k; }, 0);
      // interior and blocks scale together, so free room goes with the square of the bag size;
      // walls printed in the bag picture take room too (fixedWalls)
      const s0 = L.container.scale || 1, cur = polygonArea(L.container.shape) - blocksArea([...(L.container.blocks || []), ...fixedWalls(this.skinOf(), s0)]);
      const target = s0 * Math.sqrt(area / want / cur);
      const s = this.setBagScale(target)!;
      if (Math.abs(s - target) > .005) status(`Túi đã ở cỡ giới hạn ${Math.round(s * 100)}%, chưa đạt ${(want * 100).toFixed(0)}%. Bớt món hoặc giảm độ đầy.`, 'bad');
      else status(`Đã chọn cỡ túi ${Math.round(s * 100)}% cho độ đầy ${(want * 100).toFixed(0)}%`, 'ok');
    });
    document.querySelectorAll('[data-preset]').forEach((b: any) => b.addEventListener('click', () => { this.L.container.shape = preset(b.dataset.preset, this.L.container.shape); onChange(); }));
    // free bags: scale the interior around the bottom to reach the wanted fill
    $('fitBag').addEventListener('click', (e: any) => {
      if (e.target.tagName === 'INPUT') return;
      const L = this.L, want = Math.max(.3, Math.min(.98, (+$('fitDensity').value || 80) / 100));
      const items = L.items.filter((i: any) => Number(i.id) !== KEY_ID);
      if (!items.length) return status('Chưa có món nào để tính', 'bad');
      const area = items.reduce((s: number, it: any) => { const k = effectiveScale(L, it); return s + this.app.areaOf(it.id) * k * k; }, 0);
      const cur = polygonArea(L.container.shape) - blocksArea(L.container.blocks);
      const k = Math.sqrt(area / want / cur);
      const scaled = L.container.shape.map(([x, y]: number[]) => [Math.round(x * k), Math.round(y * k)]);
      const w = Math.max(...scaled.map((p: number[]) => Math.abs(p[0]))), h = Math.max(...scaled.map((p: number[]) => -p[1]));
      if (w > 190 || h > 300) return status(`Cần túi lớn hơn khung cho phép (${Math.round(w * 2)}×${Math.round(h)}). Bớt món hoặc giảm density.`, 'bad');
      L.container.shape = scaled;
      for (const b of L.container.blocks || []) { b.x = Math.round(b.x * k); b.y = Math.round(b.y * k); b.w = Math.round(b.w * k); b.h = Math.round(b.h * k); }
      onChange();
      status(`Đã chỉnh lòng túi về density ${(want * 100).toFixed(0)}%`, 'ok');
    });

    // ---------- store search ----------
    // filter only on what the user TYPES (input event): browsers refill boxes after a reload and
    // once put the timer's 120 here, filtering the store empty. Values that arrive otherwise are wiped.
    $('palSearch').addEventListener('input', (e: any) => { this.query = e.target.value; this.refreshPalette(); });
    const wipe = () => { if ($('palSearch').value !== this.query) $('palSearch').value = this.query; };
    wipe();
    window.addEventListener('load', wipe);
    window.addEventListener('pageshow', wipe);
    for (const ms of [300, 1000, 2500]) setTimeout(wipe, ms);
    $('palSearch').addEventListener('focus', wipe);
  }

  chooseTool(t: string) {
    this.tool = t;
    Array.from($('toolSeg').children as HTMLElement[]).forEach(x => x.classList.toggle('on', x.dataset.tool === t));
    $('toolHint').textContent = (HINTS as any)[t]; $('blockOpts').hidden = t !== 'block';
    this.render();
  }
  private syncBlockOpts() {
    const b = this.L?.container.blocks?.[this.selBlock]; if (!b) return;
    $('blockKind').value = b.kind || 'rect'; $('blockColor').value = b.color || BLOCK_COLOR;
  }
  /** Show the controls of the bag kind chosen; call when the level or the bag changes */
  syncBagUi() {
    const f = this.fixed();
    $('fixedRow').hidden = !f; $('freeRow').hidden = f;
    $('bagHint').textContent = f ? 'Hình túi đi theo ảnh. Chỉ chỉnh cỡ, đặt vật cản ở bước 3' : 'Kéo điểm để đổi hình, hoặc chọn mẫu có sẵn';
    $('toolSeg').querySelector('[data-tool="shape"]').hidden = f;
    if (f && this.tool === 'shape') this.chooseTool('item');
    if (f) {
      const max = Math.floor(maxScale() * 100), pct = Math.round((this.L.container.scale || 1) * 100);
      for (const id of ['bagScale', 'bagScaleNum']) { $(id).min = MIN_SCALE * 100; $(id).max = max; $(id).value = pct; }
    }
    this.selBlock = -1;
  }
  private setBagScale(s: number): number | undefined {
    const sk = this.skinOf(); if (!sk) return;
    s = Math.min(maxScale(), Math.max(MIN_SCALE, s));
    this.L.container = placeFixed(this.L.container, sk, s);
    $('bagScale').value = $('bagScaleNum').value = Math.round(s * 100);
    this.app.onChange();
    return s;
  }

  // ---------- selection box ----------
  clearSelection() { this.sel = null; this.linkMode = false; this.showSel(); }
  private removeItem(it: any) {
    const L = this.L;
    L.items.splice(L.items.indexOf(it), 1);
    for (const j of L.items) if (j.link === it.id) delete j.link;
    if (this.sel === it) this.sel = null;
    this.showSel(); this.app.onChange();
  }
  private showSel() {
    const box = $('selBox'), sel = this.sel;
    if (!sel) { box.innerHTML = '<em>Chưa chọn món</em>'; return; }
    const def = this.def(sel.id), m = def.meta, mystery = this.hasMystery();
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
        <button data-m="locked" class="${sel.locked ? 'on' : ''}" ${m.canLock && mystery ? '' : 'disabled'}
          title="${mystery ? 'Giấu món này trong hộp bí ẩn. Người chơi phải kéo chìa khoá chạm vào hộp mới mở ra.' : 'Bộ art này chưa có ảnh hộp bí ẩn và chìa khoá'}">Hộp bí ẩn</button>
        <button data-m="inBag" class="${sel.inBag ? 'on' : ''}"
          title="Món nằm sẵn trong túi từ đầu màn, không phải xếp. Dùng cho chìa khoá hoặc đồ vướng chỗ.">Đặt sẵn trong túi</button>
        <button data-m="del" title="Bỏ món khỏi level này">Xoá</button>
      </div>`;
    const setScale = (v: number) => {
      const k = Math.min(300, Math.max(25, Math.round(v))) / 100;
      if (k === 1) delete sel.scale; else sel.scale = +k.toFixed(2);
      this.showSel(); this.app.onChange();
    };
    $('selScale').addEventListener('change', (e: any) => setScale(+e.target.value || 100));
    box.querySelectorAll('button[data-s]').forEach((b: any) => b.addEventListener('click', () => {
      const d = b.dataset.s;
      setScale(d === 'reset' ? 100 : (Number(sel.scale) || 1) * 100 + Number(d));
    }));
    box.querySelectorAll('button[data-m]').forEach((b: any) => b.addEventListener('click', () => {
      const k = b.dataset.m;
      if (k === 'link') { if (sel.link) delete sel.link; else { this.linkMode = true; this.app.status('Bấm tiếp món thứ hai để buộc dây', ''); } }
      if (k === 'locked') { sel.locked = !sel.locked; if (!sel.locked) delete sel.locked; }
      if (k === 'inBag') { if (sel.inBag) { delete sel.inBag; const a = this.abs(sel.x, sel.y); sel.x = Math.round(a.x); sel.y = Math.round(a.y + 200); } else { sel.inBag = true; sel.x = 0; sel.y = -40; } }
      if (k === 'del') return this.removeItem(sel);
      this.showSel(); this.app.onChange();
    }));
  }

  // ---------- item store ----------
  /** ✓ on a store tile when the level has one, ×2 ×3… for more (draw.js demSoCai) */
  private countBadges() {
    const n = new Map<number, number>();
    for (const it of this.L?.items || []) n.set(Number(it.id), (n.get(Number(it.id)) || 0) + 1);
    for (const b of Array.from($('palette').querySelectorAll('button[data-id]')) as HTMLElement[]) {
      const c = n.get(Number(b.dataset.id)) || 0;
      let t = b.querySelector('.pal-count');
      if (!c) { t?.remove(); continue; }
      if (!t) { t = document.createElement('i'); t.className = 'pal-count'; b.appendChild(t); }
      t.textContent = c > 1 ? `×${c}` : '✓';
    }
  }
  /** The whole store (items with a picture in this art set), filtered by what was typed */
  refreshPalette() {
    const pal = $('palette'), q = this.query.toLowerCase(); pal.innerHTML = '';
    for (const def of this.app.items.defs) {
      // items without a picture in this art set do not show (a grey box in the level, invisible in the game)
      if (!def.sprite || !this.app.catalog.items.has(def.id)) continue;
      if (q && !`${def.id} ${def.name} ${def.slug}`.toLowerCase().includes(q)) continue;
      const b = document.createElement('button'); b.title = labelOf(def);
      const c = document.createElement('canvas'); c.width = c.height = 80;
      const g = c.getContext('2d')!; const [x0, y0, x1, y1] = def.box, sc = 64 / Math.max(x1 - x0, y1 - y0);
      g.translate(40, 40); g.scale(sc, sc); g.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
      const { pic, ppu } = this.look(def.id);
      if (pic) drawPicture(g, pic, 1 / ppu); else { g.fillStyle = '#eee'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
      const s = document.createElement('span'); s.textContent = def.name;
      b.append(c, s); pal.appendChild(b);
      b.dataset.id = String(def.id);
      b.addEventListener('click', () => this.addItem(def));
    }
    this.countBadges();
    // an empty result says so, with a way back to the whole store
    if (!pal.children.length) {
      const p = document.createElement('p');
      p.className = 'pal-empty';
      p.textContent = q ? `Không có món nào khớp "${q}" ` : 'Chưa có món nào';
      if (q) {
        const b = document.createElement('button');
        b.className = 'ghost'; b.textContent = 'Xoá lọc';
        b.addEventListener('click', () => { this.query = ''; $('palSearch').value = ''; this.refreshPalette(); });
        p.appendChild(b);
      }
      pal.appendChild(p);
    }
  }
  private addItem(def: any) {
    const L = this.L;
    // several items of a kind are fine (two apples…); only one key: it opens the mystery boxes
    if (def.id === KEY_ID && L.items.some((i: any) => Number(i.id) === KEY_ID)) return this.app.status('Level chỉ có một chìa khoá', 'bad');
    const n = L.items.filter((i: any) => !i.inBag).length, col = n % 6, row = Math.floor(n / 6);
    const it: any = { id: def.id, x: 40 + col * 68, y: TABLE_Y + 40 + row * 70, angle: 0 };
    if (def.id === KEY_ID) { it.inBag = true; it.x = 0; it.y = -40; }   // the key always starts in the bag
    L.items.push(it); this.sel = it; this.showSel(); this.app.onChange();
    const n2 = L.items.filter((i: any) => i.id === def.id).length;
    if (n2 > 1) this.app.status(`Đã thêm ${def.name} thứ ${n2}`, 'ok');
  }
}

const HINTS = {
  item: 'Kéo món để đặt · lăn chuột hoặc R để xoay · Delete hoặc chuột phải để xoá',
  shape: 'Kéo điểm tròn để đổi hình · bấm điểm giữa cạnh để thêm điểm · chuột phải để xoá',
  block: 'Kéo một vùng trong túi để tạo vật cản · bấm vào vật cản để chọn rồi kéo dời chỗ, đổi hình, đổi màu · Delete hoặc chuột phải để xoá',
};

/** Bag shape presets for bags without a picture (draw.js preset) */
function preset(kind: string, cur: number[][]): number[][] {
  const xs = cur.map(p => p[0]), ys = cur.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs) || 260, h = Math.max(...ys) - Math.min(...ys) || 220, hw = w / 2;
  const T = -h, r = (pts: number[][]) => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  switch (kind) {
    case 'rect': return [[-hw, T], [hw, T], [hw, 0], [-hw, 0]];
    case 'rounded': { const q = 28; return r([[-hw, T], [hw, T], [hw, -q], [hw - q * .45, -q * .1], [hw - q, 0], [-hw + q, 0], [-hw + q * .45, -q * .1], [-hw, -q]]); }
    case 'notch': return r([[-hw, T], [hw, T], [hw, -h * .45], [hw - w * .3, -h * .45], [hw - w * .3, 0], [-hw, 0]]);
    case 'L': return r([[-hw, T], [-hw + w * .55, T], [-hw + w * .55, -h * .5], [hw, -h * .5], [hw, 0], [-hw, 0]]);
    case 'wide': return [[-hw - 20, T + 40], [hw + 20, T + 40], [hw + 20, 0], [-hw - 20, 0]];
  }
  return cur;
}
