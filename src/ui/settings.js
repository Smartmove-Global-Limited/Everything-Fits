// Popup Settings (tài liệu UI mục 4, Figma "EF · Settings / Popup overlay").
//  - BGM / SFX / Vibration: đổi là có hiệu lực ngay, tự lưu (sfx.js giữ lựa chọn trong máy).
//    Người chơi mới mặc định cả ba ON.
//  - Đóng bằng X hoặc bấm vùng tối ngoài popup; đóng xong về đúng màn trước (popup chỉ phủ lên,
//    nên Shop giữ nguyên chỗ đang cuộn).
//  - Mở giữa ván: dừng đồng hồ và thao tác (S.paused), đóng thì chơi tiếp đúng trạng thái cũ.
//    Riêng lúc này có thêm nút Home ở cuối popup: bỏ ván đang chơi, về Main Menu.
import { S } from '../game/state.js';
import { sfx, duckMusic, isMusicOn, isSfxOn, isVibOn, setMusicOn, setSfxOn, setVibOn } from './sfx.js';

const $ = id => document.getElementById(id);
let tamDungVan = false;   // popup này đã dừng ván đang chơi, đóng thì phải trả lại
let veHome = () => {};

const dangTrongVan = () => !!S.LEVEL && !S.won && !S.lost && !document.querySelector('.screen.show');

function veNut(id, bat) {
  const el = $(id);
  el.classList.toggle('off', !bat);
  el.setAttribute('aria-checked', String(bat));
  el.querySelector('span').textContent = bat ? 'ON' : 'OFF';
}
function veTatCa() {
  veNut('togBgm', isMusicOn());
  veNut('togSfx', isSfxOn());
  veNut('togVib', isVibOn());
}

export const settingsOpen = () => $('settings').classList.contains('show');

export function openSettings() {
  veTatCa();
  const trongVan = dangTrongVan();
  $('setHome').hidden = !trongVan;
  if (trongVan && !S.paused) { S.paused = true; tamDungVan = true; duckMusic(true); }
  $('settings').classList.add('show');
}

export function closeSettings() {
  $('settings').classList.remove('show');
  if (tamDungVan) { tamDungVan = false; S.paused = false; duckMusic(false); }
}

export function initSettings({ onHome } = {}) {
  if (onHome) veHome = onHome;
  $('togBgm').addEventListener('click', () => { setMusicOn(!isMusicOn()); sfx('tap'); veTatCa(); });
  $('togSfx').addEventListener('click', () => { setSfxOn(!isSfxOn()); veTatCa(); });
  $('togVib').addEventListener('click', () => {
    setVibOn(!isVibOn()); sfx('tap'); veTatCa();
    if (isVibOn()) try { navigator.vibrate?.(30); } catch {}
  });
  $('setX').addEventListener('click', () => { sfx('tap'); closeSettings(); });
  // Home: đóng popup rồi về Main Menu; ván dừng hẳn (goHome trong main.js giữ S.paused), không tính thua
  $('setHome').addEventListener('click', () => { sfx('tap'); tamDungVan = false; $('settings').classList.remove('show'); veHome(); });
  // vùng tối ngoài popup cũng đóng (chỉ khi bấm trúng chính lớp tối, không phải thẻ bên trong)
  $('settings').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
}
