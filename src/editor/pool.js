// Thư viện art: danh sách đồ + hộp thoại sửa một món (ảnh, tên, thuộc tính).
// Mã số là khoá chính nên không cho sửa — level đang tham chiếu tới nó.
import { ITEM_DEFS, defById } from '../data/items.js';
import { theme } from '../art/helpers.js';
import { saveContent, applyManifest, assetHome, indexAsset, artUrl } from '../content/loader.js';
import { chapterItemIds, byChapterFirst } from './chapter-items.js';

const $ = id => document.getElementById(id);

// Giá trị phải khớp đúng với dữ liệu trong sheet, nếu không ô chọn sẽ hiện sai
const SIZES = ['Small', 'Medium', 'Large'];
const SHAPES = ['Rectangle', 'Rounded rect', 'Long', 'Oval', 'Circle', 'Triangle', 'Curved', 'L-shape', 'U-shape', 'Irregular'];
const PHYS = [
  { v: 'normal', t: 'Bình thường' },
  { v: 'rolling', t: 'Dễ lăn' },
  { v: 'bouncy', t: 'Nảy' },
  { v: 'float', t: 'Bay lên (bóng bay)' },
  { v: 'vibrating', t: 'Rung' },
];
const PHYS_TEXT = Object.fromEntries(PHYS.map(p => [p.v, p.t]));

/** Vẽ món vào một canvas nhỏ, ưu tiên ảnh nếu có */
function paintThumb(cv, def, pad = .82) {
  const px = cv.width, c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, px, cv.height);
  const sp = def.sprite;
  if (sp && sp.ready) {
    const s = (Math.min(px, cv.height) * pad) / Math.max(sp.img.width, sp.img.height);
    c.drawImage(sp.img, (px - sp.img.width * s) / 2, (cv.height - sp.img.height * s) / 2, sp.img.width * s, sp.img.height * s);
    return;
  }
  // chưa có ảnh thì để ô trống, món nào cũng phải có sprite
  c.fillStyle = 'rgba(0,0,0,.06)';
  c.fillRect(px * .18, cv.height * .18, px * .64, cv.height * .64);
}

export function initPool({ E, status, onSaved }) {
  const table = $('poolTable');
  const modal = $('itemModal');
  let editing = null;          // def đang sửa

  // ---------- bảng ----------
  // Mặc định chỉ hiện món của chương đang mở: món riêng lên trước, món mượn xuống sau
  let chapterItems = null, chapterOwn = null;
  async function computeChapterItems() {
    ({ all: chapterItems, own: chapterOwn } = await chapterItemIds(E));
    render();
  }

  function render() {
    const q = ($('poolSearch').value || '').toLowerCase();
    const scope = 'all';   // thư viện art luôn hiện cả kho, không lọc theo chương
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    table.innerHTML = '<tr><th></th><th>#</th><th>Tên</th><th>Cỡ</th><th>Hình dáng</th><th>Tính chất</th><th>Khó</th><th>Chương</th><th></th></tr>';
    const order = scope === 'chapter' && chapterOwn ? [...ITEM_DEFS].sort(byChapterFirst(chapterOwn)) : ITEM_DEFS;
    for (const d of order) {
      if (scope === 'chapter' && chapterItems && !chapterItems.has(d.id) && d.id > 0) continue;
      if (q && !`${d.id} ${d.name} ${d.slug}`.toLowerCase().includes(q)) continue;
      const m = d.meta, tr = document.createElement('tr');
      const cv = document.createElement('canvas'); cv.width = cv.height = 34 * dpr;
      cv.className = 'pool-thumb'; paintThumb(cv, d);
      const cell = (html, cls = '') => { const td = document.createElement('td'); if (cls) td.className = cls; if (html instanceof Node) td.append(html); else td.innerHTML = html; tr.appendChild(td); };
      cell(cv, 'thumb');
      cell(`<b>${d.id}</b>`);
      cell(d.name);
      cell(m.size);
      cell(m.shape);
      cell(`<span class="tag ${m.physics}">${PHYS_TEXT[m.physics] || m.physics}</span>`);
      cell(String(m.cost));
      const own = !chapterOwn || chapterOwn.has(d.id) || d.id <= 0;
      cell(own ? '<span class="tag own">của chương</span>' : '<span class="tag lent">mượn</span>');
      const btn = document.createElement('button'); btn.textContent = 'Sửa';
      btn.addEventListener('click', () => openEditor(d));
      cell(btn, 'act');
      table.appendChild(tr);
    }
  }
  $('poolSearch').addEventListener('input', render);

  // ---------- hộp thoại ----------
  function fillSelect(el, opts, val) {
    el.innerHTML = opts.map(o => {
      const v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.t;
      return `<option value="${v}"${v === val ? ' selected' : ''}>${t}</option>`;
    }).join('');
  }
  function openEditor(def) {
    editing = def;
    $('imTitle').textContent = `Sửa món #${def.id}`;
    $('imId').value = def.id;
    $('imName').value = def.name;
    $('imSlug').value = def.slug;
    fillSelect($('imSize'), SIZES, def.meta.size);
    fillSelect($('imShape'), SHAPES, def.meta.shape);
    fillSelect($('imPhys'), PHYS, def.meta.physics);
    $('imCost').value = def.meta.cost;
    $('imLink').checked = !!def.meta.canLink;
    $('imLock').checked = !!def.meta.canLock;
    scalePct = 100;
    const nhieuManh = !colliderOf(def);    // compound từ manifest 'polys' thì đổi cỡ được như thường
    for (const id of ['imScale', 'imMinus', 'imPlus']) $(id).disabled = nhieuManh;
    paintScale();
    if (nhieuManh) $('imSize').textContent = 'món nhiều mảnh, chưa đổi cỡ được';
    $('imInfo').textContent = def.sprite ? '' : 'Món này chưa có ảnh.';
    paintThumb($('imCanvas'), def, .9);
    modal.hidden = false;
  }
  // ---------- cỡ trong game ----------
  // Đổi cỡ nghĩa là nhân vùng va chạm lên và chia pixelsPerUnit xuống cùng một hệ số,
  // để hình vẽ và hình vật lý luôn khớp nhau. Áp dụng cho món này ở MỌI level.
  let scalePct = 100;
  const baseW = () => { const d = editing; return d ? Math.round(d.box[2] - d.box[0]) : 0; };
  function paintScale() {
    $('imScale').value = scalePct;
    $('imSize').textContent = `≈ ${Math.round(baseW() * scalePct / 100)}px ngang`;
  }
  const bumpScale = d => { scalePct = Math.min(300, Math.max(25, scalePct + d)); paintScale(); };
  $('imMinus').addEventListener('click', () => bumpScale(-10));
  $('imPlus').addEventListener('click', () => bumpScale(10));
  $('imScale').addEventListener('change', e => { scalePct = Math.min(300, Math.max(25, +e.target.value || 100)); paintScale(); });

  /** Hình vật lý hiện tại của món, đổi sang dạng ghi được vào manifest */
  function colliderOf(def) {
    if (def.kind === 'circle') return { kind: 'circle', r: def.r };
    if (def.kind === 'rect') return { kind: 'rect', w: def.w, h: def.h, chamfer: def.chamfer || 0 };
    if (def.kind === 'poly') return { kind: 'poly', pts: def.pts };
    if (def.kind === 'compound' && def.parts?.every(p => p.kind === 'poly'))   // món có lỗ kín
      return { kind: 'polys', parts: def.parts.map(p => p.pts), outer: def.pts };
    return null;            // compound: nhiều mảnh, manifest chưa tả được
  }

  /**
   * Nhân vùng va chạm theo hệ số.
   * Giữ hai chữ số thập phân đúng như lúc sinh collider từ viền ảnh. Làm tròn về số
   * nguyên thì mỗi đỉnh xê dịch tới 0,6 đơn vị — với món nhỏ là lệch 2-3% bề ngang,
   * đường viền lồi lõm hẳn ra, và đổi cỡ vài lần là sai số dồn lại.
   */
  const tron = v => +v.toFixed(2);
  function scaleCollider(c, k) {
    if (!c) return c;
    if (c.kind === 'circle') return { ...c, r: tron(c.r * k) };
    if (c.kind === 'rect') return { ...c, w: tron(c.w * k), h: tron(c.h * k), chamfer: tron((c.chamfer || 0) * k) };
    if (c.kind === 'poly') return { ...c, pts: c.pts.map(([x, y]) => [tron(x * k), tron(y * k)]) };
    if (c.kind === 'polys') return { ...c, parts: c.parts.map(p => p.map(([x, y]) => [tron(x * k), tron(y * k)])),
      outer: c.outer.map(([x, y]) => [tron(x * k), tron(y * k)]) };
    return c;
  }

  const closeEditor = () => { modal.hidden = true; editing = null; };
  $('imClose').addEventListener('click', closeEditor);
  modal.addEventListener('click', e => { if (e.target === modal) closeEditor(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeEditor(); });

  // ---------- lưu ----------
  $('imSave').addEventListener('click', async () => {
    if (!editing) return;
    const d = editing, id = d.id;
    const meta = {
      size: $('imSize').value, shape: $('imShape').value, physics: $('imPhys').value,
      cost: +$('imCost').value || 0, canLink: $('imLink').checked, canLock: $('imLock').checked,
    };
    const manifest = { id, slug: ($('imSlug').value || d.slug).trim(), code: d.code || null, name: ($('imName').value || d.name).trim(), meta };
    try {
      // Giữ nguyên ảnh và vùng va chạm đang có, chỉ ghi lại tên và thuộc tính
      const manifestPath = await assetHome('items', id);
      try {
        const old = await (await fetch(artUrl(manifestPath), { cache: 'no-store' })).json();
        if (old.sprite) manifest.sprite = old.sprite;
        if (old.collider) manifest.collider = old.collider;
      } catch {}
      // Đổi cỡ: phóng vùng va chạm và thu pixelsPerUnit cùng hệ số
      const k = scalePct / 100;
      if (k !== 1) {
        // Vùng va chạm chưa có trong manifest thì lấy từ hình vật lý đang dùng
        const base = manifest.collider || colliderOf(d);
        if (!base) return status('Món nhiều mảnh chưa đổi cỡ được', 'bad');
        manifest.collider = scaleCollider(base, k);
        if (manifest.sprite?.pixelsPerUnit) manifest.sprite = { ...manifest.sprite, pixelsPerUnit: +(manifest.sprite.pixelsPerUnit / k).toFixed(3) };
      }
      await saveContent(manifestPath, JSON.stringify(manifest, null, 2));
      await indexAsset('items', id, manifestPath);

      const def = applyManifest(manifest);
      if (def.sprite) await def.sprite.whenReady;
      status(`Đã lưu món #${id}`, 'ok');
      closeEditor(); render(); onSaved?.();
    } catch (e) { status('Lỗi lưu món: ' + e.message, 'bad'); }
  });

  render();
  computeChapterItems();
  return { render, computeChapterItems };
}
