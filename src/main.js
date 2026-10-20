// Điểm vào của game. Tải content pack, dựng level, chạy loop. Nghe postMessage từ Level Editor để live preview.
import Matter from 'matter-js';
import { S, BAG } from './game/state.js';
import { defById } from './data/items.js';
import { resize } from './game/canvas.js';
import { bindInput } from './game/input.js';
import { bindBoosters } from './game/boosters.js';
import { bindShake, goiYLacMotLan, shakeImpulse } from './game/shake.js';
import { build, loadAndBuild, restart, nextLevel, prevLevel } from './game/level.js';
import { startLoop } from './game/render.js';
import { makeItem } from './game/physics.js';
import { bindOverlayButtons, hideLose, toast, renderList } from './ui/hud.js';
import { bindImpacts } from './game/rules.js';
import { BAG_SKINS } from './art/scene-registry.js';
import { loadBook, chapters, chapterById, loadChapterAssets, loadItemManifests, loadBags, whenSpriteReady, setArtStyle, artStyle, applyArtIcons, loadConfig } from './content/loader.js';
import { useArtProgress, getSpot } from './game/progress.js';
import { lyDoVao, tiepTucLuot } from './game/events.js';
import { autoplay, stopAutoplay, autoState, autoLog, chanDoan } from './game/autoplay.js';
import * as FX from './game/fx.js';
import * as RULES from './game/rules.js';
import * as SCORE from './game/score.js';
import { initHome, showHome, hideHome, showMap } from './ui/home.js';
import { showSplash, hetSplashBoot } from './ui/splash.js';
import { applyStatic, t } from './i18n.js';
import { initCreative, isCreative } from './game/creative.js';
import { setSilent, unlockOnFirstGesture, initAudio, startMusic, duckMusic } from './ui/sfx.js';
import { chuyenMan, moMan } from './ui/veil.js';

const params = new URLSearchParams(location.search);

// TẠM THỜI: bỏ qua trang chủ. Splash tắt là vào thẳng ván đang chơi dở, mạch chơi liền
// một hơi, không có nút nào đưa người chơi về Home hay nhảy màn. Trang chủ vẫn còn nguyên
// trong mã — muốn trả lại thì đổi cờ này về false.
const BO_QUA_HOME = true;

// TẠM THỜI: bản gửi bên design. Ẩn cụm đồng hồ + số món + nút tạm dừng và thanh booster,
// đồng hồ không đếm (không thua vì hết giờ). Áp cho cả web, editor, Creative và app Android.
// Trả lại HUD như cũ: đổi cờ này về false rồi build lại.
const AN_HUD_TAM = false;
S.anHud = AN_HUD_TAM;
if (AN_HUD_TAM) document.getElementById('phone')?.classList.add('hide-timer', 'hide-pause', 'hide-dock');

// Bộ art: ?art=casual đổi thư mục ảnh và bảng màu HUD. Không ghi trên địa chỉ thì theo
// config.json (editor đặt bằng nút "Game dùng"), đọc trong boot() trước mọi lượt nạp ảnh.
setArtStyle(params.get('art') || 'cozy');
document.documentElement.dataset.art = artStyle();
applyStatic();

/**
 * Mở tấm màn lần đầu, khi giao diện đã sẵn sàng thật.
 *
 * "Sẵn sàng" ở đây là hai điều kiện, thiếu điều nào cũng lộ ra cái xấu cũ:
 *   - chữ đã dựng xong   → không còn cảnh chữ hiện bằng font hệ thống rồi nhảy sang font thật
 *   - ảnh trang chủ đã về → không còn thẻ chương trắng trơn rồi ảnh mới đắp vào
 *
 * Kèm hạn chót 6 giây: một tấm ảnh hỏng đường dẫn không được phép giữ người chơi
 * ngồi nhìn tấm màn mãi.
 */
async function moManLanDau() {
  const anh = [...document.querySelectorAll('#home img')]
    .filter(n => n.src && !n.complete)
    .map(n => new Promise(r => { n.addEventListener('load', r, { once: true }); n.addEventListener('error', r, { once: true }); }));
  const hetGio = new Promise(r => setTimeout(r, 6000));
  await Promise.race([Promise.all([document.fonts?.ready, ...anh]), hetGio]);
  await moMan();
}

async function boot() {
  bindOverlayButtons({
    onAgain: () => { lyDoVao('restart'); restart(); },   // chơi lại cùng màn: dựng tức thì, che màn chỉ tổ chậm tay
    onNext: () => { lyDoVao('next'); return chuyenMan(nextLevel); },
    onPrev: () => { lyDoVao('next'); return chuyenMan(prevLevel); },
    onExtraTime: extraTime,
    onHome: goHome,
  });
  bindInput();
  bindBoosters();
  bindShake();
  bindImpacts();
  resize();
  startLoop();

  whenSpriteReady(() => { if (S.LEVEL) renderList(); });

  S.preview = params.get('preview') === '1';
  // Khung xem thử trong editor mặc định im lặng cho đỡ ồn lúc dựng level;
  // bật công tắc "Bật tiếng khi xem thử" thì mới kêu. Tiếng chỉ mở được sau khi
  // người dùng chạm vào chính khung đó, nên cứ chạm vào là nghe.
  setSilent(S.preview && params.get('audio') !== '1');
  unlockOnFirstGesture();

  // App Android: không gọi mạng, chạy cứng bộ art cozy với level đóng gói sẵn trong APK
  // (đổi level thì sync lại rồi build bản mới). Bản web vẫn theo config.json như cũ.
  if (window.Capacitor?.isNativePlatform?.()) setArtStyle('cozy');
  else if (!params.get('art')) setArtStyle((await loadConfig()).art);
  // Toàn bộ nội dung nằm trong bản build: một file sắp xếp và thư mục ảnh. Không gọi mạng.
  await loadBook({ fresh: S.preview });
  useArtProgress(artStyle());
  // loadBook có thể đã lùi về cozy nếu bộ được chọn chưa có level: gắn lại bảng màu cho khớp
  document.documentElement.dataset.art = artStyle();
  applyArtIcons();
  // Nút tạm dừng nằm cùng hàng với đồng hồ và số món (ba viên căn giữa một cụm), cả hai bộ art.
  document.querySelector('.timerwrap')?.appendChild(document.getElementById('pauseBtn'));

  // Live preview từ editor: level gửi qua postMessage, không tải từ content
  window.addEventListener('message', e => {
    const m = e.data || {};
    if (m.type === 'level' && m.level) {
      S.levelIdx = m.index ?? S.levelIdx;
      if (m.chapter) S.map = { ...(S.map || {}), no: m.chapter.no, name: m.chapter.name, levels: S.map?.levels || [] };
      if (m.chapter?.id) S.mapId = m.chapter.id;   // để tiêu đề "Level N" tính đúng số thứ tự liền qua các chương
      // Editor có thể vừa thêm món chưa nằm trong danh sách ảnh của chương.
      // Không nạp ảnh trước thì món có hình vật lý mà không có gì để vẽ: chiếm chỗ mà vô hình.
      buildWithArt(m.level);
    }
    if (m.type === 'restart') { stopAutoplay(); restart(); }
    if (m.type === 'autoplay') autoplay();
    if (m.type === 'assets') { // editor vừa thêm/sửa art → nạp lại rồi dựng lại level
      loadBook({ fresh: true }).then(() => loadChapterAssets(S.map)).then(() => { if (S.LEVEL) build(S.LEVEL); });
    }
    if (m.type === 'timer') { S.timerOn = !!m.on; }
  });
  if (S.preview) {
    const ch = chapterById(params.get('map') || chapters()[0]?.id);
    S.mapId = ch.id; S.map = ch;
    await loadChapterAssets(ch);
    anNutDieuHuong();
    window.parent.postMessage({ type: 'ready' }, '*');
    moMan();
    return;
  }

  initHome({ chapters: chapters(), onPlay: startLevel });
  initCreative({ startLevel, vaoNgay, choiSplash, goHome, showMap, chapterById });

  // Mở thẳng một level qua địa chỉ (?level=… hoặc ?i=…) thì bỏ qua trang chủ
  const byId = params.get('level'), byIdx = params.get('i');
  const spot = getSpot(chapters());
  if (byId != null || byIdx != null) {
    const ch = chapterById(params.get('map') || chapters()[0]?.id);
    const idx = byId ? Math.max(0, ch.levels.findIndex(l => l.id === byId)) : Number(byIdx || 0);
    await startLevel(ch, idx);
  } else if (BO_QUA_HOME && !isCreative && spot) {
    // Splash → thẳng vào ván đang chơi dở, không qua trang chủ.
    // "Level tiếp" ở bảng thắng vẫn giữ: đó là đường đi duy nhất còn lại sang màn sau.
    anNutDieuHuong({ giuLevelTiep: true });
    try {
      await loadChapterAssets(chapters()[0]);
      // Kéo màn che ngay lúc Splash BẮT ĐẦU mờ: chờ nó tan hẳn rồi mới che là hở sân trống.
      loadItemManifests().catch(() => {});   // nạp nốt mọi món của bộ art (không chờ): Splash rút dần khi ảnh về
      showSplash({ khiKhep: () => startLevel(spot.chapter, spot.index).catch(e => console.warn('vào ván', e)) });
    } catch (e) {
      console.warn('splash', e); hetSplashBoot();
      await startLevel(spot.chapter, spot.index);
    }
  } else {
    showHome();
    // Splash phủ trên trang chủ: đồ của chương đầu rơi thành đống, bấm Chơi là lộ trang chủ.
    // Creative Tool tự điều khiển màn hình nên bỏ qua.
    // Logo Splash đã hiện sẵn từ khung đầu (index.html); nạp xong đồ của chương đầu là đồ rơi.
    if (!isCreative) {
      try { await loadChapterAssets(chapters()[0]); loadItemManifests().catch(() => {}); showSplash(); }
      catch (e) { console.warn('splash', e); hetSplashBoot(); }
    }
  }
  await moManLanDau();
}

/**
 * Vào chơi một level: đổi chương thì nạp thêm art của chương đó trước.
 * Cả quãng ấy nằm sau tấm màn — nạp ảnh của một chương mới mất vài trăm mili giây, để
 * hở là người chơi thấy sân trống rồi đồ đạc lần lượt mọc lên.
 */
async function startLevel(ch, idx) {
  lyDoVao('home');   // lượt đầu của lần mở app tự thành first_open / app_open / reopen (events.js)
  await chuyenMan(async () => {
    if (!S.map || S.mapId !== ch.id) {
      S.mapId = ch.id; S.map = ch;
      await loadChapterAssets(ch);
    }
    hideHome();
    await initAudio();
    startMusic();
    await loadAndBuild(idx);
  });
  goiYLacMotLan(toast, t('shakeHint'));
}

/**
 * Creative Tool: vào thẳng màn chơi, không qua tấm màn chuyển cảnh. Nạp ảnh và dựng level
 * xong mới cất trang chủ, nên khung đầu tiên người xem thấy là màn chơi với đồ đang mưa
 * xuống, y như game thật sau Splash. Có `level` thì dựng đúng bản đó (level Creative đã sửa).
 */
async function vaoNgay(ch, idx, level = null) {
  if (!S.map || S.mapId !== ch.id) {
    S.mapId = ch.id; S.map = ch;
    await loadChapterAssets(ch);
  }
  await initAudio();
  startMusic();
  if (level) { S.levelIdx = idx; await buildWithArt(level); }
  else await loadAndBuild(idx);
  hideHome();
}

/**
 * Creative Tool: chạy lại màn Splash như lúc mở app, xong thì vào lại màn đang quay (qua tấm
 * màn chuyển cảnh như game thật). Đồ của cả bộ art nạp trước một chút cho Splash đủ đồ.
 */
async function choiSplash(ch, idx, level = null, { logo = true } = {}) {
  stopAutoplay();
  await Promise.race([loadItemManifests().catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
  await showSplash({ logo, khiKhep: () => chuyenMan(() => vaoNgay(ch, idx, level)).catch(e => console.warn('vào ván', e)) });
}

/**
 * Ẩn các nút điều hướng: "Về trang chủ" ở ba bảng, hàng "Level trước / Level sau" trong
 * bảng tạm dừng, và (nếu không giữ) "Level tiếp" ở bảng thắng.
 *
 * Dùng ở hai chỗ:
 *  - Khung xem thử trong editor chỉ có MỘT level, cái đang sửa do editor gửi sang. "Về trang
 *    chủ" mở ra một màn Home rỗng vì danh sách chương chưa bao giờ được dựng, còn "Level tiếp"
 *    nhảy sang một level đã lưu, người dựng mất luôn thứ đang làm dở → ẩn hết.
 *  - Game bỏ qua trang chủ (BO_QUA_HOME): không có Home để về, không cho nhảy màn tuỳ ý,
 *    nhưng "Level tiếp" là đường đi duy nhất sang màn sau nên phải giữ.
 */
function anNutDieuHuong({ giuLevelTiep = false } = {}) {
  const ids = ['homeBtn', 'winHome', 'loseHome'];
  if (!giuLevelTiep) ids.push('next');
  for (const id of ids) {
    const el = document.getElementById(id); if (el) el.hidden = true;
  }
  document.querySelectorAll('.lvnav').forEach(el => { el.hidden = true; });
}

/**
 * Nút "+60 sec" ở bảng thua: cộng thẳng 60 giây, tắt bảng thua, chơi tiếp. Không tính coin
 * (game chưa có ví coin). Hàm này từng bị xoá nhầm, để lại nút gọi vào một tên không có hàm
 * nào (trình duyệt hiểu nhầm là chính cái nút id="extraTime"), bấm vào chỉ báo lỗi.
 */
function extraTime() {
  if (!S.lost) return;
  S.timeLeft = 60000; S.lost = false; S.shownSec = -1;
  hideLose(); duckMusic(false);
  toast(t('extraTimeDone'));
  tiepTucLuot();   // không gửi event, lượt chơi tiếp tục
}

/** Về trang chủ: dừng ván đang chơi lại, không tính là thua */
function goHome() {
  return chuyenMan(async () => {
    S.paused = true; S.drag = null; S.selected = null;
    duckMusic(false);
    showHome();
  });
}

/** Dựng level trong khung xem thử, nạp trước ảnh của những món chưa có */
// Editor gửi level liên tục mỗi lần sửa. Lần gửi cũ còn đang chờ nạp ảnh mà lần mới đã tới
// thì lần cũ không được dựng đè lên lần mới, kẻo xem thử hiện lại túi / món của lúc trước.
let lanGui = 0;
async function buildWithArt(level) {
  const lan = ++lanGui;
  const missing = [...new Set((level.items || []).map(it => Number(it.id)))]
    .filter(id => { const d = defById(id); return !d || !d.sprite; });
  if (missing.length) await loadItemManifests(missing);
  // Editor vừa đổi sang kiểu túi chương này chưa dùng: nạp ảnh túi đó trước, không thì túi
  // vẽ ra là túi cũ / túi vẽ bằng code, lòng túi cũng sai hình
  const skin = level.container?.skin;
  if (skin && !BAG_SKINS[skin]) {
    await loadBags([skin]);
    if (!BAG_SKINS[skin]) console.warn(`Xem thử: không nạp được ảnh túi "${skin}", đang vẽ tạm túi mặc định`);
  }
  if (lan !== lanGui) return;   // đã có level mới hơn gửi tới
  build(level);
}

// Hook debug ở chế độ dev: mở console gõ __game.S để xem trạng thái, __game.drag(id, x, y) để thử kéo.
if (import.meta.env?.DEV) {
  window.__game = {
    S, BAG, FX, RULES, SCORE, shakeImpulse, restart, nextLevel, prevLevel, autoplay, stopAutoplay, autoState, autoLog, chanDoan,
    body: id => S.bodies.find(b => b.label === id),
    // thêm một món vào màn đang chơi để thử (mã món, toạ độ tuyệt đối)
    them(id, x = 210, y = 200) { const b = makeItem(defById(id), x, y); b.khoa = 900 + S.bodies.length; S.bodies.push(b); Matter.World.add(S.world, b); return b; },
    async drag(id, tx, ty, steps = 10) {
      const cv = document.getElementById('game'), r = cv.getBoundingClientRect();
      const b = S.bodies.find(x => x.label === id); if (!b) return 'not found: ' + id;
      const send = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, clientX: r.left + x * r.width / 420, clientY: r.top + y * r.height / 760 }));
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const sx = b.position.x, sy = b.position.y;
      send('pointerdown', sx, sy); await wait(60);
      for (let i = 1; i <= steps; i++) { send('pointermove', sx + (tx - sx) * i / steps, sy + (ty - sy) * i / steps); await wait(30); }
      await wait(200);
      const ghost = S.drag ? S.drag.ghost : null;
      send('pointerup', tx, ty); await wait(700);
      return { id, ghostBeforeDrop: ghost, checked: S.checked.has(b.khoa), pos: [Math.round(b.position.x), Math.round(b.position.y)] };
    },
  };
}

boot().catch(err => {
  console.error(err);
  hetSplashBoot();                  // Splash không được treo mãi che màn khi khởi động hỏng
  moMan();                          // hỏng thì cũng phải cho người chơi thấy màn hình
  toast(t('loadError', { msg: err.message }), 5000);
});
