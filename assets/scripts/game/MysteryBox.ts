// Mystery box + key (web mechanics.js checkUnlock; GDD: the key lies in the bag from the start).
// A level item with "locked" shows as the mystery box (item -1). The key (item 0) is fixed in the bag
// (static body, cannot be picked up). Only a box let go of opens: dropped into the bag, it falls or
// rolls against the key, then the key goes away and the box becomes the item it hid, right there, as
// a normal body: a bigger item pushes its neighbours aside (LevelBuilder.openBox).
// Dragging the box over the key does nothing. The box cannot count as packed while locked
// (BagRules.updatePacked); the key is never packed.
import { Vec2, Intersection2D } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import type { ItemView } from './ItemView';

export const KEY_ID = 0;
export const MYSTERY_ID = -1;
const TOUCH = 2.5;   // units: shapes this close count as touching (a box resting against the key)

export type MysteryEvents = {
  /** the player picked up a mystery box for the first time this round */
  onHint?(): void;
  /** a released box touched the key: open it */
  open?(box: ItemView, key: ItemView): void;
};
let events: MysteryEvents = {};
let hinted = false;
export function setMysteryEvents(e: MysteryEvents) { events = e; }
export function resetMystery() { hinted = false; }

/** Every frame after the physics step: a box touching the key opens */
export function tickMystery() {
  const S = GameState;
  let key: ItemView | null = null, anyBox = false;
  for (const it of S.items) {
    if (it.itemId === KEY_ID && !it.waiting) key = it;
    else if (it.locked) anyBox = true;
  }
  if (!key || !anyBox || key.waiting) return;
  for (const box of S.items) {
    if (!box.locked || box.waiting) continue;
    if (isHeld(box)) { if (!hinted) { hinted = true; events.onHint?.(); } continue; }
    if (touching(box, key)) { events.open?.(box, key); return; }
  }
}

function touching(a: ItemView, b: ItemView) {
  const pa = a.shapes, pb = b.shapes, ra = a.bounds, rb = b.bounds;
  if (ra.xMax + TOUCH < rb.xMin || rb.xMax + TOUCH < ra.xMin || ra.yMax + TOUCH < rb.yMin || rb.yMax + TOUCH < ra.yMin) return false;
  for (const p of pa) for (const q of pb) {
    if (Intersection2D.polygonPolygon(p, q)) return true;
    if (near(p, q) || near(q, p)) return true;
  }
  return false;
}
/** a vertex of `p` within TOUCH of an edge of `q` */
function near(p: Vec2[], q: Vec2[]) {
  for (const v of p) for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (Intersection2D.pointLineDistance(v, q[j], q[i], true) <= TOUCH) return true;
  }
  return false;
}
