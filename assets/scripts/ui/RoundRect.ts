// A rounded panel drawn with Graphics, the Cocos counterpart of the web CSS boxes
// (border-radius, background, border, "lip" box-shadow 0 Npx 0 <color>, soft drop shadow).
// Redrawn only when the node size or a property changes, never per frame.
import { _decorator, Component, Graphics, Color, UITransform, Node } from 'cc';
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
}
