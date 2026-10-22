// Lose popup (web hud.js showLose, Figma "EF · Lose"): time ran out → "So close!", items left,
// Try again / +60 sec (rewarded ad). A broken item → "Oops!" with the reason, no extra time.
import { _decorator, Component, Node } from 'cc';
import { findNode, setText, tap, openPopup, closePopup } from './UiKit';
import { Overlays } from './Overlays';
const { ccclass } = _decorator;

export type LoseOptions = { itemsLeft: number; reason?: string | null; onRetry: () => void; onExtraTime: () => void; onHome: () => void };

@ccclass('LosePopup')
export class LosePopup extends Component {
  private card: Node = null!;
  private extra: Node = null!;
  private sub: Node = null!;
  private extraEnable: (on: boolean) => void = () => {};
  private opts: LoseOptions = null!;

  onLoad() {
    const n = this.node;
    this.card = findNode(n, 'efp-card')!;
    this.extra = findNode(n, 'extraTime')!;
    this.sub = findNode(n, 'loseSub')!;
    tap(findNode(n, 'retry'), () => { closePopup(n); this.opts.onRetry(); }, 'tapBig', this);
    tap(findNode(n, 'loseHome'), () => { closePopup(n); this.opts.onHome(); }, 'tap', this);
    this.extraEnable = tap(this.extra, () => this.extraTime(), 'tapBig', this);
  }

  open(o: LoseOptions) {
    this.opts = o;
    const n = this.node;
    const left = o.itemsLeft;
    setText(findNode(n, 'loseText'), o.reason || `${left} ${left === 1 ? 'item' : 'items'} still out of the bag.`);
    setText(findNode(n, 'efp-title'), o.reason ? 'Oops!' : 'So close!');
    this.sub.active = !o.reason;
    this.extra.active = !o.reason;
    this.extraEnable(true);
    openPopup(n, this.card);
  }

  private async extraTime() {
    if (!Overlays.adAvailable()) { Overlays.toast('Ad unavailable. Try again later.'); return; }
    this.extraEnable(false);
    const full = await Overlays.watchAd();
    this.extraEnable(true);
    if (full) { closePopup(this.node); this.opts.onExtraTime(); }
  }
}
