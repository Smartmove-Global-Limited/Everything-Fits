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
import { overlapsBagArea, findFreeSpot, clearEjects, beginSpotBatch } from './BagRules';
import { Sound } from '../audio/Sound';
import { Fx } from './Fx';
import { BagView } from './BagView';

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
  /** Node in the front layer that mirrors the bag transform; the bag's front image lives under it */
  private frontHolder: Node;
  /** soft shadow under the bag (web bags.js drawBagShadow), drawn once per level */
  private shadow: Graphics;

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
    const [bagPrefab, prefabs] = await Promise.all([
      ContentLoader.bagPrefab(c.skin).catch(() => ContentLoader.bagPrefab('backpack')),
      Promise.all((level.items || []).map((it: any) => (it && it.id != null ? ContentLoader.itemPrefab(it.id).catch(() => null) : Promise.resolve(null)))),
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
      const item = this.takeItem(it.id, prefab);
      const k = (Number(it.scale) || 1) * (Number(level.itemScale) || 1);
      item.levelIndex = i;
      item.setLevelScale(k);
      item.presetInBag = !!it.inBag;
      item.locked = !!it.locked;
      item.releasedAt = item.floorBuzzAt = item.spunAt = item.toppleSide = 0; item.stuckFrames = item.insideFrames = item.outsideFrames = 0; item.fitAt = 0; item.outAt = -1e9;
      item.frozen = false; item.holdUntil = 0; item.cracks = 0; item.broken = false;
      item.body.type = ERigidBody2DType.Dynamic;   // a pooled item may come back frozen (static)
      let x = it.x, y = it.y;
      if (it.inBag) { x = (c.cx ?? 210) + (it.x ?? 0); y = bottomLevel + (it.y ?? -30); }
      item.node.setPosition(x, levelToFieldY(y), 0);
      item.node.angle = levelToNodeAngle(it.angle || 0);
      items.push(item);
    });
    S.items = items;
    S.itemsToPack = items.filter(i => i.itemId !== 0).length;
    this.scheduleEntrance();
  }

  /** Items placed in the bag from the start appear at once; the rest fall in one by one */
  private scheduleEntrance() {
    const S = GameState;
    const falling = S.items.filter(i => !i.presetInBag).sort((a, b) => a.node.position.y - b.node.position.y);
    const t0 = S.clock + FIRST_DROP;
    for (const it of S.items) if (it.presetInBag) this.activate(it, PhysicsGroup.ITEM);
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

  private activate(it: ItemView, group: number) {
    it.waiting = false;
    it.node.active = true;
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
    S.bagReady = true; S.bagShownAt = S.clock;
    this.setBagVisible(bag, true);
    // web tickTuiHien: whoosh, then a thud with dust when the bag lands at the end of its pop
    Sound.play('whoosh', { gain: .45 });
    Sound.play('land', { gain: .5, delay: .22 });
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
