// Template-based level generator (GDD flow): pick shape → usable area → random items by density
// and size distribution → assign mechanics → difficulty → solver → best candidate.
// Port of snug/src/gen/generator.js; the item lookup is passed in instead of the global defById.
import { mulberry32, randInt, shuffle } from './geom';
import { difficulty, containerArea, TIERS } from './difficulty';
import { solve, SolveResult } from './solver';
import type { AreaOf, Container, DifficultyResult, ItemDef, ItemLookup, Level, LevelItem } from './types';

const TRAY = { x0: 40, x1: 380, y0: 450, y1: 600 };

export interface GenerateTemplate {
  seed: number;
  pool: number[];
  count: [number, number];
  density: [number, number];
  /** wanted Large / Medium counts (Small = the rest) */
  sizeDist?: { L?: number; M?: number; S?: number };
  mechanics?: { rolling?: number; linked?: number; locked?: number };
  tier?: string | null;
  container: Container;
  id?: string;
  name?: string;
  timer?: number;
  background?: number | string;
}

export interface GenerateResult {
  score: number;
  level: Level;
  diff: DifficultyResult;
  sol: SolveResult;
  attempt: number;
  target: number;
  densErr: number;
  /** best density reachable with the pool's biggest items */
  maxDensity?: number;
  /** hint for the designer (Vietnamese, same text as the web editor) */
  hint?: string;
}

/**
 * Generate a level from a template. areaOf(id) → item area; lookup → item defs (meta).
 * Returns the best candidate { level, diff, sol, … } or null.
 */
export function generate(template: GenerateTemplate, areaOf: AreaOf, lookup: ItemLookup, { attempts = 120 }: { attempts?: number } = {}): GenerateResult | null {
  const rand = mulberry32(template.seed >>> 0 || 1);
  const usable = containerArea(template.container);
  const pool = template.pool.map(id => lookup.defById(id)).filter(d => d && d.id !== 0);
  let best: GenerateResult = null;

  for (let a = 0; a < attempts; a++) {
    const count = randInt(rand, template.count[0], template.count[1]);
    const target = template.density[0] + rand() * (template.density[1] - template.density[0]);
    const chosen = pickItems(rand, pool, count, target * usable, template.sizeDist, areaOf);
    if (!chosen) continue;
    const items: LevelItem[] = chosen.map(d => ({ id: d.id, x: 0, y: 0, angle: 0 }));
    assignMechanics(rand, items, template.mechanics || {}, lookup);
    if (items.some(it => it.locked)) items.push({ id: 0, inBag: true, x: randInt(rand, -60, 60), y: -30, angle: 0 });
    layoutTray(rand, items);
    const level = { ...baseLevel(template), items } as Level;
    const diff = difficulty(level, areaOf, lookup);
    const inTier = !template.tier || diff.tier === template.tier;
    const sol = solve(level, lookup, { tries: 30, seed: template.seed + a });
    const densErr = Math.abs(diff.density - target);
    const score = (inTier ? 0 : 10) + (sol.solvable ? 0 : 20) + densErr * 40;
    if (!best || score < best.score) best = { score, level, diff, sol, attempt: a + 1, target, densErr };
    if (inTier && sol.solvable && densErr < .04) break;
  }
  if (best) {
    // the pool cannot reach the wanted density → tell the designer
    const maxArea = pool.map(d => areaOf(d.id)).sort((x, y) => y - x).slice(0, template.count[1]).reduce((s, v) => s + v, 0);
    best.maxDensity = maxArea / usable;
    best.hint = best.densErr > .06
      ? (best.maxDensity < template.density[0]
        ? `Pool chỉ đạt tối đa ${(best.maxDensity * 100).toFixed(0)}% với ${template.count[1]} món — thêm món lớn, tăng count, hoặc thu nhỏ lòng túi.`
        : 'Chưa bám sát density mong muốn — thử Reroll hoặc nới count.')
      : '';
  }
  return best;
}

/** Level fields without items (web: baseLevel) */
function baseLevel(t: GenerateTemplate): Partial<Level> {
  return {
    id: t.id || 'gen', name: t.name || 'Generated', timer: t.timer || 90, background: t.background || 'vanity',
    container: JSON.parse(JSON.stringify(t.container)), mode: 'generated', reward: { coin: 20 },
    generate: { seed: t.seed, pool: t.pool, count: t.count, density: t.density, sizeDist: t.sizeDist, mechanics: t.mechanics, tier: t.tier },
  };
}

/**
 * Pick `count` items whose total area is close to targetArea, honouring sizeDist {L, M}
 * (S = the rest). Targeted greedy, then swaps to refine.
 */
function pickItems(rand: () => number, pool: ItemDef[], count: number, targetArea: number, sizeDist: GenerateTemplate['sizeDist'] = {}, areaOf: AreaOf): ItemDef[] | null {
  if (pool.length < count) return null;
  const A = (d: ItemDef) => areaOf(d.id) || 1;
  const byS = { L: pool.filter(d => d.meta.size === 'L'), M: pool.filter(d => d.meta.size === 'M'), S: pool.filter(d => d.meta.size === 'S') };
  const want = { L: Math.min(sizeDist.L ?? 0, byS.L.length), M: Math.min(sizeDist.M ?? 0, byS.M.length), S: 0 };
  want.S = Math.max(0, count - want.L - want.M);

  // 1) fill per size group; in each group pick the item bringing the total closest to the target
  const chosen: ItemDef[] = [];
  const takeFrom = (list: ItemDef[], n: number) => {
    const avail = shuffle(rand, list.filter(d => !chosen.includes(d)));
    for (let i = 0; i < n && avail.length; i++) {
      const remainSlots = count - chosen.length - 1;
      const cur = chosen.reduce((s, d) => s + A(d), 0);
      // ideal area for this item: what is missing, split over the remaining slots
      const ideal = remainSlots > 0 ? (targetArea - cur) / (remainSlots + 1) : targetArea - cur;
      avail.sort((a, b) => Math.abs(A(a) - ideal) - Math.abs(A(b) - ideal));
      chosen.push(avail.shift());
    }
  };
  takeFrom(byS.L, want.L); takeFrom(byS.M, want.M); takeFrom(byS.S, want.S);
  while (chosen.length < count) {
    const avail = pool.filter(d => !chosen.includes(d));
    if (!avail.length) break;
    const cur = chosen.reduce((s, d) => s + A(d), 0);
    const ideal = targetArea - cur;
    avail.sort((a, b) => Math.abs(A(a) - ideal) - Math.abs(A(b) - ideal));
    chosen.push(avail[0]);
  }

  // 2) refine by swaps. Pass A keeps the size distribution; if still > 6% off, pass B relaxes it.
  const err = (list: ItemDef[]) => Math.abs(list.reduce((s, d) => s + A(d), 0) - targetArea);
  const refine = (keepSize: boolean) => {
    for (let pass = 0; pass < 80; pass++) {
      let improved = false;
      const outside = pool.filter(d => !chosen.includes(d));
      for (let i = 0; i < chosen.length && !improved; i++) {
        for (const cand of outside) {
          if (keepSize && cand.meta.size !== chosen[i].meta.size) continue;
          const trial = chosen.slice(); trial[i] = cand;
          if (err(trial) < err(chosen) - 1) { chosen[i] = cand; improved = true; break; }
        }
      }
      if (!improved) break;
    }
  };
  refine(!!(want.L || want.M));
  if (err(chosen) / targetArea > .06) refine(false);
  return chosen;
}

function assignMechanics(rand: () => number, items: LevelItem[], m: NonNullable<GenerateTemplate['mechanics']>, lookup: ItemLookup): void {
  const cands = () => shuffle(rand, items.filter(it => !it.link && !it.linkedTo && !it.locked));
  for (let i = 0; i < (m.linked || 0); i++) {
    const c = cands().filter(it => lookup.defById(it.id).meta.canLink);
    if (c.length >= 2) { c[0].link = c[1].id; c[1].linkedTo = c[0].id; }
  }
  for (let i = 0; i < (m.locked || 0); i++) {
    const c = cands().filter(it => lookup.defById(it.id).meta.canLock);
    if (c.length) c[0].locked = true;
  }
  for (const it of items) delete it.linkedTo;
  // rolling: only what the pool already has; the generator never adds items outside the pool
}

/** Spread items on the tray on a grid with a little jitter (mutates x, y, angle) */
export function layoutTray(rand: () => number, items: LevelItem[]): void {
  const tray = items.filter(it => !it.inBag);
  const cols = tray.length > 12 ? 6 : 5, rowGap = tray.length > 12 ? 62 : 80;
  tray.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    it.x = Math.round(TRAY.x0 + col * ((TRAY.x1 - TRAY.x0) / (cols - 1)) + (rand() - .5) * 14);
    it.y = Math.round(TRAY.y0 + row * rowGap + rand() * 8);
    it.angle = Math.round((rand() - .5) * 1.2 * 100) / 100;
  });
}

export const tierNames: string[] = TIERS.map(t => t.name);
