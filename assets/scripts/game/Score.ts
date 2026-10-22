// Scoring a won round (web src/game/score.js chamDiem):
//   packing tightness 50 · time 25 · boosters saved 10 · packed the right way 15 → 0..100,
//   five stars in half steps (at least one). The level's best packing (web: solver) is taken
//   as 0.88 tightness until solutions are scored here too.
import { Vec2, Intersection2D } from 'cc';
import { GameState } from '../core/GameState';
import { DEFAULT_BOOSTS, Boosters, BOOSTER_KEYS } from '../services/Boosters';
import type { ItemView } from './ItemView';

const CELL = 4;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const p = new Vec2();

/** Grid scan of the bag: cells inside, cells taken by items, cells under the top of the pile */
function scanBag() {
  const S = GameState, bag = S.bag!;
  const items = S.items.filter(it => !it.waiting);
  let inside = 0, taken = 0, spread = 0;
  for (let x = bag.minX; x <= bag.maxX; x += CELL) {
    let topCell = -1, cells = 0, full = 0;
    for (let y = bag.maxY; y >= bag.minY; y -= CELL) {          // top → bottom
      p.set(x, y);
      if (!Intersection2D.pointInPolygon(p, bag.interiorWorld)) continue;
      let hit = false;
      for (let i = 0; !hit && i < items.length; i++) for (const poly of items[i].shapes) if (Intersection2D.pointInPolygon(p, poly)) { hit = true; break; }
      if (hit) { full++; if (topCell < 0) topCell = cells; }
      cells++;
    }
    inside += cells; taken += full;
    if (topCell >= 0) spread += cells - topCell;
  }
  return { inside, taken, tight: spread > 0 ? taken / spread : 0 };
}

/** Heavy on light / anything on fragile, like the web loiXep (y up here) */
export function packingMistakes(): string[] {
  const list = GameState.items.filter(it => !it.waiting && it.itemId > 0);
  const out: string[] = [];
  for (const A of list) for (const B of list) {
    if (A === B || A.node.position.y <= B.node.position.y) continue;
    A.updateShape(); B.updateShape();
    const a = A.bounds, b = B.bounds;
    if (a.yMin > b.yMax + 6 || a.yMin < b.yMax - 14) continue;
    const overlap = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
    if (overlap < Math.min(a.width, b.width) * .3) continue;
    const name = (it: ItemView) => it.nameEn || it.nameVi;
    if (B.fragile && A.grams >= 300) out.push(`${name(A)} on fragile ${name(B)}`);
    else if (A.grams >= 500 && B.grams < 120) out.push(`${name(A)} on top of ${name(B)}`);
  }
  return out;
}

export function scoreRound() {
  const S = GameState;
  const scan = scanBag();
  const best = .88;
  const tight = clamp((clamp(scan.tight / best) - .65) / (1 - .65));
  const total = S.level?.timer || 0;
  const left = Math.max(0, Math.ceil(S.timeLeft / 1000));
  const used = Math.max(0, total - left);
  const time = clamp((1 - (total > 0 ? used / total : 1)) / .5);
  const given = BOOSTER_KEYS.reduce((s, k) => s + DEFAULT_BOOSTS[k], 0);
  const kept = BOOSTER_KEYS.reduce((s, k) => s + Boosters.count(k), 0);
  const saved = given > 0 ? clamp(kept / given) : 1;
  const mistakes = packingMistakes();
  const rightWay = mistakes.length === 0 ? 1 : mistakes.length === 1 ? .5 : 0;
  const points = Math.round(tight * 50 + time * 25 + saved * 10 + rightWay * 15);
  const stars = Math.max(1, Math.round(points / 100 * 5 * 2) / 2);
  return { points, stars, secondsUsed: used, mistakes };
}
