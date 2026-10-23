// How-to-play tutorial (gameplay doc "Tutorial"), on the TutorialOverlay prefab above the field.
//   Level 1, once:  1. a hand drags one item from the tray to its place in the bag
//                      ("Drag items into the bag") until the player packs an item;
//                   2. the hand taps an item that must turn, then drags the ↻ handle around
//                      ("Tap an item, then drag ↻ to rotate it") until the player turns one;
//                   3. "Great! Pack everything before time runs out", then normal play.
//   Level 3 / 6 / 9, once each: the hand points at the booster that just opened, with one line
//                   about it, until the player touches the screen.
// The clock stays stopped and no interstitial shows while a tutorial runs. The overlay never
// blocks touches: the player plays the real level under it. Animations are tweens restarted at
// each loop (every ~2 s), nothing runs per frame.
import { _decorator, Component, Node, Label, UITransform, Vec3, Vec2, tween, Tween, UIOpacity, EventTouch } from 'cc';
import { LocalStore } from '../services/LocalStore';
import { GameState } from '../core/GameState';
import type { ItemView } from '../game/ItemView';
const { ccclass, property } = _decorator;

const KEY_BASICS = 'ef.tutorial.basics.v1';
const KEY_BOOSTER = 'ef.tutorial.booster.v1.';
const DONE_SECONDS = 2.6;
const MIN_TURN = 20;                         // degrees: a real rotation, not a slip of the finger

/** What the tutorial needs from the game scene */
export type TutorialHost = {
  /** items of the round and the level's solution (index in items, place in field units, angle in degrees) */
  items(): ItemView[];
  solution(): { i: number; x: number; y: number; angle: number }[];
  /** node the items and the solution places live in */
  itemLayer: Node;
  packed(i: number): boolean;
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
  private step: 'off' | 'drag' | 'rotate' | 'done' | 'booster' = 'off';
  private target: ItemView | null = null;
  private targetPlace = new Vec3();
  private boosterKey = '';
  private readonly tmp = new Vec3();
  private readonly tmp2 = new Vec2();

  static needsBasics(levelNumber: number) { return levelNumber === 1 && !LocalStore.get(KEY_BASICS); }
  static needsBooster(key: string) { return !LocalStore.get(KEY_BOOSTER + key); }
  get active() { return this.step !== 'off'; }

  onLoad() { this.bubbleY = this.bubble.position.y; this.node.active = false; }
  onDestroy() { this.node.targetOff(this); }

  /** Booster intro: a touch anywhere ends it and still reaches the game below (not swallowed) */
  private onTouch(e: EventTouch) {
    e.preventSwallow = true;
    if (this.step === 'booster') this.finish();
  }

  // ---------- level 1 basics ----------
  startBasics(host: TutorialHost) {
    this.host = host;
    this.begin();
    host.setActive(true);
    this.showDragStep();
  }

  /** An item was packed into the bag */
  onPacked() { if (this.step === 'drag') this.showRotateStep(); }

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
    this.scheduleOnce(() => this.finish(), DONE_SECONDS);
  }

  /** The round ended (won / lost / left) while a tutorial ran */
  stop() { if (this.active) this.finish(); }

  private showDragStep() {
    const host = this.host!;
    // the item whose place in the solution needs no turning
    const sol = host.solution().filter(s => host.items()[s.i] && !host.packed(s.i));
    const pick = sol.slice().sort((a, b) => turnBetween(host.items()[a.i].node.eulerAngles.z, a.angle) - turnBetween(host.items()[b.i].node.eulerAngles.z, b.angle))[0];
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
    const pick = sol.slice().sort((a, b) => turnBetween(host.items()[b.i].node.eulerAngles.z, b.angle) - turnBetween(host.items()[a.i].node.eulerAngles.z, a.angle))[0];
    const items = host.items().filter((it, i) => !host.packed(i) && it.node.activeInHierarchy);
    this.target = pick ? host.items()[pick.i] : items[0] || null;
    if (!this.target) { this.finish(); return; }
    this.step = 'rotate';
    this.say('Tap an item, then drag ↻ to rotate it');
    this.loop();
  }

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
    else LocalStore.set(KEY_BASICS, '1');
    this.step = 'off';
    this.node.off(Node.EventType.TOUCH_START, this.onTouch, this);
    this.stopLoop();
    this.unscheduleAllCallbacks();
    Tween.stopAllByTarget(this.hand);
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
  }

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
      const arc = { t: 0 };
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

  /** Rotate handle of an item: top-right corner of its shape box, following its rotation */
  private handleOf(it: ItemView, out: Vec3) {
    const box = it.localBox;
    this.tmp2.set(box.xMax, box.yMax);
    Vec2.transformMat4(this.tmp2, this.tmp2, it.node.worldMatrix);
    return this.toLocal(out.set(this.tmp2.x, this.tmp2.y, 0), out);
  }

  private toLocal(world: Vec3, out: Vec3) { return this.node.getComponent(UITransform)!.convertToNodeSpaceAR(world, out); }
}
