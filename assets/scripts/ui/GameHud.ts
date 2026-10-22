// Gameplay HUD, matching the web game (snug: src/ui/hud.js + main.css "HUD gameplay"):
//   top row:  level pill · timer (centre) · shake energy pill · settings gear
//   bottom:   booster dock (Freeze · Resize · Throw out) with count badges
//   toast:    short message pill in the middle of the screen
//   bag hint: "Pack your things here!" inside the empty bag
// Pure view: GameController pushes values in and listens to the callbacks. Nothing per frame here
// except the tweens Cocos runs itself.
import { _decorator, Component, Node, Label, Sprite, UITransform, Color, Tween, tween, Vec3, UIOpacity } from 'cc';
import { RoundRect } from './RoundRect';
const { ccclass, property } = _decorator;

export enum BoosterId { FREEZE = 0, RESIZE = 1, THROW = 2 }
export enum BoosterState { READY = 0, EMPTY = 1, ON = 2, LOCKED = 3 }

const INK = new Color(0x35, 0x41, 0x3F, 255);
const URGENT = new Color(0xC9, 0x45, 0x4F, 255);
const CREAM = new Color(0xFF, 0xF8, 0xE9, 255);
const GREY = new Color(0xD7, 0xD5, 0xD1, 255), GREY_RING = new Color(0x8C, 0x91, 0x8C, 255);
const ON_RING = new Color(0x7F, 0xC8, 0xF0, 255);
const BADGE = new Color(0xBD, 0x6D, 0x69, 255), BADGE_EMPTY = new Color(0x9A, 0x96, 0x8E, 255), BADGE_ON = new Color(0x4A, 0x9B, 0xD1, 255);
const SHAKE_FILL = new Color(0x8C, 0x7A, 0xD0, 255), SHAKE_LOW = new Color(0xC9, 0x65, 0x4F, 255);
const WHITE = new Color(255, 255, 255, 255), DIM = new Color(150, 150, 150, 128);
const PRESS_DROP = 3;

@ccclass('BoosterButton')
export class BoosterButton {
  @property(Node) root: Node = null!;
  @property(RoundRect) face: RoundRect = null!;
  @property(Sprite) icon: Sprite = null!;
  @property(Label) title: Label = null!;
  @property(Node) badge: Node = null!;
  @property(Label) badgeText: Label = null!;
  @property(Node) lock: Node = null!;
  @property(Label) lockLevel: Label = null!;
}

@ccclass('GameHud')
export class GameHud extends Component {
  @property(Label) levelLabel: Label = null!;
  @property(Label) timerLabel: Label = null!;
  @property(Node) shakePill: Node = null!;
  @property(RoundRect) shakeFace: RoundRect = null!;
  @property(Sprite) shakeIcon: Sprite = null!;
  @property(Node) shakeLock: Node = null!;
  @property(RoundRect) shakeFill: RoundRect = null!;
  @property(Node) gear: Node = null!;
  @property({ type: [BoosterButton] }) boosters: BoosterButton[] = [];
  @property(Node) toast: Node = null!;
  @property(Label) toastText: Label = null!;
  @property(Label) bagHint: Label = null!;

  /** callbacks set by the game controller */
  onPause: (() => void) | null = null;
  onBooster: ((id: BoosterId) => void) | null = null;
  onShakeEmpty: (() => void) | null = null;

  private shownSecond = -1;
  private urgent = false;
  private shakeBarWidth = 0;
  private toastOpacity: UIOpacity = null!;
  private toastBg: RoundRect = null!;
  private boosterState: BoosterState[] = [];
  private shakeEmpty = false;

  onLoad() {
    this.shakeBarWidth = this.shakeFill.getComponent(UITransform)!.width;
    this.toastOpacity = this.toast.getComponent(UIOpacity) || this.toast.addComponent(UIOpacity);
    this.toastBg = this.toast.getComponent(RoundRect)!;
    this.toastOpacity.opacity = 0;
    this.pressable(this.gear, null, () => this.onPause?.());
    this.pressable(this.shakePill, null, () => { if (this.shakeEmpty) this.onShakeEmpty?.(); }, () => this.shakeEmpty);
    this.boosters.forEach((b, i) => {
      this.boosterState[i] = BoosterState.READY;
      this.pressable(b.root, b.face, () => this.onBooster?.(i), () => this.boosterState[i] !== BoosterState.LOCKED);
    });
  }

  onDestroy() {
    // child nodes may already be destroyed with the scene; their listeners go with them
    for (const n of [this.gear, this.shakePill, ...this.boosters.map(b => b.root)]) if (n && n.isValid) n.targetOff(this);
  }

  /** Press feedback like the web buttons: sink by the lip height, shadow gone, back on release */
  private pressable(node: Node, face: RoundRect | null, onClick: () => void, enabled?: () => boolean) {
    const base = new Vec3();
    let lip = 0, down = false;
    const press = () => {
      if (enabled && !enabled()) return;
      down = true; base.set(node.position);
      if (face) { lip = face.lip; face.lip = 0; node.setPosition(base.x, base.y - PRESS_DROP, base.z); }
      else node.setScale(.94, .94, 1);
    };
    const release = (fire: boolean) => {
      if (!down) return;
      down = false;
      if (face) { face.lip = lip; node.setPosition(base); } else node.setScale(1, 1, 1);
      if (fire) onClick();
    };
    node.on(Node.EventType.TOUCH_START, press, this);
    node.on(Node.EventType.TOUCH_END, () => release(true), this);
    node.on(Node.EventType.TOUCH_CANCEL, () => release(false), this);
  }

  // ---------- top row ----------
  setLevel(n: number) { this.levelLabel.string = `Lv. ${n}`; }

  /** mm:ss, red and pulsing during the last ten seconds */
  setClock(seconds: number) {
    const sec = Math.max(0, Math.ceil(seconds));
    if (sec === this.shownSecond) return;
    this.shownSecond = sec;
    const m = Math.floor(sec / 60), s = sec % 60;
    this.timerLabel.string = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    const urgent = sec <= 10 && sec > 0;
    if (urgent === this.urgent) return;
    this.urgent = urgent;
    const n = this.timerLabel.node;
    Tween.stopAllByTarget(n);
    n.setScale(1, 1, 1);
    this.timerLabel.color = urgent ? URGENT : INK;
    if (urgent) tween(n).to(.5, { scale: new Vec3(1.08, 1.08, 1) }, { easing: 'sineInOut' }).to(.5, { scale: Vec3.ONE }, { easing: 'sineInOut' }).union().repeatForever().start();
  }
  resetClock() { this.shownSecond = -1; this.urgent = true; this.setClock(0); this.shownSecond = -1; }

  /** Shake energy 0..1. Empty: grey pill with a lock, tappable (offers an ad for more). */
  setShakeEnergy(energy: number) {
    const e = Math.max(0, Math.min(1, energy));
    const ui = this.shakeFill.getComponent(UITransform)!;
    ui.width = Math.max(e > 0 ? ui.height : 0, this.shakeBarWidth * e);
    this.shakeFill.node.active = e > 0;
    this.shakeFill.fill = e < .25 ? SHAKE_LOW : SHAKE_FILL;
    const empty = e <= 0;
    if (empty === this.shakeEmpty) return;
    this.shakeEmpty = empty;
    this.shakeFace.borderWidth = empty ? 1.3 : 0;
    this.shakeFace.setColors(empty ? GREY : CREAM, GREY_RING);
    this.shakeIcon.color = empty ? DIM : WHITE;
    this.shakeLock.active = empty;
    Tween.stopAllByTarget(this.shakePill);
    this.shakePill.setScale(1, 1, 1);
    // nudge every 1.6 s to suggest a tap (web: efhNhac)
    if (empty) tween(this.shakePill).delay(1.12).to(.16, { scale: new Vec3(1.06, 1.06, 1) }).to(.16, { scale: new Vec3(.98, .98, 1) }).to(.16, { scale: Vec3.ONE }).union().repeatForever().start();
  }

  // ---------- booster dock ----------
  setBooster(id: BoosterId, count: number, state: BoosterState, unlockLevel = 0) {
    const b = this.boosters[id]; if (!b) return;
    this.boosterState[id] = state;
    const locked = state === BoosterState.LOCKED;
    b.icon.node.active = !locked;
    b.badge.active = !locked;
    b.lock.active = locked;
    b.lockLevel.node.active = locked;
    if (locked) b.lockLevel.string = `Lv. ${unlockLevel}`;
    // web .efb.locked: name smaller and lower, under the lock and the level
    b.title.fontSize = locked ? 10 : 11.7;
    b.title.node.setPosition(0, locked ? -27.5 : -23, 0);
    b.badgeText.string = String(count);
    b.badge.getComponent(RoundRect)!.fill = state === BoosterState.EMPTY ? BADGE_EMPTY : state === BoosterState.ON ? BADGE_ON : BADGE;
    b.icon.color = state === BoosterState.EMPTY ? DIM : WHITE;
    b.face.borderWidth = 1.3;
    b.face.setColors(locked ? GREY : CREAM, locked ? GREY_RING : state === BoosterState.ON ? ON_RING : CREAM);
  }

  /** Badge text override (Freeze shows the seconds left, "12s") */
  setBoosterBadge(id: BoosterId, text: string) { const b = this.boosters[id]; if (b) b.badgeText.string = text; }

  // ---------- toast ----------
  toastMessage(text: string, seconds = 1.4) {
    this.toastText.string = text;
    this.toastText.updateRenderData(true);
    const w = this.toastText.node.getComponent(UITransform)!.width + 28;
    this.toast.getComponent(UITransform)!.width = w;
    Tween.stopAllByTarget(this.toastOpacity);
    Tween.stopAllByTarget(this.toast);
    this.toast.setScale(.9, .9, 1);
    tween(this.toast).to(.3, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
    tween(this.toastOpacity).to(.15, { opacity: 255 }).delay(seconds).to(.25, { opacity: 0 }).start();
  }

  // ---------- bag hint ----------
  /** Place the hint at the centre of the bag interior (Field coordinates) */
  placeBagHint(text: string, x: number, y: number) {
    this.bagHint.string = text;
    this.bagHint.node.setPosition(x, y, 0);
  }
  showBagHint(on: boolean) { if (this.bagHint.node.active !== on) this.bagHint.node.active = on; }
}
