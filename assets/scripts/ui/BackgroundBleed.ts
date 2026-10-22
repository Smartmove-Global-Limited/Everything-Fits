// Fills the bands above and below a 420×760 background on tall screens the way the web game does
// (art/scenes.js bleedEdges): the top row and the bottom row of the picture are stretched over
// the extra height. The walls and table of these backgrounds are plain at the edges, so the bands
// join the picture seamlessly, nothing is cropped and nothing is distorted. Rebuilt only on resize.
import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, Rect, view } from 'cc';
import { ScreenFit, DESIGN_H } from './ScreenFit';
const { ccclass, requireComponent } = _decorator;

@ccclass('BackgroundBleed')
@requireComponent(Sprite)
export class BackgroundBleed extends Component {
  private top: Sprite | null = null;
  private bottom: Sprite | null = null;
  private source: SpriteFrame | null = null;

  onEnable() { view.on('canvas-resize', this.apply, this); this.apply(); }
  onDisable() { view.off('canvas-resize', this.apply, this); }

  private band(name: string, frame: SpriteFrame, row: number): Sprite {
    const n = new Node(name); n.layer = this.node.layer; this.node.addChild(n);
    n.addComponent(UITransform);
    const s = n.addComponent(Sprite);
    const f = new SpriteFrame();
    f.texture = frame.texture;
    const r = frame.rect;
    f.rect = new Rect(r.x, r.y + row, r.width, 1);   // one pixel row of the picture
    s.sizeMode = Sprite.SizeMode.CUSTOM; s.spriteFrame = f;
    return s;
  }

  apply() {
    const sprite = this.getComponent(Sprite)!, frame = sprite.spriteFrame;
    if (!frame) return;
    if (frame !== this.source) {
      this.top?.node.destroy(); this.bottom?.node.destroy();
      this.top = this.band('BleedTop', frame, 0);
      this.bottom = this.band('BleedBottom', frame, frame.rect.height - 1);
      this.source = frame;
    }
    const ui = this.getComponent(UITransform)!, extra = Math.max(0, ScreenFit.visible().height - DESIGN_H) / 2 + 2;
    for (const [s, sign] of [[this.top!, 1], [this.bottom!, -1]] as [Sprite, number][]) {
      s.node.active = extra > 2;
      s.node.getComponent(UITransform)!.setContentSize(ui.width, extra);
      s.node.setPosition(0, sign * (ui.height / 2 + extra / 2 - 1), 0);
    }
  }
}
