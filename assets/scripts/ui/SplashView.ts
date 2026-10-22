// Splash at app start (web src/ui/splash.js): items cover the screen, no logo, no button.
//   1. SHOW  items pop in from the centre outwards on a staggered grid (grow, small overshoot)
//   2. SWAY  the whole heap wobbles, each item at its own pace
//   3. FALL  items drop one after another through the bottom edge; then the splash fades out
// A touch skips ahead (falls at once, or closes while falling). No physics: hand-made falling.
// Lives only while it plays, then destroys its node.
import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, UIOpacity, Graphics, Color, resources, tween, Layers, view, director, Director } from 'cc';
import { Sound } from '../audio/Sound';
const { ccclass } = _decorator;

const W = 420;
let H = 760;   // the visible height (tall phones show more than the 760 design)
const CELL = 100;                // grid cell: the biggest item side (web 82; fewer, bigger items are lighter on weak phones)
const SHOW = 700, POP = 260, SWAY = 1250, SPREAD = 650;
const G = .0024;                 // fall acceleration, units / ms²
const TOTAL = SHOW + SWAY + SPREAD + 900;
const BG = new Color(0xD9, 0xCF, 0xBE, 255);

type Piece = { node: Node; x: number; y: number; scale: number; angle: number; showAt: number; swayPhase: number; swaySpeed: number; swayAmp: number;
  fallDelay: number; vx: number; vy: number; vr: number; dx: number; dy: number; dr: number };

const off = (k: number) => (Math.random() - .5) * 2 * k;

@ccclass('SplashView')
export class SplashView extends Component {
  private pieces: Piece[] = [];
  private t = 0;
  private fallAt = SHOW + SWAY;
  private falling = false;
  private closing = false;
  private lastTick = 0;
  private done: () => void = () => {};

  /**
   * Load the splash images and play. Resolves when the splash has faded out. `onShown` runs once
   * the items have been drawn a few frames (the native launch cover can go then, no black frame).
   */
  static play(parent: Node, onShown?: () => void): Promise<void> {
    H = Math.max(760, view.getVisibleSize().height);
    // cover the screen in this very frame: nothing behind it (Home) may show before the splash
    const node = new Node('Splash'); node.layer = Layers.Enum.UI_2D; parent.addChild(node);
    node.addComponent(UITransform).setContentSize(W, H);
    const bg = node.addComponent(Graphics); bg.fillColor = BG; bg.rect(-W, -H, W * 2, H * 2); bg.fill();   // covers letterbox bands too
    const splash = node.addComponent(SplashView);
    splash.enabled = false;                       // no update() until the items are there
    return new Promise(res => {
      splash.done = res;
      SplashView.loadFrames().then(frames => {
        if (!frames.length) { onShown?.(); splash.close(); return; }
        splash.build(frames); splash.enabled = true;
        if (onShown) { let n = 0; const after = () => { if (++n >= 2) { director.off(Director.EVENT_AFTER_DRAW, after); onShown(); } }; director.on(Director.EVENT_AFTER_DRAW, after); }
      });
    });
  }

  /** Small copies of item images packed in one auto atlas (resources/splash): one texture, one draw call */
  private static loadFrames(): Promise<SpriteFrame[]> {
    return new Promise(ok => resources.loadDir('splash', SpriteFrame, (_e, list) => ok((list || []).filter(Boolean))));
  }

  private build(frames: SpriteFrame[]) {
    const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / (CELL * .86)) + 1;
    let k = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const f = frames[(k++ * 7 + ((Math.random() * 5) | 0)) % frames.length];   // mixed, no repeating pattern
      const x = (i - .5 + (j % 2) * .5) * CELL + off(CELL * .16);
      const y = (j - .3) * CELL * .86 + off(CELL * .14);          // web y down
      const size = f.originalSize, longest = Math.max(size.width, size.height);
      const node = new Node('Item'); node.layer = this.node.layer;
      node.addComponent(UITransform).setContentSize(size.width, size.height);
      const s = node.addComponent(Sprite); s.sizeMode = Sprite.SizeMode.CUSTOM; s.spriteFrame = f;
      node.setScale(0, 0, 1);
      const dist = Math.hypot(x - W / 2, y - H * .45) / Math.hypot(W / 2, H * .55);
      this.pieces.push({ node, x, y, scale: CELL * (.82 + Math.random() * .24) / longest, angle: off(.5),
        showAt: Math.min(SHOW - POP, dist * (SHOW - POP) + off(60)),
        swayPhase: Math.random() * Math.PI * 2, swaySpeed: .0048 + Math.random() * .003, swayAmp: .05 + Math.random() * .05,
        fallDelay: 0, vx: 0, vy: 0, vr: 0, dx: 0, dy: 0, dr: 0 });
    }
    // lower rows drawn over upper rows, like a heap
    this.pieces.sort((a, b) => a.y - b.y);
    for (const p of this.pieces) this.node.addChild(p.node);
    this.node.on(Node.EventType.TOUCH_START, () => (this.falling ? this.close() : this.startFall(true)), this);
    this.scheduleOnce(() => this.close(), (TOTAL + 2500) / 1000);   // safety net
  }

  private startFall(fast = false) {
    if (this.falling) return;
    this.falling = true; this.fallAt = this.t;
    const spread = fast ? SPREAD * .45 : SPREAD;
    for (const p of this.pieces) {
      p.fallDelay = (1 - p.y / H) * spread * .7 + Math.random() * spread * .3;   // bottom rows go first
      p.vx = off(.06); p.vy = -.12 - Math.random() * .18; p.vr = off(.0035);    // little hop first
    }
    Sound.play('whoosh', { gain: .5 });
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    const op = this.node.addComponent(UIOpacity);
    tween(op).to(.38, { opacity: 0 }).call(() => { this.done(); this.node.destroy(); }).start();
  }

  update(dt: number) {
    const ms = Math.min(34, dt * 1000);
    this.t += ms;
    if (this.t < SHOW && this.t - this.lastTick > 70) { this.lastTick = this.t; Sound.play('tap', { gain: .14 }); }
    if (!this.falling && this.t >= SHOW + SWAY) this.startFall();
    let onScreen = 0;
    for (const p of this.pieces) {
      const tt = this.t - p.showAt;
      if (tt <= 0) { onScreen++; continue; }
      const e = Math.min(1, tt / POP);
      const pop = e < 1 ? 1 - Math.pow(1 - e, 3) * Math.cos(e * 5.5) : 1;
      const sway = Math.sin(this.t * p.swaySpeed + p.swayPhase) * p.swayAmp * Math.min(1, tt / 400);
      if (this.falling && this.t - this.fallAt >= p.fallDelay) {
        p.vy += G * ms; p.dx += p.vx * ms; p.dy += p.vy * ms; p.dr += p.vr * ms;
      }
      if (p.y + p.dy - CELL < H) onScreen++;
      const s = p.scale * Math.max(0, pop);
      p.node.setScale(s, s, 1);
      p.node.setPosition(p.x + p.dx - W / 2, H / 2 - (p.y + p.dy), 0);
      p.node.angle = -(p.angle + sway + p.dr) * 180 / Math.PI;
    }
    if (this.falling && !onScreen) this.close();
  }
}
