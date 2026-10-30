// Controller of the Main scene: Home and Shop screens, the Settings popup, and the jump into a
// level (Game scene). Holds no per-frame logic.
import { _decorator, Component, director, Prefab, instantiate } from 'cc';
import { HomeScreen } from './HomeScreen';
import { ShopScreen } from './ShopScreen';
import { SettingsPopup } from './SettingsPopup';
import { AllDonePopup } from './AllDonePopup';
import { showPopup } from './PopupHost';
import { ContentLoader } from '../content/ContentLoader';
import { Progress } from '../services/Progress';
import { GameState } from '../core/GameState';
import { Sound } from '../audio/Sound';
import { SplashView } from './SplashView';
import { Analytics } from '../services/Analytics';
import { NativeBridge } from '../services/NativeBridge';
import { Overlays } from './Overlays';
import { Ads } from '../services/Ads';
import { RemoteConfig } from '../services/RemoteConfig';

/** The splash plays once per app launch, not when coming back from a level */
let splashPlayed = false;
import { ScreenFit } from './ScreenFit';
const { ccclass, property } = _decorator;

@ccclass('MainMenu')
export class MainMenu extends Component {
  private home: HomeScreen = null!;
  private shop: ShopScreen | null = null;
  private book: any = null;
  /** no banner over the splash: Home shows it once the splash is gone */
  private splashDone = false;

  /** Remote Config → ads → store, started now; the splash waits for it */
  private services: Promise<unknown> = Promise.resolve();
  /** Play was pressed: the banner must not come back for Home while the scene changes */
  private leaving = false;

  onLoad() {
    ScreenFit.apply();
    this.services = Overlays.startServices();
    director.preloadScene('Game');
  }

  /** Home and Shop come from resources/ui (regenerated from the web UI, so loaded by path, not uuid) */
  private async buildScreens() {
    const home = await Overlays.loadPrefab('ui/HomeScreen');
    this.home = this.add(home).getComponent(HomeScreen)!;
    this.home.actions = { onPlay: () => this.play(), onShop: toGold => this.openShop(toGold), onSettings: () => this.openSettings() };
  }
  private add(p: Prefab) { const n = instantiate(p); this.node.parent!.insertChild(n, this.node.getSiblingIndex()); return n; }

  /** The Shop (215 nodes) is built the first time it is opened, then kept */
  private async ensureShop() {
    if (this.shop) return this.shop;
    this.shop = this.add(await Overlays.loadPrefab('ui/ShopScreen')).getComponent(ShopScreen)!;
    this.shop.actions = { onHome: () => this.openHome(), onSettings: () => this.openSettings() };
    this.shop.node.active = false;
    return this.shop;
  }

  async start() {
    const covered = Overlays.startCoveredIfPending();
    // The native launch cover stays until the splash has drawn (else a black frame shows while the
    // first shaders compile). Home is built only once the splash is on screen, and the preloads
    // wait until it is gone: nothing heavy runs before the first picture or during its animation.
    let shown: () => void = () => {};
    const onScreen = new Promise<void>(res => (shown = res));
    const splash = splashPlayed ? null : SplashView.play(this.node.parent!, () => { NativeBridge.hideLaunchCover(); shown(); }, this.services);
    splashPlayed = true;
    if (splash) { await onScreen; await new Promise(r => this.scheduleOnce(r, .8)); }   // after the items have popped in
    await this.buildScreens();
    // the levels may come from Remote Config (levels): wait for this launch's answer first
    // (the splash covers the wait; it gives up after a few seconds and keeps the saved values)
    await RemoteConfig.start();
    this.book = await ContentLoader.loadBook();
    Sound.preload();
    Sound.startMusic();
    this.splashDone = !splash;
    this.openHome();
    if (covered) Overlays.uncover();
    await splash;
    if (!this.splashDone) { this.splashDone = true; if (this.home.node.active && !this.leaving) Ads.showBanner('banner_main_menu', this.playerLevel()); }
    // while the player looks at Home: the bag and items of the level Play opens, nothing more
    const s = this.spot();
    if (s) ContentLoader.preloadLevel(s.chapter.levels[s.index]);
    Overlays.loadPrefab('ui/SettingsPopup');
    this.ensureShop();   // ready before the first tap on Shop
  }

  private spot() { return Progress.getSpot(ContentLoader.chapters()); }

  private openHome() {
    if (this.shop) this.shop.node.active = false;
    this.home.node.active = true;
    const s = this.spot();
    if (s) this.home.show(ContentLoader.levelNumber(s.chapter.id, s.index), s.chapter.levels[s.index]);
    if (this.splashDone) Ads.showBanner('banner_main_menu', this.playerLevel());
    // behind the splash: once the start-up knows No Ads, keep the banner's place, so the bars are
    // already above it when the splash goes (the ad itself shows after the splash)
    else this.services.then(() => { if (!this.splashDone && !this.leaving && this.home.node.active) Ads.reserveBanner('banner_main_menu', this.playerLevel()); });
  }

  private async openShop(toGold: boolean) {
    const shop = await this.ensureShop(); this.home.node.active = false; shop.show(toGold);
    Ads.showBanner('banner_shop', this.playerLevel());
  }

  /** Level the player is at (the one Play opens), for banner_start_level */
  private playerLevel() { const s = this.spot(); return s ? ContentLoader.levelNumber(s.chapter.id, s.index) : 1; }

  private async openSettings() {
    const p = await showPopup('SettingsPopup', SettingsPopup);
    const s = this.spot();
    p.open({
      inGame: false,
      version: ContentLoader.book?.version,   // its line is also where testers turn the level picker on
      levelPicker: s ? { count: s.chapter.levels.length, current: s.index, onPick: i => this.pickLevel(s.chapter, i) } : undefined,
    });
  }

  /** Testers' level picker: the player is now at that level, and it opens */
  private pickLevel(chapter: any, index: number) {
    Progress.jumpTo(chapter.id, index);
    this.play();
  }

  private async play() {
    const s = this.spot(); if (!s) return;
    if (Progress.finishedAll(ContentLoader.chapters())) { (await showPopup('AllDonePopup', AllDonePopup)).open(() => {}); return; }
    GameState.chapter = s.chapter; GameState.chapterId = s.chapter.id; GameState.levelIndex = s.index;
    GameState.fromMenu = true;
    Analytics.setReason('home');
    this.leaving = true;
    Ads.hideBanner();                       // gone while the game loads; the game shows its own (openLevel)
    Overlays.cover(true).then(() => director.loadScene('Game'));
  }
}
