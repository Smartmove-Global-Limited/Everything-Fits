// Touch control (ported from the web game, src/game/input.js):
//   - tap an item (no drag)    = select it; a rotate handle appears at its top-right corner
//   - drag the handle          = rotate the item around itself; it holds its angle for a moment
//   - while one is selected    = a press anywhere else (empty space or another item) also turns it;
//                                a tap on another item selects that one, a tap on empty space unselects
//   - touch-and-drag an item   = pick it up: it leaves the physics world and follows
//                                the finger, lifted above it so the player sees the whole item, drawn
//                                above the bag rim; a thin outline shows green (fits) or red ("ghost":
//                                overlaps something or pokes into the bag without fitting, item at 60%);
//                                released as a ghost it goes back to the tray; only that item is held:
//                                a tied partner stays a normal body, pulled along by the string (Tethers)
// Lives on the Field node (full design area). Per-frame work is done by tick(), called from the
// GameController loop, Cocos never calls an update() here.
import { _decorator, Component, Node, EventTouch, Vec2, Vec3, Color, PhysicsSystem2D, UITransform, Graphics, ERigidBody2DType, sys, Camera, director } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { DESIGN_W, levelToFieldY, FLOOR_Y, PTM } from '../core/GameConstants';
import { ItemView } from './ItemView';
import { computeGhost, overlapsInterior, bagZone, findFreeSpot, itemAABB, beginSpotBatch } from './BagRules';
import { isFreezing, freezeItem } from './BoosterEffects';
import { wakeAll } from './Settle';
import { KEY_ID } from './MysteryBox';
const { ccclass, property } = _decorator;

const DRAG_START = 7;                       // pointer travel that turns a touch into a drag
/**
 * Pointer travel that turns a press on an item into a pick-up. A real fingertip wobbles more than
 * DRAG_START on a tap: the tap picked the item up instead of selecting it (no rotate button, it
 * took a second tap)
 */
const TAP_SLOP = 14;
/**
 * Touch area around every item, for picking only (drag / select / rotate): a finger that lands
 * this close to an item takes it, so small items are easy to grab. The colliders do not change:
 * the item touches other items and the bag with its real shape, and once taken the extra area
 * is gone (it is only looked at when a touch starts).
 */
const TOUCH_PAD = 14;
const HANDLE_EDGE = 3, HANDLE_PAD = 12;     // rotate button: always hit within its radius + EDGE, + PAD where no other item is
/**
 * The held item is lifted so its lowest point sits FINGER_CLEARANCE above the finger, wherever it
 * was grabbed (lifting the centre by half its size + 26 left a small item grabbed near its top edge
 * under the fingertip). Up to LIFT_MAX: a big item is seen anyway. Set once when it is picked up
 * and kept: the item stays the same distance from the finger (eased in, a fast swipe saw it fly
 * away from the finger and back; recomputed per angle, a second-finger turn made it bob up and down).
 */
const LIFT_MAX = 150, FINGER_CLEARANCE = 48;
const DEMO_ID = -1000;                      // touch id of the tutorial's turn (no real finger has it)
const TWIST_GAIN = 1.3;                     // second-finger turn while held: item turns this × the finger's turn (asked: a bit faster)
const TWIST_MIN_R = 14;                     // second finger closer than this to the item centre: no turn (the angle jumps there)
const LIFT_MOUSE = 8;                       // with a mouse only a small lift
const HOLD_AFTER_SPIN = 1000;               // ms an item keeps its new angle inside the bag after rotating
const MAX_TURN = 24;                          // rad/s: fastest turn of the rotate handle (about 4 turns a second)
const TURN_GAIN = 30;                         // 1/s: spin = angle still to turn × this (closes it in about 1/30 s)
const HOME_PULL = 6;                          // 1/s: a turning item drifts back to where the turn began
const MAX_LEAD = 45;                          // degrees the finger may run ahead of the item
const STUCK_FRAMES = 20, STUCK_TURN = 4, STUCK_LEAD = 8;  // turned < 4° in the last 20 frames (1/3 s), finger > 8° ahead: stuck
const STEP = 1 / 60;                          // s, one physics step
const TURN_FRICTION = .02;                    // the turning item is slick: neighbours slide off it
const CLIMB_RISE = 1.5;                       // m/s: how fast a neighbour may lift the turning item onto itself
/**
 * Node angle in degrees, from the rotation quaternion. Do not read node.angle on physics bodies:
 * Box2D writes the rotation as a quaternion and node.angle keeps returning the old euler value
 * (eulerAngles too on the native build).
 */
export const angleOf = (n: Node) => { const q = n.rotation; return 2 * Math.atan2(q.z, q.w) * 180 / Math.PI; };
/** Distance from (px, py) to the segment a–b */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** The key of the mystery box stays where the level put it: it cannot be picked up, turned or selected */
const fixed = (it: ItemView) => it.itemId === KEY_ID;
/** a − b in degrees, folded into −180..180 */
const turnDiff = (a: number, b: number) => ((a - b) % 360 + 540) % 360 - 180;
/**
 * Turn an item and tell Box2D at once. On the native build the body does not always pick up a
 * node angle set from script: it kept its old angle and turned the item back when let go.
 */
function setAngle(it: ItemView, deg: number) {
  it.node.angle = deg;
  (it.body as any).impl?.syncRotationToPhysics?.();
}
/** One finger turning the selected item: its last angle round the item (rad), where it landed, past the tap wobble */
type SpinFinger = { pointer: number; sx: number; sy: number; moved: boolean };
const SELECT_INK = new Color(0xE2, 0x63, 0x7F, 255), BUTTON_SHADOW = new Color(59, 42, 74, 56);   // web #E2637F, rgba(59,42,74,.22)
const FIT_INK = new Color(0x3D, 0xBE, 0x78, 255), GHOST_INK = new Color(0xE5, 0x48, 0x4D, 255);
const OPAQUE = new Color(255, 255, 255, 255), GHOST_ALPHA = new Color(255, 255, 255, 153);   // web: globalAlpha .6
const POP_MS = 220, POP_GAIN = .09;                                                            // item swells once when picked up

export type DragEvents = {
  onPick?(item: ItemView): void; onDrop?(item: ItemView, bounced: boolean): void; onSelect?(item: ItemView | null): void;
  /** the player let go of the rotate handle after turning `item` by `degrees` */
  onRotate?(item: ItemView, degrees: number): void;
  /** the player's finger started turning `item` (not the tutorial's turn) */
  onTurnStart?(item: ItemView): void;
};

@ccclass('DragController')
export class DragController extends Component {
  @property({ type: Graphics, tooltip: 'Draws the rotate handle of the selected item' }) handle: Graphics | null = null;
  @property({ type: Node, tooltip: 'Layer above the bag rim: the held item is moved here while dragged' }) heldLayer: Node = null!;
  @property({ type: Graphics, tooltip: 'Outline of the held item (green fits / red does not), child of heldLayer' }) outline: Graphics = null!;
  @property({ type: Node, tooltip: 'Layer the items live in when not held' }) itemLayer: Node = null!;

  events: DragEvents = {};
  private transform: UITransform = null!;
  private camera: Camera = null!;
  private pending: { item: ItemView; x: number; y: number; id: number } | null = null;
  /** lead: degrees the finger is ahead of the item (never wrapped); pointer / lastAngle: last finger
   *  angle (rad) and item angle (deg) it was measured from; blocked / stuckDir: the item is stuck
   *  turning that way; turns: its turn in the last frames; bottom: height of its lowest point when
   *  the turn began */
  /** fingers: every finger turning the item (the first one, `id`, may also be a tap), each with
   *  its last angle round the item (rad) and where it landed; multi: more than one finger took part
   *  (then the end is never a tap) */
  private spin: { item: ItemView; id: number; startAngle: number; fingers: Map<number, SpinFinger>; multi: boolean; lead: number; lastAngle: number; blocked: boolean; stuckDir: number; turns: number[]; bottom: number; x0: number; moved: boolean; tapped: ItemView | null; demo?: boolean; hover?: boolean } | null = null;
  /**
   * Second finger turning the held item (same gesture as the one-finger turn: round the item's
   * centre). Set when a finger lands while another one holds or is about to pick up an item; that
   * finger only ever turns the held item, it never selects, picks or turns anything else.
   * x / y: its last position; turned: degrees turned so far.
   */
  private twist: { id: number; x: number; y: number; sx: number; sy: number; moved: boolean; turned: number } | null = null;
  private readonly tmpWorld = new Vec3();
  private readonly tmpLocal = new Vec3();
  private readonly tmpV2 = new Vec2();
  private readonly tmpOut = new Vec2();
  private popAt = 0;

  onLoad() {
    this.transform = this.getComponent(UITransform)!;
    this.camera = director.getScene()!.getComponentInChildren(Camera)!;
    this.node.on(Node.EventType.TOUCH_START, this.onStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onEnd, this);
    this.raiseHandle();
  }

  onDestroy() { this.node.targetOff(this); }

  /**
   * The rotate handle goes on top of everything (items, bag rim, the booster bar), like the
   * highest sorting order: its layer moves to the end of the Canvas. Popups opened later are added
   * after it, so they still cover it. It is a picture only (asked): it has no touch area of its own,
   * every touch goes to the field under it. (A touch node that followed the button was cancelled by
   * Cocos when the button hid as the item was picked up, which dropped the item at once.)
   */
  private raiseHandle() {
    const g = this.handle, canvas = this.node.parent;
    if (!g || !canvas) return;
    g.node.setParent(canvas, true);
  }

  /** Pointer position in Field space (origin bottom-left of the design area) */
  private local(e: EventTouch) {
    // screen pixels → world through the UI camera (the Canvas does not follow the screen size,
    // see ScreenFit), → Field space. Field anchor is bottom-left (0, 0): node space == Field space
    const p = e.getLocation(this.tmpV2);
    this.tmpWorld.set(p.x, p.y, 0);
    this.camera.screenToWorld(this.tmpWorld, this.tmpWorld);
    this.transform.convertToNodeSpaceAR(this.tmpWorld, this.tmpLocal);
    return this.tmpLocal;
  }

  private pickAt(x: number, y: number): ItemView | null {
    return this.itemUnder(x, y) || this.nearestAt(this.tmpLocal.x, this.tmpLocal.y);
  }
  /** The item whose shape is right under the finger (no margin around it), the one drawn on top */
  private itemUnder(x: number, y: number): ItemView | null {
    this.tmpWorld.set(x, y, 0);
    this.transform.convertToWorldSpaceAR(this.tmpWorld, this.tmpLocal);
    this.tmpV2.set(this.tmpLocal.x, this.tmpLocal.y);
    const hits = PhysicsSystem2D.instance.testPoint(this.tmpV2);
    // several items can overlap the finger: take the one drawn on top (highest sibling index)
    let best: ItemView | null = null;
    for (const c of hits) {
      const v = c.node.getComponent(ItemView);   // only on touch, not per frame
      if (v && !v.waiting && !fixed(v) && (!best || v.node.getSiblingIndex() > best.node.getSiblingIndex())) best = v;
    }
    return best;
  }

  /** No item under the finger: the closest one within TOUCH_PAD of its outline (world = Field space) */
  private nearestAt(x: number, y: number): ItemView | null {
    let best: ItemView | null = null, bestD = TOUCH_PAD;
    for (const it of GameState.items) {
      if (it.waiting || !it.node.activeInHierarchy || !it.body?.enabled || fixed(it)) continue;
      const polys = it.shapes, b = it.bounds;
      if (x < b.xMin - bestD || x > b.xMax + bestD || y < b.yMin - bestD || y > b.yMax + bestD) continue;
      for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const d = segmentDistance(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
          // equally close: the one drawn on top
          if (d < bestD || (d === bestD && best && it.node.getSiblingIndex() > best.node.getSiblingIndex())) { bestD = d; best = it; }
        }
      }
    }
    return best;
  }

  // ---------- rotate handle (web input.js rotateButtonPos / rotButtonR) ----------
  /** The item's rotate spot (its edge at the top-right, ItemView.handleSpot), following the item's rotation */
  private handlePos(item: ItemView, out: Vec3): Vec3 {
    this.tmpV2.set(item.handleSpot);
    Vec2.transformMat4(this.tmpV2, this.tmpV2, item.node.worldMatrix);
    return out.set(this.tmpV2.x, this.tmpV2.y, 0);
  }
  /** Button radius: smaller on a small item (a hairbrush at .79 is 60×36: a 14 button covered most of it) */
  private handleRadius(item: ItemView) {
    const box = item.localBox;
    return Math.max(8, Math.min(14, Math.min(box.width, box.height) * item.levelScale * .22));
  }
  /**
   * On the selected item's rotate button. The button itself always wins; the margin around it
   * (easier to hit) only where no item is under the finger: on the selected item itself the press
   * picks it up (the margin swallowed the whole of a small item: it could not be dragged), on
   * another item it is that item's tap.
   */
  private hitHandle(x: number, y: number): boolean {
    const sel = GameState.selected; if (!sel) return false;
    const p = this.node.inverseTransformPoint(this.tmpWorld, this.handlePos(sel, this.tmpWorld));   // Field space, like x / y
    const d = Math.hypot(x - p.x, y - p.y), R = this.handleRadius(sel);
    if (d <= R + HANDLE_EDGE) return true;
    if (d > R + HANDLE_PAD) return false;
    return !this.itemUnder(x, y);
  }

  // ---------- touch ----------
  private onStart(e: EventTouch) {
    const S = GameState;
    if (S.won || S.lost || S.paused) return;
    this.demoTurnEnd();   // the tutorial's turn gives way to the player's touch
    const p = this.local(e).clone(), id = e.getID();   // a copy: the hit tests below reuse the scratch vector
    // another finger already holds an item (or pressed one, not moved yet): this one turns it.
    // A third finger, or one during a one-finger turn, is ignored (never selects / picks another item)
    if (S.drag || this.pending) {
      if (!this.twist && id !== (S.drag ? S.drag.touchId : this.pending!.id)) this.twist = { id, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, turned: 0 };
      return;
    }
    // a turn in progress: another finger turns the same item too (asked: one finger on its right,
    // one on its left, each turns it its own way round, no full circle to come round the other side).
    // It never selects, picks or turns another item
    if (this.spin) {
      const sp = this.spin, c = sp.item.node.position;
      if (!sp.fingers.has(id)) { sp.fingers.set(id, { pointer: Math.atan2(p.y - c.y, p.x - c.x), sx: p.x, sy: p.y, moved: false }); sp.multi = true; }
      return;
    }
    if (this.twist) return;
    // a press on the selected item, or on its rotate button, always picks it up (asked): the button
    // only marks the item as the one that turns, it never starts a turn itself (a finger pulling
    // away from the button turned the item by a few degrees and seemed to freeze it). Turning it:
    // a press anywhere off the item, see below
    if (S.selected && (this.itemUnder(p.x, p.y) === S.selected || this.hitHandle(p.x, p.y))) {
      this.pending = { item: S.selected, x: p.x, y: p.y, id }; return;
    }
    const item = this.pickAt(p.x, p.y);
    // an item is selected (rotate mode): a press anywhere but on it turns it, even on another
    // item; only a tap (no move) on another item selects that one, a tap on empty space unselects
    if (S.selected && item !== S.selected) { this.beginSpin(S.selected, p.x, p.y, id, item); return; }
    if (!item) return;
    this.pending = { item, x: p.x, y: p.y, id };
  }

  private onMove(e: EventTouch) {
    const p = this.local(e), id = e.getID();
    if (this.twist && id === this.twist.id) { this.moveTwist(p.x, p.y); return; }
    const f = this.spin?.fingers.get(id);
    if (f) {
      // a tap that wobbles a little is still a tap, not a turn
      if (f.moved || Math.hypot(p.x - f.sx, p.y - f.sy) > DRAG_START) { f.moved = true; this.moveSpin(f, p.x, p.y); }
      return;
    }
    const pd = this.pending;
    if (pd && id === pd.id) {
      if (Math.hypot(p.x - pd.x, p.y - pd.y) > TAP_SLOP) {
        this.pickUp(pd.item, pd.x, pd.y, id, !sys.isMobile && !(e.touch as any)?._isTouch);
        GameState.drag!.targetX = p.x; GameState.drag!.targetY = p.y;
        this.pending = null;
      }
      return;
    }
    const d = GameState.drag;
    if (d && id === d.touchId) { d.targetX = p.x; d.targetY = p.y; }
  }

  private onEnd(e: EventTouch) {
    const id = e.getID();
    if (this.twist && id === this.twist.id) { this.endTwist(); return; }
    if (this.spin?.fingers.has(id)) {
      const sp = this.spin; sp.fingers.delete(id);
      if (sp.fingers.size) return;   // another finger still turns it
      this.spin = null;
      this.letGo(sp);
      // turned into a neighbour: wake everything so the overlap is pushed apart, not left asleep
      if (sp.moved) { this.holdAfterSpin(sp.item); wakeAll(); this.events.onRotate?.(sp.item, angleOf(sp.item.node) - sp.startAngle); }
      else if (sp.multi) { /* two fingers pressed, none turned: no tap */ }
      else if (sp.tapped) this.select(sp.tapped);
      else { const p = this.local(e); if (!this.hitHandle(p.x, p.y)) this.select(null); }
      return;
    }
    if (this.pending && id === this.pending.id) {
      const it = this.pending.item; this.pending = null;
      this.twist = null;   // a second finger waiting for a pick-up: forget it (its moves / lift are ignored)
      this.select(GameState.selected === it ? null : it);
      return;
    }
    const d = GameState.drag;
    if (d && id === d.touchId) {
      this.endTwist();
      this.drop();
    }
  }

  // ---------- a turn driven by a tutorial ----------
  /**
   * The tutorial turns the selected item for real, through the same turn as a finger (soft, the
   * item pushes its neighbours, stuck it stops): demoTurnStart, demoTurnBy per frame, demoTurnEnd.
   * A touch meanwhile ends it at once and is the player's own (onStart).
   * `hover`: the item stays where it is in the air meanwhile (no gravity), it falls when the turn ends
   * (an item just dropped into the bag, turned there by the hold + turn hint).
   */
  demoTurnStart(item: ItemView, hover = false): boolean {
    if (this.spin || this.pending || GameState.drag) return false;
    const p = item.node.position;
    this.beginSpin(item, p.x, p.y, DEMO_ID);
    this.spin!.demo = true; this.spin!.multi = true;
    if (hover) { this.spin!.hover = true; item.body.gravityScale = 0; item.stop(); }
    return true;
  }
  /** false once the tutorial's turn is over (a touch of the player ended it) */
  demoTurnBy(deg: number): boolean {
    if (!this.spin?.demo) return false;
    if (deg) this.addTurn(deg);
    return true;
  }
  demoTurnEnd() {
    const sp = this.spin; if (!sp?.demo) return;
    this.spin = null;
    this.letGo(sp);
    if (sp.hover) { sp.item.body.gravityScale = 1; sp.item.body.wakeUp(); }
    // no onRotate: the player did not turn it. The angle it was turned to is kept
    if (sp.moved) { this.holdAfterSpin(sp.item); wakeAll(); }
  }

  // ---------- second finger turns the held item ----------
  /**
   * Same gesture as the one-finger turn (the finger goes round the item's centre), applied straight
   * to the angle: the held item is out of the physics world, so turning it pushes nothing (the
   * shaking of the old turns came from a body turned into its neighbours). The turn is the change
   * of the finger's angle measured from the item's centre of this moment, for both the old and the
   * new finger position: moving the item with the first finger alone never turns it.
   */
  private moveTwist(x: number, y: number) {
    const tw = this.twist!, d = GameState.drag;
    if (!d || d.touchId === tw.id) { tw.x = x; tw.y = y; return; }   // not picked up yet: just follow
    if (!tw.moved && Math.hypot(x - tw.sx, y - tw.sy) <= DRAG_START) return;   // a wobble is no turn
    tw.moved = true;
    const c = d.item.node.position;
    const r0 = Math.hypot(tw.x - c.x, tw.y - c.y), r1 = Math.hypot(x - c.x, y - c.y);
    const ox = tw.x, oy = tw.y;
    tw.x = x; tw.y = y;
    if (r0 < TWIST_MIN_R || r1 < TWIST_MIN_R) return;
    const deg = turnDiff(Math.atan2(y - c.y, x - c.x) * 180 / Math.PI, Math.atan2(oy - c.y, ox - c.x) * 180 / Math.PI);
    if (deg) { this.turnHeld(d, deg * TWIST_GAIN); tw.turned += deg * TWIST_GAIN; }
  }
  /** Turn the held item round its own centre: the finger → centre offset is kept in screen axes */
  private turnHeld(d: NonNullable<typeof GameState.drag>, deg: number) {
    const it = d.item, a0 = angleOf(it.node), r0 = a0 * Math.PI / 180;
    let c = Math.cos(r0), s = Math.sin(r0);
    const wx = d.offsetX * c - d.offsetY * s, wy = d.offsetX * s + d.offsetY * c;
    const a1 = a0 + deg, r1 = a1 * Math.PI / 180;
    it.node.angle = a1;
    c = Math.cos(r1); s = Math.sin(r1);
    d.offsetX = wx * c + wy * s; d.offsetY = -wx * s + wy * c;
    d.twisted = true;
  }
  private endTwist() {
    const tw = this.twist; this.twist = null;
    const d = GameState.drag;
    if (tw?.moved && d) this.events.onRotate?.(d.item, tw.turned);
  }

  private select(item: ItemView | null) {
    // the item just turned on the tray keeps its angle only while selected: let go of it, so an
    // item turned into another one is pushed apart instead of staying stuck on it
    const prev = GameState.selected;
    if (prev && prev !== item && prev.holdUntil === Infinity) { prev.holdUntil = 0; prev.spunAt = GameState.clock; wakeAll(); }
    GameState.selected = item;
    this.events.onSelect?.(item);
  }

  /**
   * A new round (open / restart / next level): forget a drag or a turn in progress and wipe what
   * they drew. Without it the red outline of an item held while the level changed stayed on screen.
   */
  reset() {
    // an item still in the hand goes back to the world: pooled for the next round, it kept its
    // body switched off and floated where it was let go
    const d = GameState.drag;
    if (d) { GameState.drag = null; this.clearHeld(d.item); d.item.endHold(); }
    if (this.spin?.demo) { if (this.spin.hover) this.spin.item.body.gravityScale = 1; this.letGo(this.spin); this.spin = null; }   // a new round: no hold after it
    this.letGo(this.spin);
    this.pending = null; this.spin = null; this.twist = null;
    this.outline.clear();
    this.handle?.clear(); this.drawnKey = '';
  }

  // ---------- pick / move / drop ----------
  pickUp(item: ItemView, x: number, y: number, touchId: number, mouse = false) {
    const S = GameState;
    this.select(null);
    S.bagSnapshot = null;
    item.holdUntil = 0; item.frozen = false;
    item.beginHold();
    // above the bag rim while held (else dragging it out of the bag looks like it slides under it)
    item.node.setParent(this.heldLayer, true);
    wakeAll();   // what it was holding up falls (sleeping clusters, see Settle)
    this.outline.node.setSiblingIndex(this.heldLayer.children.length - 1);
    this.popAt = S.clock;
    const p = item.node.position;
    const a = -angleOf(item.node) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = x - p.x, dy = y - p.y;
    const offsetX = dx * c - dy * s, offsetY = dx * s + dy * c;
    // finger: lowest point FINGER_CLEARANCE above it. dy is finger − centre (y, screen axes)
    const lift = mouse ? LIFT_MOUSE : Math.min(LIFT_MAX, Math.max(0, FINGER_CLEARANCE + dy + item.below(-a)));
    S.drag = { item, offsetX, offsetY, targetX: x, targetY: y, lift, liftTo: lift, mouse, twisted: false, ghost: true, lastValid: null, touchId };
    this.events.onPick?.(item);
  }

  /** Called every frame by the game loop */
  tick(_dt: number) {
    const S = GameState, d = S.drag;
    if (this.spin?.moved) this.holdSpinPosition();
    this.releaseSpinHolds();
    this.drawHandle();
    if (!d) return;
    const it = d.item;
    const a = angleOf(it.node) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    // pop: swell once and back (the body is out of the world, scaling the node is free)
    const t = (S.clock - this.popAt) / POP_MS;
    const k = it.levelScale * (t < 1 ? 1 + Math.sin(t * Math.PI) * POP_GAIN : 1);
    if (it.node.scale.x !== k) it.node.setScale(k, k, 1);
    let x = d.targetX - (d.offsetX * c - d.offsetY * s);
    let y = d.targetY - (d.offsetX * s + d.offsetY * c) + d.lift;
    it.node.setPosition(x, y, 0);
    // keep the item above the tray floor and inside the screen sides (exact shape, this frame)
    const r = itemAABB(it), floor = levelToFieldY(FLOOR_Y + GameState.floorDrop);
    let fx = 0, fy = 0;
    if (r.yMin < floor + 1) fy = floor + 1 - r.yMin;
    if (r.xMin < 0) fx = -r.xMin; else if (r.xMax > DESIGN_W) fx = DESIGN_W - r.xMax;
    if (fx || fy) { x += fx; y += fy; it.node.setPosition(x, y, 0); }
    d.ghost = computeGhost(it);
    if (!d.ghost) { const lv = d.lastValid || (d.lastValid = { x: 0, y: 0, angle: 0 }); lv.x = x; lv.y = y; lv.angle = angleOf(it.node); }
    this.drawHeld(it, d.ghost);
  }

  /** Web look: 60% item + red outline when it does not fit, green outline when it does (no copy of the item as a shadow) */
  private drawHeld(it: ItemView, ghost: boolean) {
    if (it.sprite) it.sprite.color = ghost ? GHOST_ALPHA : OPAQUE;
    const g = this.outline;
    g.clear();
    g.strokeColor = ghost ? GHOST_INK : FIT_INK;
    g.lineWidth = 2;
    const m = it.node.worldMatrix, pts = it.outline;
    if (pts.length >= 3) {
      for (let i = 0; i < pts.length; i++) {
        const v = Vec2.transformMat4(this.tmpOut, pts[i], m);
        if (i) g.lineTo(v.x, v.y); else g.moveTo(v.x, v.y);
      }
      g.close(); g.stroke();
    } else {
      for (const poly of it.shapes) {
        for (let i = 0; i < poly.length; i++) if (i) g.lineTo(poly[i].x, poly[i].y); else g.moveTo(poly[i].x, poly[i].y);
        g.close(); g.stroke();
      }
    }
  }

  private clearHeld(it: ItemView) {
    this.outline.clear();
    if (it.sprite) it.sprite.color = OPAQUE;
    it.node.setScale(it.levelScale, it.levelScale, 1);
    it.node.setParent(this.itemLayer, true);           // on top of the other items
  }

  drop() {
    const S = GameState, d = S.drag; if (!d) return;
    const it = d.item;
    S.drag = null;
    this.clearHeld(it);
    // snapshot the packed items, to undo pushes if this drop turns out not to fit
    S.bagSnapshot = { dropped: it, list: S.items.filter(o => o !== it && !o.waiting && bagZone(o).fullyInside).map(o => ({ item: o, x: o.node.position.x, y: o.node.position.y, angle: angleOf(o.node) })) };
    let bounced = false;
    if (d.ghost) {
      beginSpotBatch();
      if (bagZone(it).inZone && overlapsInterior(it)) {   // does not fit in the bag → back to the tray
        const spot = findFreeSpot(it, it.node.position.x);
        it.node.setPosition(spot.x, spot.y, 0); bounced = true;
      } else if (d.lastValid) { it.node.setPosition(d.lastValid.x, d.lastValid.y, 0); setAngle(it, d.lastValid.angle); }
      else { const spot = findFreeSpot(it, it.node.position.x); it.node.setPosition(spot.x, spot.y, 0); }
    }
    it.endHold();
    // turned by a second finger while out of the world: tell Box2D the new angle (see setAngle)
    if (d.twisted) setAngle(it, angleOf(it.node));
    it.releasedAt = S.clock;
    // Freeze booster running: an item dropped into the bag stays exactly where it was dropped
    if (!bounced && isFreezing() && bagZone(it).fullyInside) freezeItem(it);
    if (bounced) it.body.linearVelocity = it.body.linearVelocity.set((Math.random() - .5) * 96 / PTM, 0);   // web ±.8 units/step sideways
    this.events.onDrop?.(it, bounced);
  }

  // ---------- rotation ----------
  // The item stays a normal dynamic body while it is turned and while its new angle is held
  // (web input.js tickRotation / giuGocSauXoay): only its angle is locked and its sliding damped.
  // Turned into a neighbour, both push each other apart; a kinematic body would shove the
  // neighbour forever, and one squeezed against a wall shakes non-stop.
  /** `tapped`: the other item under the finger, selected instead if the press ends without moving */
  private beginSpin(item: ItemView, x: number, y: number, id: number, tapped: ItemView | null = null) {
    const p = item.node.position;
    // nothing is done to the item until the finger really turns it: a tap only (un)selects
    const a = angleOf(item.node);
    const fingers = new Map<number, SpinFinger>([[id, { pointer: Math.atan2(y - p.y, x - p.x), sx: x, sy: y, moved: false }]]);
    this.spin = { item, id, moved: false, startAngle: a, fingers, multi: false, lead: 0, lastAngle: a, blocked: false, stuckDir: 0, turns: [], bottom: 0, x0: p.x, tapped };
  }
  /** Finger `f` moved to (x, y): its turn round the item is added to the turn (several fingers add up) */
  private moveSpin(f: SpinFinger, x: number, y: number) {
    const p = this.spin!.item.node.position;
    // the finger's turn since the last move, folded so crossing ±180° never flips the direction
    const pointer = Math.atan2(y - p.y, x - p.x);
    const d = turnDiff(pointer * 180 / Math.PI, f.pointer * 180 / Math.PI);
    f.pointer = pointer;
    this.addTurn(d);
  }
  /** `d` more degrees for the turning item to go (a finger's turn, or the tutorial's) */
  private addTurn(d: number) {
    const sp = this.spin!, it = sp.item, p = it.node.position;
    if (!sp.moved) {
      sp.moved = true;
      it.holdUntil = 0;
      it.holdAngle = angleOf(it.node);
      it.body.type = ERigidBody2DType.Dynamic;
      it.body.fixedRotation = false;   // held after an earlier turn: the turn spins it
      it.stop();
      sp.lastAngle = angleOf(it.node);
      sp.bottom = p.y - it.below(sp.lastAngle * Math.PI / 180);
      it.turning = true;
      this.slick(it, true);
      if (!sp.demo) this.events.onTurnStart?.(it);
    }
    // stuck: turning on does nothing (pushing again and again shook it), turning back frees it
    if (sp.blocked) {
      if (Math.sign(d) === sp.stuckDir) return;
      sp.blocked = false; sp.turns.length = 0;
    }
    sp.lead = Math.max(-MAX_LEAD, Math.min(MAX_LEAD, sp.lead + d));
  }
  /**
   * After a turn the angle it was let go at is kept: Box2D's fixed rotation, so contacts and gravity
   * cannot turn it while it still falls and is pushed like any item. Holding it by spinning it back
   * fought gravity on an item left leaning (it shook non-stop and crept sideways). No sliding.
   */
  private holdAngle(it: ItemView, still: boolean) {
    if (!it.body.fixedRotation) it.body.fixedRotation = true;
    const v = it.body.linearVelocity;
    it.body.linearVelocity = v.set(0, still ? 0 : Math.min(0, v.y));
    it.body.angularVelocity = 0;
  }
  private letGo(sp: NonNullable<DragController['spin']> | null) {
    if (!sp) return;
    sp.item.turning = false;
    this.slick(sp.item, false);
  }
  /**
   * While it turns, the item is slick and does not bounce: an item lying on it or beside it is pushed
   * and slides away. With its own friction and bounce it dragged that item round and knocked it up
   * each time a corner came by: it shook non-stop. Back to its own once the finger lets go.
   */
  private slick(it: ItemView, on: boolean) {
    const kept = this.slickOf;
    for (const c of it.colliders) {
      if (on) {
        if (!kept.has(c)) kept.set(c, [c.friction, c.restitution]);
        c.friction = TURN_FRICTION; c.restitution = 0;
      } else {
        const k = kept.get(c); if (!k) continue;
        c.friction = k[0]; c.restitution = k[1]; kept.delete(c);
      }
      c.apply();
    }
  }
  private readonly slickOf = new Map<any, [number, number]>();
  /**
   * Spin the body towards `deg` more degrees, softly (proportional, not all in one step: a full step
   * shoved the neighbour every frame and the two shook against each other). The game is seen from
   * the side, so turning an item turns it over: on the floor its corner comes round into the floor
   * and Box2D lifts it out. It may rise only as far as its own shape needs at its next angle (its
   * lowest point kept where it was when the turn began, ItemView.below): the spin is set from
   * script, so the floor's push could be any size and the speed kept from it threw the item up (it
   * hopped). Turned into a neighbour it may also ride up onto it, slowly (CLIMB_RISE: a hop from
   * that speed is under one unit), as a real item turned against another one: stopping the turn
   * there (it did) made it jerk and stick. Sideways it keeps what the turn needs and is drawn back
   * to where the turn began.
   */
  private turnBy(it: ItemView, deg: number, bottom: number, homeX: number) {
    const now = angleOf(it.node) * Math.PI / 180;
    const w = Math.abs(deg) < .01 ? 0 : Math.max(-MAX_TURN, Math.min(MAX_TURN, deg * Math.PI / 180 * TURN_GAIN));
    const next = now + w * STEP;
    const rise = Math.max(CLIMB_RISE, (bottom + it.below(next) - it.node.position.y) / PTM / STEP);   // m/s
    const side = Math.abs(w) * Math.hypot(it.localBox.width, it.localBox.height) * it.levelScale / 2 / PTM;
    const v = it.body.linearVelocity;
    const vx = v.x + (homeX - it.node.position.x) / PTM * HOME_PULL;
    it.body.linearVelocity = v.set(Math.max(-side, Math.min(side, vx)), Math.min(rise, v.y));
    it.spin = w;
  }
  /**
   * Every frame of a turn: the finger runs ahead of the item by `lead` degrees and the item follows,
   * pushing what is in the way like a real one (a free neighbour is moved away). Stuck (it hardly
   * turns although the finger is well ahead: a shake back and forth adds up to nothing), it stops
   * and stays still, as a real item jammed against another: pushing on against it made the two
   * shake non-stop. Turning the finger back frees it.
   */
  private holdSpinPosition() {
    const sp = this.spin!, it = sp.item, a = angleOf(it.node);
    const turned = turnDiff(a, sp.lastAngle);
    sp.lastAngle = a;
    sp.lead -= turned;
    sp.turns.push(turned);
    if (sp.turns.length > STUCK_FRAMES) sp.turns.shift();
    const net = sp.turns.reduce((n, t) => n + t, 0);
    if (!sp.blocked && sp.turns.length === STUCK_FRAMES && Math.abs(net) < STUCK_TURN && Math.abs(sp.lead) > STUCK_LEAD) {
      sp.blocked = true; sp.stuckDir = Math.sign(sp.lead);
    }
    if (sp.blocked) sp.lead = 0;
    it.holdAngle = a + sp.lead;
    this.turnBy(it, sp.lead, sp.bottom, sp.x0);
    if (!sp.blocked) it.body.wakeUp();
  }
  /** After rotating: inside the bag keep the angle a moment, on the tray keep it until touched again */
  private holdAfterSpin(item: ItemView) {
    item.stop();
    item.holdAngle = angleOf(item.node);
    item.holdUntil = bagZone(item).inZone ? GameState.clock + HOLD_AFTER_SPIN : Infinity;
  }
  private releaseSpinHolds() {
    const now = GameState.clock;
    for (const it of GameState.items) {
      if (!it.holdUntil) { if (it.body.fixedRotation) it.body.fixedRotation = false; continue; }   // hold over: it turns freely again
      if (this.spin?.moved && this.spin.item === it) continue;
      it.stuckFrames = 0;
      // let go: awake and counted afresh by Settle (it must not take it as already at rest)
      if (it.holdUntil !== Infinity && now >= it.holdUntil) { it.holdUntil = 0; it.spunAt = now; it.stop(); it.restTime = 0; it.restX = NaN; it.body.wakeUp(); continue; }
      // in the bag: still a moment; on the tray: the angle stays, it may still fall
      this.holdAngle(it, it.holdUntil !== Infinity);
    }
    // a tray item kept still after rotating is released when anything else is picked up
    if (GameState.drag) for (const it of GameState.items) if (it.holdUntil === Infinity && !isHeld(it)) { it.holdUntil = 0; it.spunAt = now; it.restTime = 0; it.restX = NaN; it.body.wakeUp(); }
  }

  /**
   * Selected item (web render.js drawSelection): dashed pink outline 3 units out, and the round pink
   * rotate button with a white ring, a soft shadow and two curved arrows. Redrawn only when the
   * selection or its transform changes.
   */
  private drawnKey = '';
  private drawHandle() {
    const g = this.handle; if (!g) return;
    const sel = GameState.selected;
    const show = !!sel && !GameState.drag && sel.node.activeInHierarchy;
    const key = show ? `${sel!.levelIndex}|${sel!.node.position.x.toFixed(1)}|${sel!.node.position.y.toFixed(1)}|${sel!.node.rotation.z.toFixed(4)}|${sel!.levelScale}` : '';
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    g.clear();
    if (!show) return;
    const it = sel!;
    // dashed outline, pushed 3 units out from the centre of the shape
    g.strokeColor = SELECT_INK; g.lineWidth = 2;
    // world → the handle layer's own space (the same in the game; inside the Level Editor the
    // field sits elsewhere in its preview box)
    const m = it.node.worldMatrix, gn = g.node, w = this.tmpLocal;
    const local = (p: Vec2) => { w.set(p.x, p.y, 0); gn.inverseTransformPoint(w, w); return new Vec2(w.x, w.y); };
    const src = it.outline.length >= 3 ? [it.outline] : null;
    const polys: Vec2[][] = src ? src.map(pts => pts.map(p => local(Vec2.transformMat4(new Vec2(), p, m)))) : it.shapes.map(poly => poly.map(local));
    for (const poly of polys) dashedOutline(g, poly, 3, 5, 4);
    // button
    const R = this.handleRadius(it);
    const c = gn.inverseTransformPoint(this.tmpWorld, this.handlePos(it, this.tmpWorld));
    g.fillColor = BUTTON_SHADOW; g.circle(c.x, c.y - R * .18, R); g.fill();
    g.fillColor = SELECT_INK; g.circle(c.x, c.y, R); g.fill();
    g.strokeColor = Color.WHITE; g.lineWidth = Math.max(1.6, R * .18); g.circle(c.x, c.y, R); g.stroke();
    const rr = R * .46, t = R * .34;
    g.lineWidth = Math.max(1.7, R * .22); g.fillColor = Color.WHITE;
    for (const s0 of [0, Math.PI]) {
      // web angles are clockwise with y down: mirror y
      const a0 = s0 + .55, a1 = s0 + Math.PI - .18;
      for (let i = 0; i <= 12; i++) {
        const a = a0 + (a1 - a0) * i / 12, px = c.x + Math.cos(a) * rr, py = c.y - Math.sin(a) * rr;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.stroke();
      const ex = Math.cos(a1) * rr, ey = Math.sin(a1) * rr, tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1);
      g.moveTo(c.x + ex + tx * t, c.y - (ey + ty * t));
      g.lineTo(c.x + ex + nx * t * .62, c.y - (ey + ny * t * .62));
      g.lineTo(c.x + ex - nx * t * .62, c.y - (ey - ny * t * .62));
      g.close(); g.fill();
    }
  }
}

/** Dashed closed outline (Graphics has no line dash), pushed `grow` units away from the centre */
function dashedOutline(g: Graphics, pts: readonly Vec2[], grow: number, on: number, off: number) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const at = (i: number, out: Vec2) => { const p = pts[i % pts.length], dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1; return out.set(p.x + dx / l * grow, p.y + dy / l * grow); };
  const a = new Vec2(), b = new Vec2();
  let drawing = true, left = on;
  for (let i = 0; i < pts.length; i++) {
    at(i, a); at(i + 1, b);
    let len = Vec2.distance(a, b), ux = (b.x - a.x) / (len || 1), uy = (b.y - a.y) / (len || 1), x = a.x, y = a.y;
    while (len > 0) {
      const step = Math.min(left, len);
      if (drawing) { g.moveTo(x, y); g.lineTo(x + ux * step, y + uy * step); g.stroke(); }
      x += ux * step; y += uy * step; len -= step; left -= step;
      if (left <= 0) { drawing = !drawing; left = drawing ? on : off; }
    }
  }
}
