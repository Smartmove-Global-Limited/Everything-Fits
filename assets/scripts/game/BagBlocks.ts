// Obstacles the designer placed inside the bag (levels.json container.blocks; web: art/bags.js
// drawBlocks + physics.js blockBody). A block is { x, y, w, h, kind, color } in level units
// relative to the bag origin (center-bottom of the interior, y down), already at the bag's size.
// Built once per level on the bag: static colliders on the bag's Walls body (group BAG, so they
// stand up and let pushed-out items through exactly like the walls) and a Graphics drawing on a
// node under the bag image, shown and swayed with it. Dividers printed in the bag image
// (fixed: true, from the editor's fixedWalls) are part of the bag prefab already: skipped here.
import { Node, Graphics, UITransform, PolygonCollider2D, Vec2, Color } from 'cc';
import { PhysicsGroup } from '../core/GameConstants';
import { BagView } from './BagView';
import { blockPoly } from '../editor/logic/blocks';

const DEFAULT_COLOR = '#E9903B';   // web: a block without a colour (old casual style)
const OUTLINE = 2.4;               // screen units
const HIGHLIGHT = new Color(255, 255, 255, Math.round(.22 * 255));
const MAX_VERTICES = 8;            // Box2D polygon limit; longer convex outlines are fanned

/** Build the blocks of a level on its bag (replacing those of the previous level on this bag) */
export function buildBlocks(bag: BagView, container: any, scale: number) {
  clearBlocks(bag);
  const blocks: any[] = (container?.blocks || []).filter((b: any) => b && !b.fixed && b.w > 0 && b.h > 0);
  if (!blocks.length) return;
  const s = scale || 1;
  // art node: drawn over the bag image, under the items (another layer); same transform as the bag
  const art = new Node('Blocks');
  art.layer = bag.node.layer;
  art.addComponent(UITransform);
  bag.node.addChild(art);
  const g = art.addComponent(Graphics);
  bag.blocksArt = art;
  const fill = new Color(), edge = new Color();
  for (const b of blocks) {
    // polygon in bag node space (scale 1, y up): level units / bag scale, y flipped
    const poly = blockPoly(b).map(([x, y]) => new Vec2(x / s, -y / s));
    fill.fromHEX(b.color || DEFAULT_COLOR);
    edge.set(Math.round(fill.r * .62), Math.round(fill.g * .62), Math.round(fill.b * .62), 255);
    const rect = !b.kind || b.kind === 'rect';
    g.fillColor = fill;
    if (rect) g.roundRect(b.x / s, -(b.y + b.h) / s, b.w / s, b.h / s, Math.min(8, b.w / 4, b.h / 4) / s);
    else path(g, poly);
    g.fill();
    // soft light on the upper part (web: white 22% over the top 38%, clipped to the shape)
    if (b.color) {
      const band = clipAbove(poly, -(b.y + b.h * .38) / s);
      if (band.length >= 3) { g.fillColor = HIGHLIGHT; path(g, band); g.fill(); }
    }
    g.strokeColor = edge; g.lineWidth = OUTLINE / s;
    if (rect) g.roundRect(b.x / s, -(b.y + b.h) / s, b.w / s, b.h / s, Math.min(8, b.w / 4, b.h / 4) / s);
    else path(g, poly);
    g.stroke();
    // physics: on the walls body, which stands up when the bag appears
    if (bag.walls) for (const piece of fan(poly)) {
      const c = bag.walls.addComponent(PolygonCollider2D);
      c.points = piece; c.friction = .04; c.restitution = .05; c.group = PhysicsGroup.BAG;
      bag.blockColliders.push(c);
    }
  }
}

/** Take the blocks of the previous level off this bag */
export function clearBlocks(bag: BagView) {
  for (const c of bag.blockColliders) if (c.isValid) c.destroy();
  bag.blockColliders.length = 0;
  if (bag.blocksArt && bag.blocksArt.isValid) bag.blocksArt.destroy();
  bag.blocksArt = null;
}

function path(g: Graphics, pts: Vec2[]) {
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.close();
}

/** The part of a polygon with y >= yMin (Sutherland–Hodgman against one half-plane) */
function clipAbove(poly: Vec2[], yMin: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a.y >= yMin, inb = b.y >= yMin;
    if (ina) out.push(a);
    if (ina !== inb) { const t = (yMin - a.y) / (b.y - a.y); out.push(new Vec2(a.x + (b.x - a.x) * t, yMin)); }
  }
  return out;
}

/** A convex polygon split into fans of at most MAX_VERTICES points (chords from the first point) */
function fan(poly: Vec2[]): Vec2[][] {
  if (poly.length <= MAX_VERTICES) return [poly];
  const pieces: Vec2[][] = [];
  for (let i = 1; i < poly.length - 1; i += MAX_VERTICES - 2) {
    pieces.push([poly[0], ...poly.slice(i, Math.min(i + MAX_VERTICES - 1, poly.length))]);
  }
  return pieces;
}
