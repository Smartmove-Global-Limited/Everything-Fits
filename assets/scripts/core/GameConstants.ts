// Gameplay constants. Values match the web version (snug: src/game/state.js, src/data/bag.js) so
// levels built with the web Level Editor play the same.
//
// Level data (levels.json) is measured on a 420×760 screen with the origin at the TOP-left,
// y pointing DOWN and angles in radians clockwise. Inside Cocos everything uses the Cocos
// convention: the Field node has its origin at the BOTTOM-left of the design area, y points up,
// angles are degrees counter-clockwise. Conversion happens once, when a level is read.

/**
 * Pixels per Box2D metre. RigidBody2D.linearVelocity is in METRES per second (getLinearVelocity
 * reads Box2D as is) while getLinearVelocityFromWorldPoint returns units per second: divide unit
 * speeds by PTM before comparing with / writing linearVelocity.
 */
export const PTM = 32;

export const DESIGN_W = 420;
/** gap between items lying on the tray and the left / right screen edges (easier to grab); a
 *  dragged item may still go up to the edge */
export const SIDE_PAD = 3;
export const DESIGN_H = 760;

/** Top edge of the tray (items lie below it), in level coordinates (y down) */
export const TABLE_Y = 492;
/** Physical floor of the tray, just above the booster bar, in level coordinates */
export const FLOOR_Y = DESIGN_H - 130;
/** Bag wall thickness */
export const BAG_WALL = 14;

/** Bottom of the bag IMAGE sits on this line (level coordinates); bag never rises above BAG_CEIL */
export const BAG_FLOOR = 444, BAG_CEIL = 112;
export const BAG_MAX_SCALE = 1.3, BAG_MIN_SCALE = .5, BAG_MAX_W = 408;

/** Booster dock: design top edge (level coordinates) */
export const DOCK_TOP_Y = 649;

/** Level y (down) → Field y (up) */
export const levelToFieldY = (y: number) => DESIGN_H - y;
/** Level angle (radians, clockwise) → node angle (degrees, counter-clockwise) */
export const levelToNodeAngle = (rad: number) => -rad * 180 / Math.PI;

/**
 * 2D physics groups. Names and the collision matrix live in Project Settings → Physics, these
 * bits must match the indices there.
 *   ITEM     items resting or moving on the field
 *   WALL     tray floor, screen sides
 *   BAG      bag walls, built-in dividers, obstacles inside the bag
 *   CEILING  invisible ceiling above the screen
 *   HELD     item in the player's hand: colliders become sensors, only report overlaps
 *   FALLING  item dropping in from above the screen at level start (passes the ceiling)
 */
export const PhysicsGroup = {
  ITEM: 1 << 1,
  WALL: 1 << 2,
  BAG: 1 << 3,
  CEILING: 1 << 4,
  HELD: 1 << 5,
  FALLING: 1 << 6,
};

/** Item mass by gameplay class (not real grams, not size). Base mass in kg (Box2D). */
export const MASS_BY_CLASS = [1, 1.6, 2.5];
export const BASE_MASS = 3;
