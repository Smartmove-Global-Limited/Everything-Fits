import { _decorator, Component, Enum, RigidBody2D, Collider2D, UITransform, Sprite, ERigidBody2DType, Contact2DType, IPhysics2DContact } from 'cc';
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
  // while held (sensor, group HELD): number of overlapping colliders, by what they belong to
  heldItemContacts = 0; heldWallContacts = 0; heldBagContacts = 0;
  held = false;

  onLoad() {
    this.body = this.getComponent(RigidBody2D)!;
    this.colliders = this.getComponents(Collider2D);
    this.baseDensity = this.colliders.map(c => c.density);
    this.transform2d = this.getComponent(UITransform)!;
    this.sprite = this.getComponent(Sprite);
    for (const c of this.colliders) {
      c.on(Contact2DType.BEGIN_CONTACT, this.onBegin, this);
      c.on(Contact2DType.END_CONTACT, this.onEnd, this);
    }
  }

  onDestroy() {
    for (const c of this.colliders) { c.off(Contact2DType.BEGIN_CONTACT, this.onBegin, this); c.off(Contact2DType.END_CONTACT, this.onEnd, this); }
  }

  /** Overlap counting while held. Other contacts (impacts) are handled by the game loop listeners. */
  private onBegin(self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) { if (this.held) this.countContact(other, 1); }
  private onEnd(self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) { if (this.held) this.countContact(other, -1); }
  private countContact(other: Collider2D, d: number) {
    const g = other.group;
    if (g === PhysicsGroup.ITEM) this.heldItemContacts = Math.max(0, this.heldItemContacts + d);
    else if (g === PhysicsGroup.WALL) this.heldWallContacts = Math.max(0, this.heldWallContacts + d);
    else if (g === PhysicsGroup.BAG) this.heldBagContacts = Math.max(0, this.heldBagContacts + d);
  }

  /** Pick up: the body stays in the world as a weightless sensor so overlaps are still reported */
  beginHold() {
    this.held = true; this.heldItemContacts = this.heldWallContacts = this.heldBagContacts = 0;
    this.body.type = ERigidBody2DType.Dynamic;
    this.body.gravityScale = 0;
    // a still body in the hand would fall asleep, and sleeping bodies report no new contacts
    this.body.allowSleep = false;
    this.configure(PhysicsGroup.HELD, true);
    this.stop();
    this.body.wakeUp();
  }

  /** Drop: a solid item again */
  endHold() {
    this.held = false;
    this.configure(PhysicsGroup.ITEM, false);
    this.body.gravityScale = 1;
    this.body.allowSleep = true;
    this.stop();
    this.body.wakeUp();
  }

  /** Enable / disable the physics body: picked up = removed from the world, dropped = back in */
  setPhysicsEnabled(on: boolean) { this.body.enabled = on; }

  /** Change the collision group of the body and all colliders */
  setGroup(group: number) { this.configure(group, this.colliders.length ? this.colliders[0].sensor : false); }

  /**
   * Group + sensor flag in one pass: each collider rebuilds its fixtures once (apply() is not free).
   * Sensors pass through everything and only report overlaps (used while held).
   */
  configure(group: number, sensor: boolean) {
    this.body.group = group;
    for (const c of this.colliders) { c.group = group; c.sensor = sensor; c.apply(); }
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
  }

  stop() { this.body.linearVelocity = this.body.linearVelocity.set(0, 0); this.body.angularVelocity = 0; }

  get isStatic() { return this.body.type === ERigidBody2DType.Static; }
}
