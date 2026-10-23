// Stored level solution. Port of snug/src/gen/solution.js.
//
//   level.solution = [{ i, id, s, x, y, angle }, ...]
//     i      index of the item in level.items
//     id, s  item id and scale when the solution was computed (to know whether it still matches)
//     x, y   item ORIGIN on screen (same convention as level.items and solver plans)
//     angle  rotation
// The autoplay places items by BOTTOM EDGE, lowest first (placementOrder). If the level was edited
// so items or scales changed, the solution no longer matches (validSolution → null).
import { itemPolygons } from './solver';
import type { ItemLookup, Level, SolutionStep } from './types';

/** Bottom edge (largest screen y) of the item placed by this step (web: mepDuoi) */
export function bottomEdge(lookup: ItemLookup, st: SolutionStep): number {
  const h = itemPolygons(lookup, st.id); if (!h) return st.y;
  const c = Math.cos(st.angle || 0), s = Math.sin(st.angle || 0), k = st.s || 1;
  let max = -Infinity;
  for (const p of h) for (const [x, y] of p) max = Math.max(max, (x * s + y * c) * k);
  return st.y + max;
}

/** Placement order: lowest bottom edge (closest to the bag floor) first (web: thuTuDat) */
export const placementOrder = (lookup: ItemLookup, steps: SolutionStep[]): SolutionStep[] =>
  steps.slice().sort((a, b) => bottomEdge(lookup, b) - bottomEdge(lookup, a));

/** Solution steps if they still match the level's items, otherwise null (web: loiGiaiHopLe) */
export function validSolution(level: Level | null | undefined): SolutionStep[] | null {
  const steps = level?.solution, items = level?.items;
  if (!Array.isArray(steps) || !steps.length || !Array.isArray(items)) return null;
  const toPlace = items.filter(it => !it.inBag && it.id !== 0).length;
  if (steps.length !== toPlace) return null;
  const seen = new Set<number>();
  for (const st of steps) {
    const it = items[st.i];
    if (!it || it.inBag || seen.has(st.i)) return null;
    if (Number(it.id) !== Number(st.id)) return null;
    if (Math.abs((Number(it.scale) || 1) - (Number(st.s) || 1)) > .002) return null;
    seen.add(st.i);
  }
  return steps;
}
