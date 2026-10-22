import { _decorator, Component, Node, Vec2, Intersection2D } from 'cc';
const { ccclass, property } = _decorator;

/**
 * One bag style. Lives on the bag prefab (assets/resources/bags/<skin>.prefab), generated from the
 * web bag data. The node origin is the CENTER-BOTTOM of the bag interior (the level origin), scale 1.
 *
 *   body   bag image drawn BEHIND the items
 *   front  rim / opening image drawn IN FRONT of the items (moved to the front layer when a level is built)
 *   walls  static body: thin walls following the interior outline + built-in dividers (group BAG)
 *
 * Bag size in a level = node scale (Cocos scales the colliders too); nothing is rebuilt.
 */
@ccclass('BagView')
export class BagView extends Component {
  @property({ tooltip: 'Bag id (container.skin in levels.json)' }) skinId = '';
  @property displayName = '';
  @property({ type: [Vec2], tooltip: 'Interior outline, local coordinates (origin center-bottom, y up), scale 1' }) interior: Vec2[] = [];
  @property({ tooltip: 'Bottom of the bag image relative to the origin (scale 1, negative = below). Used to rest the image on the tray edge.' }) imageBottom = 0;
  @property({ type: Node }) body: Node | null = null;
  @property({ type: Node }) front: Node | null = null;
  @property({ type: Node }) walls: Node | null = null;

  /** Interior in world space, refreshed when the bag moves or scales (shared, not reallocated per frame) */
  readonly interiorWorld: Vec2[] = [];
  minX = 0; maxX = 0; minY = 0; maxY = 0;

  refreshWorldShape() {
    const m = this.node.worldMatrix;
    const out = this.interiorWorld;
    out.length = this.interior.length;
    this.minX = this.minY = Infinity; this.maxX = this.maxY = -Infinity;
    for (let i = 0; i < this.interior.length; i++) {
      const v = out[i] || (out[i] = new Vec2());
      Vec2.transformMat4(v, this.interior[i], m);
      if (v.x < this.minX) this.minX = v.x; if (v.x > this.maxX) this.maxX = v.x;
      if (v.y < this.minY) this.minY = v.y; if (v.y > this.maxY) this.maxY = v.y;
    }
  }

  /** Is a world point inside the bag interior */
  contains(p: Vec2) { return Intersection2D.pointInPolygon(p, this.interiorWorld); }
}
