// A rounded panel, the Cocos counterpart of the web CSS boxes (border-radius, background, border,
// "lip" box-shadow 0 Npx 0 <color>, soft drop shadow).
// In the game the panel is a smooth picture: each look (colours, radius, border, shadow) is
// painted once into a small 9-slice texture at the screen's own pixel density, with soft
// (anti-aliased) edges like a Figma export, and shown by a sliced Sprite on the child "__skin".
// Graphics (no anti-aliasing on Android: jagged corners) only draws in the Cocos editor and for
// square boxes. Redrawn only when the node size or a property changes, never per frame.
import { _decorator, Component, Graphics, Color, UITransform, Node, Sprite, SpriteFrame, Texture2D, ImageAsset, view, sys, Layers } from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

@ccclass('RoundRect')
@executeInEditMode
@requireComponent(Graphics)
export class RoundRect extends Component {
  @property private _fill = new Color(255, 248, 233, 255);
  @property private _radius = 16;
  @property private _borderWidth = 0;
  @property private _borderColor = new Color(255, 248, 233, 255);
  @property private _lip = 0;
  @property private _lipColor = new Color(226, 214, 188, 255);
  @property private _shadowY = 0;
  @property private _shadowBlur = 0;
  @property private _shadowColor = new Color(71, 77, 64, 46);
  @property private _glow = 0;
  @property private _glowColor = new Color(127, 200, 240, 115);

  @property({ tooltip: 'Background (CSS background)' }) get fill() { return this._fill; }
  set fill(v: Color) { this._fill.set(v); this.redraw(); }
  @property({ tooltip: 'Corner radius (CSS border-radius); clamped to half the height' }) get radius() { return this._radius; }
  set radius(v: number) { this._radius = v; this.redraw(); }
  @property({ tooltip: 'Border width (CSS border), drawn inside the box' }) get borderWidth() { return this._borderWidth; }
  set borderWidth(v: number) { this._borderWidth = v; this.redraw(); }
  @property get borderColor() { return this._borderColor; }
  set borderColor(v: Color) { this._borderColor.set(v); this.redraw(); }
  @property({ tooltip: 'Solid shadow right under the box (CSS box-shadow: 0 <lip>px 0 <color>)' }) get lip() { return this._lip; }
  set lip(v: number) { this._lip = v; this.redraw(); }
  @property get lipColor() { return this._lipColor; }
  set lipColor(v: Color) { this._lipColor.set(v); this.redraw(); }
  @property({ tooltip: 'Soft shadow offset (CSS box-shadow y)' }) get shadowY() { return this._shadowY; }
  set shadowY(v: number) { this._shadowY = v; this.redraw(); }
  @property({ tooltip: 'Soft shadow blur (0 = none), approximated with a few translucent layers' }) get shadowBlur() { return this._shadowBlur; }
  set shadowBlur(v: number) { this._shadowBlur = v; this.redraw(); }
  @property get shadowColor() { return this._shadowColor; }
  set shadowColor(v: Color) { this._shadowColor.set(v); this.redraw(); }

  @property({ tooltip: 'Solid ring around the box (CSS box-shadow: 0 0 0 <glow>px <color>)' }) get glow() { return this._glow; }
  set glow(v: number) { this._glow = v; this.redraw(); }
  @property get glowColor() { return this._glowColor; }
  set glowColor(v: Color) { this._glowColor.set(v); this.redraw(); }

  private g: Graphics | null = null;
  private static readonly tmp = new Color();

  onLoad() { this.g = this.getComponent(Graphics); }
  private drawn = false;
  private drawnW = 0; private drawnH = 0;
  onEnable() {
    this.node.on(Node.EventType.SIZE_CHANGED, this.redraw, this);
    this.node.on(Node.EventType.ANCHOR_CHANGED, this.redraw, this);
    // Graphics keeps its shape while the node is inactive: re-showing a screen redraws nothing,
    // unless the box was resized meanwhile (a bar pinned above the ad banner while hidden)
    const ui = this.getComponent(UITransform);
    if (!this.drawn || (ui && (ui.width !== this.drawnW || ui.height !== this.drawnH))) this.redraw();
  }
  onDisable() { this.node.off(Node.EventType.SIZE_CHANGED, this.redraw, this); this.node.off(Node.EventType.ANCHOR_CHANGED, this.redraw, this); }

  /** Change fill and border in one go (state changes: pressed, locked, empty…) */
  setColors(fill: Color, border?: Color) { this._fill.set(fill); if (border) this._borderColor.set(border); this.redraw(); }

  redraw() {
    const g = this.g || (this.g = this.getComponent(Graphics));
    const ui = this.getComponent(UITransform);
    if (!g || !ui) return;
    this.drawn = true;
    this.drawnW = ui.width; this.drawnH = ui.height;
    const w = ui.width, h = ui.height, x = -w * ui.anchorX, y = -h * ui.anchorY;
    const r = Math.max(0, Math.min(this._radius, w / 2, h / 2));
    const c = RoundRect.tmp;
    g.clear();
    if (this.drawSkin(x, y, w, h, r)) return;
    // soft shadow: a few stacked, growing, fading copies under the box
    if (this._shadowBlur > 0 && this._shadowColor.a > 0) {
      const steps = 4;
      for (let i = steps; i >= 1; i--) {
        const grow = this._shadowBlur * i / steps / 2;
        c.set(this._shadowColor.r, this._shadowColor.g, this._shadowColor.b, Math.round(this._shadowColor.a / steps));
        g.fillColor = c;
        g.roundRect(x - grow, y - this._shadowY - grow, w + grow * 2, h + grow * 2, r + grow);
        g.fill();
      }
    }
    if (this._glow > 0) {
      const e = this._glow;
      g.fillColor = this._glowColor;
      g.roundRect(x - e, y - e - this._lip, w + e * 2, h + e * 2 + this._lip, r + e);
      g.fill();
    }
    if (this._lip > 0) {
      g.fillColor = this._lipColor;
      g.roundRect(x, y - this._lip, w, h, r);
      g.fill();
    }
    if (this._borderWidth > 0) {
      g.fillColor = this._borderColor;
      g.roundRect(x, y, w, h, r);
      g.fill();
      const b = this._borderWidth;
      g.fillColor = this._fill;
      g.roundRect(x + b, y + b, w - b * 2, h - b * 2, Math.max(0, r - b));
      g.fill();
    } else {
      g.fillColor = this._fill;
      g.roundRect(x, y, w, h, r);
      g.fill();
    }
  }

  // ---------- smooth picture (9-slice skin) ----------
  private skin: Node | null = null;
  private static frames = new Map<string, SpriteFrame>();

  /** Show the panel as a sliced picture; false = draw with Graphics (editor, square boxes, nothing to draw) */
  private drawSkin(x: number, y: number, w: number, h: number, r: number): boolean {
    const nothing = this._fill.a === 0 && !this._borderWidth && !this._lip && !this._glow && !(this._shadowBlur > 0 && this._shadowColor.a > 0);
    if (EDITOR || r < .5 || w <= 0 || h <= 0 || nothing) { if (this.skin) this.skin.active = false; return nothing && !EDITOR; }
    const d = RoundRect.density();
    const m = this.margin();
    const frame = this.frameFor(r, m, d);
    let n = this.skin;
    if (!n || !n.isValid) {
      n = this.skin = new Node('__skin');
      n.layer = this.node.layer || Layers.Enum.UI_2D;
      this.node.insertChild(n, 0);
      n.addComponent(UITransform);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.type = Sprite.Type.SLICED; sp.trim = false;
    }
    n.active = true;
    const sp = n.getComponent(Sprite)!;
    if (sp.spriteFrame !== frame) sp.spriteFrame = frame;
    n.getComponent(UITransform)!.setContentSize((w + m * 2) * d, (h + m * 2) * d);
    n.setScale(1 / d, 1 / d, 1);
    n.setPosition(x + w / 2, y + h / 2, 0);
    if (n.getSiblingIndex() !== 0) n.setSiblingIndex(0);
    return true;
  }

  /** Room around the box for the shadow, lip and ring, in design units */
  private margin() {
    const blur = this._shadowColor.a > 0 ? this._shadowBlur : 0;
    return Math.ceil(Math.max(blur / 2 + Math.max(0, this._shadowY), this._glow + this._lip, this._lip)) + 1;
  }

  /** Texture pixels per design unit: the screen's density (crisp on every phone), 1..4 */
  private static density() {
    const k = view.getScaleX() * (sys.isNative ? 1 : (globalThis as any).devicePixelRatio || 1);
    return Math.min(4, Math.max(1, Math.ceil(k * 4) / 4));
  }

  private frameFor(r: number, m: number, d: number): SpriteFrame {
    const col = (c: Color) => `${c.r},${c.g},${c.b},${c.a}`;
    const key = [d, r.toFixed(2), m, col(this._fill), this._borderWidth, col(this._borderColor), this._lip, col(this._lipColor),
      this._shadowY, this._shadowBlur, col(this._shadowColor), this._glow, col(this._glowColor)].join('|');
    let f = RoundRect.frames.get(key);
    if (f) return f;
    // a box just big enough for its corners plus 2 units that stretch, with the margin around
    const side = r * 2 + 2, total = side + m * 2;
    const W = Math.ceil(total * d), H = W;
    const data = this.paint(W, H, d, m, side, r);
    const img = new ImageAsset({ _data: data, _compressed: false, width: W, height: H, format: Texture2D.PixelFormat.RGBA8888 });
    const tex = new Texture2D();
    tex.image = img;
    tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    f = new SpriteFrame();
    f.packable = false;                      // a memory picture: the dynamic atlas cannot copy it
    f.texture = tex;
    const inset = Math.floor((m + r) * d);
    f.insetLeft = inset; f.insetRight = inset; f.insetTop = inset; f.insetBottom = inset;
    RoundRect.frames.set(key, f);
    return f;
  }

  /**
   * Paint the layers (shadow, ring, lip, border, fill) of a side×side box at (m, m), like the
   * Graphics version, with smooth edges: each pixel is covered by the share of it inside a shape.
   * Rows top first; straight (not premultiplied) alpha.
   */
  private paint(W: number, H: number, d: number, m: number, side: number, r: number): Uint8Array {
    const out = new Uint8Array(W * H * 4);
    const half = side / 2, cx = m + half, cy = m + half;     // box centre, y down
    // signed distance (units) from p to a rounded box centred (bx, by), half sizes hw, hh, radius rr
    const sd = (px: number, py: number, bx: number, by: number, hw: number, hh: number, rr: number) => {
      const qx = Math.abs(px - bx) - (hw - rr), qy = Math.abs(py - by) - (hh - rr);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    };
    const cover = (dist: number) => Math.max(0, Math.min(1, .5 - dist * d));
    type Layer = { c: Color; a: (px: number, py: number) => number };
    const layers: Layer[] = [];
    const blur = this._shadowBlur, sc = this._shadowColor;
    if (blur > 0 && sc.a > 0) layers.push({ c: sc, a: (px, py) => {
      // full under the box, fading to nothing blur/2 outside it (smooth, like the stacked copies)
      const t = sd(px, py, cx, cy + this._shadowY, half, half, r) / (blur / 2);
      const k = Math.max(0, Math.min(1, 1 - t));
      return k * k * (3 - 2 * k) * (sc.a / 255) * (t <= 0 ? 1 : .75);
    } });
    if (this._glow > 0) { const e = this._glow, l = this._lip; layers.push({ c: this._glowColor, a: (px, py) => cover(sd(px, py, cx, cy + l / 2, half + e, half + e + l / 2, r + e)) * this._glowColor.a / 255 }); }
    if (this._lip > 0) layers.push({ c: this._lipColor, a: (px, py) => cover(sd(px, py, cx, cy + this._lip, half, half, r)) * this._lipColor.a / 255 });
    if (this._borderWidth > 0) {
      const b = this._borderWidth;
      layers.push({ c: this._borderColor, a: (px, py) => cover(sd(px, py, cx, cy, half, half, r)) * this._borderColor.a / 255 });
      layers.push({ c: this._fill, a: (px, py) => cover(sd(px, py, cx, cy, half - b, half - b, Math.max(0, r - b))) * this._fill.a / 255 });
    } else layers.push({ c: this._fill, a: (px, py) => cover(sd(px, py, cx, cy, half, half, r)) * this._fill.a / 255 });
    const fill = this._fill;
    for (let j = 0; j < H; j++) {
      const py = (j + .5) / d;
      for (let i = 0; i < W; i++) {
        const px = (i + .5) / d;
        // "over" compositing, premultiplied while mixing
        let R = 0, G = 0, B = 0, A = 0, lr = fill.r, lg = fill.g, lb = fill.b;
        for (const L of layers) {
          const a = L.a(px, py);
          if (a <= 0) continue;
          R = L.c.r * a + R * (1 - a); G = L.c.g * a + G * (1 - a); B = L.c.b * a + B * (1 - a); A = a + A * (1 - a);
          lr = L.c.r; lg = L.c.g; lb = L.c.b;
        }
        const o = (j * W + i) * 4;
        // see-through pixels keep a nearby colour: no dark fringe when the texture is filtered
        if (A > 0) { out[o] = Math.round(R / A); out[o + 1] = Math.round(G / A); out[o + 2] = Math.round(B / A); }
        else { out[o] = lr; out[o + 1] = lg; out[o + 2] = lb; }
        out[o + 3] = Math.round(A * 255);
      }
    }
    return out;
  }
}
