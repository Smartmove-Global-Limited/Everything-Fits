// Sound effects, music and vibration (web src/ui/sfx.js). One persistent node carries two
// AudioSources: one for the looping music, one for one-shot effects. Clips load once from
// resources/audio and stay cached. Settings (BGM / SFX / Vibration) are saved like the web
// (key snug.audio.v2), all ON for a new player.
import { Node, AudioSource, AudioClip, director, resources, sys, Tween, tween } from 'cc';
import { LocalStore } from '../services/LocalStore';

export type SfxName = 'tap' | 'tapBig' | 'pick' | 'drop' | 'land' | 'fit' | 'nope' | 'eject' | 'jiggle' | 'shrink' | 'trash'
  | 'unlock' | 'tick' | 'whoosh' | 'star' | 'win' | 'lose' | 'unlockLv' | 'glass' | 'metal' | 'paper' | 'crack' | 'break';

/** Sounds made by the sound designer (m4a), everything else is <name>.wav */
const FILE: Record<string, string> = {
  bgm: 'bgm', tap: 'button_pressed', tapBig: 'button_pressed', star: 'star_get', win: 'level_complete', lose: 'lose',
};
const MUSIC_VOLUME = .32, MUSIC_DUCKED = .1, SFX_VOLUME = .85;
const KEY = 'snug.audio.v2';
const prefs = LocalStore.json(KEY, { sfx: true, music: true, vib: true });

let node: Node | null = null;
let music: AudioSource = null!, fx: AudioSource = null!;
const clips = new Map<string, AudioClip | null>();
let musicWanted = false;
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
}

function clip(name: string): Promise<AudioClip | null> {
  if (clips.has(name)) return Promise.resolve(clips.get(name)!);
  return new Promise(ok => resources.load(`audio/${FILE[name] || name}`, AudioClip, (err, c) => { clips.set(name, err ? null : c); ok(err ? null : c); }));
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
  preload() { for (const n of Object.keys(FILE).concat(['pick', 'drop', 'fit', 'nope', 'eject', 'tick', 'unlockLv', 'trash', 'shrink'])) clip(n); },

  play(name: SfxName, { gain = 1, delay = 0 } = {}) {
    if (!prefs.sfx) return;
    ensure();
    clip(name).then(c => {
      if (!c || !prefs.sfx) return;
      if (delay > 0) setTimeout(() => fx.playOneShot(c, gain * SFX_VOLUME), delay * 1000);
      else fx.playOneShot(c, gain * SFX_VOLUME);
    });
  },

  async startMusic() {
    musicWanted = true;
    if (!prefs.music) return;
    ensure();
    if (music.playing) return;
    const c = await clip('bgm');
    if (!c || !musicWanted || !prefs.music || music.playing) return;
    music.clip = c; volume.v = 0; music.volume = 0; music.play();
    fadeMusic(MUSIC_VOLUME, 1.2);
  },
  stopMusic() { musicWanted = false; if (music) music.stop(); },
  /** Lower the music under popups (pause, win, lose) */
  duckMusic(on: boolean) { if (music && music.playing) fadeMusic(on ? MUSIC_DUCKED : MUSIC_VOLUME, .3); },

  setSfx(on: boolean) { prefs.sfx = on; LocalStore.setJson(KEY, prefs); if (on) this.play('tap'); },
  setMusic(on: boolean) { prefs.music = on; LocalStore.setJson(KEY, prefs); on ? this.startMusic() : this.stopMusic(); musicWanted = on || musicWanted; },
  setVibration(on: boolean) { prefs.vib = on; LocalStore.setJson(KEY, prefs); },

  vibrate(ms = 30) {
    if (prefs.vib === false) return;
    try {
      if (sys.isNative) (globalThis as any).jsb?.Device?.vibrate?.(ms / 1000);
      else (globalThis as any).navigator?.vibrate?.(ms);
    } catch { /* not supported */ }
  },
};
