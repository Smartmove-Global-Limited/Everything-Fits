// Item definitions built from manifests. Port of the pure parts of snug/src/data/items.js,
// snug/src/data/collider.js (applyCollider), snug/src/content/loader.js (applyManifest, without
// image loading) and snug/src/game/physics.js (itemArea, re-derived without Matter.js).
//
// The web game keeps one global ITEM_DEFS table; here an ItemCatalog instance holds it and is
// passed explicitly to every function that needs item shapes (no global singleton).
import { createLegacyItemDefs, createMysteryDef } from './itemsLegacy';
import { polygonArea } from './geom';
import type { ColliderSpec, ItemDef, ItemLookup, ItemManifest, ItemPart, LevelItem, Polygon } from './types';

/** key that opens a mystery box */
export const KEY_ID = 0;
export const MYSTERY_ID = -1;

/** Apply a manifest collider to a def (web: data/collider.js applyCollider). Mutates and returns def. */
export function applyCollider(def: ItemDef, c: ColliderSpec | undefined | null): ItemDef {
  if (!c) return def;
  if (c.kind === 'circle') {
    Object.assign(def, { kind: 'circle', r: c.r, box: [-c.r, -c.r, c.r, c.r] });
    delete def.parts; delete def.extra;
  } else if (c.kind === 'rect') {
    Object.assign(def, { kind: 'rect', w: c.w, h: c.h, chamfer: c.chamfer || 0, box: [-c.w / 2, -c.h / 2, c.w / 2, c.h / 2] });
    delete def.parts; delete def.extra;
  } else if (c.kind === 'poly') {
    const xs = c.pts.map(p => p[0]), ys = c.pts.map(p => p[1]);
    Object.assign(def, { kind: 'poly', pts: c.pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    delete def.parts; delete def.extra;
  } else if (c.kind === 'polys') {
    // Item with closed holes: body = several simple polygons around the hole (physics), `outer`
    // = single outline (drawing, editor picking). Same local frame as 'poly'.
    const all = c.parts.flat() as Polygon;
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    Object.assign(def, {
      kind: 'compound', parts: c.parts.map(pts => ({ kind: 'poly', pts })), pts: c.outer,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
    delete def.extra;
  }
  return def;
}

/**
 * Item table. Starts from the web game's built-in defs (ids 0..52 + mystery -1) and applies
 * manifests exactly like content/loader.js applyManifest (minus sprite/image loading: `sprite`
 * keeps the raw { src, pixelsPerUnit }).
 */
export class ItemCatalog implements ItemLookup {
  /** web: ITEM_DEFS (insertion order kept: built-ins first, then new manifest ids in apply order) */
  readonly defs: ItemDef[];
  private readonly mystery: ItemDef;

  constructor(manifests: ItemManifest[] = [], opts: { includeBuiltIns?: boolean } = {}) {
    this.defs = opts.includeBuiltIns === false ? [] : createLegacyItemDefs();
    this.mystery = createMysteryDef();
    for (const m of manifests) this.applyManifest(m);
  }

  /** Look up a def. The mystery box is outside `defs` but must still be found. */
  defById(id: number | string): ItemDef | undefined {
    const n = Number(id);
    return this.defs.find(d => d.id === n) || (n === -1 ? this.mystery : undefined);
  }
  defBySlug(slug: string): ItemDef | undefined { return this.defs.find(d => d.slug === slug); }
  defByCode(code: string): ItemDef | undefined { return this.defs.find(d => d.code === code); }

  /** Merge a manifest into the table: creates a def when the id is new (web: applyManifest) */
  applyManifest(m: ItemManifest): ItemDef {
    let def = this.defById(m.id);
    if (!def) {
      def = {
        id: Number(m.id), slug: m.slug || `item${m.id}`, code: m.code || null,
        name: m.name || `Món ${m.id}`, kind: 'rect', w: 40, h: 40, box: [-20, -20, 20, 20],
        meta: { size: 'Medium', shape: 'Rectangle', physics: 'normal', cost: 1, canLink: true, canLock: true },
      };
      this.defs.push(def);
    }
    if (m.name) def.name = m.name;
    if (m.nameEn) def.nameEn = m.nameEn;
    if (m.meta) def.meta = { ...def.meta, ...m.meta };
    applyCollider(def, m.collider);
    def.outline = m.outline?.length > 2 ? m.outline : null;
    if (m.sprite) def.sprite = { src: m.sprite.src, pixelsPerUnit: m.sprite.pixelsPerUnit || 3 };
    return def;
  }
}

/** Approximate area from the drawing frame (web: items.js areaOf) */
export function boxArea(def: ItemDef): number { const [x0, y0, x1, y1] = def.box; return (x1 - x0) * (y1 - y0); }

/** Display label "17 · Apple" */
export const labelOf = (def: ItemDef): string => `${def.id} · ${def.name}`;

/**
 * Real scale of an item in a level: the item's own scale × the level-wide item scale
 * (web: coTrongLevel). Missing values count as 1.
 */
export const effectiveScale = (level: { itemScale?: number } | null | undefined, it: LevelItem | { scale?: number } | null | undefined): number =>
  (Number(it?.scale) || 1) * (Number(level?.itemScale) || 1);

// ---------------------------------------------------------------- physics area

/** Area of a Matter.js circle body: regular polygon with an even number of sides (10..26) */
function circleBodyArea(r: number): number {
  let sides = Math.ceil(Math.max(10, Math.min(25, r)));
  if (sides % 2 === 1) sides += 1;
  return 0.5 * sides * r * r * Math.sin(2 * Math.PI / sides);
}

/** Area of a Matter.js rectangle body with chamfered corners (replicates Vertices.chamfer) */
function rectBodyArea(w: number, h: number, chamfer: number): number {
  if (!chamfer) return w * h;
  const verts: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const prev = verts[(i + 3) % 4], v = verts[i], next = verts[(i + 1) % 4];
    const norm = (x: number, y: number): [number, number] => { const l = Math.sqrt(x * x + y * y); return l === 0 ? [0, 0] : [x / l, y / l]; };
    const pn = norm(v[1] - prev[1], prev[0] - v[0]);
    const nn = norm(next[1] - v[1], v[0] - next[0]);
    const diag = Math.sqrt(2 * chamfer * chamfer);
    const rv: [number, number] = [pn[0] * chamfer, pn[1] * chamfer];
    const mid = norm((pn[0] + nn[0]) * .5, (pn[1] + nn[1]) * .5);
    const sx = v[0] - mid[0] * diag, sy = v[1] - mid[1] * diag;
    let precision = Math.pow(chamfer, 0.32) * 1.75;
    precision = Math.max(2, Math.min(14, precision));
    if (precision % 2 === 1) precision += 1;
    const alpha = Math.acos(pn[0] * nn[0] + pn[1] * nn[1]), theta = alpha / precision;
    for (let j = 0; j < precision; j++) {
      const c = Math.cos(theta * j), s = Math.sin(theta * j);
      out.push([rv[0] * c - rv[1] * s + sx, rv[0] * s + rv[1] * c + sy]);
    }
  }
  return polygonArea(out);
}

function partArea(p: ItemPart): number {
  if (p.kind === 'circle') return circleBodyArea(p.r);
  if (p.kind === 'rect') return rectBodyArea(p.w, p.h, p.chamfer || 0);
  if (p.kind === 'poly') return polygonArea(p.pts);
  return 0;
}

/**
 * Item area (units²) as the web editor measures it (physics.js itemArea = Matter body.area).
 * Circles and chamfered rects replicate Matter's polygon approximation; polygons use the shoelace
 * area (Matter drops concave-decomposition slivers < 10 units², so it can be a hair smaller).
 */
export function itemArea(def: ItemDef): number {
  if (def.kind === 'compound') return (def.parts || []).reduce((s, p) => s + partArea(p), 0);
  return partArea(def) + (def.extra ? partArea(def.extra) : 0);
}
