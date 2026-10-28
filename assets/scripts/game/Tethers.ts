// Tied pairs (levels.json item.link, set with "Buộc dây…" in the Level Editor; web mechanics.js
// createTethers / drawStrings): two items joined by a string. The pair is picked up and moved as one
// (DragController), pushed out of the bag together (BagRules.eject) and never thrown out by a booster.
//
// The string is slack up to its length and only pulls when stretched: a velocity correction along
// the string once per frame, before the physics step, instead of a Box2D joint (a joint dies with
// the body every time an item is picked up, and its lifecycle differs on the native build).
// The string never pulls an item lying in the bag (the bag holds it: a pair packed far apart would
// tug at the whole packed cluster for ever), nor wakes a resting item for a small stretch, and gives
// up while the pulled item is blocked (pressed against the bag), so packed clusters can still sleep
// (Settle) and nothing shakes.
import { Graphics, Color, Vec3 } from 'cc';
import { PTM } from '../core/GameConstants';
import { bagZone } from './BagRules';
import type { ItemView } from './ItemView';

type Tether = {
  a: ItemView; b: ItemView; length: number;
  /** distance last frame, frames the pull did not bring them closer, distance at which it gave up */
  lastD: number; blocked: number; restD: number;
};

const SLACK = 24;           // string length beyond the two half sizes (units)
const MIN_LENGTH = 64;      // web Constraint length
const PULL_RATE = 8;        // 1/s: a stretched string closes its stretch in about 1/8 s
const MAX_PULL = 6;         // m/s: fastest pull
const TOLERANCE = 2;        // units of stretch ignored (resting pairs stay still)
const WAKE_STRETCH = 20;    // a sleeping item is only pulled (and woken) beyond this stretch
const BLOCKED_FRAMES = 30;  // frames of pulling without getting closer: blocked, stop pulling
const SAG = .7, MIN_SAG = 6;
const INK = new Color(0x3B, 0x2A, 0x4A, 255), STRING = new Color(0xE2, 0x63, 0x7F, 255);   // web theme.ink, #E2637F

const tethers: Tether[] = [];

/** Half the longest side of the item at its level scale */
const halfSize = (it: ItemView) => Math.max(it.localBox.width, it.localBox.height) * it.levelScale / 2;

/**
 * Tie the pairs of a freshly built level. `link` holds the partner's item id (not its index): the
 * partner is the first other item with that id in level order that is not tied yet.
 */
export function buildTethers(items: readonly ItemView[], level: any) {
  clearTethers();
  const src: any[] = level?.items || [];
  for (const a of items) {
    const link = src[a.levelIndex]?.link;
    if (link == null || a.partner) continue;
    const b = items.find(o => o !== a && !o.partner && o.itemId === Number(link));
    if (!b) continue;
    a.partner = b; b.partner = a;
    tethers.push({ a, b, length: Math.max(MIN_LENGTH, halfSize(a) + halfSize(b) + SLACK), lastD: 0, blocked: 0, restD: NaN });
  }
}

export function clearTethers() {
  for (const t of tethers) t.a.partner = t.b.partner = null;
  tethers.length = 0;
}

const inWorld = (it: ItemView) => !it.waiting && !it.held && it.body.enabled && it.node.activeInHierarchy;

/** Can the string move this item? Not when frozen or in the bag; a sleeping one only for a real pull */
function movable(it: ItemView, stretch: number) {
  if (it.isStatic || bagZone(it).inZone) return false;
  return it.body.isAwake() || stretch > WAKE_STRETCH;
}

/** Every frame, before the physics step: stretched strings pull their two items together */
export function tickTethers() {
  for (const t of tethers) {
    const a = t.a, b = t.b;
    if (!inWorld(a) || !inWorld(b)) continue;
    const pa = a.node.position, pb = b.node.position;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy);
    const stretch = d - t.length;
    if (stretch <= TOLERANCE || d < 1e-3) { t.blocked = 0; t.restD = NaN; continue; }
    if (Math.abs(d - t.restD) < WAKE_STRETCH) continue;              // gave up here: wait for a clear change
    const ia = movable(a, stretch) ? 1 / Math.max(1e-3, a.body.getMass()) : 0;
    const ib = movable(b, stretch) ? 1 / Math.max(1e-3, b.body.getMass()) : 0;
    if (ia + ib === 0) continue;
    if (d > t.lastD - .3) { if (++t.blocked > BLOCKED_FRAMES) { t.restD = d; t.blocked = 0; } }
    else t.blocked = 0;
    t.lastD = d;
    const nx = dx / d, ny = dy / d;
    const va = a.body.linearVelocity, vb = b.body.linearVelocity;
    const rel = (vb.x - va.x) * nx + (vb.y - va.y) * ny;            // m/s, > 0: moving apart
    const want = -Math.min(MAX_PULL, stretch / PTM * PULL_RATE);
    if (rel <= want) continue;                                       // already closing fast enough
    const j = (want - rel) / (ia + ib);                              // < 0
    if (ia) a.body.linearVelocity = va.set(va.x - nx * j * ia, va.y - ny * j * ia);
    if (ib) b.body.linearVelocity = vb.set(vb.x + nx * j * ib, vb.y + ny * j * ib);
  }
}

const pa = new Vec3(), pb = new Vec3();
/** item positions the strings were last drawn at (4 numbers per string), to skip redrawing */
const drawnAt: number[] = [];

/** Did any string end move since the last drawing? Updates drawnAt. */
function moved(): boolean {
  let changed = drawnAt.length !== tethers.length * 4;
  drawnAt.length = tethers.length * 4;
  for (let i = 0; i < tethers.length; i++) {
    const t = tethers[i], p = t.a.node.worldPosition, q = t.b.node.worldPosition, k = i * 4;
    const show = t.a.node.activeInHierarchy && t.b.node.activeInHierarchy;
    const x0 = show ? p.x : -1e9, y0 = show ? p.y : 0, x1 = show ? q.x : 0, y1 = show ? q.y : 0;
    if (!(Math.abs(drawnAt[k] - x0) < .05) || Math.abs(drawnAt[k + 1] - y0) >= .05 || Math.abs(drawnAt[k + 2] - x1) >= .05 || Math.abs(drawnAt[k + 3] - y1) >= .05) changed = true;
    drawnAt[k] = x0; drawnAt[k + 1] = y0; drawnAt[k + 2] = x1; drawnAt[k + 3] = y1;
  }
  return changed;
}

function stroke(g: Graphics, cx: number, cy: number, width: number, color: Color) {
  g.lineWidth = width; g.strokeColor = color;
  g.moveTo(pa.x, pa.y); g.quadraticCurveTo(cx, cy, pb.x, pb.y); g.stroke();
}
function dot(g: Graphics, p: Vec3) { g.circle(p.x, p.y, 3.5); g.fill(); g.stroke(); }

/**
 * The strings (web drawStrings): a curve sagging under the two centres, dark edge + pink core, a dot
 * at each end. Redrawn only when one of the items moved.
 */
export function drawTethers(g: Graphics | null) {
  if (!g || !moved()) return;
  g.clear();
  const n = g.node;
  for (const t of tethers) {
    if (!t.a.node.activeInHierarchy || !t.b.node.activeInHierarchy) continue;
    n.inverseTransformPoint(pa, t.a.node.worldPosition);
    n.inverseTransformPoint(pb, t.b.node.worldPosition);
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y), sag = Math.max(0, t.length - d) * SAG + MIN_SAG;
    const cx = (pa.x + pb.x) / 2, cy = (pa.y + pb.y) / 2 - sag;     // y up: sagging is downwards
    stroke(g, cx, cy, 4.5, INK);
    stroke(g, cx, cy, 2.5, STRING);
    g.fillColor = STRING; g.strokeColor = INK; g.lineWidth = 1.5;
    dot(g, pa); dot(g, pb);
  }
}

/** Next round: forget what was drawn */
export function resetTetherDrawing(g: Graphics | null) { drawnAt.length = 0; g?.clear(); }
