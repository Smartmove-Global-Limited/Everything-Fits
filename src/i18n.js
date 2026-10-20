// Song ngữ. Game luôn nói tiếng Anh; tiếng Việt chỉ mở bằng tham số ?lang=vi hoặc lệnh từ
// Creative Tool (trang chủ không còn nút đổi ngôn ngữ).
//
// Chữ trong index.html gắn data-i18n="key" (nội dung) hoặc data-i18n-aria="key" (aria-label),
// applyStatic() đổ lại mỗi lần đổi ngôn ngữ. Chữ sinh trong JS gọi t('key', { ten: gia_tri }).
//
// Tên level, tên chương và chữ gợi ý trong túi là NỘI DUNG, nằm trong levels.json:
// name / emptyText là tiếng Việt, nameEn / emptyTextEn là tiếng Anh. Thiếu bản Anh thì
// dùng bản Việt, không để trống.
export const LANGS = ['en', 'vi'];

const D = {
  en: {
    // HUD
    itemsLeft: 'left', chapter: 'CHAPTER {no}', level: 'LEVEL {n}',
    eyebrow: 'CHAPTER {no} · {name} — LEVEL {n}',
    boostFreeze: 'Freeze', boostResize: 'Shrink', boostThrow: 'Throw out',
    pauseAria: 'Pause', backAria: 'Back', sfxAria: 'Toggle sound', musicAria: 'Toggle music', langAria: 'Language',
    // Home
    splashTag: 'Pack it all in!',
    pickLevel: 'Choose a level', play: 'Play', start: 'Start', resume: 'Continue', levelsDone: '{done}/{total} levels',
    finishToUnlock: 'Finish Chapter {no} to unlock',
    // Pause
    paused: 'Paused', resumeBtn: 'Resume', restart: 'Restart', home: 'Home', prevLevel: '‹ Previous', nextLevel: 'Next ›',
    // Win
    winReplay: 'Replay', winNext: 'Next level →',
    winLevel: 'LEVEL {n} COMPLETE!', winPacked: 'Packed!', winTime: 'Completed', winCoins: 'Coins earned',
    rank99: 'Perfect!', rank93: 'Snug as a bug!', rank84: 'Super tidy!', rank72: 'Neatly packed!', rank0: 'It fits!',
    brag: 'You beat <b>{pct}%</b> of players on this level',
    scorePts: 'points', scoreTime: 'time', scoreBoost: 'boosters',
    // Lose
    soClose: 'So close!', timeUp: "Time's up.", leftInTray: '{n} items still out of the bag.',
    broken: '{name} broke!', brokenTitle: 'Oops!', cracked: 'Crack!', packedRight: 'Packed the right way', onTop: '{a} on top of {b}', onFragile: '{a} on fragile {b}', tryAgain: 'Try again', extraTime: '+60 sec', extraTimeDone: '+60 sec!',
    // Toasts
    noFit: "Doesn't fit!", noFitPushed: "Doesn't fit! Pushed back out", pairTogether: 'Tied items must go in together',
    noFitReturned: "Doesn't fit! Put {n} items back", unlockHint: 'Drag the mystery box onto the key in the bag',
    unlocked: 'Unlocked: {name}!', unlockedNoFit: "Unlocked: {name} — it doesn't fit there!",
    nothingToThrow: 'Nothing can be thrown out', threw: 'Threw out {name}', throwFloat: 'Bye!',
    nothingOutside: 'Nothing left outside the bag', shrunk: 'Shrunk {name} by 20%', shakeHint: 'Shake your phone to settle items in the bag', frozen: 'Frozen for {s}s: items stay where you drop them',
    fits: 'It fits!', emptyBag: 'Pack your things here!', lockedSlot: 'LOCKED',
    loadError: 'Could not load level: {msg}',
    // Autoplay
    autoNoPlan: 'No packing plan found', autoAll: 'Autoplay: everything fits', autoSome: 'Autoplay: only {a}/{b} fit',
    autoDoneLeft: 'Autoplay done · {n} items left', autoDoneFit: 'Autoplay done · snug fit!',
    autoStuck: 'No room for {n} more — this level needs a booster',
    autoRetry: 'Not a fit · unpacking to try again ({a}/{b})',
    // Difficulty tiers (content stays in English)
    Easy: 'Easy', Medium: 'Medium', Hard: 'Hard', 'Very Hard': 'Very Hard', Challenge: 'Challenge',
  },
  vi: {
    itemsLeft: 'còn lại', chapter: 'CHƯƠNG {no}', level: 'LEVEL {n}',
    eyebrow: 'CHƯƠNG {no} · {name} — LEVEL {n}',
    boostFreeze: 'Đóng băng', boostResize: 'Thu nhỏ', boostThrow: 'Bỏ đi',
    pauseAria: 'Tạm dừng', backAria: 'Quay lại', sfxAria: 'Bật tắt âm thanh', musicAria: 'Bật tắt nhạc nền', langAria: 'Ngôn ngữ',
    splashTag: 'Xếp gọn mọi thứ vào túi!',
    pickLevel: 'Chọn màn chơi', play: 'Chơi', start: 'Bắt đầu', resume: 'Chơi tiếp', levelsDone: '{done}/{total} màn',
    finishToUnlock: 'Xong Chương {no} để mở',
    paused: 'Tạm dừng', resumeBtn: 'Chơi tiếp', restart: 'Chơi lại', home: 'Về trang chủ', prevLevel: '‹ Level trước', nextLevel: 'Level sau ›',
    winReplay: 'Chơi lại', winNext: 'Level tiếp →',
    winLevel: 'HOÀN THÀNH LEVEL {n}!', winPacked: 'Xếp xong!', winTime: 'Hoàn thành', winCoins: 'Coin nhận được',
    rank99: 'Hoàn hảo!', rank93: 'Khít như in!', rank84: 'Cực gọn!', rank72: 'Gọn gàng!', rank0: 'Vừa khít!',
    brag: 'Bạn vừa vượt <b>{pct}%</b> người chơi ở màn này',
    scorePts: 'điểm', scoreTime: 'thời gian', scoreBoost: 'booster',
    soClose: 'Suýt nữa rồi!', timeUp: 'Hết giờ.', leftInTray: 'Còn {n} món chưa vào túi.',
    broken: '{name} vỡ mất rồi!', brokenTitle: 'Ôi không!', cracked: 'Nứt!', packedRight: 'Xếp đúng kiểu', onTop: '{a} đè lên {b}', onFragile: '{a} đè lên {b} dễ vỡ', tryAgain: 'Thử lại', extraTime: '+60 giây', extraTimeDone: '+60 giây!',
    noFit: 'Không vừa!', noFitPushed: 'Không vừa! Đồ bị đẩy ra ngoài', pairTogether: 'Đồ buộc chung phải vào túi cùng nhau',
    noFitReturned: 'Không vừa! Đã trả {n} món về chỗ cũ', unlockHint: 'Kéo hộp bí ẩn chạm vào chìa khóa trong túi',
    unlocked: 'Mở khóa: {name}!', unlockedNoFit: 'Mở khóa: {name} — không vừa chỗ đó!',
    nothingToThrow: 'Không có món nào bỏ được', threw: 'Đã bỏ {name}', throwFloat: 'Bỏ đi',
    nothingOutside: 'Không còn món nào ngoài túi', shrunk: 'Đã thu nhỏ {name} 20%', shakeHint: 'Lắc điện thoại để đồ trong túi xếp khít hơn', frozen: 'Đóng băng {s} giây: đặt đâu nằm đó',
    fits: 'Vừa khít!', emptyBag: 'Xếp đồ vào đây nào!', lockedSlot: 'NGĂN KHOÁ',
    loadError: 'Lỗi tải level: {msg}',
    autoNoPlan: 'Không tìm được cách xếp nào', autoAll: 'Tự chơi: máy xếp được hết', autoSome: 'Tự chơi: máy chỉ xếp được {a}/{b}',
    autoDoneLeft: 'Tự chơi xong · còn {n} món chưa vào túi', autoDoneFit: 'Tự chơi xong · vừa khít!',
    autoStuck: 'Hết chỗ cho {n} món — màn này cần booster',
    autoRetry: 'Chưa vừa · tháo ra xếp lại ({a}/{b})',
    Easy: 'Dễ', Medium: 'Vừa', Hard: 'Khó', 'Very Hard': 'Rất khó', Challenge: 'Thách đấu',
  },
};

// Tên tiếng Anh của món, tra theo slug. Manifest chỉ có tên tiếng Việt; slug vốn đã là
// tiếng Anh viết liền nên bảng này chỉ là dạng đọc được của nó.
const ITEM_EN = {
  tshirt: 'T-shirt', shorts: 'Shorts', socks: 'Socks', sneaker: 'Sneaker', raincoat: 'Raincoat',
  tissue: 'Tissues', sanitizer: 'Hand Sanitizer', handtowel: 'Hand Towel', lipbalm: 'Lip Balm', wetwipes: 'Wet Wipes',
  tablet: 'Tablet', calculator: 'Calculator', earbuds: 'Earbuds Case', charger: 'Charger',
  waterbottle: 'Water Bottle', sandwich: 'Sandwich Box', apple: 'Apple', banana: 'Banana', milk: 'Milk Carton', granola: 'Granola Bar',
  cap: 'Cap', umbrella: 'Umbrella', keyring: 'Keyring', studentcard: 'Student Card',
  notebook: 'Notebook', textbook: 'Textbook', ruler: 'Ruler', pencil: 'Pencil', gluestick: 'Glue Stick', paintbox: 'Paint Box',
  jacket: 'Jacket', pajamas: 'Pajamas', toothbrush: 'Toothbrush', toothpaste: 'Toothpaste', shampoo: 'Shampoo', hairbrush: 'Hairbrush', deodorant: 'Deodorant',
  smartphone: 'Phone', camera: 'Camera', powerbank: 'Power Bank', cable: 'Charging Cable',
  crackers: 'Crackers', juice: 'Juice Box', sunglasses: 'Sunglasses', wallet: 'Wallet', sleepmask: 'Sleep Mask', neckpillow: 'Neck Pillow',
  guidebook: 'Guidebook', map: 'Map', ticket: 'Ticket', cards: 'Playing Cards', travelmug: 'Travel Mug',
  key: 'Key', mystery: 'Mystery Box',
};

// Game luôn mở bằng tiếng Anh: trang chủ không còn nút đổi ngôn ngữ, nên không đọc lựa chọn cũ
// đã lưu (máy nào từng chọn tiếng Việt sẽ kẹt tiếng Việt mà không có nút đổi lại). Tiếng Việt
// vẫn mở được bằng ?lang=vi, Creative Tool và khung xem thử của editor dùng cách này.
function initial() {
  const q = new URLSearchParams(location.search).get('lang');
  return LANGS.includes(q) ? q : 'en';
}
let lang = initial();
const listeners = [];

export const getLang = () => lang;
export function setLang(l, { save = true } = {}) {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l;
  document.documentElement.lang = l;
  applyStatic();
  listeners.forEach(fn => fn(l));
}
export function onLangChange(fn) { listeners.push(fn); }

/** Tra chữ theo khoá, điền {ten} bằng vars. Thiếu khoá thì trả tiếng Anh, thiếu nữa thì trả chính khoá. */
export function t(key, vars) {
  let s = D[lang]?.[key] ?? D.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Tên món theo ngôn ngữ hiện tại */
export function itemName(def) {
  if (!def) return '';
  if (lang === 'vi') return def.name || def.slug;
  return def.nameEn || ITEM_EN[def.slug] || def.name || def.slug;
}
/** Tên level / tên chương / chữ gợi ý túi trống theo ngôn ngữ */
export const levelName = lv => (lang === 'vi' ? lv?.name : (lv?.nameEn || lv?.name)) || '';
export const chapterName = ch => (lang === 'vi' ? (ch?.nameVi || ch?.name) : ch?.name) || '';
// Tiếng Anh không mượn câu tiếng Việt của level (level 1 chỉ có emptyText tiếng Việt): thiếu
// bản tiếng Anh thì dùng câu tiếng Anh mặc định.
export const emptyText = lv => (lang === 'vi' ? lv?.emptyText : lv?.emptyTextEn) || t('emptyBag');
export const tierName = tier => (tier ? t(tier) : '');

/** Đổ chữ tĩnh trong HTML: [data-i18n] → innerHTML, [data-i18n-aria] → aria-label */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
document.documentElement.lang = lang;

/**
 * Câu khen ở bảng thắng, dưới dòng "Packed!". Mỗi lần thắng chọn NGẪU NHIÊN một câu, {pct} là một
 * số phần trăm ngẫu nhiên trong khoảng PCT_KHEN. Thêm câu: thêm một dòng vào đúng ngôn ngữ.
 * Con số chỉ để tạo cảm giác, game không có máy chủ đo người chơi thật.
 */
const CAU_KHEN = {
  en: [
    "Only {pct}% of players beat this level. You're one of them!",
    "Just {pct}% of players packed this one. You did it!",
    "Only {pct}% made it this far. Nice packing!",
  ],
  vi: [
    'Chỉ {pct}% người chơi qua được màn này. Bạn là một trong số đó!',
    'Chỉ {pct}% người chơi xếp gọn được màn này. Bạn làm được rồi!',
    'Chỉ {pct}% đi được tới đây. Xếp khéo lắm!',
  ],
};
const PCT_KHEN = [12, 38];
export function cauKhenNgauNhien() {
  const ds = CAU_KHEN[lang] || CAU_KHEN.en;
  const pct = PCT_KHEN[0] + Math.floor(Math.random() * (PCT_KHEN[1] - PCT_KHEN[0] + 1));
  // con số tô đậm (CSS #winText b): mắt bắt được ngay
  return ds[Math.floor(Math.random() * ds.length)].replace('{pct}%', `<b>${pct}%</b>`).replace('{pct}', `<b>${pct}</b>`);
}
