// The game scene's controller and its ONLY per-frame loop. Every system (drag, level intro,
// timer, freeze…) is ticked from here in a fixed order; no other gameplay component has an
// update(). Bag rules run right after the physics step (Director.EVENT_AFTER_PHYSICS).
// Round flow like the web game (src/main.js, rules.js, hud.js): settings pause the round, a win
// saves progress + gold and shows the reward popup, running out of time shows the lose popup.
import { _decorator, Component, Node, director, Director, PhysicsSystem2D, sys, Camera, view, Sprite, instantiate, Vec2, RigidBody2D } from 'cc';
import { levelToFieldY, FLOOR_Y, DOCK_TOP_Y, DESIGN_H, SIDE_PAD } from '../core/GameConstants';
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { LevelBuilder } from './LevelBuilder';
import { DragController } from './DragController';
import * as BagRules from './BagRules';
import { checkEject, updatePacked, setBagEvents, applyEjects } from './BagRules';
import { startFreeze, tickFreeze, freezeLeft, isFreezing, shrinkBiggestOutside, throwOne, FREEZE_MS } from './BoosterEffects';
import { preloadIceCoat } from './IceCoat';
import { scoreRound } from './Score';
import { Fx } from './Fx';
import { tickPhone, tickBalloons, setMechanicsEvents } from './Mechanics';
import { Shake } from './Shake';
import { tickSettle, wakeAll } from './Settle';
import { tickTethers, drawTethers } from './Tethers';
import type { ItemView } from './ItemView';
import { tickMystery, setMysteryEvents, resetMystery } from './MysteryBox';
import { checkLevels, checkItems } from './LevelCheck';
import { LocalStore } from '../services/LocalStore';
import { Analytics } from '../services/Analytics';
import { DEV } from 'cc/env';
import { GameHud, BoosterId, BoosterState } from '../ui/GameHud';
import { showPopup } from '../ui/PopupHost';
import { SettingsPopup } from '../ui/SettingsPopup';
import { WinPopup } from '../ui/WinPopup';
import { winShareLine } from '../ui/WinShare';
import { playDifficultyOf } from '../core/PlayDifficulty';
import { LosePopup } from '../ui/LosePopup';
import { ShakePopup } from '../ui/ShakePopup';
import { openBoosterShop } from '../ui/BoosterShop';
import { Overlays } from '../ui/Overlays';
import { Sound } from '../audio/Sound';
import { Progress } from '../services/Progress';
import { Wallet } from '../services/Wallet';
import { Boosters, BOOSTER_KEYS, UNLOCK_LEVEL } from '../services/Boosters';
import { Tutorial, TutorialHost } from '../ui/Tutorial';
import { Ads } from '../services/Ads';
import { ShakeEnergy } from '../services/Daily';
import { ScreenFit } from '../ui/ScreenFit';
import { BackgroundBleed } from '../ui/BackgroundBleed';
const { ccclass, property } = _decorator;

const WIN_POPUP_DELAY = .7;   // let the player see the celebration before the popup covers it
const SHATTER_AT = .35;     // s: a broken item's cracks spread this long before it shatters
const SHARDS_FALL = 1.2;    // s: the shards fly and fall before the lose popup
/** One line for each booster's first level (Tutorial booster intro) */
const BOOSTER_INTRO: Record<string, string> = {
  freeze: 'New booster! Freeze stops the clock for a few seconds',
  resize: 'New booster! Resize shrinks the biggest item outside the bag',
  throw: 'New booster! Throw out removes an item that will not fit',
};

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
  private tutorial: Tutorial | null = null;

  private offCamera: (() => void) | null = null;
  private offInsets: (() => void) | null = null;

  /**
   * Tall screens: the HUD row and the booster dock follow the screen edges (EdgePin) while the
   * Field stays on the 420×760 design. Use the extra room: the bag may rise as far as the HUD went
   * up, and the tray floor drops to halve its gap to the dock.
   */
  /**
   * The tray floor sits above the booster dock (which sits above the bottom banner). It is placed
   * when a level opens and stays put during the round (asked): the real banner height comes from
   * the ad SDK a moment after the level opened, and moving the floor under items that were falling
   * or lying on it dropped them through it / left an invisible floor behind. A change during the
   * round is applied when the next level opens. `force`: place it now (opening a level).
   */
  private fitToScreen(force = false) {
    const S = GameState;
    if (!force && S.level && S.items.length && !S.won && !S.lost) { this.floorPending = true; return; }
    this.floorPending = false;
    const vis = ScreenFit.visible(), ins = ScreenFit.insets(undefined, true);   // the dock stays above the system bar (EdgePin.aboveSystemBar)
    const extra = Math.max(0, vis.height - DESIGN_H) / 2;
    GameState.ceilGain = Math.max(0, extra - ins.top);
    const dockDrop = extra - ins.bottom;                       // how far EdgePin moved the dock down
    // room between the tray floor and the dock top: on a tall screen the floor takes half of it; when
    // the dock rose instead (banner under it, short screen) the floor rises with it, else the items
    // lay under the booster buttons
    const room = DOCK_TOP_Y + dockDrop - FLOOR_Y;
    GameState.floorDrop = room >= 0 ? room / 2 : room;
    const floor = this.node.parent!.getChildByName('Field')?.getChildByName('Environment')?.getChildByName('Floor');
    if (floor) {
      if (this.floorBaseY === null) this.floorBaseY = floor.position.y;
      const y = this.floorBaseY - GameState.floorDrop;
      if (Math.abs(floor.position.y - y) > .01) console.log(`[layout] tray floor ${floor.position.y.toFixed(1)} → ${y.toFixed(1)} (banner ${ScreenFit.adBottom.toFixed(1)}, screen ${vis.width.toFixed(0)}×${vis.height.toFixed(0)})`);
      floor.setPosition(floor.position.x, y, 0);
      // its static body at the node now too (a body only follows its node through a physics step)
      (floor.getComponent(RigidBody2D) as any)?.impl?.syncPositionToPhysics?.();
    }
  }
  private floorBaseY: number | null = null;

  /** The side walls of the field SIDE_PAD in from the screen edges: items never touch the edge */
  private padSides() {
    const env = this.node.parent!.getChildByName('Field')?.getChildByName('Environment');
    for (const [name, dx] of [['WallLeft', SIDE_PAD], ['WallRight', -SIDE_PAD]] as [string, number][]) {
      const wall = env?.getChildByName(name); if (!wall) continue;
      wall.setPosition(wall.position.x + dx, wall.position.y, 0);
      (wall.getComponent(RigidBody2D) as any)?.impl?.syncPositionToPhysics?.();
    }
  }
  /** the screen / banner changed during a round: the floor moves when the next level opens */
  private floorPending = false;

  /** Running inside the Level Editor (Editor.scene): the editor gives the level and owns the screen */
  get embedded() { return this.node.scene?.name === 'Editor'; }

  onLoad() {
    preloadIceCoat();
    if (this.embedded) ScreenFit.setEmbedded();
    else {
      ScreenFit.apply();
      // Game.scene keeps its Canvas at the design centre (Field space == physics world space)
      this.offCamera = ScreenFit.fitCamera(this.node.parent!.getComponentInChildren(Camera)!);
    }
    this.padSides();
    this.fitToScreen();
    view.on('canvas-resize', this.fitToScreen, this);   // the bag follows at the next level build
    // the banner under the dock came or went: the dock moved, the tray floor follows it (it was
    // left where the banner of Home had put it: far above the dock on some levels)
    this.offInsets = ScreenFit.onInsetsChange(() => this.fitToScreen());
    // dev builds only: hooks for automated play-testing from the browser console
    if (DEV) (globalThis as any).__ef = {
      GameState, BagRules, Sound, Analytics, physics: PhysicsSystem2D.instance, game: this,
      // dev checks: do packed items come to rest? (LevelCheck.ts) Run after adding levels / items
      checkLevels: (only?: number[]) => checkLevels(this, only),
      checkItems: (opts?: any) => checkItems(this, opts),
    };
    Overlays.startServices();
    this.builder = new LevelBuilder(this.bagLayer, this.itemLayer, this.frontLayer);
    director.on(Director.EVENT_AFTER_PHYSICS, this.afterPhysics, this);
    setBagEvents({
      onPacked: (it, count) => this.onFitted(it, count),
      onUnpacked: it => this.onFellOut(it),
      onWin: () => this.onWin(),
      onEjected: it => { wakeAll(); Sound.play('misplace'); this.hapticOut(it); this.puff(it); this.hud.toastMessage("Doesn't fit! Pushed back out"); },
    });
    setMechanicsEvents({ onBroken: it => this.onBroken(it) });
    setMysteryEvents({
      onHint: () => { if (!this.tutorial?.active) this.hud.toastMessage('Drop the box on the key to open it', 2.2); },
      open: (box, key) => this.openBox(box, key),
    });
    this.drag.events = {
      onPick: () => Sound.play('pick'),
      onSelect: it => this.tutorial?.onSelect(it),
      onRotate: (_it, deg) => this.tutorial?.onRotated(deg),
      onDrop: (it, bounced) => {
        if (bounced) { Sound.play('misplace'); this.hapticOut(it); this.puff(it); this.hud.toastMessage("Doesn't fit!"); }
        else Sound.play('drop', { gain: .9 });
      },
    };
    Shake.bind({
      onEnergy: e => this.hud.setShakeEnergy(e),
      onEmpty: () => { if (!this.shakePopupShown) { this.shakePopupShown = true; this.openShakePopup(); } },
      onJolt: () => this.tutorial?.onShaken(),
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
    this.offInsets?.();
    view.off('canvas-resize', this.fitToScreen, this);
    Shake.unbind(); Shake.reset();
    this.builder.dispose();
    const S = GameState;
    S.level = null; S.items = []; S.thrown = []; S.bag = null; S.drag = null; S.selected = null;
  }

  async start() {
    const S = GameState;
    if (this.embedded) return;   // the editor calls playLevel()
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
    // the banner under the booster dock during play (from Remote Config banner_start_level, not
    // with No Ads): placed before the level is built, so the dock and the tray floor do not move
    // under resting items; kept from level to level
    if (!this.embedded) Ads.showBanner('banner_gameplay', ContentLoader.levelNumber(S.chapterId, S.levelIndex));
    this.fitToScreen(true);   // the floor for this round (it stays put until the next level)
    this.tutorial?.stop();
    this.drag.reset();
    S.timeLeft = (S.level.timer || 90) * 1000;
    S.clock = 0; S.startTime = 0;
    PhysicsSystem2D.instance.enable = true;
    Shake.reset(); this.fx?.clear(); resetMystery();
    await Promise.all([this.builder.build(S.level), this.showBackground(S.level.background)]);
    Shake.showEnergy(); this.shakePopupShown = false;
    this.levelNumber = ContentLoader.levelNumber(S.chapterId, S.levelIndex);
    if (!this.embedded) Progress.setSpot(S.chapterId, S.levelIndex);   // the editor preview is not the player's game
    this.hud.setLevel(this.levelNumber);
    this.hud.resetClock();
    this.hud.setClock(S.timeLeft / 1000);
    this.hud.showBagHint(false);
    this.freezeShown = -1;
    this.hud.setClockFrozen(false);
    this.shakeHintOnce();
    Analytics.levelStart(this.levelNumber, S.level.id || String(S.levelIndex), S.level.difficulty?.tier);
    ContentLoader.preloadLevel(levels[(S.levelIndex + 1) % levels.length]);   // the next one, while this one is played
    this.renderBoosters();
    Sound.duckMusic(false);
    if (!this.embedded) this.maybeTutorial();
  }

  // ---------- tutorial (ui/Tutorial.ts) ----------
  /** Level 1 basics, or the intro of a booster opening at this level; once each */
  private maybeTutorial() {
    const n = this.levelNumber;
    const booster = BOOSTER_KEYS.findIndex(k => UNLOCK_LEVEL[k] === n && Tutorial.needsBooster(k));
    // the shake step waits for 3 items in the bag, on level 1 only (asked): after the basics, or
    // when level 1 is played again with the basics done but no shake shown yet
    // the first level with a mystery box shows how to open it (once)
    const mystery = !Tutorial.needsBasics(n) && booster < 0 && Tutorial.needsMystery() && GameState.items.some(it => it.locked);
    const shakeOnly = n === 1 && !Tutorial.needsBasics(n) && booster < 0 && !mystery && Tutorial.needsShake();
    if (!Tutorial.needsBasics(n) && booster < 0 && !shakeOnly && !mystery) return;
    const round = GameState.round;
    let waited = 0;
    // after the bag has shown and the items have dropped in (checked a few times a second)
    const wait = async () => {
      const S = GameState;
      if (S.round !== round || S.won || S.lost) return;
      // a fresh closure each time: the scheduler ignores re-scheduling the callback it is running
      if (!S.bagReady && (waited += .25) < 8) { this.scheduleOnce(() => wait(), .25); return; }
      const t = await this.ensureTutorial();
      if (S.round !== round || t.active) return;
      if (Tutorial.needsBasics(n)) t.startBasics(this.tutorialHost());
      else if (mystery) t.startMystery(this.tutorialHost());
      else if (shakeOnly) t.watchShake(this.tutorialHost());
      else t.startBooster(BOOSTER_KEYS[booster], this.hud.boosters[booster].root, BOOSTER_INTRO[BOOSTER_KEYS[booster]], this.tutorialHost());
    };
    this.scheduleOnce(() => wait(), 1.4);
  }

  private async ensureTutorial() {
    if (this.tutorial) return this.tutorial;
    const n = instantiate(await Overlays.loadPrefab('ui/TutorialOverlay'));
    this.node.parent!.addChild(n);
    this.tutorial = n.getComponent(Tutorial)!;
    return this.tutorial;
  }

  private tutorialHost(): TutorialHost {
    const S = GameState;
    return {
      items: () => S.items,
      // the level's solution in Field units / degrees (same conversion as LevelCheck)
      solution: () => (S.level?.solution || []).map((s: any) => ({ i: s.i, x: s.x, y: levelToFieldY(s.y - S.bagLift), angle: -s.angle * 180 / Math.PI })),
      itemLayer: this.itemLayer,
      packed: i => S.packed.has(i),
      packedCount: () => S.packed.size,
      // the clock stops and no interstitial shows while a tutorial runs
      setActive: on => { S.timerOn = !on; Ads.tutorial = on; },
    };
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
  /** Try again after a loss: the level they were for and how many in a row (Ads try_again pacing) */
  private retryLevel = -1;
  private retries = 0;

  /** the round runs (clock, physics, items raining in) only once no loading veil covers it: they
   *  fell and sounded behind the veil before */
  get running() { const S = GameState; return !!S.level && !S.won && !S.lost && !S.paused && !Overlays.covered; }

  update(dt: number) {
    const S = GameState;
    this.fx?.tick(dt);                       // effects keep playing under popups (win confetti)
    if (!S.level) return;
    const running = this.running;
    // physics stays on under the loading veil (only the clock and the drops wait for it): items
    // placed while it was off kept bodies at (0, 0) on Android and fell through the tray floor
    PhysicsSystem2D.instance.enable = !S.won && !S.lost && !S.paused;
    if (!running) return;
    const ms = dt * 1000 * S.timeScale;
    S.clock += ms;
    applyEjects();
    this.drag.tick(dt);
    this.builder.tick();
    tickTethers();                           // stretched strings pull their pairs together
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
  private onFitted(it: any, _count: number) {
    const S = GameState;
    // no chime while items are still raining in / preset items settle (web LANG_DAU_MAN)
    if (S.clock - S.startTime < 1000 || it.fitAt > S.clock - 900) return;
    it.fitAt = S.clock;
    this.tutorial?.onPacked();
    // no chime (asked): the pick and drop sounds are enough; the light pulse and the ring stay
    Sound.haptic('light');                   // doc §9: one light pulse, placed
    const p = it.node.position;
    this.fx?.ring(p.x, p.y, { color: '#5FBF9B', r1: 46 });
    this.fx?.sparkle(p.x, p.y, { n: 10, color: '#8FE0C1', life: 520 });
  }
  /** A packed item fell / was pushed out of the bag by itself */
  private onFellOut(it: any) { if (GameState.clock - GameState.startTime >= 1000) this.hapticOut(it); }
  /**
   * doc §9: two light pulses when an item bounces out. Once per change of state: an item rocking
   * on the bag edge does not buzz again within 900 ms.
   */
  private hapticOut(it: any) {
    const S = GameState;
    if (S.won || S.lost || it.outAt > S.clock - 900) return;
    it.outAt = S.clock;
    Sound.haptic('double');
  }
  /** Pink puff where an item vanished / reappeared (web S.puffs) */
  private puff(it: any) {
    const p = it.node.position;
    this.fx?.puff(p.x, p.y);
  }
  /** Tell once, on touch devices, that shaking the phone settles the bag (web goiYLacMotLan) */
  private shakeHintOnce() {
    if (!sys.isMobile || LocalStore.get('snug.shakeHint.v1')) return;
    // the tutorial's shake step teaches it: no toast on top of it
    if (Tutorial.needsBasics(this.levelNumber) || Tutorial.needsShake()) { LocalStore.set('snug.shakeHint.v1', '1'); return; }
    LocalStore.set('snug.shakeHint.v1', '1');
    this.scheduleOnce(() => this.hud.toastMessage('Shake your phone to settle items in the bag', 3.2), 1.2);
  }

  private afterPhysics() {
    if (!this.running) return;
    checkEject(GameState.clock);
    updatePacked(GameState.clock);
    tickSettle(director.getDeltaTime());   // packed clusters that only twitch go to sleep
    tickMystery();
    drawTethers(this.builder.strings);
  }

  /**
   * A released mystery box touched the key (web mechanics.js checkUnlock): puffs where both were,
   * the box becomes its item right there (a bigger item pushes its neighbours aside), a gold ring
   * and sparkles
   */
  private openBox(box: any, key: any) {
    const fx = this.fx, bp = box.node.position.clone(), kp = key.node.position;
    fx?.puff(bp.x, bp.y); fx?.puff(kp.x, kp.y);
    const item = this.builder.openBox(box, key);
    if (!item) return;
    this.tutorial?.onBoxOpened();
    wakeAll();
    Sound.play('unlockLv');
    fx?.ring(bp.x, bp.y, { color: '#E2B04A', r1: 64, life: 620, width: 5 });
    fx?.sparkle(bp.x, bp.y, { n: 18, color: '#FFD98A', speed: 1.4, life: 780 });
    this.hud.toastMessage(`Unlocked: ${item.nameEn || item.nameVi}!`, 1.6);
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
    if (wasFreezing && !freezing) { wakeAll(); this.hud.setClockFrozen(false); }   // thawed: items settle again
    const sec = freezing ? Math.ceil(freezeLeft() / 1000) : 0;
    if (sec !== this.freezeShown) { this.freezeShown = sec; this.renderBoosters(); }
  }

  private useBooster(id: BoosterId) {
    const S = GameState;
    const key = BOOSTER_KEYS[id];
    if (S.won || S.lost || S.paused || !Boosters.isUnlocked(key, this.levelNumber)) return;
    if (Boosters.count(key) <= 0) { if (!this.embedded) this.openBoosterShop(); return; }   // none left: buy more
    if (key === 'freeze') {
      if (!startFreeze()) return;
      Boosters.use('freeze');
      this.hud.setClockFrozen(true);
      Sound.play('booster');
      const b = S.bag;
      if (b && this.fx) { const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2; this.fx.ring(cx, cy, { color: '#7FC8F0', r1: 150, life: 600 }); this.fx.sparkle(cx, cy, { n: 26, color: '#BFE6FA', speed: 1.6 }); }
      this.hud.toastMessage(`Frozen for ${FREEZE_MS / 1000}s: the clock stops, items stay where you drop them`);
    } else if (key === 'resize') {
      const it = shrinkBiggestOutside();
      if (!it) { Sound.play('nope'); this.hud.toastMessage('Nothing left outside the bag'); return; }
      Boosters.use('resize');
      wakeAll();
      Sound.play('booster');
      const p = it.node.position;
      this.puff(it); this.fx?.ring(p.x, p.y, { color: '#3D8BFF', r1: 40, life: 420 }); this.fx?.floatText(p.x, p.y + 18, '−20%', { color: '#2A66C8' });
      this.hud.toastMessage(`Shrunk ${it.nameEn || it.nameVi} by 20%`);
    } else {
      const it = throwOne();
      if (!it) { Sound.play('nope'); this.hud.toastMessage('Nothing can be thrown out'); return; }
      Boosters.use('throw');
      wakeAll();
      Sound.play('booster');
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
      // the level jump buttons are for the Level Editor preview only; the version line is also where
      // testers turn the level picker on
      inGame: true, version: ContentLoader.book?.version, devLevels: this.embedded,
      levelPicker: this.embedded ? undefined : { count: S.chapter.levels.length, current: S.levelIndex, onPick: i => this.pickLevel(i) },
      onClose: () => { S.paused = wasPaused; Sound.duckMusic(false); },
      onHome: () => this.goHome(),
      onRestart: () => { S.paused = false; this.restart(); },
      onPrevLevel: () => this.jumpLevel(-1),
      onNextLevel: () => this.jumpLevel(1),
    });
  }

  /**
   * A booster with none left was tapped: the clock stops and a short popup offers more (for gold
   * or a bundle, as in the Shop); the round goes on when it is closed.
   */
  private async openBoosterShop() {
    const S = GameState;
    if (S.won || S.lost || S.paused) return;
    S.paused = true;
    Sound.duckMusic(true);
    await openBoosterShop(() => { S.paused = false; Sound.duckMusic(false); this.renderBoosters(); });
  }

  private async openShakePopup() {
    const S = GameState;
    if (S.won || S.lost || S.paused) return;
    S.paused = true;
    const p = await showPopup('ShakePopup', ShakePopup);
    p.open({ onRefill: () => { ShakeEnergy.refill(); Shake.showEnergy(); }, onClose: () => { S.paused = false; } });
  }

  /**
   * Level Editor preview (web editor's postMessage 'level'): play `level` as level `index` of
   * `chapter`, built from scratch like opening it in the game. The level object is used as is.
   */
  async playLevel(level: any, chapter: { id: string; levels: any[] }, index: number) {
    const S = GameState;
    S.chapter = chapter; S.chapterId = chapter.id;
    chapter.levels[index] = level;
    Sound.startMusic();
    await this.openLevel(index);
  }

  goHome() {
    if (this.embedded) { this.restart(); return; }   // no Home inside the editor
    this.tutorial?.stop();
    Ads.hideBanner();
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
    if (sec !== before && sec <= 10 && sec > 0) Sound.play('clockTick', { gain: .55 });   // last ten seconds tick
    this.hud.setClock(S.timeLeft / 1000);
    if (S.timeLeft <= 0) this.onLose(null);
  }

  private onWin() {
    const S = GameState;
    this.tutorial?.stop();
    Analytics.levelEnd('win');
    const first = !this.embedded && Progress.markDone(S.chapterId, S.levelIndex);
    if (!this.embedded) Progress.setSpot(S.chapterId, Math.min(S.levelIndex + 1, S.chapter.levels.length - 1));
    if (first && S.levelIndex + 1 < S.chapter.levels.length) Sound.play('unlockLv', { delay: 1.15, gain: .9 });
    const reward = S.level?.reward?.coin ?? 20;
    if (!this.embedded) Wallet.add(reward);
    // doc §5: the bag has settled (WIN_FRAMES): a soft "done"; the popup carries the celebration
    Sound.play('win'); Sound.duckMusic(true);
    this.fx?.floatText(210, levelToFieldY(300), 'It fits!', { color: '#5FBF9B', size: 26, life: 1200 });
    const score = scoreRound();
    this.scheduleOnce(async () => {
      if (!S.won) return;
      const p = await showPopup('WinPopup', WinPopup);
      this.showResultBanner();
      p.open({
        levelNumber: this.levelNumber, seconds: score.secondsUsed, reward,
        shareLine: winShareLine(this.levelNumber, playDifficultyOf(GameState.level)),
        stars: Math.max(1, Math.min(3, Math.round(score.stars * 3 / 5))), mistake: score.mistakes[0] || null,
        onContinue: () => this.nextLevel(true),
        onHome: () => this.goHome(),
        onCollectX2: () => Wallet.add(reward),
      });
    }, WIN_POPUP_DELAY);
  }

  /** Testers' level picker (Settings): the player is now at that level, opened behind the veil */
  private async pickLevel(index: number) {
    const S = GameState;
    S.paused = false; Sound.duckMusic(false);
    Progress.jumpTo(S.chapterId, index);
    Analytics.setReason('next');
    await Overlays.cover();
    await this.openLevel(index);
    await Overlays.uncover();
  }

  /** Level Editor preview buttons: the previous / next level of the chapter (wrapping), behind the veil */
  private async jumpLevel(step: number) {
    const S = GameState, n = S.chapter.levels.length;
    S.paused = false; Sound.duckMusic(false);
    Analytics.setReason('next');
    await Overlays.cover();
    await this.openLevel((S.levelIndex + step + n) % n);
    await Overlays.uncover();
  }

  /** Result popups (win / lose): the gameplay banner stays (it is already there from openLevel) */
  private showResultBanner() { if (!this.embedded) Ads.showBanner('banner_gameplay', this.levelNumber); }

  /**
   * web level.js nextLevel: the following level of the chapter, wrapping after the last one; behind
   * the veil. After Continue on the win popup: interstitial trigger level_win.
   */
  private async nextLevel(fromWin = false) {
    Analytics.setReason('next');
    const S = GameState;
    // the loading screen first, the interstitial over it: closing the ad shows the loading screen,
    // not this level again for a moment
    await Overlays.cover();
    if (fromWin && !this.embedded) await Ads.interstitial('level_win', this.levelNumber);
    await this.openLevel((S.levelIndex + 1) % S.chapter.levels.length);
    await Overlays.uncover();
  }

  /** Time is up (no reason) or an item broke (reason, no extra time) */
  /**
   * A fragile item broke: play stops, the cracks spread a moment, the item shatters into shards
   * that fly and fall, and only then the lose popup (the player sees what happened)
   */
  private onBroken(it: ItemView) {
    const S = GameState;
    if (S.lost || S.won) return;
    const round = S.round;
    this.onLose(`${it.nameEn || it.nameVi} broke!`, SHATTER_AT + SHARDS_FALL);
    this.scheduleOnce(() => {
      if (S.round !== round || !it.node.isValid) return;
      // its outline in Field space (the shapes already are)
      const fx = this.fx, m = it.node.worldMatrix;
      const pts = it.outline.length >= 3 ? it.outline.map(p => Vec2.transformMat4(new Vec2(), p, m)) : it.shapes[0].map(p => p.clone());
      const r = it.bounds;
      Sound.play('break', { gain: .55 });   // was .95: too loud
      fx?.shake(420);
      fx?.dropCracks(it.node);
      fx?.shatter(pts, r.x + r.width / 2, r.y + r.height / 2, it.material);
      it.node.active = false;
    }, SHATTER_AT);
  }

  private async onLose(reason: string | null = null, delay = 0) {
    const S = GameState;
    if (S.lost || S.won) return;
    S.lost = true;
    this.tutorial?.stop();
    Analytics.levelEnd('lose');
    if (delay) {
      const round = S.round;
      await new Promise<void>(done => this.scheduleOnce(() => done(), delay));
      if (S.round !== round) return;
    }
    Sound.play('lose'); Sound.duckMusic(true);
    this.fx?.shake(420);
    const p = await showPopup('LosePopup', LosePopup);
    this.showResultBanner();
    p.open({
      itemsLeft: Math.max(0, S.itemsToPack - S.packed.size), reason,
      // Try again: the same level from the start. The interstitial (trigger level_lose) follows the
      // Try agains in a row on this level: Remote Config inter_pacing_config.lose_screen.try_again
      // ([2] by default: not the first one, the 2nd, 4th…), the other ad rules as usual
      onRetry: async () => {
        if (this.retryLevel !== S.levelIndex) { this.retryLevel = S.levelIndex; this.retries = 0; }
        this.retries++;
        if (!this.embedded) await Ads.interstitial('level_lose', this.levelNumber, this.retries);
        this.restart();
      },
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
