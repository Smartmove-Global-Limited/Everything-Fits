// The game scene's controller and its ONLY per-frame loop. Every system (drag, level intro,
// timer, bag rules…) is ticked from here in a fixed order; no other gameplay component has an
// update(). Bag rules run right after the physics step (Director.EVENT_AFTER_PHYSICS).
import { _decorator, Component, Node, Label, director, Director, PhysicsSystem2D, sys } from 'cc';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { LevelBuilder } from './LevelBuilder';
import { DragController } from './DragController';
import { checkEject, updatePacked, setBagEvents } from './BagRules';
const { ccclass, property } = _decorator;

@ccclass('GameController')
export class GameController extends Component {
  @property({ type: Node, tooltip: 'Layer behind the items: bag body image' }) bagLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer holding the item nodes' }) itemLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer in front of the items: bag rim / opening' }) frontLayer: Node = null!;
  @property({ type: DragController }) drag: DragController = null!;
  @property({ type: Label }) levelLabel: Label | null = null;
  @property({ type: Label }) timerLabel: Label | null = null;
  @property({ type: Label }) itemsLeftLabel: Label | null = null;
  @property({ tooltip: 'Level to open when the scene starts (0-based, within the first chapter)' }) startLevel = 0;

  private builder!: LevelBuilder;
  private shownSecond = -1;

  onLoad() {
    this.builder = new LevelBuilder(this.bagLayer, this.itemLayer, this.frontLayer);
    director.on(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    setBagEvents({
      onListChanged: () => this.refreshItemsLeft(),
      onWin: () => this.onWin(),
    });
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
    S.clock = 0; S.startTime = 0; this.shownSecond = -1;
    PhysicsSystem2D.instance.enable = true;
    await this.builder.build(S.level);
    if (this.levelLabel) this.levelLabel.string = `Lv. ${ContentLoader.levelNumber(S.chapterId, S.levelIndex)}`;
    this.refreshItemsLeft();
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
    this.drag.tick(dt);
    this.builder.tick();
    this.tickTimer(ms);
  }

  private afterPhysics() {
    if (!this.running) return;
    checkEject(GameState.clock);
    updatePacked(GameState.clock);
  }

  private tickTimer(ms: number) {
    const S = GameState;
    if (!S.timerOn || !S.bagReady) return;
    S.timeLeft = Math.max(0, S.timeLeft - ms);
    const sec = Math.ceil(S.timeLeft / 1000);
    if (sec !== this.shownSecond && this.timerLabel) {
      this.shownSecond = sec;
      const m = Math.floor(sec / 60), s = sec % 60;
      this.timerLabel.string = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    if (S.timeLeft <= 0) { S.lost = true; this.onLose(); }
  }

  private refreshItemsLeft() {
    if (!this.itemsLeftLabel) return;
    this.itemsLeftLabel.string = `${Math.max(0, GameState.itemsToPack - GameState.packed.size)} LEFT`;
  }

  private onWin() { if (this.levelLabel) this.levelLabel.string = 'Packed!'; }
  private onLose() { if (this.timerLabel) this.timerLabel.string = "Time's up"; }
}
