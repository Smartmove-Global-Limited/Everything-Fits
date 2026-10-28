// Screen-wide overlays shared by every scene: the short toast (web efToast), the simulated ads
// (TEST AD screen, TEST BANNER strip) and the views Ads.ts draws real banners around.
// Prefabs load once; one instance per scene sits on top of the Canvas.
import { Node, Prefab, instantiate, director, Director, resources, UIOpacity, Tween, tween, UITransform, Graphics, Color, Layers, Label, Vec3, Sprite, SpriteFrame, NodePool, view } from 'cc';
import { findNode, setText, tap, labelIn, contentOf } from './UiKit';
import { ScreenFit } from './ScreenFit';
import { Startup } from '../services/Startup';
import { Ads, AdViews, BannerSlot } from '../services/Ads';
import { RoundRect } from './RoundRect';

const prefabs = new Map<string, Prefab>();
function loadPrefab(path: string): Promise<Prefab> {
  const hit = prefabs.get(path);
  if (hit) return Promise.resolve(hit);
  return new Promise((ok, fail) => resources.load(path, Prefab, (e, p) => (e ? fail(e) : (prefabs.set(path, p), ok(p)))));
}
/** Instance of a prefab on top of the current scene's Canvas, reused while the scene lives */
async function onTop(path: string, name: string): Promise<Node> {
  const canvas = director.getScene()!.getChildByName('Canvas')!;
  let n = canvas.getChildByName(name);
  if (!n) { n = instantiate(await loadPrefab(path)); n.name = name; canvas.addChild(n); }
  n.setSiblingIndex(canvas.children.length - 1);
  return n;
}

const AD_SECONDS = 2.5;

// ---------- scene veil (web src/ui/veil.js): cover, work, uncover ----------
// A short splash: items cover the screen on a grid, popping in from the middle outwards on the
// paper-coloured veil; once the new screen is ready they drop out through the bottom in a random
// order, and only when all are out the veil fades and shows it (about 1.6 s in all). Light on the
// phone: 24 small pictures in one atlas (resources/transition), loaded once; the item nodes come
// from a pool and go back to it when the loading is over (nothing rebuilt or reloaded next time).
const VEIL_IN = .3, VEIL_OUT = .3;
const VEIL_COLOR = new Color(0xD9, 0xCF, 0xBE, 255);
const CELL = 74;                                  // grid cell (the splash uses 72)
let transFrames: SpriteFrame[] = [];
const piecePool = new NodePool();
let transitionReady = false;
function loadTransition() {
  if (transitionReady) return;
  transitionReady = true;
  resources.loadDir('transition', SpriteFrame, (_e, list) => { if (list?.length) transFrames = list.filter(Boolean); });
  // a scene change destroys the old veil: its items go back to the pool first
  director.on(Director.EVENT_BEFORE_SCENE_LAUNCH, () => {
    const box = director.getScene()?.getChildByName('Canvas')?.getChildByName('__veil')?.getChildByName('pieces');
    if (box) releasePieces(box);
  });
}
/** set by cover() before a scene change: the next scene starts covered and uncovers itself */
let veilPending = false;
/**
 * Resolves once no loading veil covers the screen (from cover() until its uncover() has finished,
 * across the scene change): native views (the ad banner) must wait for it, they draw above the game
 */
let veilClear: Promise<void> = Promise.resolve();
let veilCleared: (() => void) | null = null;
function veilBusy() { if (!veilCleared) veilClear = new Promise(ok => (veilCleared = ok)); }
function veilFree() { const f = veilCleared; veilCleared = null; f?.(); }
function veilNode(): Node {
  const canvas = director.getScene()!.getChildByName('Canvas')!;
  let n = canvas.getChildByName('__veil');
  if (!n) {
    n = new Node('__veil'); n.layer = Layers.Enum.UI_2D; canvas.addChild(n);
    n.addComponent(UITransform).setContentSize(420, 760);
    n.addComponent(UIOpacity);
    // the paper (and the taps it swallows) fades on its own: the items stay solid while they fall
    const paper = new Node('paper'); paper.layer = n.layer; n.addChild(paper);
    paper.addComponent(UITransform).setContentSize(840, 1520);
    const g = paper.addComponent(Graphics); g.fillColor = VEIL_COLOR; g.rect(-420, -760, 840, 1520); g.fill();
    paper.addComponent(UIOpacity);
    paper.on(Node.EventType.TOUCH_START, () => {}, paper);   // swallow taps while covered
  }
  const paper = n.getChildByName('paper')!;
  paper.active = true; Tween.stopAllByTarget(paper.getComponent(UIOpacity)!); paper.getComponent(UIOpacity)!.opacity = 255;
  n.setSiblingIndex(canvas.children.length - 1);
  return n;
}
function releasePieces(box: Node) {
  for (const p of box.children.slice()) { Tween.stopAllByTarget(p); piecePool.put(p); }
}
/** The current cover's layout: the next scene, which starts covered, shows exactly the same */
type PieceSpot = { frame: number; x: number; y: number; k: number; angle: number };
let coverLayout: PieceSpot[] = [];
/**
 * Which item goes in each cell: dealt from shuffled decks of all the items (each one used about as
 * often as the others, not the same one many times) and never the same as the cell on its left or
 * above it (picking at random per cell put copies of one item side by side).
 */
function dealFrames(rows: number, cols: number, kinds: number): number[] {
  const out: number[] = [];
  let deck: number[] = [];
  const shuffled = () => { const d = Array.from({ length: kinds }, (_, i) => i); for (let i = d.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = d[i]; d[i] = d[j]; d[j] = t; } return d; };
  for (let i = 0; i < rows * cols; i++) {
    if (!deck.length) deck = shuffled();
    const left = i % cols ? out[i - 1] : -1, up = i >= cols ? out[i - cols] : -1;
    let k = deck.findIndex(f => f !== left && f !== up);
    if (k < 0) { deck = deck.concat(shuffled()); k = deck.findIndex(f => f !== left && f !== up); }
    out.push(deck.splice(Math.max(0, k), 1)[0]);
  }
  return out;
}

/**
 * Fill the screen with items on a jittered grid (nodes from the pool); a new random layout, or
 * the one the cover started with (`same`: the scene changed under the veil). Nearest-first.
 */
function layoutPieces(veil: Node, same = false): { node: Node; dist: number }[] {
  let box = veil.getChildByName('pieces');
  if (!box) { box = new Node('pieces'); box.layer = veil.layer; veil.addChild(box); box.addComponent(UITransform); }
  releasePieces(box);
  if (!transFrames.length) return [];
  if (!same || !coverLayout.length) {
    const vis = ScreenFit.visible(), cols = Math.ceil(vis.width / CELL), rows = Math.ceil(vis.height / CELL);
    coverLayout = [];
    const frames = dealFrames(rows, cols, transFrames.length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) coverLayout.push({
      frame: frames[r * cols + c], k: .82 + Math.random() * .22, angle: (Math.random() - .5) * 50,
      x: (c + .5) * CELL - vis.width / 2 + (Math.random() - .5) * 18, y: vis.height / 2 - (r + .5) * CELL + (Math.random() - .5) * 18,
    });
  }
  const out: { node: Node; dist: number }[] = [];
  for (const spot of coverLayout) {
    const p = piecePool.get() || (() => {
      const n = new Node('piece'); n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform); const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      return n;
    })();
    const f = transFrames[spot.frame % transFrames.length];
    p.getComponent(Sprite)!.spriteFrame = f;
    const rect = f.rect, k = CELL * spot.k / Math.max(rect.width, rect.height);
    p.getComponent(UITransform)!.setContentSize(rect.width * k, rect.height * k);
    p.setPosition(spot.x, spot.y, 0); p.angle = spot.angle;
    box.addChild(p);
    out.push({ node: p, dist: Math.hypot(spot.x, spot.y) });
  }
  return out.sort((a, b) => a.dist - b.dist);
}
/** Items pop in from the middle outwards (cover), or are simply there (a new scene starts covered) */
function showPieces(veil: Node, pop: boolean) {
  const list = layoutPieces(veil, !pop);
  const far = list.length ? list[list.length - 1].dist : 1;
  for (const { node, dist } of list) {
    if (!pop) { node.setScale(1, 1, 1); continue; }
    node.setScale(0, 0, 1);
    tween(node).delay(dist / far * .3).to(.14, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'quadOut' }).to(.08, { scale: Vec3.ONE }).start();
  }
}
/**
 * Items drop out through the bottom like the splash: one after another in a random order, falling
 * with the splash's gravity (a free fall, so the lower ones are out first), turning a little;
 * back to the pool afterwards. Returns when the last one is out (s).
 */
const FALL_G = 2400;                               // units / s² (the splash: .0024 units / ms²)
function dropPieces(veil: Node): number {
  const box = veil.getChildByName('pieces');
  if (!box || !box.children.length) return 0;
  const h = ScreenFit.visible().height;
  let last = 0;
  for (const p of box.children) {
    Tween.stopAllByTarget(p);
    const drop = p.position.y + h / 2 + 90;        // down to below the bottom edge
    const delay = Math.random() * .45, time = Math.sqrt(2 * drop / FALL_G);
    last = Math.max(last, delay + time);
    const to = new Vec3(p.position.x + (Math.random() - .5) * 40, p.position.y - drop, 0);
    tween(p).delay(delay).to(time, { position: to, angle: p.angle + (Math.random() - .5) * 120 }, { easing: 'quadIn' }).start();
  }
  return last;
}
let adPlaying: Promise<boolean> | null = null;
let bannerWanted: BannerSlot | null = null;
/** TestBanner prefab height and its texts' places */
let bannerBase: { h: number; ys: number[] } | null = null;
let followsResize = false;
const SIM_FILL = new Color(46, 58, 72, 255), AD_FILL = new Color(0, 0, 0, 255);

/**
 * The banner slot at the bottom edge, just above the navigation / gesture bar (nothing over the
 * system bar: the game shows there). Bars pinned to the bottom go above it at once; the strip
 * shows "TEST BANNER" (simulated ads) or black "AD" until the real banner, a native view on top
 * of the game, covers it.
 */
async function bannerSlot(slot: BannerSlot | null) {
  bannerWanted = slot;
  // the screen changed size (preview device switched, split screen, rotation): the strip and the
  // bars above it are placed again for the new visible height, like the bars pinned by EdgePin
  if (!followsResize) { followsResize = true; view.on('design-resolution-changed', () => { if (bannerWanted) bannerSlot(bannerWanted); }); }
  if (!slot) {
    const n = director.getScene()?.getChildByName('Canvas')?.getChildByName('__testBanner');
    if (n) n.active = false;
    ScreenFit.setAdBottom(0);
    return;
  }
  // design units: the native banner's real height and the system bar it sits on, else the prefab's
  const visH = ScreenFit.visible().height;
  const safe = ScreenFit.insets().bottom - ScreenFit.adBottom;     // system inset Cocos knows
  const m = slot.metrics, k = m ? visH / m.screenPx : 0;
  const sys = m ? Math.max(safe, m.systemPx * k) : safe;
  const h = m ? m.bannerPx * k : 50;
  ScreenFit.setAdBottom(h + sys - safe);                            // bars move now, before the strip loads
  const n = await onTop('ui/TestBanner', '__testBanner');
  if (bannerWanted !== slot) return;          // changed again while the prefab loaded
  n.active = true;
  // under the splash and the scene veil (the slot is kept behind the splash)
  const covers = n.parent!.children.filter(c => c.name === 'Splash' || c.name === '__veil');
  if (covers.length) n.setSiblingIndex(Math.min(...covers.map(c => c.getSiblingIndex())));
  const ui = n.getComponent(UITransform)!;
  bannerBase ||= { h: ui.height, ys: contentOf(n).map(c => c.position.y) };
  ui.height = h;
  n.setPosition(0, -visH / 2 + sys + h / 2, 0);
  contentOf(n).forEach((c, i) => c.setPosition(c.position.x, bannerBase!.ys[i] * h / bannerBase!.h, 0));
  n.getComponent(RoundRect)!.fill = slot.simulated ? SIM_FILL : AD_FILL;
  setText(findNode(n, 'title'), slot.simulated ? 'TEST BANNER' : 'AD');
  setText(findNode(n, 'placement'), slot.simulated ? slot.placement : '');
}

/** The views Ads.ts uses: simulated screens and the banner slot */
const adViews: AdViews = {
  simulateFullScreen: (kind, placement) => Overlays.watchAd(kind, placement),
  whenClear: () => veilClear,
  bannerSlot: slot => { bannerSlot(slot); },
};

export const Overlays = {
  loadPrefab,

  /** Cover the screen; resolves once fully opaque. Pass `sceneChange` before director.loadScene. */
  cover(sceneChange = false): Promise<void> {
    veilPending = sceneChange;
    veilBusy();
    const n = veilNode(), op = n.getComponent(UIOpacity)!;
    n.active = true; Tween.stopAllByTarget(op);
    showPieces(n, true);
    return new Promise(done => tween(op).to(VEIL_IN, { opacity: 255 }).call(() => done()).start());
  },
  /** Uncover after the new content has drawn (two frames later, like the web) */
  uncover(): Promise<void> {
    const n = veilNode(), op = n.getComponent(UIOpacity)!;
    n.active = true; Tween.stopAllByTarget(op);
    const fall = dropPieces(n);
    // like the splash: all the items fall out on the paper first, then the paper fades and the new
    // screen shows (it can be touched once the paper is gone); the items go back to the pool
    const paper = n.getChildByName('paper')!, pop = paper.getComponent(UIOpacity)!;
    op.opacity = 255;
    return new Promise(done => tween(pop).delay(fall).to(VEIL_OUT, { opacity: 0 }).call(() => {
      paper.active = false;
      const box = n.getChildByName('pieces'); if (box) releasePieces(box);
      n.active = false;
      veilFree();
      done();
    }).start());
  },
  /** A loading veil covers the screen now (from cover() / a covered start until uncover() has finished) */
  get covered() { return veilCleared !== null; },
  /** Called by a scene controller in onLoad: start covered if the previous scene asked for it */
  startCoveredIfPending() {
    if (!veilPending) return false;
    veilPending = false;
    veilBusy();
    const n = veilNode(); n.active = true; n.getComponent(UIOpacity)!.opacity = 255;
    showPieces(n, false);
    return true;
  },

  /** Short message floating in the middle of the screen */
  async toast(text: string, seconds = 1.6) {
    const n = await onTop('ui/EfToast', '__toast');
    const l = labelIn(n)!;
    l.string = text;
    l.updateRenderData(true);
    // pill hugs the text (web padding .5em 1.1em)
    const lu = l.node.getComponent(UITransform)!;
    lu.anchorX = .5;                                   // the text run from the web dump is left-anchored
    n.getComponent(UITransform)!.width = lu.width + l.fontSize * 2.2;
    l.node.setPosition(0, l.node.position.y, 0);
    const op = n.getComponent(UIOpacity) || n.addComponent(UIOpacity);
    Tween.stopAllByTarget(op);
    n.active = true; op.opacity = 0;
    tween(op).to(.15, { opacity: 255 }).delay(seconds).to(.25, { opacity: 0 }).call(() => { n.active = false; }).start();
  },

  /**
   * Figma "Toast / Coming Soon": a dark pill just above the bottom bar `nav` (wherever the banner
   * put it), cream Baloo text in the bar's own font. Tapping again restarts it.
   */
  comingSoon(nav: Node, text = 'More adventures are coming soon!') {
    const canvas = director.getScene()!.getChildByName('Canvas')!;
    let n = canvas.getChildByName('__soon');
    if (!n) {
      n = new Node('__soon'); n.layer = Layers.Enum.UI_2D; canvas.addChild(n);
      n.addComponent(UITransform).setContentSize(373, 56);
      n.addComponent(Graphics);
      const rr = n.addComponent(RoundRect);
      rr.fill = new Color(0x35, 0x41, 0x3F, 255); rr.radius = 16; rr.borderWidth = 0;
      rr.shadowY = 2; rr.shadowBlur = 2; rr.shadowColor = new Color(73, 59, 39, 46);
      const t = new Node('Text'); t.layer = n.layer; n.addChild(t);
      t.addComponent(UITransform).setContentSize(345, 40);
      const l = t.addComponent(Label);
      const font = labelIn(nav)?.font;
      if (font) { l.font = font; l.useSystemFont = false; }
      l.fontSize = 17; l.lineHeight = 20; l.color = new Color(0xFF, 0xF8, 0xE9, 255);
      l.horizontalAlign = Label.HorizontalAlign.CENTER; l.verticalAlign = Label.VerticalAlign.CENTER;
      n.addComponent(UIOpacity);
    }
    n.setSiblingIndex(canvas.children.length - 1);
    labelIn(n)!.string = text;
    // 16 above the bar's top edge, in the Canvas' space
    const nu = nav.getComponent(UITransform)!, cu = canvas.getComponent(UITransform)!;
    const top = cu.convertToNodeSpaceAR(nu.convertToWorldSpaceAR(new Vec3(0, nu.height * (1 - nu.anchorY), 0)));
    n.setPosition(0, top.y + 16 + 28, 0);
    const op = n.getComponent(UIOpacity)!;
    Tween.stopAllByTarget(op);
    n.active = true; op.opacity = 0;
    tween(op).to(.15, { opacity: 255 }).delay(1.8).to(.25, { opacity: 0 }).call(() => { n!.active = false; }).start();
  },

  /** Start the ad and store services once (every scene controller calls it in onLoad) */
  /** Remote Config, ads, store, in that order (services/Startup); resolves when all have answered */
  startServices() {
    loadPrefab('ui/TestBanner').catch(() => {});   // the banner slot shows the moment Home opens
    loadTransition();
    return Startup.run(adViews);
  },

  /**
   * Player chose a rewarded ad: true only when watched to the end. Not loaded → the toast
   * "Ad unavailable. Try again later." and false, nothing is taken.
   */
  async rewarded(placement: Parameters<typeof Ads.rewarded>[0]): Promise<boolean> {
    if (!Ads.rewardedAvailable()) { this.toast('Ad unavailable. Try again later.'); return false; }
    return Ads.rewarded(placement);
  },

  /**
   * Simulated full-screen ad (no ad SDK key yet): a "TEST AD" cover counting down. Resolves true
   * when watched to the end, false when closed early.
   */
  watchAd(kind: 'rewarded' | 'interstitial' = 'rewarded', placement = ''): Promise<boolean> {
    if (adPlaying) return adPlaying;
    adPlaying = (async () => {
      const n = await onTop('ui/AdOverlay', '__ad');
      n.active = true;
      setText(findNode(n, 'p'), `${kind === 'rewarded' ? 'Rewarded' : 'Interstitial'} ad playing… (${placement})`);
      const count = findNode(n, 'b'), close = findNode(n, 'button');
      return new Promise<boolean>(done => {
        const end = Date.now() + AD_SECONDS * 1000;
        let finished = false;
        const finish = (full: boolean) => {
          if (finished) return;
          finished = true; clearInterval(timer);
          close?.targetOff(n);
          n.active = false; adPlaying = null; done(full);
        };
        const timer = setInterval(() => {
          const left = Math.ceil((end - Date.now()) / 1000);
          setText(count, String(Math.max(0, left)));
          if (left <= 0) finish(true);
        }, 100);
        setText(count, String(Math.ceil(AD_SECONDS)));
        tap(close, () => finish(false), 'tap', n);
      });
    })();
    return adPlaying;
  },
};
