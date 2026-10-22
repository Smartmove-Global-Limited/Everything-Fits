// Bag rules (ported from the web game, src/game/rules.js): is an item fully inside the bag, does it
// poke into the bag interior, push items that stay stuck in the opening back to the tray, track
// which items are packed, and detect the win.
//
// Geometry comes straight from Cocos: Collider2D.worldAABB, PolygonCollider2D.worldPoints and
// Intersection2D. Nothing here allocates per call (shared scratch objects only).
import { Vec2, Rect, PolygonCollider2D, CircleCollider2D, Intersection2D, PhysicsSystem2D, Collider2D } from 'cc';
import { GameState, isHeld, isOnField } from '../core/GameState';
import { DESIGN_W, TABLE_Y, FLOOR_Y, BAG_WALL, levelToFieldY } from '../core/GameConstants';
import type { ItemView } from './ItemView';

/** Tolerance when testing "inside the bag": physics lets bodies sink slightly into walls */
const FIT_TOL = 3;
/** Wait after release before judging an item stuck in the opening (ms) */
const WAIT_AFTER_RELEASE = 700;
/** Speeds below these count as resting. Web values were per 1/60 s step; here per second. */
const REST_SPEED = .25 * 60, REST_SPIN = .03 * 60;
/** Frames resting while poking out before the item is pushed back to the tray (~1.2 s) */
const STUCK_FRAMES = 75;
/** Frames needed to count an item as packed / unpacked (debounce) */
const IN_FRAMES = 4, OUT_FRAMES = 18;
/** Frames with everything packed before the round is won */
const WIN_FRAMES = 45;

const tmp = new Vec2();
const aabb = new Rect();

export type BagEvents = {
  onPacked?(item: ItemView, count: number): void;
  onListChanged?(): void;
  onWin?(): void;
  onEjected?(item: ItemView, reason: 'noFit' | 'stuck'): void;
};
let events: BagEvents = {};
export function setBagEvents(e: BagEvents) { events = e; }

/** World AABB of all the item colliders (shared rect, valid until the next call) */
export function itemAABB(item: ItemView): Rect {
  let first = true;
  for (const c of item.colliders) {
    const r = c.worldAABB;
    if (first) { aabb.set(r); first = false; } else Rect.union(aabb, aabb, r);
  }
  return aabb;
}

function pointInsideBag(x: number, y: number): boolean {
  const bag = GameState.bag!;
  tmp.set(x, y);
  if (Intersection2D.pointInPolygon(tmp, bag.interiorWorld)) return true;
  // tolerance: close enough to an edge counts as inside
  const poly = bag.interiorWorld;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = a.x + dx * t - x, ey = a.y + dy * t - y;
    if (ex * ex + ey * ey <= FIT_TOL * FIT_TOL) return true;
  }
  return false;
}

/** Every vertex of every collider lies inside the bag interior (with tolerance) */
function allVerticesInside(item: ItemView): boolean {
  for (const c of item.colliders) {
    if (c instanceof PolygonCollider2D) {
      for (const p of c.worldPoints) if (!pointInsideBag(p.x, p.y)) return false;
    } else if (c instanceof CircleCollider2D) {
      const p = c.worldPosition, r = c.worldRadius;
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; if (!pointInsideBag(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r)) return false; }
    }
  }
  return true;
}

/** inZone: touching the area around the bag. fullyInside: lying fully inside the interior. */
export function bagZone(item: ItemView) {
  const bag = GameState.bag;
  if (!bag || !GameState.bagReady) return ZONE_OUT;
  const r = itemAABB(item);
  const inZone = r.xMax > bag.minX - BAG_WALL && r.xMin < bag.maxX + BAG_WALL && r.yMin < bag.maxY + 14 && r.yMax > bag.minY - BAG_WALL + 2;
  const fullyInside = inZone && r.yMax <= bag.maxY + FIT_TOL && allVerticesInside(item);
  ZONE.inZone = inZone; ZONE.fullyInside = fullyInside;
  return ZONE;
}
const ZONE = { inZone: false, fullyInside: false };
const ZONE_OUT = { inZone: false, fullyInside: false };

/** Does any part of the item poke into the bag interior (or does the interior poke into the item) */
export function overlapsInterior(item: ItemView): boolean {
  const bag = GameState.bag;
  if (!bag || !GameState.bagReady) return false;
  for (const c of item.colliders) {
    if (c instanceof PolygonCollider2D) {
      const pts = c.worldPoints as Vec2[];
      for (const p of pts) if (Intersection2D.pointInPolygon(p, bag.interiorWorld)) return true;
      for (const v of bag.interiorWorld) if (Intersection2D.pointInPolygon(v, pts)) return true;
    } else if (c instanceof CircleCollider2D) {
      if (Intersection2D.pointInPolygon(c.worldPosition as unknown as Vec2, bag.interiorWorld)) return true;
    }
  }
  return false;
}

/**
 * Held item shows as a "ghost" (red, will bounce back) when it pokes into the bag without fitting,
 * or overlaps another item / wall. Touching the bag walls from OUTSIDE is fine (resting next to the
 * bag, on the rim, in its shadow).
 */
export function computeGhost(item: ItemView): boolean {
  const z = bagZone(item);
  const poke = z.inZone && overlapsInterior(item);
  if (poke && !z.fullyInside) return true;
  if (item.heldItemContacts > 0 || item.heldWallContacts > 0) return true;
  if (poke && item.heldBagContacts > 0) return true;
  return false;
}

/**
 * A free spot on the tray close to x (Field space). Tries near the old position first, then widens,
 * so the player's eye can follow the item. Uses PhysicsSystem2D.testAABB against the item box.
 */
export function findFreeSpot(item: ItemView, nearX: number): { x: number; y: number } {
  const r = itemAABB(item);
  const hw = r.width / 2, hh = r.height / 2;
  const ox = item.node.position.x - r.center.x, oy = item.node.position.y - r.center.y;   // origin offset from box center
  const minX = 20 + hw, maxX = Math.max(minX, DESIGN_W - 20 - hw);
  const topY = levelToFieldY(TABLE_Y + 10), bottomY = levelToFieldY(FLOOR_Y);
  const probe = new Rect();
  for (let t = 0; t < 40; t++) {
    const spread = 46 + (t / 40) * DESIGN_W;
    const cx = Math.max(minX, Math.min(maxX, nearX + (Math.random() - .5) * 2 * spread));
    const cy = bottomY + hh + 2 + Math.random() * Math.max(4, topY - bottomY - hh * 2);
    probe.set(cx - hw, cy - hh, hw * 2, hh * 2);
    const hits = PhysicsSystem2D.instance.testAABB(probe);
    if (!hits.some((c: Collider2D) => c.node !== item.node)) return { x: cx + ox, y: cy + oy };
  }
  return { x: DESIGN_W / 2 + ox, y: bottomY + hh + 10 + oy };
}

/** Move an item that does not fit back onto the tray */
export function eject(item: ItemView, reason: 'noFit' | 'stuck') {
  if (isHeld(item)) return;
  const spot = findFreeSpot(item, item.node.position.x);
  item.node.setPosition(spot.x, spot.y, 0);
  item.stop(); item.body.wakeUp();
  item.stuckFrames = 0;
  events.onEjected?.(item, reason);
}

/** After each physics step: push out items stuck half-in the opening */
export function checkEject(now: number) {
  for (const it of GameState.items) {
    if (!isOnField(it) || isHeld(it) || it.isStatic) continue;
    if (it.releasedAt > now - WAIT_AFTER_RELEASE) { it.stuckFrames = 0; continue; }
    const z = bagZone(it);
    const v = it.body.linearVelocity;
    const resting = v.x * v.x + v.y * v.y < REST_SPEED * REST_SPEED && Math.abs(it.body.angularVelocity) < REST_SPIN;
    if (z.inZone && !z.fullyInside && resting && overlapsInterior(it)) {
      if (++it.stuckFrames > STUCK_FRAMES) eject(it, 'stuck');
    } else it.stuckFrames = 0;
  }
}

/** Update the packed list and detect the win */
export function updatePacked(now: number) {
  const S = GameState;
  let changed = false;
  for (const it of S.items) {
    if (it.itemId === 0 || it.waiting) continue;               // the key is a tool, not an item to pack
    const was = S.packed.has(it.levelIndex);
    const outOfPlay = isHeld(it) || it.locked;
    const inside = !outOfPlay && bagZone(it).fullyInside;
    if (outOfPlay) { it.insideFrames = 0; it.outsideFrames = OUT_FRAMES; }
    else { it.insideFrames = inside ? it.insideFrames + 1 : 0; it.outsideFrames = inside ? 0 : it.outsideFrames + 1; }
    const v = it.body.linearVelocity;
    const slow = v.x * v.x + v.y * v.y < (.9 * 60) * (.9 * 60) || it.isStatic;
    const ok = was ? it.outsideFrames < OUT_FRAMES : inside && it.insideFrames >= IN_FRAMES && slow;
    if (ok !== was) {
      if (ok) { S.packed.add(it.levelIndex); events.onPacked?.(it, S.packed.size); }
      else S.packed.delete(it.levelIndex);
      changed = true;
    }
  }
  for (const id of S.removed) if (!S.packed.has(id)) { S.packed.add(id); changed = true; }
  if (changed) events.onListChanged?.();

  const toPack = S.itemsToPack;
  if (S.packed.size >= toPack && toPack > 0 && !S.drag && !S.lost) {
    if (++S.winFrames > WIN_FRAMES && !S.won) { S.won = true; events.onWin?.(); }
  } else S.winFrames = 0;
}
