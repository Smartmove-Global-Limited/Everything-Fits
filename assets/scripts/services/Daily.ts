// Things that come back every day (the phone's local midnight), saved on the device:
//   ShakeEnergy  100 points a day for shaking the bag (2 per hard jolt); a rewarded ad fills it up
//   FreeGold     50 gold for watching an ad in the Shop, up to 5 times a day
import { LocalStore } from './LocalStore';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export const SHAKE_ENERGY_MAX = 100;
export const SHAKE_COST = 2;
export const FREE_GOLD = 50;
export const FREE_GOLD_PER_DAY = 5;

const KEY_ENERGY = 'ef.shakeEnergy.v1';
const KEY_FREE_GOLD = 'ef.freeGold.v2';   // { day, count } (v1: the day of the one claim)
let energy = LocalStore.json<{ day: string; points: number }>(KEY_ENERGY, { day: '', points: SHAKE_ENERGY_MAX });
const energyListeners: (() => void)[] = [];

function freshEnergy() {
  const d = today();
  if (energy.day !== d) { energy = { day: d, points: SHAKE_ENERGY_MAX }; LocalStore.setJson(KEY_ENERGY, energy); }
  return energy;
}

export const ShakeEnergy = {
  get points() { return freshEnergy().points; },
  /** 0..1 for the HUD bar */
  get fraction() { return freshEnergy().points / SHAKE_ENERGY_MAX; },
  get empty() { return freshEnergy().points < SHAKE_COST; },
  /** One hard jolt; false when the bar is already empty */
  spend() {
    const e = freshEnergy();
    if (e.points < SHAKE_COST) return false;
    e.points -= SHAKE_COST;
    LocalStore.setJson(KEY_ENERGY, e);
    for (const f of energyListeners) f();
    return true;
  },
  /** Rewarded ad refill_energy watched to the end */
  refill() {
    energy = { day: today(), points: SHAKE_ENERGY_MAX };
    LocalStore.setJson(KEY_ENERGY, energy);
    for (const f of energyListeners) f();
  },
  onChange(fn: () => void) { energyListeners.push(fn); return () => { const i = energyListeners.indexOf(fn); if (i >= 0) energyListeners.splice(i, 1); }; },
};

function freeGoldToday() {
  const v = LocalStore.json<{ day: string; count: number }>(KEY_FREE_GOLD, { day: '', count: 0 });
  return v.day === today() ? v.count : 0;
}
export const FreeGold = {
  /** Claims left today (0..FREE_GOLD_PER_DAY) */
  get left() { return Math.max(0, FREE_GOLD_PER_DAY - freeGoldToday()); },
  /** All of today's claims used: the button waits for tomorrow */
  get doneToday() { return this.left <= 0; },
  markClaimed() { LocalStore.setJson(KEY_FREE_GOLD, { day: today(), count: freeGoldToday() + 1 }); },
  /** Seconds until the next one (the phone's local midnight) */
  secondsLeft() { const d = new Date(), m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return Math.max(0, Math.ceil((m.getTime() - d.getTime()) / 1000)); },
};
