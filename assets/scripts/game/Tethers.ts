// Tied pairs (levels.json item.link, set with "Buộc dây…" in the Level Editor; web mechanics.js
// createTethers / drawStrings): two items joined by a string. The string is only a link the player
// sees (asked): it never pulls the two items together and never pushes anything else. It acts in one
// case: an item "dangles" from its partner (the anchor) while the anchor is in the hand or lies in
// the bag and the item itself is outside the bag (its centre). A dangling item swings on the string under
// the anchor, collides like any item, and is drawn in front of the bag rim; it stays outside the bag
// until the player drags it in. A packed item never dangles; when neither rule holds the string
// just hangs between the two items.
//
// The string only pulls when stretched: a velocity correction on the dangling item along the string
// once per frame, before the physics step (no Box2D joint: a joint dies with the body every time an
// item is picked up, and its lifecycle differs on the native build). Gravity makes it swing.
import { Graphics, Color, Vec3, Node } from 'cc';
import { PTM } from '../core/GameConstants';
import { bagZone, centreInBag } from './BagRules';
import type { ItemView } from './ItemView';

type Tether = {
  a: ItemView; b: ItemView; length: number;
  /** pulling without coming closer (blocked by the bag wall): frames, and where the anchor / the
   *  distance were then. Blocked, the string only holds it (no further away, no pull) until the
   *  anchor moves or the string stretches further */
  lastD: number; blocked: number; stuckX: number; stuckY: number; stuckD: number;
};

const SLACK = 24;           // string length beyond the two half sizes (units)
const MIN_LENGTH = 64;      // web Constraint length
const TOLERANCE = 2;        // units of stretch ignored
const PULL_RATE = 14;       // 1/s: a stretched string closes its stretch in about 1/14 s
const MAX_PULL = 16;        // m/s: fastest pull (keeps up with a finger)
const BLOCKED_FRAMES = 12;  // pulling this long without coming closer: blocked, stop pulling
const UNSTICK_MOVE = 6;     // units the anchor must move (or the string stretch further) to pull again
const SAG = .7, MIN_SAG = 6;
const INK = new Color(0x3B, 0x2A, 0x4A, 255), STRING = new Color(0xE2, 0x63, 0x7F, 255);   // web theme.ink, #E2637F

const tethers: Tether[] = [];
/** where dangling items are drawn (in front of the bag rim) and where they go back */
let itemLayer: Node | null = null, frontLayer: Node | null = null;
export function setTetherLayers(items: Node, front: Node) { itemLayer = items; frontLayer = front; }

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
    tethers.push({ a, b, length: Math.max(MIN_LENGTH, halfSize(a) + halfSize(b) + SLACK), lastD: 0, blocked: 0, stuckX: NaN, stuckY: 0, stuckD: 0 });
  }
}

export function clearTethers() {
  for (const t of tethers) { t.a.partner = t.b.partner = null; dangle(t.a, false); dangle(t.b, false); }
  tethers.length = 0;
}

/** A mystery box became its item: the string moves to the item */
export function retie(from: ItemView, to: ItemView) {
  for (const t of tethers) {
    if (t.a === from) t.a = to; else if (t.b === from) t.b = to; else continue;
    to.partner = from.partner; if (from.partner) from.partner.partner = to;
    from.partner = null;
    dangle(from, false);
  }
}

const inWorld = (it: ItemView) => !it.waiting && !it.held && it.body.enabled && it.node.activeInHierarchy;

/** Start / stop dangling: drawn in front of the bag rim while it hangs */
function dangle(it: ItemView, on: boolean) {
  it.dangling = on;
  // also after a drop: the hand puts every item back in the item layer
  const to = on ? frontLayer : itemLayer;
  if (to && it.node.parent !== to && !it.held && it.node.isValid) it.node.setParent(to, true);
}

/** The item of the pair that dangles from the other one now, or null */
function danglerOf(t: Tether): ItemView | null {
  const a = t.a, b = t.b;
  if (a.held && b.held) return null;
  // an item with its centre in the bag never dangles (one that pokes out a little would otherwise be
  // pulled across the packed items)
  const anchored = (anchor: ItemView, it: ItemView) => inWorld(it) && !it.isStatic
    && (anchor.held || (inWorld(anchor) && bagZone(anchor).fullyInside)) && !centreInBag(it);
  if (anchored(a, b)) return b;
  if (anchored(b, a)) return a;
  return null;
}

/** Every frame, before the physics step: a dangling item hangs on the string under its anchor */
export function tickTethers() {
  for (const t of tethers) {
    const it = danglerOf(t), anchor = it === t.a ? t.b : t.a;
    dangle(t.a, it === t.a); dangle(t.b, it === t.b);
    if (!it) continue;
    // world positions: a held anchor lives in the held layer, the dangling item in the front layer
    const pa = anchor.node.worldPosition, pb = it.node.worldPosition;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy);
    const stretch = d - t.length;
    if (stretch <= TOLERANCE || d < 1e-3) { t.blocked = 0; t.stuckX = NaN; continue; }
    // blocked against the bag: the string just holds it there (it kept knocking on the wall) until
    // the anchor moves or the string is stretched further
    let held = false;
    if (!Number.isNaN(t.stuckX)) {
      if (Math.hypot(pa.x - t.stuckX, pa.y - t.stuckY) < UNSTICK_MOVE && d < t.stuckD + UNSTICK_MOVE) held = true;
      else { t.stuckX = NaN; t.blocked = 0; }
    }
    if (!held) {
      if (d > t.lastD - .3) { if (++t.blocked > BLOCKED_FRAMES) { t.stuckX = pa.x; t.stuckY = pa.y; t.stuckD = d; held = true; } }
      else t.blocked = 0;
      t.lastD = d;
    }
    const nx = dx / d, ny = dy / d;
    const v = it.body.linearVelocity;
    // the anchor does not move with the string: only the dangling item's speed along it counts
    const rel = v.x * nx + v.y * ny;                                   // m/s, > 0: moving away
    const want = held ? 0 : -Math.min(MAX_PULL, stretch / PTM * PULL_RATE);
    if (rel <= want) continue;                                         // already coming back fast enough
    const dv = want - rel;                                             // < 0
    it.body.linearVelocity = v.set(v.x + nx * dv, v.y + ny * dv);
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
