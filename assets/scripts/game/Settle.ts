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
import { PTM } from '../core/GameConstants';

// An item rocking around one spot (wedged deeper: the pushes are bigger) must count as resting
// too, so the spot is allowed to wander a little; a real slide or fall goes past it at once.
const MOVE = 2;       // units
const TURN = 4;       // degrees
const REST = .8;      // seconds
const TOUCH = 1.5;    // units between bounding boxes that still count as touching
// Items that cannot stand on their end in real life (a ruler, a pencil, a toothbrush…): set upright
// they fall over. A real one stands on an edge a few millimetres wide, so the least tilt and gravity
// brings it down: slowly at first, then faster (an inverted pendulum). Its collider is much thicker
// than the drawing (a flat end ~20 units wide) and Box2D has no tiny disturbances, so dropped upright
// it stood like a block. While one stands on end after being dropped, gravity's toppling about a
// thin edge is added to its spin each step (no push from outside); leaning on a neighbour it rests
// there. Boxes, bottles, tubes with a flat cap… stand like any other item (not in this list).
const FALLS_ON_END = new Set([
  27, 28, 33,          // ruler, pencil, toothbrush
  22, 34, 44, 63, 67,  // folded umbrella, toothpaste, sunglasses, keyboard, pasta pack
  72, 80, 91, 99,      // wristwatch, screwdriver, food thermometer, baguette
  116, 158, 196,       // tick remover, electrolyte sachet, bottle brush
]);
const UPRIGHT_COS = Math.cos(22 * Math.PI / 180);   // long axis within 22° of vertical
const TOPPLE_MS = 2500;                    // ms after the drop / the turn the toppling is added
const SLOW = 2;                            // m/s: faster than this it is still falling / flying (no toppling in the air)
const G_UNITS = 34.375 * PTM;              // game gravity in units/s² (Project Settings → Physics)

function eligible(it: ItemView) {
  return !it.waiting && !it.entering && !isHeld(it) && !it.turning && it.node.activeInHierarchy
    && it.body.type === ERigidBody2DType.Dynamic && it.physicsType !== ItemPhysics.FLOAT;
}

const boxes = new Map<ItemView, Rect>();
const cluster: ItemView[] = [];

/** After every physics step (GameController.afterPhysics) */
export function tickSettle(dt: number) {
  topple(dt);
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
 * Inverted pendulum about a thin edge: angular acceleration (3g / 2L)·(tilt + 3·thickness / L), the
 * second term outweighing what the collider's flat end holds up (as if the base were thin). Exactly
 * upright it picks a side, as a real one would.
 */
function topple(dt: number) {
  const S = GameState;
  for (const it of S.items) {
    // after a drop, or after its angle stopped being held (turned with the rotate button)
    const since = Math.max(it.releasedAt, it.spunAt);
    if (!FALLS_ON_END.has(it.itemId) || it.holdUntil || !since || S.clock - since > TOPPLE_MS || !eligible(it)) continue;
    const v = it.body.linearVelocity;
    if (v.x * v.x + v.y * v.y > SLOW * SLOW) continue;
    const q = it.node.rotation, a = 2 * Math.atan2(q.z, q.w) + it.slimAxis;   // node angle from the quaternion (see DragController angleOf)
    let ux = Math.cos(a), uy = Math.sin(a);
    if (uy < 0) { ux = -ux; uy = -uy; }                                      // axis pointing up
    if (uy < UPRIGHT_COS) continue;
    const len = it.slimLength * it.levelScale;
    if (!it.toppleSide || Math.abs(ux) > .01) it.toppleSide = Math.abs(ux) > .01 ? Math.sign(ux) : (Math.random() < .5 ? -1 : 1);
    const tilt = Math.asin(Math.min(1, Math.abs(ux)));
    // the flat end holds up to about (3g / 2L)·(thickness / L) (more once seated: contact friction):
    // three times that tips it from upright
    const alpha = 1.5 * G_UNITS / len * (tilt + 3 / it.slimness);
    // top leaning right (+x) falls clockwise: negative spin
    it.body.wakeUp();
    it.spin -= it.toppleSide * alpha * dt;
    it.restTime = 0; it.restX = NaN;
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
