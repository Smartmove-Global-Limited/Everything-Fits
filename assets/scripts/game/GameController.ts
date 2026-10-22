// The game scene's controller and its ONLY per-frame loop. Every system (drag, level intro,
// timer, freeze…) is ticked from here in a fixed order; no other gameplay component has an
// update(). Bag rules run right after the physics step (Director.EVENT_AFTER_PHYSICS).
// Round flow like the web game (src/main.js, rules.js, hud.js): settings pause the round, a win
// saves progress + gold and shows the reward popup, running out of time shows the lose popup.
import { _decorator, Component, Node, director, Director, PhysicsSystem2D, sys } from 'cc';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { LevelBuilder } from './LevelBuilder';
import { DragController } from './DragController';
import * as BagRules from './BagRules';
import { checkEject, updatePacked, setBagEvents, applyEjects } from './BagRules';
import { startFreeze, tickFreeze, freezeLeft, shrinkBiggestOutside, throwOne, FREEZE_MS } from './BoosterEffects';
import { scoreRound } from './Score';
import { DEV } from 'cc/env';
import { GameHud, BoosterId, BoosterState } from '../ui/GameHud';
import { showPopup } from '../ui/PopupHost';
import { SettingsPopup } from '../ui/SettingsPopup';
import { WinPopup } from '../ui/WinPopup';
import { LosePopup } from '../ui/LosePopup';
import { ShakePopup } from '../ui/ShakePopup';
import { Overlays } from '../ui/Overlays';
import { Sound } from '../audio/Sound';
import { Progress } from '../services/Progress';
import { Wallet } from '../services/Wallet';
import { Boosters, BOOSTER_KEYS } from '../services/Boosters';
const { ccclass, property } = _decorator;

const WIN_POPUP_DELAY = .7;   // let the player see the celebration before the popup covers it

@ccclass('GameController')
export class GameController extends Component {
  @property({ type: Node, tooltip: 'Layer behind the items: bag body image' }) bagLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer holding the item nodes' }) itemLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer in front of the items: bag rim / opening' }) frontLayer: Node = null!;
  @property({ type: DragController }) drag: DragController = null!;
  @property({ type: GameHud }) hud: GameHud = null!;
  @property({ tooltip: 'Level to open when the scene is started directly (0-based, first chapter)' }) startLevel = 0;

  private builder!: LevelBuilder;
  private levelNumber = 1;
  private freezeShown = -1;
  private offBoosters: (() => void) | null = null;

  onLoad() {
    // dev builds only: hooks for automated play-testing from the browser console
    if (DEV) (globalThis as any).__ef = { GameState, BagRules, physics: PhysicsSystem2D.instance, game: this };
    this.builder = new LevelBuilder(this.bagLayer, this.itemLayer, this.frontLayer);
    director.on(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    setBagEvents({
      onPacked: () => Sound.play('fit'),
      onWin: () => this.onWin(),
      onEjected: () => { Sound.play('eject'); this.hud.toastMessage("Doesn't fit! Pushed back out"); },
    });
    this.drag.events = {
      onPick: () => Sound.play('pick'),
      onDrop: (_it, bounced) => { if (bounced) { Sound.play('nope'); this.hud.toastMessage("Doesn't fit!"); } else Sound.play('drop', { gain: .9 }); },
    };
    this.hud.onPause = () => this.openSettings();
    this.hud.onBooster = id => this.useBooster(id);
    this.hud.onShakeEmpty = () => this.openShakePopup();
    this.offBoosters = Boosters.onChange(() => this.renderBoosters());
  }

  onDestroy() {
    director.off(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    this.offBoosters?.();
    this.builder.dispose();
    const S = GameState;
    S.level = null; S.items = []; S.thrown = []; S.bag = null; S.drag = null; S.selected = null;
  }

  async start() {
    const S = GameState;
    const book = await ContentLoader.loadBook();
    let idx = this.startLevel;
    if (S.fromMenu && S.chapter) { idx = S.levelIndex; S.fromMenu = false; }
    else {
      S.chapter = book.chapters[0]; S.chapterId = S.chapter.id;
      const spot = Progress.getSpot(book.chapters);
      if (spot) { S.chapter = spot.chapter; S.chapterId = spot.chapter.id; idx = spot.index; }
      if (sys.isBrowser) { const q = Number(new URLSearchParams(location.search).get('i')); if (!Number.isNaN(q) && q > 0) idx = q; }
    }
    await ContentLoader.preloadChapter(S.chapter);
    Sound.startMusic();
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
    this.levelNumber = ContentLoader.levelNumber(S.chapterId, S.levelIndex);
    Progress.setSpot(S.chapterId, S.levelIndex);
    this.hud.setLevel(this.levelNumber);
    this.hud.resetClock();
    this.hud.setClock(S.timeLeft / 1000);
    this.hud.setShakeEnergy(1);
    this.hud.showBagHint(false);
    this.freezeShown = -1;
    this.renderBoosters();
    Sound.duckMusic(false);
  }

  restart() { return this.openLevel(GameState.levelIndex); }

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
    if (S.freezeUntil) this.tickFreezeBadge();
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
      this.hud.placeBagHint(S.level?.emptyTextEn || 'Pack your things here!', (bag.minX + bag.maxX) / 2, (bag.minY + bag.maxY) / 2);
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

  // ---------- boosters (web boosters.js) ----------
  private renderBoosters() {
    if (!GameState.level) return;
    const freezing = freezeLeft() > 0;
    BOOSTER_KEYS.forEach((k, i) => {
      const n = Boosters.count(k);
      const locked = !Boosters.isUnlocked(k, this.levelNumber);
      const on = k === 'freeze' && freezing;
      this.hud.setBooster(i as BoosterId, n, locked ? BoosterState.LOCKED : on ? BoosterState.ON : n <= 0 ? BoosterState.EMPTY : BoosterState.READY, [3, 6, 9][i]);
      if (on) this.hud.setBoosterBadge(i as BoosterId, `${Math.ceil(freezeLeft() / 1000)}s`);
    });
  }
  private tickFreezeBadge() {
    const freezing = tickFreeze();
    const sec = freezing ? Math.ceil(freezeLeft() / 1000) : 0;
    if (sec !== this.freezeShown) { this.freezeShown = sec; this.renderBoosters(); }
  }

  private useBooster(id: BoosterId) {
    const S = GameState;
    const key = BOOSTER_KEYS[id];
    if (S.won || S.lost || S.paused || !Boosters.isUnlocked(key, this.levelNumber) || Boosters.count(key) <= 0) return;
    if (key === 'freeze') {
      if (!startFreeze()) return;
      Boosters.use('freeze');
      Sound.play('shrink');
      this.hud.toastMessage(`Frozen for ${FREEZE_MS / 1000}s: items stay where you drop them`);
    } else if (key === 'resize') {
      const it = shrinkBiggestOutside();
      if (!it) { Sound.play('nope'); this.hud.toastMessage('Nothing left outside the bag'); return; }
      Boosters.use('resize');
      Sound.play('shrink');
      this.hud.toastMessage(`Shrunk ${it.nameEn || it.nameVi} by 20%`);
    } else {
      const it = throwOne();
      if (!it) { Sound.play('nope'); this.hud.toastMessage('Nothing can be thrown out'); return; }
      Boosters.use('throw');
      Sound.play('trash');
      this.hud.toastMessage(`Threw out ${it.nameEn || it.nameVi}`);
    }
    this.renderBoosters();
  }

  // ---------- popups ----------
  private async openSettings() {
    const S = GameState;
    if (S.won || S.lost) return;
    const wasPaused = S.paused;
    S.paused = true; Sound.duckMusic(true);
    const p = await showPopup('SettingsPopup', SettingsPopup);
    p.open({
      inGame: true, version: ContentLoader.book?.version,
      onClose: () => { S.paused = wasPaused; Sound.duckMusic(false); },
      onHome: () => this.goHome(),
      onRestart: () => { S.paused = false; this.restart(); },
    });
  }

  private async openShakePopup() {
    const S = GameState;
    if (S.won || S.lost || S.paused) return;
    S.paused = true;
    const p = await showPopup('ShakePopup', ShakePopup);
    p.open({ onRefill: () => this.hud.setShakeEnergy(1), onClose: () => { S.paused = false; } });
  }

  goHome() {
    GameState.paused = true;
    Sound.duckMusic(false);
    director.loadScene('Main');
  }

  private tickTimer(ms: number) {
    const S = GameState;
    if (!S.timerOn || !S.bagReady) return;
    const before = Math.ceil(S.timeLeft / 1000);
    S.timeLeft = Math.max(0, S.timeLeft - ms);
    const sec = Math.ceil(S.timeLeft / 1000);
    if (sec !== before && sec <= 10 && sec > 0) Sound.play('tick', { gain: .55 });   // last ten seconds tick
    this.hud.setClock(S.timeLeft / 1000);
    if (S.timeLeft <= 0) this.onLose();
  }

  private onWin() {
    const S = GameState;
    const first = Progress.markDone(S.chapterId, S.levelIndex);
    Progress.setSpot(S.chapterId, Math.min(S.levelIndex + 1, S.chapter.levels.length - 1));
    if (first && S.levelIndex + 1 < S.chapter.levels.length) Sound.play('unlockLv', { delay: 1.15, gain: .9 });
    const reward = S.level?.reward?.coin ?? 20;
    Wallet.add(reward);
    Sound.play('win'); Sound.duckMusic(true);
    this.hud.toastMessage('It fits!');
    const score = scoreRound();
    this.scheduleOnce(async () => {
      if (!S.won) return;
      const p = await showPopup('WinPopup', WinPopup);
      p.open({
        levelNumber: this.levelNumber, seconds: score.secondsUsed, reward,
        stars: Math.max(1, Math.min(3, Math.round(score.stars * 3 / 5))), mistake: score.mistakes[0] || null,
        onContinue: () => this.nextLevel(),
        onHome: () => this.goHome(),
        onCollectX2: () => Wallet.add(reward),
      });
    }, WIN_POPUP_DELAY);
  }

  private nextLevel() {
    const spot = Progress.getSpot(ContentLoader.chapters());
    if (spot && spot.chapter !== GameState.chapter) { GameState.chapter = spot.chapter; GameState.chapterId = spot.chapter.id; }
    return this.openLevel(spot ? spot.index : GameState.levelIndex + 1);
  }

  private async onLose() {
    const S = GameState;
    if (S.lost) return;
    S.lost = true;
    Sound.play('lose'); Sound.duckMusic(true);
    const p = await showPopup('LosePopup', LosePopup);
    p.open({
      itemsLeft: Math.max(0, S.itemsToPack - S.packed.size),
      onRetry: () => this.restart(),
      onExtraTime: () => {
        S.timeLeft = 60000; S.lost = false;
        this.hud.resetClock(); this.hud.setClock(60);
        Sound.duckMusic(false);
        this.hud.toastMessage('+60 sec!');
      },
      onHome: () => this.goHome(),
    });
  }
}
