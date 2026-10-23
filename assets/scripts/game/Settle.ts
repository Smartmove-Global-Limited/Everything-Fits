// Puts a packed cluster of items to sleep once it only twitches in place.
//
// Items wedged tight (against a slanted bag wall and their neighbours, overlapping a little) can
// have no position that satisfies every contact: Box2D's position solver pushes them out of one
// contact, the next step back out of the other, forever. Velocities stay ~0 but every push resets
// the sleep timer, so the island never sleeps and the items shake on screen.
// Here an item that stayed within MOVE units / TURN degrees of the same spot for REST seconds is
// "at rest"; when every item of its cluster (items whose shapes touch, by bounding box) is at rest,
// the whole cluster is put to sleep together (one awake neighbour would wake the island again).
// Box2D wakes them as soon as something touches them, they are picked up or the phone is shaken.
// Engine-agnostic (no Box2D internals): works with the web and the native physics alike.
import { ERigidBody2DType, Rect } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { ItemView, ItemPhysics } from './ItemView';
import { itemAABB } from './BagRules';

// An item rocking around one spot (wedged deeper: the pushes are bigger) must count as resting
// too, so the spot is allowed to wander a little; a real slide or fall goes past it at once.
const MOVE = 2;       // units
const TURN = 4;       // degrees
const REST = .8;      // seconds
const TOUCH = 1.5;    // units between bounding boxes that still count as touching

function eligible(it: ItemView) {
  return !it.waiting && !it.entering && !isHeld(it) && it.node.activeInHierarchy
    && it.body.type === ERigidBody2DType.Dynamic && it.physicsType !== ItemPhysics.FLOAT;
}

const boxes = new Map<ItemView, Rect>();
const cluster: ItemView[] = [];

/** After every physics step (GameController.afterPhysics) */
export function tickSettle(dt: number) {
  const items = GameState.items;
  let candidates = false;
  for (const it of items) {
    if (!eligible(it)) { it.restTime = 0; it.restX = NaN; continue; }
    const p = it.node.position, a = it.node.eulerAngles.z;
    if (Number.isNaN(it.restX) || Math.hypot(p.x - it.restX, p.y - it.restY) > MOVE || Math.abs(a - it.restAngle) > TURN) {
      it.restX = p.x; it.restY = p.y; it.restAngle = a; it.restTime = 0;
    } else {
      it.restTime += dt;
      if (it.restTime >= REST && it.body.isAwake()) candidates = true;
    }
  }
  if (!candidates) return;

  boxes.clear();
  for (const it of items) if (it.node.activeInHierarchy && !it.waiting) boxes.set(it, itemAABB(it).clone());
  const done = new Set<ItemView>();
  for (const seed of items) {
    if (done.has(seed) || seed.restTime < REST || !seed.body.isAwake()) continue;
    // the touching cluster around the seed
    cluster.length = 0; cluster.push(seed); done.add(seed);
    let allAtRest = true;
    for (let i = 0; i < cluster.length; i++) {
      const r = boxes.get(cluster[i])!;
      for (const other of items) {
        if (done.has(other) || !boxes.has(other)) continue;
        const o = boxes.get(other)!;
        if (o.xMin > r.xMax + TOUCH || o.xMax < r.xMin - TOUCH || o.yMin > r.yMax + TOUCH || o.yMax < r.yMin - TOUCH) continue;
        done.add(other);
        if (!eligible(other)) { if (isHeld(other) || other.body.type === ERigidBody2DType.Dynamic) allAtRest = false; continue; }
        if (other.restTime < REST) allAtRest = false;
        cluster.push(other);
      }
    }
    if (!allAtRest) continue;
    for (const it of cluster) { it.stop(); it.body.sleep(); }
  }
}

/**
 * An item left its place (picked up, thrown out, pushed out of the bag, shrunk): the sleeping items
 * it was holding up must fall. Box2D does not wake them when a body leaves the world.
 */
export function wakeAll() {
  for (const it of GameState.items) {
    it.restTime = 0; it.restX = NaN;
    if (it.node.activeInHierarchy && !it.waiting && it.body.type === ERigidBody2DType.Dynamic) it.body.wakeUp();
  }
}
