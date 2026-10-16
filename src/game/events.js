// Event phân tích gửi lên Firebase Analytics và AppsFlyer (chỉ app Android). Kế hoạch đã chốt với team:
//
//   level_start   level · mode · play_type · lose_index
//   level_end     level · lose_index · booster_use · result
//
//   level        số Level N liền qua các chương (soThuTuLevel)
//   mode         đúng tên độ khó trong editor: Easy | Medium | Hard | Very Hard | Challenge;
//                level chưa đo độ khó → Medium
//   play_type    first_open  lần đầu mở game sau khi cài, tự vào level
//                app_open    mở lại app, lần trước đã kết thúc level
//                reopen      mở lại app, lần trước tắt app khi level đang dở
//                next        bấm Next level sau khi thắng
//                restart     bấm Try again (bảng thua) hoặc Restart (bảng tạm dừng)
//                home        vào level từ trang chủ (hiện game bỏ qua trang chủ)
//   lose_index   level_start: số lần đã thua level này TRƯỚC lượt này (từ 0)
//                level_end:   số lần đã thua, TÍNH CẢ lượt vừa xong nếu thua
//                mỗi level (và mỗi bộ art) một bộ đếm, lưu trong máy, bỏ dở không tính là thua
//   booster_use  "Booster_freeze_2,Booster_resize_1,Booster_PlayOn_Ads_1"; không dùng booster nào → 0
//                PlayOn_Ads = số lần bấm "+60 sec" chơi tiếp khi hết giờ (sau này là xem rewarded ads)
//   result       win  ngay khi thắng · lose  ngay khi hết giờ
//                quit tắt hẳn app khi level đang dở: gửi bù lúc mở app lần sau, trước level_start reopen
//
// Bấm "+60 sec" không gửi gì ngay, tính là một lần dùng booster PlayOn_Ads; chơi tiếp tới khi
// thắng / hết giờ lần nữa thì gửi thêm level_end.
// Bấm Restart trong bảng tạm dừng không gửi quit, chỉ gửi level_start restart.
// Bản web, editor, Creative, khung xem thử: KHÔNG gửi (vẫn ghi vào window.__suKien để kiểm tra).
import { S } from './state.js';
import { soThuTuLevel, artStyle } from '../content/loader.js';

const KHO = 'snug.events.v1';
const laApp = () => !!window.Capacitor?.isNativePlatform?.();
const laCongCu = () => S.preview || new URLSearchParams(location.search).get('creative') === '1';
const duocGui = () => laApp() && !laCongCu();

// ---------- lưu trong máy ----------
// { daMo: true, thua: { "cozy:sd-03": 2 }, dangChoi: { level, lose_index, booster } | null }
function doc() { try { return JSON.parse(localStorage.getItem(KHO)) || {}; } catch { return {}; } }
function ghi(d) { try { localStorage.setItem(KHO, JSON.stringify(d)); } catch {} }
let D = doc();
D.thua = D.thua || {};
const luu = () => ghi(D);

// ---------- gửi ----------
// Mỗi event đi hai nơi: Firebase Analytics và AppsFlyer (cùng tên, cùng tham số).
// AppsFlyer cần Dev Key: tools/build-www.mjs nhét vào index.html (window.__AF_DEV_KEY) lúc đóng gói
// Android, đọc từ android/appsflyer.properties nằm ngoài git. Không có key thì bỏ qua AppsFlyer.
let plugin = null, af = null;
function khoiDongAF() {
  const key = window.__AF_DEV_KEY;
  if (!key) { console.warn('[AppsFlyer] không có Dev Key, không gửi'); return Promise.resolve(null); }
  // Bọc trong object vì lý do như Firebase bên dưới (Proxy có "then")
  return import('appsflyer-capacitor-plugin')
    .then(async m => { await m.AppsFlyer.init({ devKey: key }); await m.AppsFlyer.start(); return { sdk: m.AppsFlyer }; })
    .catch(e => { console.warn('[AppsFlyer] khởi động lỗi', e?.message || e); return null; });
}
function guiLen(name, params) {
  (window.__suKien = window.__suKien || []).push({ name, params, t: Date.now() });
  if (window.__suKien.length > 200) window.__suKien.shift();
  if (!duocGui()) return;
  // Bọc plugin trong một object: plugin Capacitor là Proxy trả lời mọi thuộc tính, kể cả "then",
  // nên trả thẳng nó ra từ Promise thì Promise tưởng là thenable, treo mãi, không event nào đi.
  plugin = plugin || import('@capacitor-firebase/analytics').then(m => ({ fa: m.FirebaseAnalytics })).catch(() => ({}));
  plugin.then(({ fa }) => fa?.logEvent({ name, params })).catch(e => console.warn('[event]', name, e?.message || e));
  af = af || khoiDongAF();
  af.then(a => a?.sdk.logEvent({ eventName: name, eventValues: params })).catch(e => console.warn('[AppsFlyer]', name, e?.message || e));
}
// Khởi động AppsFlyer ngay khi mở app (đo lượt cài, lượt mở), không đợi tới event đầu tiên
if (duocGui()) af = khoiDongAF();

// ---------- lượt chơi hiện tại ----------
let daVaoPhien = false;    // lượt đầu tiên của lần mở app này đã bắt đầu chưa
let lyDoCho = null;        // lý do của lượt sắp dựng: 'next' | 'restart' | 'home'
let booster = {};          // số lần dùng từng booster trong lượt
const khoaThua = () => `${artStyle()}:${S.LEVEL?.id || ''}`;
const soLevel = () => soThuTuLevel(S.mapId, S.levelIdx);
const chuoiBooster = b => {
  const ds = ['freeze', 'resize', 'throw', 'PlayOn_Ads'].filter(k => b[k] > 0).map(k => `Booster_${k}_${b[k]}`);
  return ds.length ? ds.join(',') : '0';
};

/** Ghi lý do vào level trước khi dựng: next / restart / home */
export function lyDoVao(r) { lyDoCho = r; }

/** Gọi khi một lượt chơi bắt đầu (cuối build level) */
export function batDauLuot() {
  if (!S.LEVEL || laCongCu()) return;
  let playType;
  if (!daVaoPhien) {
    daVaoPhien = true;
    if (!D.daMo) playType = 'first_open';
    else if (D.dangChoi) {
      // lần trước tắt app khi level đang dở: gửi bù level_end quit cho lượt đó
      guiLen('level_end', { level: D.dangChoi.level, lose_index: D.dangChoi.lose_index || 0, booster_use: chuoiBooster(D.dangChoi.booster || {}), result: 'quit' });
      playType = 'reopen';
    } else playType = 'app_open';
    D.daMo = true;
  } else playType = lyDoCho || 'restart';
  lyDoCho = null;
  booster = {};
  const lose = D.thua[khoaThua()] || 0;
  guiLen('level_start', { level: soLevel(), mode: S.LEVEL.difficulty?.tier || 'Medium', play_type: playType, lose_index: lose });
  D.dangChoi = { level: soLevel(), lose_index: lose, booster: {} };
  luu();
}

/** Một lần dùng booster trong lượt: freeze | resize | throw */
export function dungBooster(loai) {
  if (laCongCu()) return;
  booster[loai] = (booster[loai] || 0) + 1;
  if (D.dangChoi) { D.dangChoi.booster = { ...booster }; luu(); }
}

/** Lượt kết thúc: 'win' khi thắng, 'lose' khi hết giờ */
export function ketThucLuot(result) {
  if (!S.LEVEL || laCongCu()) return;
  const k = khoaThua();
  if (result === 'lose') D.thua[k] = (D.thua[k] || 0) + 1;
  guiLen('level_end', { level: soLevel(), lose_index: D.thua[k] || 0, booster_use: chuoiBooster(booster), result });
  D.dangChoi = null;   // lượt đã xong: tắt app lúc này không tính là bỏ dở
  luu();
}

/** Bấm "+60 sec": không gửi event, tính một lần booster PlayOn_Ads, lượt chơi tiếp tục (tắt app lúc này là bỏ dở) */
export function tiepTucLuot() {
  if (!S.LEVEL || laCongCu()) return;
  booster.PlayOn_Ads = (booster.PlayOn_Ads || 0) + 1;
  D.dangChoi = { level: soLevel(), lose_index: D.thua[khoaThua()] || 0, booster: { ...booster } };
  luu();
}
