// Automatic "snug" level designer: picks items and packs them so they fill the bag 80–93%.
// Port of snug/src/editor/thietke.js (everything except the iframe/physics checks `kiemTra`,
// `mayChoi` and the old `thietKe` driver, which are replaced by `autoDesign` + an optional
// caller-supplied `verify` hook, e.g. a Box2D run in Cocos).
//
// Method, on a grid of GRID_CELL (2) units:
//   buildGreedy  (xay)   add items one by one: try a sample of items at a few scales, put each at
//                        the lowest spot touching the most edges, keep the snuggest/biggest
//   fillGaps     (lap2)  push small items (down to 0.8) into the remaining gaps, small items may repeat
//   growInPlace  (bom)   grow each item in place (small nudges) until it touches all around
//   layoutTray   (khay)  lay the items out on the tray under the bag
//   buildLevel   (thanhLevel) full level: bag, items on the tray, difficulty, solution
//
// State (current grid, mask cache, item info) lives in a LevelDesigner instance; the item catalog
// and bag skins are passed to the constructor (web: khoiDong fetched them).
import { bbox, pointInPolygon, mulberry32, nowMs, polygonArea } from './geom';
import { resolveContainer, fitScreenScale } from './bag';
import { blockPoly } from './blocks';
import { difficulty } from './difficulty';
import { itemPolygons, rotateScale } from './solver';
import type { ItemCatalog } from './items';
import type { BagSkinMap, BBox, Block, Container, ItemLookup, Level, Polygon } from './types';

/** Grid cell size in level units (web: C) */
export const GRID_CELL = 2;
const C = GRID_CELL;

/** Do not shrink items below this scale: tiny items are hard to tap on a phone (web: CO_MIN) */
export const MIN_ITEM_SCALE = .8;
/** Scale is big enough to tap (web: deBam) */
export const isTappable = (_id: number, s: number): boolean => s >= MIN_ITEM_SCALE - 1e-6;

/** Area of an item from its real shape polygons (web: thietke areaOf). Used for difficulty by buildLevel. */
export function itemShapeArea(lookup: ItemLookup, id: number): number {
  return itemPolygons(lookup, id)?.reduce((t, p) => t + polygonArea(p), 0) || 0;
}

/** Per-item data used by the designer (web: info[id] = { A, day, ten, bay }) */
export interface ItemInfo {
  /** shape area at scale 1 (A) */
  area: number;
  /** area / bounding-box area (day); ≥ .9 is "box-like" */
  fillRatio: number;
  /** display name (ten) */
  name: string;
  /** floating balloon item (bay) */
  float: boolean;
}

/** Working grid (web: G). bag[i] = 1 for a free interior cell. */
export interface DesignGrid {
  cols: number;
  rows: number;
  bag: Uint8Array;
  /** number of free cells (tong) */
  total: number;
  bb: BBox;
  shape: Polygon;
  /** resolved container (cont), bag grids only */
  container?: Container;
  key?: string;
  scale?: number;
  blocks?: Block[];
}

/** Cell mask of an item at angle a, scale s: item cells + the ring of cells just outside (web: matNa) */
export interface DesignMask {
  cw: number; ch: number;
  /** item cells (row, col), in scan order */
  cellR: Int32Array; cellC: Int32Array;
  /** ring cells (row, col) used to measure contact, duplicates kept (web: vien) */
  ringR: Int32Array; ringC: Int32Array;
  minX: number; minY: number;
  a: number; s: number;
  /** number of item cells */
  n: number;
}

/** Item placed in the bag, bag-local coordinates (origin bottom centre of the interior) */
export interface Placement { id: number; s: number; a: number; x: number; y: number; }

/** One spot found by placeOne (web: result of datMot) */
export interface Spot { score: number; t: number; m: DesignMask; r0: number; c0: number; }

export interface BuildResult { placements: Placement[]; fill: number; }

/** A packed bag ready to become a level (web: tk = { key, scale, cont, giai, fill }) */
export interface Design {
  key: string;
  scale: number;
  container: Container;
  /** the solution, bag-local coordinates (giai) */
  placements: Placement[];
  fill: number;
}

/** Tray area under the bag, screen coordinates (web: khay) */
export const TRAY_POLYGON: Polygon = [[6, 452], [414, 452], [414, 629], [6, 629]];

export interface BuildGreedyOptions {
  /** candidate item ids (default: designer pool) */
  ds?: number[];
  /** scales to try, biggest first */
  scales: number[];
  /** candidates sampled per turn (mau) */
  sample?: number;
  /** rotations (nGoc) */
  angles?: number;
  rand: () => number;
  /** max share of box-like items (maxVuong) */
  maxBoxShare?: number;
  /** time budget ms (han) */
  timeMs?: number;
}
export interface FillGapsOptions {
  scales?: number[];
  /** min contact ratio (nguong) */
  minContact?: number;
  /** time budget ms (han) */
  timeMs?: number;
  ds?: number[];
}
export interface GrowOptions {
  smax?: number;
  /** scale step (buoc) */
  step?: number;
  /** max nudge in cells (dich) */
  nudge?: number;
  /** rounds (vong) */
  rounds?: number;
  /** rotation nudge in radians (xoay) */
  turn?: number;
}

/** Minimal abort flag; a DOM AbortSignal also fits */
export interface AbortFlag { readonly aborted: boolean; }

export interface GapMeasure {
  /** diameter of the biggest empty spot, level units */
  gap: number;
  /** gap / sqrt(mean displayed item area) */
  ratio: number;
  /** BFS distance in cells */
  maxDist: number;
  meanItemArea: number;
}

export type AutoDesignPhase = 'build' | 'fill' | 'grow' | 'measure' | 'verify' | 'rejected' | 'done' | 'aborted' | 'failed';
export interface AutoDesignProgress {
  phase: AutoDesignPhase;
  attempt: number;
  maxAttempts: number;
  s0: number;
  scales: number[];
  /** best fill so far in this attempt (build phase) */
  bestFill?: number;
  itemCount?: number;
  gapRatio?: number;
  message: string;
}

export interface AutoDesignOptions {
  bagKey: string;
  /** bag scale (default: min(1.3, fit-to-screen), like setBag) */
  bagScale?: number;
  /** item id → number of levels already using it */
  usage?: Record<number, number> | Map<number, number>;
  /** explicit candidate pool (skips the pool selection rules) */
  pool?: number[];
  /** greedy build budget per attempt, ms (default 12000) */
  buildMs?: number;
  /** gap filling budget per attempt, ms (default 6000) */
  fillMs?: number;
  /** max time of one greedy run, ms (default 3000, web xay han) */
  buildRunMs?: number;
  maxAttempts?: number;
  seed?: number;
  minItems?: number;
  maxGapRatio?: number;
  minScale?: number;
  onProgress?: (p: AutoDesignProgress) => void;
  signal?: AbortFlag;
  /**
   * Also require that the items can be laid out on the tray (buildLevel succeeds), default true.
   * Not part of the approved web loop: added because big designs (scales ~1.6) often do not fit the
   * tray and web thanhLevel then returns null. Failure → s0 × 0.95.
   */
  requireTray?: boolean;
  /** level id / number / background used for the built level (defaults 'new', 1, 1) */
  levelId?: string;
  levelNumber?: number;
  background?: number;
  /** extra acceptance check (e.g. Box2D drop test); false → reject and try again */
  verify?: (design: Design, level: Level | null) => Promise<boolean> | boolean;
  /** time slice before yielding to the event loop, ms (default 12) */
  sliceMs?: number;
}

export interface AutoDesignResult extends Design {
  gap: number;
  gapRatio: number;
  attempts: number;
  s0: number;
  pool: number[];
  /** the finished level (buildLevel), null when requireTray is false and the tray layout failed */
  level: Level | null;
}

const yieldNow = () => new Promise<void>(r => setTimeout(r, 0));
/** Items to lay out on the tray, scales rounded like the stored level (web thanhLevel) */
const trayList = (d: Design) => d.placements.map(p => ({ id: p.id, s: +(+p.s).toFixed(3) }));

/** Yields to the event loop when the current slice is used up; tracks abort */
class Cooperative {
  private last = nowMs();
  constructor(private readonly sliceMs = 12, private readonly signal?: AbortFlag) {}
  get aborted(): boolean { return !!this.signal?.aborted; }
  async tick(): Promise<void> {
    if (nowMs() - this.last >= this.sliceMs) { await yieldNow(); this.last = nowMs(); }
  }
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const a = xs.slice().sort((p, q) => p - q), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Shrink every item by k (positions kept), never below MIN_ITEM_SCALE (web: thuNho) */
export function shrinkLevel(level: Level, k: number): Level {
  const l: Level = JSON.parse(JSON.stringify(level));
  for (const it of l.items) it.scale = +Math.max(MIN_ITEM_SCALE, it.scale * k).toFixed(3);
  for (const st of l.solution) st.s = l.items[st.i].scale;
  return l;
}

export class LevelDesigner {
  readonly lookup: ItemLookup;
  readonly skins: BagSkinMap;
  /** web: info */
  readonly info: Record<number, ItemInfo> = {};
  /** non-floating item ids, ascending (web: pool) */
  readonly pool: number[];
  private G: DesignGrid = null;
  private readonly maskCache = new Map<string, DesignMask>();
  /** the mask cache is cleared past this many entries */
  maxCachedMasks = 200000;

  /** web: khoiDong */
  constructor(catalog: ItemCatalog, skins: BagSkinMap) {
    this.lookup = catalog;
    this.skins = skins;
    for (const d of catalog.defs) {
      if (d.id <= 0) continue;
      const h = itemPolygons(catalog, d.id); if (!h) continue;
      const b = bbox(h.flat() as Polygon); const A = h.reduce((t, p) => t + polygonArea(p), 0);
      this.info[d.id] = { area: A, fillRatio: A / ((b.maxX - b.minX) * (b.maxY - b.minY)), name: d.name, float: d.meta?.physics === 'float' };
    }
    this.pool = Object.keys(this.info).map(Number).filter(id => !this.info[id].float);
  }

  /** current grid (web: luoi) */
  get grid(): DesignGrid { return this.G; }

  clearMaskCache(): void { this.maskCache.clear(); }

  /** Rasterise a polygon (web: dungLuoi). Obstacles are excluded with their real shape (see note). */
  buildGrid(shape: Polygon, extra: Partial<DesignGrid> = {}): DesignGrid {
    const bb = bbox(shape);
    const cols = Math.ceil((bb.maxX - bb.minX) / C), rows = Math.ceil((bb.maxY - bb.minY) / C);
    const bag = new Uint8Array(cols * rows); let total = 0;
    // NOTE: the web version builds obstacle rects as if (b.x, b.y) were the CENTRE; blocks store the
    // TOP-LEFT (blocks.js), so walls landed half a frame off. Here the real block polygon is used.
    const walls = (extra.blocks || []).map(b => ({ poly: blockPoly(b), bb: bbox(blockPoly(b)) }));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = bb.minX + (c + .5) * C, y = bb.minY + (r + .5) * C;
      const v = pointInPolygon(x, y, shape)
        && !walls.some(w => x >= w.bb.minX && x <= w.bb.maxX && y >= w.bb.minY && y <= w.bb.maxY && pointInPolygon(x, y, w.poly)) ? 1 : 0;
      bag[r * cols + c] = v; total += v;
    }
    return { cols, rows, bag, total, bb, shape, ...extra };
  }

  /** Select the bag to design for (web: setBag). Default scale: min(1.3, fit-to-screen). */
  setBag(key: string, scale?: number): DesignGrid {
    const sk = this.skins[key];
    if (!sk) throw new Error(`Unknown bag skin: ${key}`);
    const s = +(scale ?? Math.min(1.3, fitScreenScale(sk))).toFixed(3);
    const cont = resolveContainer({ skin: key, scale: s, cx: 210 }, { [key]: sk });
    this.G = this.buildGrid(cont.shape, { container: cont, key, scale: s, blocks: cont.blocks || [] });
    return this.G;
  }

  /** Cell mask of item `id` at angle a, scale s (web: matNa, cached by id|a|s at 3 decimals) */
  mask(id: number, a: number, s: number): DesignMask {
    const k = `${id}|${a.toFixed(3)}|${s.toFixed(3)}`;
    const hit = this.maskCache.get(k);
    if (hit) return hit;
    const h = itemPolygons(this.lookup, id).map(p => rotateScale(p, a, s));
    const b = bbox(h.flat() as Polygon);
    const cw = Math.ceil((b.maxX - b.minX) / C), ch = Math.ceil((b.maxY - b.minY) / C);
    const cr: number[] = [], cc: number[] = [], set = new Set<number>();
    for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) {
      const x = b.minX + (c + .5) * C, y = b.minY + (r + .5) * C;
      if (h.some(p => pointInPolygon(x, y, p))) { cr.push(r); cc.push(c); set.add(r * 4096 + c); }
    }
    const rr: number[] = [], rc: number[] = [];
    for (let i = 0; i < cr.length; i++) {
      const r = cr[i], c = cc[i];
      if (!set.has((r + 1) * 4096 + c)) { rr.push(r + 1); rc.push(c); }
      if (!set.has((r - 1) * 4096 + c)) { rr.push(r - 1); rc.push(c); }
      if (!set.has(r * 4096 + c + 1)) { rr.push(r); rc.push(c + 1); }
      if (!set.has(r * 4096 + c - 1)) { rr.push(r); rc.push(c - 1); }
    }
    const m: DesignMask = {
      cw, ch, cellR: Int32Array.from(cr), cellC: Int32Array.from(cc), ringR: Int32Array.from(rr), ringC: Int32Array.from(rc),
      minX: b.minX, minY: b.minY, a, s, n: cr.length,
    };
    if (this.maskCache.size >= this.maxCachedMasks) this.maskCache.clear();
    this.maskCache.set(k, m);
    return m;
  }

  /** Lowest spot of every column, keep the one touching the most edges (web: datMot) */
  placeOne(g: Uint8Array, id: number, s: number, nAngles: number): Spot | null {
    const G = this.G, cols = G.cols, rows = G.rows;
    let best: Spot = null;
    for (let i = 0; i < nAngles; i++) {
      const m = this.mask(id, i * 2 * Math.PI / nAngles, s);
      if (m.cw > cols || m.ch > rows) continue;
      const cR = m.cellR, cC = m.cellC, n = m.n, gR = m.ringR, gC = m.ringC, ringN = gR.length;
      for (let c0 = 0; c0 + m.cw <= cols; c0++) {
        for (let r0 = rows - m.ch; r0 >= 0; r0--) {
          let ok = true;
          for (let j = 0; j < n; j++) if (!g[(r0 + cR[j]) * cols + c0 + cC[j]]) { ok = false; break; }
          if (!ok) continue;
          let tx = 0;
          for (let j = 0; j < ringN; j++) {
            const rr = r0 + gR[j], cc = c0 + gC[j];
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !g[rr * cols + cc]) tx++;
          }
          const t = tx / ringN, score = t + .4 * (r0 + m.ch) / rows;
          if (!best || score > best.score) best = { score, t, m, r0, c0 };
          break;
        }
      }
    }
    return best;
  }

  /** Spot → bag-local item origin (web: toaDo) */
  private toCoords(b: { m: DesignMask; r0: number; c0: number }): { a: number; x: number; y: number } {
    return { a: b.m.a, x: this.G.bb.minX + b.c0 * C - b.m.minX, y: this.G.bb.minY + b.r0 * C - b.m.minY };
  }
  /** Mark a spot's cells busy (web: ghiO) */
  private markCells(g: Uint8Array, b: { m: DesignMask; r0: number; c0: number }): void {
    const cols = this.G.cols, m = b.m;
    for (let j = 0; j < m.n; j++) g[(b.r0 + m.cellR[j]) * cols + b.c0 + m.cellC[j]] = 0;
  }
  /** Grid with placements stamped busy (web: luoiTu) */
  gridFrom(out: Placement[]): Uint8Array {
    const G = this.G, g = G.bag.slice();
    for (const p of out) {
      const m = this.mask(p.id, p.a, p.s);
      const r0 = Math.round((p.y + m.minY - G.bb.minY) / C), c0 = Math.round((p.x + m.minX - G.bb.minX) / C);
      for (let j = 0; j < m.n; j++) {
        const rr = r0 + m.cellR[j], cc = c0 + m.cellC[j];
        if (rr >= 0 && cc >= 0 && rr < G.rows && cc < G.cols) g[rr * G.cols + cc] = 0;
      }
    }
    return g;
  }
  /** Filled share of the bag (web: doLap) */
  fillOf(g: Uint8Array): number { let free = 0; for (let i = 0; i < g.length; i++) free += g[i]; return 1 - free / this.G.total; }

  // ---------------------------------------------------------------- xay

  private *buildGreedySteps(o: BuildGreedyOptions): Generator<void, BuildResult, void> {
    const { ds = this.pool, scales, sample = 22, angles = 8, rand, maxBoxShare = .5, timeMs = 3000 } = o;
    const info = this.info, G = this.G;
    const t0 = nowMs();
    const g = G.bag.slice(), out: Placement[] = []; let used = 0;
    const maxA = Math.max(...ds.map(id => info[id].area)) * 1.96;
    while (nowMs() - t0 < timeMs) {
      const nBox = out.filter(p => info[p.id].fillRatio >= .9).length;
      const cand = ds.filter(id => !out.some(p => p.id === id) && !(info[id].fillRatio >= .9 && nBox + 1 > Math.max(2, (out.length + 1) * maxBoxShare)))
        .sort(() => rand() - .5).slice(0, sample);
      let best: { score: number; id: number; s: number; b: Spot; A: number } = null;
      for (const id of cand) {
        for (const s of scales) {
          if (!isTappable(id, s)) continue;
          const A = info[id].area * s * s;
          if (A > G.total * C * C - used) continue;
          const b = this.placeOne(g, id, s, angles); if (!b) continue;
          const score = b.t + .9 * A / maxA;
          if (!best || score > best.score) best = { score, id, s, b, A };
          break;
        }
        yield;
      }
      if (!best) break;
      this.markCells(g, best.b); used += best.A;
      out.push({ id: best.id, s: best.s, ...this.toCoords(best.b) });
    }
    return { placements: out, fill: this.fillOf(g) };
  }

  /** Greedy build, synchronous (web: xay). Needs setBag first. */
  buildGreedy(o: BuildGreedyOptions): BuildResult {
    const it = this.buildGreedySteps(o);
    for (;;) { const r = it.next(); if (r.done) return r.value; }
  }

  /** Greedy build, yielding to the event loop every `sliceMs`; returns null when aborted */
  async buildGreedyAsync(o: BuildGreedyOptions, ctl: { sliceMs?: number; signal?: AbortFlag } = {}): Promise<BuildResult | null> {
    const coop = new Cooperative(ctl.sliceMs, ctl.signal);
    const it = this.buildGreedySteps(o);
    for (;;) {
      const r = it.next(); if (r.done) return r.value;
      if (coop.aborted) return null;
      await coop.tick();
    }
  }

  // ---------------------------------------------------------------- lap2

  /** Push small items into the gaps; a small item may appear at most twice (web: lap2). Null when aborted. */
  async fillGaps(out: Placement[], o: FillGapsOptions = {}, ctl: { sliceMs?: number; signal?: AbortFlag } = {}): Promise<BuildResult | null> {
    const { scales = [1.1, 1.0, .9, .8], minContact = .3, timeMs = 15000, ds = this.pool } = o;
    const info = this.info;
    const coop = new Cooperative(ctl.sliceMs, ctl.signal);
    const t0 = nowMs();
    const g = this.gridFrom(out), res = out.map(p => ({ ...p }));
    const cand = ds.slice().sort((a, b) => info[b].area - info[a].area);
    while (nowMs() - t0 < timeMs) {
      let best: { id: number; s: number; b: Spot; A: number } = null;
      for (const id of cand) {
        if (res.filter(p => p.id === id).length >= 2) continue;
        for (const s of scales) {
          if (!isTappable(id, s)) continue;
          const b = this.placeOne(g, id, s, 8);
          if (b && b.t >= minContact) { const A = info[id].area * s * s; if (!best || A > best.A) best = { id, s, b, A }; break; }
        }
        if (nowMs() - t0 > timeMs) break;
        if (coop.aborted) return null;
        await coop.tick();
      }
      if (!best) break;
      this.markCells(g, best.b); res.push({ id: best.id, s: best.s, ...this.toCoords(best.b) });
      await yieldNow();
    }
    return { placements: res, fill: this.fillOf(g) };
  }

  // ---------------------------------------------------------------- bom

  /** Grow each item in place (nudge ±nudge cells, slight turn) until it touches all around (web: bom) */
  growInPlace(out: Placement[], o: GrowOptions = {}): BuildResult {
    const { smax = 1.6, step = .02, nudge = 2, rounds = 12, turn = .08 } = o;
    const G = this.G, cols = G.cols, rows = G.rows;
    const ds = out.map(p => ({ ...p }));
    const g = this.gridFrom(ds);
    const posOf = (m: DesignMask, x: number, y: number): [number, number] => [Math.round((y + m.minY - G.bb.minY) / C), Math.round((x + m.minX - G.bb.minX) / C)];
    const fitsAt = (m: DesignMask, r0: number, c0: number) => {
      for (let j = 0; j < m.n; j++) {
        const rr = r0 + m.cellR[j], cc = c0 + m.cellC[j];
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !g[rr * cols + cc]) return false;
      }
      return true;
    };
    const put = (m: DesignMask, r0: number, c0: number, v: number) => { for (let j = 0; j < m.n; j++) g[(r0 + m.cellR[j]) * cols + c0 + m.cellC[j]] = v; };
    for (let v = 0; v < rounds; v++) {
      let grew = false;
      for (const p of ds) {
        if (p.s >= smax) continue;
        const m0 = this.mask(p.id, p.a, p.s); const [r0, c0] = posOf(m0, p.x, p.y);
        put(m0, r0, c0, 1);
        let best: { s: number; a: number; x: number; y: number; m: DesignMask; r: number; c: number } = null;
        for (const da of [0, -turn, turn]) {
          const s = Math.min(smax, p.s + step), a = p.a + da, m = this.mask(p.id, a, s);
          const [br, bc] = posOf(m, p.x, p.y);
          for (let dr = -nudge; dr <= nudge && !best; dr++) for (let dc = -nudge; dc <= nudge; dc++) {
            if (fitsAt(m, br + dr, bc + dc)) { best = { s, a, x: p.x + dc * C, y: p.y + dr * C, m, r: br + dr, c: bc + dc }; break; }
          }
          if (best) break;
        }
        if (best) { p.s = best.s; p.a = best.a; p.x = best.x; p.y = best.y; put(best.m, best.r, best.c, 0); grew = true; }
        else put(m0, r0, c0, 0);
      }
      if (!grew) break;
    }
    return { placements: ds, fill: this.fillOf(g) };
  }

  // ---------------------------------------------------------------- khay

  /** Lay items out on the tray: biggest first, random tilt, no overlap (web: khay). Screen coordinates. */
  layoutTray(list: { id: number; s: number }[], seed = 1): Placement[] | null {
    const rand = mulberry32(seed);
    const prev = this.G;
    try {
      this.G = this.buildGrid(TRAY_POLYGON);
      const G = this.G, info = this.info;
      const g = G.bag.slice(), out: Placement[] = [];
      const ds = list.map((x, i) => ({ ...x, i })).sort((a, b) => info[b.id].area * b.s * b.s - info[a.id].area * a.s * a.s);
      for (const it of ds) {
        let best: { score: number; m: DesignMask; r0: number; c0: number } = null;
        for (let k = 0; k < 8; k++) {
          const a = +((rand() - .5) * .6 + (rand() < .3 ? Math.PI / 2 : 0)).toFixed(3);
          const m = this.mask(it.id, a, it.s);
          for (let c0 = 0; c0 + m.cw <= G.cols; c0 += 2) {
            for (let r0 = G.rows - m.ch; r0 >= 0; r0--) {
              let ok = true;
              for (let j = 0; j < m.n; j++) if (!g[(r0 + m.cellR[j]) * G.cols + c0 + m.cellC[j]]) { ok = false; break; }
              if (!ok) continue;
              const score = r0 + m.ch + rand() * 6;
              if (!best || score > best.score) best = { score, m, r0, c0 };
              break;
            }
          }
        }
        if (!best) return null;
        this.markCells(g, best);
        out[it.i] = { id: it.id, s: it.s, ...this.toCoords(best) };
      }
      return out;
    } finally {
      this.G = prev;
    }
  }

  // ---------------------------------------------------------------- thanhLevel

  /** Design from the current bag grid and placements (scales ×0.99, fill ×0.98 like the web driver) */
  designFrom(r: BuildResult): Design {
    const G = this.G;
    return { key: G.key, scale: G.scale, container: G.container, placements: r.placements.map(p => ({ ...p, s: p.s * .99 })), fill: r.fill * .98 };
  }

  /**
   * Complete level from a design: bag, items on the tray, difficulty, solution (web: thanhLevel).
   * `n` is the level number (seeds the tray layout, nameEn "Level n"). Output format is identical to
   * the web version; `background` defaults to 1 like the web (see book.ts backgroundForLevel).
   */
  buildLevel(design: Design, id: string, n: number, opts: { background?: number } = {}): Level | null {
    let k: Placement[] = null;
    for (let sd = 1; sd <= 12 && !k; sd++) k = this.layoutTray(trayList(design), sd * 31 + n);
    return k ? this.levelFromTray(design, id, n, k, opts) : null;
  }

  /** Same as buildLevel, yielding to the event loop between tray layout tries. Null when aborted or no layout. */
  async buildLevelAsync(design: Design, id: string, n: number, opts: { background?: number } = {}, signal?: AbortFlag): Promise<Level | null> {
    let k: Placement[] = null;
    for (let sd = 1; sd <= 12 && !k; sd++) {
      k = this.layoutTray(trayList(design), sd * 31 + n);
      await yieldNow();
      if (signal?.aborted) return null;
    }
    return k ? this.levelFromTray(design, id, n, k, opts) : null;
  }

  private levelFromTray(design: Design, id: string, n: number, k: Placement[], opts: { background?: number }): Level {
    const c = design.container, r3 = (v: number) => +(+v).toFixed(3), r1 = (v: number) => +(+v).toFixed(1);
    const lv: Level = {
      id, name: '', nameEn: 'Level ' + n, timer: 180, background: opts.background ?? 1,
      container: { skin: design.key, scale: r3(design.scale), blocks: c.blocks || [], cx: c.cx, bottom: c.bottom, shape: c.shape.map(p => p.map(r1) as [number, number]) },
      mode: 'fixed',
      items: k.map(o => ({ id: o.id, x: r1(o.x), y: r1(o.y), angle: +o.a.toFixed(2), scale: r3(o.s) })),
      reward: { coin: 20 }, emptyText: 'Kéo đồ vào túi',
    };
    const d = difficulty(lv, id2 => itemShapeArea(this.lookup, id2), this.lookup); lv.difficulty = { points: d.total, tier: d.tier };
    lv.solution = design.placements.map((p, i) => ({ i, id: p.id, s: r3(p.s), x: r1(c.cx + p.x), y: r1(c.bottom + p.y), angle: r3(p.a) }));
    return lv;
  }

  // ---------------------------------------------------------------- autoDesign

  /**
   * Biggest empty spot of the current bag with these placements: rasterise the interior on the
   * 2-unit grid, mark cells whose centre is inside a placed item polygon, multi-source BFS
   * (8-neighbour) from covered/outside cells; gap = 2 × maxDist × 2 units,
   * ratio = gap / sqrt(mean displayed item area).
   */
  measureGap(placements: Placement[]): GapMeasure {
    const G = this.G, cols = G.cols, rows = G.rows, N = cols * rows;
    const free = G.bag.slice();
    let areaSum = 0;
    for (const p of placements) {
      const polys = itemPolygons(this.lookup, p.id).map(q => rotateScale(q, p.a, p.s).map(([x, y]) => [x + p.x, y + p.y] as [number, number]));
      areaSum += (this.info[p.id]?.area ?? itemShapeArea(this.lookup, p.id)) * p.s * p.s;
      const b = bbox(polys.flat() as Polygon);
      const c1 = Math.max(0, Math.floor((b.minX - G.bb.minX) / C)), c2 = Math.min(cols - 1, Math.ceil((b.maxX - G.bb.minX) / C));
      const r1 = Math.max(0, Math.floor((b.minY - G.bb.minY) / C)), r2 = Math.min(rows - 1, Math.ceil((b.maxY - G.bb.minY) / C));
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const i = r * cols + c; if (!free[i]) continue;
        const x = G.bb.minX + (c + .5) * C, y = G.bb.minY + (r + .5) * C;
        if (polys.some(q => pointInPolygon(x, y, q))) free[i] = 0;
      }
    }
    const dist = new Int32Array(N).fill(-1), queue = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) if (!free[i]) { dist[i] = 0; queue[tail++] = i; }
    // cells on the grid border also touch the outside
    for (let i = 0; i < N; i++) {
      if (!free[i]) continue;
      const r = (i / cols) | 0, c = i - r * cols;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) { dist[i] = 1; queue[tail++] = i; }
    }
    let maxDist = 0;
    while (head < tail) {
      const i = queue[head++], d = dist[i];
      if (free[i] && d > maxDist) maxDist = d;
      const r = (i / cols) | 0, c = i - r * cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const j = nr * cols + nc;
        if (dist[j] !== -1) continue;
        dist[j] = d + 1; queue[tail++] = j;
      }
    }
    const meanItemArea = placements.length ? areaSum / placements.length : 0;
    const gap = 2 * maxDist * C;
    return { gap, ratio: meanItemArea > 0 ? gap / Math.sqrt(meanItemArea) : Infinity, maxDist, meanItemArea };
  }

  /**
   * Candidate pool for autoDesign: items used in < 2 levels, no floating items, no tiny items
   * (area < 0.35 × median area of the available items), mostly non-box items (all items with
   * fill ratio < 0.85 plus every 4th box-like one, ascending id).
   */
  selectPool(usage?: Record<number, number> | Map<number, number>): number[] {
    const used = (id: number) => (usage instanceof Map ? usage.get(id) : usage?.[id]) || 0;
    const info = this.info;
    const avail = this.pool.filter(id => used(id) < 2 && !info[id].float);
    const med = median(avail.map(id => info[id].area));
    const big = avail.filter(id => info[id].area >= .35 * med);
    let boxIdx = 0;
    return big.filter(id => info[id].fillRatio < .85 || (boxIdx++ % 4 === 0));
  }

  /**
   * Automatic design of one bag with the approved acceptance loop (2026-10-23):
   *   s0 = sqrt(bagArea × 0.8 / 8 / medianArea); scales = [1.25, 1.12, 1, .9, .82] × s0 clamped to [.82, 1.8];
   *   attempt = best-fill greedy builds for buildMs, then fillGaps (fillMs), growInPlace (smax = scales[0] + .15),
   *   scales × .99, fill × .98; reject: < minItems → s0 ×= .92; gap ratio > maxGapRatio → s0 ×= 1.02;
   *   an item scale < minScale → reject; nothing built → s0 ×= .95; tray layout fails → s0 ×= .95
   *   (requireTray, addition); optional verify(); up to maxAttempts. The result carries the built level.
   * Cooperative: yields to the event loop regularly. Returns null when aborted or nothing passed.
   */
  async autoDesign(o: AutoDesignOptions): Promise<AutoDesignResult | null> {
    const {
      bagKey, bagScale, buildMs = 12000, fillMs = 6000, buildRunMs = 3000, maxAttempts = 12, minItems = 6,
      maxGapRatio = .5, minScale = MIN_ITEM_SCALE, onProgress, signal, verify, sliceMs = 12,
      requireTray = true, levelId = 'new', levelNumber = 1, background,
    } = o;
    let seed = o.seed ?? 1;
    const ctl = { sliceMs, signal };
    this.setBag(bagKey, bagScale);
    const pool = o.pool ? o.pool.filter(id => this.info[id]) : this.selectPool(o.usage);
    if (!pool.length) { onProgress?.({ phase: 'failed', attempt: 0, maxAttempts, s0: 0, scales: [], message: 'empty item pool' }); return null; }
    const medianArea = median(pool.map(id => this.info[id].area));
    const bagArea = this.G.total * C * C;
    let s0 = Math.sqrt(bagArea * .8 / 8 / medianArea);
    const report = (p: Omit<AutoDesignProgress, 'maxAttempts'>) => onProgress?.({ ...p, maxAttempts });
    const aborted = () => {
      if (!signal?.aborted) return false;
      report({ phase: 'aborted', attempt: 0, s0, scales: [], message: 'aborted' });
      return true;
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const scales = [1.25, 1.12, 1.0, .9, .82].map(k => clamp(s0 * k, .82, 1.8));
      const base = { attempt, s0, scales };
      // 1) greedy builds, keep the best fill
      this.setBag(bagKey, bagScale);
      let best: BuildResult = null;
      const tb = nowMs();
      while (nowMs() - tb < buildMs) {
        const left = buildMs - (nowMs() - tb);
        const r = await this.buildGreedyAsync({ ds: pool, rand: mulberry32(seed++), scales, timeMs: Math.min(buildRunMs, left) }, ctl);
        if (!r) { aborted(); return null; }
        if (r.placements.length >= 4 && (!best || r.fill > best.fill)) best = r;
        report({ ...base, phase: 'build', bestFill: best?.fill, itemCount: best?.placements.length, message: `build: best fill ${best ? (best.fill * 100).toFixed(1) + '%' : '-'}` });
        await yieldNow();
        if (aborted()) return null;
      }
      if (!best) {
        s0 *= .95;
        report({ ...base, phase: 'rejected', message: 'no design found → s0 × 0.95' });
        continue;
      }
      // 2) fill gaps, 3) grow in place
      report({ ...base, phase: 'fill', bestFill: best.fill, itemCount: best.placements.length, message: 'filling gaps' });
      const filled = await this.fillGaps(best.placements, { timeMs: fillMs, ds: pool }, ctl);
      if (!filled) { aborted(); return null; }
      report({ ...base, phase: 'grow', bestFill: filled.fill, itemCount: filled.placements.length, message: 'growing items' });
      const grown = this.growInPlace(filled.placements, { smax: scales[0] + .15 });
      await yieldNow();
      if (aborted()) return null;
      const design = this.designFrom(grown);
      // 4) acceptance
      const gap = this.measureGap(design.placements);
      const count = design.placements.length;
      report({ ...base, phase: 'measure', bestFill: design.fill, itemCount: count, gapRatio: gap.ratio, message: `${count} items, fill ${(design.fill * 100).toFixed(1)}%, gap ratio ${gap.ratio.toFixed(2)}` });
      if (count < minItems) {
        s0 *= .92;
        report({ ...base, phase: 'rejected', itemCount: count, gapRatio: gap.ratio, message: `only ${count} items → s0 × 0.92` });
        continue;
      }
      if (gap.ratio > maxGapRatio) {
        s0 *= 1.02;
        report({ ...base, phase: 'rejected', itemCount: count, gapRatio: gap.ratio, message: `gap ratio ${gap.ratio.toFixed(2)} > ${maxGapRatio} → s0 × 1.02` });
        continue;
      }
      if (design.placements.some(p => p.s < minScale)) {
        report({ ...base, phase: 'rejected', itemCount: count, gapRatio: gap.ratio, message: `an item is smaller than ${minScale}` });
        continue;
      }
      const level = await this.buildLevelAsync(design, levelId, levelNumber, { background }, signal);
      if (aborted()) return null;
      if (!level && requireTray) {
        s0 *= .95;
        report({ ...base, phase: 'rejected', itemCount: count, gapRatio: gap.ratio, message: 'items do not fit on the tray → s0 × 0.95' });
        continue;
      }
      if (verify) {
        report({ ...base, phase: 'verify', itemCount: count, gapRatio: gap.ratio, message: 'verifying' });
        const ok = await verify(design, level);
        if (aborted()) return null;
        if (!ok) {
          report({ ...base, phase: 'rejected', itemCount: count, gapRatio: gap.ratio, message: 'verify failed' });
          continue;
        }
      }
      report({ ...base, phase: 'done', bestFill: design.fill, itemCount: count, gapRatio: gap.ratio, message: 'accepted' });
      return { ...design, gap: gap.gap, gapRatio: gap.ratio, attempts: attempt, s0, pool, level };
    }
    report({ phase: 'failed', attempt: maxAttempts, s0, scales: [], message: 'no design accepted' });
    return null;
  }
}
