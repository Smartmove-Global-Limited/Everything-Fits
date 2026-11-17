// The notice shown when a Hard / Super Hard level starts (Figma "EF · Overlay / Hard Level" and
// "EF · Overlay / Super Hard Level"): the screen dims and a luggage-tag card pops in — warm paper
// with a stitched inset border, the flame tag art on the left, "PACKING CHALLENGE" / the title /
// a line under it, a ribbon accent on the right. It stays a moment, then drifts up and fades.
// Prefab resources/ui/DifficultyNotice (tools/editor/difficulty-notice.js); shown by Overlays.
import { _decorator, Component, Node, Label, Sprite, SpriteFrame, Color, UIOpacity, Tween, tween, Vec3 } from 'cc';
import { RoundRect } from './RoundRect';
import { DashedRect } from './DashedRect';
import type { PlayDifficulty } from '../core/PlayDifficulty';
const { ccclass, property } = _decorator;

const C = (r: number, g: number, b: number, a = 255) => new Color(r, g, b, a);
/** Colours and words of each notice, from the Figma frames */
const STYLE = {
  Hard: {
    face: C(0xFF, 0xF3, 0xD8), border: C(0xC9, 0x94, 0x4D), edge: C(0xD6, 0xB5, 0x75), stitch: C(207, 172, 112, 178),
    backing: C(0xF0, 0xD5, 0x9A), ribbon: C(214, 156, 72, 89),
    kicker: C(0x9A, 0x78, 0x45), title: C(0x79, 0x50, 0x2B), subtitle: C(0x98, 0x76, 0x48), titleSize: 27,
    words: ['Hard Level', 'A little extra challenge!'],
  },
  'Super Hard': {
    face: C(0xFF, 0xF0, 0xE7), border: C(0xAB, 0x64, 0x5B), edge: C(0xD6, 0xA1, 0x8B), stitch: C(200, 141, 127, 178),
    backing: C(0xE8, 0xC7, 0xBC), ribbon: C(188, 96, 92, 89),
    kicker: C(0x9E, 0x6C, 0x60), title: C(0x81, 0x3D, 0x42), subtitle: C(0x9B, 0x6C, 0x60), titleSize: 25,
    words: ['Super Hard Level', 'Make every space count!'],
  },
};
const IN = .2, HOLD = 1.9, OUT = .35, RISE = 24;

@ccclass('DifficultyNotice')
export class DifficultyNotice extends Component {
  @property(Node) dim: Node = null!;
  @property(Node) card: Node = null!;
  @property(RoundRect) face: RoundRect = null!;
  @property(RoundRect) edge: RoundRect = null!;
  @property(DashedRect) stitch: DashedRect = null!;
  @property(RoundRect) backing: RoundRect = null!;
  @property(RoundRect) ribbon: RoundRect = null!;
  @property(Sprite) art: Sprite = null!;
  @property(Label) kicker: Label = null!;
  @property(Label) title: Label = null!;
  @property(Label) subtitle: Label = null!;
  @property(SpriteFrame) hardTag: SpriteFrame = null!;
  @property(SpriteFrame) superHardTag: SpriteFrame = null!;

  private cardY = 0;

  onLoad() { this.cardY = this.card.position.y; }

  /** Dress the card for `kind` and play it: pop in over the dimmed screen, hold, drift up and fade */
  show(kind: Exclude<PlayDifficulty, 'Easy'>) {
    const s = STYLE[kind];
    this.face.setColors(s.face, s.border);
    this.edge.fill = s.edge;
    this.stitch.color = s.stitch;
    this.backing.fill = s.backing;
    this.ribbon.fill = s.ribbon;
    this.art.spriteFrame = kind === 'Hard' ? this.hardTag : this.superHardTag;
    this.kicker.color = s.kicker;
    this.title.color = s.title; this.title.fontSize = s.titleSize; this.title.string = s.words[0];
    this.subtitle.color = s.subtitle; this.subtitle.string = s.words[1];

    const op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity);
    Tween.stopAllByTarget(op); Tween.stopAllByTarget(this.card);
    this.node.active = true;
    op.opacity = 0;
    this.card.setPosition(this.card.position.x, this.cardY, 0);
    this.card.setScale(.6, .6, 1);
    tween(op).to(IN, { opacity: 255 }).delay(HOLD).to(OUT, { opacity: 0 }).call(() => { this.node.active = false; }).start();
    tween(this.card).to(.38, { scale: Vec3.ONE }, { easing: 'backOut' }).delay(HOLD - .18)
      .to(OUT, { position: new Vec3(this.card.position.x, this.cardY + RISE, 0) }, { easing: 'sineIn' }).start();
  }
}
