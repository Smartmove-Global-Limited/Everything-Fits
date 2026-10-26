// Main menu (web src/ui/menu.js, Figma "EF · Main Menu"): gold with "+" (opens the shop at the
// gold packs), settings gear, mascot, Play button "Level N" coloured by the level difficulty,
// bottom bar Shop / Home.
import { _decorator, Component, Node, Color } from 'cc';
import { Overlays } from './Overlays';
import { findNode, setText, tap, fitGoldPill } from './UiKit';
import { RoundRect } from './RoundRect';
import { Wallet, formatNumber } from '../services/Wallet';
import { playDifficultyOf, PlayDifficulty } from '../core/PlayDifficulty';
const { ccclass } = _decorator;

/** Play button colours by the level's playDifficulty (Figma EF / Play · Difficulty): fill, lip */
const KIND: Record<PlayDifficulty, [Color, Color]> = {
  Easy: [new Color(0x34, 0x74, 0x50, 255), new Color(0x24, 0x53, 0x3A, 255)],
  Hard: [new Color(0xA9, 0x71, 0x3F, 255), new Color(0x7E, 0x51, 0x29, 255)],
  'Super Hard': [new Color(0xA9, 0x4F, 0x50, 255), new Color(0x7A, 0x36, 0x37, 255)],
};

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

  /** Refresh gold and the Play button for the level about to be played */
  show(levelNumber: number, level: any) {
    this.node.active = true;
    this.showGold(formatNumber(Wallet.gold));
    setText(findNode(this.node, 'mPlayLv'), `Level ${levelNumber}`);
    const [bg, edge] = KIND[playDifficultyOf(level)];
    if (this.play) { this.play.fill = bg; this.play.lipColor = edge; }
  }
}
