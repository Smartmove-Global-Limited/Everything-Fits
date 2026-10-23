// Places a node of a 420×760 layout on the real screen (see ScreenFit):
//   top      keeps its distance from the top edge of the design, measured from the screen top,
//            below the safe area (status bar / notch)
//   bottom   same from the bottom edge, above the gesture bar
//   stretch  covers the whole screen (dim overlays, screen roots)
//   cover    covers the whole screen keeping its aspect (background pictures, cropped)
//   grow     stays pinned to the top and grows downward by the extra height (scrolling lists)
// Recomputed only when the screen size changes, never per frame.
import { _decorator, Component, Enum, UITransform, view, Vec3, Size, Node } from 'cc';
import { ScreenFit, DESIGN_H } from './ScreenFit';
const { ccclass, property } = _decorator;

export enum PinMode { TOP = 0, BOTTOM = 1, STRETCH = 2, COVER = 3, GROW = 4 }

@ccclass('EdgePin')
export class EdgePin extends Component {
  @property({ type: Enum(PinMode) }) mode = PinMode.TOP;
  @property({ tooltip: 'Keep clear of the notch / status bar / gesture bar' }) safeArea = true;
  @property({ tooltip: 'Bottom bars: the background reaches the screen edge behind the navigation bar (Android edge-to-edge); full-height children (tabs) extend too, their content stays clear' }) extendToEdge = false;

  private base = new Vec3();
  /** full-height children and their own children's original y (extendToEdge) */
  private extended: { node: Node; h: number; y: number; kids: [Node, number][] }[] | null = null;
  private baseSize = new Size();
  private insets = { top: 0, bottom: 0 };
  private offInsets: (() => void) | null = null;

  onLoad() {
    this.base.set(this.node.position);
    const ui = this.getComponent(UITransform);
    if (ui) this.baseSize.set(ui.contentSize);
  }
  onEnable() {
    view.on('canvas-resize', this.apply, this); view.on('design-resolution-changed', this.apply, this);
    this.offInsets = ScreenFit.onInsetsChange(() => this.apply());   // bottom ad banner shown / hidden
    this.apply();
  }
  onDisable() { view.off('canvas-resize', this.apply, this); view.off('design-resolution-changed', this.apply, this); this.offInsets?.(); this.offInsets = null; }

  /** Grow the bar (and its full-height tabs) downward by `d`, keeping every label / icon in place */
  private extend(d: number) {
    const ui = this.getComponent(UITransform); if (!ui) return;
    if (!this.extended) {
      const h = this.baseSize.height;
      this.extended = [this.node, ...this.node.children.filter(c => Math.abs((c.getComponent(UITransform)?.height ?? 0) - h) < 3)]
        .map(n => ({ node: n, h: n.getComponent(UITransform)!.height, y: n === this.node ? 0 : n.position.y, kids: n.children.map(k => [k, k.position.y] as [Node, number]) }));
    }
    for (const e of this.extended) {
      e.node.getComponent(UITransform)!.height = e.h + d;
      // the bar's centre drops by d/2 (below); full-height tabs follow it, so only the labels and
      // icons inside move up by d/2 to stay where they were
      for (const [k, y] of e.kids) if (!this.extended.some(x => x.node === k)) k.setPosition(k.position.x, y + d / 2, 0);
    }
    this.node.setPosition(this.node.position.x, this.node.position.y - d / 2, 0);
  }

  apply() {
    const vis = ScreenFit.visible();
    const extraY = Math.max(0, vis.height - DESIGN_H) / 2;
    const ins = this.safeArea ? ScreenFit.insets(this.insets) : this.insets;
    if (!this.safeArea) { ins.top = 0; ins.bottom = 0; }
    const ui = this.getComponent(UITransform);
    const b = this.base;
    switch (this.mode) {
      case PinMode.TOP: this.node.setPosition(b.x, b.y + extraY - ins.top, b.z); break;
      case PinMode.BOTTOM:
        this.node.setPosition(b.x, b.y - extraY + ins.bottom, b.z);
        // a bottom ad banner covers the system bar area itself: the bar then stops on top of it
        if (this.extendToEdge) this.extend(ScreenFit.adBottom > 0 ? 0 : ins.bottom);
        break;
      case PinMode.STRETCH:
        if (ui) ui.setContentSize(Math.max(this.baseSize.width, vis.width), Math.max(this.baseSize.height, vis.height));
        break;
      case PinMode.COVER: {
        if (!ui) break;
        const k = Math.max(vis.width / this.baseSize.width, vis.height / this.baseSize.height, 1);
        ui.setContentSize(this.baseSize.width * k, this.baseSize.height * k);
        break;
      }
      case PinMode.GROW: {
        if (!ui) break;
        const grow = extraY * 2 - ins.top - ins.bottom;
        ui.height = this.baseSize.height + Math.max(0, grow);
        // top edge follows the top bar; the box extends downward
        this.node.setPosition(b.x, b.y + extraY - ins.top - Math.max(0, grow) / 2, b.z);
        break;
      }
    }
  }
}
