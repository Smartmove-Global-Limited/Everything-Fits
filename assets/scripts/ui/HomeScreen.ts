// Main menu (web src/ui/menu.js, Figma "EF · Main Menu"): gold with "+" (opens the shop at the
// gold packs), settings gear, mascot, Play button "Level N" coloured by the level difficulty,
// bottom bar Shop / Home.
import { _decorator, Component, Node, Color } from 'cc';
import { findNode, setText, tap } from './UiKit';
import { RoundRect } from './RoundRect';
import { Wallet, formatNumber } from '../services/Wallet';
const { ccclass } = _decorator;

/** Play button colours by difficulty tier (web .efm-play[data-kind]) */
const KIND: Record<string, [Color, Color]> = {
  easy: [new Color(0x34, 0x74, 0x50, 255), new Color(0x24, 0x53, 0x3A, 255)],
  hard: [new Color(0xA9, 0x71, 0x3F, 255), new Color(0x7E, 0x51, 0x29, 255)],
  super: [new Color(0x80, 0x63, 0x9D, 255), new Color(0x5B, 0x45, 0x73, 255)],
};
const TIER: Record<string, string> = { Easy: 'easy', Medium: 'easy', Hard: 'hard', 'Very Hard': 'super', Challenge: 'super' };

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
    this.offGold = Wallet.onChange(g => setText(this.gold, formatNumber(g)));
  }
  onDestroy() { this.offGold?.(); }

  /** Refresh gold and the Play button for the level about to be played */
  show(levelNumber: number, level: any) {
    this.node.active = true;
    setText(this.gold, formatNumber(Wallet.gold));
    setText(findNode(this.node, 'mPlayLv'), `Level ${levelNumber}`);
    const [bg, edge] = KIND[TIER[level?.difficulty?.tier] || 'easy'];
    if (this.play) { this.play.fill = bg; this.play.lipColor = edge; }
  }
}
