// Difficulty points per the GDD table. Port of snug/src/gen/difficulty.js (same rows, thresholds
// and quirks: meta.size is compared with 'L' and meta.shape with 'irregular', exactly like the web).
import { effectiveScale } from './items';
import { polygonArea, isConvex } from './geom';
import { blocksArea } from './blocks';
import type { AreaOf, Container, DifficultyResult, DifficultyRow, ItemLookup, ItemMeta, Level } from './types';

export const TIERS: { max: number; name: string }[] = [
  { max: 6, name: 'Easy' }, { max: 10, name: 'Medium' }, { max: 14, name: 'Hard' }, { max: 17, name: 'Very Hard' }, { max: Infinity, name: 'Challenge' },
];
export const tierOf = (pts: number): string => TIERS.find(t => pts <= t.max).name;

/** Real bag interior area: polygon minus obstacles */
export function containerArea(container: Container): number {
  const shape = container.shape || [];
  return Math.max(1, polygonArea(shape) - blocksArea(container.blocks));
}

/** Container complexity: 0 simple · 1 slightly irregular · 2 irregular with many corners · 3 many zones */
export function containerComplexity(container: Container): number {
  const shape = container.shape || [];
  const blocks = (container.blocks || []).length;
  if ((container.areas || []).length > 0 || blocks >= 2) return 3;
  // fixed-shape bag (has scale): same shape in every level, complexity only from obstacles
  if (container.scale != null) return blocks ? 1 : 0;
  if (shape.length <= 4 && blocks === 0) return 0;
  if (!isConvex(shape) && shape.length >= 8) return 2;
  if (!isConvex(shape) || blocks === 1 || shape.length > 4) return 1;
  return 0;
}

/**
 * Compute the points. `areaOf`: id → item area; `lookup`: item defs (for meta).
 * Returns { rows: [{label, cond, pts}], total, tier, density, itemArea, usable, count }.
 */
export function difficulty(level: Level, areaOf: AreaOf, lookup: ItemLookup): DifficultyResult {
  const items = level.items.filter(it => it.id !== 0);
  const usable = containerArea(level.container);
  // the item's own scale in this level multiplies the area by its SQUARE
  const itemArea = items.reduce((s, it) => {
    const k = effectiveScale(level, it);
    return s + (areaOf(it.id) || 0) * k * k;
  }, 0);
  const density = itemArea / usable;
  const rows: DifficultyRow[] = [];

  const dPct = density * 100;
  rows.push({ label: 'Packing Density', cond: `${dPct.toFixed(0)}%`, pts: dPct < 65 ? 0 : dPct < 75 ? 1 : dPct < 83 ? 2 : dPct <= 88 ? 3 : 4 });

  const n = items.length;
  rows.push({ label: 'Item Count', cond: `${n} món`, pts: n <= 5 ? 0 : n <= 7 ? 1 : n <= 10 ? 2 : 3 });

  const metas: ItemMeta[] = items.map(it => lookup.defById(it.id)?.meta).filter(Boolean);
  const large = metas.filter(m => m.size === 'L').length;
  const irregular = metas.filter(m => m.shape === 'irregular').length;
  const long = metas.filter(m => m.shape === 'long').length;
  let sizePts = 0, sizeCond = 'Small/Medium đơn giản';
  if (large >= 3 && irregular >= 3) { sizePts = 3; sizeCond = `${large} Large + ${irregular} irregular`; }
  else if (large >= 3 || irregular >= 3) { sizePts = 2; sizeCond = `${large} Large / ${irregular} irregular`; }
  else if (large >= 1 || long >= 1) { sizePts = 1; sizeCond = `${large} Large, ${long} dài`; }
  rows.push({ label: 'Size / Shape', cond: sizeCond, pts: sizePts });

  const rolling = metas.filter(m => m.physics === 'rolling' || m.physics === 'bouncy').length;
  rows.push({ label: 'Rolling / Bouncy', cond: `${rolling} món`, pts: Math.min(3, rolling) });

  const linked = items.filter(it => it.link).length;
  rows.push({ label: 'Linked', cond: `${linked} pair`, pts: linked === 0 ? 0 : linked === 1 ? 2 : 3 });

  const locked = items.filter(it => it.locked).length;
  rows.push({ label: 'Locked', cond: `${locked} món`, pts: locked === 0 ? 0 : locked === 1 ? 2 : 3 });

  const cc = containerComplexity(level.container);
  rows.push({ label: 'Container', cond: ['đơn giản', 'hơi irregular', 'irregular', 'nhiều vùng / block'][cc], pts: cc });

  const total = rows.reduce((s, r) => s + r.pts, 0);
  return { rows, total, tier: tierOf(total), density, itemArea, usable, count: n };
}
