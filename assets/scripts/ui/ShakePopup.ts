// "Shake energy empty" popup (web hud.js moPopupLac): watch an ad to refill the shake bar,
// or Not now / X to keep playing without shaking.
import { _decorator, Component, Node } from 'cc';
import { findNode, tap, openPopup, closePopup } from './UiKit';
import { Overlays } from './Overlays';
const { ccclass } = _decorator;

export type ShakeOptions = { onRefill: () => void; onClose: () => void };

@ccclass('ShakePopup')
export class ShakePopup extends Component {
  private card: Node = null!;
  private opts: ShakeOptions = null!;
  private adEnable: (on: boolean) => void = () => {};

  onLoad() {
    const n = this.node;
    this.card = findNode(n, 'efp-card')!;
    const close = () => closePopup(n, () => this.opts.onClose());
    tap(findNode(n, 'shakeX'), close, 'tap', this);
    tap(findNode(n, 'shakeNo'), close, 'tap', this);
    this.adEnable = tap(findNode(n, 'shakeAd'), async () => {
      this.adEnable(false);
      const full = await Overlays.rewarded('refill_energy');
      this.adEnable(true);
      if (full) { this.opts.onRefill(); close(); }
    }, 'tapBig', this);
  }

  get isOpen() { return this.node.active; }
  open(o: ShakeOptions) { this.opts = o; openPopup(this.node, this.card); }
}
