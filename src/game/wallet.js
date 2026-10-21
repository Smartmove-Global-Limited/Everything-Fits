// Ví vàng của người chơi, lưu ngay trong máy (localStorage). Dùng chung cho mọi bộ art:
// vàng là tiền của người chơi, không phải của level.
// Creative Tool chạy cùng origin với game nên chỉ giữ ví trong bộ nhớ, như progress.js:
// quay video xong không được làm đổi ví của người chơi thật.
const KEY = 'snug.gold.v1';
const CREATIVE = new URLSearchParams(location.search).get('creative') === '1';

let gold = CREATIVE ? 0 : load();
const nghe = [];

function load() {
  try { return Math.max(0, Number(localStorage.getItem(KEY)) | 0); } catch { return 0; }
}
function save() { if (CREATIVE) return; try { localStorage.setItem(KEY, String(gold)); } catch {} }

export const getGold = () => gold;

/** Cộng (hoặc trừ, n âm) vàng. Không bao giờ xuống dưới 0. */
export function addGold(n) {
  gold = Math.max(0, gold + (n | 0));
  save();
  for (const fn of nghe) fn(gold);
  return gold;
}

/** Gọi lại mỗi khi số vàng đổi, để ai đang hiện số vàng tự cập nhật */
export function onGoldChange(fn) { nghe.push(fn); }
