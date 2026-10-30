// "Máy chơi thử" of the Level Editor preview (web src/game/autoplay.js, editor use): puts the
// items of the level into the bag one by one, to see whether the level can be solved.
// Uses the level's stored solution when it still matches the items, otherwise the solver's plan.
// A stored solution whose item no longer fits (art or collider changed) is dropped at that item:
// the items left are planned again around what is already in the bag.
// Each item is dropped only where it overlaps nothing (the same shape test as dragging); a taken
// spot is searched around, and an item with no spot stays on the tray. The next item waits for the
// previous one to come to rest. Both items of a tied pair, mystery boxes and the key are skipped
// (as on the web).
import { GameState } from '../core/GameState';
import { levelToFieldY } from '../core/GameConstants';
import { bagZone, computeGhost, itemAABB } from '../game/BagRules';
import { wakeAll } from '../game/Settle';
import { angleOf } from '../game/DragController';
import { validSolution, placementOrder, solve, resolveContainer } from './logic';
import type { ItemLookup, BagSkinMap } from './logic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Step = { i: number; id: number; s: number; x: number; y: number; angle: number };

export class EditorAutoPlay {
  private run = 0;
  get running() { return this.active; }
  private active = false;
  stop() { this.run++; this.active = false; }

  /** The solver's seed and cell test: another seed or a stricter test packs the bag another way (the page retries with a few) */
  private seed = 1;
  private mask: 'center' | 'inner' = 'center';

  /**
   * Returns how many items are in the bag, and how many had to. `seed` > 1: a retry, the solver's
   * plan only. `mask` 'inner': the solver tests 5 points of each cell instead of its centre (plans
   * a little looser, closer to the real shapes).
   */
  async play(level: any, lookup: ItemLookup, skins: BagSkinMap, note: (t: string, kind?: '' | 'ok' | 'bad') => void, seed = 1, mask: 'center' | 'inner' = 'center'): Promise<{ placed: number; need: number } | null> {
    this.seed = seed; this.mask = mask;
    const my = ++this.run, S = GameState;
    this.active = true;
    const alive = () => my === this.run && !!S.level && !S.lost && !S.won;
    for (let t = 0; !S.bagReady && t < 100; t++) await sleep(100);
    await sleep(500);
    if (!alive()) return null;
    const stored = seed > 1 || mask !== 'center' ? null : validSolution(level) as Step[] | null;
    let steps: Step[] = stored ? placementOrder(lookup, stored) as Step[] : this.plan(level, lookup, skins, note);
    const toPlace = () => S.items.filter(v => v.node.activeInHierarchy && !v.partner && !v.locked && v.itemId !== 0 && !level.items[v.levelIndex]?.inBag);
    const need = toPlace().length;
    let replans = 0;
    for (let k = 0; k < steps.length; k++) {
      if (!alive()) { this.active = my === this.run ? false : this.active; return null; }
      const st = steps[k];
      const it = S.items.find(v => v.levelIndex === st.i);
      if (!it || !it.node.activeInHierarchy || it.partner || it.locked || it.itemId === 0) continue;
      if (this.drop(it, st)) { await this.rest(it, alive); continue; }
      // no room at its planned spot: the stored solution no longer fits (items changed shape or
      // size), or the items before it settled a little off their plan. Plan the items left around
      // what is already in the bag (a few times at most)
      if (replans < 3) {
        replans++;
        if (stored && replans === 1) note('Lời giải lưu sẵn không còn vừa, máy tính lời giải mới cho các món còn lại', 'bad');
        steps = steps.slice(0, k).concat(this.plan(level, lookup, skins, note, true));
        k--;
        continue;
      }
      await sleep(150);
    }
    // items the plan left out or could not place: the lowest free spot anywhere in the bag
    for (const it of toPlace()) {
      if (!alive()) { this.active = my === this.run ? false : this.active; return null; }
      if (bagZone(it).fullyInside) continue;
      if (this.dropAnywhere(it)) await this.rest(it, alive);
    }
    if (my === this.run) this.active = false;
    return { placed: toPlace().filter(v => bagZone(v).fullyInside).length, need };
  }

  /** The lowest spot inside the bag where the item overlaps nothing, any angle in 15° steps */
  private dropAnywhere(it: any): boolean {
    const bag = GameState.bag; if (!bag) return false;
    const old = it.node.position.clone(), oldRotation = it.node.rotation.clone();
    let best: { x: number; y: number; a: number } | null = null;
    for (let a = -165; a <= 180; a += 15) {
      for (let x = bag.minX; x <= bag.maxX; x += 5) {
        for (let y = bag.minY; y <= bag.maxY && (!best || y < best.y); y += 4) {
          it.node.setPosition(x, y, 0); it.node.angle = a; itemAABB(it);
          if (bagZone(it).fullyInside && !computeGhost(it)) { best = { x, y, a }; break; }
        }
      }
    }
    if (!best) { it.node.setPosition(old); it.node.setRotation(oldRotation); itemAABB(it); return false; }
    it.node.setPosition(best.x, best.y + 1, 0); it.node.angle = best.a; itemAABB(it);
    return this.release(it);
  }

  /**
   * The solver's plan, lowest first. `aroundPlaced`: items already in the bag stay where they
   * are (passed to the solver as inBag at their current spot); only the others are planned.
   */
  private plan(level: any, lookup: ItemLookup, skins: BagSkinMap, note: (t: string, kind?: '' | 'ok' | 'bad') => void, aroundPlaced = false): Step[] {
    const S = GameState;
    // each item carries its index as `ref`: the solver hands it back on every plan step
    const items = level.items.map((it: any, i: number) => {
      const v = aroundPlaced ? S.items.find(x => x.levelIndex === i) : null;
      if (!v || it.inBag || !bagZone(v).fullyInside) return { ...it, ref: i };
      const p = v.node.position;
      return { ...it, ref: i, inBag: true, x: p.x, y: levelToFieldY(p.y) + S.bagLift, angle: -angleOf(v.node) * Math.PI / 180 };
    });
    // the default budget (250 ms) often stops before a plan with every item: give it a few seconds
    const sol = solve({ ...level, container: resolveContainer(level.container, skins), items }, lookup, { tries: 2000, budgetMs: 4000, seed: this.seed, mask: this.mask });
    if (!sol.solvable) note(`Máy chỉ tìm được chỗ cho ${sol.placedCount}/${sol.needCount} món, vẫn thử xếp`, 'bad');
    return placementOrder(lookup, sol.plan.map(p => ({ i: p.ref as number, id: p.id, s: 1, x: p.x, y: p.y, angle: p.angle }))) as Step[];
  }

  /** Put the item at its planned spot, or the closest free spot around it */
  private drop(it: any, st: Step): boolean {
    const S = GameState;
    const x0 = st.x, y0 = levelToFieldY(st.y - S.bagLift), a0 = -st.angle * 180 / Math.PI;
    const old = it.node.position.clone(), oldRotation = it.node.rotation.clone();
    // a spot counts only fully inside the bag (computeGhost alone also passes a spot outside it)
    const tryAt = (x: number, y: number, a: number) => {
      it.node.setPosition(x, y, 0); it.node.angle = a;
      itemAABB(it);
      return bagZone(it).fullyInside && !computeGhost(it);
    };
    if (tryAt(x0, y0, a0)) return this.release(it);
    for (let r = 4; r <= 40; r += 4) {
      for (let k = 0; k < 12; k++) {
        const t = k / 12 * Math.PI * 2;
        if (tryAt(x0 + Math.cos(t) * r, y0 + Math.sin(t) * r + 2, a0)) return this.release(it);
      }
    }
    it.node.setPosition(old); it.node.setRotation(oldRotation); itemAABB(it); it.stop();
    return false;
  }
  /** The body follows the node to its new spot (else the next physics step puts the node back on the tray) */
  private release(it: any) {
    const impl = it.body.impl;
    impl?.syncPositionToPhysics?.(true); impl?.syncRotationToPhysics?.(true);
    it.stop(); it.releasedAt = GameState.clock;   // like a drop: no eject check right away
    it.body.wakeUp(); wakeAll();
    return true;
  }

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
