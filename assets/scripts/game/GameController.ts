// The game scene's controller and its ONLY per-frame loop. Every system (drag, level intro,
// timer, bag rules…) is ticked from here in a fixed order; no other gameplay component has an
// update(). Bag rules run right after the physics step (Director.EVENT_AFTER_PHYSICS).
import { _decorator, Component, Node, director, Director, PhysicsSystem2D, sys } from 'cc';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { LevelBuilder } from './LevelBuilder';
import { DragController } from './DragController';
import * as BagRules from './BagRules';
import { checkEject, updatePacked, setBagEvents, applyEjects } from './BagRules';
import { DEV } from 'cc/env';
import { GameHud, BoosterId, BoosterState } from '../ui/GameHud';
const { ccclass, property } = _decorator;

@ccclass('GameController')
export class GameController extends Component {
  @property({ type: Node, tooltip: 'Layer behind the items: bag body image' }) bagLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer holding the item nodes' }) itemLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer in front of the items: bag rim / opening' }) frontLayer: Node = null!;
  @property({ type: DragController }) drag: DragController = null!;
  @property({ type: GameHud }) hud: GameHud = null!;
  @property({ tooltip: 'Level to open when the scene starts (0-based, within the first chapter)' }) startLevel = 0;

  private builder!: LevelBuilder;

  onLoad() {
    // dev builds only: hooks for automated play-testing from the browser console
    if (DEV) (globalThis as any).__ef = { GameState, BagRules, physics: PhysicsSystem2D.instance, game: this };
    this.builder = new LevelBuilder(this.bagLayer, this.itemLayer, this.frontLayer);
    director.on(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    setBagEvents({
      onWin: () => this.onWin(),
    });
    this.hud.onPause = () => this.onPause();
    this.hud.onBooster = id => this.onBooster(id);
  }

  onDestroy() { director.off(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this); }

  async start() {
    const book = await ContentLoader.loadBook();
    const S = GameState;
    S.chapter = book.chapters[0]; S.chapterId = S.chapter.id;
    let idx = this.startLevel;
    if (sys.isBrowser) { const q = Number(new URLSearchParams(location.search).get('i')); if (!Number.isNaN(q) && q > 0) idx = q; }
    await ContentLoader.preloadChapter(S.chapter);
    await this.openLevel(idx);
  }

  async openLevel(index: number) {
    const S = GameState;
    const levels = S.chapter.levels;
    S.levelIndex = Math.max(0, Math.min(index, levels.length - 1));
    S.level = levels[S.levelIndex];
    S.timeLeft = (S.level.timer || 90) * 1000;
    S.clock = 0; S.startTime = 0;
    PhysicsSystem2D.instance.enable = true;
    await this.builder.build(S.level);
    const number = ContentLoader.levelNumber(S.chapterId, S.levelIndex);
    this.hud.setLevel(number);
    this.hud.resetClock();
    this.hud.setClock(S.timeLeft / 1000);
    this.hud.setShakeEnergy(1);
    this.hud.showBagHint(false);
    this.renderBoosters(number);
  }

  restart() { return this.openLevel(GameState.levelIndex); }
  next() { return this.openLevel((GameState.levelIndex + 1) % GameState.chapter.levels.length); }

  get running() { const S = GameState; return !!S.level && !S.won && !S.lost && !S.paused; }

  update(dt: number) {
    const S = GameState;
    if (!S.level) return;
    const running = this.running;
    PhysicsSystem2D.instance.enable = running;
    if (!running) return;
    const ms = dt * 1000 * S.timeScale;
    S.clock += ms;
    applyEjects();
    this.drag.tick(dt);
    this.builder.tick();
    this.tickTimer(ms);
  }

  private afterPhysics() {
    if (!this.running) return;
    checkEject(GameState.clock);
    updatePacked(GameState.clock);
    this.updateBagHint();
  }

  // ---------- bag hint: shown while nothing lies inside the bag (web bags.js drawEmptyLabel) ----------
  private hintPlacedFor: object | null = null;
  private updateBagHint() {
    const S = GameState, bag = S.bag;
    if (!bag || !S.bagReady) { this.hud.showBagHint(false); return; }
    if (this.hintPlacedFor !== bag) {
      this.hintPlacedFor = bag;
      const level = S.level;
      this.hud.placeBagHint(level?.emptyTextEn || 'Pack your things here!', (bag.minX + bag.maxX) / 2, (bag.minY + bag.maxY) / 2);
    }
    let any = S.packed.size > 0;
    for (let i = 0; !any && i < S.items.length; i++) {
      const it = S.items[i];
      if (it.waiting || it.held || it.itemId === 0) continue;
      const r = BagRules.itemAABB(it);
      any = r.yMin > bag.minY && r.yMax < bag.maxY + 4 && r.xMin > bag.minX - 4 && r.xMax < bag.maxX + 4;
    }
    this.hud.showBagHint(!any);
  }

  // ---------- boosters (web boosters.js: unlock at levels 3 / 6 / 9, 2 / 2 / 1 to start) ----------
  private renderBoosters(levelNumber: number) {
    const S = GameState;
    const keys = ['freeze', 'resize', 'throw'], unlockAt = [3, 6, 9];
    for (let i = 0; i < 3; i++) {
      const n = S.boosts[keys[i]] ?? 0;
      const locked = levelNumber < unlockAt[i];
      this.hud.setBooster(i as BoosterId, n, locked ? BoosterState.LOCKED : n <= 0 ? BoosterState.EMPTY : BoosterState.READY, unlockAt[i]);
    }
  }
  private onBooster(_id: BoosterId) { /* booster effects: next step */ }
  private onPause() { /* settings popup: next step */ }

  private tickTimer(ms: number) {
    const S = GameState;
    if (!S.timerOn || !S.bagReady) return;
    S.timeLeft = Math.max(0, S.timeLeft - ms);
    this.hud.setClock(S.timeLeft / 1000);
    if (S.timeLeft <= 0) { S.lost = true; this.onLose(); }
  }

  private onWin() { this.hud.toastMessage('Packed!'); }
  private onLose() { this.hud.toastMessage("Time's up"); }
}
