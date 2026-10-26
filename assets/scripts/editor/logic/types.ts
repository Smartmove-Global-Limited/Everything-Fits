// Shared data types of the level-editor logic. They describe the same JSON as the web game
// (public/content/<art>/levels.json, assets/<chapter>/items/<id>.json, assets/<chapter>/bags/<key>.json).
// Level coordinates: screen space of the 420-wide design, y grows DOWN (same as the web game).
// Container shapes are local to the bag: origin at the bottom centre of the bag interior.

/** [x, y] */
export type Vec2 = [number, number];
/** Closed polygon, list of vertices */
export type Polygon = Vec2[];

/** Axis-aligned bounding box as returned by geom.bbox */
export interface BBox { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number; }

// ---------------------------------------------------------------- bags

/** Bag skin manifest (assets/<chapter>/bags/<key>.json) */
export interface BagSkin {
  id: string;
  name?: string;
  nameEn?: string;
  /** fixed-shape bag: the interior comes from the image (`inner`) */
  fixed?: boolean;
  pixelsPerUnit?: number;
  edge?: unknown;
  /** interior polygon at scale 1, level coordinates (origin bottom centre) */
  inner?: Polygon;
  /** printed dividers at scale 1, level coordinates */
  walls?: Polygon[];
  /** image rectangle at scale 1, level coordinates */
  image: { x: number; y: number; w: number; h: number };
  layers?: Record<string, string>;
  [key: string]: unknown;
}
export type BagSkinMap = Record<string, BagSkin>;

/** Obstacle inside the bag. (x, y) = top-left of the bounding frame, w × h = frame size. */
export type BlockKind = 'rect' | 'round' | 'pill' | 'tri' | 'diamond' | 'poly';
export interface Block {
  x: number; y: number; w: number; h: number;
  kind?: BlockKind | string;
  color?: string;
  /** kind 'poly': vertices relative to the frame's top-left */
  pts?: Polygon;
  /** generated from the bag image (fixedWalls), never stored in the level */
  fixed?: boolean;
  [key: string]: unknown;
}

/** level.container */
export interface Container {
  skin?: string;
  scale?: number;
  cx?: number;
  bottom?: number;
  shape?: Polygon;
  blocks?: Block[];
  closed?: boolean;
  areas?: unknown[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------- levels

/** One entry of level.items */
export interface LevelItem {
  id: number;
  x?: number;
  y?: number;
  angle?: number;
  scale?: number;
  inBag?: boolean;
  link?: unknown;
  locked?: boolean;
  /** opaque reference copied to solver plans */
  ref?: unknown;
  [key: string]: unknown;
}

/** One entry of level.solution (see solution.ts) */
export interface SolutionStep {
  /** index into level.items */
  i: number;
  id: number;
  /** item scale used when the solution was computed */
  s: number;
  /** screen position of the item origin */
  x: number;
  y: number;
  angle: number;
}

export interface LevelDifficultyTag { points: number; tier: string; }

export interface Level {
  id: string;
  name?: string;
  nameEn?: string;
  timer?: number;
  /** background id (number); the old template generator writes a scene name string */
  background?: number | string;
  container: Container;
  mode?: string;
  items: LevelItem[];
  itemScale?: number;
  reward?: { coin: number; [key: string]: unknown };
  emptyText?: string;
  /** Home Play button colour: Easy | Hard | Super Hard (core/PlayDifficulty) */
  playDifficulty?: string;
  difficulty?: LevelDifficultyTag;
  solution?: SolutionStep[];
  [key: string]: unknown;
}

export interface Chapter {
  id: string;
  no?: number;
  name?: string;
  background?: number;
  reward?: { coin: number };
  assets?: { items: number[]; backgrounds: number[]; bags: string[] };
  levels: Level[];
  [key: string]: unknown;
}

export interface LevelBook {
  version?: number;
  publishedAt?: string;
  chapters: Chapter[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------- items

export interface ItemMeta {
  size?: string;
  shape?: string;
  physics?: string;
  cost?: number;
  canLink?: boolean;
  canLock?: boolean;
  gram?: number;
  material?: string;
  [key: string]: unknown;
}

export type ItemShapeKind = 'rect' | 'circle' | 'poly' | 'compound';

/** A physics shape piece of an item (the def itself, def.extra, or one of def.parts) */
export interface ItemPart {
  kind: ItemShapeKind;
  w?: number; h?: number; chamfer?: number;
  r?: number;
  pts?: Polygon;
  dx?: number; dy?: number;
}

/** Item definition (web: entry of ITEM_DEFS after applyManifest) */
export interface ItemDef extends ItemPart {
  id: number;
  slug: string;
  code: string | null;
  name: string;
  nameEn?: string;
  /** local drawing frame [x0, y0, x1, y1] */
  box: [number, number, number, number];
  extra?: ItemPart;
  parts?: ItemPart[];
  meta: ItemMeta;
  /** outline for drawing (more precise than the collider) */
  outline?: Polygon | null;
  /** raw sprite info from the manifest (the web version holds a loaded image here) */
  sprite?: { src: string; pixelsPerUnit: number };
  restitution?: number;
}

/** Collider spec of an item manifest */
export interface ColliderSpec {
  kind: 'circle' | 'rect' | 'poly' | 'polys';
  r?: number;
  w?: number; h?: number; chamfer?: number;
  pts?: Polygon;
  parts?: Polygon[];
  outer?: Polygon;
}

/** Item manifest JSON (assets/<chapter>/items/<id>.json) */
export interface ItemManifest {
  id: number | string;
  slug?: string;
  code?: string | null;
  name?: string;
  nameEn?: string;
  meta?: ItemMeta;
  collider?: ColliderSpec;
  outline?: Polygon;
  sprite?: { src: string; pixelsPerUnit?: number };
  [key: string]: unknown;
}

/** Anything that can resolve an item id to its def (ItemCatalog implements it) */
export interface ItemLookup {
  defById(id: number | string): ItemDef | undefined;
}

/** id → item area (units²) */
export type AreaOf = (id: number) => number;

// ---------------------------------------------------------------- difficulty

export interface DifficultyRow { label: string; cond: string; pts: number; }
export interface DifficultyResult {
  rows: DifficultyRow[];
  total: number;
  tier: string;
  density: number;
  itemArea: number;
  usable: number;
  count: number;
}
