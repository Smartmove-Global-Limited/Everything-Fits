// Shared state of the current round. Plain data, no per-frame logic.
import type { ItemView } from '../game/ItemView';
import type { BagView } from '../game/BagView';

export interface DragState {
  item: ItemView;
  /** pointer → item origin offset, in item local axes (so it follows rotation) */
  offsetX: number; offsetY: number;
  /** target pointer position (Field space) */
  targetX: number; targetY: number;
  lift: number; liftTo: number;
  ghost: boolean;
  lastValid: { x: number; y: number; angle: number } | null;
  touchId: number;
  /** the tied partner, carried along: its offset (x, y) and angle in the held item's own axes */
  partner: ItemView | null; partnerX: number; partnerY: number; partnerAngle: number;
}

export const GameState = {
  chapterId: 'school-day',
  chapter: null as any,
  levelIndex: 0,
  level: null as any,
  preview: false,
  /** set by the main menu: open GameState.chapter / levelIndex instead of reading the URL */
  fromMenu: false,

  bag: null as BagView | null,
  items: [] as ItemView[],
  /** number of items that must end up in the bag (everything but the key), set when a level is built */
  itemsToPack: 0,

  drag: null as DragState | null,
  selected: null as ItemView | null,

  /** item level indices counted as packed */
  packed: new Set<number>(),
  /** items taken off the field by the Throw out booster (back to the pool on the next build) */
  thrown: [] as ItemView[],
  /** item level indices removed by the throw-away booster */
  removed: new Set<number>(),
  winFrames: 0, won: false, lost: false, paused: false,

  timeLeft: 0, timerOn: true,
  /** game clock in ms, only advances while the round is running */
  clock: 0, timeScale: 1,
  startTime: 0,
  /** increases every time a round is (re)built, so stale async work can bail out */
  round: 0,

  bagReady: false, bagShownAt: 0,
  /** how far the bag was raised above the web layout (level units): centred in the free band above the tray */
  bagLift: 0,
  /**
   * Tall screens (see GameController.fitToScreen), level units: how far the tray floor sits below
   * FLOOR_Y, and how much higher the bag may rise than BAG_CEIL (the HUD moved up)
   */
  floorDrop: 0, ceilGain: 0,
  freezeUntil: 0,

  /** snapshot of the bag right before the last drop, to undo if that drop failed */
  bagSnapshot: null as null | { dropped: ItemView; list: { item: ItemView; x: number; y: number; angle: number }[] },
};

export const isHeld = (it: ItemView) => !!GameState.drag && (GameState.drag.item === it || GameState.drag.partner === it);
export const isOnField = (it: ItemView) => !it.waiting;
