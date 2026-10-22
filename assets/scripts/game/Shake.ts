// Shaking the phone (web src/game/shake.js): items INSIDE the bag move with the player's hand,
// everything else stays put. The device acceleration pushes each item the opposite way (inertia);
// a strong shake also lifts a little so packed items loosen and settle tighter; friction of the
// bag items is lowered while shaking and restored shortly after. The bag image sways (visual only).
// Energy: a full bar empties after 8 s of real shaking; empty = shaking locked, the popup opens
// once, a rewarded ad refills it. No sensor (desktop): arrow keys shake.
import { input, Input, EventAcceleration, EventKeyboard, KeyCode, Vec2, sys } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { bagZone } from './BagRules';
import { Sound } from '../audio/Sound';

const G = 9.81;
const DEAD = .7, MAX = 14;               // m/s²: ignore hand tremor below, cap above
const GAIN = 4.5;                        // shake amplification (a real hand barely moves a 1.6 m bag)
const LIFT_FROM = 5, LIFT = .22;         // strong sideways shakes also lift a little
const JITTER = .35;                      // random vertical jitter, share of the sideways push
const FRICTION_WHILE_SHAKING = .15;      // share of the normal friction left while shaking
const RESTORE_MS = 280;                  // friction comes back this long after the last shake
const FILTER = .8;                       // low-pass that removes gravity from the sensor
const DEAD_Y = 1.2, MAX_UP = 4;          // vertical axis: walking / tilting ignored, upward toss capped
const GAME_G = 34.375;                   // m/s², game gravity (Project Settings → Physics)
const EMPTY_AFTER = 8000;                // ms of shaking from full to empty
const KEY_SIDE = 7, KEY_UP = 3.2, KEY_DOWN = 7;

let ax = 0, ay = 0, gx = 0, gy = 0;      // filtered device acceleration (m/s²), gravity estimate
let fakeX = 0, fakeY = 0, fakeUntil = 0; // keyboard / scripted shake
let energy = 1;
let onEnergy: (e: number) => void = () => {};
let onEmpty: () => void = () => {};
const keys = new Set<KeyCode>();
let bound = false;
const sway = { x: 0, v: 0, y: 0, vy: 0 };
const force = new Vec2();
let dirX = 0, dirY = 0, buzzAt = 0;

function onMotion(e: EventAcceleration) {
  // Cocos reports acceleration including gravity, in g: filter gravity out, per axis
  const x = e.acc.x * G, y = e.acc.y * G;
  gx = FILTER * gx + (1 - FILTER) * x; ax = x - gx;
  gy = FILTER * gy + (1 - FILTER) * y; ay = y - gy;
}
function keyShake() {
  let dx = 0, dy = 0;
  if (keys.has(KeyCode.ARROW_LEFT)) dx--; if (keys.has(KeyCode.ARROW_RIGHT)) dx++;
  if (keys.has(KeyCode.ARROW_UP)) dy--; if (keys.has(KeyCode.ARROW_DOWN)) dy++;
  if (dx || dy) shakeToward(dx, dy);
}

/** Scripted shake toward a screen direction (dy −1 = up), like the web lacHuong */
export function shakeToward(dx: number, dy: number, k = 1, ms = 180) {
  const len = Math.hypot(dx, dy); if (!len) return;
  const ux = dx / len, uy = dy / len;
  fakeX = -ux * KEY_SIDE * k; fakeY = uy * (uy < 0 ? KEY_UP : KEY_DOWN) * k;
  fakeUntil = Date.now() + ms;
}

export const Shake = {
  bind(handlers: { onEnergy: (e: number) => void; onEmpty: () => void }) {
    onEnergy = handlers.onEnergy; onEmpty = handlers.onEmpty;
    if (bound) return;
    bound = true;
    if (sys.isMobile) { input.setAccelerometerEnabled(true); input.setAccelerometerInterval(1 / 60); input.on(Input.EventType.DEVICEMOTION, onMotion); }
    input.on(Input.EventType.KEY_DOWN, (e: EventKeyboard) => { if (e.keyCode >= KeyCode.ARROW_LEFT && e.keyCode <= KeyCode.ARROW_DOWN) { keys.add(e.keyCode); keyShake(); } });
    input.on(Input.EventType.KEY_PRESSING, () => keyShake());
    input.on(Input.EventType.KEY_UP, (e: EventKeyboard) => keys.delete(e.keyCode));
  },
  unbind() {
    if (!bound) return;
    bound = false;
    input.off(Input.EventType.DEVICEMOTION); input.off(Input.EventType.KEY_DOWN); input.off(Input.EventType.KEY_PRESSING); input.off(Input.EventType.KEY_UP);
    if (sys.isMobile) input.setAccelerometerEnabled(false);
    keys.clear();
  },
  get energy() { return energy; },
  setEnergy(v: number) { energy = Math.max(0, Math.min(1, v)); onEnergy(energy); },

  /** Every frame while the round runs, before the physics step */
  tick(dtMs: number, clock: number) {
    const S = GameState;
    restoreFriction(clock, false);
    let a = ax, v = ay;
    if (fakeUntil > Date.now()) { a = fakeX; v = fakeY; }
    if (Math.abs(a) < DEAD) a = 0;
    if (Math.abs(v) < DEAD_Y) v = 0;
    if (!a && !v) return;
    if (energy <= 0) return;                 // empty: shaking locked
    a = Math.max(-MAX, Math.min(MAX, a));
    v = Math.max(-MAX_UP, Math.min(MAX, v)); // negative = toss up: capped lower
    const unit = GAME_G * GAIN / G;
    const lift = Math.abs(a) >= LIFT_FROM ? (Math.abs(a) - LIFT_FROM) * LIFT : 0;
    let moved = false;
    for (const it of S.items) {
      if (it.waiting || it.isStatic || isHeld(it) || !bagZone(it).inZone) continue;
      if (!it.shakeFriction) {
        it.shakeFriction = it.colliders.map(c => c.friction);
        for (const c of it.colliders) { c.friction *= FRICTION_WHILE_SHAKING; c.apply(); }
      }
      it.frictionBackAt = clock + RESTORE_MS;
      const jitter = (Math.random() - .5) * 2 * JITTER * Math.abs(a);
      let up = Math.max(0, -v) + lift + Math.max(0, jitter);
      if (up > MAX_UP) up = MAX_UP;
      const down = v > 0 ? v - Math.min(up, lift + Math.max(0, jitter)) : -up;   // web +y = down
      const m = it.body.getMass();
      force.set(-a * unit * m, -down * unit * m);
      it.body.applyForceToCenter(force, true);
      moved = true;
    }
    if (!moved) return;
    // a short buzz each time the shake changes direction (items knock against the bag walls)
    const sx = Math.sign(a), sy = Math.sign(v), strength = Math.hypot(a, v);
    const turned = (sx && dirX && sx !== dirX) || (sy && dirY && sy !== dirY);
    if (sx) dirX = sx; if (sy) dirY = sy;
    const now = Date.now();
    if (turned && strength >= 3.5 && now >= buzzAt) { buzzAt = now + 85; Sound.vibrate(Math.round(Math.min(48, 12 + strength * 2.4))); }
    const before = Math.round(energy * 100);
    energy = Math.max(0, energy - dtMs / EMPTY_AFTER);
    if (Math.round(energy * 100) !== before || energy === 0) onEnergy(energy);
    if (energy === 0) onEmpty();
  },

  /** Bag sway following the hand (spring), offsets in units */
  sway(dtMs: number) {
    let a = ax, v = ay;
    if (fakeUntil > Date.now()) { a = fakeX; v = fakeY; }
    if (Math.abs(a) < DEAD) a = 0;
    if (Math.abs(v) < DEAD_Y) v = 0;
    const tx = Math.max(-1, Math.min(1, -a / MAX)) * 12, ty = Math.max(-1, Math.min(1, v / MAX)) * 8;
    const f = Math.min(2, dtMs / 16);
    sway.v += (tx - sway.x) * .12 - sway.v * .28; sway.x += sway.v * f;
    sway.vy += (ty - sway.y) * .12 - sway.vy * .28; sway.y += sway.vy * f;
    return { x: sway.x, y: -sway.y, angle: -sway.x * .0035 * 180 / Math.PI };
  },

  /** Round over / restart: friction back, sway at rest */
  reset() { restoreFriction(0, true); sway.x = sway.v = sway.y = sway.vy = 0; fakeUntil = 0; },
};

function restoreFriction(clock: number, all: boolean) {
  for (const it of GameState.items) {
    if (!it.shakeFriction || (!all && clock < it.frictionBackAt)) continue;
    it.colliders.forEach((c, i) => { c.friction = it.shakeFriction![i]; c.apply(); });
    it.shakeFriction = null;
  }
}
