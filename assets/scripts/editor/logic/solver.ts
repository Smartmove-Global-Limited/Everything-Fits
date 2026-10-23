// Packing solver: can all items fit in the bag interior, and how. Port of snug/src/gen/solver.js.
//
// Rasterises the bag interior into CELL-unit cells and every item's REAL shape at several
// rotations into cell masks, then packs bottom-up: each turn it looks for the remaining item
// that can sit LOWEST, most supported, leaving the fewest holes. Several randomised plans are
// tried within a time budget. The returned plan is sorted by BOTTOM EDGE, lowest first.
import { pointInPolygon, bbox, mulberry32, nowMs } from './geom';
import { effectiveScale } from './items';
import { blockPoly } from './blocks';
import type { Block, Container, ItemLookup, Level, Polygon } from './types';

// Mask sampling modes:
//   center  a cell belongs to the item when its CENTRE is inside the shape (unbiased)
//   inner   plus four corners pulled in by 30% (item slightly "fatter")
//   full    four corners near the cell edges (conservative)
const INSET_BY_MASK: Record<string, number | null> = { center: null, inner: .3, full: .08 };
function samplePoints(mask: string): [number, number][] {
  const inset = INSET_BY_MASK[mask] ?? null;
  return inset == null ? [[.5, .5]] : [[.5, .5], [inset, inset], [1 - inset, inset], [inset, 1 - inset], [1 - inset, 1 - inset]];
}
// the bag interior is always sampled at the cell centre
const BAG_SAMPLES: [number, number][] = [[.5, .5]];

// ---------------------------------------------------------------- item shapes
/** circles are approximated by this many vertices (web: TRON_DINH) */
const CIRCLE_VERTICES = 16;

/** Polygons forming the physics shape of an item, logic units, origin at the item centre (web: hinhMon) */
export function itemPolygons(lookup: ItemLookup, id: number): Polygon[] | null {
  const d = lookup.defById(id); if (!d) return null;
  const pieces = d.kind === 'compound' ? d.parts : [d, ...(d.extra ? [d.extra] : [])];
  const out: Polygon[] = [];
  for (const p of pieces) {
    const dx = p.dx || 0, dy = p.dy || 0;
    if (p.kind === 'circle') {
      const v: Polygon = [];
      for (let i = 0; i < CIRCLE_VERTICES; i++) {
        const a = i / CIRCLE_VERTICES * 2 * Math.PI;
        v.push([dx + Math.cos(a) * p.r, dy + Math.sin(a) * p.r]);
      }
      out.push(v);
    } else if (p.kind === 'rect') {
      const w = p.w / 2, h = p.h / 2;
      out.push([[dx - w, dy - h], [dx + w, dy - h], [dx + w, dy + h], [dx - w, dy + h]]);
    } else if (p.kind === 'poly' && p.pts?.length >= 3) {
      out.push(p.pts.map(([x, y]) => [dx + x, dy + y] as [number, number]));
    }
  }
  if (!out.length && d.box) {
    const [x0, y0, x1, y1] = d.box;
    out.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  }
  return out.length ? out : null;
}

/** Rotate by `a` then scale by `k` (web: xoay) */
export const rotateScale = (pts: Polygon, a: number, k: number): Polygon => {
  const cs = Math.cos(a), sn = Math.sin(a);
  return pts.map(([x, y]) => [(x * cs - y * sn) * k, (x * sn + y * cs) * k] as [number, number]);
};

/** Cell mask of an item at one rotation (web: matNa in solver.js) */
interface SolverMask {
  o: Uint8Array; cw: number; ch: number;
  /** local coordinates of the mask's top-left, to map back to the item centre */
  minX: number; minY: number;
  /** number of filled cells */
  so: number;
  /** lowest filled row per column (−1 = empty column) */
  day: Int16Array;
  goc: number;
}

function buildMask(shape: Polygon[], angle: number, k: number, CELL: number, samples: [number, number][]): SolverMask {
  const pieces = shape.map(p => rotateScale(p, angle, k));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pieces) for (const [x, y] of p) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cw = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const ch = Math.max(1, Math.ceil((maxY - minY) / CELL));
  const o = new Uint8Array(cw * ch);
  let so = 0;
  for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) {
    const x0 = minX + c * CELL, y0 = minY + r * CELL;
    if (samples.some(([u, v]) => pieces.some(p => pointInPolygon(x0 + u * CELL, y0 + v * CELL, p)))) { o[r * cw + c] = 1; so++; }
  }
  if (!so) { o.fill(1); so = cw * ch; }   // item thinner than a cell: fill it so it still takes room
  const day = new Int16Array(cw).fill(-1);
  for (let c = 0; c < cw; c++) for (let r = ch - 1; r >= 0; r--) if (o[r * cw + c]) { day[c] = r; break; }
  return { o, cw, ch, minX, minY, so, day, goc: angle };
}

/** Keep one of identical masks (180° symmetric shapes) */
function dedupeMasks(list: SolverMask[]): SolverMask[] {
  const out: SolverMask[] = [];
  for (const m of list) {
    const dup = out.some(x => x.cw === m.cw && x.ch === m.ch && x.o.every((v, i) => v === m.o[i]));
    if (!dup) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- bag grid
interface SolverGrid { grid: Uint8Array; cols: number; rows: number; }

/** 1 = free cell inside the bag, outside obstacles */
function rasterize(container: Container, CELL: number): SolverGrid {
  const shape = container.shape, bb = bbox(shape);
  const cols = Math.ceil(bb.w / CELL), rows = Math.ceil(bb.h / CELL);
  const grid = new Uint8Array(cols * rows);
  const blocks = (container.blocks || []).map(b => ({ ...b, poly: !b.kind || b.kind === 'rect' ? null : blockPoly(b) })) as (Block & { poly: Polygon | null })[];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = bb.minX + c * CELL, y0 = bb.minY + r * CELL;
    let ok = BAG_SAMPLES.every(([u, v]) => pointInPolygon(x0 + u * CELL, y0 + v * CELL, shape));
    for (const b of blocks) {
      if (!ok) break;
      // obstacle: any cell touching it is busy
      if (!(x0 + CELL > b.x && x0 < b.x + b.w && y0 + CELL > b.y && y0 < b.y + b.h)) continue;
      if (!b.poly) { ok = false; continue; }
      // non-rect shape: busy when the centre or a corner of the cell is inside, or a vertex falls in the cell
      ok = !([[.5, .5], [0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]).some(([u, v]) => pointInPolygon(x0 + u * CELL, y0 + v * CELL, b.poly))
        && !b.poly.some(([px, py]) => px >= x0 && px <= x0 + CELL && py >= y0 && py <= y0 + CELL);
    }
    grid[r * cols + c] = ok ? 1 : 0;
  }
  return { grid, cols, rows };
}

/** Does the item fit at (c0, r0)? Checked bottom row first. (web: vua) */
function fits(g: SolverGrid, m: SolverMask, c0: number, r0: number): boolean {
  if (c0 < 0 || r0 < 0 || c0 + m.cw > g.cols || r0 + m.ch > g.rows) return false;
  for (let r = m.ch - 1; r >= 0; r--) {
    const rowM = r * m.cw, rowG = (r0 + r) * g.cols + c0;
    for (let c = 0; c < m.cw; c++) if (m.o[rowM + c] && g.grid[rowG + c] !== 1) return false;
  }
  return true;
}
/** web: danh */
function stamp(g: SolverGrid, m: SolverMask, c0: number, r0: number, v: number): void {
  for (let r = 0; r < m.ch; r++) {
    const rowM = r * m.cw, rowG = (r0 + r) * g.cols + c0;
    for (let c = 0; c < m.cw; c++) if (m.o[rowM + c]) g.grid[rowG + c] = v;
  }
}

const NEIGHBOURS4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/**
 * Score of a spot (web: diemCho), higher is better:
 *   + item cell edges resting on the bag wall or placed items
 *   − 4 × empty cells right under the item's bottom
 *   − 30 when less than half the bottom width is supported
 */
function spotScore(g: SolverGrid, m: SolverMask, c0: number, r0: number): number {
  let contact = 0, holes = 0;
  for (let r = 0; r < m.ch; r++) for (let c = 0; c < m.cw; c++) {
    if (!m.o[r * m.cw + c]) continue;
    const gr = r0 + r, gc = c0 + c;
    for (const [dr, dc] of NEIGHBOURS4) {
      const mr = r + dr, mc = c + dc;
      if (mr >= 0 && mc >= 0 && mr < m.ch && mc < m.cw && m.o[mr * m.cw + mc]) continue;  // the item's own cell
      const nr = gr + dr, nc = gc + dc;
      if (nr < 0 || nc < 0 || nr >= g.rows || nc >= g.cols) { contact++; continue; }
      if (g.grid[nr * g.cols + nc] !== 1) contact++;
    }
  }
  let cols = 0;
  for (let c = 0; c < m.cw; c++) {
    const d = m.day[c]; if (d < 0) continue;
    cols++;
    const nr = r0 + d + 1, nc = c0 + c;
    if (nr < g.rows && g.grid[nr * g.cols + nc] === 1) holes++;
  }
  const support = cols ? (cols - holes) / cols : 1;
  return contact - 4 * holes - (support < .5 ? 30 : 0);
}

/** Solver item: id + masks per rotation */
interface SolverItem { id: number; ref: unknown; masks: SolverMask[]; so: number; }
interface Spot { m: SolverMask; c: number; r: number; day: number; diem: number; }

/**
 * Best spot for one item, scanned by BOTTOM EDGE from the bag floor up (web: choThapNhat).
 * Candidates within WINDOW rows from the deepest feasible row; total = spot score + PER_ROW × depth.
 */
const WINDOW = 2, PER_ROW = 20;
function lowestSpot(g: SolverGrid, b: SolverItem): Spot | null {
  let best: Spot = null, bestTotal = -Infinity, firstDay = -1;
  for (let day = g.rows; day >= 1; day--) {
    if (firstDay >= 0 && firstDay - day >= WINDOW) break;
    for (const m of b.masks) {
      const r = day - m.ch;
      if (r < 0) continue;
      for (let c = 0; c <= g.cols - m.cw; c++) {
        if (!fits(g, m, c, r)) continue;
        if (firstDay < 0) firstDay = day;
        const diem = spotScore(g, m, c, r), total = diem + PER_ROW * day;
        if (total > bestTotal) { bestTotal = total; best = { m, c, r, day, diem }; }
      }
    }
  }
  return best;
}

interface Placed { id: number; ref: unknown; c: number; r: number; m: SolverMask; goc: number; }
interface PlanResult { ok: boolean; placed: Placed[]; failed: number | undefined; dinh: number; }

/** One plan choosing the item per spot (web: phuongAn). `noise` > 0 sometimes takes the 2nd/3rd candidate. */
function planBySpot(g0: SolverGrid, items: SolverItem[], rand: () => number, noise: number, timeUp: () => boolean): PlanResult {
  const g: SolverGrid = { grid: g0.grid.slice(), cols: g0.cols, rows: g0.rows };
  const left = items.slice();
  const placed: Placed[] = [];
  while (left.length) {
    if (timeUp()) break;
    const cand: { b: SolverItem; spot: Spot }[] = [];
    for (const b of left) {
      const spot = lowestSpot(g, b);
      if (spot) cand.push({ b, spot });
    }
    if (!cand.length) break;
    cand.sort((x, y) => (y.spot.day - x.spot.day) || (y.b.so - x.b.so) || (y.spot.diem - x.spot.diem));
    let k = 0;
    if (noise > 0 && cand.length > 1 && rand() < noise) k = 1 + Math.floor(rand() * Math.min(2, cand.length - 1));
    const { b, spot } = cand[k];
    stamp(g, spot.m, spot.c, spot.r, 2);
    placed.push({ id: b.id, ref: b.ref, c: spot.c, r: spot.r, m: spot.m, goc: spot.m.goc });
    left.splice(left.indexOf(b), 1);
  }
  // top of the pile: lower is tidier, used to compare plans with the same count
  let top = g.rows;
  for (const p of placed) top = Math.min(top, p.r);
  return { ok: left.length === 0, placed, failed: left[0]?.id, dinh: top };
}

/** Plan in a fixed order (web: phuongAnTheoThuTu): much cheaper, more tries */
function planInOrder(g0: SolverGrid, order: SolverItem[], timeUp: () => boolean): PlanResult {
  const g: SolverGrid = { grid: g0.grid.slice(), cols: g0.cols, rows: g0.rows };
  const placed: Placed[] = [];
  for (const b of order) {
    if (timeUp()) break;
    const spot = lowestSpot(g, b);
    if (!spot) return { ok: false, placed, failed: b.id, dinh: pileTop(placed, g) };
    stamp(g, spot.m, spot.c, spot.r, 2);
    placed.push({ id: b.id, ref: b.ref, c: spot.c, r: spot.r, m: spot.m, goc: spot.m.goc });
  }
  return { ok: placed.length === order.length, placed, failed: undefined, dinh: pileTop(placed, g) };
}
function pileTop(placed: Placed[], g: SolverGrid): number { let d = g.rows; for (const p of placed) d = Math.min(d, p.r); return d; }
const shuffleArr = <T>(rand: () => number, arr: T[]): T[] => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

/** Solver plan step: SCREEN coordinates of the item origin */
export interface PlanStep { id: number; ref: unknown; x: number; y: number; angle: number; }

/** Grid result → screen-space plan sorted by bottom edge, lowest first (web: toPlan) */
function toPlan(placed: Placed[], level: Level, CELL: number): PlanStep[] {
  const c = level.container || {};
  const ox = c.cx ?? 210, oy = c.bottom ?? 404;
  const bb = bbox(c.shape);
  return placed.slice()
    .sort((a, b) => ((b.r + b.m.ch) - (a.r + a.m.ch)) || (b.m.so - a.m.so))
    .map(p => ({
      id: p.id, ref: p.ref,
      x: Math.round(ox + bb.minX + p.c * CELL - p.m.minX),
      y: Math.round(oy + bb.minY + p.r * CELL - p.m.minY),
      angle: p.goc,
    }));
}

export interface SolveOptions {
  /** max number of plans */
  tries?: number;
  seed?: number;
  /** max time, ms (wall clock for solveAsync) */
  budgetMs?: number;
  cell?: number;
  mask?: 'center' | 'inner' | 'full';
  /** number of rotations (web: goc) */
  angles?: number;
  /** caller gave up (web: huy), solveAsync only */
  cancel?: () => boolean;
}
export interface SolveResult {
  solvable: boolean; tries: number; placedCount: number; needCount: number;
  failed?: number; plan: PlanStep[];
}

/** Build grid and masks for a level (web: chuanBi) */
function prepare(level: Level, lookup: ItemLookup, o: Required<Omit<SolveOptions, 'cancel'>>) {
  const CELL = o.cell, samples = samplePoints(o.mask);
  const ANGLES = Array.from({ length: o.angles }, (_, i) => i * 2 * Math.PI / o.angles);
  const g = rasterize(level.container, CELL);
  const bb = bbox(level.container.shape);
  const scaleOf = (it: Level['items'][number]) => effectiveScale(level, it);

  // items already in the bag: mark their cells busy with their real shape and angle
  for (const it of level.items) {
    if (!it.inBag) continue;
    const shape = itemPolygons(lookup, it.id); if (!shape) continue;
    const m = buildMask(shape, it.angle || 0, scaleOf(it), CELL, samples);
    const c0 = Math.round(((it.x ?? 0) + m.minX - bb.minX) / CELL);
    const r0 = Math.round(((it.y ?? 0) + m.minY - bb.minY) / CELL);
    for (let r = 0; r < m.ch; r++) for (let c = 0; c < m.cw; c++) {
      if (!m.o[r * m.cw + c]) continue;
      const gr = r0 + r, gc = c0 + c;
      if (gr >= 0 && gr < g.rows && gc >= 0 && gc < g.cols) g.grid[gr * g.cols + gc] = 0;
    }
  }

  const items: SolverItem[] = level.items
    .filter(it => !it.inBag && it.id !== 0)
    .map(it => {
      const shape = itemPolygons(lookup, it.id); if (!shape) return null;
      const k = scaleOf(it);
      const masks = dedupeMasks(ANGLES.map(a => buildMask(shape, a, k, CELL, samples)));
      return { id: it.id, ref: it.ref, masks, so: masks[0].so };
    })
    .filter(Boolean);
  return { g, items, CELL };
}

/** Try number t: alternates per-spot planning (thorough) and size-ordered planning with shuffles (cheap) */
function tryOnce(t: number, g: SolverGrid, items: SolverItem[], bySize: SolverItem[], rand: () => number, timeUp: () => boolean): PlanResult {
  if (t % 2 === 0) return planBySpot(g, items, rand, t === 0 ? 0 : Math.min(.5, .15 + t * .02), timeUp);
  let order = bySize;
  if (t > 1) {
    const half = Math.ceil(bySize.length / 2);
    order = t % 3 === 0 ? shuffleArr(rand, bySize) : bySize.slice(0, half).concat(shuffleArr(rand, bySize.slice(half)));
  }
  return planInOrder(g, order, timeUp);
}
// Better plan: complete > more placed AREA > more items > lower pile
const placedArea = (r: PlanResult) => r.placed.reduce((s, p) => s + p.m.so, 0);
const isBetter = (r: PlanResult, best: PlanResult | null) => !best || (r.ok && !best.ok)
  || (r.ok === best.ok && (placedArea(r) > placedArea(best)
    || (placedArea(r) === placedArea(best) && (r.placed.length > best.placed.length
      || (r.placed.length === best.placed.length && r.dinh > best.dinh)))));
function result(best: PlanResult, t: number, needCount: number, level: Level, CELL: number): SolveResult {
  return {
    solvable: best.ok, tries: t, placedCount: best.placed.length, needCount,
    failed: best.ok ? undefined : best.failed, plan: toPlan(best.placed, level, CELL),
  };
}
const DEFAULTS = { tries: 150, seed: 1, budgetMs: 250, cell: 5, mask: 'center' as const, angles: 8 };

/**
 * Estimate whether all items fit in the bag and return the best packing found. An estimate:
 * grid of `cell` units, `angles` rotations, no physics. Items already in the bag (inBag) take room.
 * Stops at `tries` plans or `budgetMs`, whichever first. The first plan is deterministic.
 */
export function solve(level: Level, lookup: ItemLookup, opts: SolveOptions = {}): SolveResult {
  const o = { ...DEFAULTS, ...opts };
  const t0 = nowMs();
  const timeUp = () => nowMs() - t0 > o.budgetMs;
  const { g, items, CELL } = prepare(level, lookup, o);
  const needCount = items.length;
  if (!needCount) return { solvable: true, tries: 0, placedCount: 0, needCount: 0, plan: [] };
  const rand = mulberry32(o.seed);
  const bySize = items.slice().sort((a, b) => b.so - a.so);
  let best: PlanResult = null, t = 0;
  for (; t < o.tries; t++) {
    const r = tryOnce(t, g, items, bySize, rand, timeUp);
    if (isBetter(r, best)) best = r;
    if (r.ok || timeUp()) { t++; break; }
  }
  return result(best, t, needCount, level, CELL);
}

/** Like solve but yields to the event loop between plans. budgetMs is wall-clock time. */
export async function solveAsync(level: Level, lookup: ItemLookup, opts: SolveOptions = {}): Promise<SolveResult> {
  const o = { ...DEFAULTS, ...opts };
  const t0 = nowMs();
  const timeUp = () => nowMs() - t0 > o.budgetMs || !!o.cancel?.();
  const yieldNow = () => new Promise<void>(r => setTimeout(r, 0));
  const { g, items, CELL } = prepare(level, lookup, o);
  const needCount = items.length;
  if (!needCount) return { solvable: true, tries: 0, placedCount: 0, needCount: 0, plan: [] };
  const rand = mulberry32(o.seed);
  const bySize = items.slice().sort((a, b) => b.so - a.so);
  let best: PlanResult = null, t = 0;
  for (; t < o.tries; t++) {
    const r = tryOnce(t, g, items, bySize, rand, timeUp);
    if (isBetter(r, best)) best = r;
    if (r.ok || timeUp()) { t++; break; }
    await yieldNow();
  }
  return result(best, t, needCount, level, CELL);
}
