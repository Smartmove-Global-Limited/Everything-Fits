// Analytics events (web src/game/events.js, plan agreed with the team), sent to Firebase Analytics
// and AppsFlyer by the native apps only (web / preview: recorded in memory for checking only).
//
//   level_start   level · mode · play_type · lose_index
//   level_end     level · lose_index · booster_use · result
//
//   level        Level N counted across chapters
//   mode         difficulty tier from the level editor: Easy | Medium | Hard | Very Hard | Challenge
//                (not rated yet → Medium)
//   play_type    first_open  first launch after install
//                app_open    later launch, the previous round had ended
//                reopen      later launch, the app was closed in the middle of a round
//                next        Continue after a win
//                restart     Try again / Restart
//                home        level opened from the main menu
//   lose_index   level_start: losses of this level BEFORE this round · level_end: including it
//   booster_use  "Booster_freeze_2,Booster_resize_1,Booster_PlayOn_Ads_1", none → 0
//                PlayOn_Ads = "+60 sec" taken after the time ran out
//   result       win · lose · quit (app closed mid-round: sent at the next launch, before reopen)
import { LocalStore } from './LocalStore';
import { NativeBridge } from './NativeBridge';
import type { Product } from './Purchases';

const KEY = 'snug.events.v1';
type Saved = { opened?: boolean; losses: Record<string, number>; playing: null | { level: number; lose_index: number; booster: Record<string, number> } };
const data: Saved = (() => {
  const d = LocalStore.json<any>(KEY, {});
  // read the web save as is (daMo / thua / dangChoi) so an app update keeps the counters
  return { opened: d.opened ?? d.daMo, losses: d.losses || d.thua || {}, playing: d.playing ?? d.dangChoi ?? null };
})();
const save = () => LocalStore.setJson(KEY, data);

let sessionStarted = false;
let nextReason: 'next' | 'restart' | 'home' | null = null;
let boosters: Record<string, number> = {};
let current: { level: number; levelId: string; tier: string } | null = null;

const boosterString = (b: Record<string, number>) => {
  const list = ['freeze', 'resize', 'throw', 'PlayOn_Ads'].filter(k => b[k] > 0).map(k => `Booster_${k}_${b[k]}`);
  return list.length ? list.join(',') : '0';
};
const lossKey = (levelId: string) => `cozy:${levelId}`;

/** Events of this session, for checking in the console (web window.__suKien) */
export const sentEvents: { name: string; params: any; t: number }[] = [];

function send(name: string, params: Record<string, string | number>) {
  sentEvents.push({ name, params, t: Date.now() });
  if (sentEvents.length > 200) sentEvents.shift();
  NativeBridge.logEvent(name, params);
}

/** What a store product gives, for the purchase event's product / af_content_type */
const productKind = (p: Product) => p.noAds ? (p.boosters ? 'no_ads_bundle' : 'no_ads')
  : p.gold && p.boosters ? 'bundle' : p.gold ? 'gold' : 'booster';

export const Analytics = {
  /**
   * A store purchase was granted (once per transaction). Firebase gets purchase_success; SdkBridge
   * sends it to AppsFlyer as af_purchase (af_revenue / af_currency), the only event AppsFlyer
   * books purchase revenue from. value / currency = what Play charged.
   */
  purchase(p: Product, value: number, currency: string, source: string) {
    send('purchase_success', { product: productKind(p), product_id: p.id, value, currency, source });
  },

  /** Why the next round starts: next / restart / home */
  setReason(r: 'next' | 'restart' | 'home') { nextReason = r; },

  /** A round starts (end of the level build) */
  levelStart(level: number, levelId: string, tier: string | undefined) {
    let playType: string;
    if (!sessionStarted) {
      sessionStarted = true;
      if (!data.opened) playType = 'first_open';
      else if (data.playing) {
        // the app was closed mid-round last time: send its level_end quit first
        const p = data.playing;
        send('level_end', { level: p.level, lose_index: p.lose_index || 0, booster_use: boosterString(p.booster || {}), result: 'quit' });
        playType = 'reopen';
      } else playType = 'app_open';
      data.opened = true;
    } else playType = nextReason || 'restart';
    nextReason = null;
    boosters = {};
    current = { level, levelId, tier: tier || 'Medium' };
    const lose = data.losses[lossKey(levelId)] || 0;
    send('level_start', { level, mode: current.tier, play_type: playType, lose_index: lose });
    data.playing = { level, lose_index: lose, booster: {} };
    save();
  },

  /** One booster use in this round: freeze | resize | throw */
  boosterUsed(kind: string) {
    boosters[kind] = (boosters[kind] || 0) + 1;
    if (data.playing) { data.playing.booster = { ...boosters }; save(); }
  },

  /** Round over: win, or lose (time up / broken) */
  levelEnd(result: 'win' | 'lose') {
    if (!current) return;
    const k = lossKey(current.levelId);
    if (result === 'lose') data.losses[k] = (data.losses[k] || 0) + 1;
    send('level_end', { level: current.level, lose_index: data.losses[k] || 0, booster_use: boosterString(boosters), result });
    data.playing = null;
    save();
  },

  /** "+60 sec": no event, counts as one PlayOn_Ads booster, the round goes on */
  extraTime() {
    if (!current) return;
    boosters.PlayOn_Ads = (boosters.PlayOn_Ads || 0) + 1;
    data.playing = { level: current.level, lose_index: data.losses[lossKey(current.levelId)] || 0, booster: { ...boosters } };
    save();
  },
};
