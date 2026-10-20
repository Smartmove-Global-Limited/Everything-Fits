// Sinh toàn bộ hiệu ứng âm thanh ra file WAV thật trong public/audio/.
// Dùng file thật (không synth lúc chạy) để sau bê nguyên sang Unity được.
// Chạy: node build_audio.mjs
// Lưu ý: bgm, tap, tapBig, win, lose đã thay bằng file m4a của bên âm thanh (xem FILE trong
// src/ui/sfx.js); các file .wav cùng tên mà lệnh này sinh ra không còn được game dùng.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'public/audio');
const SR = 22050;

// ---------- khung tổng hợp ----------
const buf = sec => new Float32Array(Math.round(sec * SR));
const clamp = v => v < -1 ? -1 : v > 1 ? 1 : v;

/** Bao biên độ: lên nhanh, giữ, tắt dần theo hàm mũ */
function env(t, dur, { a = .005, d = 0, s = 1, r = null, curve = 2.2 } = {}) {
  const rel = r ?? dur * .7;
  if (t < a) return t / a;
  const afterA = t - a;
  if (d && afterA < d) return 1 + (s - 1) * (afterA / d);
  const left = dur - t;
  if (left < rel) return s * Math.pow(Math.max(0, left / rel), curve);
  return s;
}

/** Cộng một giọng vào buffer. f có thể là số hoặc hàm của tiến độ 0..1 */
function tone(out, { at = 0, dur, f, gain = .3, wave = 'sine', vib = 0, vibHz = 6, env: eo }) {
  const i0 = Math.round(at * SR), n = Math.round(dur * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx >= out.length) break;
    const t = i / SR, p = i / n;
    let freq = typeof f === 'function' ? f(p) : f;
    if (vib) freq *= 1 + vib * Math.sin(2 * Math.PI * vibHz * t);
    phase += 2 * Math.PI * freq / SR;
    let v;
    if (wave === 'sine') v = Math.sin(phase);
    else if (wave === 'tri') v = 2 / Math.PI * Math.asin(Math.sin(phase));
    else if (wave === 'square') v = Math.sin(phase) >= 0 ? 1 : -1;
    else if (wave === 'saw') v = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
    else v = Math.sin(phase);
    out[idx] += v * gain * env(t, dur, eo);
  }
}

/** Nhiễu đã lọc thông thấp: dùng cho tiếng sột soạt, tiếng gió, tiếng lắc */
function noise(out, { at = 0, dur, gain = .2, lp = .25, env: eo }) {
  const i0 = Math.round(at * SR), n = Math.round(dur * SR);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const idx = i0 + i; if (idx >= out.length) break;
    const white = Math.random() * 2 - 1;
    prev += (white - prev) * (typeof lp === 'function' ? lp(i / n) : lp);
    out[idx] += prev * gain * env(i / SR, dur, eo);
  }
}

function wav(samples, gainAll = 1) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  // Chuẩn hoá để mọi tiếng cùng độ to. Chừa sẵn khoảng hở: sóng vuông 22 kHz khi
  // trình duyệt tăng mẫu lên 48 kHz sẽ vọt qua đỉnh cũ, để sát 1.0 là rè.
  let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? gainAll * .80 / peak : 1;
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(clamp(samples[i] * k) * 32767), 44 + i * 2);
  return b;
}

// nốt nhạc → tần số
const N = { C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392, A4:440, B4:493.88,
            C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880, B5:987.77,
            C6:1046.5, D6:1174.7, E6:1318.5, G6:1568, A3:220, C3:130.81, E3:164.81, G3:196, F3:174.61, A2:110 };

// ---------- từng tiếng ----------
const SOUNDS = {
  // bấm nút bất kỳ trên giao diện
  tap() { const o = buf(.08); tone(o, { dur:.07, f:p=>900+520*p, gain:.35, wave:'sine', env:{a:.002,r:.055,curve:2.6} }); return o; },
  // bấm nút to (Play, Chơi tiếp)
  tapBig() { const o = buf(.2); tone(o,{dur:.16,f:p=>420+380*p,gain:.3,wave:'tri',env:{a:.003,r:.13}});
             tone(o,{at:.04,dur:.14,f:N.E6,gain:.16,env:{a:.004,r:.12}}); return o; },
  // nhấc món lên
  pick() { const o = buf(.14); tone(o,{dur:.12,f:p=>300+430*p,gain:.3,wave:'tri',env:{a:.004,r:.09}});
           noise(o,{dur:.05,gain:.1,lp:.5,env:{a:.002,r:.045}}); return o; },
  // thả món xuống chỗ hợp lệ
  drop() { const o = buf(.18); tone(o,{dur:.15,f:p=>380-200*p,gain:.3,wave:'tri',env:{a:.003,r:.12}});
           noise(o,{dur:.08,gain:.14,lp:.14,env:{a:.002,r:.07}}); return o; },
  // đồ tiếp đất: tiếng gỗ cộc ngắn, khác hẳn tiếng người chơi thả tay
  land() { const o = buf(.16);
           tone(o,{dur:.13,f:p=>210-90*p,gain:.34,wave:'tri',env:{a:.002,r:.1,curve:2.8}});
           tone(o,{dur:.05,f:p=>640-260*p,gain:.14,wave:'sine',env:{a:.001,r:.045}});
           noise(o,{dur:.07,gain:.16,lp:.22,env:{a:.001,r:.06}}); return o; },
  // món vừa khít, tick xanh sáng lên
  fit() { const o = buf(.34); tone(o,{dur:.16,f:N.C6,gain:.26,env:{a:.003,r:.14}});
          tone(o,{at:.07,dur:.24,f:N.E6,gain:.24,env:{a:.003,r:.21}});
          tone(o,{at:.07,dur:.26,f:N.G6,gain:.12,env:{a:.004,r:.23}}); return o; },
  // kéo món đang chồng lấn: báo không đặt được
  nope() { const o = buf(.22);
           tone(o,{dur:.2,f:p=>200-60*p,gain:.3,wave:'tri',vib:.09,vibHz:26,env:{a:.004,r:.15}});
           tone(o,{dur:.2,f:p=>100-30*p,gain:.14,wave:'tri',env:{a:.004,r:.15}}); return o; },
  // món bị đẩy bật ra khỏi túi
  eject() { const o = buf(.36); tone(o,{dur:.3,f:p=>520-360*p,gain:.26,wave:'saw',env:{a:.004,r:.26}});
            noise(o,{dur:.3,gain:.22,lp:p=>.45-.35*p,env:{a:.003,r:.27}}); return o; },
  // booster lắc túi
  jiggle() { const o = buf(.55);
             for (let i=0;i<9;i++) noise(o,{at:i*.055,dur:.06,gain:.2,lp:.6,env:{a:.002,r:.05}});
             tone(o,{dur:.5,f:p=>150+40*Math.sin(p*38),gain:.12,wave:'tri',env:{a:.01,r:.4}}); return o; },
  // booster thu nhỏ
  shrink() { const o = buf(.34); tone(o,{dur:.3,f:p=>1100*Math.pow(.28,p),gain:.3,wave:'tri',env:{a:.004,r:.26}});
             tone(o,{at:.26,dur:.08,f:N.C5,gain:.16,env:{a:.003,r:.07}}); return o; },
  // booster bỏ món đi
  trash() { const o = buf(.38); noise(o,{dur:.24,gain:.26,lp:p=>.6-.5*p,env:{a:.004,r:.2}});
            tone(o,{at:.18,dur:.18,f:p=>180-70*p,gain:.28,wave:'tri',env:{a:.003,r:.15}}); return o; },
  // mở được hộp bí ẩn
  unlock() { const o = buf(.6); const ns=[N.C5,N.E5,N.G5,N.C6];
             ns.forEach((f,i)=>tone(o,{at:i*.075,dur:.32,f,gain:.22,env:{a:.004,r:.28}}));
             noise(o,{at:.3,dur:.25,gain:.07,lp:.85,env:{a:.02,r:.22}}); return o; },
  // đồng hồ đếm 10 giây cuối
  tick() { const o = buf(.07); tone(o,{dur:.05,f:1500,gain:.3,wave:'sine',env:{a:.001,r:.04,curve:3}}); return o; },
  // chuyển màn hình
  whoosh() { const o = buf(.4); noise(o,{dur:.36,gain:.3,lp:p=>.08+.6*Math.sin(Math.PI*p),env:{a:.05,r:.22,curve:1.6}}); return o; },
  // mỗi ngôi sao nảy ra ở màn thắng
  star() { const o = buf(.3); tone(o,{dur:.26,f:p=>1300+700*p,gain:.26,env:{a:.003,r:.22}});
           tone(o,{at:.02,dur:.22,f:p=>1950+900*p,gain:.1,env:{a:.004,r:.19}}); return o; },
  // thắng level
  win() { const o = buf(1.5); const ns=[N.C5,N.E5,N.G5,N.C6,N.E6];
          ns.forEach((f,i)=>{ tone(o,{at:i*.11,dur:.7,f,gain:.2,wave:'tri',env:{a:.006,r:.6}});
                              tone(o,{at:i*.11,dur:.5,f:f*2,gain:.07,env:{a:.006,r:.45}}); });
          tone(o,{at:.55,dur:.9,f:N.G5,gain:.13,env:{a:.02,r:.8}});
          tone(o,{at:.55,dur:.9,f:N.C6,gain:.13,env:{a:.02,r:.8}});
          noise(o,{at:.5,dur:.7,gain:.05,lp:.9,env:{a:.08,r:.6}}); return o; },
  // hết giờ
  lose() { const o = buf(1.1); [[N.G4,0],[N.E4,.18],[N.C4,.36]].forEach(([f,at])=>
             tone(o,{at,dur:.7,f,gain:.24,wave:'tri',env:{a:.008,r:.6}}));
           tone(o,{at:.36,dur:.72,f:N.A3,gain:.16,wave:'sine',env:{a:.01,r:.62}}); return o; },
  // ---- tiếng chạm theo chất liệu (rules.js chọn theo meta.material) ----
  // thuỷ tinh, sứ: lanh canh, cao, tắt nhanh
  glass() { const o = buf(.26);
            tone(o,{dur:.22,f:p=>2650-120*p,gain:.3,env:{a:.001,r:.19,curve:3}});
            tone(o,{dur:.14,f:3950,gain:.12,env:{a:.001,r:.12,curve:3}});
            tone(o,{dur:.17,f:1720,gain:.1,env:{a:.001,r:.14}});
            noise(o,{dur:.012,gain:.09,lp:.9,env:{a:.001,r:.01}}); return o; },
  // kim loại: keng, các hoạ âm lệch nhau, ngân lâu hơn
  metal() { const o = buf(.5);
            [[760,.3,.42],[1180,.18,.36],[2010,.12,.3],[2900,.07,.22]].forEach(([f,g,r])=>tone(o,{dur:r+.04,f,gain:g,env:{a:.001,r,curve:2.4}}));
            noise(o,{dur:.02,gain:.12,lp:.8,env:{a:.001,r:.018}}); return o; },
  // giấy, bìa: sột soạt, không có nốt
  paper() { const o = buf(.22);
            noise(o,{dur:.07,gain:.26,lp:.7,env:{a:.002,r:.06}});
            noise(o,{at:.05,dur:.12,gain:.16,lp:.45,env:{a:.004,r:.1}}); return o; },
  // đồ dễ vỡ bị nứt: tách khô, ngắn
  crack() { const o = buf(.2);
            noise(o,{dur:.03,gain:.38,lp:.85,env:{a:.001,r:.028,curve:3}});
            tone(o,{dur:.12,f:p=>1400-800*p,gain:.2,wave:'tri',env:{a:.001,r:.1,curve:3}});
            noise(o,{at:.06,dur:.02,gain:.22,lp:.8,env:{a:.001,r:.018}}); return o; },
  // vỡ tan: loảng xoảng
  break() { const o = buf(.65);
            noise(o,{dur:.38,gain:.3,lp:p=>.9-.5*p,env:{a:.002,r:.3}});
            [2100,2700,3300,3900,4400,2400].forEach((f,i)=>tone(o,{at:.02+i*.045,dur:.3,f:f*(1-.03*i),gain:.11,env:{a:.001,r:.26,curve:3}}));
            tone(o,{dur:.2,f:p=>300-180*p,gain:.2,wave:'tri',env:{a:.002,r:.16}}); return o; },
  // mở khoá level mới trên bản đồ
  unlockLv() { const o = buf(.5); [N.G5,N.B5,N.D6].forEach((f,i)=>
                 tone(o,{at:i*.06,dur:.34,f,gain:.22,env:{a:.004,r:.3}})); return o; },
};

// ---------- nhạc nền: vòng lặp 8 nhịp, êm, để mở nhỏ ----------
function music() {
  const bpm = 84, beat = 60 / bpm, bars = 4, dur = bars * 4 * beat;
  const o = buf(dur);
  const prog = [[N.C3,[N.C5,N.E5,N.G5]], [N.A2,[N.C5,N.E5,N.A5]], [N.F3,[N.C5,N.F5,N.A5]], [N.G3,[N.B4||N.B4,N.D5,N.G5]]];
  prog.forEach(([bass, chord], bi) => {
    const t0 = bi * 4 * beat;
    tone(o, { at:t0, dur: 4*beat*.95, f:bass, gain:.13, wave:'tri', env:{a:.04,r:1.2} });
    // rải hợp âm nhẹ nhàng, mỗi nốt một phách
    chord.forEach((f, i) => {
      tone(o, { at:t0 + i*beat, dur: beat*2.6, f, gain:.085, wave:'sine', env:{a:.02,r:beat*2.2} });
      tone(o, { at:t0 + i*beat, dur: beat*1.4, f:f*2, gain:.022, wave:'sine', env:{a:.02,r:beat*1.2} });
    });
    tone(o, { at:t0 + 3*beat, dur: beat*1.6, f:chord[1]*2, gain:.05, wave:'sine', env:{a:.02,r:beat*1.4} });
  });
  // nối đuôi về đầu cho vòng lặp liền mạch
  const fade = Math.round(.12 * SR);
  for (let i = 0; i < fade; i++) { const k = i / fade; o[i] *= k; o[o.length-1-i] *= k; }
  return o;
}

mkdirSync(OUT, { recursive: true });
// Truyền tên tiếng để chỉ sinh lại đúng những tiếng đó (noise dùng Math.random nên sinh lại cả
// bộ là mọi file đổi theo). Không truyền gì thì sinh cả bộ kèm bgm.
const CHON = process.argv.slice(2);
let total = 0;
for (const [name, make] of Object.entries(SOUNDS)) {
  if (CHON.length && !CHON.includes(name)) continue;
  const data = wav(make());
  writeFileSync(resolve(OUT, name + '.wav'), data);
  total += data.length;
  console.log(String(name).padEnd(10), (data.length / 1024).toFixed(1).padStart(7) + ' KB');
}
if (!CHON.length) {
  const m = wav(music(), .8);
  writeFileSync(resolve(OUT, 'bgm.wav'), m);
  total += m.length;
  console.log('bgm'.padEnd(10), (m.length / 1024).toFixed(1).padStart(7) + ' KB');
}
console.log('—'.repeat(20));
console.log('tổng'.padEnd(10), (total / 1024).toFixed(1).padStart(7) + ' KB ·', Object.keys(SOUNDS).length + 1, 'file');
