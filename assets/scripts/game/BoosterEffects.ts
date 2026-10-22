// Booster effects (web src/game/boosters.js):
//   Freeze    20 s: items lying fully inside the bag, and items dropped into it, stay exactly where
//             they are (static bodies). Counted on the game clock, so pausing pauses it too.
//   Resize    shrinks the biggest item still outside the bag by 20%.
//   Throw out removes one ordinary item (not one of the 3 biggest), preferring one outside the bag.
import { ERigidBody2DType } from 'cc';
import { GameState, isHeld } from '../core/GameState';
import { bagZone, itemAABB } from './BagRules';
import type { ItemView } from './ItemView';

export const FREEZE_MS = 20000;

export const freezeLeft = () => Math.max(0, (GameState.freezeUntil || 0) - GameState.clock);
export const isFreezing = () => freezeLeft() > 0;

export function freezeItem(it: ItemView) {
  it.stop();
  it.body.type = ERigidBody2DType.Static;
  it.frozen = true; it.stuckFrames = 0;
}
function unfreezeItem(it: ItemView) {
  it.frozen = false;
  it.body.type = ERigidBody2DType.Dynamic;
  it.stop(); it.body.wakeUp();
}

/** Start the freeze. Returns false when nothing happened. */
export function startFreeze(): boolean {
  const S = GameState;
  if (isFreezing()) return false;
  S.freezeUntil = S.clock + FREEZE_MS;
  for (const it of S.items) if (!it.waiting && !isHeld(it) && !it.holdUntil && bagZone(it).fullyInside) freezeItem(it);
  return true;
}

/** Every frame: thaw everything when the time is up. Returns true while freezing. */
export function tickFreeze(): boolean {
  const S = GameState;
  if (!S.freezeUntil) return false;
  if (freezeLeft() > 0) { for (const it of S.items) if (it.frozen) it.stuckFrames = 0; return true; }
  S.freezeUntil = 0;
  for (const it of S.items) if (it.frozen) unfreezeItem(it);
  return false;
}

const area = (it: ItemView) => { const r = itemAABB(it); return r.width * r.height; };

/** Resize: the biggest item outside the bag, −20%. Returns it, or null when none is left outside. */
export function shrinkBiggestOutside(): ItemView | null {
  const c = GameState.items.filter(it => !it.waiting && !isHeld(it) && it.itemId !== 0 && !bagZone(it).fullyInside);
  if (!c.length) return null;
  c.sort((a, b) => area(b) - area(a));
  const it = c[0];
  it.setLevelScale(it.levelScale * .8);
  it.body.wakeUp();
  return it;
}

/** Throw out: one ordinary item, preferring one outside the bag. Returns it, or null. */
export function throwOne(): ItemView | null {
  const S = GameState;
  const big = new Set(S.items.filter(it => it.itemId !== 0).sort((a, b) => area(b) - area(a)).slice(0, 3));
  const all = S.items.filter(it => !it.waiting && !isHeld(it) && !it.locked && it.itemId !== 0 && !big.has(it));
  if (!all.length) return null;
  const outside = all.filter(it => !bagZone(it).fullyInside);
  const pool = outside.length ? outside : all;
  const it = pool[Math.floor(Math.random() * pool.length)];
  S.items.splice(S.items.indexOf(it), 1);
  S.thrown.push(it);
  S.removed.add(it.levelIndex);
  it.node.active = false;
  return it;
}
