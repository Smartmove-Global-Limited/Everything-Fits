// Fixed-shape bags. Port of snug/src/data/bag.js.
// The bag interior follows the image (bag manifest has `fixed` + `inner`); a level only picks the
// size (container.scale) and places obstacles. Levels still store the computed `shape` so Node
// tools can read it directly, but at runtime it is always recomputed from the bag skin.
import type { BagSkin, BagSkinMap, Block, Container, Polygon } from './types';

/** Bag placement on screen: the bottom of the bag IMAGE sits on BAG_FLOOR; a big bag must not
 *  rise above BAG_CEIL (timer / item count area). Same values as core/GameConstants.ts. */
export const BAG_FLOOR = 444, BAG_CEIL = 112;
/** Biggest bag scale offered by the editor */
export const MAX_SCALE = 1.3;
export const maxScale = (): number => MAX_SCALE;
/** Max bag width that still fits between both screen edges (reference) */
export const BAG_MAX_W = 408;
export const MIN_SCALE = .5;

/** Interior of a fixed-shape bag at `scale`, level coordinates (origin bottom centre) */
export const fixedShape = (skin: BagSkin, scale = 1): Polygon =>
  skin.inner.map(([x, y]) => [Math.round(x * scale * 10) / 10, Math.round(y * scale * 10) / 10] as [number, number]);

export const isFixedSkin = (skin: BagSkin | undefined | null): boolean => !!(skin?.fixed && skin.inner?.length >= 3);

/** Biggest scale that fits between the HUD and the table without leaving the screen
 *  (web: vuaManHinh) */
export const fitScreenScale = (skin: BagSkin): number => Math.min((BAG_FLOOR - BAG_CEIL) / skin.image.h, BAG_MAX_W / skin.image.w);

/**
 * Dividers printed in the bag image (manifest `walls`, level coordinates at scale 1), turned into
 * 'poly' obstacles at `scale`. Only generated when building the bag (resolveContainer), NEVER
 * written to the level. `fixed` tells render/editor the divider is already in the image.
 */
export function fixedWalls(skin: BagSkin | undefined | null, scale = 1): Block[] {
  return (skin?.walls || []).map(poly => {
    const pts = poly.map(([x, y]) => [x * scale, y * scale] as [number, number]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {
      kind: 'poly', fixed: true, x: +x.toFixed(1), y: +y.toFixed(1), w: +(Math.max(...xs) - x).toFixed(1), h: +(Math.max(...ys) - y).toFixed(1),
      pts: pts.map(([px, py]) => [+(px - x).toFixed(1), +(py - y).toFixed(1)] as [number, number]),
    };
  });
}

/** Level container → container to build: for a fixed-shape bag the shape comes from the skin */
export function resolveContainer(c: Container, skins: BagSkinMap | undefined | null): Container {
  const skin = skins?.[c?.skin];
  if (!isFixedSkin(skin)) return c;
  const s = c.scale || 1;
  // the bag position is computed at runtime too: moving BAG_FLOOR moves every level
  return {
    ...c, scale: s, bottom: +(BAG_FLOOR - (skin.image.y + skin.image.h) * s).toFixed(1), shape: fixedShape(skin, s), closed: true,
    blocks: [...(c.blocks || []).filter(b => !b.fixed), ...fixedWalls(skin, s)],
  };
}

/**
 * Put a fixed-shape bag at size s: interior recomputed from the image, obstacles scaled by the
 * same ratio (keeping their relative place), image bottom anchored on the table edge.
 */
export function placeFixed(c: Container, skin: BagSkin, s: number): Container {
  s = +s.toFixed(3);   // scale is stored with 3 decimals; shape and placement use the stored value
  const cu = c.scale || s, k = s / cu;
  return {
    ...c, skin: c.skin, cx: c.cx ?? 210, scale: s,
    bottom: +(BAG_FLOOR - (skin.image.y + skin.image.h) * s).toFixed(1),
    shape: fixedShape(skin, s),
    blocks: (c.blocks || []).map(b => ({ ...b, x: Math.round(b.x * k), y: Math.round(b.y * k), w: Math.round(b.w * k), h: Math.round(b.h * k) })),
  };
}
