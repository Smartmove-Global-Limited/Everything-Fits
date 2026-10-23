// Ads (monetization doc): AppLovin MAX banner / interstitial / rewarded, with every rule here.
// Native Android with an AppLovin key: real MAX ads (AdsBridge.java). Anywhere else (web, preview,
// Android build without applovin.properties): the simulated "TEST AD" screens of Overlays and a
// "TEST BANNER" strip, so the flows can be played before the keys exist.
//
// Banner      Home / Shop at the bottom edge (banner_main_menu, banner_shop); in the Game scene only
//             while a result popup covers the field (banner_gameplay), never during play.
//             active_banner, banner_start_level. Bars pinned to the bottom move up above it.
// Interstitial level_win (Continue after a win), level_lose (Try again after a loss). Checked in
//             this order: active_inter → max_inter_per_session → min_inter_interval_sec →
//             min_between_reward_inter_sec → level pacing (inter_pacing_config). A skipped trigger
//             is not made up later. Never during a tutorial.
// Rewarded    only when the player chooses it; the reward only when watched to the end.
// No Ads      bought: no banner, no interstitial; rewarded still offered.
import { RemoteConfig, InterPacing } from './RemoteConfig';
import { Purchases } from './Purchases';
import { NativeBridge } from './NativeBridge';

export type BannerPlacement = 'banner_main_menu' | 'banner_shop' | 'banner_gameplay';
export type InterPlacement = 'level_win' | 'level_lose';
export type RewardedPlacement = 'add_60s' | 'refill_energy' | 'collect_x2' | 'free_gold';

/** The visible part of ads, provided by the UI layer (Overlays): simulated screens and banner strip */
export type AdViews = {
  /** simulated full-screen ad; resolves true when watched to the end */
  simulateFullScreen(kind: 'rewarded' | 'interstitial', placement: string): Promise<boolean>;
  /** simulated banner strip at the bottom edge (null = hide) */
  simulateBanner(placement: BannerPlacement | null): void;
  /** height of the bottom banner in device pixels (0 = none), to lift bottom bars */
  setBannerInset(px: number, screenPx: number): void;
};

let views: AdViews | null = null;
let started = false;
let mode: 'pending' | 'max' | 'sim' = 'sim';
let rewardedLoaded = false;
let interLoaded = false;
let pending: { kind: 'rewarded' | 'inter'; done: (shown: boolean, rewarded: boolean) => void } | null = null;
let bannerPlacement: BannerPlacement | null = null;

// session counters (a session = one app launch)
let interShown = 0;
let lastInterAt = -Infinity;
let lastRewardedAt = -Infinity;
let tutorial = false;

const now = () => Date.now() / 1000;

/** Is this level a pacing slot? Bands use their own pacing; the grid starts at the first band. */
export function pacingAllows(level: number, cfg: InterPacing) {
  if (!cfg || !Array.isArray(cfg.bands) || !cfg.bands.length || level < (cfg.start_level || 0)) return false;
  const bands = cfg.bands.slice().sort((a, b) => a.from - b.from);
  let band = bands.find(b => level >= b.from && level <= b.to);
  const last = bands[bands.length - 1];
  if (!band && level > last.to && cfg.after_last_band === 'hold_last') band = last;
  if (!band) return false;
  // pacing list: gaps between slots, the last one repeating
  const gaps = (band.pacing || []).filter(n => n > 0);
  if (!gaps.length) return false;
  let slot = bands[0].from, i = 0;
  while (slot < level) slot += gaps[Math.min(i++, gaps.length - 1)];
  return slot === level;
}

function onNative(msg: any) {
  if (msg.type === 'ready') {
    mode = msg.mode === 'max' ? 'max' : 'sim';
    if (bannerPlacement) Ads.showBanner(bannerPlacement, Infinity);
  } else if (msg.type === 'rewarded') {
    if (msg.state === 'loaded') rewardedLoaded = true;
    else if (msg.state === 'closed' || msg.state === 'showFailed') {
      rewardedLoaded = false;
      if (pending?.kind === 'rewarded') { const p = pending; pending = null; p.done(msg.state === 'closed', !!msg.rewarded); }
    }
  } else if (msg.type === 'inter') {
    if (msg.state === 'loaded') interLoaded = true;
    else if (msg.state === 'closed' || msg.state === 'showFailed') {
      interLoaded = false;
      if (pending?.kind === 'inter') { const p = pending; pending = null; p.done(msg.state === 'closed', false); }
    }
  } else if (msg.type === 'banner') {
    if (msg.state === 'shown') views?.setBannerInset(msg.heightPx | 0, msg.screenPx | 0);   // banner only: the system bar is in the safe-area inset already
    else if (msg.state === 'hidden') views?.setBannerInset(0, 1);
  }
}

export const Ads = {
  /** Once at launch (idempotent); the UI layer gives the simulated views */
  start(v: AdViews) {
    views = v;
    if (started) return;
    started = true;
    RemoteConfig.start();
    if (NativeBridge.android) {
      mode = 'pending';
      NativeBridge.on('ads', onNative);
      NativeBridge.call('adsHello');
    }
  },
  get simulated() { return mode !== 'max'; },
  /** A tutorial is on screen: no interstitial */
  set tutorial(on: boolean) { tutorial = on; },

  // ---------- banner ----------
  showBanner(placement: BannerPlacement, levelNumber: number) {
    const rc = RemoteConfig.values;
    if (!rc.active_banner || Purchases.noAds || levelNumber < rc.banner_start_level) { this.hideBanner(); return; }
    bannerPlacement = placement;
    if (mode === 'max') NativeBridge.call('adsShowBanner', placement);
    else if (mode === 'sim') views?.simulateBanner(placement);
  },
  hideBanner() {
    if (!bannerPlacement) return;
    bannerPlacement = null;
    if (mode === 'max') NativeBridge.call('adsHideBanner');
    else views?.simulateBanner(null);
  },

  // ---------- interstitial ----------
  /** Why the trigger shows nothing (null = it may show), in the doc's order */
  interBlock(levelNumber: number): string | null {
    const rc = RemoteConfig.values, t = now();
    if (Purchases.noAds) return 'no_ads';
    if (tutorial) return 'tutorial';
    if (!rc.active_inter) return 'inactive';
    if (interShown >= rc.max_inter_per_session) return 'session_cap';
    if (t - lastInterAt < rc.min_inter_interval_sec) return 'inter_interval';
    if (t - lastRewardedAt < rc.min_between_reward_inter_sec) return 'reward_interval';
    if (!pacingAllows(levelNumber, rc.inter_pacing_config)) return 'pacing';
    return null;
  },
  /** At a trigger: shows the interstitial when every rule passes; resolves when it is gone */
  async interstitial(placement: InterPlacement, levelNumber: number): Promise<boolean> {
    const block = this.interBlock(levelNumber);
    if (block) { console.log(`[Ads] ${placement} lv${levelNumber} skipped: ${block}`); return false; }
    if (pending) return false;
    let shown = false;
    if (mode === 'max') {
      if (!interLoaded) { console.log(`[Ads] ${placement} skipped: not loaded`); return false; }
      shown = await new Promise<boolean>(done => { pending = { kind: 'inter', done: s => done(s) }; NativeBridge.call('adsShowInter', placement); });
    } else if (views) {
      await views.simulateFullScreen('interstitial', placement);
      shown = true;
    }
    if (shown) { interShown++; lastInterAt = now(); }
    return shown;
  },

  // ---------- rewarded ----------
  /** A rewarded ad can be shown now (the button says "Ad unavailable" otherwise) */
  rewardedAvailable() { return mode === 'max' ? rewardedLoaded : mode === 'sim'; },
  /** Player chose to watch: true only when watched to the end (then grant the reward) */
  async rewarded(placement: RewardedPlacement): Promise<boolean> {
    if (pending || !this.rewardedAvailable()) return false;
    let shown = false, full = false;
    if (mode === 'max') {
      [shown, full] = await new Promise<[boolean, boolean]>(done => {
        pending = { kind: 'rewarded', done: (s, r) => done([s, r]) };
        NativeBridge.call('adsShowRewarded', placement);
      });
    } else if (views) {
      full = await views.simulateFullScreen('rewarded', placement);
      shown = true;
    }
    if (shown) { lastRewardedAt = now(); }
    return full;
  },
};
