// Touch control (ported from the web game, src/game/input.js):
//   - tap an item (no drag)    = select it; a rotate handle appears at its top-right corner
//   - drag the handle          = rotate the item around itself; it holds its angle for a moment
//   - touch-and-drag an item   = pick it up: it becomes a weightless sensor (group HELD) that follows
//                                the finger, lifted above it so the player sees the whole item; it
//                                turns red ("ghost") when it overlaps something or pokes into the bag
//                                without fitting; released as a ghost it goes back to the tray
// Lives on the Field node (full design area). Per-frame work is done by update(), called from the
// GameController loop (tick), Cocos never calls an update() here.
import { _decorator, Component, Node, EventTouch, Vec2, Vec3, Color, PhysicsSystem2D, UITransform, Graphics, ERigidBody2DType, sys } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { DESIGN_W, levelToFieldY, FLOOR_Y } from '../core/GameConstants';
import { ItemView } from './ItemView';
import { computeGhost, overlapsInterior, bagZone, findFreeSpot, itemAABB } from './BagRules';
const { ccclass, property } = _decorator;

const DRAG_START = 7;                       // pointer travel that turns a touch into a drag
const LIFT_MAX = 70, FINGER_CLEARANCE = 26; // item is lifted above the finger by up to this much
const LIFT_MOUSE = 8;                       // with a mouse only a small lift
const HOLD_AFTER_SPIN = 1000;               // ms an item keeps its new angle inside the bag after rotating
const GHOST_TINT = new Color(255, 140, 140, 255), NORMAL_TINT = Color.WHITE.clone(), HANDLE_INK = new Color(59, 42, 74, 255);

export type DragEvents = { onPick?(item: ItemView): void; onDrop?(item: ItemView, bounced: boolean): void; onSelect?(item: ItemView | null): void };

@ccclass('DragController')
export class DragController extends Component {
  @property({ type: Graphics, tooltip: 'Draws the rotate handle of the selected item' }) handle: Graphics | null = null;

  events: DragEvents = {};
  private transform: UITransform = null!;
  private pending: { item: ItemView; x: number; y: number; id: number } | null = null;
  private spin: { item: ItemView; id: number; startAngle: number; startPointer: number; x0: number; moved: boolean } | null = null;
  private readonly tmpWorld = new Vec3();
  private readonly tmpLocal = new Vec3();
  private readonly tmpV2 = new Vec2();

  onLoad() {
    this.transform = this.getComponent(UITransform)!;
    this.node.on(Node.EventType.TOUCH_START, this.onStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onEnd, this);
  }

  onDestroy() { this.node.targetOff(this); }

  /** Pointer position in Field space (origin bottom-left of the design area) */
  private local(e: EventTouch) {
    const ui = e.getUILocation(this.tmpV2);
    this.tmpWorld.set(ui.x, ui.y, 0);
    this.transform.convertToNodeSpaceAR(this.tmpWorld, this.tmpLocal);
    // Field anchor is bottom-left (0, 0): node space == Field space
    return this.tmpLocal;
  }

  private pickAt(x: number, y: number): ItemView | null {
    this.tmpWorld.set(x, y, 0);
    this.transform.convertToWorldSpaceAR(this.tmpWorld, this.tmpLocal);
    this.tmpV2.set(this.tmpLocal.x, this.tmpLocal.y);
    const hits = PhysicsSystem2D.instance.testPoint(this.tmpV2);
    for (const c of hits) {
      const v = c.node.getComponent(ItemView);   // only on touch, not per frame
      if (v && !v.waiting) return v;
    }
    return null;
  }

  // ---------- rotate handle ----------
  private handlePos(item: ItemView, out: Vec3): Vec3 {
    const ui = item.transform2d, k = item.levelScale;
    const hx = ui.width * (1 - ui.anchorX) * k, hy = ui.height * (1 - ui.anchorY) * k;
    const a = item.node.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const p = item.node.position;
    return out.set(p.x + hx * c - hy * s, p.y + hx * s + hy * c, 0);
  }
  private handleRadius(item: ItemView) {
    const ui = item.transform2d;
    return Math.max(9, Math.min(14, Math.min(ui.width, ui.height) * item.levelScale * .3));
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
    const p = item.node.position;
    const a = -item.node.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = x - p.x, dy = y - p.y;
    const ui = item.transform2d;
    const lift = mouse ? LIFT_MOUSE : Math.min(LIFT_MAX, Math.max(ui.width, ui.height) * item.levelScale / 2 + FINGER_CLEARANCE);
    S.drag = { item, offsetX: dx * c - dy * s, offsetY: dx * s + dy * c, targetX: x, targetY: y, lift: 0, liftTo: lift, ghost: true, lastValid: null, touchId };
    item.node.setSiblingIndex(item.node.parent!.children.length - 1);   // draw above the others
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
    const a = it.node.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let x = d.targetX - (d.offsetX * c - d.offsetY * s);
    let y = d.targetY - (d.offsetX * s + d.offsetY * c) + d.lift;
    it.node.setPosition(x, y, 0);
    // keep the item above the tray floor and inside the screen sides
    const r = itemAABB(it), floor = levelToFieldY(FLOOR_Y);
    let fx = 0, fy = 0;
    if (r.yMin < floor + 1) fy = floor + 1 - r.yMin;
    if (r.xMin < 0) fx = -r.xMin; else if (r.xMax > DESIGN_W) fx = DESIGN_W - r.xMax;
    if (fx || fy) { x += fx; y += fy; it.node.setPosition(x, y, 0); }
    d.ghost = computeGhost(it);
    if (it.sprite) it.sprite.color = d.ghost ? GHOST_TINT : NORMAL_TINT;
    if (!d.ghost) d.lastValid = { x, y, angle: it.node.angle };
  }

  drop() {
    const S = GameState, d = S.drag; if (!d) return;
    const it = d.item;
    S.drag = null;
    if (it.sprite) it.sprite.color = NORMAL_TINT;
    // snapshot the packed items, to undo pushes if this drop turns out not to fit
    S.bagSnapshot = { dropped: it, list: S.items.filter(o => o !== it && !o.waiting && bagZone(o).fullyInside).map(o => ({ item: o, x: o.node.position.x, y: o.node.position.y, angle: o.node.angle })) };
    let bounced = false;
    if (d.ghost) {
      if (overlapsInterior(it)) {                    // does not fit in the bag → back to the tray
        const spot = findFreeSpot(it, it.node.position.x);
        it.node.setPosition(spot.x, spot.y, 0); bounced = true;
      } else if (d.lastValid) { it.node.setPosition(d.lastValid.x, d.lastValid.y, 0); it.node.angle = d.lastValid.angle; }
      else { const spot = findFreeSpot(it, it.node.position.x); it.node.setPosition(spot.x, spot.y, 0); }
    }
    it.endHold();
    it.releasedAt = S.clock;
    if (bounced) it.body.linearVelocity = it.body.linearVelocity.set((Math.random() - .5) * 96, 0);
    this.events.onDrop?.(it, bounced);
  }

  // ---------- rotation ----------
  private beginSpin(item: ItemView, x: number, y: number, id: number) {
    const p = item.node.position;
    this.spin = { item, id, moved: false, startAngle: item.node.angle, startPointer: Math.atan2(y - p.y, x - p.x), x0: p.x };
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

  private drawHandle() {
    const g = this.handle; if (!g) return;
    g.clear();
    const sel = GameState.selected;
    if (!sel || GameState.drag) return;
    const p = this.handlePos(sel, this.tmpWorld), r = this.handleRadius(sel);
    g.fillColor = Color.WHITE; g.strokeColor = HANDLE_INK; g.lineWidth = 2;
    g.circle(p.x, p.y, r); g.fill(); g.stroke();
    g.arc(p.x, p.y, r * .55, .4, Math.PI * 1.6, true); g.stroke();
  }
}
