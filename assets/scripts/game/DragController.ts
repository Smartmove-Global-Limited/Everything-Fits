// Touch control (ported from the web game, src/game/input.js):
//   - tap an item (no drag)    = select it; a rotate handle appears at its top-right corner
//   - drag the handle          = rotate the item around itself; it holds its angle for a moment
//   - while one is selected    = a press anywhere else (empty space or another item) also turns it;
//                                a tap on another item selects that one, a tap on empty space unselects
//   - touch-and-drag an item   = pick it up: it leaves the physics world and follows
//                                the finger, lifted above it so the player sees the whole item, drawn
//                                above the bag rim; a thin outline shows green (fits) or red ("ghost":
//                                overlaps something or pokes into the bag without fitting, item at 60%);
//                                released as a ghost it goes back to the tray; a tied item (Tethers)
//                                brings its partner along, both keep their places relative to each other
// Lives on the Field node (full design area). Per-frame work is done by tick(), called from the
// GameController loop, Cocos never calls an update() here.
import { _decorator, Component, Node, EventTouch, Vec2, Vec3, Color, PhysicsSystem2D, UITransform, Graphics, ERigidBody2DType, sys, Camera, director } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { DESIGN_W, levelToFieldY, FLOOR_Y, PTM } from '../core/GameConstants';
import { ItemView } from './ItemView';
import { computeGhost, overlapsInterior, bagZone, findFreeSpot, itemAABB, beginSpotBatch } from './BagRules';
import { isFreezing, freezeItem } from './BoosterEffects';
import { wakeAll } from './Settle';
const { ccclass, property } = _decorator;

const DRAG_START = 7;                       // pointer travel that turns a touch into a drag
/**
 * Touch area around every item, for picking only (drag / select / rotate): a finger that lands
 * this close to an item takes it, so small items are easy to grab. The colliders do not change:
 * the item touches other items and the bag with its real shape, and once taken the extra area
 * is gone (it is only looked at when a touch starts).
 */
const TOUCH_PAD = 14;
const HANDLE_EDGE = 3, HANDLE_PAD = 12;     // rotate button: always hit within its radius + EDGE, + PAD where no other item is
const LIFT_MAX = 70, FINGER_CLEARANCE = 26; // item is lifted above the finger by up to this much
const LIFT_MOUSE = 8;                       // with a mouse only a small lift
const HOLD_AFTER_SPIN = 1000;               // ms an item keeps its new angle inside the bag after rotating
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
const SELECT_INK = new Color(0xE2, 0x63, 0x7F, 255), BUTTON_SHADOW = new Color(59, 42, 74, 56);   // web #E2637F, rgba(59,42,74,.22)
const FIT_INK = new Color(0x3D, 0xBE, 0x78, 255), GHOST_INK = new Color(0xE5, 0x48, 0x4D, 255);
const OPAQUE = new Color(255, 255, 255, 255), GHOST_ALPHA = new Color(255, 255, 255, 153);   // web: globalAlpha .6
const POP_MS = 220, POP_GAIN = .09;                                                            // item swells once when picked up

export type DragEvents = {
  onPick?(item: ItemView): void; onDrop?(item: ItemView, bounced: boolean): void; onSelect?(item: ItemView | null): void;
  /** the player let go of the rotate handle after turning `item` by `degrees` */
  onRotate?(item: ItemView, degrees: number): void;
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
  private spin: { item: ItemView; id: number; startAngle: number; startPointer: number; x0: number; moved: boolean; sx: number; sy: number; tapped: ItemView | null } | null = null;
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

  onDestroy() { this.node.targetOff(this); this.handleHit?.targetOff(this); }

  /**
   * The rotate handle goes on top of everything (items, bag rim, the booster bar), like the
   * highest sorting order: its layer moves to the end of the Canvas, and a touch area that follows
   * the button takes the touches on it before the booster buttons under it. Popups opened later
   * are added after it, so they still cover it.
   */
  private handleHit: Node | null = null;
  private raiseHandle() {
    const g = this.handle, canvas = this.node.parent;
    if (!g || !canvas) return;
    g.node.setParent(canvas, true);
    const hit = this.handleHit = new Node('HandleHit');
    hit.layer = g.node.layer;
    hit.addComponent(UITransform);
    canvas.addChild(hit);
    hit.active = false;
    hit.on(Node.EventType.TOUCH_START, this.onStart, this);
    hit.on(Node.EventType.TOUCH_MOVE, this.onMove, this);
    hit.on(Node.EventType.TOUCH_END, this.onEnd, this);
    hit.on(Node.EventType.TOUCH_CANCEL, this.onEnd, this);
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
      if (v && !v.waiting && (!best || v.node.getSiblingIndex() > best.node.getSiblingIndex())) best = v;
    }
    return best;
  }

  /** No item under the finger: the closest one within TOUCH_PAD of its outline (world = Field space) */
  private nearestAt(x: number, y: number): ItemView | null {
    let best: ItemView | null = null, bestD = TOUCH_PAD;
    for (const it of GameState.items) {
      if (it.waiting || !it.node.activeInHierarchy || !it.body?.enabled) continue;
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
  private handleRadius(item: ItemView) {
    const box = item.localBox;
    return Math.max(9, Math.min(14, Math.min(box.width, box.height) * item.levelScale * .3));
  }
  /**
   * On the selected item's rotate button. The button itself always wins; the margin around it
   * (easier to hit) only where no other item is right under the finger, else the margin of a
   * button resting next to another item swallowed the taps on that item.
   */
  private hitHandle(x: number, y: number): boolean {
    const sel = GameState.selected; if (!sel) return false;
    const p = this.node.inverseTransformPoint(this.tmpWorld, this.handlePos(sel, this.tmpWorld));   // Field space, like x / y
    const d = Math.hypot(x - p.x, y - p.y), R = this.handleRadius(sel);
    if (d <= R + HANDLE_EDGE) return true;
    if (d > R + HANDLE_PAD) return false;
    const under = this.itemUnder(x, y);
    return !under || under === sel;
  }

  // ---------- touch ----------
  private onStart(e: EventTouch) {
    const S = GameState;
    if (S.won || S.lost || S.paused || S.drag) return;
    const p = this.local(e).clone(), id = e.getID();   // a copy: the hit tests below reuse the scratch vector
    if (this.hitHandle(p.x, p.y)) { this.beginSpin(S.selected!, p.x, p.y, id); return; }
    const item = this.pickAt(p.x, p.y);
    // an item is selected (rotate mode): a press anywhere but on it turns it, even on another
    // item; only a tap (no move) on another item selects that one, a tap on empty space unselects
    if (S.selected && item !== S.selected) { this.beginSpin(S.selected, p.x, p.y, id, item); return; }
    if (!item) return;
    this.pending = { item, x: p.x, y: p.y, id };
  }

  private onMove(e: EventTouch) {
    const p = this.local(e), id = e.getID();
    if (this.spin && id === this.spin.id) {
      // a tap that wobbles a little is still a tap, not a turn
      if (this.spin.moved || Math.hypot(p.x - this.spin.sx, p.y - this.spin.sy) > DRAG_START) this.moveSpin(p.x, p.y);
      return;
    }
    const pd = this.pending;
    if (pd && id === pd.id) {
      if (Math.hypot(p.x - pd.x, p.y - pd.y) > DRAG_START) {
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
    if (this.spin && id === this.spin.id) {
      const sp = this.spin; this.spin = null;
      // turned into a neighbour: wake everything so the overlap is pushed apart, not left asleep
      if (sp.moved) { this.holdAfterSpin(sp.item); wakeAll(); this.events.onRotate?.(sp.item, angleOf(sp.item.node) - sp.startAngle); }
      else if (sp.tapped) this.select(sp.tapped);
      else { const p = this.local(e); if (!this.hitHandle(p.x, p.y)) this.select(null); }
      return;
    }
    if (this.pending && id === this.pending.id) {
      const it = this.pending.item; this.pending = null;
      this.select(GameState.selected === it ? null : it);
      return;
    }
    const d = GameState.drag;
    if (d && id === d.touchId) this.drop();
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
    if (d) { GameState.drag = null; for (const o of d.partner ? [d.item, d.partner] : [d.item]) { this.clearHeld(o); o.endHold(); } }
    this.pending = null; this.spin = null;
    this.outline.clear();
    this.handle?.clear(); this.drawnKey = '';
    if (this.handleHit) this.handleHit.active = false;
  }

  // ---------- pick / move / drop ----------
  pickUp(item: ItemView, x: number, y: number, touchId: number, mouse = false) {
    const S = GameState;
    this.select(null);
    S.bagSnapshot = null;
    const partner = item.partner && item.partner.node.activeInHierarchy && !item.partner.waiting ? item.partner : null;
    for (const it of partner ? [item, partner] : [item]) {
      it.holdUntil = 0; it.frozen = false;
      it.beginHold();
      // above the bag rim while held (else dragging it out of the bag looks like it slides under it)
      it.node.setParent(this.heldLayer, true);
    }
    wakeAll();   // what it was holding up falls (sleeping clusters, see Settle)
    this.outline.node.setSiblingIndex(this.heldLayer.children.length - 1);
    this.popAt = S.clock;
    const p = item.node.position;
    const a = -angleOf(item.node) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = x - p.x, dy = y - p.y;
    const ui = item.transform2d;
    const lift = mouse ? LIFT_MOUSE : Math.min(LIFT_MAX, Math.max(ui.width, ui.height) * item.levelScale / 2 + FINGER_CLEARANCE);
    // the partner's place in the held item's own axes, so the pair turns and moves as one piece
    const q = partner ? partner.node.position : p, qx = q.x - p.x, qy = q.y - p.y;
    S.drag = { item, offsetX: dx * c - dy * s, offsetY: dx * s + dy * c, targetX: x, targetY: y, lift: 0, liftTo: lift, ghost: true, lastValid: null, touchId,
      partner, partnerX: qx * c - qy * s, partnerY: qx * s + qy * c, partnerAngle: partner ? angleOf(partner.node) - angleOf(item.node) : 0 };
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
    d.lift += (d.liftTo - d.lift) * .25;
    // pop: swell once and back (the body is out of the world, scaling the node is free)
    const t = (S.clock - this.popAt) / POP_MS;
    const k = it.levelScale * (t < 1 ? 1 + Math.sin(t * Math.PI) * POP_GAIN : 1);
    if (it.node.scale.x !== k) it.node.setScale(k, k, 1);
    const a = angleOf(it.node) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let x = d.targetX - (d.offsetX * c - d.offsetY * s);
    let y = d.targetY - (d.offsetX * s + d.offsetY * c) + d.lift;
    it.node.setPosition(x, y, 0);
    const pt = d.partner;
    if (pt) { if (pt.node.scale.x !== k * pt.levelScale / it.levelScale) pt.node.setScale(k * pt.levelScale / it.levelScale, k * pt.levelScale / it.levelScale, 1); this.placePartner(d); }
    // keep the item (and its partner) above the tray floor and inside the screen sides (exact shape, this frame)
    const r = itemAABB(it), floor = levelToFieldY(FLOOR_Y + GameState.floorDrop);
    let x0 = r.xMin, x1 = r.xMax, y0 = r.yMin;
    if (pt) { const r2 = itemAABB(pt); x0 = Math.min(x0, r2.xMin); x1 = Math.max(x1, r2.xMax); y0 = Math.min(y0, r2.yMin); }
    let fx = 0, fy = 0;
    if (y0 < floor + 1) fy = floor + 1 - y0;
    if (x0 < 0) fx = -x0; else if (x1 > DESIGN_W) fx = DESIGN_W - x1;
    if (fx || fy) { x += fx; y += fy; it.node.setPosition(x, y, 0); if (pt) this.placePartner(d); }
    d.ghost = computeGhost(it) || (!!pt && computeGhost(pt));
    if (!d.ghost) { const lv = d.lastValid || (d.lastValid = { x: 0, y: 0, angle: 0 }); lv.x = x; lv.y = y; lv.angle = angleOf(it.node); }
    this.outline.clear();
    this.drawHeld(it, d.ghost);
    if (pt) this.drawHeld(pt, d.ghost);
  }

  /** The partner of a held tied item, at its place relative to the held item */
  private placePartner(d: NonNullable<typeof GameState.drag>) {
    const it = d.item, pt = d.partner!, p = it.node.position;
    const a = angleOf(it.node) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    pt.node.setPosition(p.x + d.partnerX * c - d.partnerY * s, p.y + d.partnerX * s + d.partnerY * c, 0);
    const want = angleOf(it.node) + d.partnerAngle;
    if (Math.abs(turnDiff(angleOf(pt.node), want)) > .01) pt.node.angle = want;
  }

  /** Web look: 60% item + red outline when it does not fit, green outline when it does (no copy of the item as a shadow) */
  private drawHeld(it: ItemView, ghost: boolean) {
    if (it.sprite) it.sprite.color = ghost ? GHOST_ALPHA : OPAQUE;
    const g = this.outline;
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
    const it = d.item, pt = d.partner;
    S.drag = null;
    this.clearHeld(it);
    if (pt) this.clearHeld(pt);
    // snapshot the packed items, to undo pushes if this drop turns out not to fit
    S.bagSnapshot = { dropped: it, list: S.items.filter(o => o !== it && o !== pt && !o.waiting && bagZone(o).fullyInside).map(o => ({ item: o, x: o.node.position.x, y: o.node.position.y, angle: angleOf(o.node) })) };
    let bounced = false;
    if (d.ghost) {
      beginSpotBatch();
      const poking = (o: ItemView) => bagZone(o).inZone && overlapsInterior(o);
      if (poking(it) || (pt && poking(pt))) {   // does not fit in the bag → back to the tray (both of a pair)
        for (const o of pt ? [it, pt] : [it]) { const spot = findFreeSpot(o, o.node.position.x); o.node.setPosition(spot.x, spot.y, 0); }
        bounced = true;
      } else if (d.lastValid) { it.node.setPosition(d.lastValid.x, d.lastValid.y, 0); setAngle(it, d.lastValid.angle); if (pt) { d.partner = pt; this.placePartner(d); setAngle(pt, angleOf(pt.node)); } }
      else for (const o of pt ? [it, pt] : [it]) { const spot = findFreeSpot(o, o.node.position.x); o.node.setPosition(spot.x, spot.y, 0); }
    }
    for (const o of pt ? [it, pt] : [it]) {
      o.endHold();
      o.releasedAt = S.clock;
      // Freeze booster running: an item dropped into the bag stays exactly where it was dropped
      if (!bounced && isFreezing() && bagZone(o).fullyInside) freezeItem(o);
      if (bounced) o.body.linearVelocity = o.body.linearVelocity.set((Math.random() - .5) * 96 / PTM, 0);   // web ±.8 units/step sideways
    }
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
    this.spin = { item, id, moved: false, startAngle: angleOf(item.node), startPointer: Math.atan2(y - p.y, x - p.x), x0: p.x, sx: x, sy: y, tapped };
  }
  private moveSpin(x: number, y: number) {
    const sp = this.spin!, it = sp.item, p = it.node.position;
    if (!sp.moved) {
      sp.moved = true;
      it.holdUntil = 0;
      it.holdAngle = angleOf(it.node);
      it.body.type = ERigidBody2DType.Dynamic;
      it.stop();
    }
    it.holdAngle = sp.startAngle + (Math.atan2(y - p.y, x - p.x) - sp.startPointer) * 180 / Math.PI;
    setAngle(it, it.holdAngle);
  }
  /** Angle locked, no sliding sideways (contacts may still nudge it), falling stays natural */
  private holdAngle(it: ItemView, still: boolean) {
    if (Math.abs(turnDiff(angleOf(it.node), it.holdAngle)) > .01) setAngle(it, it.holdAngle);
    const v = it.body.linearVelocity;
    it.body.linearVelocity = v.set(0, still ? 0 : Math.min(0, v.y));
    it.body.angularVelocity = 0;
  }
  private holdSpinPosition() {
    this.holdAngle(this.spin!.item, false);
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
      if (!it.holdUntil || (this.spin?.moved && this.spin.item === it)) continue;
      it.stuckFrames = 0;
      if (it.holdUntil !== Infinity && now >= it.holdUntil) { it.holdUntil = 0; it.spunAt = now; it.stop(); it.body.wakeUp(); continue; }
      // in the bag: still a moment; on the tray: the angle stays, it may still fall
      this.holdAngle(it, it.holdUntil !== Infinity);
    }
    // a tray item kept still after rotating is released when anything else is picked up
    if (GameState.drag) for (const it of GameState.items) if (it.holdUntil === Infinity && !isHeld(it)) { it.holdUntil = 0; it.spunAt = now; it.body.wakeUp(); }
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
    if (this.handleHit) this.handleHit.active = show;
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
    const R = this.handleRadius(it), hit = this.handleHit;
    if (hit) {   // the touch area: the button plus the same margin as hitHandle
      hit.setPosition(hit.parent!.inverseTransformPoint(this.tmpLocal, this.handlePos(it, this.tmpWorld)));
      hit.getComponent(UITransform)!.setContentSize((R + HANDLE_PAD) * 2, (R + HANDLE_PAD) * 2);
    }
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
