// How-to-play tutorial (gameplay doc "Tutorial"), on the TutorialOverlay prefab above the field.
//   Level 1, once:  1. a hand drags one item from the tray to its place in the bag
//                      ("Drag items into the bag") until the player packs an item;
//                   2. the hand taps an item that must turn, then drags the ↻ handle around
//                      ("Tap an item, then drag ↻ to rotate it") until the player turns one;
//                   3. "Great! Pack everything before time runs out", then normal play.
//   Shake, once:    when 3 items are in the bag (level 1 after the basics, or a later level if it
//                   did not happen there), the hand shakes over the bag ("Shake your phone to
//                   settle the items") until the player shakes (or taps, where shaking cannot be
//                   done), then "Nice! Shaking settles the items".
//   Level 3 / 6 / 9, once each: the hand points at the booster that just opened, with one line
//                   about it, until the player touches the screen.
// The clock stays stopped and no interstitial shows while a tutorial runs. The overlay never
// blocks touches: the player plays the real level under it. Animations are tweens restarted at
// each loop (every ~2 s), nothing runs per frame.
import { _decorator, Component, Node, Label, UITransform, Vec3, Vec2, tween, Tween, UIOpacity, EventTouch, Sprite, SpriteFrame, resources } from 'cc';
import { LocalStore } from '../services/LocalStore';
import { GameState } from '../core/GameState';
import { angleOf } from '../game/DragController';
import type { ItemView } from '../game/ItemView';
const { ccclass, property } = _decorator;

const KEY_BASICS = 'ef.tutorial.basics.v1';
const KEY_BOOSTER = 'ef.tutorial.booster.v1.';
const KEY_SHAKE = 'ef.tutorial.shake.v1';
const SHAKE_AFTER_PACKED = 3;                // items in the bag before the shake step shows
const DONE_SECONDS = 2.6;
const MIN_TURN = 20;                         // degrees: a real rotation, not a slip of the finger
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
};

/** Smallest difference between two angles in degrees (0..180) */
const turnBetween = (a: number, b: number) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };

@ccclass('Tutorial')
export class Tutorial extends Component {
  @property({ type: Node, tooltip: 'Pointing hand (fingertip at the node origin)' }) hand: Node = null!;
  @property({ type: Node, tooltip: 'Ring under the fingertip on a tap' }) ring: Node = null!;
  @property({ type: Node, tooltip: 'Speech bubble' }) bubble: Node = null!;
  @property({ type: Label, tooltip: 'Text of the bubble' }) text: Label = null!;

  private host: TutorialHost | null = null;
  // waitShake: nothing on screen, waiting for enough items in the bag to show the shake step
  private step: 'off' | 'drag' | 'rotate' | 'done' | 'waitShake' | 'shake' | 'shaken' | 'booster' = 'off';
  private target: ItemView | null = null;
  private targetPlace = new Vec3();
  private boosterKey = '';
  private readonly tmp = new Vec3();
  private readonly tmp2 = new Vec2();

  static needsBasics(levelNumber: number) { return levelNumber === 1 && !LocalStore.get(KEY_BASICS); }
  static needsBooster(key: string) { return !LocalStore.get(KEY_BOOSTER + key); }
  static needsShake() { return !LocalStore.get(KEY_SHAKE); }
  /** something is on screen (waiting for the shake step is not) */
  get active() { return this.step !== 'off' && this.step !== 'waitShake'; }

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
  startBasics(host: TutorialHost) {
    this.host = host;
    this.begin();
    host.setActive(true);
    this.showDragStep();
  }

  /** An item was packed into the bag */
  onPacked() {
    if (this.step === 'drag') this.showRotateStep();
    else if (this.step === 'waitShake' && this.host && this.host.packedCount() >= SHAKE_AFTER_PACKED) this.startShake();
  }

  /** Later levels: the shake step was not shown yet (level 1 ended before 3 items were in) */
  watchShake(host: TutorialHost) {
    this.host = host;
    this.step = 'waitShake';
    if (host.packedCount() >= SHAKE_AFTER_PACKED) this.startShake();
  }
  private startShake() {
    this.begin();
    this.host!.setActive(true);
    this.showShakeStep();
  }
  /** Basics done: off screen until enough items are in the bag */
  private waitForShake() {
    LocalStore.set(KEY_BASICS, '1');
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.node.active = false;
    this.host?.setActive(false);
    if (!Tutorial.needsShake() || !this.host) { this.step = 'off'; this.host = null; return; }
    this.watchShake(this.host);
  }

  /** The player selected an item (the rotate handle appeared) or cleared the selection */
  onSelect(item: ItemView | null) {
    if (this.step !== 'rotate') return;
    if (item) this.target = item;
    this.loop();
  }

  /** The player turned an item with the handle by `degrees` */
  onRotated(degrees: number) {
    if (this.step !== 'rotate' || Math.abs(degrees) < MIN_TURN) return;
    this.step = 'done';
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.say('Great! Pack everything before time runs out');
    this.scheduleOnce(() => this.waitForShake(), DONE_SECONDS);
  }

  /** The phone was shaken hard enough to move the items (Shake: one jolt) */
  onShaken() {
    if (this.step !== 'shake') return;
    this.node.off(Node.EventType.TOUCH_START, this.onTouch, this);
    this.step = 'shaken';
    this.stopLoop();
    this.hand.active = false; this.ring.active = false;
    this.say('Nice! Shaking settles the items');
    this.scheduleOnce(() => this.finish(), DONE_SECONDS);
  }

  /** The round ended (won / lost / left) while a tutorial ran */
  stop() {
    if (this.step === 'waitShake') { this.step = 'off'; this.host = null; return; }   // tried again next round
    if (this.active) this.finish();
  }

  private showDragStep() {
    const host = this.host!;
    // the item whose place in the solution needs no turning
    const sol = host.solution().filter(s => host.items()[s.i] && !host.packed(s.i));
    const pick = sol.slice().sort((a, b) => turnBetween(angleOf(host.items()[a.i].node), a.angle) - turnBetween(angleOf(host.items()[b.i].node), b.angle))[0];
    if (!pick) { this.finish(); return; }
    this.step = 'drag';
    this.target = host.items()[pick.i];
    this.targetPlace.set(pick.x, pick.y, 0);
    this.say('Drag items into the bag');
    this.loop();
  }

  private showRotateStep() {
    const host = this.host!;
    // the item that must turn the most to fit its place
    const sol = host.solution().filter(s => host.items()[s.i] && !host.packed(s.i));
    const pick = sol.slice().sort((a, b) => turnBetween(angleOf(host.items()[b.i].node), b.angle) - turnBetween(angleOf(host.items()[a.i].node), a.angle))[0];
    const items = host.items().filter((it, i) => !host.packed(i) && it.node.activeInHierarchy);
    this.target = pick ? host.items()[pick.i] : items[0] || null;
    if (!this.target) { this.finish(); return; }
    this.step = 'rotate';
    this.say('Tap an item, then drag ↻ to rotate it');
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
    this.node.active = true;
    this.node.setSiblingIndex(this.node.parent!.children.length - 1);
    const op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).to(.25, { opacity: 255 }).start();
  }

  private finish() {
    if (this.step === 'booster') LocalStore.set(KEY_BOOSTER + this.boosterKey, '1');
    else if (this.step === 'shake' || this.step === 'shaken') LocalStore.set(KEY_SHAKE, '1');
    else LocalStore.set(KEY_BASICS, '1');
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
  /** Bubble height in the basics: under the HUD, above the bag (set by the prefab position) */
  private bubbleY = 0;

  private loop() {
    this.stopLoop();
    this.playLoop();
    this.schedule(this.playLoop, 2.4);
  }
  private stopLoop() {
    this.unschedule(this.playLoop);
    Tween.stopAllByTarget(this.hand);
    Tween.stopAllByTarget(this.ring);
    Tween.stopAllByTarget(this.arc);   // the circle of the rotate step moves (and then hides) the hand
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
    } else if (this.step === 'rotate') {
      // tap the item, then go round its handle (top-right corner of the item's box)
      const handle = this.handleOf(it, new Vec3());
      const selected = GameState.selected === it;
      const start = selected ? handle : from;
      this.hand.setPosition(start);
      if (!selected) this.tapRing(from, .2);
      const c = from, r = Vec3.distance(handle, from), a0 = Math.atan2(handle.y - from.y, handle.x - from.x);
      const arc = this.arc;
      Tween.stopAllByTarget(arc); arc.t = 0;
      tween(this.hand).delay(selected ? .1 : .5).to(.35, { position: handle }).start();
      tween(arc).delay(selected ? .5 : .9).to(1.1, { t: 1 }, {
        easing: 'sineInOut',
        onUpdate: () => {
          const a = a0 - arc.t * 1.6;   // clockwise about 90°
          this.hand.setPosition(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0);
        },
      }).call(() => { op.opacity = 0; }).start();
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

  /** Rotate handle of an item (ItemView.handleSpot, as DragController draws it), following its rotation */
  private handleOf(it: ItemView, out: Vec3) {
    this.tmp2.set(it.handleSpot);
    Vec2.transformMat4(this.tmp2, this.tmp2, it.node.worldMatrix);
    return this.toLocal(out.set(this.tmp2.x, this.tmp2.y, 0), out);
  }

  private toLocal(world: Vec3, out: Vec3) { return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(world, out); }
}
