// HUD: tên level, pause, đồng hồ đếm ngược, số món còn lại, toast, các overlay thắng / thua / tạm dừng.
import { S } from '../game/state.js';
import { sfx, duckMusic } from './sfx.js';
import { shake } from '../game/fx.js';
import { t, cauKhenNgauNhien } from '../i18n.js';
import { soThuTuLevel } from '../content/loader.js';

const $ = id => document.getElementById(id);
const hint = $('hint'), countEl = $('count'), clockEl = $('clock');

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
let shownLeft = -1;
export function renderList() {
  const left = Math.max(0, S.ITEMS.length - S.checked.size);
  if (left === shownLeft) return;
  shownLeft = left;
  countEl.textContent = left;
  // con số nảy một nhịp mỗi lần đổi, để mắt bắt được là vừa xếp thêm được một món
  countEl.classList.remove('bump'); void countEl.offsetWidth; countEl.classList.add('bump');
  countEl.parentElement.classList.toggle('clear', left === 0);
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
const SO_SAO = 3;   // bảng thắng mới: ba ngôi sao; điểm tính theo thang 5 sao nên quy đổi
function renderStars(sao) {
  const el = $('winStars'); if (!el) return;
  el.innerHTML = '';
  const tren3 = sao * SO_SAO / 5;
  for (let i = 0; i < SO_SAO; i++) {
    const day = Math.max(0, Math.min(1, tren3 - i));
    const o = document.createElement('span');
    o.className = 'star';
    o.style.animationDelay = (.1 + i * .11) + 's';
    o.innerHTML = HINH_SAO + `<span class="fill" style="width:${day * 100}%">${HINH_SAO}</span>`;
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
// Hai ô ở bảng thắng: thời gian hoàn thành và coin nhận được (thưởng của level). Bỏ điểm và
// số booster đã dùng theo bố cục mới.
const ICON_GIO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="#F2C14E"/><circle cx="12" cy="13" r="5.6" fill="#FFF8E7"/><path d="M12 13V9.6M12 13l2.6 1.4" stroke="#5A3A22" stroke-width="1.8" stroke-linecap="round"/><rect x="9.5" y="2.6" width="5" height="2.6" rx="1.3" fill="#F2C14E"/></svg>';
const ICON_COIN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#F2B530"/><circle cx="12" cy="12" r="6.6" fill="#FFD25E"/><path d="M12 8.4v7.2M9.8 10.2h3.6a1.4 1.4 0 0 1 0 2.8h-2.8a1.4 1.4 0 0 0 0 2.8h3.6" stroke="#C47F10" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';
function renderScore(d) {
  const el = $('winScore'); if (!el || !d) return;
  const coin = S.LEVEL?.reward?.coin ?? 20;
  // chỉ icon + số, không ghi nhãn "Completed" / "Coins earned" bên dưới
  const o = (icon, so) => `<div class="chip"><b>${icon}${so}</b></div>`;
  el.innerHTML = o(ICON_GIO, giay(d.dungGiay)) + o(ICON_COIN, `+${coin}`);
  // Xếp đúng kiểu: khen một dòng, hoặc chỉ ra tối đa hai lỗi (laptop đè áo, đè đồ dễ vỡ)
  const kieu = document.createElement('div'); kieu.className = 'win-kieu ' + (d.loi?.length ? 'bad' : 'ok');
  kieu.innerHTML = d.loi?.length ? d.loi.slice(0, 2).map(x => `<div>⚠ ${esc(x)}</div>`).join('') : `<div>✓ ${esc(t('packedRight'))}</div>`;
  el.appendChild(kieu);
  renderStars(d.sao);
}

export function showWin(diem) {
  $('winLevel').textContent = t('winLevel', { n: soThuTuLevel(S.mapId, S.levelIdx) });
  $('winRank').textContent = `✨ ${t('winPacked')} ✨`;
  $('winText').innerHTML = cauKhenNgauNhien();   // câu cố định trong i18n.js, không có dữ liệu người dùng
  renderScore(diem);
  show('win');
  sfx('star', { delay: .1 });   // Star_get: đúng lúc bảng hiện và ngôi sao đầu bật ra
}
export function hideWin() { hide('win'); }
/** Thua. Mặc định là hết giờ (còn n món, có nút +60 giây); đồ vỡ thì ghi lý do và không cho thêm giờ. */
export function showLose({ lyDo, choThemGio = true } = {}) {
  const left = S.ITEMS.length - S.checked.size;
  $('loseText').textContent = lyDo || t('leftInTray', { n: left });
  const tieuDe = document.querySelector('#lose h2'); if (tieuDe) tieuDe.textContent = lyDo ? t('brokenTitle') : t('soClose');
  const them = $('extraTime'); if (them) them.hidden = !choThemGio;
  sfx('lose'); shake(420); duckMusic(true);
  show('lose');
}
export function hideLose() { hide('lose'); }
export function hidePause() { hide('pause'); S.paused = false; }

const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  onTap('extraTime', onExtraTime, 'tapBig');
  onTap('pauseBtn', () => { if (S.won || S.lost) return; S.paused = true; duckMusic(true); show('pause'); });
  onTap('resumeBtn', () => { hidePause(); duckMusic(false); });
  for (const id of ['homeBtn', 'winHome', 'loseHome']) {
    onTap(id, () => { hidePause(); hideWin(); hideLose(); duckMusic(false); onHome && onHome(); });
  }
}

// Không còn dùng, giữ để tương thích lời gọi cũ
export function setRotateEnabled() {}
export function bindLevelNav() {}
