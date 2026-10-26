// Light celebration effects for the UI (win popup, Shop): a soft glow behind a card, hand-drawn
// fireworks and paper confetti (butter yellow / cream / coral), soft rings, and pictures (coins,
// boosters) flying to where they are kept.
// One Graphics on its own node, placed behind the card it celebrates so it never covers buttons
// or rewards; redrawn only while something is alive. Particle records are pooled.
import { _decorator, Component, Graphics, Color, UITransform, Node, Sprite, Vec3, Layers, UIOpacity, tween } from 'cc';
const { ccclass } = _decorator;

type Kind = 'star' | 'paper' | 'dot' | 'streak';
type Spark = { x: number; y: number; vx: number; vy: number; t: number; life: number; size: number; color: Color; kind: Kind; rot: number; vr: number; drag: number; fall: number; sway: number };
type Ring = { x: number; y: number; r0: number; r1: number; t: number; life: number; color: Color; width: number };
type Glow = { w: number; h: number; radius: number; t: number; fadeIn: number; color: Color };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const hex = (h: string, a = 255) => new Color(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a);
/** doc §5: mostly butter yellow, cream and coral */
export const PARTY = ['#F6D776', '#F9E3A3', '#FFF4DC', '#F28C7A', '#F6D776', '#F4A896', '#FFFFFF'].map(c => hex(c));
const GLOW_LAYERS = 9;

@ccclass('Celebration')
export class Celebration extends Component {
  private g: Graphics = null!;
  private sparks: Spark[] = [];
  private free: Spark[] = [];
  private rings: Ring[] = [];
  private glowBox: Glow | null = null;
  private drawn = false;
  private tmp = new Color();

  onLoad() {
    if (!this.getComponent(UITransform)) this.addComponent(UITransform);
    this.g = this.getComponent(Graphics) || this.addComponent(Graphics);
  }

  /** Soft glow around a w×h card centred on this node (breathes slowly until stopGlow) */
  glow(w: number, h: number, { radius = 22, color = '#FFE7A6', fadeIn = .35 } = {}) {
    this.glowBox = { w, h, radius, t: 0, fadeIn, color: hex(color) };
  }
  stopGlow() { this.glowBox = null; }

  /** Small burst at (x, y), local to this node: stars, paper bits and dots (purchase, landing) */
  burst(x: number, y: number, { n = 18, speed = 150, life = .75, colors = PARTY } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-.2, .2), v = speed * rnd(.55, 1.1);
      const r = Math.random();
      const kind: Kind = r < .4 ? 'star' : r < .7 ? 'paper' : 'dot';
      this.spark(x, y, a, v, life * rnd(.65, 1), kind, kind === 'star' ? rnd(3.5, 6) : kind === 'paper' ? rnd(3, 5.5) : rnd(1.8, 3.2), colors, .04, 160);
    }
  }

  /**
   * Firework at (x, y): a ring of light streaks shooting out with short trails, big twinkling
   * stars and a few paper bits drifting down, all fading out by the end of `life`.
   */
  firework(x: number, y: number, { n = 34, speed = 230, life = 1.05, colors = PARTY } = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-.12, .12), v = speed * rnd(.75, 1.05);
      this.spark(x, y, a, v, life * rnd(.75, 1), 'streak', rnd(2.8, 3.6), colors, .3, 150);
    }
    for (let i = 0; i < n / 3; i++) {
      const a = rnd(0, Math.PI * 2), v = speed * rnd(.3, .75);
      this.spark(x, y, a, v, life * rnd(.8, 1.15), Math.random() < .7 ? 'star' : 'paper', rnd(5, 8.5), colors, .2, 120);
    }
  }

  private spark(x: number, y: number, a: number, v: number, life: number, kind: Kind, size: number, colors: Color[], drag: number, fall: number) {
    const s = this.free.pop() || ({} as Spark);
    s.x = x; s.y = y; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v; s.t = 0; s.life = life;
    s.kind = kind; s.size = size; s.color = colors[(Math.random() * colors.length) | 0];
    s.rot = rnd(0, Math.PI * 2); s.vr = rnd(-7, 7); s.drag = drag; s.fall = fall; s.sway = 0;
    this.sparks.push(s);
  }

  /** Paper confetti falling from y (local), spread over x0..x1, swaying as it falls */
  confetti(x0: number, x1: number, y: number, { n = 8, life = 3, colors = PARTY } = {}) {
    for (let i = 0; i < n; i++) {
      this.spark(rnd(x0, x1), y + rnd(0, 30), -Math.PI / 2 + rnd(-.5, .5), rnd(30, 90), life * rnd(.75, 1.15), 'paper', rnd(4.5, 7.5), colors, .5, 55);
      this.sparks[this.sparks.length - 1].sway = rnd(18, 34);
    }
  }

  /**
   * A copy of `src`'s picture flying from a to b (this node's parent space) on a soft arc, on top
   * of everything; `pop`: it first bounces up from nothing. Resolves when it has landed.
   */
  fly(src: Node, a: Vec3, b: Vec3, { delay = 0, size = 26, pop = false, onLand }: { delay?: number; size?: number; pop?: boolean; onLand?: () => void } = {}): Promise<void> {
    const sp = src.getComponent(Sprite) || src.getComponentInChildren(Sprite);
    const layer = this.node.parent;
    if (!sp?.spriteFrame || !layer) return Promise.resolve();
    const n = new Node('fly'); n.layer = Layers.Enum.UI_2D; layer.addChild(n);
    const r = sp.spriteFrame.rect, k = size / Math.max(r.width, r.height);
    const nu = n.addComponent(UITransform);
    const s = n.addComponent(Sprite); s.sizeMode = Sprite.SizeMode.CUSTOM; s.spriteFrame = sp.spriteFrame;
    nu.setContentSize(r.width * k, r.height * k);
    const op = n.addComponent(UIOpacity); op.opacity = 0;
    const sx = a.x + (Math.random() - .5) * 30, sy = a.y + (Math.random() - .5) * 20;
    n.setPosition(sx, sy, 0);
    const mid = new Vec3((sx + b.x) / 2 + (Math.random() - .5) * 60, Math.max(sy, b.y) + 60, 0);
    const lead = pop ? .2 : 0;
    if (pop) {
      n.setScale(0, 0, 1);
      tween(n).delay(delay).to(.12, { scale: new Vec3(1.3, 1.3, 1) }, { easing: 'quadOut' }).to(.08, { scale: Vec3.ONE }).start();
    }
    return new Promise(done => {
      const p = { k: 0 };
      tween(op).delay(delay).to(.08, { opacity: 255 }).start();
      tween(p).delay(delay + lead).to(.55, { k: 1 }, {
        easing: 'quadIn',
        onUpdate: () => {
          const t = p.k, u = 1 - t;   // quadratic curve a → mid → b
          n.setPosition(u * u * sx + 2 * u * t * mid.x + t * t * b.x, u * u * sy + 2 * u * t * mid.y + t * t * b.y, 0);
          n.setScale(1 - t * .35, 1 - t * .35, 1);
        },
      }).call(() => { n.destroy(); onLand?.(); this.burst(b.x, b.y, { n: 5, speed: 60, life: .35 }); done(); }).start();
    });
  }

  /** Soft ring spreading out from (x, y) */
  ring(x: number, y: number, { r0 = 10, r1 = 120, life = .55, color = '#FFE7A6', width = 10 } = {}) {
    this.rings.push({ x, y, r0, r1, t: 0, life, color: hex(color), width });
  }

  clear() {
    for (const s of this.sparks) this.free.push(s);
    this.sparks.length = 0; this.rings.length = 0; this.glowBox = null;
    this.g.clear(); this.drawn = false;
  }

  update(dt: number) {
    if (!this.sparks.length && !this.rings.length && !this.glowBox) {
      if (this.drawn) { this.g.clear(); this.drawn = false; }
      return;
    }
    const g = this.g, c = this.tmp;
    g.clear(); this.drawn = true;

    const gl = this.glowBox;
    if (gl) {
      gl.t += dt;
      const fade = Math.min(1, gl.t / gl.fadeIn), breathe = .85 + .15 * Math.sin(gl.t * 2.2);
      // layered rounded boxes, fainter outward: a soft halo showing around the card's edges
      for (let i = GLOW_LAYERS; i >= 1; i--) {
        const pad = i * 5 * breathe;
        c.set(gl.color.r, gl.color.g, gl.color.b, Math.round(26 * fade * (1 - i / (GLOW_LAYERS + 1))));
        g.fillColor = c;
        g.roundRect(-gl.w / 2 - pad, -gl.h / 2 - pad, gl.w + pad * 2, gl.h + pad * 2, gl.radius + pad);
        g.fill();
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const e = 1 - (1 - k) * (1 - k);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      // a soft band: three strokes, the outer ones fainter
      for (let j = 0; j < 3; j++) {
        c.set(r.color.r, r.color.g, r.color.b, Math.round((j === 1 ? 150 : 60) * (1 - k)));
        g.strokeColor = c; g.lineWidth = r.width * (j === 1 ? .5 : 1) * (1 - k * .5);
        g.circle(r.x, r.y, rad + (j - 1) * r.width * .35); g.stroke();
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t >= s.life) { this.free.push(s); this.sparks.splice(i, 1); continue; }
      // slow down, a little fall, fade out at the end (stars twinkle while they fade)
      const drag = Math.pow(s.drag, dt);
      s.vx *= drag; s.vy = s.vy * drag - s.fall * dt;
      s.x += (s.vx + (s.sway ? Math.sin(s.t * 3.2 + s.rot) * s.sway : 0)) * dt; s.y += s.vy * dt; s.rot += s.vr * dt;
      const k = s.t / s.life;
      let a = k < .55 ? 1 : 1 - (k - .55) / .45;
      if (s.kind === 'star' && k > .4) a *= .55 + .45 * Math.sin(s.t * 38 + s.rot);
      c.set(s.color.r, s.color.g, s.color.b, Math.round(255 * Math.max(0, a)));
      if (s.kind === 'streak') {
        // a light trail behind the head, shorter as it slows down
        g.strokeColor = c; g.lineWidth = s.size * (1 - k * .5); g.lineCap = Graphics.LineCap.ROUND;
        g.moveTo(s.x - s.vx * .08, s.y - s.vy * .08); g.lineTo(s.x, s.y); g.stroke();
        g.fillColor = c; g.circle(s.x, s.y, s.size * .75); g.fill();     // bright head
        continue;
      }
      g.fillColor = c;
      const z = s.size * (k < .15 ? .6 + k / .15 * .4 : 1);
      if (s.kind === 'dot') g.circle(s.x, s.y, z);
      else if (s.kind === 'paper') this.paper(s.x, s.y, z, s.rot);
      else this.star(s.x, s.y, z, s.rot);
      g.fill();
    }
  }

  /** A small paper bit: a rectangle turning in the air (thin when seen edge-on) */
  private paper(x: number, y: number, z: number, rot: number) {
    const g = this.g, w = z * 1.3, h = z * .7 * Math.abs(Math.cos(rot * 1.7)) + .6;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const pt = (px: number, py: number) => [x + px * cs - py * sn, y + px * sn + py * cs];
    const p = [pt(-w, -h), pt(w, -h), pt(w, h), pt(-w, h)];
    g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < 4; i++) g.lineTo(p[i][0], p[i][1]); g.close();
  }

  /** A four-point star (sparkle) */
  private star(x: number, y: number, z: number, rot: number) {
    const g = this.g;
    for (let i = 0; i < 8; i++) {
      const a = rot + i * Math.PI / 4, r = i % 2 ? z * .38 : z;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.close();
  }
}
