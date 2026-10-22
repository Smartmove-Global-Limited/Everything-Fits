// Special item behaviour and impacts (web src/game/rules.js bindImpacts, mechanics.js tickPhone,
// float.js):
//   impacts   landing sound by material, louder for heavier / faster items; dust; a short screen
//             shake when something heavy hits the floor
//   fragile   hit fast by a hard item, or dropped hard onto the floor / a hard item → cracks;
//             the second crack breaks it and the round is lost (soft items never break anything)
//   phone     (physics "vibrating") buzzes inside the bag: 0.9 s every 5.2 s, jittering
//   balloon   (physics "float") rises inside the bag; outside it floats up to just under the HUD,
//             sways, stays upright, rests when something lies on top of it
// Web speeds were in units per 1/60 s step; here in units per second (×60).
import { Vec2, Collider2D, IPhysics2DContact, RigidBody2D } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { bagZone, itemAABB } from './BagRules';
import { Fx } from './Fx';
import { Sound, SfxName } from '../audio/Sound';
import { ItemPhysics, ItemView } from './ItemView';
import { levelToFieldY, DESIGN_H } from '../core/GameConstants';

const STEP = 60;
const LIGHT_HIT = 1.6 * STEP;        // below: items just rubbing
const ITEM_GAP_MS = 130;             // one item does not sound twice in a row
const MAX_PER_BEAT = 3;              // many items landing together: only a few sounds
const HARD_HIT_CRACK = 7 * STEP;     // hard item hitting a fragile one this fast cracks it
const FALL_CRACK = 9 * STEP;         // fragile item falling this fast onto floor / hard item cracks
const NO_CRACK_AT_START = 2500;      // ms: items raining in at the start never crack
const SOUND: Record<string, SfxName> = { glass: 'glass', ceramic: 'glass', metal: 'metal', paper: 'paper', fabric: 'drop', food: 'drop' };
const SOFT = new Set(['fabric', 'paper', 'food']);

export type MechanicsEvents = { onBroken?(item: ItemView): void };
let events: MechanicsEvents = {};
export function setMechanicsEvents(e: MechanicsEvents) { events = e; }

let beatAt = 0, beatCount = 0;
const vA = new Vec2(), vB = new Vec2(), pt = new Vec2();
const isSoft = (it: ItemView | null) => !!it && SOFT.has(it.material);

/** BEGIN_CONTACT of one of the item's colliders (called by ItemView) */
export function onItemContact(item: ItemView, self: Collider2D, other: Collider2D, contact: IPhysics2DContact | null) {
  const S = GameState;
  if (!contact || item.waiting || isHeld(item) || !S.level || S.won || S.lost) return;
  const m = contact.getWorldManifold();
  if (!m.points.length) return;
  const p = m.points[0];
  pt.set(p.x, p.y);
  const bodyA = self.body!, bodyB = other.body as RigidBody2D | null;
  bodyA.getLinearVelocityFromWorldPoint(pt, vA);
  if (bodyB) bodyB.getLinearVelocityFromWorldPoint(pt, vB); else vB.set(0, 0);
  const n = m.normal;
  const v = Math.abs((vA.x - vB.x) * n.x + (vA.y - vB.y) * n.y);
  if (v < LIGHT_HIT) return;
  const otherItem = other.node.getComponent(ItemView);   // only on an actual impact, rare
  const intoWall = !otherItem;
  onImpact(item, v, pt, intoWall, otherItem);
}

function onImpact(b: ItemView, v: number, at: Vec2, intoWall: boolean, other: ItemView | null) {
  const S = GameState;
  // fragile: hit by a hard item fast / falling hard onto the floor or a hard item
  if (other && !other.isStatic && other.fragile && !isHeld(other) && !isSoft(b) && v >= HARD_HIT_CRACK) crack(other, at);
  if (b.fragile && ((intoWall && v >= FALL_CRACK) || (other && !other.isStatic && !isSoft(other) && v >= FALL_CRACK))) crack(b, at);
  const now = S.clock;
  if (b.lastImpactAt > now - ITEM_GAP_MS) return;
  b.lastImpactAt = now;
  if (now - beatAt > 90) { beatAt = now; beatCount = 0; }
  if (++beatCount > MAX_PER_BEAT) return;
  // loud or soft by kinetic energy (grams × speed²), on a log scale so 30 g and 1500 g both sound
  const k = b.levelScale, grams = b.grams || 150, web = v / STEP;
  const energy = grams * k * k * web * web / 1000;
  const strength = Math.min(1, Math.max(0, Math.log10(energy + 1) / 2));
  const soft = isSoft(b);
  Sound.play(SOUND[b.material] || 'land', { gain: (soft ? .12 : .18) + strength * .6 });
  const fx = Fx.instance;
  if (fx) {
    const d = soft ? .35 : 1;
    if (intoWall) fx.dust(at.x, at.y, { n: Math.round((2 + strength * 8) * d), strength });
    else fx.dust(at.x, at.y, { n: Math.round((1 + strength * 3) * d), strength: strength * .5 });
    if (intoWall && grams * k * k >= 400 && web >= 4.5) fx.shake(grams >= 1000 ? 220 : 150);
  }
}

function crack(b: ItemView, at: Vec2) {
  const S = GameState, now = S.clock;
  if (b.broken || S.won || S.lost || (b.crackedAt && now - b.crackedAt < 600)) return;
  if (!S.bagReady || now - S.startTime < NO_CRACK_AT_START) return;
  b.crackedAt = now; b.cracks++;
  const fx = Fx.instance;
  if (b.cracks < 2) {
    Sound.play('crack', { gain: .85 });
    fx?.shake(130); fx?.dust(at.x, at.y, { n: 5, strength: .6 }); fx?.floatText(at.x, at.y + 20, 'Crack!', { color: '#E5484D' });
    return;
  }
  b.broken = true;
  Sound.play('break', { gain: .95 });
  fx?.shake(420); fx?.dust(at.x, at.y, { n: 14, strength: 1 }); fx?.sparkle(at.x, at.y, { n: 14 });
  events.onBroken?.(b);
}

// ---------- phone: buzzes inside the bag ----------
const BUZZ_CYCLE = 5200, BUZZ_ON = 900;
const tmpForce = new Vec2();
/** Called every frame before the physics step. Returns the buzzing phone (for the waves) or null. */
export function tickPhone(dtMs: number): ItemView | null {
  let buzzing: ItemView | null = null;
  for (const it of GameState.items) {
    if (it.physicsType !== ItemPhysics.VIBRATING || it.waiting || isHeld(it) || it.isStatic) continue;
    if (!bagZone(it).fullyInside) { it.buzzClock = 0; continue; }
    it.buzzClock += dtMs;
    if (it.buzzClock % BUZZ_CYCLE < BUZZ_ON) {
      buzzing = it;
      // web: force ±.006 × mass per step² → ±~190 m/s² random kicks, a small spin
      const m = it.body.getMass();
      tmpForce.set((Math.random() - .5) * 190 * m, (Math.random() - .4) * 190 * m);
      it.body.applyForceToCenter(tmpForce, true);
      it.body.angularVelocity += (Math.random() - .5) * .12 * STEP;
    }
  }
  return buzzing;
}

// ---------- balloon ----------
const GRAVITY = 34.375;              // m/s² (Project Settings → Physics, 1100 units/s²)
const RISE_IN_BAG = 1.45;            // buoyancy inside the bag, in g
const CEIL_Y = levelToFieldY(142);   // outside the bag it hovers with its centre about here
const HOVER_K = .014, HOVER_MAX = .7, SLIDE_UNDER_BAG = .8;
const PRESSED_RISE = .92, PRESSED_HOLD_MS = 350;
const AIR = 3.7, AIR_PRESSED = 15;   // web frictionAir .06 / .22 per step → linear damping per second
const UPRIGHT = .0035, UPRIGHT_DAMP = .9;
const force = new Vec2();

/** Called every frame before the physics step (once the bag is there; before that it falls like any item) */
export function tickBalloons() {
  const S = GameState, bag = S.bag;
  if (!S.bagReady || !bag) return;
  const t = S.clock;
  for (const b of S.items) {
    if (b.physicsType !== ItemPhysics.FLOAT || b.waiting || isHeld(b) || b.isStatic) continue;
    const pos = b.node.position;
    let rise: number;
    pt.set(pos.x, pos.y);
    if (bag.contains(pt)) rise = RISE_IN_BAG;
    else {
      const below = (DESIGN_H - pos.y) - (DESIGN_H - CEIL_Y);   // > 0: still under the ceiling
      rise = 1 + Math.max(-HOVER_MAX, Math.min(HOVER_MAX, below * HOVER_K));
    }
    // pressed: another item resting on top of it (above its centre, overlapping across)
    const r = itemAABB(b), x0 = r.xMin, x1 = r.xMax, top = r.yMax;
    for (const o of S.items) {
      if (o === b || o.waiting || isHeld(o) || o.node.position.y < pos.y + 2) continue;
      const q = itemAABB(o);
      if (q.yMin > top + 2 || q.xMax < x0 || q.xMin > x1) continue;
      if (Math.min(q.xMax, x1) - Math.max(q.xMin, x0) > Math.min(q.width, r.width) * .3) { b.pressedUntil = t + PRESSED_HOLD_MS; break; }
    }
    const pressed = b.pressedUntil > t;
    b.body.linearDamping = pressed ? AIR_PRESSED : AIR;
    if (pressed) rise = Math.min(rise, PRESSED_RISE);
    const phase = b.levelIndex * 1.7;
    if (!pressed) rise += Math.sin(t * .0021 + phase) * .05;               // bobbing
    let wind = pressed ? 0 : Math.sin(t * .0013 + phase * 2.3) * .035;     // sway
    // right under the bag: drift to the nearer side first
    if (rise !== RISE_IN_BAG && pos.y < bag.minY + 4 && pos.x > bag.minX - 24 && pos.x < bag.maxX + 24)
      wind += (pos.x < (bag.minX + bag.maxX) / 2 ? -1 : 1) * SLIDE_UNDER_BAG;
    const m = b.body.getMass();
    force.set(wind * GRAVITY * m, rise * GRAVITY * m);
    b.body.applyForceToCenter(force, true);
    // stay upright: turn back to 0°, damped
    let a = b.node.eulerAngles.z * Math.PI / 180;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    b.body.angularVelocity = (b.body.angularVelocity / STEP * UPRIGHT_DAMP - a * UPRIGHT) * STEP;
  }
}

// ItemView forwards its BEGIN_CONTACT here (it does not import this module: no import cycle)
ItemView.contactHandler = onItemContact;
