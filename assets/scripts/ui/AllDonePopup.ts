// "You've played them all!" popup: the player won the last level there is (Next on the win popup,
// or Play on Home afterwards). New levels come with an update or Remote Config. Its button: Back to
// Home after the win, OK on Home itself; X closes too.
import { _decorator, Component, Node } from 'cc';
import { findNode, tap, openPopup, closePopup, setText } from './UiKit';
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

  /** onHome: opened on Home (Play), where the button only closes it ("OK", not "Back to Home") */
  open(onClose: () => void, onHome = false) {
    this.onClose = onClose;
    setText(findNode(this.node, 'doneOk'), onHome ? 'OK' : 'Back to Home');
    Sound.play('menuOpen'); openPopup(this.node, this.card);
  }
}
