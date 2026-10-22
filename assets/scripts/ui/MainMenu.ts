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

/** The splash plays once per app launch, not when coming back from a level */
let splashPlayed = false;
const { ccclass, property } = _decorator;

@ccclass('MainMenu')
export class MainMenu extends Component {
  @property({ type: Prefab, tooltip: 'resources/ui/HomeScreen (built from the web UI)' }) homePrefab: Prefab = null!;
  @property({ type: Prefab, tooltip: 'resources/ui/ShopScreen (built from the web UI)' }) shopPrefab: Prefab = null!;

  private home: HomeScreen = null!;
  private shop: ShopScreen = null!;
  private book: any = null;

  onLoad() {
    const canvas = this.node.parent!;
    const add = (p: Prefab) => { const n = instantiate(p); canvas.insertChild(n, this.node.getSiblingIndex()); return n; };
    this.home = add(this.homePrefab).getComponent(HomeScreen)!;
    this.shop = add(this.shopPrefab).getComponent(ShopScreen)!;
    this.home.actions = { onPlay: () => this.play(), onShop: toGold => this.openShop(toGold), onSettings: () => this.openSettings() };
    this.shop.actions = { onHome: () => this.openHome(), onSettings: () => this.openSettings() };
    this.shop.node.active = false;
    director.preloadScene('Game');
  }

  async start() {
    const splash = splashPlayed ? null : SplashView.play(this.node.parent!);
    splashPlayed = true;
    this.book = await ContentLoader.loadBook();
    Sound.preload();
    Sound.startMusic();
    this.openHome();
    await splash;
  }

  private spot() { return Progress.getSpot(ContentLoader.chapters()); }

  private openHome() {
    this.shop.node.active = false;
    const s = this.spot();
    if (s) this.home.show(ContentLoader.levelNumber(s.chapter.id, s.index), s.chapter.levels[s.index]);
  }

  private openShop(toGold: boolean) { this.home.node.active = false; this.shop.show(toGold); }

  private async openSettings() {
    const p = await showPopup('SettingsPopup', SettingsPopup);
    p.open({ inGame: false, version: this.book?.version });
  }

  private play() {
    const s = this.spot(); if (!s) return;
    GameState.chapter = s.chapter; GameState.chapterId = s.chapter.id; GameState.levelIndex = s.index;
    GameState.fromMenu = true;
    Analytics.setReason('home');
    director.loadScene('Game');
  }
}
