// Màn Splash lúc mở game, theo kiểu Snug gốc: đồ đạc phủ kín màn, logo nằm giữa. Không có nút.
//
// Ba nhịp:
//   1. HIỆN   đồ bật ra lần lượt khắp màn (phóng từ nhỏ lên, nảy nhẹ), xếp theo lưới so le
//             có xê dịch ngẫu nhiên nên nhìn như bày bừa mà vẫn kín màn.
//   2. LẮC    cả đống lắc lư nhè nhẹ, mỗi món một nhịp riêng.
//   3. RƠI    lần lượt từng món rụng xuống, rơi thẳng qua đáy màn hình rồi mất, không có sàn
//             đỡ. Hết đồ trên màn thì màn khép lại, vào thẳng ván chơi.
// Chạm vào đâu cũng bỏ qua nhịp đang chạy: đang hiện hay đang lắc thì cho rơi luôn.
//
// Không dùng vật lý: đồ không va nhau, chỉ cần rơi có gia tốc và xoay, tính tay nhẹ hơn nhiều.
// Ảnh là của bộ art đang chọn, nên cozy và casual tự ra đúng đồ của mình.
import { ITEM_DEFS } from '../data/items.js';
import { sfx, initAudio } from './sfx.js';

const $ = id => document.getElementById(id);

const W = 420;                 // bề ngang logic, như sân chơi; chiều cao theo màn thật
const O = 82;                  // cỡ một ô lưới (đơn vị logic): món cao/rộng nhất chừng này
const HIEN = 700;              // thời gian cả màn bật ra xong
const BAT = 260;               // một món bật ra trong chừng này
const LAC = 1250;              // lắc lư chừng này rồi mới rơi
const RAI_RUNG = 650;          // các món rụng rải rác trong quãng này
const G = .0024;               // gia tốc rơi (đơn vị logic / ms²)
export const DUNG_LAU = HIEN + LAC + RAI_RUNG + 900;   // tổng thời gian Splash, xấp xỉ

let run = null;                // trạng thái màn đang chạy

/**
 * Mở app bình thường thì Splash hiện ngay từ khung đầu và tấm màn chuyển cảnh bị ẩn hẳn
 * (lớp splash-boot trên <html>, đặt trong index.html). Splash xong thì trả tấm màn về trạng
 * thái mở sẵn để các lần chuyển màn sau vẫn dùng được, không để nó hiện lại che Home.
 */
export function hetSplashBoot() {
  const veil = document.getElementById('veil');
  if (veil) { veil.classList.remove('boot'); veil.classList.add('off'); }
  document.documentElement.classList.remove('splash-boot');
}

/** Phát ngẫu nhiên nhỏ quanh 0 */
const lech = k => (Math.random() - .5) * 2 * k;

/**
 * Mở màn Splash. Trả về Promise xong khi màn đã khép lại (đồ rơi hết hoặc người chơi chạm).
 * Không có món nào có ảnh (content lỗi) thì bỏ qua luôn.
 *
 * `khiKhep` (tuỳ chọn) được gọi đúng lúc màn BẮT ĐẦU khép, trước quãng mờ dần 380ms —
 * để ai muốn che tấm màn chuyển cảnh lên thì che kịp trong lúc Splash còn đang mờ.
 */
// logo: game thật không hiện cụm chữ (chỉ đồ phủ kín màn); Creative có nút bật lại để quay
export function showSplash({ khiKhep, logo = false } = {}) {
  const sanSang = () => ITEM_DEFS.filter(d => d.id > 0 && d.sprite?.ready);
  const el = $('splash'), cv = $('splashCv');
  if (!sanSang().length || !el) { hetSplashBoot(); if (el) el.classList.remove('show'); return Promise.resolve(); }
  if (run) { cancelAnimationFrame(run.raf); run = null; }

  // Rút món: ưu tiên món CHƯA hiện lần nào. Ảnh các chương sau về dần trong lúc Splash đang
  // chạy (main.js nạp không chờ), nên mỗi lần rút xét lại danh sách đã sẵn ảnh — món mới về
  // là được rút ngay, không phải đợi dùng hết bộ cũ; hết sạch mới cho lặp lại từ đầu.
  const daHien = new Set();
  const rutMon = () => {
    let ds = sanSang().filter(d => !daHien.has(d.id));
    if (!ds.length) { daHien.clear(); ds = sanSang(); }
    const d = ds[Math.floor(Math.random() * ds.length)];
    daHien.add(d.id);
    return d;
  };
  const ctx = cv.getContext('2d');
  initAudio();   // app Android phát được ngay; web thì trình duyệt mở tiếng sau lần chạm đầu

  const r = { raf: 0, H: 760, k: 1, dpr: 1, t: 0, mon: [], roiLuc: HIEN + LAC, tiengBat: 0, daRoi: false };
  run = r;

  function doCo() {
    const b = cv.getBoundingClientRect();
    if (!b.width) return;
    r.dpr = Math.min(window.devicePixelRatio || 1, 2);
    r.k = b.width / W; r.H = b.height / r.k;
    cv.width = Math.round(b.width * r.dpr); cv.height = Math.round(b.height * r.dpr);
  }
  r.onResize = doCo;
  window.addEventListener('resize', doCo);
  doCo();

  // ---------- bày đồ kín màn ----------
  // Lưới so le: hàng lẻ dịch nửa ô, mỗi ô xê dịch ngẫu nhiên. Hàng và cột thừa ra ngoài mép
  // một chút cho đồ bị cắt ở rìa như ảnh mẫu, không lộ khoảng trống quanh viền.
  const cot = Math.ceil(W / O) + 1, hang = Math.ceil(r.H / (O * .86)) + 1;
  for (let j = 0; j < hang; j++) {
    for (let i = 0; i < cot; i++) {
      const def = rutMon(); if (!def) continue;
      const sp = def.sprite, w = sp.img.width / sp.ppu, h = sp.img.height / sp.ppu;
      const co = O * (.82 + Math.random() * .24) / Math.max(w, h);   // món to nhỏ khác nhau chút
      const x = (i - .5 + (j % 2) * .5) * O + lech(O * .16);
      const y = (j - .3) * O * .86 + lech(O * .14);
      r.mon.push({
        def, x, y, co, goc: lech(.5),
        // bật ra theo khoảng cách tới giữa màn, cộng chút ngẫu nhiên: lan từ giữa ra như nở
        hienLuc: Math.min(HIEN - BAT, Math.hypot(x - W / 2, y - r.H * .45) / Math.hypot(W / 2, r.H * .55) * (HIEN - BAT) + lech(60)),
        lacPha: Math.random() * Math.PI * 2, lacTan: .0048 + Math.random() * .003, lacBien: .05 + Math.random() * .05,
        roiTre: 0, vx: 0, vy: 0, vg: 0, dx: 0, dy: 0, dg: 0, roi: false,
      });
    }
  }
  // vẽ từ trên xuống dưới: món hàng dưới đè lên món hàng trên như đồ chất lên nhau
  r.mon.sort((a, b) => a.y - b.y);

  /** Cho cả đống rụng: món rơi lần lượt, món ở dưới rụng trước để không ai rơi xuyên qua ai */
  function batDauRoi(nhanh = false) {
    if (r.daRoi) return; r.daRoi = true;
    r.roiLuc = r.t;
    const rai = nhanh ? RAI_RUNG * .45 : RAI_RUNG;
    for (const m of r.mon) {
      m.roiTre = (1 - m.y / r.H) * rai * .7 + Math.random() * rai * .3;
      m.vx = lech(.06); m.vy = -.12 - Math.random() * .18;   // nảy lên một chút trước khi rơi
      m.vg = lech(.0035);
    }
    sfx('whoosh', { gain: .5, rate: .9 });
  }

  function ve() {
    ctx.setTransform(r.dpr * r.k, 0, 0, r.dpr * r.k, 0, 0);
    ctx.clearRect(0, 0, W, r.H);
    for (const m of r.mon) {
      const tt = r.t - m.hienLuc;
      if (tt <= 0) continue;
      // bật ra: phóng từ 0 lên hơi quá cỡ rồi về đúng cỡ
      const e = Math.min(1, tt / BAT);
      const bat = e < 1 ? 1 - Math.pow(1 - e, 3) * Math.cos(e * 5.5) : 1;
      const lac = Math.sin(r.t * m.lacTan + m.lacPha) * m.lacBien * Math.min(1, tt / 400);
      const s = m.co * Math.max(0, bat);
      if (s <= 0) continue;
      const sp = m.def.sprite; if (!sp?.ready) continue;
      const w = sp.img.width / sp.ppu, h = sp.img.height / sp.ppu;
      ctx.save();
      ctx.translate(m.x + m.dx, m.y + m.dy);
      ctx.rotate(m.goc + lac + m.dg);
      ctx.scale(s, s);
      ctx.drawImage(sp.img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  let truoc = performance.now();
  function khung(now) {
    if (run !== r) return;
    const dt = Math.min(34, now - truoc); truoc = now;
    r.t += dt;
    // tiếng lách tách lúc đồ bật ra, không dồn dập
    if (r.t < HIEN && r.t - r.tiengBat > 70) { r.tiengBat = r.t; sfx('tap', { gain: .14, rate: 1.1 + Math.random() * .5 }); }
    if (!r.daRoi && r.t >= HIEN + LAC) batDauRoi();
    if (r.daRoi) {
      let conTrenMan = 0;
      for (const m of r.mon) {
        if (r.t - r.roiLuc < m.roiTre) { conTrenMan++; continue; }
        m.vy += G * dt; m.dx += m.vx * dt; m.dy += m.vy * dt; m.dg += m.vg * dt;
        if (m.y + m.dy - O < r.H) conTrenMan++;
      }
      if (!conTrenMan) r.xong?.();   // rơi hết qua đáy màn
    }
    ve();
    r.raf = requestAnimationFrame(khung);
  }
  r.raf = requestAnimationFrame(khung);

  el.classList.add('show');
  el.classList.remove('go');
  el.classList.toggle('no-brand', !logo);
  return new Promise(xong => {
    let dong = false, han = 0;
    const khep = async () => {
      if (dong) return; dong = true;
      clearTimeout(han);
      el.removeEventListener('pointerdown', cham);
      hetSplashBoot();
      // Gọi SAU hetSplashBoot: hàm đó vừa đặt tấm màn về trạng thái "mở" (lớp off), gọi trước
      // thì ai kéo màn che vào sẽ bị nó mở toang lại ngay lập tức.
      try { khiKhep?.(); } catch (e) { console.warn('splash khiKhep', e); }
      // Splash còn nguyên trong lúc tấm màn kéo vào (190ms), đục hẳn rồi mới tắt Splash phía
      // sau. Tắt cùng lúc thì hai lớp cùng nửa trong suốt, màn chơi lộ ra một thoáng.
      await new Promise(res => setTimeout(res, khiKhep ? 200 : 0));
      el.classList.remove('show');
      await new Promise(res => setTimeout(res, 380));   // chờ màn mờ hẳn rồi mới dọn
      window.removeEventListener('resize', doCo);
      cancelAnimationFrame(r.raf);
      el.classList.add('no-brand');   // trả về mặc định của game: không chữ
      if (run === r) run = null;
      xong();
    };
    r.xong = khep;
    // Chạm: đang hiện hay đang lắc thì rụng luôn cho nhanh; đang rơi rồi thì khép ngay
    const cham = () => { if (r.daRoi) khep(); else batDauRoi(true); };
    el.addEventListener('pointerdown', cham);
    el.classList.add('go');
    // chốt chặn: tab ẩn làm khung hình đứng thì vẫn khép đúng hẹn, không kẹt ở Splash
    han = setTimeout(khep, DUNG_LAU + 2500);
  });
}
