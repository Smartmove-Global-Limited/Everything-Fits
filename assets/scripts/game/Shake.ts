// Shaking the phone (web src/game/shake.js): items INSIDE the bag move with the player's hand,
// everything else stays put. The device acceleration pushes each item the opposite way (inertia);
// a strong shake also lifts a little so packed items loosen and settle tighter; friction of the
// bag items is lowered while shaking and restored shortly after. The bag image sways (visual only).
// Energy (Daily.ts ShakeEnergy): 100 points a day, every hard jolt (the shake changing direction)
// costs 2; empty = shaking locked, the popup opens once, a rewarded ad refills it. No sensor
// (desktop): arrow keys shake.
// Sensor: on Android the linear acceleration (gravity removed by the system, MotionBridge.java),
// like the web app's DeviceMotionEvent.acceleration: tilting the phone does not move the items.
// Elsewhere Cocos's accelerometer with gravity filtered out here.
// Tilt guard: tilting or turning the phone (even back and forth) only changes the DIRECTION of
// gravity, the total acceleration stays at 1 g; a real shake makes it jump well above / below.
// The sensor is only obeyed for SHAKE_WINDOW ms after the total moved MAG_SHAKE away from its
// resting value, so tilting leaves the items alone (phones without a gyroscope, like the test
// Xiaomi, have no linear acceleration sensor and a tilt leaks through the gravity filter).
import { input, Input, EventAcceleration, EventKeyboard, KeyCode, Vec2, sys, native } from 'cc';
import { NATIVE } from 'cc/env';
import { GameState, isHeld } from '../core/GameState';
import { bagZone } from './BagRules';
import { Sound } from '../audio/Sound';
import { ShakeEnergy } from '../services/Daily';

const G = 9.81;
const DEAD = .7, MAX = 14;               // m/s²: ignore hand tremor below, cap above
const GAIN = 4.5;                        // shake amplification (a real hand barely moves a 1.6 m bag)
const LIFT_FROM = 5, LIFT = .22;         // strong sideways shakes also lift a little
const JITTER = .35;                      // random vertical jitter, share of the sideways push
const FRICTION_WHILE_SHAKING = .15;      // share of the normal friction left while shaking
const RESTORE_MS = 280;                  // friction comes back this long after the last shake
const MAG_REST_FILTER = .98;             // slow average of the total acceleration (its resting value)
const FILTER = .8;                       // low-pass that removes gravity from the sensor
const DEAD_Y = 1.2, MAX_UP = 4;          // vertical axis: walking / tilting ignored, upward toss capped
const GAME_G = 34.375;                   // m/s², game gravity (Project Settings → Physics)
const JOLT_MIN = 3.5;                    // m/s²: a direction change this strong is a jolt (costs energy)
const JOLT_GAP = 85;                     // ms: at most one jolt counted per this interval
const KNOCK_GAP = 400;                   // ms: at most one bag-shake sound per this interval (the clip is 0.84 s)
const KNOCK_MAX = .22;                   // loudest bag-shake sound (the clips overlap while shaking: full volume was too loud)
const MAG_SHAKE = 2.5;                   // m/s²: total acceleration this far from its resting value = shaking
const LIN_SHAKE = 4;                     // m/s²: same with the linear acceleration sensor (gravity removed)
const SHAKE_WINDOW = 350;                // ms the sensor is obeyed after that
const KEY_SIDE = 7, KEY_UP = 3.2, KEY_DOWN = 7;

let magRest = 0, shakingUntil = 0;       // resting total acceleration (≈ 1 g), tilt guard
let ax = 0, ay = 0, gx = 0, gy = 0;      // filtered device acceleration (m/s²), gravity estimate
let fakeX = 0, fakeY = 0, fakeUntil = 0; // keyboard / scripted shake
let onEnergy: (e: number) => void = () => {};
let onEmpty: () => void = () => {};
let onJolt: () => void = () => {};
const keys = new Set<KeyCode>();
let bound = false;
/** Android linear acceleration read from MotionBridge every frame (no Cocos accelerometer then) */
let linear = false;
const MOTION = 'com/cocos/game/MotionBridge';
const callStatic = (m: string, sig: string) => (native.reflection.callStaticMethod as (...a: unknown[]) => any)(MOTION, m, sig);
function readLinear() {
  ax = callStatic('x', '()F') || 0; ay = callStatic('y', '()F') || 0;
  if (Math.hypot(ax, ay) >= LIN_SHAKE) shakingUntil = Date.now() + SHAKE_WINDOW;
}
const sway = { x: 0, v: 0, y: 0, vy: 0 };
const force = new Vec2();
let dirX = 0, dirY = 0, joltAt = 0, knockAt = 0;

function onMotion(e: EventAcceleration) {
  // Cocos reports acceleration including gravity, in g, x / y flipped on Android to match iOS:
  // flip back to the browser's devicemotion axes (what the web app's numbers were tuned with),
  // then filter gravity out, per axis
  const flip = sys.os === sys.OS.ANDROID ? -G : G;
  const x = e.acc.x * flip, y = e.acc.y * flip, z = e.acc.z * G;
  gx = FILTER * gx + (1 - FILTER) * x; ax = x - gx;
  gy = FILTER * gy + (1 - FILTER) * y; ay = y - gy;
  // tilt guard: the total only leaves its resting value when the hand really shakes
  const mag = Math.sqrt(x * x + y * y + z * z);
  magRest = magRest ? MAG_REST_FILTER * magRest + (1 - MAG_REST_FILTER) * mag : mag;
  if (Math.abs(mag - magRest) >= MAG_SHAKE) shakingUntil = Date.now() + SHAKE_WINDOW;
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
  bind(handlers: { onEnergy: (e: number) => void; onEmpty: () => void; onJolt?: () => void }) {
    onEnergy = handlers.onEnergy; onEmpty = handlers.onEmpty; onJolt = handlers.onJolt || (() => {});
    if (bound) return;
    bound = true;
    try { linear = NATIVE && sys.os === sys.OS.ANDROID && !!callStatic('available', '()Z'); } catch { linear = false; }
    // interval in MILLISECONDS, set before enabling: the engine's polling timer starts with the
    // interval of the moment it is enabled (else 200 ms, far too slow to see a shake)
    if (sys.isMobile && !linear) { input.setAccelerometerInterval(16); input.setAccelerometerEnabled(true); input.on(Input.EventType.DEVICEMOTION, onMotion); }
    input.on(Input.EventType.KEY_DOWN, (e: EventKeyboard) => { if (e.keyCode >= KeyCode.ARROW_LEFT && e.keyCode <= KeyCode.ARROW_DOWN) { keys.add(e.keyCode); keyShake(); } });
    input.on(Input.EventType.KEY_PRESSING, () => keyShake());
    input.on(Input.EventType.KEY_UP, (e: EventKeyboard) => keys.delete(e.keyCode));
  },
  unbind() {
    if (!bound) return;
    bound = false;
    input.off(Input.EventType.DEVICEMOTION); input.off(Input.EventType.KEY_DOWN); input.off(Input.EventType.KEY_PRESSING); input.off(Input.EventType.KEY_UP);
    if (sys.isMobile && !linear) input.setAccelerometerEnabled(false);
    ax = ay = 0;
    keys.clear();
  },
  get energy() { return ShakeEnergy.fraction; },
  /** Redraw the bar (a new round, or the energy was refilled) */
  showEnergy() { onEnergy(ShakeEnergy.fraction); },

  /** Every frame while the round runs, before the physics step */
  tick(dtMs: number, clock: number) {
    const S = GameState;
    restoreFriction(clock, false);
    if (linear) readLinear();
    let a = ax, v = ay;
    if (fakeUntil > Date.now()) { a = fakeX; v = fakeY; }
    else if (Date.now() >= shakingUntil) { a = 0; v = 0; }   // a tilt, not a shake
    if (Math.abs(a) < DEAD) a = 0;
    if (Math.abs(v) < DEAD_Y) v = 0;
    if (!a && !v) return;
    if (ShakeEnergy.empty) return;           // empty: shaking locked
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
    // each hard jolt (the shake changes direction): a short buzz and a knocking sound (items
    // against the bag walls) and 2 energy points
    const sx = Math.sign(a), sy = Math.sign(v), strength = Math.hypot(a, v);
    const turned = (sx && dirX && sx !== dirX) || (sy && dirY && sy !== dirY);
    if (sx) dirX = sx; if (sy) dirY = sy;
    const now = Date.now();
    if (!turned || strength < JOLT_MIN || now < joltAt) return;
    joltAt = now + JOLT_GAP;
    Sound.vibrate(Math.round(Math.min(80, 35 + strength * 3)));   // shorter was not felt on some phones
    // the items knocking about in the bag, louder for a harder jolt
    if (now >= knockAt) { knockAt = now + KNOCK_GAP; Sound.play('jiggle', { gain: Math.min(KNOCK_MAX, .1 + strength * .012) }); }
    ShakeEnergy.spend();
    onJolt();
    onEnergy(ShakeEnergy.fraction);
    if (ShakeEnergy.empty) onEmpty();
  },

  /** Bag sway following the hand (spring), offsets in units */
  sway(dtMs: number) {
    let a = ax, v = ay;
    if (fakeUntil > Date.now()) { a = fakeX; v = fakeY; }
    else if (Date.now() >= shakingUntil) { a = 0; v = 0; }
    if (Math.abs(a) < DEAD) a = 0;
    if (Math.abs(v) < DEAD_Y) v = 0;
    const tx = Math.max(-1, Math.min(1, -a / MAX)) * 12, ty = Math.max(-1, Math.min(1, v / MAX)) * 8;
    const f = Math.min(2, dtMs / 16);
    sway.v += (tx - sway.x) * .12 - sway.v * .28; sway.x += sway.v * f;
    sway.vy += (ty - sway.y) * .12 - sway.vy * .28; sway.y += sway.vy * f;
    return { x: sway.x, y: -sway.y, angle: -sway.x * .0035 * 180 / Math.PI };
  },

  /** Round over / restart: friction back, sway at rest */
  reset() { restoreFriction(0, true); sway.x = sway.v = sway.y = sway.vy = 0; fakeUntil = 0; shakingUntil = 0; },
};

function restoreFriction(clock: number, all: boolean) {
  for (const it of GameState.items) {
    if (!it.shakeFriction || (!all && clock < it.frictionBackAt)) continue;
    it.colliders.forEach((c, i) => { c.friction = it.shakeFriction![i]; c.apply(); });
    it.shakeFriction = null;
  }
}
