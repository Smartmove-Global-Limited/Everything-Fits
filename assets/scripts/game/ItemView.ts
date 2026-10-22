import { _decorator, Component, Enum, RigidBody2D, Collider2D, UITransform, Sprite, ERigidBody2DType } from 'cc';
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
  heldContacts = 0;       // while held: number of other colliders overlapping (sensor)

  onLoad() {
    this.body = this.getComponent(RigidBody2D)!;
    this.colliders = this.getComponents(Collider2D);
    this.transform2d = this.getComponent(UITransform)!;
    this.sprite = this.getComponent(Sprite);
  }

  /** Enable / disable the physics body: picked up = removed from the world, dropped = back in */
  setPhysicsEnabled(on: boolean) { this.body.enabled = on; }

  /** Change the collision group of the body and all colliders */
  setGroup(group: number) {
    this.body.group = group;
    for (const c of this.colliders) { c.group = group; c.apply(); }
  }

  /** Sensors pass through everything and only report overlaps (used while held) */
  setSensor(sensor: boolean) { for (const c of this.colliders) { c.sensor = sensor; c.apply(); } }

  stop() { this.body.linearVelocity = this.body.linearVelocity.set(0, 0); this.body.angularVelocity = 0; }

  get isStatic() { return this.body.type === ERigidBody2DType.Static; }
}
