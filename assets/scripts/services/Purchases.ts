// Real-money purchases and the No Ads entitlement (web src/game/store.js).
// TEMPORARY: no store billing yet. buy() simulates a confirmed transaction after a short wait;
// plug Google Play Billing / StoreKit in here, callers only grant rewards when it resolves true.
import { LocalStore } from './LocalStore';

const KEY_NO_ADS = 'snug.noads.v1';
let noAds = LocalStore.get(KEY_NO_ADS) === '1';

export const Purchases = {
  get noAds() { return noAds; },
  enableNoAds() { noAds = true; LocalStore.set(KEY_NO_ADS, '1'); },
  buy(_productId: string): Promise<boolean> { return new Promise(ok => setTimeout(() => ok(true), 900)); },
  restore(): Promise<{ noAds: boolean }> { return new Promise(ok => setTimeout(() => ok({ noAds }), 700)); },
};
