// Bag rules (ported from the web game, src/game/rules.js): is an item fully inside the bag, does it
// poke into the bag interior, push items that stay stuck in the opening back to the tray, track
// which items are packed, and detect the win.
//
// Item geometry is ItemView.shapes (polygons at the CURRENT node transform, so the held item is
// judged where it is drawn, not where Box2D last saw it); other bodies come from Box2D
// (PolygonCollider2D.worldPoints, testAABB). Nothing here allocates per call.
import { Vec2, Rect, PolygonCollider2D, CircleCollider2D, Intersection2D, PhysicsSystem2D } from 'cc';
import { GameState, isHeld, isOnField } from '../core/GameState';
import { DESIGN_W, TABLE_Y, FLOOR_Y, BAG_WALL, PhysicsGroup, PTM, levelToFieldY } from '../core/GameConstants';
import type { ItemView } from './ItemView';

/** Tolerance when testing "inside the bag": physics lets bodies sink slightly into walls */
const FIT_TOL = 3;
/** Wait after release before judging an item stuck in the opening (ms) */
const WAIT_AFTER_RELEASE = 700;
/** Speeds below these count as resting. Web: units / rad per 1/60 s step → m/s and rad/s here. */
const REST_SPEED = .25 * 60 / PTM, REST_SPIN = .03 * 60;
/** Packed items must have slowed down below this (web .9 units per step), m/s */
const PACKED_SPEED = .9 * 60 / PTM;
/** Frames resting while poking out before the item is pushed back to the tray (~1.2 s) */
const STUCK_FRAMES = 75;
/** Frames needed to count an item as packed / unpacked (debounce) */
const IN_FRAMES = 4, OUT_FRAMES = 18;
/** Frames with everything packed before the round is won */
const WIN_FRAMES = 45;

const tmp = new Vec2();

export type BagEvents = {
  onPacked?(item: ItemView, count: number): void;
  /** a packed item left the bag by itself (fell / was pushed out; not picked up by the player) */
  onUnpacked?(item: ItemView): void;
  onListChanged?(): void;
  onWin?(): void;
  onEjected?(item: ItemView, reason: 'noFit' | 'stuck'): void;
};
let events: BagEvents = {};
export function setBagEvents(e: BagEvents) { events = e; }

/** World bounds of the item at its current transform (the item's own rect, do not keep) */
export function itemAABB(item: ItemView): Rect { item.updateShape(); return item.bounds; }

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

/** Every vertex of the item lies inside the bag interior (with tolerance) */
/** Is the centre of the item's shape inside the bag (also when it pokes out a little)? */
export function centreInBag(item: ItemView): boolean {
  if (!GameState.bag || !GameState.bagReady) return false;
  const r = itemAABB(item);
  return pointInsideBag(r.x + r.width / 2, r.y + r.height / 2);
}

function allVerticesInside(item: ItemView): boolean {
  const polys = item.shapes;
  for (let i = 0; i < polys.length; i++) for (const p of polys[i]) if (!pointInsideBag(p.x, p.y)) return false;
  return true;
}

/**
 * An item that appears inside the bag (a mystery box opening into a bigger item) may poke through a
 * wall, and Box2D then pushes it out through the wall. Move it the least distance (up, or sideways)
 * so that its whole shape lies in the interior; other items it overlaps are left to the physics,
 * which pushes them aside. Returns false (item not moved) when no such place is near.
 */
export function moveInsideBag(item: ItemView): boolean {
  if (!GameState.bag || allVerticesInside(item)) return true;
  const p = item.node.position, x0 = p.x, y0 = p.y;
  for (let r = 4; r <= 160; r += 4) {
    // up first (the bag is open upwards), then up and to the sides
    for (const [dx, dy] of [[0, r], [-r / 2, r], [r / 2, r], [-r, r / 2], [r, r / 2], [-r, 0], [r, 0]]) {
      item.node.setPosition(x0 + dx, y0 + dy, 0);
      if (allVerticesInside(item)) return true;
    }
  }
  item.node.setPosition(x0, y0, 0);
  return false;
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
  const polys = item.shapes;
  for (let i = 0; i < polys.length; i++) {
    const pts = polys[i];
    for (const p of pts) if (Intersection2D.pointInPolygon(p, bag.interiorWorld)) return true;
    for (const v of bag.interiorWorld) if (Intersection2D.pointInPolygon(v, pts)) return true;
  }
  return false;
}

// ---- overlap with a tolerance (web: depth > 0.5 against items, > 2.5 against walls) ----
// The held polygons are shrunk toward their centre by the tolerance, then tested for any
// intersection: a touch or a sliver of overlap is allowed, a real overlap is not.
const ITEM_TOL = .5, WALL_TOL = 2.5;
const shrunk: Vec2[][] = [];
const centre = new Vec2();
function shrinkInto(src: Vec2[], dst: Vec2[], d: number) {
  centre.set(0, 0);
  for (const p of src) { centre.x += p.x; centre.y += p.y; }
  centre.x /= src.length; centre.y /= src.length;
  while (dst.length < src.length) dst.push(new Vec2());
  dst.length = src.length;
  for (let i = 0; i < src.length; i++) {
    const p = src[i], dx = centre.x - p.x, dy = centre.y - p.y, l = Math.sqrt(dx * dx + dy * dy);
    const k = l > d ? d / l : 0;
    dst[i].set(p.x + dx * k, p.y + dy * k);
  }
}
const circleCentre = new Vec2();

function overlapsCollider(polys: Vec2[][], other: PolygonCollider2D | CircleCollider2D, tol: number): boolean {
  for (let i = 0; i < polys.length; i++) {
    if (!shrunk[i]) shrunk[i] = [];
    shrinkInto(polys[i], shrunk[i], tol);
    if (other instanceof PolygonCollider2D) {
      if (Intersection2D.polygonPolygon(shrunk[i], other.worldPoints as Vec2[])) return true;
    } else {
      circleCentre.set(other.worldPosition.x, other.worldPosition.y);
      if (Intersection2D.polygonCircle(shrunk[i], circleCentre, other.worldRadius)) return true;
    }
  }
  return false;
}

/**
 * Held item shows as a "ghost" (red outline, will bounce back) when it pokes into the bag without
 * fitting, or overlaps another item / an obstacle. Touching the bag walls from OUTSIDE is fine
 * (resting next to the bag, on the rim, in its shadow). Tray floor and screen sides are not tested:
 * the drag keeps the item inside them.
 */
export function computeGhost(item: ItemView): boolean {
  const z = bagZone(item);
  const poke = z.inZone && overlapsInterior(item);
  if (poke && !z.fullyInside) return true;
  const polys = item.shapes;
  const hits = PhysicsSystem2D.instance.testAABB(item.bounds);
  for (let i = 0; i < hits.length; i++) {
    const c = hits[i];
    if (c.node === item.node || c.sensor) continue;
    const g = c.group;
    if (g === PhysicsGroup.WALL || g === PhysicsGroup.CEILING) continue;
    if (g === PhysicsGroup.BAG && !poke) continue;
    if (!(c instanceof PolygonCollider2D) && !(c instanceof CircleCollider2D)) continue;
    if (overlapsCollider(polys, c, g === PhysicsGroup.BAG ? WALL_TOL : ITEM_TOL)) return true;
  }
  return false;
}

/**
 * Spots handed out during the current batch of teleports. A moved body only follows its node at
 * the next physics step, so testAABB cannot see it yet: without this list two items moved in the
 * same frame can land on the same spot, deeply overlapped (Box2D then pushes them back and forth).
 */
const claimed: Rect[] = [];
let claimedCount = 0;
const probe = new Rect();
const spot = { x: 0, y: 0 };

/** Start a batch of findFreeSpot calls whose results must not overlap each other */
export function beginSpotBatch() { claimedCount = 0; }

function isClaimed(r: Rect) {
  for (let i = 0; i < claimedCount; i++) if (claimed[i].intersects(r)) return true;
  return false;
}
/** Is the box centred on (cx, cy) free of other bodies and of spots handed out in this batch? (leaves it in probe) */
function isFree(item: ItemView, cx: number, cy: number, hw: number, hh: number): boolean {
  probe.set(cx - hw, cy - hh, hw * 2, hh * 2);
  if (isClaimed(probe)) return false;
  const hits = PhysicsSystem2D.instance.testAABB(probe);
  for (let i = 0; i < hits.length; i++) if (hits[i].node !== item.node) return false;
  return true;
}
function claim(r: Rect) {
  if (claimedCount === claimed.length) claimed.push(new Rect());
  claimed[claimedCount++].set(r);
}

/**
 * A free spot on the tray close to x (Field space). Tries near the old position first, then widens,
 * so the player's eye can follow the item. Uses PhysicsSystem2D.testAABB against the item box, plus
 * the spots already handed out in this batch. Returns a shared object (copy it if kept).
 */
export function findFreeSpot(item: ItemView, nearX: number): { x: number; y: number } {
  const r = itemAABB(item);
  const hw = r.width / 2, hh = r.height / 2;
  const ox = item.node.position.x - r.center.x, oy = item.node.position.y - r.center.y;   // origin offset from box center
  const minX = 20 + hw, maxX = Math.max(minX, DESIGN_W - 20 - hw);
  const topY = levelToFieldY(TABLE_Y + 10), bottomY = levelToFieldY(FLOOR_Y + GameState.floorDrop);
  // highest an item may go: just under the bag (with its walls), the pile may rise above the table edge
  const bag = GameState.bag;
  const ceil = bag ? bag.minY - BAG_WALL - 2 : topY + 60;
  const lowY = bottomY + hh + 2;
  for (let t = 0; t < 90; t++) {
    const spread = 46 + (t / 90) * DESIGN_W;
    const cx = Math.max(minX, Math.min(maxX, nearX + (Math.random() - .5) * 2 * spread));
    // first on the table itself, then anywhere up to the bag bottom
    const highY = Math.max(lowY, (t < 45 ? topY : ceil) - hh);
    const cy = lowY + Math.random() * (highY - lowY);
    if (isFree(item, cx, cy, hw, hh)) { claim(probe); spot.x = cx + ox; spot.y = cy + oy; return spot; }
  }
  // nothing free: lowest free height in a few columns, never above the bag bottom
  const highY = Math.max(lowY, ceil - hh);
  for (let k = 0; k < 7; k++) {
    const cx = Math.max(minX, Math.min(maxX, nearX + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * hw)));
    for (let cy = lowY; cy <= highY; cy += 6) {
      if (isFree(item, cx, cy, hw, hh)) { claim(probe); spot.x = cx + ox; spot.y = cy + oy; return spot; }
    }
  }
  const cx = Math.max(minX, Math.min(maxX, nearX));
  probe.set(cx - hw, highY - hh, hw * 2, hh * 2);
  claim(probe);
  spot.x = cx + ox; spot.y = highY + oy;
  return spot;
}

/**
 * Items to move back onto the tray. Teleports are queued and applied by applyEjects() from the game
 * loop's update(), i.e. BEFORE the next physics step: Cocos pushes node transforms into Box2D only
 * then, a node moved after the step (EVENT_AFTER_PHYSICS) is snapped back to its body next frame.
 */
const pendingEjects: { item: ItemView; reason: 'noFit' | 'stuck' }[] = [];

/** Queue an item that does not fit to go back onto the tray */
export function eject(item: ItemView, reason: 'noFit' | 'stuck') {
  if (isHeld(item)) return;
  item.stuckFrames = 0;
  for (const e of pendingEjects) if (e.item === item) return;
  pendingEjects.push({ item, reason });
}

/** Called from update(), before the physics step */
export function applyEjects() {
  if (!pendingEjects.length) return;
  beginSpotBatch();
  for (let i = 0; i < pendingEjects.length; i++) {
    const { item, reason } = pendingEjects[i];
    if (isHeld(item) || !item.node.active) continue;
    const spot = findFreeSpot(item, item.node.position.x);
    item.node.setPosition(spot.x, spot.y, 0);
    item.stop(); item.body.wakeUp();
    events.onEjected?.(item, reason);
  }
  pendingEjects.length = 0;
}

export function clearEjects() { pendingEjects.length = 0; }

/** Does the item touch the bag area (interior plus walls)? Used when the bag appears. */
export function overlapsBagArea(item: ItemView): boolean {
  const bag = GameState.bag;
  if (!bag) return false;
  const r = itemAABB(item), m = BAG_WALL + 2;
  return r.xMax > bag.minX - m && r.xMin < bag.maxX + m && r.yMax > bag.minY - m && r.yMin < bag.maxY + m;
}

/** After each physics step: push out items stuck half-in the opening */
export function checkEject(now: number) {
  for (const it of GameState.items) {
    if (!isOnField(it) || isHeld(it) || it.isStatic) continue;
    if (it.releasedAt > now - WAIT_AFTER_RELEASE) { it.stuckFrames = 0; continue; }
    const z = bagZone(it);
    const v = it.body.linearVelocity;
    const resting = v.x * v.x + v.y * v.y < REST_SPEED * REST_SPEED && Math.abs(it.spin) < REST_SPIN;
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
    const slow = v.x * v.x + v.y * v.y < PACKED_SPEED * PACKED_SPEED || it.isStatic;
    const ok = was ? it.outsideFrames < OUT_FRAMES : inside && it.insideFrames >= IN_FRAMES && slow;
    if (ok !== was) {
      if (ok) { S.packed.add(it.levelIndex); events.onPacked?.(it, S.packed.size); }
      else { S.packed.delete(it.levelIndex); if (!outOfPlay) events.onUnpacked?.(it); }
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
