// Level complete popup (web hud.js showWin, Figma "EF · Reward"):
//   LEVEL N COMPLETE! · Packed! · three stars popping in · time used and gold reward ·
//   Continue / Collect ×2 (rewarded ad).
import { _decorator, Component, Node, Sprite, SpriteFrame, resources, Color, Vec3, tween, Tween, UIOpacity, UITransform } from 'cc';
import { findNode, findAll, setText, tap, openPopup, closePopup } from './UiKit';
import { RoundRect } from './RoundRect';
import { Overlays } from './Overlays';
import { Sound } from '../audio/Sound';
const { ccclass } = _decorator;

const DONE_BG = new Color(0xDC, 0xE4, 0xD2, 255), DONE_BORDER = new Color(0x9D, 0xB8, 0x9A, 255);

export type WinOptions = {
  levelNumber: number; seconds: number; reward: number; stars: number; mistake?: string | null;
  onContinue: () => void; onHome: () => void; onCollectX2: () => void;
};

let starFrames: Promise<[SpriteFrame | null, SpriteFrame | null]> | null = null;
const frame = (p: string) => new Promise<SpriteFrame | null>(ok => resources.load(p, SpriteFrame, (e, f) => ok(e ? null : f)));

@ccclass('WinPopup')
export class WinPopup extends Component {
  private card: Node = null!;
  private stars: Node[] = [];
  private x2: Node = null!;
  private x2Enable: (on: boolean) => void = () => {};
  private x2Face: RoundRect | null = null;
  private x2Fill = new Color(); private x2Border = new Color();
  private opts: WinOptions = null!;
  private collected = false;

  onLoad() {
    const n = this.node;
    this.card = findNode(n, 'efp-card')!;
    this.stars = findAll(n, 'star');
    this.x2 = findNode(n, 'winX2')!;
    this.x2Face = this.x2.getComponent(RoundRect);
    if (this.x2Face) { this.x2Fill.set(this.x2Face.fill); this.x2Border.set(this.x2Face.borderColor); }
    tap(findNode(n, 'next'), () => { closePopup(n); this.opts.onContinue(); }, 'tapBig', this);
    tap(findNode(n, 'winHome'), () => { closePopup(n); this.opts.onHome(); }, 'tap', this);
    this.x2Enable = tap(this.x2, () => this.collectX2(), 'tapBig', this);
    starFrames ||= Promise.all([frame('uiart/icons/star/spriteFrame'), frame('uiart/icons/star-off/spriteFrame')]);
    this.dropMistakeLine();
  }

  /**
   * No packing-mistake line (it showed in red, with item names in two languages): hide it and close
   * the gap. The buttons move up into its place and the card gets shorter by as much, the top
   * part keeps its distances.
   */
  private dropMistakeLine() {
    const kieu = findNode(this.card, 'winKieu'), score = findNode(this.card, 'winScore');
    const cardUi = this.card.getComponent(UITransform);
    if (!kieu || !score || !cardUi) return;
    const h = (x: Node) => x.getComponent(UITransform)?.height ?? 0;
    const d = (score.position.y - h(score) / 2) - (kieu.position.y - h(kieu) / 2);   // gap above + line
    kieu.active = false;
    for (const c of this.card.children) {
      if (c === kieu) continue;
      c.setPosition(c.position.x, c.position.y + (c.position.y < kieu.position.y ? d / 2 : -d / 2), 0);
    }
    cardUi.height -= d;
  }

  async open(o: WinOptions) {
    this.opts = o; this.collected = false;
    const n = this.node;
    setText(findNode(n, 'winLevel'), `LEVEL ${o.levelNumber} COMPLETE!`);
    setText(findNode(n, 'winRank'), 'Packed!');
    setText(findNode(n, 'winPct'), 'Only 18% made it this far.');
    setText(findNode(n, 'winText'), 'Nice packing!');
    const stats = findNode(n, 'winScore')!;
    const m = Math.floor(o.seconds / 60), s = Math.max(0, o.seconds) % 60;
    setText(findNode(stats, 'b'), `${m}:${s < 10 ? '0' : ''}${s}`);
    setText(findNode(n, 'winCoin'), `+${o.reward}`);
    this.setX2Done(false);
    openPopup(n, this.card);
    Sound.play('star', { delay: .1 });
    const [on, off] = await starFrames!;
    this.stars.forEach((st, i) => {
      const sp = st.getComponent(Sprite)!;
      sp.spriteFrame = i < o.stars ? on : off;
      Tween.stopAllByTarget(st);
      st.setScale(0, 0, 1);
      // web starPop .5 s cubic-bezier(.2,.9,.3,1.8), delays .1 / .22 / .34 s
      tween(st).delay(.1 + i * .12).to(.5, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
    });
  }

  private async collectX2() {
    if (this.collected) return;
    if (!Overlays.adAvailable()) { Overlays.toast('Ad unavailable. Try again later.'); return; }
    this.x2Enable(false);
    const full = await Overlays.watchAd();
    if (!full) { this.x2Enable(true); return; }
    this.collected = true;
    this.opts.onCollectX2();
    setText(findNode(this.node, 'winCoin'), `+${this.opts.reward * 2}`);
    this.setX2Done(true);
    Sound.play('unlockLv', { gain: .7 });
  }

  /** web .efbtn.done: pale green, "Collected", no longer pressable */
  private setX2Done(done: boolean) {
    setText(findNode(this.x2, 'span'), done ? 'Collected' : 'Collect ×2');
    if (this.x2Face) this.x2Face.setColors(done ? DONE_BG : this.x2Fill, done ? DONE_BORDER : this.x2Border);
    this.x2Enable(!done);
    if (done) (this.x2.getComponent(UIOpacity) || this.x2.addComponent(UIOpacity)).opacity = 255;   // web .done keeps full opacity
  }
}
