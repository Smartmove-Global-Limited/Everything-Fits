// Obstacles placed inside the bag. Port of snug/src/data/blocks.js.
// A level stores { x, y, w, h, kind, color }: (x, y) is the top-left of the bounding frame,
// w × h the frame size, kind the shape inside that frame. Everything that needs the real
// shape (physics, solver, area, drawing) goes through blockPoly.
import { polygonArea } from './geom';
import type { Block, Polygon } from './types';

export const BLOCK_KINDS: { id: string; name: string }[] = [
  { id: 'rect', name: 'Chữ nhật' },
  { id: 'round', name: 'Tròn' },
  { id: 'pill', name: 'Viên thuốc' },
  { id: 'tri', name: 'Tam giác' },
  { id: 'diamond', name: 'Thoi' },
];
export const BLOCK_COLOR = '#C99A6E';

/** web: cung — points on an elliptic arc, n + 1 points */
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Polygon =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (a1 - a0) * i / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as [number, number];
  });

/** Polygon of an obstacle, same coordinate system as b.x, b.y. Built-in shapes are convex;
 *  kind 'poly' (dividers printed in the bag image, see bag.ts fixedWalls) may be concave. */
export function blockPoly(b: Block): Polygon {
  const { x, y, w, h } = b;
  switch (b.kind) {
    case 'poly': return b.pts.map(([px, py]) => [x + px, y + py] as [number, number]);   // pts are relative to the frame's top-left
    case 'round': return arc(x + w / 2, y + h / 2, w / 2, h / 2, 0, Math.PI * 2, 20).slice(0, -1);
    case 'tri': return [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    case 'diamond': return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
    case 'pill': {
      // round both ends along the short side
      if (w >= h) { const r = h / 2; return [...arc(x + w - r, y + r, r, r, -Math.PI / 2, Math.PI / 2, 8), ...arc(x + r, y + r, r, r, Math.PI / 2, Math.PI * 1.5, 8)]; }
      const r = w / 2; return [...arc(x + r, y + h - r, r, r, 0, Math.PI, 8), ...arc(x + r, y + r, r, r, Math.PI, Math.PI * 2, 8)];
    }
    default: return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
}

/** Real area an obstacle takes inside the bag */
export const blockArea = (b: Block): number => (!b.kind || b.kind === 'rect' ? b.w * b.h : polygonArea(blockPoly(b)));
export const blocksArea = (blocks: Block[] | undefined | null): number => (blocks || []).reduce((s, b) => s + blockArea(b), 0);

/** Darker colour of the same hue, for obstacle outlines. Returns 'rgb(r,g,b)' */
export function darker(hex: string | undefined | null, k = .62): string {
  const n = parseInt((hex || BLOCK_COLOR).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * k));
  return `rgb(${c.join(',')})`;
}
