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

// ---- IAP funnel (the team's tracking sheet, IAP): iap_show → iap_click → iap_purchase ----
//   placement         where the packs were on screen: shop (Shop tab) · shop_gold (Shop from the
//                     gold "+") · booster_popup (gameplay, a booster with none left)
//   type              the pack, from its store id: remove_ads, remove_ads_bundle, small_bundle, gold_500…;
//                     iap_show on the Shop: "shop" (one event for the whole list, asked)
//   iap_index         the n-th time this player saw / clicked / bought it (1 = the first)
const IAP_KEY = 'ef.iap.events.v1';
type IapSaved = { show: Record<string, number>; click: Record<string, number>; buy: Record<string, number>; placement: Record<string, string> };
const iap: IapSaved = { show: {}, click: {}, buy: {}, placement: {}, ...LocalStore.json<Partial<IapSaved>>(IAP_KEY, {}) };
const iapType = (id: string) => id.replace(/^fit\./, '').replace(/\./g, '_');
const iapCount = (k: 'show' | 'click' | 'buy', id: string) => { iap[k][id] = (iap[k][id] || 0) + 1; return iap[k][id]; };

export const Analytics = {
  /**
   * A store purchase was granted (once per transaction): GA4's recommended purchase event, which GA4
   * books as purchase revenue. value / currency = what Play charged; transaction_id = Play's order id.
   * SdkBridge turns the item fields into GA4's items list for Firebase, and sends the purchase to
   * AppsFlyer as af_purchase (af_revenue / af_currency), the only event AppsFlyer books it from.
   */
  purchase(p: Product, value: number, currency: string, source: string, transactionId: string) {
    send('purchase', {
      transaction_id: transactionId, value, currency,
      item_id: p.id, item_name: p.name, item_category: productKind(p), quantity: 1, source,
    });
    // the funnel's last step, at the place the pack was last clicked (a pending one granted later too)
    send('iap_purchase', {
      placement: iap.placement[p.id] || source, type: iapType(p.id), price: value, currency,
      iap_index: iapCount('buy', p.id),
    });
    LocalStore.setJson(IAP_KEY, iap);
  },

  /** Store packs came on screen at `placement`: one event, `type` = the pack's store id or "shop" (the whole list) */
  iapShow(placement: string, type: string) {
    const t = type === 'shop' ? type : iapType(type);
    send('iap_show', { placement, type: t, iap_index: iapCount('show', t) });
    LocalStore.setJson(IAP_KEY, iap);
  },
  /** The buy button of a store pack was tapped */
  iapClick(placement: string, id: string) {
    iap.placement[id] = placement;
    send('iap_click', { placement, type: iapType(id), iap_index: iapCount('click', id) });
    LocalStore.setJson(IAP_KEY, iap);
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
