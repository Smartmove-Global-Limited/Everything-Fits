// Ads (monetization doc): AppLovin MAX banner / interstitial / rewarded, with every rule here.
// Native Android with an AppLovin key: real MAX ads (AdsBridge.java). Anywhere else (web, preview,
// Android build without applovin.properties): the simulated "TEST AD" screens of Overlays and a
// "TEST BANNER" strip, so the flows can be played before the keys exist.
//
// Banner      Home / Shop at the bottom edge (banner_main_menu, banner_shop); in the Game scene only
//             while a result popup covers the field (banner_gameplay), never during play.
//             active_banner, banner_start_level. Bars pinned to the bottom move up above its slot,
//             kept from the splash on (Home does not jump); a black "AD" strip until the ad loads.
// Interstitial level_win (Continue after a win), level_lose (Try again after a loss). Checked in
//             this order: active_inter → max_inter_per_session → min_inter_interval_sec →
//             min_between_reward_inter_sec → level pacing (inter_pacing_config). A skipped trigger
//             is not made up later. Never during a tutorial.
// Rewarded    only when the player chooses it; the reward only when watched to the end.
// No Ads      bought: no banner, no interstitial; rewarded still offered.
import { RemoteConfig, InterPacing, StartResult, withTimeout } from './RemoteConfig';
import { Purchases } from './Purchases';
import { NativeBridge } from './NativeBridge';

export type BannerPlacement = 'banner_main_menu' | 'banner_shop' | 'banner_gameplay';
export type InterPlacement = 'level_win' | 'level_lose';
export type RewardedPlacement = 'add_60s' | 'refill_energy' | 'collect_x2' | 'free_gold';

/** Where the bottom banner goes: its height and the system bar under it, in device pixels */
export type BannerMetrics = { bannerPx: number; systemPx: number; screenPx: number };
/** The bottom banner slot: the bars stay above it; a strip shows there until the ad covers it */
export type BannerSlot = { placement: BannerPlacement; simulated: boolean; metrics: BannerMetrics | null };

/** The visible part of ads, provided by the UI layer (Overlays): simulated screens and banner slot */
export type AdViews = {
  /** simulated full-screen ad; resolves true when watched to the end */
  simulateFullScreen(kind: 'rewarded' | 'interstitial', placement: string): Promise<boolean>;
  /**
   * the banner slot at the bottom (null = none): bottom bars move above it; it shows "TEST BANNER"
   * (simulated) or a black "AD" strip the real banner covers once loaded
   */
  bannerSlot(slot: BannerSlot | null): void;
  /** resolves once no loading screen covers the game (the native banner draws above everything) */
  whenClear(): Promise<void>;
};

let views: AdViews | null = null;
let started: Promise<StartResult> | null = null;
let onReady: ((r: StartResult) => void) | null = null;
const INIT_TIMEOUT_MS = 6000;
/** disabled: adsOff in applovin.properties (testing), no banner / interstitial, rewarded simulated */
let mode: 'pending' | 'max' | 'sim' | 'disabled' = 'sim';
let rewardedLoaded = false;
let interLoaded = false;
let pending: { kind: 'rewarded' | 'inter'; done: (shown: boolean, rewarded: boolean) => void } | null = null;
let bannerPlacement: BannerPlacement | null = null;   // the slot is on screen
let bannerLive = false;                                 // the native banner is asked to show
let metrics: BannerMetrics | null = null;

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
    if (msg.mode === 'pending') return;                  // the SDK is still initialising: it reports again
    mode = msg.mode === 'max' ? 'max' : msg.mode === 'disabled' ? 'disabled' : 'sim';
    if (msg.bannerPx > 0 && msg.screenPx > 0) metrics = { bannerPx: msg.bannerPx, systemPx: msg.systemPx | 0, screenPx: msg.screenPx };
    onReady?.(mode === 'max' ? 'ok' : 'off'); onReady = null;
    if (bannerPlacement && bannerLive) Ads.showBanner(bannerPlacement, Infinity);
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
  }
}

export const Ads = {
  /**
   * Once at launch (splash, alongside Remote Config; idempotent); the UI layer gives the simulated
   * views. Resolves when the ad SDK is ready ('ok'), has no key ('off': simulated ads) or timed out.
   */
  start(v: AdViews): Promise<StartResult> {
    views = v;
    if (started) return started;
    if (!NativeBridge.android) return (started = Promise.resolve('web'));
    mode = 'pending';
    const ready = new Promise<StartResult>(done => (onReady = done));
    NativeBridge.on('ads', onNative);
    NativeBridge.call('adsHello');
    return (started = withTimeout(ready, INIT_TIMEOUT_MS, 'timeout'));
  },
  get simulated() { return mode !== 'max'; },
  /** A tutorial is on screen: no interstitial */
  set tutorial(on: boolean) { tutorial = on; },

  // ---------- banner ----------
  /** The bottom banner may show on this screen (Remote Config, No Ads, banner_start_level) */
  bannerAllowed(levelNumber: number) {
    const rc = RemoteConfig.values;
    return mode !== 'disabled' && rc.active_banner && !Purchases.noAds && levelNumber >= rc.banner_start_level;
  },
  /**
   * Keep the banner's place only (the bars move above it, a strip shows there), no ad yet: Home
   * behind the splash, so nothing jumps when the splash goes. Returns false when no banner here.
   */
  reserveBanner(placement: BannerPlacement, levelNumber: number) {
    if (!this.bannerAllowed(levelNumber)) { this.hideBanner(); return false; }
    if (bannerPlacement !== placement) views?.bannerSlot({ placement, simulated: mode === 'sim', metrics });
    bannerPlacement = placement;
    return true;
  },
  showBanner(placement: BannerPlacement, levelNumber: number) {
    if (!this.reserveBanner(placement, levelNumber)) return;
    bannerLive = true;
    // the real banner is a native view above the game: only once the loading screen is gone
    if (mode === 'max') (views?.whenClear() ?? Promise.resolve()).then(() => {
      if (bannerLive && bannerPlacement === placement) NativeBridge.call('adsShowBanner', placement);
    });
  },
  hideBanner() {
    const had = bannerPlacement;
    bannerPlacement = null; bannerLive = false;
    views?.bannerSlot(null);                 // always: no reserved place may stay behind
    if (had && mode === 'max') NativeBridge.call('adsHideBanner');
  },

  // ---------- interstitial ----------
  /** Why the trigger shows nothing (null = it may show), in the doc's order */
  interBlock(levelNumber: number): string | null {
    const rc = RemoteConfig.values, t = now();
    if (mode === 'disabled') return 'ads_off';
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
  rewardedAvailable() { return mode === 'max' ? rewardedLoaded : mode === 'sim' || mode === 'disabled'; },
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
