// Main menu (web src/ui/menu.js, Figma "EF · Main Menu"): gold with "+" (opens the shop at the
// gold packs), settings gear, mascot, Play button "Level N" coloured by the level difficulty,
// bottom bar Shop / Home.
import { _decorator, Component, Node } from 'cc';
import { Overlays } from './Overlays';
import { findNode, setText, tap, fitGoldPill } from './UiKit';
import { RoundRect } from './RoundRect';
import { Wallet, formatNumber } from '../services/Wallet';
import { playDifficultyOf, PLAY_COLORS } from '../core/PlayDifficulty';
const { ccclass } = _decorator;

/** Play button colours by the level's playDifficulty */
const KIND = PLAY_COLORS;

export type HomeActions = { onPlay: () => void; onShop: (toGold: boolean) => void; onSettings: () => void };

@ccclass('HomeScreen')
export class HomeScreen extends Component {
  actions: HomeActions | null = null;
  private gold: Node = null!;
  private play: RoundRect | null = null;
  private offGold: (() => void) | null = null;

  onLoad() {
    const n = this.node;
    this.gold = findNode(n, 'mGold')!;
    const playNode = findNode(n, 'mPlay')!;
    this.play = playNode.getComponent(RoundRect);
    tap(playNode, () => this.actions?.onPlay(), 'tapBig', this);
    tap(findNode(n, 'mAddGold'), () => this.actions?.onShop(true), 'tap', this);
    tap(findNode(n, 'mSettings'), () => this.actions?.onSettings(), 'tap', this);
    tap(findNode(n, 'mTabShop'), () => this.actions?.onShop(false), 'tap', this);
    tap(findNode(n, 'mTabHome'), () => {}, 'tap', this);
    tap(findNode(n, 'mTabSoon'), () => Overlays.comingSoon(findNode(n, 'efm-nav')!), 'tap', this);
    this.offGold = Wallet.onChange(g => this.showGold(formatNumber(g)));
  }
  /** Amount on the gold pill, the pill hugging it */
  private showGold(text: string) { setText(this.gold, text); fitGoldPill(this.gold); }

  onDestroy() { this.offGold?.(); }

  /**
   * Refresh gold and the Play button for the level about to be played. `allDone`: every level there
   * is has been won (Progress.finishedAll): "Coming Soon" under Play until new levels come
   */
  show(levelNumber: number, level: any, allDone = false) {
    this.node.active = true;
    this.showGold(formatNumber(Wallet.gold));
    setText(findNode(this.node, 'mPlayLv'), allDone ? 'Coming Soon' : `Level ${levelNumber}`);
    const [bg, edge] = KIND[allDone ? 'Easy' : playDifficultyOf(level)];
    if (this.play) { this.play.fill = bg; this.play.lipColor = edge; }
  }
}
