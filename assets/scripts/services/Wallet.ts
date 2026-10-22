// Player gold, saved on the device (web key snug.gold.v1). Listeners redraw any gold counter.
import { LocalStore } from './LocalStore';

const KEY = 'snug.gold.v1';
let gold = Math.max(0, Number(LocalStore.get(KEY)) | 0);
const listeners: ((n: number) => void)[] = [];

export const Wallet = {
  get gold() { return gold; },
  /** Add (or spend, n < 0) gold; never below 0 */
  add(n: number) {
    gold = Math.max(0, gold + (n | 0));
    LocalStore.set(KEY, String(gold));
    for (const fn of listeners) fn(gold);
    return gold;
  },
  /** Returns an unsubscribe function: call it in onDestroy */
  onChange(fn: (n: number) => void) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  },
};

/** 1234567 → "1,234,567" (web: toLocaleString('en-US')) */
export const formatNumber = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
