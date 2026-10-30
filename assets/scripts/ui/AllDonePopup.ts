// "You've played them all!" popup: the player won the last level there is (Next on the win popup,
// or Play on Home afterwards). New levels come with an update or Remote Config; Back to Home / X.
import { _decorator, Component, Node } from 'cc';
import { findNode, tap, openPopup, closePopup } from './UiKit';
import { Sound } from '../audio/Sound';
const { ccclass } = _decorator;

@ccclass('AllDonePopup')
export class AllDonePopup extends Component {
  private card: Node = null!;
  private onClose: () => void = () => {};

  onLoad() {
    const n = this.node;
    this.card = findNode(n, 'efp-card')!;
    const close = () => { Sound.play('menuClose'); closePopup(n, () => this.onClose()); };
    tap(findNode(n, 'doneX'), close, null, this);
    tap(findNode(n, 'doneOk'), close, 'tapBig', this);
  }

  open(onClose: () => void) { this.onClose = onClose; Sound.play('menuOpen'); openPopup(this.node, this.card); }
}
