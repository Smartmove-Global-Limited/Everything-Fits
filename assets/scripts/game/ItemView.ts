import { _decorator, Component, Enum, RigidBody2D, Collider2D, PolygonCollider2D, CircleCollider2D, UITransform, Sprite, ERigidBody2DType, Vec2, Rect, Mat4, Contact2DType, IPhysics2DContact } from 'cc';
import { PhysicsGroup } from '../core/GameConstants';
const { ccclass, property, requireComponent, disallowMultiple } = _decorator;

/** Physics behaviour of an item (meta.physics in the web item data) */
export enum ItemPhysics { NORMAL = 0, ROLLING = 1, FLOAT = 2, VIBRATING = 3, BOUNCY = 4 }
/** Mass class, chosen for gameplay feel (not real grams, not size) */
export enum MassClass { LIGHT = 0, MEDIUM = 1, HEAVY = 2 }

/**
 * One packable item. Lives on each item prefab (assets/resources/items/<id>.prefab) together
 * with a Sprite, a RigidBody2D (group ITEM) and the Polygon/CircleCollider2D shapes of the item.
 * Prefabs are generated from the web item data (tools/generate-item-prefabs) and can be edited
 * by hand in Cocos afterwards: collider points, mass class, material…
 *
 * No update() here: the single game loop (GameLoop) walks the item list and reads the cached
 * references and state below.
 */
@ccclass('ItemView')
@requireComponent(RigidBody2D)
@disallowMultiple
export class ItemView extends Component {
  @property({ tooltip: 'Item id (as used in levels.json)' }) itemId = 0;
  @property({ tooltip: 'Vietnamese name' }) nameVi = '';
  @property({ tooltip: 'English name' }) nameEn = '';
  @property({ type: Enum(ItemPhysics), tooltip: 'Rolling: slippery, slides into gaps. Float: balloon. Vibrating: phone.' }) physicsType = ItemPhysics.NORMAL;
  @property({ type: Enum(MassClass), tooltip: 'Gameplay weight class. Regenerate the prefab after changing it to recompute density.' }) massClass = MassClass.MEDIUM;
  @property({ tooltip: 'Material: fabric, paper, food, glass, ceramic, metal, plastic… (impact sound, soft items)' }) material = '';
  @property({ tooltip: 'Fragile: cracks when a hard item lands on it hard; breaks on the second crack' }) fragile = false;
  @property({ tooltip: 'Estimated weight in grams (reference only, impact sound volume)' }) grams = 150;
  @property({ tooltip: 'Inventory size: Small / Medium / Large' }) sizeClass = 'Medium';
  @property({ tooltip: 'Shape tag: Rectangle, Oval, Long, Irregular…' }) shapeTag = '';
  @property canLink = true;
  @property canLock = true;
  @property({ type: [Vec2], tooltip: 'Outer outline in node space (drawn while the item is held: green fits, red does not)' }) outline: Vec2[] = [];

  // ---- cached references, resolved once ----
  body: RigidBody2D = null!;
  colliders: Collider2D[] = [];
  /** collider densities from the prefab (tuned for the item at scale 1) */
  private baseDensity: number[] = [];
  transform2d: UITransform = null!;
  sprite: Sprite | null = null;

  // ---- per-round state (not serialized) ----
  levelIndex = -1;        // index in level.items: two items with the same id are still counted separately
  levelScale = 1;         // per-level size (the node is scaled by it)
  waiting = false;        // not yet dropped into the field (level intro)
  entering = false;       // dropping in from above the screen (group FALLING)
  enterAt = 0;
  presetInBag = false;    // placed inside the bag from the start
  locked = false;         // hidden in a mystery box
  releasedAt = 0; stuckFrames = 0; insideFrames = 0; outsideFrames = 0; fitAt = 0;
  frozen = false; holdUntil = 0;
  cracks = 0; crackedAt = 0; broken = false;
  held = false;
  lastImpactAt = 0;       // impact sound throttle (game clock)
  buzzClock = 0;          // phone: time spent inside the bag
  pressedUntil = 0;       // balloon: something lies on top of it until then
  shakeFriction: number[] | null = null;   // collider friction saved while shaking
  frictionBackAt = 0;

  /** Set by game/Mechanics: impact sounds, dust, fragile cracks */
  static contactHandler: ((item: ItemView, self: Collider2D, other: Collider2D, c: IPhysics2DContact | null) => void) | null = null;

  // ---- shape at the CURRENT node transform ----
  // Box2D world data (worldPoints, worldAABB) is only refreshed by a physics step, so it lags one
  // frame behind a node moved by hand (the held item). The bag rules read this instead.
  private localPolys: Vec2[][] = [];
  /** shape area at scale 1 (units²) */
  private baseArea = 0;
  private worldPolys: Vec2[][] = [];
  /** world bounds of the shape, valid after updateShape() */
  readonly bounds = new Rect();
  private shapeKey = new Float64Array(5).fill(NaN);
  private static readonly mat = new Mat4();

  onLoad() {
    this.body = this.getComponent(RigidBody2D)!;
    this.colliders = this.getComponents(Collider2D);
    this.baseDensity = this.colliders.map(c => c.density);
    this.transform2d = this.getComponent(UITransform)!;
    this.sprite = this.getComponent(Sprite);
    for (const c of this.colliders) c.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
    for (const c of this.colliders) {
      const pts: Vec2[] = [];
      if (c instanceof PolygonCollider2D) for (const p of c.points) pts.push(new Vec2(p.x + c.offset.x, p.y + c.offset.y));
      else if (c instanceof CircleCollider2D) for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; pts.push(new Vec2(c.offset.x + Math.cos(a) * c.radius, c.offset.y + Math.sin(a) * c.radius)); }
      if (pts.length < 3) continue;
      this.localPolys.push(pts);
      let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
      this.baseArea += Math.abs(a) / 2;
      this.worldPolys.push(pts.map(() => new Vec2()));
    }
  }

  onDestroy() { for (const c of this.colliders) if (c.isValid) c.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this); }

  private onBeginContact(self: Collider2D, other: Collider2D, contact: IPhysics2DContact | null) {
    ItemView.contactHandler?.(this, self, other, contact);
  }

  /** Polygons of the item in world (= Field) space at the current node transform */
  get shapes(): Vec2[][] { this.updateShape(); return this.worldPolys; }

  /** Recompute the world polygons if the node moved, rotated or scaled since the last call */
  updateShape() {
    const n = this.node, p = n.position, r = n.rotation, k = this.shapeKey;
    if (k[0] === p.x && k[1] === p.y && k[2] === r.z && k[3] === r.w && k[4] === n.scale.x) return;
    k[0] = p.x; k[1] = p.y; k[2] = r.z; k[3] = r.w; k[4] = n.scale.x;
    const m = n.getWorldMatrix(ItemView.mat);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.localPolys.length; i++) {
      const src = this.localPolys[i], dst = this.worldPolys[i];
      for (let j = 0; j < src.length; j++) {
        const v = Vec2.transformMat4(dst[j], src[j], m);
        if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x; if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
      }
    }
    this.bounds.set(x0, y0, x1 - x0, y1 - y0);
  }

  /** Pick up: the body leaves the physics world while the finger moves the node */
  beginHold() {
    this.held = true;
    this.body.enabled = false;
  }

  /** Drop: back in the world, at rest, at the node position */
  endHold() {
    this.held = false;
    this.body.type = ERigidBody2DType.Dynamic;
    this.body.enabled = true;
    this.body.gravityScale = 1;
    this.stop();
    this.body.wakeUp();
  }

  /** Change the collision group of the body and all colliders */
  setGroup(group: number) {
    this.body.group = group;
    for (const c of this.colliders) { c.group = group; c.apply(); }
  }

  /**
   * Scale the item for this level. Box2D keeps density fixed, so a bigger item would get heavier
   * with its area; the weight is a gameplay class instead, so density is divided by the area gain.
   */
  setLevelScale(k: number) {
    this.levelScale = k;
    this.node.setScale(k, k, 1);
    const inv = 1 / (k * k);
    for (let i = 0; i < this.colliders.length; i++) { this.colliders[i].density = this.baseDensity[i] * inv; this.colliders[i].apply(); }
    // Air drag by grams per area, like the web (physics.js apDungCanNang): an apple-like item keeps
    // Matter's 0.01, tickets and paper glide down (0.06), a laptop falls almost freely (0.003).
    // Web frictionAir f per 1/60 s step → Box2D linear damping −ln(1 − f) × 60 per second.
    if (this.physicsType !== ItemPhysics.FLOAT) {
      const density = (this.grams || 150) / Math.max(1, this.baseArea * k * k);
      const f = Math.max(.003, Math.min(.07, .012 * Math.pow(.04 / density, .9)));
      this.body.linearDamping = -Math.log(1 - f) * 60;
    }
  }

  stop() { this.body.linearVelocity = this.body.linearVelocity.set(0, 0); this.body.angularVelocity = 0; }

  get isStatic() { return this.body.type === ERigidBody2DType.Static; }
}
