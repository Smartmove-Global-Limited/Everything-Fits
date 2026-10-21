// Main Menu theo Figma "EF · Main Menu" và tài liệu UI (mục 2. Main Menu).
//  - Trên trái: số vàng, dấu + mở Shop.     - Trên phải: bánh răng mở Settings.
//  - Giữa: mèo với vali, nút Play — Level N; màu nút theo độ khó của level sắp chơi.
//  - Đáy: thanh Shop / Home (bỏ Leaderboard), tab đang mở tô nổi.
// Dấu + và tab Shop mở Shop (dấu + cuộn thẳng tới Gold Packs), bánh răng mở popup Settings.
import * as P from '../game/progress.js';
import { getGold, onGoldChange } from '../game/wallet.js';
import { soThuTuLevel } from '../content/loader.js';
import { sfx, initAudio } from './sfx.js';
import { showShop } from './shop.js';
import { openSettings } from './settings.js';

const $ = id => document.getElementById(id);

let CHAPTERS = [], onPlay = () => {};

/**
 * Độ khó của nút Play. Editor chấm level theo 5 bậc (gen/difficulty.js), nút chỉ có 3 kiểu:
 * Easy + Medium → Easy · Hard → Hard · Very Hard + Challenge → Super Hard.
 * Level chưa chấm điểm (chưa mở lại trong editor) coi là Easy.
 */
const KIEU = { Easy: 'easy', Medium: 'easy', Hard: 'hard', 'Very Hard': 'super', Challenge: 'super' };
export const playKind = level => KIEU[level?.difficulty?.tier] || 'easy';

const fmt = n => n.toLocaleString('en-US');

export const atMenu = () => $('efmenu')?.classList.contains('show');

export function showMenu() {
  draw();
  $('efmenu').classList.add('show');
}
export function hideMenu() { $('efmenu').classList.remove('show'); }

function draw() {
  $('mGold').textContent = fmt(getGold());
  const spot = P.getSpot(CHAPTERS);
  const btn = $('mPlay');
  if (!spot) { btn.disabled = true; return; }
  const { chapter: ch, index } = spot;
  btn.disabled = false;
  btn.dataset.kind = playKind(ch.levels[index]);
  $('mPlayLv').textContent = `Level ${soThuTuLevel(ch.id, index)}`;
}

/** Rời menu sang Shop; Home ở thanh đáy Shop gọi showMenu để quay lại */
function moShop(toiVang = false) { hideMenu(); showShop({ toiVang }); }

export function initMenu({ chapters, onPlay: cb }) {
  CHAPTERS = chapters; onPlay = cb;
  onGoldChange(n => { $('mGold').textContent = fmt(n); });

  $('mPlay').addEventListener('click', () => {
    const spot = P.getSpot(CHAPTERS); if (!spot) return;
    sfx('tapBig'); initAudio();
    onPlay(spot.chapter, spot.index);
  });
  $('mAddGold').addEventListener('click', () => { sfx('tap'); moShop(true); });
  $('mSettings').addEventListener('click', () => { sfx('tap'); openSettings(); });
  $('mTabShop').addEventListener('click', () => { sfx('tap'); moShop(); });
  $('mTabHome').addEventListener('click', () => { sfx('tap'); draw(); });
}
