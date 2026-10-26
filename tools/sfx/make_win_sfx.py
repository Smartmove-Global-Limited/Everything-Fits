# Win celebration sounds (doc §5), made here so they can be tuned and remade:
#   star_ting_1..3.wav  clear, short "ting" for each star won, pitch rising a little per star
#   fireworks.wav       soft "pop" then a shower of sparkling crackles, ~1 s, no bang, no deep bass
#   win_confirm.wav     soft two-note "done" when the bag has settled, before the popup
# Output: assets/resources/audio. Run: python3 tools/sfx/make_win_sfx.py
import math, os, random, struct, wave

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'resources', 'audio')

def save(name, samples, peak=0.6):
    m = max(1e-9, max(abs(s) for s in samples))
    k = peak / m
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s * k)) * 32767)) for s in samples))

def ting(f0, dur=0.42):
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        attack = min(1.0, t / 0.003)
        # bell partials: the fundamental rings longest, the bright ones fade fast
        s = (math.sin(2 * math.pi * f0 * t) * math.exp(-t * 7)
             + 0.35 * math.sin(2 * math.pi * f0 * 2.0 * t) * math.exp(-t * 12)
             + 0.12 * math.sin(2 * math.pi * f0 * 3.01 * t) * math.exp(-t * 22))
        out.append(attack * s)
    return out

def fireworks(dur=1.1):
    # a soft "pop" (round knock, no bang, no deep bass) and a light, airy whoosh, then a shower of
    # tiny bright sparkles crackling and fading out, like a small sparkler
    random.seed(11)
    n = int(RATE * dur)
    out = [0.0] * n
    prev = lp = 0.0
    for i in range(n):
        t = i / RATE
        f = 260 + 220 * math.exp(-t * 35)                   # 480 -> 260 Hz slide
        pop = math.sin(2 * math.pi * f * t) * math.exp(-t * 38) * min(1.0, t / 0.003)
        noise = random.uniform(-1, 1)
        hp = noise - prev; prev = noise
        lp += (hp - lp) * 0.35
        whoosh = lp * math.exp(-t * 14) * min(1.0, t / 0.01) * 0.5
        out[i] = 0.85 * pop + whoosh
    # sparkles: short bright "tik" grains, dense at first, thinning out
    for k in range(90):
        t0 = 0.06 + (random.random() ** 1.8) * (dur - 0.25)
        f0 = random.uniform(2400, 6200)
        amp = random.uniform(0.12, 0.32) * math.exp(-(t0 - 0.06) * 2.2)
        length = random.uniform(0.012, 0.035)
        s0 = int(t0 * RATE)
        for j in range(int(length * RATE)):
            if s0 + j >= n: break
            u = j / RATE
            out[s0 + j] += amp * math.sin(2 * math.pi * f0 * u) * math.exp(-u / (length / 4)) * min(1.0, u / 0.0008)
    # soft glittery hiss under the sparkles
    prev = 0.0
    for i in range(n):
        t = i / RATE
        noise = random.uniform(-1, 1); hp = noise - prev; prev = noise
        out[i] += hp * 0.05 * min(1.0, max(0.0, (t - 0.05) / 0.05)) * math.exp(-max(0.0, t - 0.1) * 3.2)
    tail = int(RATE * 0.1)
    for j in range(tail): out[-1 - j] *= j / tail
    return out

def confirm(dur=0.6):
    # two soft, round notes (G5 then C6), sine with a gentle attack: a calm "done"
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        s = 0.0
        for f, at in ((784.0, 0.0), (1046.5, 0.11)):
            u = t - at
            if u < 0: continue
            env = min(1.0, u / 0.012) * math.exp(-u * 6.5)
            s += env * (math.sin(2 * math.pi * f * u) + 0.15 * math.sin(2 * math.pi * f * 2 * u))
        out.append(s)
    return out

if __name__ == '__main__':
    # E6, G#6, B6: a bright major triad, one step up per star
    for i, f in enumerate([1318.5, 1661.2, 1975.5], start=1):
        save(f'star_ting_{i}.wav', ting(f), peak=0.8)
    save('fireworks.wav', fireworks(), peak=0.75)
    save('win_confirm.wav', confirm(), peak=0.8)
    print('ok')
