// Lời giải lưu sẵn trong level: cách xếp khít đã tính trước lúc thiết kế (tools/thiết kế level).
//
//   level.solution = [{ i, id, s, x, y, angle }, ...]
//     i      chỉ số món trong level.items
//     id, s  mã và cỡ của món lúc tính lời giải, để biết lời giải còn khớp không
//     x, y   GỐC HÌNH của món trên màn (cùng quy ước với level.items và kế hoạch máy xếp)
//     angle  góc xoay
//   Thứ tự trong mảng không quan trọng.
//
// Máy tự chơi (game/autoplay.js) dùng lời giải này thay cho máy xếp: máy xếp chỉ ước lượng
// trên lưới nên không tìm lại được cách xếp khít 85–90% như lúc thiết kế. Máy đặt theo thứ
// tự MÉP DƯỚI từ thấp lên cao (thuTuDat): người chơi thật xếp từ đáy túi lên, đặt món trên
// cao trước thì nó rơi xuống chỗ của món khác.
// Sửa level trong editor mà đổi món hay đổi cỡ thì lời giải không còn khớp → bỏ qua, quay về
// máy xếp như cũ.

import { hinhMon } from './solver.js';

/** Mép dưới (y lớn nhất trên màn) của món khi nằm đúng bước này */
export function mepDuoi(st) {
  const h = hinhMon(st.id); if (!h) return st.y;
  const c = Math.cos(st.angle || 0), s = Math.sin(st.angle || 0), k = st.s || 1;
  let max = -Infinity;
  for (const p of h) for (const [x, y] of p) max = Math.max(max, (x * s + y * c) * k);
  return st.y + max;
}

/** Thứ tự đặt: món có mép dưới thấp nhất (gần đáy túi) trước */
export const thuTuDat = ds => ds.slice().sort((a, b) => mepDuoi(b) - mepDuoi(a));

/** Các bước của lời giải nếu còn khớp với món trong level, không thì null */
export function loiGiaiHopLe(level) {
  const ds = level?.solution, items = level?.items;
  if (!Array.isArray(ds) || !ds.length || !Array.isArray(items)) return null;
  const canXep = items.filter(it => !it.inBag && it.id !== 0).length;
  if (ds.length !== canXep) return null;
  const daCo = new Set();
  for (const st of ds) {
    const it = items[st.i];
    if (!it || it.inBag || daCo.has(st.i)) return null;
    if (Number(it.id) !== Number(st.id)) return null;
    if (Math.abs((Number(it.scale) || 1) - (Number(st.s) || 1)) > .002) return null;
    daCo.add(st.i);
  }
  return ds;
}
