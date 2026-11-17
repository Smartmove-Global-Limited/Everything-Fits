// Gameplay HUD, matching the web game (snug: src/ui/hud.js + main.css "HUD gameplay"):
//   top row:  level pill · timer (centre) · shake energy pill · settings gear
//   bottom:   booster dock (Freeze · Resize · Throw out) with count badges
//   toast:    short message pill in the middle of the screen
//   bag hint: "Pack your things here!" inside the empty bag
// Pure view: GameController pushes values in and listens to the callbacks. Nothing per frame here
// except the tweens Cocos runs itself.
import { _decorator, Component, Node, Label, Sprite, SpriteFrame, UITransform, Color, Tween, tween, Vec3, UIOpacity } from 'cc';
import { RoundRect } from './RoundRect';
const { ccclass, property } = _decorator;

export enum BoosterId { FREEZE = 0, RESIZE = 1, THROW = 2 }
export enum BoosterState { READY = 0, EMPTY = 1, ON = 2, LOCKED = 3 }

const INK = new Color(0x35, 0x41, 0x3F, 255);
const URGENT = new Color(0xC9, 0x45, 0x4F, 255);
const CREAM = new Color(0xFF, 0xF8, 0xE9, 255);
const GREY = new Color(0xD7, 0xD5, 0xD1, 255), GREY_RING = new Color(0x8C, 0x91, 0x8C, 255);
const ON_RING = new Color(0x7F, 0xC8, 0xF0, 255);
/** Figma "EF / Gameplay booster": flat tile, thin shadow (0 2 .5 rgba(46,51,41,.22)), name grey when locked */
const TILE_SHADOW = new Color(46, 51, 41, 56), LOCKED_NAME = new Color(0x6E, 0x6E, 0x63, 255);
const BADGE = new Color(0xBD, 0x6D, 0x69, 255), BADGE_EMPTY = new Color(0x9A, 0x96, 0x8E, 255), BADGE_ON = new Color(0x4A, 0x9B, 0xD1, 255);
const SHAKE_FILL = new Color(0x8C, 0x7A, 0xD0, 255), SHAKE_LOW = new Color(0xC9, 0x65, 0x4F, 255);
const PRESS_DROP = 3;
// frozen clock (Freeze booster): the pill turns to ice, the clock icon becomes the booster's snowflake
const ICE_FILL = new Color(0xE4, 0xF4, 0xFC, 255), ICE_BORDER = new Color(0x8A, 0xCD, 0xF0, 255);
const ICE_GLOW = new Color(127, 200, 240, 150), ICE_INK = new Color(0x2E, 0x7D, 0xB5, 255);

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
  private shakeIconOpacity: UIOpacity = null!;

  onLoad() {
    this.shakeBarWidth = this.shakeFill.getComponent(UITransform)!.width;
    this.toastOpacity = this.toast.getComponent(UIOpacity) || this.toast.addComponent(UIOpacity);
    this.toastBg = this.toast.getComponent(RoundRect)!;
    this.toastOpacity.opacity = 0;
    // measured from the web while hidden (translateY(6px)): the visible pill sits 6 units higher
    this.toast.setPosition(this.toast.position.x, this.toast.position.y + 6.4, 0);
    // the lock must not inherit the greyed-out icon: put it next to the icon, drawn above it
    const lockWorld = this.shakeLock.worldPosition.clone();
    this.shakeLock.setParent(this.shakePill);
    this.shakeLock.setWorldPosition(lockWorld);
    this.shakeIconOpacity = this.shakeIcon.getComponent(UIOpacity) || this.shakeIcon.addComponent(UIOpacity);
    this.pressable(this.gear, null, () => this.onPause?.());
    this.pressable(this.shakePill, null, () => { if (this.shakeEmpty) this.onShakeEmpty?.(); }, () => this.shakeEmpty);
    this.boosters.forEach((b, i) => {
      // Figma tile: no raised lip, a thin soft shadow, corners 20
      const f = b.face;
      f.lip = 0; f.shadowY = 2; f.shadowBlur = 1; f.shadowColor = TILE_SHADOW; f.radius = 20;
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

  /**
   * Freeze booster: the clock pill frozen (ice fill, blue rim and glow, blue digits, a slowly turning
   * snowflake instead of the clock icon), with a little pop when it freezes and when it thaws.
   */
  setClockFrozen(on: boolean) {
    if (on === this.clockFrozen) return;
    this.clockFrozen = on;
    const pill = this.timerLabel.node.parent!, rr = pill.getComponent(RoundRect), icon = pill.getChildByName('Icon')?.getComponent(Sprite);
    if (!this.clockLook && rr) this.clockLook = { fill: rr.fill.clone(), border: rr.borderWidth, borderColor: rr.borderColor.clone(), glow: rr.glow, glowColor: rr.glowColor.clone(), icon: icon?.spriteFrame || null };
    const look = this.clockLook;
    if (rr && look) {
      rr.fill = on ? ICE_FILL : look.fill;
      rr.borderWidth = on ? 2 : look.border; rr.borderColor = on ? ICE_BORDER : look.borderColor;
      rr.glow = on ? 7 : look.glow; rr.glowColor = on ? ICE_GLOW : look.glowColor;
    }
    if (icon) {
      Tween.stopAllByTarget(icon.node);
      icon.node.angle = 0;
      const flake = this.boosters[BoosterId.FREEZE]?.icon?.spriteFrame;
      icon.spriteFrame = on && flake ? flake : look?.icon || icon.spriteFrame;
      if (on) tween(icon.node).by(6, { angle: -360 }).repeatForever().start();
    }
    // digits: blue while frozen; back to normal (or red in the last ten seconds) when thawed
    const n = this.timerLabel.node;
    Tween.stopAllByTarget(n); n.setScale(1, 1, 1);
    this.timerLabel.color = on ? ICE_INK : INK;
    const sec = this.shownSecond; this.shownSecond = -1; this.urgent = false;
    if (!on && sec >= 0) this.setClock(sec);
    Tween.stopAllByTarget(pill);
    pill.setScale(1, 1, 1);
    tween(pill).to(.12, { scale: new Vec3(1.14, 1.14, 1) }, { easing: 'quadOut' }).to(.22, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
  }
  private clockFrozen = false;
  private clockLook: { fill: Color; border: number; borderColor: Color; glow: number; glowColor: Color; icon: SpriteFrame | null } | null = null;

  /** mm:ss, red and pulsing during the last ten seconds */
  setClock(seconds: number) {
    const sec = Math.max(0, Math.ceil(seconds));
    if (sec === this.shownSecond) return;
    this.shownSecond = sec;
    const m = Math.floor(sec / 60), s = sec % 60;
    this.timerLabel.string = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    if (this.clockFrozen) return;   // stays blue while frozen
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
    // web .efh-shake.empty img{filter:grayscale(1);opacity:.7}
    this.shakeIcon.grayscale = empty;
    this.shakeIconOpacity.opacity = empty ? 178 : 255;
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
    // Figma: name 12 under the icon; locked: 10, grey, under the lock and the level
    b.title.fontSize = locked ? 10 : 12;
    b.title.color = locked ? LOCKED_NAME : INK;
    b.title.node.setPosition(0, locked ? -32.5 : -27.5, 0);
    b.badgeText.string = String(count);
    this.fitBadge(b);
    b.badge.getComponent(RoundRect)!.fill = state === BoosterState.EMPTY ? BADGE_EMPTY : state === BoosterState.ON ? BADGE_ON : BADGE;
    // web .efb.empty .efb-ic{filter:grayscale(.7);opacity:.5}
    b.icon.grayscale = state === BoosterState.EMPTY;
    (b.icon.getComponent(UIOpacity) || b.icon.addComponent(UIOpacity)).opacity = state === BoosterState.EMPTY ? 128 : 255;
    b.face.borderWidth = 1.3;
    b.face.glow = state === BoosterState.ON ? 3 : 0;   // web .efb.on: 3px ring rgba(127,200,240,.45)
    b.face.setColors(locked ? GREY : CREAM, locked ? GREY_RING : state === BoosterState.ON ? ON_RING : CREAM);
  }

  /** Badge text override (Freeze shows the seconds left, "12s") */
  setBoosterBadge(id: BoosterId, text: string) { const b = this.boosters[id]; if (b) { b.badgeText.string = text; this.fitBadge(b); } }

  /**
   * Count badge like a chat notification: a round pill on the tile's top-right corner, half of it
   * above the top edge, growing evenly with its text, the number centred in it both ways.
   */
  private fitBadge(b: BoosterButton) {
    const ui = b.badge.getComponent(UITransform)!, tile = b.root.getComponent(UITransform)!;
    const t = b.badgeText;
    t.horizontalAlign = Label.HorizontalAlign.CENTER; t.verticalAlign = Label.VerticalAlign.CENTER;
    t.lineHeight = t.fontSize + 2;
    t.updateRenderData(true);
    const h = 22, w = Math.max(h, t.node.getComponent(UITransform)!.width + 10);
    ui.setContentSize(w, h);
    const rr = b.badge.getComponent(RoundRect); if (rr && rr.radius !== h / 2) rr.radius = h / 2;
    b.badge.setPosition(tile.width / 2 - 10, tile.height / 2 - 1, 0);   // half of it above the tile's top edge
    const tu = t.node.getComponent(UITransform)!;
    tu.setAnchorPoint(.5, .5);
    t.node.setPosition(0, 1, 0);                  // Baloo sits a little low in its line box
  }

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
