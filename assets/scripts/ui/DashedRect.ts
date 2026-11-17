// A dashed rounded-rectangle outline (the "stitched" inset border of the Figma notices), drawn
// with Graphics along the box of the node's UITransform. Graphics has no line dash: the path is
// walked and short strokes are laid down. Redrawn only when the size or a property changes.
import { _decorator, Component, Graphics, Color, UITransform, Node } from 'cc';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

@ccclass('DashedRect')
@executeInEditMode
@requireComponent(Graphics)
export class DashedRect extends Component {
  @property private _color = new Color(207, 172, 112, 178);
  @property private _lineWidth = 1;
  @property private _radius = 12;
  @property private _dash = 4;
  @property private _gap = 4;

  @property get color() { return this._color; }
  set color(v: Color) { this._color.set(v); this.redraw(); }
  @property get lineWidth() { return this._lineWidth; }
  set lineWidth(v: number) { this._lineWidth = v; this.redraw(); }
  @property({ tooltip: 'Corner radius; clamped to half the height' }) get radius() { return this._radius; }
  set radius(v: number) { this._radius = v; this.redraw(); }
  @property({ tooltip: 'Length of each dash' }) get dash() { return this._dash; }
  set dash(v: number) { this._dash = v; this.redraw(); }
  @property({ tooltip: 'Space between dashes' }) get gap() { return this._gap; }
  set gap(v: number) { this._gap = v; this.redraw(); }

  onEnable() { this.node.on(Node.EventType.SIZE_CHANGED, this.redraw, this); this.redraw(); }
  onDisable() { this.node.off(Node.EventType.SIZE_CHANGED, this.redraw, this); }

  redraw() {
    const g = this.getComponent(Graphics), ui = this.getComponent(UITransform);
    if (!g || !ui) return;
    const w = ui.width, h = ui.height, x0 = -w * ui.anchorX, y0 = -h * ui.anchorY;
    const r = Math.max(0, Math.min(this._radius, w / 2, h / 2));
    g.clear();
    if (w <= 0 || h <= 0 || this._dash <= 0) return;
    g.lineWidth = this._lineWidth; g.strokeColor = this._color;
    // the outline as a polyline: straight sides, each corner an arc of a few segments
    const pts: number[] = [];
    const corner = (cx: number, cy: number, from: number) => {
      const n = 6;
      for (let i = 0; i <= n; i++) { const a = from + (Math.PI / 2) * i / n; pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    };
    corner(x0 + w - r, y0 + h - r, 0);              // top-right
    corner(x0 + r, y0 + h - r, Math.PI / 2);        // top-left
    corner(x0 + r, y0 + r, Math.PI);                // bottom-left
    corner(x0 + w - r, y0 + r, Math.PI * 1.5);      // bottom-right
    pts.push(pts[0], pts[1]);
    let drawing = true, left = this._dash;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      let x = pts[i], y = pts[i + 1];
      const bx = pts[i + 2], by = pts[i + 3];
      let len = Math.hypot(bx - x, by - y);
      const ux = (bx - x) / (len || 1), uy = (by - y) / (len || 1);
      while (len > 0) {
        const step = Math.min(left, len);
        if (drawing) { g.moveTo(x, y); g.lineTo(x + ux * step, y + uy * step); }
        x += ux * step; y += uy * step; len -= step; left -= step;
        if (left <= 0) { drawing = !drawing; left = drawing ? this._dash : this._gap; }
      }
    }
    g.stroke();
  }
}
