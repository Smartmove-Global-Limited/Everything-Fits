// Builds a level from levels.json (ported from the web game, src/game/level.js):
//   - the bag prefab at the level's scale, its image bottom resting on the tray edge
//   - the items, taken from a pool (no instantiate on restart), dropped in from above the screen
//     one after another (FALLING group passes the ceiling), then the bag appears once they settle
// Level coordinates (y down) are converted to Field coordinates (y up) here, and only here.
import { Node, instantiate, tween, Vec3, UIOpacity, Prefab, UITransform, ERigidBody2DType, Graphics, Color } from 'cc';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { DESIGN_H, BAG_FLOOR, BAG_CEIL, PhysicsGroup, PTM, levelToFieldY, levelToNodeAngle } from '../core/GameConstants';
import { ItemView } from './ItemView';
import { overlapsBagArea, findFreeSpot, clearEjects, beginSpotBatch, moveInsideBag } from './BagRules';
import { Sound } from '../audio/Sound';
import { Fx } from './Fx';
import { BagView } from './BagView';
import { buildTethers, clearTethers, resetTetherDrawing, retie, setTetherLayers } from './Tethers';
import { KEY_ID, MYSTERY_ID } from './MysteryBox';

const DROP_INTERVAL = 110;     // ms between two items dropping in
const FIRST_DROP = 150;        // pause before the first one
const DROP_HEIGHT = 90;        // items start this far above the top of the screen
const AVOID_CENTER = 62;       // never drop straight onto the top of the bag
const BAG_MAX_WAIT = 2600;     // show the bag at the latest this long after the last drop (ms)
const SETTLED_SPEED = .7 * 60 / PTM; // "settled" speed for the bag reveal (m/s; web .7 units per step)

export class LevelBuilder {
  private itemPool = new Map<number, ItemView[]>();
  private bagPool = new Map<string, BagView>();
  private lastDropAt = 0;
  /** mystery boxes of this round and the prefab of the item each one hides */
  private hidden = new Map<ItemView, Prefab>();
  /** Node in the front layer that mirrors the bag transform; the bag's front image lives under it */
  private frontHolder: Node;
  /** soft shadow under the bag (web bags.js drawBagShadow), drawn once per level */
  private shadow: Graphics;
  /** strings of the tied pairs (game/Tethers): in front of the bag rim, under dangling items */
  readonly strings: Graphics;

  constructor(private bagLayer: Node, private itemLayer: Node, private frontLayer: Node) {
    this.frontHolder = new Node('BagFront');
    this.frontHolder.layer = frontLayer.layer;
    this.frontHolder.addComponent(UITransform);
    frontLayer.addChild(this.frontHolder);
    const sh = new Node('BagShadow');
    sh.layer = bagLayer.layer;
    sh.addComponent(UITransform);
    bagLayer.insertChild(sh, 0);
    this.shadow = sh.addComponent(Graphics);
    sh.addComponent(UIOpacity);
    const st = new Node('Strings');
    st.layer = frontLayer.layer;
    st.addComponent(UITransform);
    frontLayer.addChild(st);
    this.strings = st.addComponent(Graphics);
    setTetherLayers(itemLayer, frontLayer);
  }

  /**
   * Web: radial gradient rgba(60,45,35,.30) → transparent from 45% to 100% of rx = 42% of the image
   * width, squashed to 19 units high, centred 3 units right and 6 units above the image bottom.
   * Graphics has no gradient fill: stacked ellipses fading outwards give the same smudge.
   */
  private drawShadow(cx: number, imageBottomY: number, imageW: number) {
    const g = this.shadow, rx = imageW * .42, ry = 19, steps = 10, c = new Color(60, 45, 35, 0);
    this.shadow.node.setPosition(cx + 3, imageBottomY + 6, 0);
    g.clear();
    for (let i = 0; i < steps; i++) {
      const f = 1 - i / steps * .55;                    // 1 → .45 of the radius
      c.a = Math.round(255 * .30 / steps * 1.2);        // each ring adds a little: centre ≈ .30
      g.fillColor = c;
      g.ellipse(0, 0, rx * f, ry * f);
      g.fill();
    }
  }

  /** Build `level` (a level object from levels.json). Resolves once every prefab is placed. */
  async build(level: any) {
    const S = GameState;
    S.round++;
    const round = S.round;
    this.clear();

    // ---- bag ----
    const c = level.container || {};
    // bag and items load together, before anything is placed: an empty item list while the bag is
    // already there would let tick() reveal the bag (and its walls) before the items fall in
    // a mystery box needs the key in the level: without it a hidden item could never be packed
    const hasKey = (level.items || []).some((it: any) => it && Number(it.id) === KEY_ID);
    const anyLocked = hasKey && (level.items || []).some((it: any) => it?.locked);
    const [bagPrefab, prefabs, boxPrefab] = await Promise.all([
      ContentLoader.bagPrefab(c.skin).catch(() => ContentLoader.bagPrefab('backpack')),
      Promise.all((level.items || []).map((it: any) => (it && it.id != null ? ContentLoader.itemPrefab(it.id).catch(() => null) : Promise.resolve(null)))),
      anyLocked ? ContentLoader.itemPrefab(MYSTERY_ID).catch(() => null) : Promise.resolve(null),
    ]);
    if (round !== S.round) return;
    const bag = this.takeBag(c.skin, bagPrefab);
    const s = c.scale || 1;
    // The bag image is centred in the free band between the HUD (BAG_CEIL) and the table edge
    // (BAG_FLOOR) instead of resting on the table: a small bag no longer sits right on top of
    // the items on the tray. Level positions designed against the bag (inBag items, solutions)
    // follow it through S.bagLift.
    const imageH = (bag.body?.getComponent(UITransform)?.height ?? 0) * s;
    S.bagLift = Math.max(0, (BAG_FLOOR - imageH - (BAG_CEIL - S.ceilGain)) / 2);
    const bottomLevel = BAG_FLOOR - S.bagLift + bag.imageBottom * s;   // origin = center-bottom of the interior
    bag.node.setScale(s, s, 1);
    bag.node.setPosition(c.cx ?? 210, levelToFieldY(bottomLevel), 0);
    bag.node.active = true;
    this.frontHolder.setPosition(bag.node.position); this.frontHolder.setScale(bag.node.scale);
    if (bag.front) { bag.front.setParent(this.frontHolder, false); bag.front.active = true; }
    if (bag.walls) bag.walls.active = false;                       // no walls until the bag appears
    this.setBagVisible(bag, false);
    bag.refreshWorldShape();
    S.bag = bag; S.bagReady = false;
    this.drawShadow(c.cx ?? 210, levelToFieldY(BAG_FLOOR - S.bagLift), (bag.body?.getComponent(UITransform)?.width ?? 0) * s);
    this.shadow.getComponent(UIOpacity)!.opacity = 0;

    // ---- items ----
    const items: ItemView[] = [];
    (level.items || []).forEach((it: any, i: number) => {
      const prefab = prefabs[i] as Prefab | null;
      // an item this app does not have (or a broken entry) is left out of the level: not shown,
      // not counted in the items to pack
      if (!prefab) return;
      if (!it.inBag && !(Number.isFinite(Number(it.x)) && Number.isFinite(Number(it.y)))) return;
      // hidden in a mystery box (web level.js): the box stands in for the item until the key opens it
      const locked = !!it.locked && !!boxPrefab && Number(it.id) !== KEY_ID;
      const item = this.takeItem(locked ? MYSTERY_ID : it.id, locked ? boxPrefab! : prefab);
      const k = (Number(it.scale) || 1) * (Number(level.itemScale) || 1);
      this.resetItem(item, i, k);
      item.presetInBag = !!it.inBag;
      item.locked = locked;
      item.realId = Number(it.id);
      if (locked) this.hidden.set(item, prefab);
      let x = it.x, y = it.y;
      if (it.inBag) { x = (c.cx ?? 210) + (it.x ?? 0); y = bottomLevel + (it.y ?? -30); }
      item.node.setPosition(x, levelToFieldY(y), 0);
      item.node.angle = levelToNodeAngle(it.angle || 0);
      items.push(item);
    });
    S.items = items;
    S.itemsToPack = items.filter(i => i.itemId !== 0).length;
    buildTethers(items, level);
    this.scheduleEntrance();
  }

  /**
   * The rest fall in one by one; items placed in the bag from the start (the key…) appear with the
   * bag: until then it has no walls and they fell straight through it onto the tray
   */
  private scheduleEntrance() {
    const S = GameState;
    const falling = S.items.filter(i => !i.presetInBag).sort((a, b) => a.node.position.y - b.node.position.y);
    const t0 = S.clock + FIRST_DROP;
    for (const it of S.items) if (it.presetInBag) { it.waiting = true; it.enterAt = Infinity; }
    falling.forEach((it, i) => {
      it.waiting = true; it.enterAt = t0 + i * DROP_INTERVAL;
      if (S.preview) return;                          // editor preview: items stay where the designer put them
      let x = it.node.position.x;
      const bagX = S.bag ? S.bag.node.position.x : 210;
      const off = x - bagX;
      if (Math.abs(off) < AVOID_CENTER) x = bagX + (off === 0 ? (i % 2 ? 1 : -1) : Math.sign(off)) * AVOID_CENTER;
      it.node.setPosition(x, DESIGN_H + DROP_HEIGHT + Math.random() * 40, 0);
    });
    this.lastDropAt = t0 + Math.max(0, falling.length - 1) * DROP_INTERVAL;
  }

  /** Per-round state of an item taken from the pool (level index, size, nothing held / frozen / cracked) */
  private resetItem(item: ItemView, levelIndex: number, scale: number) {
    item.levelIndex = levelIndex;
    item.setLevelScale(scale);
    item.locked = false; item.realId = item.itemId; item.waiting = item.entering = false;
    item.held = false; item.body.enabled = true;   // a box taken off while held kept its body off
    item.releasedAt = item.floorBuzzAt = item.spunAt = item.toppleSide = 0; item.stuckFrames = item.insideFrames = item.outsideFrames = 0; item.fitAt = 0; item.outAt = -1e9;
    item.frozen = false; item.holdUntil = 0; item.cracks = 0; item.broken = false;
    // times on the game clock, which starts again at 0 each round
    item.crackedAt = 0; item.lastImpactAt = -1e9;
    item.body.type = ERigidBody2DType.Dynamic;   // a pooled item may come back frozen (static)
  }

  /**
   * A released mystery box touched the key (game/MysteryBox): the key leaves the field and the box
   * becomes the item it hid, at the same place and angle, in the same slot of the item list, as a
   * normal body: Box2D pushes apart whatever it overlaps. Returns the item, or null.
   */
  openBox(box: ItemView, key: ItemView): ItemView | null {
    const S = GameState, prefab = this.hidden.get(box);
    if (!prefab) return null;
    this.hidden.delete(box);
    this.takeOff(key);
    const item = this.takeItem(box.realId, prefab);
    this.resetItem(item, box.levelIndex, box.levelScale);
    item.presetInBag = box.presetInBag;
    item.node.setParent(box.node.parent, false);
    item.node.setPosition(box.node.position);
    item.node.setRotation(box.node.rotation);   // before activate(): the body is created at this transform
    // the key lies in the bag, so the box touching it is in the bag: the item grows out of it
    // there, like an item that was in the bag all along (never pushed out through a wall)
    moveInsideBag(item);
    S.items[S.items.indexOf(box)] = item;
    retie(box, item);
    if (S.selected === box) S.selected = null;
    this.takeOff(box);
    this.activate(item, PhysicsGroup.ITEM);
    // a pooled body switched back on keeps the place it had last round (on the tray): move it to
    // the node, now that it is in the world
    const impl = (item.body as any).impl;
    impl?.syncPositionToPhysics?.(true); impl?.syncRotationToPhysics?.(true);
    item.stop();
    item.releasedAt = S.clock;                    // like a drop: no eject check right away
    return item;
  }

  /** An item leaves the field for the rest of the round (back to the pool on the next build) */
  private takeOff(it: ItemView) {
    const S = GameState, i = S.items.indexOf(it);
    if (i >= 0) S.items.splice(i, 1);
    S.thrown.push(it);
    it.node.active = false;
  }

  private activate(it: ItemView, group: number) {
    it.waiting = false;
    it.node.active = true;
    // its body at the node's place and angle, whatever happened to the node while it was off
    // (Android: a body could stay at (0, 0) and pull the item there, under the tray floor)
    const impl = (it.body as any).impl;
    impl?.syncPositionToPhysics?.(); impl?.syncRotationToPhysics?.();
    it.setGroup(group);
    it.body.wakeUp();
  }

  /** Every frame: drop items whose turn has come, end the FALLING state, reveal the bag */
  tick() {
    const S = GameState;
    for (const it of S.items) {
      if (it.waiting && S.clock >= it.enterAt) {
        this.activate(it, PhysicsGroup.FALLING);
        it.entering = true;
        // web: 0.6 units/step sideways, 2–4 units/step down (units/s ÷ PTM = m/s)
        it.body.linearVelocity = it.body.linearVelocity.set((Math.random() - .5) * 72 / PTM, -(120 + Math.random() * 120) / PTM);
        it.body.angularVelocity = (Math.random() - .5) * .08 * 60;   // web ±.04 rad per step
      }
      if (it.entering && it.node.position.y < DESIGN_H - 10) {
        // fully inside the screen: collide with everything again (including the ceiling)
        it.entering = false;
        it.setGroup(PhysicsGroup.ITEM);
      }
    }
    if (!S.bagReady && S.bag) this.tryRevealBag();
  }

  private tryRevealBag() {
    const S = GameState;
    let busy = false;
    for (const it of S.items) {
      if (it.presetInBag) continue;
      if (it.waiting || it.entering) { busy = true; break; }
      const v = it.body.linearVelocity;
      if (v.x * v.x + v.y * v.y > SETTLED_SPEED * SETTLED_SPEED) { busy = true; break; }
    }
    if (busy && S.clock < this.lastDropAt + BAG_MAX_WAIT) return;
    const bag = S.bag!;
    bag.refreshWorldShape();
    // the walls appear around items already lying there: move those to the tray first,
    // otherwise they end up inside a wall (stuck and pushed every step)
    beginSpotBatch();
    for (const it of S.items) {
      if (it.waiting || it.presetInBag || !overlapsBagArea(it)) continue;
      const spot = findFreeSpot(it, it.node.position.x);
      it.node.setPosition(spot.x, spot.y, 0);
      it.stop(); it.body.wakeUp();
    }
    if (bag.walls) bag.walls.active = true;
    bag.refreshWorldShape();
    for (const it of S.items) if (it.presetInBag && it.waiting) {
      this.activate(it, PhysicsGroup.ITEM);
      if (it.itemId === KEY_ID) { it.stop(); it.body.type = ERigidBody2DType.Static; }   // fixed in the bag
    }
    S.bagReady = true; S.bagShownAt = S.clock;
    this.setBagVisible(bag, true);
    // web tickTuiHien: whoosh, then a thud with dust when the bag lands at the end of its pop
    Sound.play('whoosh', { gain: .45 });
    Sound.play('fall', { gain: .5, delay: .22 });
    const fx = Fx.instance;
    if (fx) { const cx = (bag.minX + bag.maxX) / 2, y = bag.minY - 8; fx.dust(cx - 40, y, { n: 6, strength: .8 }); fx.dust(cx + 40, y, { n: 6, strength: .8 }); }
    // small pop when the bag lands on the table
    const s = bag.node.scale.x;
    const so = this.shadow.getComponent(UIOpacity)!;
    tween(so).to(.18, { opacity: 255 }).start();
    for (const n of [bag.node, this.frontHolder]) {
      n.setScale(s * .55, s * .55, 1);
      tween(n).to(.32, { scale: new Vec3(s * 1.06, s * 1.06, 1) }, { easing: 'backOut' }).to(.12, { scale: new Vec3(s, s, 1) }).start();
    }
    tween(bag.node).delay(.45).call(() => bag.refreshWorldShape()).start();
  }

  private setBagVisible(bag: BagView, on: boolean) {
    for (const n of [bag.body, bag.front]) {
      if (!n) continue;
      const op = n.getComponent(UIOpacity) || n.addComponent(UIOpacity);
      if (on) { op.opacity = 0; tween(op).to(.18, { opacity: 255 }).start(); } else op.opacity = 0;
    }
  }

  // ---- pools ----
  private takeItem(id: number, prefab: Prefab): ItemView {
    const list = this.itemPool.get(id);
    const view = list && list.length ? list.pop()! : instantiate(prefab).getComponent(ItemView)!;
    view.node.setParent(this.itemLayer);
    view.node.active = false;
    return view;
  }

  private takeBag(skin: string, prefab: Prefab): BagView {
    let bag = this.bagPool.get(skin);
    if (!bag) { bag = instantiate(prefab).getComponent(BagView)!; this.bagPool.set(skin, bag); }
    bag.node.setParent(this.bagLayer);
    return bag;
  }

  // ---------- bag sway while shaking (images only; the physical walls do not move) ----------
  private swayBody = new Vec3(); private swayFront = new Vec3(); private swayOn = false;
  setSway(dx: number, dy: number, angle: number) {
    const bag = GameState.bag; if (!bag || !bag.body) return;
    const s = bag.node.scale.x || 1;
    if (!this.swayOn) { this.swayBody.set(bag.body.position); if (bag.front) this.swayFront.set(bag.front.position); this.swayOn = true; }
    bag.body.setPosition(this.swayBody.x + dx / s, this.swayBody.y + dy / s, 0); bag.body.angle = angle;
    if (bag.front) { bag.front.setPosition(this.swayFront.x + dx / s, this.swayFront.y + dy / s, 0); bag.front.angle = angle; }
  }
  resetSway() {
    const bag = GameState.bag;
    if (this.swayOn && bag && bag.body) { bag.body.setPosition(this.swayBody); bag.body.angle = 0; if (bag.front) { bag.front.setPosition(this.swayFront); bag.front.angle = 0; } }
    this.swayOn = false;
  }

  /** Scene teardown: pooled nodes sit outside the scene tree, destroy them explicitly */
  dispose() {
    for (const list of this.itemPool.values()) for (const it of list) if (it.isValid && !it.node.parent) it.node.destroy();
    this.itemPool.clear();
    for (const bag of this.bagPool.values()) if (bag.isValid && !bag.node.parent) bag.node.destroy();
    this.bagPool.clear();
  }

  /** Return everything of the previous round to the pools */
  clear() {
    const S = GameState;
    this.resetSway();
    for (const it of S.items) {
      it.node.active = false;
      it.waiting = it.entering = false;
      const list = this.itemPool.get(it.itemId) || [];
      list.push(it); this.itemPool.set(it.itemId, list);
    }
    S.items = [];
    this.hidden.clear();
    clearTethers(); resetTetherDrawing(this.strings);
    for (const it of S.thrown) {
      it.node.active = false;
      const list = this.itemPool.get(it.itemId) || [];
      list.push(it); this.itemPool.set(it.itemId, list);
    }
    S.thrown = [];
    if (S.bag) {
      const bag = S.bag;
      if (bag.front) bag.front.setParent(bag.node, false);
      bag.node.active = false;
      S.bag = null;
    }
    S.packed.clear(); S.removed.clear(); clearEjects();
    S.drag = null; S.selected = null; S.bagSnapshot = null;
    S.winFrames = 0; S.won = false; S.lost = false; S.paused = false; S.bagReady = false; S.freezeUntil = 0;
  }
}
