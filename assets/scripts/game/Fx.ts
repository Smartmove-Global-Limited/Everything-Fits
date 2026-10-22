// Visual effects (web src/game/fx.js): sparkles when an item fits, dust where an item lands,
// expanding rings, confetti on a win, floating text, a short screen shake. Everything is drawn
// by ONE Graphics on the FxLayer (Field space, y up) and only redrawn while something is alive;
// particle records and labels are pooled, nothing is allocated per frame once warmed up.
import { _decorator, Component, Graphics, Color, Node, Label, LabelOutline, UITransform, UIOpacity, Font, Vec3 } from 'cc';
import { DESIGN_W, DESIGN_H } from '../core/GameConstants';
const { ccclass, property } = _decorator;

type Particle = { x: number; y: number; vx: number; vy: number; g: number; t: number; life: number; size: number; color: Color; flake: boolean; rot: number; vr: number; wob: number; phase: number };
type Ring = { x: number; y: number; r0: number; r1: number; t: number; life: number; color: Color; width: number; flat: boolean };
type Puff = { x: number; y: number; t: number };
type Floater = { node: Node; label: Label; op: UIOpacity; x: number; y: number; t: number; life: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const hex = (h: string, a = 255) => new Color(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a);
const CONFETTI = ['#E2637F', '#E2B04A', '#5FBF9B', '#7B4FD8', '#3D8BFF', '#FFFFFF'].map(c => hex(c));
const DUST_DARK = new Color(120, 86, 56, 128), DUST_LIGHT = new Color(255, 248, 236, 235), DUST_RING = new Color(255, 250, 240, 191);
const WHITE = new Color(255, 255, 255, 230);
const WAVE = hex('#4A90D9'), PUFF = hex('#E2637F'), PUFF_DOT = new Color(255, 255, 255, 255);

@ccclass('Fx')
export class Fx extends Component {
  @property(Font) font: Font | null = null;
  /** node shaken by shake(): the camera (moving the Field would drag the physics bodies along) */
  @property(Node) shakeTarget: Node | null = null;

  private g: Graphics = null!;
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private puffs: Puff[] = [];
  private floats: Floater[] = [];
  private freeParts: Particle[] = [];
  private freeFloats: Floater[] = [];
  private shakeLeft = 0;
  private shakeBase = new Vec3();
  private tmp = new Color();
  private wave = { x: 0, y: 0, on: false, drawn: false };

  static instance: Fx | null = null;

  onLoad() {
    Fx.instance = this;
    this.g = this.getComponent(Graphics) || this.addComponent(Graphics);
    if (this.shakeTarget) this.shakeBase.set(this.shakeTarget.position);
  }
  onDestroy() { if (Fx.instance === this) Fx.instance = null; }

  private part(): Particle {
    return this.freeParts.pop() || { x: 0, y: 0, vx: 0, vy: 0, g: 0, t: 0, life: 0, size: 0, color: WHITE, flake: false, rot: 0, vr: 0, wob: 0, phase: 0 };
  }

  /** Burst of dots from a point (item fitted). Speeds in units/s, y up. */
  sparkle(x: number, y: number, { n = 14, color = '#5FBF9B', speed = 1, life = 620 } = {}) {
    const c = hex(color);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-.25, .25), v = rnd(.9, 2.3) * speed * 60;
      const p = this.part();
      p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.g = 260; p.t = 0;
      p.life = life * rnd(.7, 1.2); p.size = rnd(2.2, 4.4); p.color = c; p.flake = false;
      this.parts.push(p);
    }
  }

  /** Dust puff where an item landed: small dots kicked sideways, plus a flat ring on the ground */
  dust(x: number, y: number, { n = 5, strength = .5 } = {}) {
    for (let i = 0; i < n; i++) {
      const side = (Math.random() - .5) * 2, p = this.part();
      p.x = x + side * 8; p.y = y + 2;
      p.vx = side * (40 + Math.random() * 54) * (.6 + strength);
      p.vy = (24 + Math.random() * 42) * (.5 + strength);
      p.g = 200; p.t = 0; p.life = 420 + Math.random() * 340;
      p.size = 2.6 + Math.random() * 3.4 * (.7 + strength);
      p.color = i % 3 === 0 ? DUST_DARK : DUST_LIGHT; p.flake = false;
      this.parts.push(p);
    }
    this.rings.push({ x, y, r0: 3, r1: 18 + strength * 22, t: 0, life: 300, color: DUST_RING, width: 3, flat: true });
  }

  ring(x: number, y: number, { color = '#5FBF9B', r0 = 8, r1 = 58, life = 480, width = 4 } = {}) {
    this.rings.push({ x, y, r0, r1, t: 0, life, color: hex(color), width, flat: false });
  }

  /** Paper confetti falling from the top edge (win) */
  confetti(n = 80) {
    for (let i = 0; i < n; i++) {
      const p = this.part();
      p.x = rnd(0, DESIGN_W); p.y = DESIGN_H + rnd(8, DESIGN_H * .25);
      p.vx = rnd(-42, 42); p.vy = -rnd(70, 190); p.g = 90; p.t = 0; p.life = rnd(1800, 3200);
      p.size = rnd(4, 8.5); p.color = CONFETTI[(Math.random() * CONFETTI.length) | 0];
      p.flake = true; p.rot = rnd(0, Math.PI * 2); p.vr = rnd(-5, 5); p.wob = rnd(1.5, 3.4); p.phase = rnd(0, 6.28);
      this.parts.push(p);
    }
  }

  /** Small text rising and fading (Crack!, −20%, Bye!) */
  floatText(x: number, y: number, text: string, { color = '#3B2A4A', life = 900, size = 15 } = {}) {
    let f = this.freeFloats.pop();
    if (!f) {
      const node = new Node('FloatText'); node.layer = this.node.layer; this.node.addChild(node);
      node.addComponent(UITransform);
      const label = node.addComponent(Label);
      if (this.font) { label.font = this.font; label.useSystemFont = false; }
      const o = node.addComponent(LabelOutline); o.color = WHITE; o.width = 2;
      f = { node, label, op: node.addComponent(UIOpacity), x: 0, y: 0, t: 0, life: 0 };
    }
    f.node.active = true;
    f.label.string = text; f.label.fontSize = size; f.label.lineHeight = size + 4; f.label.color = hex(color);
    f.x = x; f.y = y; f.t = 0; f.life = life;
    this.floats.push(f);
  }

  /** Pink ring with white dots where an item vanished / reappeared (web render.js drawPuffs, 380 ms) */
  puff(x: number, y: number) { this.puffs.push({ x, y, t: 0 }); }

  /** Vibration waves around a buzzing phone, for this frame only */
  phoneWaves(x: number, y: number) { this.wave.x = x; this.wave.y = y; this.wave.on = true; }

  /** Short shake of the play field (web: CSS shake on the canvas) */
  shake(ms = 380) {
    if (!this.shakeTarget) return;
    if (this.shakeLeft <= 0) this.shakeBase.set(this.shakeTarget.position);
    this.shakeLeft = Math.max(this.shakeLeft, ms);
  }

  clear() {
    for (const p of this.parts) this.freeParts.push(p);
    this.parts.length = 0; this.rings.length = 0; this.puffs.length = 0;
    for (const f of this.floats) { f.node.active = false; this.freeFloats.push(f); }
    this.floats.length = 0;
    this.g.clear();
  }

  /** Called by the game loop; dt in seconds */
  tick(dt: number) {
    const ms = dt * 1000;
    if (this.shakeLeft > 0 && this.shakeTarget) {
      this.shakeLeft -= ms;
      const k = Math.max(0, this.shakeLeft) / 380, a = 6 * Math.min(1, k + .3);
      if (this.shakeLeft > 0) this.shakeTarget.setPosition(this.shakeBase.x + rnd(-a, a), this.shakeBase.y + rnd(-a * .6, a * .6), this.shakeBase.z);
      else this.shakeTarget.setPosition(this.shakeBase);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += ms;
      if (f.t >= f.life) { f.node.active = false; this.freeFloats.push(f); this.floats.splice(i, 1); continue; }
      const k = f.t / f.life, grow = 1 + (1 - Math.pow(1 - k, 3)) * .12;
      f.node.setPosition(f.x, f.y + k * 34, 0);
      f.node.setScale(grow, grow, 1);
      f.op.opacity = Math.round(255 * (1 - k * k));
    }
    const w = this.wave;
    if (!this.parts.length && !this.rings.length && !this.puffs.length && !w.on && !w.drawn) return;
    const g = this.g, c = this.tmp;
    g.clear();
    if (w.on) {
      g.strokeColor = WAVE; g.lineWidth = 2.5;
      const j = (Math.random() - .5) * 3;
      for (const r of [30, 38]) {
        g.arc(w.x + j, w.y, r, -.5, .5, true); g.stroke();
        g.arc(w.x + j, w.y, r, Math.PI - .5, Math.PI + .5, true); g.stroke();
      }
    }
    w.drawn = w.on; w.on = false;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += ms;
      if (p.t >= p.life) { this.freeParts.push(p); this.parts.splice(i, 1); continue; }
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.t / p.life;
      c.set(p.color.r, p.color.g, p.color.b, Math.round(p.color.a * Math.min(1, k * 1.8)));
      g.fillColor = c;
      if (p.flake) {
        // paper flake flipping while it falls
        p.rot += p.vr * dt;
        const flip = Math.abs(Math.cos(p.phase + p.t / 1000 * p.wob));
        const hw = p.size / 2, hh = Math.max(.5, p.size * flip / 2), cs = Math.cos(p.rot), sn = Math.sin(p.rot);
        g.moveTo(p.x + (-hw * cs + hh * sn), p.y + (-hw * sn - hh * cs));
        g.lineTo(p.x + (hw * cs + hh * sn), p.y + (hw * sn - hh * cs));
        g.lineTo(p.x + (hw * cs - hh * sn), p.y + (hw * sn + hh * cs));
        g.lineTo(p.x + (-hw * cs - hh * sn), p.y + (-hw * sn + hh * cs));
        g.close(); g.fill();
      } else { g.circle(p.x, p.y, p.size * k); g.fill(); }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += ms / 380;
      if (p.t >= 1) { this.puffs.splice(i, 1); continue; }
      const fade = Math.round(255 * (1 - p.t));
      c.set(PUFF.r, PUFF.g, PUFF.b, fade); g.strokeColor = c; g.lineWidth = 4 * (1 - p.t) + 1;
      g.circle(p.x, p.y, 10 + p.t * 46); g.stroke();
      c.set(PUFF_DOT.r, PUFF_DOT.g, PUFF_DOT.b, fade); g.fillColor = c;
      for (let k = 0; k < 6; k++) {
        const a = -(k * Math.PI / 3 + .4), r = 14 + p.t * 40;   // web angles are clockwise (y down)
        g.circle(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 3.5 * (1 - p.t)); g.fill();
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += ms;
      if (r.t >= r.life) { this.rings.splice(i, 1); continue; }
      const k = r.t / r.life, rad = r.r0 + (r.r1 - r.r0) * k;
      c.set(r.color.r, r.color.g, r.color.b, Math.round(r.color.a * (1 - k) * .95));
      g.strokeColor = c; g.lineWidth = r.width * (1 - k) + .6;
      if (r.flat) g.ellipse(r.x, r.y, rad, rad * .34); else g.circle(r.x, r.y, rad);
      g.stroke();
    }
  }
}
