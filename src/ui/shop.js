// Màn Shop (tài liệu UI mục 3, Figma "EF · Shop" + "EF · Shop catalogue / Full review").
// Trang cuộn dọc: No Ads · Free Gold · Gold Packs · No Ads Bundle · Bundles · Spend Gold ·
// Restore purchases. Trên: vàng + Settings; dưới: thanh Shop / Home.
//
// Mua bằng tiền thật đi qua game/store.js (đang GIẢ LẬP), xem quảng cáo qua game/ads.js (GIẢ LẬP).
// Quy tắc: trong lúc xử lý một giao dịch thì khoá mọi nút mua; chỉ cộng thưởng khi giao dịch được
// xác nhận; hủy / lỗi thì không cộng gì. Giá là giá thiết kế, bản thật lấy theo cửa hàng.
import { getGold, addGold, onGoldChange } from '../game/wallet.js';
import { themBooster } from '../game/boosters.js';
import { muaGoi, khoiPhuc, coNoAds, batNoAds } from '../game/store.js';
import { coQuangCao, xemQuangCao } from '../game/ads.js';
import { sfx } from './sfx.js';
import { efToast } from './eftoast.js';
import { openSettings } from './settings.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');
const icon = (ten, cls = '') => `<img class="${cls}" src="./ui/icons/${ten}.webp" alt="" draggable="false">`;
const COIN = '<img src="./ui/menu/coin.webp" alt="" draggable="false">';

const NO_ADS_GIA = '₫249,000';
const FREE_GOLD = 100;   // tài liệu: hiển thị số vàng sẽ nhận
const GOI_VANG = [
  { id: 'gold_1k', vang: 1000, gia: '₫59,000' },
  { id: 'gold_5k', vang: 5000, gia: '₫249,000' },
  { id: 'gold_10k', vang: 10000, gia: '₫499,000' },
  { id: 'gold_25k', vang: 25000, gia: '₫999,000' },
  { id: 'gold_50k', vang: 50000, gia: '₫1,799,000' },
  { id: 'gold_100k', vang: 100000, gia: '₫2,999,000' },
];
const NO_ADS_BUNDLE = { id: 'noads_bundle', ten: 'No Ads Bundle', vang: 1000, so: 1, gia: '₫399,000', tone: 'blue' };
const BUNDLES = [
  { id: 'bundle_small', ten: 'Small Bundle', vang: 5000, so: 1, gia: '₫299,000', tone: 'green' },
  { id: 'bundle_medium', ten: 'Medium Bundle', vang: 10000, so: 2, gia: '₫599,000', tone: 'blue' },
  { id: 'bundle_ultra', ten: 'Ultra Bundle', vang: 25000, so: 5, gia: '₫1,299,000', tone: 'dark' },
];
const TIEU_VANG = [
  { loai: 'freeze', ten: 'Freeze ×3', gia: 150 },
  { loai: 'resize', ten: 'Resize ×3', gia: 200 },
  { loai: 'throw', ten: 'Throw out ×3', gia: 150 },
];
const ICON_BOOSTER = { freeze: 'freeze', resize: 'resize', throw: 'throw' };

let onHome = () => {}, dangMua = false;

export const shopOpen = () => $('efshop').classList.contains('show');
export function showShop({ toiVang = false } = {}) {
  ve();
  $('efshop').classList.add('show');
  if (toiVang) requestAnimationFrame(() => cuonToiVang());
}
export function hideShop() { $('efshop').classList.remove('show'); }

function cuonToiVang() {
  const dich = $('shopList').querySelector('[data-sec="gold"]'), khung = $('shopScroll');
  if (dich) khung.scrollTo({ top: dich.offsetTop - 8, behavior: 'smooth' });
}

// ---------- vẽ danh mục ----------
const tieuDe = (ten, sec = '') => `<div class="efs-sec" data-sec="${sec}">${ten}</div>`;
const boosterNho = so => ['freeze', 'resize', 'throw'].map(k => `<span class="efs-bst">${icon(ICON_BOOSTER[k])}<small>×${so}</small></span>`).join('');

function theBundle(b, laNoAds = false) {
  return `<div class="efs-card efs-bundle tone-${b.tone}">
    <h3>${b.ten}</h3>
    <div class="efs-bundle-body">
      <div class="efs-bundle-left">${laNoAds ? icon('noads', 'efs-noads-sm') : icon('coins', 'efs-coins-sm')}<b>${laNoAds ? '+' + fmt(b.vang) + ' gold' : fmt(b.vang)}</b></div>
      <div class="efs-bsts">${boosterNho(b.so)}</div>
    </div>
    <button class="efs-buy" data-mua="${b.id}">${b.gia}</button>
  </div>`;
}

function ve() {
  $('sGold').textContent = fmt(getGold());
  const daNoAds = coNoAds();
  $('shopList').innerHTML = `
    <div class="efs-card efs-noads">
      ${icon('noads', 'efs-noads-ic')}
      <div class="efs-noads-txt"><h3>NO ADS</h3><p>Remove forced ads forever</p></div>
      <span class="efs-tag">POPULAR</span>
      <button class="efs-buy" data-mua="no_ads" ${daNoAds ? 'disabled' : ''}>${daNoAds ? 'Purchased' : NO_ADS_GIA}</button>
    </div>
    ${tieuDe('PARTNER OFFERS')}
    <div class="efs-card efs-free">
      ${icon('gift', 'efs-gift')}
      <div class="efs-noads-txt"><h3>FREE GOLD</h3><p>Watch an ad to collect <b>${FREE_GOLD}</b> free coins</p></div>
      <button class="efs-buy" data-ad="free_gold">${icon('ads', 'efs-ad')}Collect</button>
    </div>
    ${tieuDe('GOLD PACKS', 'gold')}
    <div class="efs-grid">${GOI_VANG.map(g => `<div class="efs-card efs-gold">
      ${icon('coins', 'efs-coins')}<b>${fmt(g.vang)}</b><button class="efs-buy" data-mua="${g.id}">${g.gia}</button></div>`).join('')}</div>
    ${tieuDe('NO ADS BUNDLES')}
    ${theBundle(NO_ADS_BUNDLE, true)}
    ${tieuDe('BUNDLES')}
    ${BUNDLES.map(b => theBundle(b)).join('')}
    ${tieuDe('SPEND GOLD')}
    <div class="efs-grid">${TIEU_VANG.map(g => `<div class="efs-card efs-gold efs-spend">
      ${icon(ICON_BOOSTER[g.loai], 'efs-coins')}<b>${g.ten}</b><button class="efs-buy" data-vang="${g.loai}">${COIN}${g.gia}</button></div>`).join('')}</div>
    <button class="efs-restore" id="shopRestore">Restore purchases</button>`;
}

// ---------- quyền lợi từng gói ----------
function traThuong(id) {
  if (id === 'no_ads') { batNoAds(); efToast('No Ads activated'); return; }
  const g = GOI_VANG.find(x => x.id === id);
  if (g) { addGold(g.vang); efToast(`+${fmt(g.vang)} gold`); return; }
  const b = [NO_ADS_BUNDLE, ...BUNDLES].find(x => x.id === id);
  if (!b) return;
  if (b === NO_ADS_BUNDLE) batNoAds();
  addGold(b.vang);
  for (const k of ['freeze', 'resize', 'throw']) themBooster(k, b.so);
  efToast(`${b.ten} added!`);
}

async function muaTienThat(nut) {
  if (dangMua) return;
  dangMua = true;
  const nhan = nut.innerHTML;
  $('shopList').classList.add('busy');
  nut.classList.add('wait'); nut.textContent = '…';
  let ok = false;
  try { ok = await muaGoi(nut.dataset.mua); } catch { ok = false; }
  dangMua = false;
  $('shopList').classList.remove('busy');
  if (ok) { sfx('unlockLv', { gain: .7 }); traThuong(nut.dataset.mua); ve(); }
  else { nut.classList.remove('wait'); nut.innerHTML = nhan; efToast('Purchase cancelled'); }
}

async function nhanVangFree(nut) {
  if (dangMua) return;
  if (!coQuangCao()) { efToast('Ad unavailable. Try again later.'); return; }
  dangMua = true;
  const du = await xemQuangCao();
  dangMua = false;
  if (du) { addGold(FREE_GOLD); sfx('unlockLv', { gain: .6 }); efToast(`+${FREE_GOLD} gold`); }
  else efToast('Watch the full ad to collect');
  void nut;
}

function muaBangVang(loai) {
  const g = TIEU_VANG.find(x => x.loai === loai); if (!g) return;
  if (getGold() < g.gia) { sfx('nope'); efToast('Not enough gold'); return; }
  addGold(-g.gia);
  themBooster(loai, 3);
  sfx('unlockLv', { gain: .6 });
  efToast(`${g.ten} added!`);
}

async function khoiPhucMua() {
  if (dangMua) return;
  dangMua = true;
  const kq = await khoiPhuc().catch(() => null);
  dangMua = false;
  if (kq?.noAds) { batNoAds(); ve(); efToast('Purchases restored'); }
  else efToast('No purchases to restore');
}

export function initShop({ onHome: cb }) {
  onHome = cb;
  onGoldChange(n => { $('sGold').textContent = fmt(n); });
  $('shopList').addEventListener('click', e => {
    const nut = e.target.closest('button'); if (!nut || nut.disabled) return;
    if (nut.id === 'shopRestore') { sfx('tap'); khoiPhucMua(); return; }
    if (dangMua) return;
    sfx('tap');
    if (nut.dataset.mua) muaTienThat(nut);
    else if (nut.dataset.ad) nhanVangFree(nut);
    else if (nut.dataset.vang) muaBangVang(nut.dataset.vang);
  });
  $('sAddGold').addEventListener('click', () => { sfx('tap'); cuonToiVang(); });
  $('sSettings').addEventListener('click', () => { sfx('tap'); openSettings(); });
  $('sTabShop').addEventListener('click', () => { sfx('tap'); $('shopScroll').scrollTo({ top: 0, behavior: 'smooth' }); });
  $('sTabHome').addEventListener('click', () => { sfx('tap'); hideShop(); onHome(); });
}
