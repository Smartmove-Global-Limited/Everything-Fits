// HUD: tên level, pause, đồng hồ đếm ngược, số món còn lại, toast, các overlay thắng / thua / tạm dừng.
import { S } from '../game/state.js';
import { sfx, duckMusic } from './sfx.js';
import { shake } from '../game/fx.js';
import { t } from '../i18n.js';
import { soThuTuLevel } from '../content/loader.js';
import { getGold, addGold, onGoldChange } from '../game/wallet.js';
import { coQuangCao, xemQuangCao } from '../game/ads.js';
import { onShakeEnergy, datNangLuong } from '../game/shake.js';
import { openSettings, closeSettings } from './settings.js';
import { efToast } from './eftoast.js';

const $ = id => document.getElementById(id);
const hint = $('hint'), countEl = $('count'), clockEl = $('clock');
const fmtSo = n => n.toLocaleString('en-US');

// ---------- toast ----------
let toastTimer = null;
export function toast(text, ms = 1400) {
  hint.textContent = text; hint.classList.remove('hide');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => hint.classList.add('hide'), ms);
}
export function showHint(text) { clearTimeout(toastTimer); hint.textContent = text; hint.classList.remove('hide'); }
export function hideHint() { hint.classList.add('hide'); }
// ---------- header ----------
// Chỉ thay class bảng màu theo bối cảnh của chính hàm này. Gán thẳng className thì mọi
// class khác trên khung game bị xoá theo, trong đó có các class ẩn HUD của Creative Tool:
// tick ẩn xong, vào màn khác là HUD hiện lại dù ô vẫn đang tick.
let clsBoiCanh = [];
export function renderHeader({ eyebrow, title, cls }) {
  const phone = $('phone');
  phone.classList.remove(...clsBoiCanh);
  clsBoiCanh = String(cls || '').split(/\s+/).filter(Boolean);
  phone.classList.add(...clsBoiCanh);
  $('eyebrow').textContent = eyebrow;
  $('title').textContent = title;
}

// ---------- tiến độ ----------
// Thanh tiến trình dưới đồng hồ: phần trăm món đã nằm gọn trong túi (cùng con số rules.js dùng
// để xét thắng). Thanh và số cập nhật cùng nhau; thắng là 100%. Không hiện số món còn lại.
let shownPct = -1;
export function renderList() {
  const tong = S.ITEMS.length || 1;
  const pct = Math.max(0, Math.min(100, Math.round(S.checked.size / tong * 100)));
  countEl.textContent = Math.max(0, S.ITEMS.length - S.checked.size);   // giữ cho máy tự chơi / Creative đọc
  if (pct === shownPct) return;
  shownPct = pct;
  $('progFill').style.width = pct + '%';
  $('progPct').textContent = pct + '%';
}
/** Giữ tên cũ cho các module khác gọi khi mở hộp bí ẩn (không còn thumbnail để vẽ lại) */
export function repaintSlot() {}
export function rebuildStrip() { renderList(); }

// ---------- đồng hồ đếm ngược ----------
// mm:ss, phút cũng hai chữ số (00:30) như mẫu HUD cozy; casual dùng chung, không sao
const fmt = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
export function updateClock() {
  const sec = Math.ceil(S.timeLeft / 1000);
  if (sec !== S.shownSec) {
    const urgent = sec <= 10 && sec > 0 && !S.won && !S.lost;
    // mười giây cuối kêu tích tắc, càng gần hết càng cao
    if (urgent && S.shownSec >= 0 && S.timerOn) sfx('tick', { rate: 1 + (10 - sec) * .05, gain: .55 });
    S.shownSec = sec;
    clockEl.textContent = fmt(Math.max(0, sec));
    clockEl.classList.toggle('urgent', urgent);
  }
}

// ---------- overlay ----------
const show = id => $(id).classList.add('show');
const hide = id => $(id).classList.remove('show');
const giay = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

const HINH_SAO = '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z"/></svg>';

/**
 * Năm ngôi sao, sáng theo điểm tới từng nửa sao.
 * Mỗi ngôi là một sao xám, đè lên trên là đúng ngôi đó màu vàng nhưng bị cắt bớt bề
 * ngang — cắt 50% thì ra nửa sao. Làm bằng cách này nên nửa sao trông đúng là một ngôi
 * sao bị lấp một nửa, chứ không phải một hình sao méo.
 */
const SO_SAO = 3;   // bảng thắng: ba ngôi sao, không có nửa sao; điểm tính theo thang 5 nên quy đổi
function renderStars(sao) {
  const el = $('winStars'); if (!el) return;
  const sang = Math.max(1, Math.min(SO_SAO, Math.round((sao || 0) * SO_SAO / 5)));
  el.innerHTML = '';
  for (let i = 0; i < SO_SAO; i++) {
    const o = document.createElement('img');
    o.className = 'star'; o.alt = ''; o.draggable = false;
    o.src = `./ui/icons/${i < sang ? 'star' : 'star-off'}.webp`;
    o.style.animationDelay = (.1 + i * .12) + 's';
    el.appendChild(o);
  }
}

/**
 * Thứ hạng so với "người chơi khác".
 *
 * ĐỌC KỸ TRƯỚC KHI SỬA: con số này KHÔNG phải số liệu thật. Game chạy trọn trên máy,
 * không có máy chủ nào thu điểm của ai, nên không có phân bố điểm nào để so. Đây là một
 * con số dựng ra từ chính ván vừa chơi, đặt theo yêu cầu thiết kế, để người chơi thấy
 * ván của mình có giá. Đừng đem nó đi làm thống kê, báo cáo hay quảng cáo.
 *
 * Dựng từ hai thứ người chơi vừa làm: điểm (nặng hơn) và thời gian còn dư. Hàm luỹ thừa
 * .8 làm khúc trên thoải ra, nên muốn chạm 99% phải gần như hoàn hảo chứ không phải thắng
 * là được. Không có ngẫu nhiên: cùng một ván thì luôn ra cùng một số, chơi lại y hệt mà
 * số nhảy lung tung thì lộ ngay là bịa.
 *
 * Muốn thành số thật: gửi { màn, điểm, thời gian } lên máy chủ, đọc về phân vị thật của
 * màn đó, rồi thay nguyên hàm này.
 */
const PCT_MIN = 60, PCT_MAX = 99;
const BAO_HOA = .85;   // mức pha điểm+thời gian coi như đã kịch trần
function thuHang(d) {
  const kep = (v, a, b) => Math.max(a, Math.min(b, v));
  const diem = kep((d.diem || 0) / 100, 0, 1);
  const nhanh = d.tongGiay > 0 ? kep(1 - d.dungGiay / d.tongGiay, 0, 1) : .5;
  // Chia cho BAO_HOA: trọn 100 điểm mà vẫn dùng hết giờ thì phần pha mới chỉ tới .8,
  // không chia thì 99% thành con số không ai với tới và cả thang dồn hết vào khúc 90.
  const t = kep((diem * .8 + nhanh * .2) / BAO_HOA, 0, 1);
  // Nhích nhẹ theo từng màn cho dãy số đỡ lặp đúng một mẫu. Nhân (1 - t) để ván gần
  // hoàn hảo không bị cái nhích này kéo tụt khỏi mốc 99.
  const nhich = ((S.LEVEL?.id || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 97, 7) % 5) - 2;
  const pct = PCT_MIN + Math.pow(t, 1.2) * (PCT_MAX - PCT_MIN) + nhich * (1 - t);
  return kep(Math.round(pct), PCT_MIN, PCT_MAX);
}

/**
 * Danh hiệu của ván vừa thắng.
 *
 * Khác với con số phần trăm ở trên, danh hiệu dựa trên số liệu THẬT: d.tiLeGon là mức
 * khít của người chơi so với cách xếp tốt nhất máy tìm được cho chính màn này (score.js
 * đo sẵn). Mỗi màn có một trần khít riêng — bộ đồ càng tròn thì trần càng thấp — nên
 * danh hiệu phản ánh đúng cái khó của màn vừa chơi.
 */
// eslint-disable-next-line no-unused-vars -- danh hiệu cũ, bảng thắng mới chỉ ghi "Packed!"
function danhGia(d) {
  const p = Math.round((d.tiLeGon || 0) * 100);
  const hang = t(p >= 99 ? 'rank99' : p >= 93 ? 'rank93' : p >= 84 ? 'rank84' : p >= 72 ? 'rank72' : 'rank0');
  return { hang, khoe: t('brag', { pct: thuHang(d) }) };
}

/**
 * Bảng thắng. Trước đây là bốn thanh tiến độ, một dòng tổng điểm và một dòng mô tả —
 * sáu con số cho cùng một câu hỏi duy nhất "mình xếp có khéo không". Người chơi vừa ăn
 * mừng xong thì không ngồi đọc bảng thống kê. Giữ một câu nói rõ vừa làm được gì, ba
 * con số phụ thu thành ba ô nhỏ bên dưới.
 */
// Ô kết quả ở bảng thắng: thời gian ĐÃ CHƠI để xong level và vàng thưởng của level.
// Dưới ô: "Packed the right way", hoặc lỗi xếp đầu tiên nếu có (laptop đè áo, đè đồ dễ vỡ).
const anh = ten => `<img src="./ui/icons/${ten}.webp" alt="" draggable="false">`;
let thuongVan = 0, daX2 = false;
function renderScore(d) {
  const el = $('winScore'); if (!el || !d) return;
  thuongVan = S.LEVEL?.reward?.coin ?? 20;
  el.innerHTML = `<span>${anh('timer')}<b>${giay(d.dungGiay)}</b></span><span><img src="./ui/menu/coin.webp" alt="" draggable="false"><b id="winCoin">+${thuongVan}</b></span>`;
  const kieu = $('winKieu');
  kieu.textContent = d.loi?.length ? d.loi[0] : 'Packed the right way';
  kieu.classList.toggle('bad', !!d.loi?.length);
  renderStars(d.sao);
}

export function showWin(diem) {
  $('winLevel').textContent = `LEVEL ${soThuTuLevel(S.mapId, S.levelIdx)} COMPLETE!`;
  $('winRank').textContent = 'Packed!';
  // Tài liệu: tỷ lệ phải lấy từ dữ liệu thật; chưa có dữ liệu nên tạm để cố định 18%.
  $('winPct').textContent = 'Only 18% made it this far.';
  $('winText').textContent = 'Nice packing!';
  renderList();      // thắng thì thanh tiến trình luôn đứng ở 100%
  renderScore(diem);
  daX2 = false;
  const x2 = $('winX2'); x2.disabled = false; x2.classList.remove('done'); x2.querySelector('span').textContent = 'Collect ×2';
  show('win');
  sfx('star', { delay: .1 });   // Star_get: đúng lúc bảng hiện và ngôi sao đầu bật ra
}

/** Collect ×2: xem đủ quảng cáo thì cộng thêm đúng một lần thưởng cơ bản, nút thành Collected */
async function nhanX2() {
  const x2 = $('winX2');
  if (daX2 || x2.disabled) return;
  if (!coQuangCao()) { efToast('Ad unavailable. Try again later.'); return; }
  x2.disabled = true;
  const du = await xemQuangCao();
  if (!du || !S.won) { x2.disabled = false; return; }   // đóng sớm / lỗi: giữ thưởng cơ bản, cho thử lại
  daX2 = true;
  addGold(thuongVan);
  x2.classList.add('done'); x2.querySelector('span').textContent = 'Collected';
  const c = $('winCoin'); if (c) c.textContent = `+${thuongVan * 2}`;
  sfx('unlockLv', { gain: .7 });
}
export function hideWin() { hide('win'); }
/** Thua. Mặc định là hết giờ (còn n món, có nút +60 giây); đồ vỡ thì ghi lý do và không cho thêm giờ. */
export function showLose({ lyDo, choThemGio = true } = {}) {
  const left = S.ITEMS.length - S.checked.size;
  $('loseText').textContent = lyDo || `${left} ${left === 1 ? 'item' : 'items'} still out of the bag.`;
  const tieuDe = document.querySelector('#lose h2'); if (tieuDe) tieuDe.textContent = lyDo ? t('brokenTitle') : 'So close!';
  $('loseSub').hidden = !choThemGio;
  const them = $('extraTime'); if (them) { them.hidden = !choThemGio; them.disabled = false; }
  sfx('lose'); shake(420); duckMusic(true);
  show('lose');
}
export function hideLose() { hide('lose'); }
export function hidePause() { hide('pause'); S.paused = false; }


/** Gắn hành động kèm tiếng bấm — mọi nút trong game đều đi qua đây */
function onTap(id, fn, sound = 'tap') {
  const el = $(id); if (!el) return;
  el.addEventListener('click', e => { sfx(sound); fn(e); });
}

export function bindOverlayButtons({ onAgain, onNext, onExtraTime, onPrev, onHome }) {
  onTap('again', onAgain, 'tapBig');
  onTap('retry', onAgain, 'tapBig');
  onTap('restartBtn', () => { hidePause(); onAgain(); }, 'tapBig');
  onTap('next', onNext, 'tapBig');
  onTap('nextLv', () => { hidePause(); onNext(); });
  onTap('prevLv', () => { hidePause(); onPrev(); });
  onTap('winX2', nhanX2, 'tapBig');
  // +60 sec: xem đủ quảng cáo mới cộng giờ; trong lúc xem khoá nút, đóng sớm / lỗi thì giữ bảng thua
  onTap('extraTime', async () => {
    const nut = $('extraTime');
    if (nut.disabled || !S.lost) return;
    if (!coQuangCao()) { efToast('Ad unavailable. Try again later.'); return; }
    nut.disabled = true;
    const du = await xemQuangCao();
    nut.disabled = false;
    if (du && S.lost) onExtraTime();
  }, 'tapBig');
  // Bánh răng trong ván mở Settings (popup tự dừng đồng hồ và thao tác)
  onTap('pauseBtn', () => { if (S.won || S.lost) return; openSettings(); });
  onTap('resumeBtn', () => { hidePause(); duckMusic(false); });
  for (const id of ['homeBtn', 'winHome', 'loseHome']) {
    onTap(id, () => { hidePause(); hideWin(); hideLose(); closeSettings(); duckMusic(false); onHome && onHome(); });
  }

  // Vàng trên HUD
  $('hudGold').textContent = fmtSo(getGold());
  onGoldChange(n => { $('hudGold').textContent = fmtSo(n); });

  // ---------- năng lượng lắc ----------
  onShakeEnergy({
    doi: v => {
      $('shakeFill').style.width = Math.round(v * 100) + '%';
      $('shakeHud').classList.toggle('empty', v <= 0);
      $('shakeHud').classList.toggle('low', v > 0 && v < .25);
    },
    can: () => moPopupLac(),
  });
  onTap('shakeAd', async () => {
    if (!coQuangCao()) { efToast('Ad unavailable. Try again later.'); return; }
    const nut = $('shakeAd'); nut.disabled = true;
    const du = await xemQuangCao();
    nut.disabled = false;
    if (du) { datNangLuong(1); dongPopupLac(); }   // đầy lại, mở lại tính năng lắc
  }, 'tapBig');
  onTap('shakeNo', dongPopupLac);
  onTap('shakeX', dongPopupLac);
}

// Popup "Shake energy empty": mở khi thanh đã cạn mà người chơi còn lắc. Mở thì dừng đồng hồ
// và thao tác; đóng (Not now / X) thì chơi tiếp, lắc vẫn khoá. Vừa đóng thì nghỉ một nhịp mới
// cho mở lại, không thì tay đang lắc dở lại bật popup ngay lập tức.
let lacNghiToi = 0, lacDungVan = false;
function moPopupLac() {
  if ($('shakePop').classList.contains('show') || performance.now() < lacNghiToi) return;
  if (S.won || S.lost || S.paused) return;
  S.paused = true; lacDungVan = true;
  show('shakePop');
}
function dongPopupLac() {
  hide('shakePop');
  lacNghiToi = performance.now() + 2500;
  if (lacDungVan) { lacDungVan = false; S.paused = false; }
}
export function hideShakePopup() { if ($('shakePop').classList.contains('show')) dongPopupLac(); }

// Không còn dùng, giữ để tương thích lời gọi cũ
export function setRotateEnabled() {}
export function bindLevelNav() {}
