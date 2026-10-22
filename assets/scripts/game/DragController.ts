// Touch control (ported from the web game, src/game/input.js):
//   - tap an item (no drag)    = select it; a rotate handle appears at its top-right corner
//   - drag the handle          = rotate the item around itself; it holds its angle for a moment
//   - touch-and-drag an item   = pick it up: it leaves the physics world and follows
//                                the finger, lifted above it so the player sees the whole item, drawn
//                                above the bag rim; a thin outline shows green (fits) or red ("ghost":
//                                overlaps something or pokes into the bag without fitting, item at 60%);
//                                released as a ghost it goes back to the tray
// Lives on the Field node (full design area). Per-frame work is done by tick(), called from the
// GameController loop, Cocos never calls an update() here.
import { _decorator, Component, Node, EventTouch, Vec2, Vec3, Color, PhysicsSystem2D, UITransform, Graphics, ERigidBody2DType, sys, Camera, director } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { DESIGN_W, levelToFieldY, FLOOR_Y, PTM } from '../core/GameConstants';
import { ItemView } from './ItemView';
import { computeGhost, overlapsInterior, bagZone, findFreeSpot, itemAABB, beginSpotBatch } from './BagRules';
import { isFreezing, freezeItem } from './BoosterEffects';
const { ccclass, property } = _decorator;

const DRAG_START = 7;                       // pointer travel that turns a touch into a drag
const LIFT_MAX = 70, FINGER_CLEARANCE = 26; // item is lifted above the finger by up to this much
const LIFT_MOUSE = 8;                       // with a mouse only a small lift
const HOLD_AFTER_SPIN = 1000;               // ms an item keeps its new angle inside the bag after rotating
/**
 * Node angle in degrees. Do not read node.angle on physics bodies: Box2D writes the rotation as a
 * quaternion and node.angle keeps returning the old euler value; eulerAngles recomputes it.
 */
const angleOf = (n: Node) => n.eulerAngles.z;
const SELECT_INK = new Color(0xE2, 0x63, 0x7F, 255), BUTTON_SHADOW = new Color(59, 42, 74, 56);   // web #E2637F, rgba(59,42,74,.22)
const FIT_INK = new Color(0x3D, 0xBE, 0x78, 255), GHOST_INK = new Color(0xE5, 0x48, 0x4D, 255);
const OPAQUE = new Color(255, 255, 255, 255), GHOST_ALPHA = new Color(255, 255, 255, 153);   // web: globalAlpha .6
const POP_MS = 220, POP_GAIN = .09;                                                            // item swells once when picked up

export type DragEvents = { onPick?(item: ItemView): void; onDrop?(item: ItemView, bounced: boolean): void; onSelect?(item: ItemView | null): void };

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
  private spin: { item: ItemView; id: number; startAngle: number; startPointer: number; x0: number; moved: boolean } | null = null;
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
  }

  onDestroy() { this.node.targetOff(this); }

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

  // ---------- rotate handle (web input.js rotateButtonPos / rotButtonR) ----------
  /** Top-right corner of the item's shape box, following the item's rotation */
  private handlePos(item: ItemView, out: Vec3): Vec3 {
    const box = item.localBox;
    this.tmpV2.set(box.xMax, box.yMax);
    Vec2.transformMat4(this.tmpV2, this.tmpV2, item.node.worldMatrix);
    return out.set(this.tmpV2.x, this.tmpV2.y, 0);
  }
  private handleRadius(item: ItemView) {
    const box = item.localBox;
    return Math.max(9, Math.min(14, Math.min(box.width, box.height) * item.levelScale * .3));
  }
  private hitHandle(x: number, y: number): boolean {
    const sel = GameState.selected; if (!sel) return false;
    const p = this.handlePos(sel, this.tmpWorld);
    return Math.hypot(x - p.x, y - p.y) <= this.handleRadius(sel) + 12;
  }

  // ---------- touch ----------
  private onStart(e: EventTouch) {
    const S = GameState;
    if (S.won || S.lost || S.paused || S.drag) return;
    const p = this.local(e), id = e.getID();
    if (this.hitHandle(p.x, p.y)) { this.beginSpin(S.selected!, p.x, p.y, id); return; }
    const item = this.pickAt(p.x, p.y);
    if (!item) { if (S.selected) this.beginSpin(S.selected, p.x, p.y, id); return; }
    this.pending = { item, x: p.x, y: p.y, id };
  }

  private onMove(e: EventTouch) {
    const p = this.local(e), id = e.getID();
    if (this.spin && id === this.spin.id) { this.moveSpin(p.x, p.y); return; }
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
      if (sp.moved) this.holdAfterSpin(sp.item);
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
    GameState.selected = item;
    this.events.onSelect?.(item);
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
    this.outline.node.setSiblingIndex(this.heldLayer.children.length - 1);
    this.popAt = S.clock;
    const p = item.node.position;
    const a = -angleOf(item.node) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = x - p.x, dy = y - p.y;
    const ui = item.transform2d;
    const lift = mouse ? LIFT_MOUSE : Math.min(LIFT_MAX, Math.max(ui.width, ui.height) * item.levelScale / 2 + FINGER_CLEARANCE);
    S.drag = { item, offsetX: dx * c - dy * s, offsetY: dx * s + dy * c, targetX: x, targetY: y, lift: 0, liftTo: lift, ghost: true, lastValid: null, touchId };
    this.events.onPick?.(item);
  }

  /** Called every frame by the game loop */
  tick(_dt: number) {
    const S = GameState, d = S.drag;
    if (this.spin) this.holdSpinPosition();
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
      } else if (d.lastValid) { it.node.setPosition(d.lastValid.x, d.lastValid.y, 0); it.node.angle = d.lastValid.angle; }
      else { const spot = findFreeSpot(it, it.node.position.x); it.node.setPosition(spot.x, spot.y, 0); }
    }
    it.endHold();
    it.releasedAt = S.clock;
    // Freeze booster running: an item dropped into the bag stays exactly where it was dropped
    if (!bounced && isFreezing() && bagZone(it).fullyInside) freezeItem(it);
    if (bounced) it.body.linearVelocity = it.body.linearVelocity.set((Math.random() - .5) * 96 / PTM, 0);   // web ±.8 units/step sideways
    this.events.onDrop?.(it, bounced);
  }

  // ---------- rotation ----------
  private beginSpin(item: ItemView, x: number, y: number, id: number) {
    const p = item.node.position;
    this.spin = { item, id, moved: false, startAngle: angleOf(item.node), startPointer: Math.atan2(y - p.y, x - p.x), x0: p.x };
    item.holdUntil = 0;
    item.body.type = ERigidBody2DType.Kinematic;          // held still while the finger turns it
    item.stop();
  }
  private moveSpin(x: number, y: number) {
    const sp = this.spin!, it = sp.item, p = it.node.position;
    sp.moved = true;
    it.node.angle = sp.startAngle + (Math.atan2(y - p.y, x - p.x) - sp.startPointer) * 180 / Math.PI;
  }
  private holdSpinPosition() {
    const it = this.spin!.item;
    it.stop();
  }
  /** After rotating: inside the bag keep the angle a moment, on the tray keep it until touched again */
  private holdAfterSpin(item: ItemView) {
    item.stop();
    if (!bagZone(item).inZone) { item.holdUntil = Infinity; return; }
    item.holdUntil = GameState.clock + HOLD_AFTER_SPIN;
  }
  private releaseSpinHolds() {
    const now = GameState.clock;
    for (const it of GameState.items) {
      if (!it.holdUntil || (this.spin && this.spin.item === it)) continue;
      it.stuckFrames = 0;
      if (it.holdUntil !== Infinity && now >= it.holdUntil) {
        it.holdUntil = 0;
        it.body.type = ERigidBody2DType.Dynamic; it.stop(); it.body.wakeUp();
      }
    }
    // a tray item kept still after rotating is released when anything else is picked up
    if (GameState.drag) for (const it of GameState.items) if (it.holdUntil === Infinity && !isHeld(it)) { it.holdUntil = 0; it.body.type = ERigidBody2DType.Dynamic; it.body.wakeUp(); }
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
    const m = it.node.worldMatrix;
    const src = it.outline.length >= 3 ? [it.outline] : null;
    const polys: Vec2[][] = src ? src.map(pts => pts.map(p => Vec2.transformMat4(new Vec2(), p, m))) : it.shapes;
    for (const poly of polys) dashedOutline(g, poly, 3, 5, 4);
    // button
    const c = this.handlePos(it, this.tmpWorld), R = this.handleRadius(it);
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
