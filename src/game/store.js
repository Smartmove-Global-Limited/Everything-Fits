// Mua hàng bằng tiền thật và quyền lợi No Ads.
//
// TẠM THỜI: chưa gắn cửa hàng ứng dụng (Google Play Billing). muaGoi() chỉ GIẢ LẬP một giao
// dịch thành công sau một nhịp chờ. Giá hiển thị là giá thiết kế trong Figma; bản thật lấy giá
// từ cửa hàng trả về (tài liệu UI, mục Quy tắc mua hàng).
// Gắn billing thật thì thay thân muaGoi / khoiPhuc; nơi gọi giữ nguyên: chỉ cộng thưởng khi
// Promise trả true, mỗi giao dịch chỉ nhận một lần.
const KEY_NO_ADS = 'snug.noads.v1';
const CREATIVE = new URLSearchParams(location.search).get('creative') === '1';

let noAds = !CREATIVE && (() => { try { return localStorage.getItem(KEY_NO_ADS) === '1'; } catch { return false; } })();

export const coNoAds = () => noAds;
export function batNoAds() {
  noAds = true;
  if (!CREATIVE) try { localStorage.setItem(KEY_NO_ADS, '1'); } catch {}
}

/** Mua một gói. Trả về Promise<boolean>: true khi giao dịch được xác nhận. */
export function muaGoi(/* maGoi */) {
  return new Promise(xong => setTimeout(() => xong(true), 900));
}

/** Khôi phục giao dịch đã mua. Chỉ trả lại No Ads (gói vàng / booster là hàng tiêu dùng). */
export function khoiPhuc() {
  return new Promise(xong => setTimeout(() => xong({ noAds }), 700));
}
