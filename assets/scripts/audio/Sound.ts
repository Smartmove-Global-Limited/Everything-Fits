// Sound effects, music and vibration (web src/ui/sfx.js). One persistent node carries two
// AudioSources: one for the looping music, one for one-shot effects. Clips load once from
// resources/audio and stay cached. Settings (BGM / SFX / Vibration) are saved like the web
// (key snug.audio.v2), all ON for a new player.
import { Node, AudioSource, AudioClip, director, resources, Tween, tween } from 'cc';
import { LocalStore } from '../services/LocalStore';
import { NativeBridge } from '../services/NativeBridge';

export type SfxName = 'tap' | 'tapBig' | 'pick' | 'drop' | 'fall' | 'fit' | 'nope' | 'misplace' | 'booster' | 'jiggle'
  | 'tick' | 'clockTick' | 'whoosh' | 'win' | 'lose' | 'unlockLv' | 'purchase' | 'menuOpen' | 'menuClose'
  | 'glass' | 'metal' | 'paper' | 'crack' | 'break' | 'fireworks' | 'starShine';

/** File in resources/audio for each sound (the name itself when not listed) */
const FILE: Record<string, string> = {
  bgm: 'bgm',
  // the sound designer's set (2026-10-28): buttons, menus, items, boosters, clock, win / lose, purchase
  tap: 'button_tap', tapBig: 'button_tap', menuOpen: 'menu_open', menuClose: 'menu_close',
  pick: 'item_pick', drop: 'item_release', fall: 'item_fall', misplace: 'item_misplaced',
  booster: 'booster_use', clockTick: 'clock_tick', win: 'level_success', lose: 'level_fail', purchase: 'purchase',
  // recorded sounds the user picked (2026-10-27): star sparkle, bag shake
  starShine: 'success_01', jiggle: 'shake_bag',
  // fireworks on the win popup: one 6 s clip of ten shots, played once (2026-10-27)
  fireworks: 'fireworks_shoot',
};
// effects at full volume, the music lower under them (on phones the taps were hard to hear)
const MUSIC_VOLUME = .22, MUSIC_DUCKED = .07, SFX_VOLUME = 1;
const KEY = 'snug.audio.v2';
const prefs = LocalStore.json(KEY, { sfx: true, music: true, vib: true });

let node: Node | null = null;
let music: AudioSource = null!, fx: AudioSource = null!, long: AudioSource = null!;
const clips = new Map<string, AudioClip | null>();
let musicWanted = false;
let muted = false;          // Level Editor preview: silent unless "Bật tiếng khi xem thử" is on
const volume = { v: 0 };

function ensure() {
  if (node && node.isValid) return;
  node = new Node('Sound');
  director.getScene()!.addChild(node);
  director.addPersistRootNode(node);
  music = node.addComponent(AudioSource);
  music.loop = true; music.playOnAwake = false; music.volume = 0;
  fx = node.addComponent(AudioSource);
  fx.playOnAwake = false;
  long = node.addComponent(AudioSource);   // one longer effect that can be stopped (playLong)
  long.playOnAwake = false; long.loop = false;
}

function clip(name: string): Promise<AudioClip | null> {
  if (clips.has(name)) return Promise.resolve(clips.get(name)!);
  return new Promise(ok => resources.load(`audio/${FILE[name] || name}`, AudioClip, (err, c) => {
    if (err) console.warn('[Sound] cannot load', name, err?.message || err);
    clips.set(name, err ? null : c); ok(err ? null : c);
  }));
}

function fadeMusic(to: number, seconds: number) {
  Tween.stopAllByTarget(volume);
  tween(volume).to(seconds, { v: to }, { onUpdate: () => { if (music) music.volume = volume.v; } }).start();
}

export const Sound = {
  get sfxOn() { return prefs.sfx; },
  get musicOn() { return prefs.music; },
  get vibrationOn() { return prefs.vib !== false; },

  /** Preload the short sounds so the first tap is not silent */
  preload() { for (const n of Object.keys(FILE).concat(['fit', 'nope', 'tick', 'unlockLv'])) clip(n); },

  play(name: SfxName, { gain = 1, delay = 0 } = {}) {
    if (!prefs.sfx || muted) return;
    ensure();
    clip(name).then(c => {
      if (!c || !prefs.sfx) return;
      if (delay > 0) setTimeout(() => fx.playOneShot(c, gain * SFX_VOLUME), delay * 1000);
      else fx.playOneShot(c, gain * SFX_VOLUME);
    });
  },

  /** A longer effect played once that the caller may cut short (stopLong), e.g. the win fireworks */
  playLong(name: SfxName, { gain = 1 } = {}) {
    if (!prefs.sfx || muted) return;
    ensure();
    clip(name).then(c => {
      if (!c || !prefs.sfx) return;
      long.stop(); long.clip = c; long.volume = gain * SFX_VOLUME; long.play();
    });
  },
  stopLong() { if (long && long.isValid) long.stop(); },

  async startMusic() {
    musicWanted = true;
    if (!prefs.music || muted) return;
    ensure();
    if (music.playing) return;
    const c = await clip('bgm');
    if (!c || !musicWanted || !prefs.music || music.playing) return;
    music.clip = c; volume.v = 0; music.volume = 0; music.play();
    fadeMusic(MUSIC_VOLUME, 1.2);
  },
  /** Silence everything without touching the player's settings (Level Editor preview) */
  setMuted(on: boolean) { muted = on; if (on) { if (music) music.stop(); } else if (musicWanted) this.startMusic(); },
  stopMusic() { musicWanted = false; if (music) music.stop(); },
  /** Lower the music under popups (pause, win, lose) */
  duckMusic(on: boolean) { if (music && music.playing) fadeMusic(on ? MUSIC_DUCKED : MUSIC_VOLUME, .3); },

  setSfx(on: boolean) { prefs.sfx = on; LocalStore.setJson(KEY, prefs); if (on) this.play('tap'); },
  setMusic(on: boolean) { prefs.music = on; LocalStore.setJson(KEY, prefs); on ? this.startMusic() : this.stopMusic(); musicWanted = on || musicWanted; },
  setVibration(on: boolean) { prefs.vib = on; LocalStore.setJson(KEY, prefs); },

  /**
   * Light haptic of the device (doc §9): 'light' one short pulse (item placed in the bag),
   * 'double' two short pulses (item bounced out). Off with the Vibration switch.
   */
  haptic(kind: 'light' | 'double') {
    if (prefs.vib === false) return;
    try {
      if (NativeBridge.android) NativeBridge.call('haptic', kind);
      else (globalThis as any).navigator?.vibrate?.(kind === 'double' ? [25, 90, 25] : 25);
    } catch { /* not supported */ }
  },

  vibrate(ms = 30) {
    if (prefs.vib === false) return;
    try {
      if (NativeBridge.android) NativeBridge.call('haptic', String(Math.round(ms)));   // HapticsBridge: one pulse of ms
      else (globalThis as any).navigator?.vibrate?.(ms);
    } catch { /* not supported */ }
  },
};
