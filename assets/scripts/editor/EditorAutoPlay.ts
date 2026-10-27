// "Máy chơi thử" of the Level Editor preview (web src/game/autoplay.js, editor use): puts the
// items of the level into the bag one by one, to see whether the level can be solved.
// Uses the level's stored solution when it still matches the items, otherwise the solver's plan.
// Each item is dropped only where it overlaps nothing (the same shape test as dragging); a taken
// spot is searched around, and an item with no spot stays on the tray. The next item waits for the
// previous one to come to rest. Tethered items are skipped (as on the web).
import { GameState } from '../core/GameState';
import { levelToFieldY } from '../core/GameConstants';
import { computeGhost, itemAABB } from '../game/BagRules';
import { wakeAll } from '../game/Settle';
import { validSolution, placementOrder, solve, resolveContainer } from './logic';
import type { ItemLookup, BagSkinMap } from './logic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Step = { i: number; id: number; s: number; x: number; y: number; angle: number };

export class EditorAutoPlay {
  private run = 0;
  get running() { return this.active; }
  private active = false;
  stop() { this.run++; this.active = false; }

  /** Returns how many items went into the bag, and how many had to */
  async play(level: any, lookup: ItemLookup, skins: BagSkinMap, note: (t: string, kind?: '' | 'ok' | 'bad') => void): Promise<{ placed: number; need: number } | null> {
    const my = ++this.run, S = GameState;
    this.active = true;
    const alive = () => my === this.run && !!S.level && !S.lost && !S.won;
    for (let t = 0; !S.bagReady && t < 100; t++) await sleep(100);
    await sleep(500);
    if (!alive()) return null;
    let steps: Step[] | null = validSolution(level) as Step[] | null;
    if (steps) steps = placementOrder(lookup, steps) as Step[];
    else {
      const L = { ...level, container: resolveContainer(level.container, skins) };
      const sol = solve(L, lookup, { tries: 300 });
      steps = sol.plan.map(p => ({ i: level.items.indexOf(p.ref), id: p.id, s: 1, x: p.x, y: p.y, angle: p.angle }));
      if (!sol.solvable) note(`Máy chỉ tìm được chỗ cho ${sol.placedCount}/${sol.needCount} món, vẫn thử xếp`, 'bad');
    }
    let placed = 0;
    for (const st of steps) {
      if (!alive()) { this.active = my === this.run ? false : this.active; return null; }
      const it = S.items[st.i];
      if (!it || !it.node.activeInHierarchy || level.items[st.i]?.link) continue;
      if (this.drop(it, st)) { placed++; await this.rest(it, alive); }
      else await sleep(150);
    }
    if (my === this.run) this.active = false;
    return { placed, need: steps.length };
  }

  /** Put the item at its planned spot, or the closest free spot around it */
  private drop(it: any, st: Step): boolean {
    const S = GameState;
    const x0 = st.x, y0 = levelToFieldY(st.y - S.bagLift), a0 = -st.angle * 180 / Math.PI;
    const old = it.node.position.clone(), oldAngle = it.node.angle;
    const tryAt = (x: number, y: number, a: number) => {
      it.node.setPosition(x, y, 0); it.node.angle = a;
      itemAABB(it);
      return !computeGhost(it);
    };
    if (tryAt(x0, y0, a0)) return this.release(it);
    for (let r = 4; r <= 40; r += 4) {
      for (let k = 0; k < 12; k++) {
        const t = k / 12 * Math.PI * 2;
        if (tryAt(x0 + Math.cos(t) * r, y0 + Math.sin(t) * r + 2, a0)) return this.release(it);
      }
    }
    it.node.setPosition(old); it.node.angle = oldAngle; it.stop();
    return false;
  }
  private release(it: any) { it.stop(); it.body.wakeUp(); wakeAll(); return true; }

  /** Wait until the item stops moving (at most 1.5 s) */
  private async rest(it: any, alive: () => boolean) {
    let still = 0;
    for (let t = 0; t < 1500 && alive(); t += 50) {
      await sleep(50);
      const v = it.body.linearVelocity, w = it.spin;   // rad/s (ItemView.spin: angularVelocity reads in degrees)
      still = Math.hypot(v.x, v.y) < .3 && Math.abs(w) < .3 ? still + 50 : 0;
      if (still >= 250) return;
    }
  }
}
