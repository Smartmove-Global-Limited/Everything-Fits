// Âm thanh. File WAV thật nằm ở public/audio/ (sinh bằng `node build_audio.mjs`),
// không tổng hợp lúc chạy, để sau bê nguyên bộ sang Unity được.
//
// Trình duyệt chỉ cho phát tiếng sau khi người chơi chạm vào trang, nên AudioContext
// được dựng ở lần chạm đầu tiên rồi mới tải file.
const BASE = './audio/';

const NAMES = ['tap', 'tapBig', 'pick', 'drop', 'land', 'fit', 'nope', 'eject', 'jiggle',
  'shrink', 'trash', 'unlock', 'tick', 'whoosh', 'star', 'win', 'lose', 'unlockLv',
  'glass', 'metal', 'paper', 'crack', 'break'];   // tiếng chạm theo chất liệu, nứt và vỡ (rules.js)

// v2: đổi khoá để mọi máy về mặc định BẬT tiếng và nhạc. Android giữ dữ liệu app khi cài đè
// cùng chữ ký, nên lựa chọn tắt lưu từ bản cũ (nút ở trang chủ đã bỏ) không còn kéo theo.
const KEY = 'snug.audio.v2';
const prefs = { sfx: true, music: true, vib: true, ...readPrefs() };   // vib: rung máy (Settings › Vibration)
function readPrefs() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} }

let ac = null, sfxBus = null, musicBus = null;
const buffers = new Map();
let musicNode = null, musicBuffer = null, musicWanted = false, musicStarting = false;
let silent = false;
const laApp = () => !!window.Capacitor?.isNativePlatform?.();                 // khung xem thử trong editor: tắt hẳn cho đỡ ồn

export function setSilent(v) { silent = v; }
export const isSfxOn = () => prefs.sfx;
export const isMusicOn = () => prefs.music;
export const isVibOn = () => prefs.vib !== false;

// Tiếng do bên âm thanh làm (m4a), thay cho tiếng tự sinh cùng tên. Tiếng không có trong bảng
// này vẫn là file .wav sinh bằng build_audio.mjs.
const FILE = {
  bgm: 'bgm.m4a',                  // nhạc nền, phát lặp
  tap: 'button_pressed.wav',       // bấm nút, chọn món (wav: không có khoảng lặng đầu như m4a)
  tapBig: 'button_pressed.wav',    // nút to ở bảng thắng / thua / tạm dừng
  star: 'star_get.m4a',            // bảng thắng hiện lên, các ngôi sao chấm điểm
  win: 'level_complete.m4a',       // thắng màn
  lose: 'lose.m4a',                // thua màn
};

async function decode(name) {
  const res = await fetch(BASE + (FILE[name] || name + '.wav'));
  if (!res.ok) throw new Error(res.status);
  return ac.decodeAudioData(await res.arrayBuffer());
}

/** Dựng AudioContext + tải sẵn các tiếng ngắn. Gọi được nhiều lần, chỉ chạy một lần. */
let booted = null;
export function initAudio() {
  if (silent) return Promise.resolve();
  // Chưa có lần chạm nào thì CHƯA dựng AudioContext (trừ app Android: MainActivity đã cho WebView
  // phát không cần chạm). Dựng trước lần chạm thì trình duyệt để nó ở trạng thái chờ; có máy
  // (Tecno chip Unisoc, cả Chrome lẫn WebView) mở lại sau đó vẫn câm hẳn, kể cả tiếng mới tạo.
  // Lần chạm đầu (unlockOnFirstGesture) sẽ gọi lại hàm này, nhạc nền chờ sẵn thì phát luôn.
  if (!booted && !laApp() && navigator.userActivation && !navigator.userActivation.hasBeenActive) return Promise.resolve();
  if (THE()) return initThe();
  if (booted) { if (ac.state === 'suspended') ac.resume(); return booted; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return (booted = Promise.resolve());
  ac = new AC();
  sfxBus = ac.createGain(); sfxBus.gain.value = .85; sfxBus.connect(ac.destination);
  musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(ac.destination);
  booted = Promise.all(NAMES.map(n =>
    decode(n).then(b => buffers.set(n, b)).catch(() => {})
  )).then(() => { if (musicWanted) startMusic(); });
  return booted;
}

/** Phát một tiếng. rate đổi cao độ, gain đổi to nhỏ, delay tính bằng giây. */
export function sfx(name, { rate = 1, gain = 1, delay = 0 } = {}) {
  if (THE()) { if (!silent && prefs.sfx && booted) sfxThe(name, rate, gain, delay); return; }
  if (silent || !prefs.sfx || !ac) return;
  const b = buffers.get(name); if (!b) return;
  if (ac.state === 'suspended') ac.resume();
  const src = ac.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
  const g = ac.createGain(); g.gain.value = gain;
  src.connect(g).connect(sfxBus);
  src.start(ac.currentTime + delay);
}

/** Nhiều tiếng giống nhau nối đuôi, cao độ lên dần: dùng cho chuỗi sao ở màn thắng */
export function sfxSeq(name, n, { step = .13, rate = 1, up = .12, gain = 1 } = {}) {
  for (let i = 0; i < n; i++) sfx(name, { delay: i * step, rate: rate + i * up, gain });
}

// ---------- nhạc nền ----------
/**
 * Bật nhạc nền. Gọi bao nhiêu lần cũng chỉ có một luồng chạy.
 * Cờ musicStarting là bắt buộc: lần gọi đầu phải chờ tải xong bgm.m4a, trong lúc chờ đó
 * musicNode vẫn là null nên mọi lần gọi khác đều lọt qua và cùng dựng thêm một luồng —
 * kết quả là hai ba bản nhạc đè lên nhau mà chỉ tắt được bản cuối.
 */
// TẠM THỜI: tắt hẳn nhạc nền (tiếng hiệu ứng vẫn giữ). Áp cho web, editor, Creative và app.
// Bật lại nhạc: đổi về false rồi build lại.
const TAT_NHAC_TAM = false;

export async function startMusic() {
  musicWanted = true;
  if (THE()) { if (!TAT_NHAC_TAM && !silent && prefs.music && booted) nhacThe(.32, 1.2); return; }
  if (TAT_NHAC_TAM || silent || !prefs.music || !ac) return;
  if (musicNode || musicStarting) return;
  musicStarting = true;
  try {
    if (!musicBuffer) musicBuffer = await decode('bgm');
    if (!musicWanted || !prefs.music || musicNode) return;   // đổi ý trong lúc đang tải
    musicNode = ac.createBufferSource();
    musicNode.buffer = musicBuffer; musicNode.loop = true;
    // File AAC (m4a) có đoạn im lặng ngắn ở đầu và cuối do bộ nén thêm vào: lặp nguyên file là
    // nghe hụt một nhịp ở chỗ nối. Bỏ đúng phần thừa đó (xem vungCoTieng).
    const [dau, cuoi] = vungCoTieng(musicBuffer);
    if (cuoi > dau) { musicNode.loopStart = dau; musicNode.loopEnd = cuoi; }
    musicNode.connect(musicBus);
    musicNode.start(0, musicNode.loopStart || 0);   // vào thẳng phần có tiếng
    ramp(musicBus.gain, .32, 1.2);
  } catch {
    /* không tải được thì chơi tiếp trong im lặng */
  } finally { musicStarting = false; }
}

/**
 * Đoạn lặp của nhạc nền: bỏ phần im lặng THỪA do bộ nén AAC chèn vào hai đầu file (đầu ~0,05 s,
 * cuối < 0,03 s), nhưng giữ nguyên khoảng nghỉ có chủ ý của bản nhạc. Bản BGM nghỉ 0,77 s ở cuối
 * để vòng lặp khớp phách; cắt hết khoảng đó là nhịp vào lại sớm, nghe lệch.
 */
const THUA_DAU = .06, THUA_CUOI = .03;
function vungCoTieng(buf) {
  const d = buf.getChannelData(0), n = d.length, nguong = 1e-3, sr = buf.sampleRate;
  let a = 0, b = n - 1;
  while (a < n && Math.abs(d[a]) < nguong) a++;
  while (b > a && Math.abs(d[b]) < nguong) b--;
  return [Math.min(a / sr, THUA_DAU), buf.duration - Math.min((n - 1 - b) / sr, THUA_CUOI)];
}

export function stopMusic() {
  musicWanted = false;
  if (THE()) { nhacThe(0, .5); return; }
  if (!musicNode) return;
  const node = musicNode; musicNode = null;
  ramp(musicBus.gain, 0, .5);
  setTimeout(() => { try { node.stop(); } catch {} }, 600);
}

/** Hạ nhạc nền xuống khi có overlay thắng / thua, rồi trả lại như cũ */
export function duckMusic(on) {
  if (THE()) { if (nhacEl && !nhacEl.paused && musicWanted) nhacThe(on ? .1 : .32, .3); return; }
  if (!ac || !musicNode) return;
  ramp(musicBus.gain, on ? .1 : .32, .3);
}

function ramp(param, to, sec) {
  const t = ac.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + sec);
}

// ---------- app Android: phát bằng thẻ <audio> ----------
// Có máy Android (Tecno chip Unisoc…) mà Web Audio câm hẳn: AudioContext báo đang chạy, file giải
// mã được, nhưng loa không ra gì, kể cả trong Chrome. Thẻ <audio> thì vẫn kêu (đi đường phát media
// của máy), nên app Android dùng thẻ <audio> cho mọi tiếng. Bản web giữ Web Audio như cũ.
// MainActivity đã cho WebView phát không cần chờ chạm, nên tiếng có ngay từ Splash.
let laThe = null;
const THE = () => (laThe ??= laApp());   // hỏi lúc cần, không hỏi lúc nạp file
const TOI_DA_MOI_TIENG = 4;      // một tiếng phát chồng lên nhau tối đa chừng này lần
const kho = new Map();           // tên tiếng → các thẻ <audio> dùng lại
let nhacEl = null, nhacHen = 0;

const taoThe = name => {
  const el = new Audio(BASE + (FILE[name] || name + '.wav'));
  el.preload = 'auto';
  el.preservesPitch = false;     // đổi tốc độ là đổi cao độ, như playbackRate của Web Audio
  return el;
};

function initThe() {
  if (!booted) {
    for (const n of NAMES) kho.set(n, [taoThe(n)]);   // tải sẵn mỗi tiếng một thẻ
    booted = Promise.resolve();
  }
  if (musicWanted) startMusic();
  return booted;
}

function sfxThe(name, rate, gain, delay) {
  const ds = kho.get(name); if (!ds) return;
  let el = ds.find(e => e.paused || e.ended);
  if (!el) {
    if (ds.length >= TOI_DA_MOI_TIENG) return;      // đang kêu đủ chồng rồi, bỏ bớt cho đỡ rối
    ds.push(el = taoThe(name));
  }
  const phat = () => {
    try {
      el.volume = Math.max(0, Math.min(1, gain * .85));
      el.playbackRate = Math.max(.25, Math.min(4, rate));
      el.currentTime = 0;
      el.play().catch(() => {});
    } catch {}
  };
  delay > 0 ? setTimeout(phat, delay * 1000) : phat();
}

// Thẻ <audio> vẫn kêu khi app chạy nền (Web Audio thì tự ngưng theo WebView): tự dừng và bật lại
document.addEventListener('visibilitychange', () => {
  if (!THE() || !nhacEl) return;
  if (document.hidden) nhacEl.pause();
  else if (musicWanted && prefs.music && !TAT_NHAC_TAM) nhacEl.play().catch(() => {});
});

/** Đưa âm lượng nhạc nền về `toi` trong `giay` giây; về 0 thì dừng hẳn */
function nhacThe(toi, giay) {
  if (!nhacEl) {
    if (toi <= 0) return;
    nhacEl = taoThe('bgm'); nhacEl.loop = true; nhacEl.volume = 0;
  }
  if (toi > 0 && nhacEl.paused) nhacEl.play().catch(() => {});
  clearInterval(nhacHen);
  const tu = nhacEl.volume, buoc = Math.max(1, Math.round(giay * 1000 / 40));
  let i = 0;
  nhacHen = setInterval(() => {
    i++;
    nhacEl.volume = Math.max(0, Math.min(1, tu + (toi - tu) * i / buoc));
    if (i >= buoc) { clearInterval(nhacHen); if (toi <= 0) nhacEl.pause(); }
  }, 40);
}

// ---------- bật tắt ----------
export function setSfxOn(v) { prefs.sfx = !!v; savePrefs(); if (v) sfx('tap'); }
export function setVibOn(v) { prefs.vib = !!v; savePrefs(); }
export function setMusicOn(v) {
  prefs.music = !!v; savePrefs();
  v ? startMusic() : stopMusic();
}

/** Lần chạm đầu tiên ở bất kỳ đâu sẽ mở khoá âm thanh của trình duyệt */
export function unlockOnFirstGesture() {
  const go = () => { initAudio(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, go, { once: true, capture: true });
  }
}
