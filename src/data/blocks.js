// Vật cản đặt sẵn trong lòng túi. Level lưu { x, y, w, h, kind, color }: (x, y) là góc trên trái
// của khung bao, w × h là cỡ khung, kind là hình nằm trong khung đó, color là màu tô.
// Mọi nơi cần hình thật của vật cản (vật lý, máy xếp, diện tích, vẽ) đều đi qua blockPoly,
// để năm chỗ không phải tự biết từng hình.
import { polygonArea } from '../util/geom.js';

export const BLOCK_KINDS = [
  { id: 'rect', name: 'Chữ nhật' },
  { id: 'round', name: 'Tròn' },
  { id: 'pill', name: 'Viên thuốc' },
  { id: 'tri', name: 'Tam giác' },
  { id: 'diamond', name: 'Thoi' },
];
export const BLOCK_COLOR = '#C99A6E';

const cung = (cx, cy, rx, ry, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * i / n;
  return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
});

/** Đa giác của vật cản, cùng hệ toạ độ với b.x, b.y. Các hình có sẵn đều lồi; kiểu 'poly'
 *  (vách ngăn in sẵn trong ảnh túi, xem data/bag.js fixedWalls) có thể lõm, vật lý tự cắt lồi. */
export function blockPoly(b) {
  const { x, y, w, h } = b;
  switch (b.kind) {
    case 'poly': return b.pts.map(([px, py]) => [x + px, y + py]);   // pts tính từ góc trên trái khung
    case 'round': return cung(x + w / 2, y + h / 2, w / 2, h / 2, 0, Math.PI * 2, 20).slice(0, -1);
    case 'tri': return [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    case 'diamond': return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
    case 'pill': {
      // bo tròn hai đầu theo cạnh ngắn
      if (w >= h) { const r = h / 2; return [...cung(x + w - r, y + r, r, r, -Math.PI / 2, Math.PI / 2, 8), ...cung(x + r, y + r, r, r, Math.PI / 2, Math.PI * 1.5, 8)]; }
      const r = w / 2; return [...cung(x + r, y + h - r, r, r, 0, Math.PI, 8), ...cung(x + r, y + r, r, r, Math.PI, Math.PI * 2, 8)];
    }
    default: return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
}

/** Diện tích thật vật cản chiếm trong lòng túi */
export const blockArea = b => (!b.kind || b.kind === 'rect' ? b.w * b.h : polygonArea(blockPoly(b)));
export const blocksArea = blocks => (blocks || []).reduce((s, b) => s + blockArea(b), 0);

/** Màu đậm hơn cùng tông, cho viền vật cản */
export function darker(hex, k = .62) {
  const n = parseInt((hex || BLOCK_COLOR).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v * k));
  return `rgb(${c.join(',')})`;
}
