// Controller of the Main scene: Home and Shop screens, the Settings popup, and the jump into a
// level (Game scene). Holds no per-frame logic.
import { _decorator, Component, director, Prefab, instantiate } from 'cc';
import { HomeScreen } from './HomeScreen';
import { ShopScreen } from './ShopScreen';
import { SettingsPopup } from './SettingsPopup';
import { showPopup } from './PopupHost';
import { ContentLoader } from '../content/ContentLoader';
import { Progress } from '../services/Progress';
import { GameState } from '../core/GameState';
import { Sound } from '../audio/Sound';
import { SplashView } from './SplashView';
import { Analytics } from '../services/Analytics';
import { Overlays } from './Overlays';

/** The splash plays once per app launch, not when coming back from a level */
let splashPlayed = false;
import { ScreenFit } from './ScreenFit';
const { ccclass, property } = _decorator;

@ccclass('MainMenu')
export class MainMenu extends Component {
  private home: HomeScreen = null!;
  private shop: ShopScreen | null = null;
  private book: any = null;

  onLoad() {
    ScreenFit.apply();
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
    const splash = splashPlayed ? null : SplashView.play(this.node.parent!);
    splashPlayed = true;
    await this.buildScreens();
    this.book = await ContentLoader.loadBook();
    Sound.preload();
    Sound.startMusic();
    this.openHome();
    if (covered) Overlays.uncover();
    // while the player looks at Home: everything the level needs, so Play opens it at once
    const s = this.spot();
    if (s) ContentLoader.preloadChapter(s.chapter);
    Overlays.loadPrefab('ui/SettingsPopup');
    await splash;
    this.ensureShop();   // after the splash: ready before the first tap on Shop
  }

  private spot() { return Progress.getSpot(ContentLoader.chapters()); }

  private openHome() {
    if (this.shop) this.shop.node.active = false;
    this.home.node.active = true;
    const s = this.spot();
    if (s) this.home.show(ContentLoader.levelNumber(s.chapter.id, s.index), s.chapter.levels[s.index]);
  }

  private async openShop(toGold: boolean) { const shop = await this.ensureShop(); this.home.node.active = false; shop.show(toGold); }

  private async openSettings() {
    const p = await showPopup('SettingsPopup', SettingsPopup);
    p.open({ inGame: false, version: this.book?.version });
  }

  private play() {
    const s = this.spot(); if (!s) return;
    GameState.chapter = s.chapter; GameState.chapterId = s.chapter.id; GameState.levelIndex = s.index;
    GameState.fromMenu = true;
    Analytics.setReason('home');
    Overlays.cover(true).then(() => director.loadScene('Game'));
  }
}
