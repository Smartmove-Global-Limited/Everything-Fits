// "Thư viện art" tab (port of the web editor src/editor/pool.js): the item list and the dialog that
// edits one item (name, properties, size in the game). The id is what levels refer to: fixed.
//
// Saving writes the item manifest in the project (assets/gamecontent/content/cozy/assets/…/items/
// <id>.json) through the local server; without it the manifest is downloaded to be put in that
// place by hand. Either way the EF Bridge extension rebuilds the item prefab in Cocos Creator when
// it sees the file change.
import type { EditorPage } from './EditorPage';
import { $ } from './EditorPage';
import { drawPicture } from './EditorBoard';
import { EditorApi } from './EditorApi';

// values must match the item sheet, or the selects show something else
const SIZES = ['Small', 'Medium', 'Large'];
const SHAPES = ['Rectangle', 'Rounded rect', 'Long', 'Oval', 'Circle', 'Triangle', 'Curved', 'L-shape', 'U-shape', 'Irregular'];
const PHYS = [
  { v: 'normal', t: 'Bình thường' },
  { v: 'rolling', t: 'Dễ lăn' },
  { v: 'bouncy', t: 'Nảy' },
  { v: 'float', t: 'Bay lên (bóng bay)' },
  { v: 'vibrating', t: 'Rung' },
];
const PHYS_TEXT: Record<string, string> = {};
for (const p of PHYS) PHYS_TEXT[p.v] = p.t;

/** Collision shape of a def in the manifest form (pool.js colliderOf); null = cannot be written */
function colliderOf(def: any): any {
  if (def.kind === 'circle') return { kind: 'circle', r: def.r };
  if (def.kind === 'rect') return { kind: 'rect', w: def.w, h: def.h, chamfer: def.chamfer || 0 };
  if (def.kind === 'poly') return { kind: 'poly', pts: def.pts };
  if (def.kind === 'compound' && def.parts?.every((p: any) => p.kind === 'poly')) return { kind: 'polys', parts: def.parts.map((p: any) => p.pts), outer: def.pts };
  return null;
}
/**
 * Scale a collision shape. Two decimals like the colliders traced from the pictures: rounding to
 * whole units moves each vertex up to 0.6 — 2–3 % of a small item — and adds up over resizes.
 */
const tron = (v: number) => +v.toFixed(2);
function scaleCollider(c: any, k: number) {
  if (!c) return c;
  if (c.kind === 'circle') return { ...c, r: tron(c.r * k) };
  if (c.kind === 'rect') return { ...c, w: tron(c.w * k), h: tron(c.h * k), chamfer: tron((c.chamfer || 0) * k) };
  if (c.kind === 'poly') return { ...c, pts: c.pts.map(([x, y]: number[]) => [tron(x * k), tron(y * k)]) };
  if (c.kind === 'polys') return { ...c, parts: c.parts.map((p: number[][]) => p.map(([x, y]) => [tron(x * k), tron(y * k)])), outer: c.outer.map(([x, y]: number[]) => [tron(x * k), tron(y * k)]) };
  return c;
}

export class EditorPool {
  private editing: any = null;
  private scalePct = 100;
  private thumbs: { cv: HTMLCanvasElement; id: number }[] = [];

  constructor(private app: EditorPage) {
    $('poolSearch').addEventListener('input', () => this.render());
    $('imMinus').addEventListener('click', () => this.bump(-10));
    $('imPlus').addEventListener('click', () => this.bump(10));
    $('imScale').addEventListener('change', (e: any) => { this.scalePct = Math.min(300, Math.max(25, +e.target.value || 100)); this.paintScale(); });
    $('imClose').addEventListener('click', () => this.close());
    $('itemModal').addEventListener('click', (e: any) => { if (e.target === $('itemModal')) this.close(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('itemModal').hidden) this.close(); });
    $('imSave').addEventListener('click', () => this.save());
    this.render();
  }

  /** Item picture into a small canvas, fitted */
  private paintThumb(cv: HTMLCanvasElement, id: number, pad = .82) {
    const c = cv.getContext('2d')!, px = cv.width;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, px, cv.height);
    const pic = this.app.catalog.itemPicture(id);
    if (!pic) { c.fillStyle = 'rgba(0,0,0,.06)'; c.fillRect(px * .18, cv.height * .18, px * .64, cv.height * .64); return; }
    const s = (Math.min(px, cv.height) * pad) / Math.max(pic.ow, pic.oh);
    c.translate(px / 2, cv.height / 2);
    drawPicture(c, pic, s);
  }
  /** Pictures that arrived after the list was drawn */
  paintThumbs() {
    for (const t of this.thumbs) this.paintThumb(t.cv, t.id);
    if (this.editing && !$('itemModal').hidden) this.paintThumb($('imCanvas'), this.editing.id, .9);
  }

  render() {
    const app = this.app; if (!app.items) return;
    const table = $('poolTable'), q = ($('poolSearch').value || '').toLowerCase();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    table.innerHTML = '<tr><th></th><th>#</th><th>Tên</th><th>Cỡ</th><th>Hình dáng</th><th>Tính chất</th><th>Khó</th><th>Thư mục</th><th></th></tr>';
    this.thumbs = [];
    for (const d of app.items.defs) {
      if (q && !`${d.id} ${d.name} ${d.slug}`.toLowerCase().includes(q)) continue;
      const m = d.meta, tr = document.createElement('tr');
      const cv = document.createElement('canvas'); cv.width = cv.height = 34 * dpr;
      cv.className = 'pool-thumb'; this.paintThumb(cv, d.id); this.thumbs.push({ cv, id: d.id });
      const cell = (x: string | Node, cls = '') => { const td = document.createElement('td'); if (cls) td.className = cls; if (typeof x === 'string') td.innerHTML = x; else td.append(x); tr.appendChild(td); };
      cell(cv, 'thumb');
      cell(`<b>${d.id}</b>`);
      cell(d.name);
      cell(m.size);
      cell(m.shape);
      cell(`<span class="tag ${m.physics}">${PHYS_TEXT[m.physics] || m.physics}</span>`);
      cell(String(m.cost ?? ''));
      const src = app.catalog.items.get(d.id)?.sprite?.src || '';
      cell(src ? `<span class="tag own">${src.split('/')[1] || ''}</span>` : '<span class="tag lent">chưa có ảnh</span>');
      const btn = document.createElement('button'); btn.textContent = 'Sửa';
      btn.addEventListener('click', () => this.open(d));
      cell(btn, 'act');
      table.appendChild(tr);
    }
  }

  private fillSelect(el: HTMLSelectElement, opts: any[], val: string) {
    el.innerHTML = opts.map(o => {
      const v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.t;
      return `<option value="${v}"${v === val ? ' selected' : ''}>${t}</option>`;
    }).join('');
  }
  private open(def: any) {
    this.editing = def;
    $('imTitle').textContent = `Sửa món #${def.id}`;
    $('imId').value = def.id;
    $('imName').value = def.name;
    $('imSlug').value = def.slug;
    this.fillSelect($('imSize'), SIZES, def.meta.size);
    this.fillSelect($('imShape'), SHAPES, def.meta.shape);
    this.fillSelect($('imPhys'), PHYS, def.meta.physics);
    $('imCost').value = def.meta.cost;
    $('imGram').value = def.meta.gram ?? 150;
    $('imLink').checked = !!def.meta.canLink;
    $('imLock').checked = !!def.meta.canLock;
    this.scalePct = 100;
    const manyParts = !colliderOf(def) && !this.app.catalog.items.get(def.id)?.collider;
    for (const id of ['imScale', 'imMinus', 'imPlus']) $(id).disabled = manyParts;
    this.paintScale();
    if (manyParts) $('imSizeTxt').textContent = 'món nhiều mảnh, chưa đổi cỡ được';
    $('imInfo').textContent = this.app.catalog.items.has(def.id) ? '' : 'Món này chưa có ảnh.';
    $('imNote').textContent = this.app.canWrite ? 'Lưu xong kho đồ cập nhật ngay; Cocos Creator dựng lại prefab của món.' : `Không có máy chủ của project: Lưu sẽ tải ${def.id}.json về, chép đè vào ${this.app.catalog.manifestPath(def.id) || 'thư mục items'}.`;
    this.paintThumb($('imCanvas'), def.id, .9);
    $('itemModal').hidden = false;
  }
  private close() { $('itemModal').hidden = true; this.editing = null; }

  // size in the game: collider grows and pixelsPerUnit shrinks by the same factor, so picture and
  // physics stay matched; applies to this item in EVERY level
  private baseW() { const d = this.editing; return d ? Math.round(d.box[2] - d.box[0]) : 0; }
  private paintScale() { $('imScale').value = this.scalePct; $('imSizeTxt').textContent = `≈ ${Math.round(this.baseW() * this.scalePct / 100)}px ngang`; }
  private bump(d: number) { this.scalePct = Math.min(300, Math.max(25, this.scalePct + d)); this.paintScale(); }

  private async save() {
    const app = this.app, d = this.editing; if (!d) return;
    const id = d.id, old: any = app.catalog.items.get(id) || {};
    const meta = {
      ...(old.meta || {}),
      size: $('imSize').value, shape: $('imShape').value, physics: $('imPhys').value,
      cost: +$('imCost').value || 0, canLink: $('imLink').checked, canLock: $('imLock').checked,
      gram: Math.max(1, +$('imGram').value || 150),
    };
    // keep picture, collider and every other field; rewrite name and properties
    const manifest: any = { ...old, id, slug: ($('imSlug').value || d.slug).trim(), code: d.code || old.code || null, name: ($('imName').value || d.name).trim(), meta };
    const k = this.scalePct / 100;
    if (k !== 1) {
      const base = manifest.collider || colliderOf(d);
      if (!base) return app.status('Món nhiều mảnh chưa đổi cỡ được', 'bad');
      manifest.collider = scaleCollider(base, k);
      if (manifest.sprite?.pixelsPerUnit) manifest.sprite = { ...manifest.sprite, pixelsPerUnit: +(manifest.sprite.pixelsPerUnit / k).toFixed(3) };
    }
    try {
      let note = '';
      if (app.canWrite) {
        const r = await EditorApi.saveItem(id, manifest);
        note = r?.prefab === 'rebuilt' ? ' · Cocos Creator đang dựng lại prefab của món' : ' · Cocos Creator chưa mở: mở project để dựng lại prefab món';
      } else {
        EditorApi.download(`${id}.json`, JSON.stringify(manifest, null, 2) + '\n');
        note = ` · đã tải ${id}.json, chép đè vào ${app.catalog.manifestPath(id) || 'thư mục items'}`;
      }
      // the editor uses the new data right away (store, outlines, checks)
      app.catalog.items.set(id, manifest);
      app.items.applyManifest(manifest);
      app.clearAreaCache();
      app.status(`Đã lưu món #${id}${note}`, 'ok', 9000);
      this.close(); this.render(); app.board.refreshPalette(); app.onChange();
    } catch (e: any) { app.status('Lỗi lưu món: ' + (e?.message || e), 'bad', 8000); }
  }
}
