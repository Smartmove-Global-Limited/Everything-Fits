// Túi dáng cố định: hình lòng túi đi theo ảnh (manifest túi có `fixed` + `inner`), level chỉ
// chọn cỡ (container.scale) và đặt vật cản. Level vẫn ghi kèm `shape` đã tính sẵn để công cụ
// chạy bằng Node (máy xếp, bảng độ khó) đọc thẳng, nhưng lúc chơi luôn tính lại từ ảnh túi:
// vẽ lại túi là hình lòng túi của mọi level đổi theo, không để sót level nào còn hình cũ.

/** Lòng túi của một túi dáng cố định ở cỡ scale, toạ độ level (gốc giữa đáy) */
export const fixedShape = (skin, scale = 1) =>
  skin.inner.map(([x, y]) => [Math.round(x * scale * 10) / 10, Math.round(y * scale * 10) / 10]);

export const isFixedSkin = skin => !!(skin?.fixed && skin.inner?.length >= 3);

/**
 * Vách ngăn in sẵn trong ảnh túi (manifest `walls`: các đa giác toạ độ level ở scale 1), đổi thành
 * vật cản kiểu 'poly' ở cỡ scale. Chỉ sinh lúc dựng túi (resolveContainer), KHÔNG ghi vào level:
 * level chỉ giữ vật cản người thiết kế đặt thêm, vẽ lại ảnh túi là vách của mọi level đổi theo.
 * `fixed` để render/editor biết vách đã có trong ảnh, không tô màu đè lên.
 */
export function fixedWalls(skin, scale = 1) {
  return (skin?.walls || []).map(poly => {
    const pts = poly.map(([x, y]) => [x * scale, y * scale]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { kind: 'poly', fixed: true, x: +x.toFixed(1), y: +y.toFixed(1), w: +(Math.max(...xs) - x).toFixed(1), h: +(Math.max(...ys) - y).toFixed(1),
      pts: pts.map(([px, py]) => [+(px - x).toFixed(1), +(py - y).toFixed(1)]) };
  });
}

/** container của level → container để dựng: túi dáng cố định thì hình lấy từ ảnh túi */
export function resolveContainer(c, skins) {
  const skin = skins?.[c?.skin];
  if (!isFixedSkin(skin)) return c;
  const s = c.scale || 1;
  // chỗ đặt túi cũng tính lúc chạy: đổi mốc BAG_FLOOR là mọi level dời theo, không phải dựng lại
  return { ...c, scale: s, bottom: +(BAG_FLOOR - (skin.image.y + skin.image.h) * s).toFixed(1), shape: fixedShape(skin, s), closed: true,
    blocks: [...(c.blocks || []).filter(b => !b.fixed), ...fixedWalls(skin, s)] };
}

// Chỗ đặt túi trên màn: đáy ẢNH túi luôn ngay trên mép bàn (TABLE_Y 482), túi to thì nhô lên
// phía trên, không được cao quá dòng BAG_CEIL (vùng đồng hồ và số món).
// Dời xuống 30 cùng mép khay (TABLE_Y) để túi phóng to không đè lên cụm tên màn + đồng hồ,
// cụm đó cũng đã dồn lên trên và nhỏ lại (main.css). BAG_CEIL là mép dưới cụm đó.
export const BAG_FLOOR = 444, BAG_CEIL = 112;   // đáy túi cách mép khay 38: đồ trên khay phóng to vẫn không sát túi
/** Cỡ túi lớn nhất cho chỉnh trong editor và Creative. Trước đây kẹp theo chỗ trống giữa
 *  đồng hồ và mép bàn (thường ~100%); người thiết kế cần phóng tới 200%, túi to quá thì nhô
 *  lên sau HUD hay tràn hai mép màn, tự canh bằng mắt. */
export const MAX_SCALE = 1.3;   // người thiết kế chỉ cần tới 130%
export const maxScale = () => MAX_SCALE;
/** Cỡ lớn nhất túi còn nằm gọn giữa đồng hồ và mép bàn, không tràn hai mép màn (để tham khảo) */
export const BAG_MAX_W = 408;
export const vuaManHinh = skin => Math.min((BAG_FLOOR - BAG_CEIL) / skin.image.h, BAG_MAX_W / skin.image.w);
export const MIN_SCALE = .5;

/**
 * Đặt túi dáng cố định về cỡ s: hình lòng túi tính lại từ ảnh, vật cản phóng cùng tỉ lệ
 * (giữ nguyên chỗ tương đối trong túi), đáy ảnh túi neo trên mép bàn.
 */
export function placeFixed(c, skin, s) {
  s = +s.toFixed(3);   // cỡ lưu 3 chữ số; hình và chỗ đặt tính theo đúng số đã lưu
  const cu = c.scale || s, k = s / cu;
  return {
    ...c, skin: c.skin, cx: c.cx ?? 210, scale: s,
    bottom: +(BAG_FLOOR - (skin.image.y + skin.image.h) * s).toFixed(1),
    shape: fixedShape(skin, s),
    blocks: (c.blocks || []).map(b => ({ ...b, x: Math.round(b.x * k), y: Math.round(b.y * k), w: Math.round(b.w * k), h: Math.round(b.h * k) })),
  };
}
