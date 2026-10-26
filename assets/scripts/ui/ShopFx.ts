// Shop effects (shop VFX doc). No sound for anything that runs by itself.
//   Gold packs   500–3,500: a soft light band sweeps across the coins now and then.
//                8,000–18,000: the same, plus 1–2 small twinkles around the pouch / chest mouth.
//                40,000: a warm golden glow inside the chest and 2–3 twinkles one after another.
//                Every pack has its own rhythm: they never flash together.
//   Bundles      the same light band and white twinkles over the artwork (like the store reference:
//                sparkles popping on the coins), a soft glow behind it only (never over name,
//                amounts or price); when the Shop opens each artwork lifts a little and settles back.
//   Bought       (only once the store confirmed) a soft ring spreads from the card, then coins fly
//                to the gold counter and boosters to the Home tab, where they are kept.
import { _decorator, Component, Node, Graphics, Color, UITransform, Sprite, Vec3, Vec4, tween, Tween, Layers, UIOpacity, Material, EffectAsset, MaterialInstance, resources } from 'cc';
import { Celebration } from './Celebration';
const { ccclass } = _decorator;

const SHINE_EVERY = 4.6, SHINE_TIME = .6;   // s
const TWINKLE_TIME = .75;
const CREAM = new Color(0xFF, 0xF6, 0xD8, 255), BUTTER = new Color(0xF6, 0xD7, 0x76, 255);

type Pack = {
  art: Node; shine: MaterialInstance | null; tier: 0 | 1 | 2; offset: number;
  fx: Graphics;                              // twinkles and glow, above the art
  spots: [number, number][];                 // twinkle places, shares of the art's width / height
};
type Bundle = { art: Node; glow: Graphics; baseY: number; offset: number };

@ccclass('ShopFx')
export class ShopFx extends Component {
  private packs: Pack[] = [];
  private bundles: Bundle[] = [];
  private t = 0;
  private overlay: Celebration = null!;
  private tmp = new Color();
  private band = new Vec4();
  private static effectLoad: Promise<EffectAsset | null> | null = null;
  /** The shine shader (resources/effects/shine-sprite), loaded once */
  private static effect() {
    return ShopFx.effectLoad ||= new Promise(ok => resources.load('effects/shine-sprite', EffectAsset, (e, a) => ok(e ? null : a)));
  }

  /** Gold pack art nodes (500 → 40,000), bundle artwork nodes, and the node effects fly above */
  setup(goldArts: Node[], bundleArts: Node[], overlayParent: Node, extraArts: Node[] = []) {
    // other pictures with the same light band and twinkles (the No Ads badge on top)
    extraArts.forEach((art, i) => this.packs.push(this.makePack(art, 1, .9 + i * 1.7)));
    goldArts.forEach((art, i) => this.packs.push(this.makePack(art, i < 3 ? 0 : i < 5 ? 1 : 2, [0, 2.1, 4.0, 1.2, 3.3, .5][i] ?? i)));
    // bundles (No Ads, Booster, Small, Medium, Ultra): glow behind, light band and twinkles on top
    bundleArts.forEach((art, i) => {
      this.bundles.push(this.makeBundle(art, i));
      this.packs.push(this.makePack(art, i === bundleArts.length - 1 ? 2 : 1, 1.7 + i * 1.3));
    });
    const o = new Node('shopFx'); o.layer = Layers.Enum.UI_2D;
    overlayParent.addChild(o);
    o.addComponent(UITransform).setContentSize(10, 10);
    this.overlay = o.addComponent(Celebration);
  }

  /** tier 0: light band only, 1: + 3 twinkles, 2: + glow inside and 4 twinkles; `fewer` twinkles less */
  private makePack(art: Node, tier: 0 | 1 | 2, offset: number, fewer = 0): Pack {
    // the light band is drawn by the picture's own shader (effects/shine-sprite), so it only
    // lights the picture's pixels; set up once the effect has loaded
    const fxNode = new Node('twinkle'); fxNode.layer = art.layer; art.addChild(fxNode);
    fxNode.addComponent(UITransform);
    const fx = fxNode.addComponent(Graphics);
    // on the coins, mostly the upper part of the picture (the mouth of the pouch / chest); as
    // shares of the picture's size (it is sized after this, when the prefab lays out)
    const spots: [number, number][] = (tier === 1 ? [[-.24, .26], [.3, .1], [.02, -.12]]
      : tier === 2 ? [[-.28, .2], [.08, .38], [.32, .12], [-.06, -.1]] : []).slice(fewer) as [number, number][];
    // uneven rhythm: each one starts at its own moment
    const pack: Pack = { art, shine: null, tier, offset, fx, spots };
    ShopFx.effect().then(effect => {
      const sp = art.getComponent(Sprite);
      if (!effect || !sp || !art.isValid) return;
      const m = new Material();
      m.initialize({ effectAsset: effect, defines: { USE_TEXTURE: true } });
      sp.customMaterial = m;
      pack.shine = sp.getMaterialInstance(0);
    });
    return pack;
  }

  private makeBundle(art: Node, i: number): Bundle {
    const g = new Node('artGlow'); g.layer = art.layer;
    art.parent!.insertChild(g, art.getSiblingIndex());          // behind the artwork only
    g.addComponent(UITransform);
    g.setPosition(art.position);
    return { art, glow: g.addComponent(Graphics), baseY: art.position.y, offset: i * .7 };
  }

  // ---------- a button that asks to be pressed (Free Gold "Collect") ----------
  private attractNode: Node | null = null;
  private attractFx: Graphics | null = null;
  /**
   * On: the button bobs gently (a little swell and back, then a pause) and sparkles twinkle at its
   * corners; off: back to rest.
   */
  attract(btn: Node, on: boolean) {
    Tween.stopAllByTarget(btn);
    btn.setScale(1, 1, 1);
    if (!on) { this.attractNode = null; this.attractFx?.clear(); return; }
    this.attractNode = btn;
    if (!this.attractFx || this.attractFx.node.parent !== btn) {
      const n = new Node('attract'); n.layer = btn.layer; btn.addChild(n);
      n.addComponent(UITransform);
      this.attractFx = n.addComponent(Graphics);
    }
    const up = new Vec3(1.07, 1.07, 1);
    tween(btn).repeatForever(tween(btn)
      .to(.22, { scale: up }, { easing: 'quadOut' }).to(.18, { scale: new Vec3(.97, .97, 1) }, { easing: 'quadIn' })
      .to(.14, { scale: Vec3.ONE }, { easing: 'quadOut' }).delay(1.1)).start();
  }
  private drawAttract() {
    const btn = this.attractNode, g = this.attractFx;
    if (!btn || !g || !btn.activeInHierarchy) return;
    g.clear();
    const u = btn.getComponent(UITransform)!, w = u.width, h = u.height;
    const spots: [number, number, number][] = [[w * .5 - 4, h * .5 - 2, 0], [-w * .5 + 6, -h * .5 + 4, .8], [w * .18, h * .5 + 1, 1.5]];
    for (const [x, y, off] of spots) {
      const k = ((this.t + off) % 2.2) / TWINKLE_TIME;
      if (k >= 1) continue;
      const s = Math.sin(k * Math.PI);
      this.twinkle(g, x, y, 11 * s, s, k * .5);
    }
  }

  /** Shop opened: each artwork lifts a little and settles back, one after another */
  intro() {
    const all = this.bundles.map(b => ({ n: b.art, y: b.baseY })).concat(this.packs.map(p => ({ n: p.art, y: p.art.position.y })));
    all.forEach(({ n, y }, i) => {
      Tween.stopAllByTarget(n);
      n.setPosition(n.position.x, y, 0);
      tween(n).delay(i * .035).to(.11, { position: new Vec3(n.position.x, y + 5, 0) }, { easing: 'quadOut' })
        .to(.14, { position: new Vec3(n.position.x, y, 0) }, { easing: 'quadIn' }).start();
    });
  }

  update(dt: number) {
    this.t += dt;
    for (const p of this.packs) this.drawPack(p);
    for (const b of this.bundles) this.drawBundleGlow(b);
    this.drawAttract();
  }

  private drawPack(p: Pack) {
    const ui = p.art.getComponent(UITransform)!, w = ui.width, h = ui.height;
    const c = this.tmp;
    // ---- light band (shader), crossing the picture from top-left to bottom-right ----
    if (p.shine) {
      const k = ((this.t + p.offset) % SHINE_EVERY) / SHINE_TIME;
      if (k < 1) this.band.set(.15 + k * .7, .07, .85 * Math.sin(k * Math.PI), 0);   // thin, through the middle only
      else this.band.set(-1, .07, 0, 0);
      p.shine.setProperty('shine', this.band);
    }
    // ---- glow and twinkles ----
    const g = p.fx; g.clear();
    if (p.tier === 2) {
      // warm light inside the chest, breathing slowly
      const a = .75 + .25 * Math.sin((this.t + p.offset) * 2.1);
      for (let i = 5; i >= 1; i--) {
        c.set(255, 226, 120, Math.round(22 * a * (1 - i / 6)));
        g.fillColor = c; g.ellipse(0, h * .2, w * .12 * i, h * .06 * i); g.fill();
      }
    }
    p.spots.forEach(([x, y], i) => {
      // twinkles one after another, then a pause
      const period = p.tier === 2 ? 1.7 : 1.9;
      const u = ((this.t + p.offset + i * (p.tier === 2 ? .45 : .75)) % period) / TWINKLE_TIME;
      if (u >= 1) return;
      const s = Math.sin(u * Math.PI);
      this.twinkle(g, x * w, y * h, (p.tier === 2 ? 15 : 13) * s, s, u * .5);
    });
  }

  private drawBundleGlow(b: Bundle) {
    const g = b.glow; g.clear();
    b.glow.node.setPosition(b.art.position.x, b.baseY, 0);
    const ui = b.art.getComponent(UITransform)!, r = Math.max(ui.width, ui.height) * .5;
    const a = .8 + .2 * Math.sin((this.t + b.offset) * 1.8), c = this.tmp;
    for (let i = 6; i >= 1; i--) {
      c.set(255, 240, 190, Math.round(48 * a * (1 - i / 7)));
      g.fillColor = c; g.circle(0, 0, r * (.55 + i * .13)); g.fill();
    }
  }

  /** White four-point sparkle with long thin rays and a soft warm halo (store-style glint) */
  private twinkle(g: Graphics, x: number, y: number, z: number, a: number, rot: number) {
    if (z < .4) return;
    const c = this.tmp;
    c.set(BUTTER.r, BUTTER.g, BUTTER.b, Math.round(80 * a)); g.fillColor = c; g.circle(x, y, z * .45); g.fill();
    c.set(255, 255, 250, Math.round(255 * a)); g.fillColor = c;
    const ray = (len: number, wid: number, ang: number) => {
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const p = (u: number, v: number) => [x + u * cs - v * sn, y + u * sn + v * cs];
      const q = [p(len, 0), p(0, wid), p(-len, 0), p(0, -wid)];
      g.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) g.lineTo(q[i][0], q[i][1]); g.close(); g.fill();
    };
    ray(z, z * .16, rot); ray(z, z * .16, rot + Math.PI / 2);               // the long cross
    ray(z * .42, z * .1, rot + Math.PI / 4); ray(z * .42, z * .1, rot - Math.PI / 4);
    c.set(CREAM.r, CREAM.g, CREAM.b, Math.round(255 * a)); g.fillColor = c; g.circle(x, y, z * .14); g.fill();
  }

  // ---------- purchase ----------
  /**
   * The store confirmed a purchase of `card`: soft ring from the card, then `coins` coins (the
   * picture of `goldTarget`) fly from `coinFrom` to `goldTarget` and the booster pictures to
   * `boosterTarget`. Resolves when all landed
   * (onCoin is called as each coin lands).
   */
  async purchased(card: Node, opts: { coinFrom?: Node | null; coins: number; goldTarget: Node; boosterIcons: Node[]; boosterTarget: Node; onCoin?: () => void }) {
    const o = this.overlay.node, ou = o.parent!.getComponent(UITransform)!;
    const local = (n: Node) => ou.convertToNodeSpaceAR(n.worldPosition);
    const at = local(card), cu = card.getComponent(UITransform)!;
    this.overlay.ring(at.x, at.y, { r0: 20, r1: Math.max(cu.width, cu.height) * .7, life: .55, color: '#FFE7A6', width: 14 });
    this.overlay.burst(at.x, at.y, { n: 14, speed: 120, life: .6 });
    await this.wait(.25);
    const flights: Promise<void>[] = [];
    const from = opts.coinFrom ? local(opts.coinFrom) : at;
    // coins: the counter's own coin picture, from the pack's artwork to the counter
    for (let i = 0; i < opts.coins; i++) flights.push(this.fly(opts.goldTarget, from, local(opts.goldTarget), i * .06, 24, opts.onCoin));
    opts.boosterIcons.forEach((ic, i) => flights.push(this.fly(ic, local(ic), local(opts.boosterTarget), .1 + i * .08, 30)));
    await Promise.all(flights);
  }

  /** One picture (a copy of `src`'s sprite) flying from a to b on a soft arc (Celebration.fly) */
  private fly(src: Node, a: Vec3, b: Vec3, delay: number, size: number, onLand?: () => void): Promise<void> {
    return this.overlay.fly(src, a, b, { delay, size, onLand });
  }

  private wait(s: number) { return new Promise<void>(ok => this.scheduleOnce(() => ok(), s)); }
}
