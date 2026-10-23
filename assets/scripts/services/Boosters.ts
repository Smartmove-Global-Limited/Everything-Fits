// Booster stock (web src/game/boosters.js, key snug.boosts.v1): a shared stock saved on the device,
// not refilled per level. Starts at 2 / 2 / 2. Unlocks at levels 3 / 6 / 9.
import { LocalStore } from './LocalStore';

export type BoosterKey = 'freeze' | 'resize' | 'throw';
export const BOOSTER_KEYS: BoosterKey[] = ['freeze', 'resize', 'throw'];
export const DEFAULT_BOOSTS: Record<BoosterKey, number> = { freeze: 2, resize: 2, throw: 2 };
export const UNLOCK_LEVEL: Record<BoosterKey, number> = { freeze: 3, resize: 6, throw: 9 };
const KEY = 'snug.boosts.v1';

const stock = LocalStore.json<Record<BoosterKey, number>>(KEY, DEFAULT_BOOSTS);
const listeners: (() => void)[] = [];

export const Boosters = {
  count: (k: BoosterKey) => stock[k] ?? 0,
  isUnlocked: (k: BoosterKey, levelNumber: number) => levelNumber >= UNLOCK_LEVEL[k],
  add(k: BoosterKey, n: number) { stock[k] = Math.max(0, (stock[k] ?? 0) + n); LocalStore.setJson(KEY, stock); for (const f of listeners) f(); },
  use(k: BoosterKey) { if ((stock[k] ?? 0) <= 0) return false; this.add(k, -1); return true; },
  onChange(fn: () => void) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
};
