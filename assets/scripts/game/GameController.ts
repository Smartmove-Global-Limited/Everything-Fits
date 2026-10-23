// The game scene's controller and its ONLY per-frame loop. Every system (drag, level intro,
// timer, freeze…) is ticked from here in a fixed order; no other gameplay component has an
// update(). Bag rules run right after the physics step (Director.EVENT_AFTER_PHYSICS).
// Round flow like the web game (src/main.js, rules.js, hud.js): settings pause the round, a win
// saves progress + gold and shows the reward popup, running out of time shows the lose popup.
import { _decorator, Component, Node, director, Director, PhysicsSystem2D, sys, Camera, view, Sprite } from 'cc';
import { levelToFieldY, FLOOR_Y, DOCK_TOP_Y, DESIGN_H } from '../core/GameConstants';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { LevelBuilder } from './LevelBuilder';
import { DragController } from './DragController';
import * as BagRules from './BagRules';
import { checkEject, updatePacked, setBagEvents, applyEjects } from './BagRules';
import { startFreeze, tickFreeze, freezeLeft, isFreezing, shrinkBiggestOutside, throwOne, FREEZE_MS } from './BoosterEffects';
import { scoreRound } from './Score';
import { Fx } from './Fx';
import { tickPhone, tickBalloons, setMechanicsEvents } from './Mechanics';
import { Shake } from './Shake';
import { tickSettle, wakeAll } from './Settle';
import { checkLevels, checkItems } from './LevelCheck';
import { LocalStore } from '../services/LocalStore';
import { Analytics } from '../services/Analytics';
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
import { ScreenFit } from '../ui/ScreenFit';
import { BackgroundBleed } from '../ui/BackgroundBleed';
const { ccclass, property } = _decorator;

const WIN_POPUP_DELAY = .7;   // let the player see the celebration before the popup covers it

@ccclass('GameController')
export class GameController extends Component {
  @property({ type: Node, tooltip: 'Layer behind the items: bag body image' }) bagLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer holding the item nodes' }) itemLayer: Node = null!;
  @property({ type: Node, tooltip: 'Layer in front of the items: bag rim / opening' }) frontLayer: Node = null!;
  @property({ type: DragController }) drag: DragController = null!;
  @property({ type: GameHud }) hud: GameHud = null!;
  @property({ type: Fx }) fx: Fx = null!;
  @property({ tooltip: 'Level to open when the scene is started directly (0-based, first chapter)' }) startLevel = 0;

  private builder!: LevelBuilder;
  private levelNumber = 1;
  private freezeShown = -1;
  private offBoosters: (() => void) | null = null;
  private shakePopupShown = false;

  private offCamera: (() => void) | null = null;

  /**
   * Tall screens: the HUD row and the booster dock follow the screen edges (EdgePin) while the
   * Field stays on the 420×760 design. Use the extra room: the bag may rise as far as the HUD went
   * up, and the tray floor drops to halve its gap to the dock.
   */
  private fitToScreen() {
    const vis = ScreenFit.visible(), ins = ScreenFit.insets();
    const extra = Math.max(0, vis.height - DESIGN_H) / 2;
    GameState.ceilGain = Math.max(0, extra - ins.top);
    const dockDrop = extra - ins.bottom;                       // how far EdgePin moved the dock down
    GameState.floorDrop = Math.max(0, (DOCK_TOP_Y + dockDrop - FLOOR_Y) / 2);
    const floor = this.node.parent!.getChildByName('Field')?.getChildByName('Environment')?.getChildByName('Floor');
    if (floor) {
      if (this.floorBaseY === null) this.floorBaseY = floor.position.y;
      floor.setPosition(floor.position.x, this.floorBaseY - GameState.floorDrop, 0);
    }
  }
  private floorBaseY: number | null = null;

  onLoad() {
    ScreenFit.apply();
    // Game.scene keeps its Canvas at the design centre (Field space == physics world space)
    this.offCamera = ScreenFit.fitCamera(this.node.parent!.getComponentInChildren(Camera)!);
    this.fitToScreen();
    view.on('canvas-resize', this.fitToScreen, this);   // the bag follows at the next level build
    // dev builds only: hooks for automated play-testing from the browser console
    if (DEV) (globalThis as any).__ef = {
      GameState, BagRules, Sound, Analytics, physics: PhysicsSystem2D.instance, game: this,
      // dev checks: do packed items come to rest? (LevelCheck.ts) Run after adding levels / items
      checkLevels: (only?: number[]) => checkLevels(this, only),
      checkItems: (opts?: any) => checkItems(this, opts),
    };
    this.builder = new LevelBuilder(this.bagLayer, this.itemLayer, this.frontLayer);
    director.on(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    setBagEvents({
      onPacked: (it, count) => this.onFitted(it, count),
      onWin: () => this.onWin(),
      onEjected: it => { wakeAll(); Sound.play('eject'); this.puff(it); this.hud.toastMessage("Doesn't fit! Pushed back out"); },
    });
    setMechanicsEvents({ onBroken: it => this.onLose(`${it.nameEn || it.nameVi} broke!`) });
    this.drag.events = {
      onPick: () => Sound.play('pick'),
      onDrop: (it, bounced) => {
        if (bounced) { Sound.play('nope'); this.puff(it); this.hud.toastMessage("Doesn't fit!"); }
        else Sound.play('drop', { gain: .9 });
      },
    };
    Shake.bind({
      onEnergy: e => this.hud.setShakeEnergy(e),
      onEmpty: () => { if (!this.shakePopupShown) { this.shakePopupShown = true; this.openShakePopup(); } },
    });
    this.hud.onPause = () => this.openSettings();
    this.hud.onBooster = id => this.useBooster(id);
    this.hud.onShakeEmpty = () => this.openShakePopup();
    this.offBoosters = Boosters.onChange(() => this.renderBoosters());
  }

  onDestroy() {
    director.off(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    this.offBoosters?.();
    this.offCamera?.();
    view.off('canvas-resize', this.fitToScreen, this);
    Shake.unbind(); Shake.reset();
    this.builder.dispose();
    const S = GameState;
    S.level = null; S.items = []; S.thrown = []; S.bag = null; S.drag = null; S.selected = null;
  }

  async start() {
    const S = GameState;
    const covered = Overlays.startCoveredIfPending();
    const book = await ContentLoader.loadBook();
    let idx = this.startLevel;
    if (S.fromMenu && S.chapter) { idx = S.levelIndex; S.fromMenu = false; }
    else {
      S.chapter = book.chapters[0]; S.chapterId = S.chapter.id;
      const spot = Progress.getSpot(book.chapters);
      if (spot) { S.chapter = spot.chapter; S.chapterId = spot.chapter.id; idx = spot.index; }
      if (sys.isBrowser) { const q = Number(new URLSearchParams(location.search).get('i')); if (!Number.isNaN(q) && q > 0) idx = q; }
    }
    Sound.startMusic();
    await this.openLevel(idx);
    if (covered) Overlays.uncover();
    // ready before they are needed: Home, and the popups of a round
    director.preloadScene('Main');
    for (const p of ['ui/SettingsPopup', 'ui/WinPopup', 'ui/LosePopup', 'ui/ShakePopup']) Overlays.loadPrefab(p);
  }

  async openLevel(index: number) {
    const S = GameState;
    const levels = S.chapter.levels;
    S.levelIndex = Math.max(0, Math.min(index, levels.length - 1));
    S.level = levels[S.levelIndex];
    this.drag.reset();
    S.timeLeft = (S.level.timer || 90) * 1000;
    S.clock = 0; S.startTime = 0;
    PhysicsSystem2D.instance.enable = true;
    Shake.reset(); this.fx?.clear();
    await Promise.all([this.builder.build(S.level), this.showBackground(S.level.background)]);
    Shake.setEnergy(1); this.shakePopupShown = false;
    this.levelNumber = ContentLoader.levelNumber(S.chapterId, S.levelIndex);
    Progress.setSpot(S.chapterId, S.levelIndex);
    this.hud.setLevel(this.levelNumber);
    this.hud.resetClock();
    this.hud.setClock(S.timeLeft / 1000);
    this.hud.showBagHint(false);
    this.freezeShown = -1;
    this.shakeHintOnce();
    Analytics.levelStart(this.levelNumber, S.level.id || String(S.levelIndex), S.level.difficulty?.tier);
    ContentLoader.preloadLevel(levels[(S.levelIndex + 1) % levels.length]);   // the next one, while this one is played
    this.renderBoosters();
    Sound.duckMusic(false);
  }

  /** The level's background picture (levels.json "background"); the bands on tall screens follow */
  private async showBackground(id: number) {
    const frame = await ContentLoader.background(id);
    const bg = this.node.parent!.getChildByName('Background');
    const sprite = bg?.getComponent(Sprite);
    if (!frame || !sprite || sprite.spriteFrame === frame) return;
    sprite.spriteFrame = frame;
    bg!.getComponent(BackgroundBleed)?.apply();
  }

  restart() { Analytics.setReason('restart'); return this.openLevel(GameState.levelIndex); }

  get running() { const S = GameState; return !!S.level && !S.won && !S.lost && !S.paused; }

  update(dt: number) {
    const S = GameState;
    this.fx?.tick(dt);                       // effects keep playing under popups (win confetti)
    if (!S.level) return;
    const running = this.running;
    PhysicsSystem2D.instance.enable = running;
    if (!running) return;
    const ms = dt * 1000 * S.timeScale;
    S.clock += ms;
    applyEjects();
    this.drag.tick(dt);
    this.builder.tick();
    // special items and shaking push their bodies before the physics step of this frame
    const phone = tickPhone(ms);
    if (phone && this.fx) this.fx.phoneWaves(phone.node.position.x, phone.node.position.y);
    tickBalloons();
    Shake.tick(ms, S.clock);
    if (S.bagReady) { const w = Shake.sway(ms); this.builder.setSway(w.x, w.y, w.angle); }
    if (S.freezeUntil) this.tickFreezeBadge();
    this.tickTimer(ms);
  }

  // ---------- feedback ----------
  private onFitted(it: any, count: number) {
    const S = GameState;
    // no chime while items are still raining in / preset items settle (web LANG_DAU_MAN)
    if (S.clock - S.startTime < 1000 || it.fitAt > S.clock - 900) return;
    it.fitAt = S.clock;
    Sound.play('fit', { gain: 1 + Math.min(6, count - 1) * 0 });
    const p = it.node.position;
    this.fx?.ring(p.x, p.y, { color: '#5FBF9B', r1: 46 });
    this.fx?.sparkle(p.x, p.y, { n: 10, color: '#8FE0C1', life: 520 });
  }
  /** Pink puff where an item vanished / reappeared (web S.puffs) */
  private puff(it: any) {
    const p = it.node.position;
    this.fx?.puff(p.x, p.y);
  }
  /** Tell once, on touch devices, that shaking the phone settles the bag (web goiYLacMotLan) */
  private shakeHintOnce() {
    if (!sys.isMobile || LocalStore.get('snug.shakeHint.v1')) return;
    LocalStore.set('snug.shakeHint.v1', '1');
    this.scheduleOnce(() => this.hud.toastMessage('Shake your phone to settle items in the bag', 3.2), 1.2);
  }

  private afterPhysics() {
    if (!this.running) return;
    checkEject(GameState.clock);
    updatePacked(GameState.clock);
    tickSettle(director.getDeltaTime());   // packed clusters that only twitch go to sleep
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
    const wasFreezing = !!GameState.freezeUntil;
    const freezing = tickFreeze();
    if (wasFreezing && !freezing) wakeAll();   // thawed: items settle again
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
      const b = S.bag;
      if (b && this.fx) { const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2; this.fx.ring(cx, cy, { color: '#7FC8F0', r1: 150, life: 600 }); this.fx.sparkle(cx, cy, { n: 26, color: '#BFE6FA', speed: 1.6 }); }
      this.hud.toastMessage(`Frozen for ${FREEZE_MS / 1000}s: the clock stops, items stay where you drop them`);
    } else if (key === 'resize') {
      const it = shrinkBiggestOutside();
      if (!it) { Sound.play('nope'); this.hud.toastMessage('Nothing left outside the bag'); return; }
      Boosters.use('resize');
      wakeAll();
      Sound.play('shrink');
      const p = it.node.position;
      this.puff(it); this.fx?.ring(p.x, p.y, { color: '#3D8BFF', r1: 40, life: 420 }); this.fx?.floatText(p.x, p.y + 18, '−20%', { color: '#2A66C8' });
      this.hud.toastMessage(`Shrunk ${it.nameEn || it.nameVi} by 20%`);
    } else {
      const it = throwOne();
      if (!it) { Sound.play('nope'); this.hud.toastMessage('Nothing can be thrown out'); return; }
      Boosters.use('throw');
      wakeAll();
      Sound.play('trash');
      const p = it.node.position;
      this.puff(it); this.fx?.sparkle(p.x, p.y, { n: 16, color: '#E8434F', speed: 1.3 }); this.fx?.floatText(p.x, p.y + 16, 'Bye!', { color: '#E8434F' });
      this.hud.toastMessage(`Threw out ${it.nameEn || it.nameVi}`);
    }
    Analytics.boosterUsed(key);
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
      // temporary test buttons (SettingsPopup.DEV_LEVEL_BUTTONS)
      onPrevLevel: () => this.jumpLevel(-1),
      onNextLevel: () => this.jumpLevel(1),
    });
  }

  private async openShakePopup() {
    const S = GameState;
    if (S.won || S.lost || S.paused) return;
    S.paused = true;
    const p = await showPopup('ShakePopup', ShakePopup);
    p.open({ onRefill: () => Shake.setEnergy(1), onClose: () => { S.paused = false; } });
  }

  goHome() {
    GameState.paused = true;
    Sound.duckMusic(false);
    Overlays.cover(true).then(() => director.loadScene('Main'));
  }

  private tickTimer(ms: number) {
    const S = GameState;
    if (!S.timerOn || !S.bagReady) return;
    if (isFreezing()) return;   // Freeze booster: the clock stops too
    const before = Math.ceil(S.timeLeft / 1000);
    S.timeLeft = Math.max(0, S.timeLeft - ms);
    const sec = Math.ceil(S.timeLeft / 1000);
    if (sec !== before && sec <= 10 && sec > 0) Sound.play('tick', { gain: .55 });   // last ten seconds tick
    this.hud.setClock(S.timeLeft / 1000);
    if (S.timeLeft <= 0) this.onLose(null);
  }

  private onWin() {
    const S = GameState;
    Analytics.levelEnd('win');
    const first = Progress.markDone(S.chapterId, S.levelIndex);
    Progress.setSpot(S.chapterId, Math.min(S.levelIndex + 1, S.chapter.levels.length - 1));
    if (first && S.levelIndex + 1 < S.chapter.levels.length) Sound.play('unlockLv', { delay: 1.15, gain: .9 });
    const reward = S.level?.reward?.coin ?? 20;
    Wallet.add(reward);
    Sound.play('win'); Sound.duckMusic(true);
    this.fx?.confetti(90);
    this.fx?.floatText(210, levelToFieldY(300), 'It fits!', { color: '#5FBF9B', size: 26, life: 1200 });
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

  /** Temporary test buttons: the previous / next level of the chapter (wrapping), behind the veil */
  private async jumpLevel(step: number) {
    const S = GameState, n = S.chapter.levels.length;
    S.paused = false; Sound.duckMusic(false);
    Analytics.setReason('next');
    await Overlays.cover();
    await this.openLevel((S.levelIndex + step + n) % n);
    await Overlays.uncover();
  }

  /** web level.js nextLevel: the following level of the chapter, wrapping after the last one; behind the veil */
  private async nextLevel() {
    Analytics.setReason('next');
    const S = GameState;
    await Overlays.cover();
    await this.openLevel((S.levelIndex + 1) % S.chapter.levels.length);
    await Overlays.uncover();
  }

  /** Time is up (no reason) or an item broke (reason, no extra time) */
  private async onLose(reason: string | null = null) {
    const S = GameState;
    if (S.lost || S.won) return;
    S.lost = true;
    Analytics.levelEnd('lose');
    Sound.play('lose'); Sound.duckMusic(true);
    this.fx?.shake(420);
    const p = await showPopup('LosePopup', LosePopup);
    p.open({
      itemsLeft: Math.max(0, S.itemsToPack - S.packed.size), reason,
      onRetry: () => this.restart(),
      onExtraTime: () => {
        S.timeLeft = 60000; S.lost = false;
        Analytics.extraTime();
        this.hud.resetClock(); this.hud.setClock(60);
        Sound.duckMusic(false);
        this.hud.toastMessage('+60 sec!');
      },
      onHome: () => this.goHome(),
    });
  }
}
