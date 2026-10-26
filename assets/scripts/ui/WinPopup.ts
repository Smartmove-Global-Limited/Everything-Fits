// Level complete popup (web hud.js showWin, Figma "EF · Reward"):
//   LEVEL N COMPLETE! · Packed! · three stars popping in · time used and gold reward ·
//   Continue / Collect ×2 (rewarded ad collect_x2).
// Celebration (doc §5, about 1.3 s, the buttons work all along): a soft glow behind the card
// (it keeps breathing gently while the popup is open),
// the stars one by one (0.17 s apart) growing in with one small bounce and a "ting" rising per
// star won (none for the stars not won), then fireworks behind the card (light streaks, twinkling
// stars) with a soft "pop" and sparkling crackle, then more fireworks and paper confetti all the
// time until the player leaves the popup. Everything is drawn behind the card: it never covers the
// buttons or the reward.
// Continue / Collect ×2 (once the ad was watched): a gold counter like Home's shows at the top
// left, the coins of the reward pop up and fly into it while it counts up, then the next level.
import { _decorator, Component, Node, Sprite, SpriteFrame, resources, Color, Vec3, tween, Tween, UIOpacity, UITransform, Label, Graphics, Layers } from 'cc';
import { findNode, findAll, setText, tap, openPopup, closePopup, contentOf, labelIn } from './UiKit';
import { ScreenFit } from './ScreenFit';
import { Wallet, formatNumber } from '../services/Wallet';
import { RoundRect } from './RoundRect';
import { Overlays } from './Overlays';
import { Sound, SfxName } from '../audio/Sound';
import { Celebration } from './Celebration';
const { ccclass } = _decorator;

const DONE_BG = new Color(0xDC, 0xE4, 0xD2, 255), DONE_BORDER = new Color(0x9D, 0xB8, 0x9A, 255);
const STAR_FIRST = .15, STAR_GAP = .17, STAR_POP = .32;   // s: first star after the card pops, gap, grow time
const TINGS: SfxName[] = ['ting1', 'ting2', 'ting3'];

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
  private fx: Celebration = null!;
  /** above everything in the popup: coins flying to the gold counter */
  private flyFx: Celebration = null!;
  private gold: Node = null!;
  private nextEnable: (on: boolean) => void = () => {};
  private partyTicks = 0;
  private finishing = false;
  private cardSize = { w: 0, h: 0 };

  onLoad() {
    const n = this.node;
    this.card = findNode(n, 'efp-card')!;
    this.stars = findAll(n, 'star');
    this.x2 = findNode(n, 'winX2')!;
    this.x2Face = this.x2.getComponent(RoundRect);
    if (this.x2Face) { this.x2Fill.set(this.x2Face.fill); this.x2Border.set(this.x2Face.borderColor); }
    this.nextEnable = tap(findNode(n, 'next'), () => this.finish(), 'tapBig', this);
    tap(findNode(n, 'winHome'), () => { if (this.finishing) return; this.stopParty(); closePopup(n); this.opts.onHome(); }, 'tap', this);
    this.x2Enable = tap(this.x2, () => this.collectX2(), 'tapBig', this);
    // effects layer right behind the card (the dim is further behind)
    const fxNode = new Node('celebrate'); fxNode.layer = this.card.layer;
    this.card.parent!.insertChild(fxNode, this.card.getSiblingIndex());
    fxNode.setPosition(this.card.position);
    this.fx = fxNode.addComponent(Celebration);
    starFrames ||= Promise.all([frame('uiart/icons/star/spriteFrame'), frame('uiart/icons/star-off/spriteFrame')]);
    this.dropMistakeLine();
    this.gold = this.makeGoldPill();
    const fly = new Node('flyFx'); fly.layer = this.card.layer; n.addChild(fly);
    this.flyFx = fly.addComponent(Celebration);
  }

  /** The reward's coin picture in the score row */
  private rewardCoin(): Node | null {
    return findAll(findNode(this.card, 'winScore')!, 'img').find(i => i.getComponent(Sprite)?.spriteFrame?.name === 'coin') || null;
  }

  /** Gold counter like Home's (cream pill, coin, amount), hidden until Continue / Collect */
  private makeGoldPill(): Node {
    const pill = new Node('winGold'); pill.layer = this.card.layer; this.node.addChild(pill);
    pill.addComponent(UITransform).setContentSize(120, 45);
    pill.addComponent(Graphics);
    const rr = pill.addComponent(RoundRect);
    rr.fill = new Color(0xFF, 0xF8, 0xE9, 255); rr.borderWidth = 1; rr.borderColor = new Color(0xC7, 0xBC, 0xAA, 255);
    rr.radius = 22.4; rr.shadowY = 1.9; rr.shadowBlur = 1.5; rr.shadowColor = new Color(71, 77, 64, 38);
    const coin = new Node('img'); coin.layer = pill.layer; pill.addChild(coin);
    coin.addComponent(UITransform).setContentSize(31, 31);
    const cs = coin.addComponent(Sprite); cs.sizeMode = Sprite.SizeMode.CUSTOM;
    cs.spriteFrame = this.rewardCoin()?.getComponent(Sprite)?.spriteFrame ?? null;
    const t = new Node('amount'); t.layer = pill.layer; pill.addChild(t);
    t.addComponent(UITransform).setAnchorPoint(0, .5);
    const l = t.addComponent(Label);
    const font = labelIn(findNode(this.card, 'winCoin'))?.font;
    if (font) { l.font = font; l.useSystemFont = false; }
    l.fontSize = 21; l.lineHeight = 24; l.color = new Color(0x35, 0x41, 0x3F, 255);
    pill.addComponent(UIOpacity).opacity = 0;
    pill.active = false;
    return pill;
  }

  /** Amount on the counter, the pill hugging it; its left edge where Home's pill sits */
  private setGold(v: number) {
    const pill = this.gold, coin = pill.getChildByName('img')!, t = pill.getChildByName('amount')!;
    const l = t.getComponent(Label)!;
    l.string = formatNumber(v); l.updateRenderData(true);
    const tw = t.getComponent(UITransform)!.width, w = 8 + 31 + 7 + tw + 14;
    pill.getComponent(UITransform)!.width = w;
    coin.setPosition(-w / 2 + 8 + 15.5, 0, 0);
    t.setPosition(-w / 2 + 8 + 31 + 7, 1, 0);
    const vis = ScreenFit.visible(), top = ScreenFit.insets().top;
    pill.setPosition(-vis.width / 2 + 19 + w / 2, vis.height / 2 - top - 42, 0);
  }

  /**
   * Continue / Collect ×2: counter in, the reward's coins pop up and fly into it (it counts up and
   * bumps as each lands), counter out, then the next level.
   */
  private async finish() {
    if (this.finishing) return;
    this.finishing = true;
    this.nextEnable(false); this.x2Enable(false);
    this.stopParty();
    const gained = this.opts.reward * (this.collected ? 2 : 1), end = Wallet.gold, start = Math.max(0, end - gained);
    const pill = this.gold, op = pill.getComponent(UIOpacity)!;
    pill.active = true; pill.setSiblingIndex(this.node.children.length - 1);
    this.setGold(start);
    pill.setScale(.7, .7, 1); op.opacity = 0;
    tween(op).to(.15, { opacity: 255 }).start();
    tween(pill).to(.18, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'quadOut' }).to(.1, { scale: Vec3.ONE }).start();
    await this.wait(.2);
    const from = this.rewardCoin(), coin = pill.getChildByName('img')!;
    const ou = this.node.getComponent(UITransform)!;
    const local = (x: Node) => ou.convertToNodeSpaceAR(x.worldPosition);
    const coins = this.collected ? 12 : 8;
    let landed = 0;
    const flights: Promise<void>[] = [];
    if (from) for (let i = 0; i < coins; i++) {
      flights.push(this.flyFx.fly(from, local(from), local(coin), {
        delay: i * .06, size: 28, pop: true,
        onLand: () => {
          landed++;
          this.setGold(landed >= coins ? end : start + Math.round(gained * landed / coins));
          Tween.stopAllByTarget(pill); pill.setScale(1.12, 1.12, 1);
          tween(pill).to(.12, { scale: Vec3.ONE }, { easing: 'quadOut' }).start();
          Sound.play('tick', { gain: .35 });
        },
      }));
    }
    await Promise.all(flights);
    this.setGold(end);
    await this.wait(.45);
    tween(op).to(.15, { opacity: 0 }).call(() => { pill.active = false; }).start();
    closePopup(this.node);
    this.opts.onContinue();
  }

  private wait(s: number) { return new Promise<void>(ok => this.scheduleOnce(() => ok(), s)); }

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
    for (const c of contentOf(this.card)) {
      if (c === kieu) continue;
      c.setPosition(c.position.x, c.position.y + (c.position.y < kieu.position.y ? d / 2 : -d / 2), 0);
    }
    cardUi.height -= d;
  }

  async open(o: WinOptions) {
    this.opts = o; this.collected = false; this.finishing = false;
    this.nextEnable(true);
    this.gold.active = false;
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
    for (const st of this.stars) { Tween.stopAllByTarget(st); st.setScale(0, 0, 1); }
    openPopup(n, this.card);
    const ui = this.card.getComponent(UITransform)!;
    this.fx.clear();
    this.fx.glow(ui.width, ui.height);
    const [on, off] = await starFrames!;
    const big = new Vec3(1.12, 1.12, 1), last = this.stars.length - 1;
    this.stars.forEach((st, i) => {
      const won = i < o.stars;
      st.getComponent(Sprite)!.spriteFrame = won ? on : off;
      st.setScale(.3, .3, 1);
      // small to full size with one light bounce; only the stars won ring
      tween(st).delay(STAR_FIRST + i * STAR_GAP)
        .call(() => { if (won) Sound.play(TINGS[Math.min(i, TINGS.length - 1)], { gain: .8 }); })
        .to(STAR_POP * .6, { scale: big }, { easing: 'quadOut' })
        .to(STAR_POP * .4, { scale: Vec3.ONE }, { easing: 'quadInOut' })
        .call(() => { if (i === last) { this.fireworks(ui.width, ui.height); this.startParty(ui.width, ui.height); } })
        .start();
    });
  }

  /** Fireworks behind the card: five bursts one after another, above it and on its sides */
  private fireworks(w: number, h: number) {
    if (!this.node.activeInHierarchy) return;
    Sound.play('fireworks', { gain: .8 });
    const spots: [number, number, number][] = [
      [-w * .28, h * .5 + 70, 1], [w * .3, h * .5 + 95, 1], [0, h * .5 + 140, .9],
      [-w * .5 + 4, h * .1, .8], [w * .5 - 4, -h * .05, .8],
    ];
    spots.forEach(([x, y, k], i) => this.scheduleOnce(() => {
      this.fx.firework(x, y, { n: Math.round(34 * k), speed: 230 * k, life: 1.05 });
      if (i === 2) Sound.play('fireworks', { gain: .45 });
    }, i * .13));
  }

  /**
   * Fireworks and paper confetti keep going behind the card until the player leaves the popup:
   * a burst somewhere above or beside the card about every 0.4 s, confetti from the top edge.
   */
  private startParty(w: number, h: number) {
    this.cardSize = { w, h };
    this.partyTicks = 0;
    this.unschedule(this.partyTick);
    this.schedule(this.partyTick, .4);
  }
  private stopParty() { this.unschedule(this.partyTick); }
  private partyTick() {
    if (!this.node.activeInHierarchy || this.finishing) { this.stopParty(); return; }
    const { w, h } = this.cardSize, i = this.partyTicks++;
    const vis = ScreenFit.visible(), cy = this.fx.node.position.y;
    const topY = vis.height / 2 - cy;                      // screen top, in the effects layer's space
    // above the card (most room), sometimes beside it
    const side = i % 4 === 3;
    const x = side ? (i % 8 === 3 ? -1 : 1) * (w * .5 + 2) : (Math.random() - .5) * w * .95;
    const y = side ? (Math.random() - .3) * h * .5 : h * .5 + 50 + Math.random() * Math.max(40, topY - h * .5 - 110);
    const k = side ? .75 : .85 + Math.random() * .3;
    this.fx.firework(x, y, { n: Math.round(30 * k), speed: 220 * k, life: 1.05 });
    this.fx.confetti(-vis.width / 2, vis.width / 2, topY, { n: 5 });
    if (i % 3 === 0) Sound.play('fireworks', { gain: .3 });
  }

  private async collectX2() {
    if (this.collected || this.finishing) return;
    this.x2Enable(false);
    const full = await Overlays.rewarded('collect_x2');
    if (!full) { this.x2Enable(true); return; }
    this.collected = true;
    this.opts.onCollectX2();
    setText(findNode(this.node, 'winCoin'), `+${this.opts.reward * 2}`);
    this.setX2Done(true);
    Sound.play('unlockLv', { gain: .7 });
    this.finish();
  }

  /** web .efbtn.done: pale green, "Collected", no longer pressable */
  private setX2Done(done: boolean) {
    setText(findNode(this.x2, 'span'), done ? 'Collected' : 'Collect ×2');
    if (this.x2Face) this.x2Face.setColors(done ? DONE_BG : this.x2Fill, done ? DONE_BORDER : this.x2Border);
    this.x2Enable(!done);
    if (done) (this.x2.getComponent(UIOpacity) || this.x2.addComponent(UIOpacity)).opacity = 255;   // web .done keeps full opacity
  }
}
