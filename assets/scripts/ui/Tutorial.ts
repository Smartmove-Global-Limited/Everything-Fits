// How-to-play tutorial (gameplay doc "Tutorial"), on the TutorialOverlay prefab above the field.
//   Level 1, once:  1. a hand drags one item from the tray to its place in the bag
//                      ("Drag items into the bag") until the player packs an item;
//                   2. "Great! Pack everything before time runs out", then normal play.
//   Turning, once each:
//     hold + turn:  level 1, the first item let go of inside the bag where it fits: the clock
//                   stops and the item stays in the air where it was let go; a hand (left,
//                   mirrored) has its finger on the item, holding it, a right hand's finger goes
//                   round it outside, down, up, a full circle and back, and the item really turns
//                   with it ("Hold it, and rotate with another finger"), keeping the angle it
//                   reached. Then it falls into the bag (or the player's touch ends it sooner and
//                   the item is theirs); the drag step is not shown again, "Great! ..." follows.
//                   (levels 1-2 for the tap + turn below)
//     tap + turn:   the first time an item is tapped (rotate handle shown), two hands beside it at
//                   once: the left finger goes down its left side and it turns left, then the right
//                   finger goes down its right side and it turns back right
//                   ("Swipe around it with 1 or 2 fingers to rotate either way") until the player turns it (an
//                   unselect puts it off to the next tap).
//   Shake, once, level 2: when 3 items are in the bag, the phone icon shakes over the bag ("Shake
//                   your phone to settle the items") until the player shakes (or taps, where
//                   shaking cannot be done), then "Nice! Shaking settles the items".
//   Level 3 / 6 / 9, once each: the hand points at the booster that just opened, with one line
//                   about it, until the player touches the screen.
//   Mystery box, once: on the first level with a mystery box, the hand drags the box from the tray
//                   to just above the key in the bag and lets go there ("Drop the box on the key
//                   to open it") until the box opens, then "It's open!".
// The clock stays stopped and no interstitial shows while a tutorial runs. The overlay never
// blocks touches: the player plays the real level under it. Animations are tweens restarted at
// each loop (every ~2 s), nothing runs per frame.
import { _decorator, Component, Node, Label, UITransform, Vec3, tween, Tween, UIOpacity, EventTouch, Sprite, SpriteFrame, resources, instantiate, Layout } from 'cc';
import { LocalStore } from '../services/LocalStore';
import { GameState } from '../core/GameState';
import { angleOf } from '../game/DragController';
import { bagZone } from '../game/BagRules';
import type { ItemView } from '../game/ItemView';
const { ccclass, property } = _decorator;

const KEY_BASICS = 'ef.tutorial.basics.v1';
const KEY_BOOSTER = 'ef.tutorial.booster.v1.';
const KEY_SHAKE = 'ef.tutorial.shake.v1';
const KEY_MYSTERY = 'ef.tutorial.mystery.v1';
const KEY_HOLD_TURN = 'ef.tutorial.holdturn.v1';
const KEY_TAP_TURN = 'ef.tutorial.tapturn.v1';
const HOLD_TURN_LEVEL = 1;                   // the hold + turn hint: the first item let go of in the bag on level 1
const TURN_LAST_LEVEL = 2;                   // the turn hints wait for their moment on levels 1 and 2
const SHAKE_LEVEL = 2;
const HOLD_TURN_LINE = 'Hold it, and rotate with another finger';
const TAP_TURN_LINE = 'Swipe around it with 1 or 2 fingers to rotate either way';
/**
 * Hold + turn: the rotate hand's way round the item, in degrees round its centre (0 = right, 90 =
 * up), from its left side: down a quarter, up half a turn, a full circle, down a quarter back to
 * the start; the item turns by as much as the hand went round, so it ends at its own angle (it
 * fitted there: it is let go into the bag). Segment times in seconds.
 */
const HOLD_TURN_PATH = [180, 270, 90, -270, -180];
const HOLD_TURN_TIMES = [.9, 1.3, 2.2, .9];
const HOLD_TURN_LEAD = 1, HOLD_TURN_PAUSE = .15, HOLD_TURN_REST = .8;   // s: read the line, between moves, look at the result
const HOLD_TIP_IN = 4;                       // the holding fingertip this far inside the item's bottom edge
const HOLD_TURN_BESIDE = 40;                 // the rotate hand goes round this far outside the item
const MYSTERY_DROP_ABOVE = 70;               // the hand lets go of the box this far above the key
const SHAKE_AFTER_PACKED = 3;                // items in the bag before the shake step shows
const DONE_SECONDS = 2.6;
const LINE_CLEAR = 24;                        // the line above an item sits this far over it (and its hands)
const SETTLE_SPEED = .3, SETTLE_MAX = 3;      // m/s, s: the tray has settled when nothing moves faster
const MIN_TURN = 20;                         // degrees: a real rotation, not a slip of the finger
const ROTATE_BESIDE = 46;                    // the tap + turn hands go round this far outside the item (clear of a small one)
// degrees round the item (0 = right, 90 = up): the left finger down its left side (the item turns
// left, anticlockwise), the right finger down its right side (it turns back right, clockwise)
const TAP_LEFT = [135, 225], TAP_RIGHT = [45, -45];
const TAP_SWEEP = 1, TAP_LOOP = 3.4;         // s: one finger's way down, one pass of both
const SHAKE_TAP_AFTER = 1.5;                 // s before a tap also ends the shake step
const PHONE_SIZE = 110;

/** What the tutorial needs from the game scene */
export type TutorialHost = {
  /** items of the round and the level's solution (index in items, place in field units, angle in degrees) */
  items(): ItemView[];
  solution(): { i: number; x: number; y: number; angle: number }[];
  /** node the items and the solution places live in */
  itemLayer: Node;
  packed(i: number): boolean;
  /** items in the bag now */
  packedCount(): number;
  /** tutorial on / off: the game stops the clock and the ads while on */
  setActive(on: boolean): void;
  /** turn an item for real, as a finger would (DragController.demoTurn*); `hover`: it stays in the
   *  air meanwhile. demoTurnBy is false once a touch of the player has ended the turn */
  demoTurnStart(item: ItemView, hover?: boolean): boolean;
  demoTurnBy(deg: number): boolean;
  demoTurnEnd(): void;
};


@ccclass('Tutorial')
export class Tutorial extends Component {
  @property({ type: Node, tooltip: 'Pointing hand (fingertip at the node origin)' }) hand: Node = null!;
  @property({ type: Node, tooltip: 'Ring under the fingertip on a tap' }) ring: Node = null!;
  @property({ type: Node, tooltip: 'Speech bubble' }) bubble: Node = null!;
  @property({ type: Label, tooltip: 'Text of the bubble' }) text: Label = null!;

  private host: TutorialHost | null = null;
  // watch: nothing on screen, waiting for the moment of a hint not seen yet (a held item over the
  // bag, a tap on an item, 3 items in the bag on the shake level)
  private step: 'off' | 'drag' | 'done' | 'watch' | 'shake' | 'shaken' | 'booster' | 'mystery' | 'opened' | 'holdTurn' | 'tapTurn' = 'off';
  /** level number of the round the hints are for */
  private level = 0;
  private target: ItemView | null = null;
  private targetPlace = new Vec3();
  private boosterKey = '';
  private readonly tmp = new Vec3();

  static needsBasics(levelNumber: number) { return levelNumber === 1 && !LocalStore.get(KEY_BASICS); }
  static needsBooster(key: string) { return !LocalStore.get(KEY_BOOSTER + key); }
  static needsShake() { return !LocalStore.get(KEY_SHAKE); }
  static needsMystery() { return !LocalStore.get(KEY_MYSTERY); }
  /** a hint still to be shown on this level when its moment comes (turn hints, shake) */
  static needsWatch(levelNumber: number) {
    return (levelNumber <= TURN_LAST_LEVEL && !LocalStore.get(KEY_TAP_TURN))
      || (levelNumber === HOLD_TURN_LEVEL && !LocalStore.get(KEY_HOLD_TURN))
      || (levelNumber === SHAKE_LEVEL && Tutorial.needsShake());
  }
  /** something is on screen (waiting for a hint's moment is not) */
  get active() { return this.step !== 'off' && this.step !== 'watch'; }

  onLoad() { this.bubbleY = this.bubble.position.y; this.node.active = false; }
  onDestroy() { this.node.targetOff(this); }

  /** Booster intro: a touch anywhere ends it and still reaches the game below (not swallowed) */
  private onTouch(e: EventTouch) {
    e.preventSwallow = true;
    if (this.step === 'booster') this.finish();
    // shake step: a tap goes on too (no sensor, no shake energy left), once the line could be read
    else if (this.step === 'shake' && Date.now() - this.shakeShownAt > SHAKE_TAP_AFTER * 1000) this.onShaken();
  }

  // ---------- level 1 basics ----------
  startBasics(host: TutorialHost, levelNumber = 1) {
    this.host = host; this.level = levelNumber;
    this.begin();
    host.setActive(true);
    this.step = 'drag';
    this.bubble.active = false; this.hand.active = false; this.ring.active = false;   // the line comes with the item, above it
    this.whenSettled(() => { if (this.step === 'drag') this.showDragStep(); });
  }
  /** Once the items have stopped falling onto the tray (or after SETTLE_MAX s), run `then` */
  private whenSettled(then: () => void) {
    let waited = 0;
    const check = () => {
      waited += .25;
      const moving = this.host?.items().some(it => !it.waiting && it.node.activeInHierarchy && it.body?.enabled && it.body.isAwake() && it.body.linearVelocity.length() > SETTLE_SPEED);
      if (moving && waited < SETTLE_MAX) this.scheduleOnce(check, .25); else then();
    };
    this.scheduleOnce(check, .25);
  }

  /** Off screen until the moment of a hint not seen yet on this level (turn hints, shake) */
  watch(host: TutorialHost, levelNumber: number) {
    this.host = host; this.level = levelNumber;
    this.step = 'watch';
    if (this.shakeDue()) this.startShake();
  }
  private shakeDue() {
    return this.level === SHAKE_LEVEL && Tutorial.needsShake() && !!this.host && this.host.packedCount() >= SHAKE_AFTER_PACKED && !GameState.drag;
  }

  /** An item was packed into the bag */
  onPacked() {
    if (this.step === 'drag') this.basicsDone();
    else if (this.step === 'watch' && this.shakeDue()) this.startShake();
  }
  private startShake() {
    this.begin();
    this.host!.setActive(true);
    this.showShakeStep();
  }

  /** Level 1 basics done: one line, then on with the hints still to come */
  private basicsDone() {
    this.clearExtras();
    this.step = 'done';
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.say('Great! Pack everything before time runs out');
    this.scheduleOnce(() => { LocalStore.set(KEY_BASICS, '1'); this.resume(); }, DONE_SECONDS);
  }

  /**
   * A hint is over (turn, shake, basics line): back to the drag step if the level 1 basics are not
   * done yet, else off screen waiting for the next hint's moment, or off for good.
   */
  private resume() {
    this.stopLoop();
    this.unscheduleAllCallbacks();
    this.clearExtras();
    this.node.off(Node.EventType.TOUCH_START, this.onTouch, this);
    this.hand.active = false; this.ring.active = false;
    this.target = null;
    const host = this.host;
    if (!host) { this.step = 'off'; this.node.active = false; return; }
    if (Tutorial.needsBasics(this.level)) {
      this.begin();
      host.setActive(true);
      if (host.packedCount() > 0) this.basicsDone(); else this.showDragStep();
      return;
    }
    this.node.active = false;
    host.setActive(false);
    if (Tutorial.needsWatch(this.level)) { this.step = 'watch'; if (this.shakeDue()) this.startShake(); }
    else { this.step = 'off'; this.host = null; }
  }

  // ---------- turning ----------
  /** The player selected an item (the rotate handle appeared) or cleared the selection */
  onSelect(item: ItemView | null) {
    // the first tap on an item shows how to turn it (also during the drag step of level 1)
    // (also while "Great! ..." shows after the basics: a tap then was lost, it took a second one)
    if ((this.step === 'watch' || this.step === 'drag' || this.step === 'done') && item && this.level <= TURN_LAST_LEVEL && !LocalStore.get(KEY_TAP_TURN) && !GameState.drag) {
      if (this.step === 'done') { LocalStore.set(KEY_BASICS, '1'); this.unscheduleAllCallbacks(); }
      this.startTapTurn(item);
      return;
    }
    if (this.step !== 'tapTurn') return;
    if (!item) { this.resume(); return; }   // unselected: again at the next tap
    this.target = item;
    this.loop();
  }

  /** The player's own finger started turning an item: the tap + turn hint is done at once (asked:
   *  it stayed on screen until the finger was lifted) */
  onTurnStart() {
    if (this.step !== 'tapTurn') return;
    LocalStore.set(KEY_TAP_TURN, '1');
    this.resume();
  }

  /** The player turned an item with the handle by `degrees` */
  onRotated(degrees: number) {
    if (Math.abs(degrees) < MIN_TURN) return;
    // turned while held (a second finger): the hold + turn hint is learnt, not shown again
    if (GameState.drag) { LocalStore.set(KEY_HOLD_TURN, '1'); return; }
    if (this.step !== 'tapTurn') return;
    LocalStore.set(KEY_TAP_TURN, '1');
    this.resume();
  }
  private startTapTurn(item: ItemView) {
    this.stopLoop();
    this.begin();
    this.host!.setActive(true);
    this.step = 'tapTurn';
    this.target = item;
    this.sayAbove(TAP_TURN_LINE, item, ROTATE_BESIDE + LINE_CLEAR);
    this.loop();
  }

  /**
   * Level 1, the first item let go of inside the bag (asked: shown while dragging, the player often
   * let go at once and missed it): the item stays where it was let go, in the air, and the hint
   * shows the second-finger turn on it with two hands: a left hand's finger on the item holding it,
   * a right hand's finger coming down beside it, then going round it (down, up, a full circle,
   * back). The item really turns with it (the same soft turn as a finger: it pushes what it meets,
   * stuck it stops) and keeps the angle it was turned to. Once through, the item falls. A touch of
   * the player meanwhile ends it there: the item is theirs (picked up, turned with a second finger).
   */
  onDropped(item: ItemView, bounced: boolean) {
    if (bounced || this.level !== HOLD_TURN_LEVEL || !this.host || LocalStore.get(KEY_HOLD_TURN)) return;
    if ((this.step !== 'watch' && this.step !== 'drag') || !bagZone(item).fullyInside) return;
    const host = this.host;
    this.stopLoop();
    if (!host.demoTurnStart(item, true)) return;
    this.unscheduleAllCallbacks();
    this.begin();
    host.setActive(true);
    this.step = 'holdTurn';
    this.target = item;
    this.ring.active = false;
    this.sayAbove(HOLD_TURN_LINE, item, HOLD_TURN_BESIDE + LINE_CLEAR);
    const c = this.toLocal(item.node.worldPosition, new Vec3());
    // radius in this node's units: a world point that far right of the item's centre
    const box = item.localBox, R = Math.max(box.width, box.height) * item.levelScale / 2 + HOLD_TURN_BESIDE;
    const w = item.node.worldPosition;
    const r = Vec3.distance(c, this.toLocal(this.tmp.set(w.x + R, w.y, 0), new Vec3()));
    // two hands, nothing else (asked: no tags, no ring, no arc): a left hand with its fingertip on
    // the item's bottom edge, holding it, and a right hand that comes down beside it, then goes
    // round it, the item turning with it
    const hold = this.extraHand();
    const hop = hold.getComponent(UIOpacity) || hold.addComponent(UIOpacity);
    Tween.stopAllByTarget(hold); Tween.stopAllByTarget(hop);
    hold.setScale(-1, 1, 1);   // a left hand: the picture mirrored
    // fingertip on the item's lowest point, the hand below it: drawn over the item it hid it
    const low = this.toLocal(this.tmp.set(w.x, w.y - item.below(angleOf(item.node) * Math.PI / 180), 0), new Vec3());
    hold.active = true; hold.setPosition(c.x, low.y + HOLD_TIP_IN, 0); hop.opacity = 255;
    const op = this.hand.getComponent(UIOpacity) || this.hand.addComponent(UIOpacity);
    this.hand.active = true; op.opacity = 0;
    this.hand.setScale(1.3, 1.3, 1);
    tween(op).delay(.3).to(.3, { opacity: 255 }).start();
    tween(this.hand).delay(.45).to(.25, { scale: Vec3.ONE }, { easing: 'quadIn' }).start();
    const arc = this.arc; Tween.stopAllByTarget(arc);
    let last = HOLD_TURN_PATH[0], over = false;
    // the hint is over: seen for good; the item falls (with the angle it was turned to)
    const end = () => {
      if (over) return; over = true;
      Tween.stopAllByTarget(arc);
      host.demoTurnEnd();
      LocalStore.set(KEY_HOLD_TURN, '1');
      this.clearExtras();
      this.hand.active = false;
      // level 1: an item is in, the drag step is done (it is not shown again)
      if (Tutorial.needsBasics(this.level)) { LocalStore.set(KEY_BASICS, '1'); this.basicsDone(); }
      else this.resume();
    };
    const place = () => {
      if (over) return;
      const a = arc.t * Math.PI / 180;
      this.hand.setPosition(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0);
      // a touch of the player ended the turn (DragController.onStart): the hint ends with it
      if (!host.demoTurnBy(arc.t - last)) { end(); return; }
      last = arc.t;
    };
    arc.t = last; place();
    let tw = tween(arc).delay(HOLD_TURN_LEAD);
    for (let k = 0; k < HOLD_TURN_TIMES.length; k++) {
      if (k) tw = tw.delay(HOLD_TURN_PAUSE);
      tw = tw.to(HOLD_TURN_TIMES[k], { t: HOLD_TURN_PATH[k + 1] }, { easing: 'sineInOut', onUpdate: place });
    }
    tw.delay(HOLD_TURN_REST).call(end).start();
  }

  // second hand of the two-hand hints (mirrored: a left hand), made on first use
  private hand2: Node | null = null;
  private extraHand(): Node {
    if (!this.hand2) { this.hand2 = instantiate(this.hand); this.hand2.name = 'hand2'; this.node.addChild(this.hand2); }
    return this.hand2;
  }
  private clearExtras() {
    const rop = this.ring.getComponent(UIOpacity);
    Tween.stopAllByTarget(this.ring); if (rop) Tween.stopAllByTarget(rop);
    this.ring.active = false; this.ring.setScale(1, 1, 1);
    this.hand.setScale(1, 1, 1);
    if (this.hand2) { const op = this.hand2.getComponent(UIOpacity); if (op) Tween.stopAllByTarget(op); this.hand2.active = false; }
  }

  /** The phone was shaken hard enough to move the items (Shake: one jolt) */
  onShaken() {
    if (this.step !== 'shake') return;
    this.node.off(Node.EventType.TOUCH_START, this.onTouch, this);
    this.step = 'shaken';
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.say('Nice! Shaking settles the items');
    this.scheduleOnce(() => { LocalStore.set(KEY_SHAKE, '1'); this.resume(); }, DONE_SECONDS);
  }

  /** The round ended (won / lost / left) while a tutorial ran */
  stop() {
    if (this.step === 'watch') { this.step = 'off'; this.host = null; return; }   // tried again next round
    if (this.active) this.finish();
  }

  private showDragStep() {
    const host = this.host!;
    // the item nearest the middle of the screen (asked: not one in a corner), with a place in the solution
    const sol = host.solution().filter(s => host.items()[s.i] && !host.packed(s.i) && host.items()[s.i].node.activeInHierarchy);
    const mid = (s: { i: number }) => Math.abs(this.toLocal(host.items()[s.i].node.worldPosition, this.tmp).x);
    const pick = sol.slice().sort((a, b) => mid(a) - mid(b))[0];
    if (!pick) { this.finish(); return; }
    this.step = 'drag';
    this.target = host.items()[pick.i];
    this.targetPlace.set(pick.x, pick.y, 0);
    this.sayAbove('Drag items into the bag', this.target, LINE_CLEAR);
    this.loop();
  }

  /** A shaking phone (the HUD's shake icon) rocks left and right over the bag */
  private showShakeStep() {
    this.step = 'shake';
    this.target = null;
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.shakeShownAt = Date.now();
    this.node.on(Node.EventType.TOUCH_START, this.onTouch, this);
    this.say('Shake your phone to settle the items');
    const ph = this.phoneNode();
    ph.active = true;
    const y = this.bubbleY - 150;
    ph.setPosition(0, y, 0); ph.angle = 0;
    const swing = (dx: number, deg: number) => tween(ph).to(.12, { position: new Vec3(dx, y, 0), angle: deg }, { easing: 'sineInOut' });
    tween(ph).then(swing(-22, 12)).then(swing(22, -12)).then(swing(-22, 12)).then(swing(22, -12)).then(swing(0, 0)).delay(.7).union().repeatForever().start();
  }
  private shakeShownAt = 0;
  private phone: Node | null = null;
  /** Shaking phone picture (resources/uiart/icons/shake, the shake energy pill's icon), made on first use */
  private phoneNode(): Node {
    if (this.phone) return this.phone;
    const n = new Node('phone'); n.layer = this.hand.layer;
    this.node.addChild(n);
    n.addComponent(UITransform).setContentSize(PHONE_SIZE, PHONE_SIZE);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load('uiart/icons/shake/spriteFrame', SpriteFrame, (e, f) => { if (!e && sp.isValid) sp.spriteFrame = f; });
    this.phone = n;
    return n;
  }
  private hidePhone() { if (this.phone) { Tween.stopAllByTarget(this.phone); this.phone.active = false; } }

  // ---------- mystery box (first level with one) ----------
  startMystery(host: TutorialHost) {
    this.host = host;
    const box = host.items().find(it => it.locked && it.node.activeInHierarchy);
    if (!box || !this.keyOf(host)) { this.host = null; return; }
    this.begin();
    host.setActive(true);
    this.step = 'mystery';
    this.target = box;
    this.say('Drop the box on the key to open it');
    this.loop();
  }
  /** A mystery box opened (the key touched it) */
  onBoxOpened() {
    if (this.step !== 'mystery') return;
    this.step = 'opened';
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.say("It's open!");
    this.scheduleOnce(() => this.finish(), DONE_SECONDS);
  }
  private keyOf(host: TutorialHost) { return host.items().find(it => it.itemId === 0 && it.node.activeInHierarchy) || null; }

  // ---------- booster intros (level 3 / 6 / 9) ----------
  startBooster(key: string, button: Node, line: string, host: TutorialHost) {
    this.host = host;
    this.boosterKey = key;
    this.begin();
    host.setActive(true);
    this.step = 'booster';
    this.node.on(Node.EventType.TOUCH_START, this.onTouch, this);
    this.say(line, button);
    // the hand bobs on the button
    const p = this.toLocal(button.worldPosition, this.tmp);
    this.stopLoop();
    this.hand.active = true; this.ring.active = false;
    this.hand.setPosition(p.x + 6, p.y - 10, 0);
    tween(this.hand).by(.45, { position: new Vec3(0, 14, 0) }, { easing: 'sineOut' }).by(.45, { position: new Vec3(0, -14, 0) }, { easing: 'sineIn' }).union().repeatForever().start();
  }

  // ---------- common ----------
  private begin() {
    if (this.node.active) return;   // one hint after another: no fade again
    this.node.active = true;
    this.node.setSiblingIndex(this.node.parent!.children.length - 1);
    const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).to(.25, { opacity: 255 }).start();
  }

  private finish() {
    if (this.step === 'booster') LocalStore.set(KEY_BOOSTER + this.boosterKey, '1');
    else if (this.step === 'shake' || this.step === 'shaken') LocalStore.set(KEY_SHAKE, '1');
    else if (this.step === 'mystery' || this.step === 'opened') LocalStore.set(KEY_MYSTERY, '1');
    else if (this.step === 'drag' || this.step === 'done') LocalStore.set(KEY_BASICS, '1');
    // a turn hint cut short by the end of the round: shown again next time (stopLoop ends the turn)
    this.clearExtras();
    this.step = 'off';
    this.node.off(Node.EventType.TOUCH_START, this.onTouch, this);
    this.stopLoop();
    this.unscheduleAllCallbacks();
    Tween.stopAllByTarget(this.hand);
    this.hand.angle = 0;
    this.node.active = false;
    this.host?.setActive(false);
    this.host = null; this.target = null;
  }

  /** Bubble text; above `anchor` (a booster button) or in the free band above the bag */
  private say(line: string, anchor?: Node) {
    this.text.string = line;
    this.bubble.active = true;
    if (anchor) {
      const p = this.toLocal(anchor.worldPosition, this.tmp);
      this.bubble.setPosition(0, p.y + 92, 0);
    } else this.bubble.setPosition(0, this.bubbleY, 0);
    Tween.stopAllByTarget(this.bubble);
    this.bubble.setScale(.85, .85, 1);
    tween(this.bubble).to(.22, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
  }
  /**
   * Bubble right above an item (asked: the player looks at the item, not at the bag), clear of the
   * hands going round it `beside` units out; kept inside the screen sides and under the HUD
   */
  private sayAbove(line: string, it: ItemView, beside: number) {
    this.say(line);
    const c = this.toLocal(it.node.worldPosition, new Vec3()), w = it.node.worldPosition, box = it.localBox;
    const R = Math.max(box.width, box.height) * it.levelScale / 2 + beside;
    const r = Vec3.distance(c, this.toLocal(this.tmp.set(w.x + R, w.y, 0), new Vec3()));
    // the new line's size now (the label and the bubble's layout follow it only at the next frame)
    this.text.updateRenderData(true);
    this.bubble.getComponent(Layout)?.updateLayout();
    const bui = this.bubble.getComponent(UITransform)!, half = this.node.getComponent(UITransform)!.width / 2;
    const room = Math.max(0, half - bui.width / 2 - 8);
    const x = Math.max(-room, Math.min(room, c.x));
    const y = Math.min(this.bubbleY, c.y + r + bui.height / 2);
    this.bubble.setPosition(x, y, 0);
  }
  /** Bubble height in the basics: under the HUD, above the bag (set by the prefab position) */
  private bubbleY = 0;

  private loop() {
    this.stopLoop();
    this.playLoop();
    this.schedule(this.playLoop, this.step === 'tapTurn' ? TAP_LOOP : 2.4);
  }
  private stopLoop() {
    this.unschedule(this.playLoop);
    Tween.stopAllByTarget(this.hand);
    Tween.stopAllByTarget(this.ring);
    Tween.stopAllByTarget(this.arc);   // the circle of the rotate step moves (and then hides) the hand
    this.host?.demoTurnEnd();   // a tap + turn pass cut short: the item's turn ends with it
    this.hidePhone();
  }
  private readonly arc = { t: 0 };

  /** One pass of the hand animation, from where things are now */
  private playLoop() {
    const it = this.target;
    if (!it || !it.node.isValid) return;
    Tween.stopAllByTarget(this.hand);
    const op = this.hand.getComponent(UIOpacity) || this.hand.addComponent(UIOpacity);
    this.hand.active = true; op.opacity = 255;
    const from = this.toLocal(it.node.worldPosition, new Vec3());
    if (this.step === 'drag') {
      // the item layer has no UITransform: its world matrix places the solution point
      const world = Vec3.transformMat4(new Vec3(), this.targetPlace, this.host!.itemLayer.worldMatrix);
      const to = this.toLocal(world, new Vec3());
      this.hand.setPosition(from);
      this.tapRing(from, .25);
      tween(this.hand).delay(.35).to(1.1, { position: to }, { easing: 'sineInOut' }).delay(.35).call(() => { op.opacity = 0; }).start();
    } else if (this.step === 'mystery') {
      // carry the box to just above the key, let go (a ring where the finger lifts), the box drops
      const key = this.keyOf(this.host!);
      if (!key) return;
      const world = key.node.worldPosition;
      const to = this.toLocal(this.tmp.set(world.x, world.y + MYSTERY_DROP_ABOVE, 0), new Vec3());
      this.hand.setPosition(from);
      this.tapRing(from, .25);
      tween(this.hand).delay(.35).to(1.1, { position: to }, { easing: 'sineInOut' }).call(() => this.tapRing(to, 0)).delay(.4).call(() => { op.opacity = 0; }).start();
    } else if (this.step === 'tapTurn') {
      // both hands at once, beside the item (off it: on the item a press picks it up): the left
      // hand's finger goes down its left side and the item turns left (anticlockwise), then the
      // right hand's finger goes down its right side and it turns back right
      if (GameState.selected !== it) this.tapRing(from, .2); else this.ring.active = false;   // the prefab's ring sat in the middle otherwise
      const c = from, w = it.node.worldPosition, box = it.localBox;
      const R = Math.max(box.width, box.height) * it.levelScale / 2 + ROTATE_BESIDE;
      const r = Vec3.distance(c, this.toLocal(this.tmp.set(w.x + R, w.y, 0), new Vec3()));
      const right = this.hand, left = this.extraHand();
      left.setScale(-1, 1, 1);   // a left hand: the picture mirrored
      const lop = left.getComponent(UIOpacity) || left.addComponent(UIOpacity);
      Tween.stopAllByTarget(left); Tween.stopAllByTarget(lop);
      left.active = true; lop.opacity = 255;
      const at = (deg: number, out: Vec3) => out.set(c.x + Math.cos(deg * Math.PI / 180) * r, c.y + Math.sin(deg * Math.PI / 180) * r, 0);
      left.setPosition(at(TAP_LEFT[0], new Vec3()));
      right.setPosition(at(TAP_RIGHT[0], new Vec3()));
      // the item itself turns, for real (it pushes its neighbours like a finger's turn would)
      const host = this.host!;
      const arc = this.arc; Tween.stopAllByTarget(arc); arc.t = 0;
      let turned = 0, on = false;
      const sweep = (hand: Node, way: number[], from: number) => () => {
        hand.setPosition(at(way[0] + (way[1] - way[0]) * arc.t, this.tmp));
        const want = from + (way[1] - way[0]) * arc.t;
        if (on) host.demoTurnBy(want - turned);
        turned = want;
      };
      tween(arc).delay(.3).call(() => { turned = 0; on = host.demoTurnStart(it); })
        .to(TAP_SWEEP, { t: 1 }, { easing: 'sineInOut', onUpdate: sweep(left, TAP_LEFT, 0) })
        .delay(.25).call(() => { arc.t = 0; })
        .to(TAP_SWEEP, { t: 1 }, { easing: 'sineInOut', onUpdate: sweep(right, TAP_RIGHT, TAP_LEFT[1] - TAP_LEFT[0]) })
        .delay(.3).call(() => { if (on) host.demoTurnEnd(); on = false; })
        .delay(.1).call(() => { op.opacity = 0; lop.opacity = 0; }).start();
    }
  }

  private tapRing(at: Vec3, delay: number) {
    const ring = this.ring;
    Tween.stopAllByTarget(ring);
    ring.active = true;
    ring.setPosition(at);
    ring.setScale(.3, .3, 1);
    const op = ring.getComponent(UIOpacity) || ring.addComponent(UIOpacity);
    op.opacity = 0;
    Tween.stopAllByTarget(op);
    tween(op).delay(delay).to(.05, { opacity: 230 }).to(.45, { opacity: 0 }).start();
    tween(ring).delay(delay).to(.5, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
  }

  private toLocal(world: Vec3, out: Vec3) { return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(world, out); }
}
