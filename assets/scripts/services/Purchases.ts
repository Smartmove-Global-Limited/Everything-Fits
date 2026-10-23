// Real-money purchases (Google Play Billing on Android, BillingBridge.java) and the No Ads
// entitlement. The catalogue below is the IAP table; prices shown come from the store (the design
// price until the store answers). Rules:
//   - a reward is granted only for a confirmed purchase, and once per purchase token (saved);
//   - consumables are consumed after the grant, No Ads purchases acknowledged;
//   - a purchase left unfinished (app closed mid-way) is reported again at the next start and
//     granted then;
//   - Restore gives back No Ads only (non-consumables), never gold or boosters.
// Web / preview / no store: buy() simulates a confirmed purchase after a short wait.
import { LocalStore } from './LocalStore';
import { NativeBridge } from './NativeBridge';
import { Wallet } from './Wallet';
import { Boosters, BOOSTER_KEYS } from './Boosters';

export type Product = {
  id: string; option: string; name: string; price: string;
  /** non-consumable: bought once, kept for life (No Ads) */
  lifetime?: boolean; noAds?: boolean; gold?: number;
  /** of each booster (Freeze, Resize, Throw out) */
  boosters?: number;
};

export const PRODUCTS: Product[] = [
  { id: 'fit.remove.ads', option: 'fit-remove-ads', name: 'No Ads', price: '$2.99', lifetime: true, noAds: true },
  { id: 'fit.remove.ads.bundle', option: 'fit-remove-ads-bundle', name: 'No Ads Bundle', price: '$4.49', lifetime: true, noAds: true, boosters: 1 },
  { id: 'fit.booster.bundle.3', option: 'fit-booster-bundle-3', name: 'Booster Bundle', price: '$1.99', boosters: 3 },
  { id: 'fit.small.bundle', option: 'fit-small-bundle', name: 'Small Bundle', price: '$3.49', gold: 5000, boosters: 1 },
  { id: 'fit.medium.bundle', option: 'fit-medium-bundle', name: 'Medium Bundle', price: '$6.49', gold: 10000, boosters: 2 },
  { id: 'fit.ultra.bundle', option: 'fit-ultra-bundle', name: 'Ultra Bundle', price: '$12.99', gold: 25000, boosters: 3 },
  { id: 'fit.gold.500', option: 'fit-gold-pack-500', name: 'Gold Pack 1', price: '$0.99', gold: 500 },
  { id: 'fit.gold.1500', option: 'fit-gold-pack-1500', name: 'Gold Pack 2', price: '$2.99', gold: 1500 },
  { id: 'fit.gold.3500', option: 'fit-gold-pack-3500', name: 'Gold Pack 3', price: '$5.99', gold: 3500 },
  { id: 'fit.gold.8000', option: 'fit-gold-pack-8000', name: 'Gold Pack 4', price: '$9.99', gold: 8000 },
  { id: 'fit.gold.18000', option: 'fit-gold-pack-18000', name: 'Gold Pack 5', price: '$19.99', gold: 18000 },
  { id: 'fit.gold.40000', option: 'fit-gold-pack-40000', name: 'Gold Pack 6', price: '$39.99', gold: 40000 },
];
export const product = (id: string) => PRODUCTS.find(p => p.id === id);

export type BuyResult = 'ok' | 'cancelled' | 'pending' | 'error' | 'unavailable';

const KEY_NO_ADS = 'snug.noads.v1';
const KEY_GRANTED = 'ef.iap.granted.v1';
const GRANTED_KEEP = 300;
let noAds = LocalStore.get(KEY_NO_ADS) === '1';
const granted: string[] = (() => { try { return JSON.parse(LocalStore.get(KEY_GRANTED) || '[]'); } catch { return []; } })();
const storePrices: Record<string, string> = {};

let started = false;
let buying: { id: string; done: (r: BuyResult) => void } | null = null;
let restoring: ((r: { noAds: boolean; error?: boolean }) => void) | null = null;
const grantListeners: ((p: Product) => void)[] = [];
const priceListeners: (() => void)[] = [];
const noAdsListeners: (() => void)[] = [];
const off = <T>(list: T[], fn: T) => () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };

function setNoAds() {
  if (noAds) return;
  noAds = true; LocalStore.set(KEY_NO_ADS, '1');
  for (const f of noAdsListeners) f();
}

/** Add what the product gives and tell the UI */
function grant(p: Product) {
  if (p.noAds) setNoAds();
  if (p.gold) Wallet.add(p.gold);
  if (p.boosters) for (const k of BOOSTER_KEYS) Boosters.add(k, p.boosters);
  for (const f of grantListeners) f(p);
}

function onNative(msg: any) {
  if (msg.type === 'prices') {
    Object.assign(storePrices, msg.prices || {});
    for (const f of priceListeners) f();
  } else if (msg.type === 'purchase') {
    const p = product(msg.productId), token = String(msg.token || '');
    if (!p || !token) return;
    if (granted.indexOf(token) < 0) {
      granted.push(token);
      if (granted.length > GRANTED_KEEP) granted.splice(0, granted.length - GRANTED_KEEP);
      LocalStore.setJson(KEY_GRANTED, granted);   // saved before the grant: never twice
      grant(p);
    }
    NativeBridge.call('billingFinish', token, p.lifetime ? '0' : '1');
    if (buying?.id === p.id) { const b = buying; buying = null; b.done('ok'); }
  } else if (msg.type === 'flowEnd') {
    if (buying?.id === msg.productId) { const b = buying; buying = null; b.done(msg.result === 'owned' ? 'ok' : msg.result); }
  } else if (msg.type === 'owned') {
    const has = (msg.ids as string[] || []).some(id => product(id)?.noAds);
    if (has) setNoAds();   // reinstall / new phone: No Ads comes back by itself
    if (msg.restore && restoring) { const r = restoring; restoring = null; r({ noAds: has || noAds, error: !!msg.error }); }
  }
}

export const Purchases = {
  get noAds() { return noAds; },
  /** Once at launch: connect to the store, fetch prices, finish purchases left over */
  start() {
    if (started) return;
    started = true;
    if (!NativeBridge.android) return;
    NativeBridge.on('billing', onNative);
    NativeBridge.call('billingSetup', JSON.stringify(PRODUCTS.map(p => ({ id: p.id, option: p.option }))));
  },
  /** Price label: from the store once known, else the design price */
  price(id: string) { return storePrices[id] || product(id)?.price || ''; },
  onPrices(fn: () => void) { priceListeners.push(fn); return off(priceListeners, fn); },
  /** Every granted product (bought now or recovered at start), to refresh the UI */
  onGrant(fn: (p: Product) => void) { grantListeners.push(fn); return off(grantListeners, fn); },
  onNoAds(fn: () => void) { noAdsListeners.push(fn); return off(noAdsListeners, fn); },

  /** Buy one product. 'ok' = confirmed and granted (the reward is already added) */
  buy(id: string): Promise<BuyResult> {
    const p = product(id);
    if (!p || buying) return Promise.resolve('error');
    if (!NativeBridge.android) {
      // simulated store: confirmed after a short wait
      return new Promise(ok => setTimeout(() => { grant(p); ok('ok'); }, 900));
    }
    return new Promise<BuyResult>(done => {
      buying = { id, done };
      NativeBridge.call('billingBuy', id);
    });
  },

  /** No Ads only (non-consumables); gold and boosters are never given back */
  restore(): Promise<{ noAds: boolean; error?: boolean }> {
    if (!NativeBridge.android) return new Promise(ok => setTimeout(() => ok({ noAds }), 700));
    if (restoring) return Promise.resolve({ noAds });
    return new Promise(ok => { restoring = ok; NativeBridge.call('billingRestore'); });
  },
};
