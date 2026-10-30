// Builds a level from levels.json (ported from the web game, src/game/level.js):
//   - the bag prefab at the level's scale, its image bottom resting on the tray edge
//   - the items, taken from a pool (no instantiate on restart), dropped in from above the screen
//     one after another (FALLING group passes the ceiling), then the bag appears once they settle
// Level coordinates (y down) are converted to Field coordinates (y up) here, and only here.
import { Node, instantiate, tween, Vec3, UIOpacity, Prefab, UITransform, ERigidBody2DType, Graphics, Color, Collider2D, Contact2DType, IPhysics2DContact, Intersection2D, Vec2 } from 'cc';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { DESIGN_W, DESIGN_H, BAG_FLOOR, BAG_CEIL, PhysicsGroup, PTM, levelToFieldY, levelToNodeAngle } from '../core/GameConstants';
import { ItemView } from './ItemView';
import { beginSpotBatch, clearEjects, findFreeSpot, moveInsideBag, reachesIntoBag } from './BagRules';
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
const WALLS_SETTLE_MIN = 250;  // walls stand this long (ms) before the bag is shown…
const WALLS_SETTLE_MAX = 1500; // …or longer, until what they pushed back has settled, at most this
const SETTLED_SPEED = .7 * 60 / PTM; // "settled" speed for the bag reveal (m/s; web .7 units per step)
const PUSH_SPEED = 2.5;        // items in the bag's place as it appears are pushed out this fast (m/s)…
const PUSH_MAX = 1500;         // …for this long at most (ms), then moved to a free spot on the tray
const PUSH_STEP = 3;           // moved out of the bag in steps this long (units) each frame
const POP_TIME = 450;          // the bag's pop when it appears (ms, the tweens in tryRevealBag)

export class LevelBuilder {
  private itemPool = new Map<number, ItemView[]>();
  private bagPool = new Map<string, BagView>();
  private lastDropAt = 0;
  /** when the bag's walls stood up, before the bag is shown (-1: not yet) */
  private wallsOnAt = -1;
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
    this.bagScale = s;
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
    this.wallsOnAt = -1;
  }

  /** Per-round state of an item taken from the pool (level index, size, nothing held / frozen / cracked) */
  private resetItem(item: ItemView, levelIndex: number, scale: number) {
    item.levelIndex = levelIndex;
    item.setLevelScale(scale);
    item.locked = false; item.realId = item.itemId; item.waiting = item.entering = false;
    item.held = false; item.body.enabled = true;   // a box taken off while held kept its body off
    item.releasedAt = item.floorBuzzAt = item.spunAt = item.toppleSide = 0; item.stuckFrames = item.insideFrames = item.outsideFrames = 0; item.fitAt = 0; item.outAt = -1e9;
    item.frozen = false; item.holdUntil = 0; item.cracks = 0; item.broken = false;
    item.body.fixedRotation = false;   // kept by a turn held when the round ended
    item.turning = false;
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

  /**
   * Level Editor: the designer changed the item list of the level being played. The items of
   * `level.items` from `from` to `to` (exclusive) take the place of the ones that were there from
   * `from` to `oldTo`; the items after them move by `to - oldTo`. Those taken out leave the field,
   * the new ones drop in from above the screen, everything else stays where the player put it.
   */
  async spliceItems(level: any, from: number, oldTo: number, to: number) {
    const S = GameState, round = S.round, shift = to - oldTo;
    const fresh = (level.items || []).slice(from, to);
    const prefabs = await Promise.all(fresh.map((it: any) => ContentLoader.itemPrefab(it.id).catch(() => null)));
    if (round !== S.round) return;
    let toPack = S.itemsToPack;
    for (const it of S.items.slice()) {
      if (it.levelIndex < from) continue;
      if (it.levelIndex >= oldTo) { it.levelIndex += shift; continue; }
      if (S.drag?.item === it) S.drag = null;
      if (S.selected === it) S.selected = null;
      if (it.itemId !== 0) toPack--;
      this.takeOff(it);
    }
    // thrown out by the booster: counted as packed by index
    for (const i of Array.from(S.removed)) if (i >= from && i < oldTo) toPack--;
    for (const set of [S.packed, S.removed]) {
      const was = Array.from(set); set.clear();
      for (const i of was) if (i < from) set.add(i); else if (i >= oldTo) set.add(i + shift);
    }
    const bag = S.bag, bagX = bag ? bag.node.position.x : 210;
    prefabs.forEach((prefab: Prefab | null, n: number) => {
      const it = fresh[n];
      if (!prefab) return;
      const item = this.takeItem(Number(it.id), prefab);
      this.resetItem(item, from + n, (Number(it.scale) || 1) * (Number(level.itemScale) || 1));
      item.realId = Number(it.id);
      item.node.setPosition(bagX, DESIGN_H + DROP_HEIGHT, 0);
      item.node.angle = levelToNodeAngle(it.angle || 0);
      item.updateShape();
      // dropped beside the bag, onto the tray (one dropped over it stayed lying on its rim)
      const half = item.bounds.width / 2 + 4;
      let x = !it.inBag && Number.isFinite(Number(it.x)) ? Number(it.x) : bagX + (n % 2 ? 1 : -1);
      if (bag && x + half > bag.minX && x - half < bag.maxX) {
        const left = bag.minX - half, right = bag.maxX + half;
        x = (x < bagX ? left >= half : right > DESIGN_W - half) ? left : right;
      }
      item.node.setPosition(Math.max(half, Math.min(DESIGN_W - half, x)), DESIGN_H + DROP_HEIGHT, 0);
      item.waiting = true; item.enterAt = S.clock + n * DROP_INTERVAL;
      S.items.push(item);
      if (item.itemId !== 0) toPack++;
    });
    S.itemsToPack = toPack;
    S.winFrames = 0;
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
        if (!S.preview) this.aboveFalling(it);
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
    if (this.pushing.size) this.pushOut();
  }

  /**
   * Start an item above the ones still dropping in under it: the previous one left only 110 ms
   * earlier and was still there, the two came in one inside the other and were pushed apart.
   */
  private aboveFalling(it: ItemView) {
    const r = (it.updateShape(), it.bounds);
    let lift = 0;
    for (const o of GameState.items) {
      if (o === it || !o.entering) continue;
      const b = (o.updateShape(), o.bounds);
      if (b.xMax > r.xMin && b.xMin < r.xMax) lift = Math.max(lift, b.yMax + 4 - r.yMin);
    }
    if (lift > 0) it.node.setPosition(it.node.position.x, it.node.position.y + lift, 0);
  }

  private tryRevealBag() {
    const S = GameState;
    let busy = false;
    for (const it of S.items) {
      if (it.presetInBag || this.pushing.has(it)) continue;
      if (it.waiting || it.entering) { busy = true; break; }
      const v = it.body.linearVelocity;
      if (v.x * v.x + v.y * v.y > SETTLED_SPEED * SETTLED_SPEED) { busy = true; break; }
    }
    const bag = S.bag!;
    // the walls stand up first, unseen, once the dropped items have settled: an item of the pile
    // reaching into the bag's place is pushed back by them like by any wall, and the bag is shown
    // only when that has settled too, so it never appears with an item through it. (Moving such
    // items to a "free spot" put them on other items when the tray was full: they shook non-stop.)
    if (this.wallsOnAt < 0) {
      if (busy && S.clock < this.lastDropAt + BAG_MAX_WAIT) return;
      bag.refreshWorldShape();
      // an item reaching into the bag's place (standing on its end on top of the pile): the
      // walls appearing across it pushed it up through the bottom, into the bag. The bag pushes
      // it out instead, in sight (pushOut), its walls letting it through until it is out
      for (const it of S.items) if (!it.presetInBag && !it.waiting && reachesIntoBag(it)) this.startPush(it);
      if (bag.walls) bag.walls.active = true;
      for (const it of S.items) if (!it.waiting) it.body.wakeUp();   // a resting item does not feel a wall that appears
      this.wallsOnAt = S.clock;
      return;
    }
    const since = S.clock - this.wallsOnAt;
    if (since < WALLS_SETTLE_MIN || (busy && since < WALLS_SETTLE_MAX)) return;
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

  /** Items the bag pushes out of its place, and when it started (game clock) */
  private pushing = new Map<ItemView, number>();
  /** While pushed out, an item passes through the bag's walls (they would trap it inside) */
  private passBag = (_self: Collider2D, other: Collider2D, contact: IPhysics2DContact | null) => {
    if (contact && other.group === PhysicsGroup.BAG) contact.disabled = true;
  };
  private startPush(it: ItemView) {
    if (this.pushing.has(it)) return;
    this.pushing.set(it, GameState.clock);
    for (const c of it.colliders) c.on(Contact2DType.PRE_SOLVE, this.passBag, this);
  }
  private endPush(it: ItemView) {
    this.pushing.delete(it);
    for (const c of it.colliders) if (c.isValid) c.off(Contact2DType.PRE_SOLVE, this.passBag, this);
  }
  private bagScale = 1;
  /**
   * Every frame once the bag is shown: the bag pushes the items in its place out as it pops up,
   * like a solid body would. Each frame the item is moved just out of the bag at its size of that
   * frame (it is never seen inside it), away from its middle (mostly down, out of its bottom),
   * and keeps that speed, turning over so one standing on its end falls flat. One still in the
   * bag after PUSH_MAX goes to a free spot on the tray.
   */
  private pushOut() {
    const S = GameState, bag = S.bag;
    if (!bag || !S.bagReady) return;
    // a little larger than the inside: clear of the bag's rim too
    const o = bag.node.position, f = bag.node.scale.x / this.bagScale * 1.05;
    const cx = (bag.minX + bag.maxX) / 2, cy = (bag.minY + bag.maxY) / 2;
    const popped = S.clock > S.bagShownAt + POP_TIME;
    let spots = false;
    for (const [it, since] of Array.from(this.pushing)) {
      if (!it.node.activeInHierarchy) { this.endPush(it); continue; }
      if (S.clock > since + PUSH_MAX && reachesIntoBag(it)) {
        if (!spots) { beginSpotBatch(); spots = true; }
        const spot = findFreeSpot(it, it.node.position.x);
        it.node.setPosition(spot.x, spot.y, 0);
        it.stop();
        this.endPush(it);
        continue;
      }
      const p = it.node.position;
      let dx = p.x - cx, dy = Math.min(p.y - cy, 0);
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      let x = p.x, y = p.y, moved = false;
      for (let n = 0; n < 40 && this.inBagAt(it, o.x, o.y, f); n++) {
        x += dx * PUSH_STEP; y += dy * PUSH_STEP; moved = true;
        it.node.setPosition(x, y, 0);
      }
      if (moved) {
        (it.body as any).impl?.syncPositionToPhysics?.(true);
        it.body.wakeUp();
        it.body.linearVelocity = it.body.linearVelocity.set(dx * PUSH_SPEED, dy * PUSH_SPEED);
        it.body.angularVelocity = (dx < 0 ? 1 : -1) * 6;
        it.releasedAt = S.clock;   // no "stuck half in" eject meanwhile
      } else if (popped) this.endPush(it);
    }
  }
  /** Does the item overlap the bag's inside, the bag scaled by f around its origin (its pop)? */
  private inBagAt(it: ItemView, ox: number, oy: number, f: number): boolean {
    const poly = GameState.bag!.interiorWorld, q = this.scaled;
    q.length = poly.length;
    for (let i = 0; i < poly.length; i++) (q[i] || (q[i] = new Vec2())).set(ox + (poly[i].x - ox) * f, oy + (poly[i].y - oy) * f);
    it.updateShape();
    for (const pts of it.shapes) {
      for (const v of pts) if (Intersection2D.pointInPolygon(v, q)) return true;
      for (const v of q) if (Intersection2D.pointInPolygon(v, pts)) return true;
    }
    return false;
  }
  private scaled: Vec2[] = [];

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
    for (const it of Array.from(this.pushing.keys())) this.endPush(it);
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
    S.winFrames = 0; S.won = false; S.fitNoted = false; S.lost = false; S.paused = false; S.bagReady = false; S.freezeUntil = 0;
  }
}
