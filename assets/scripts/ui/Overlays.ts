// Screen-wide overlays shared by every scene: the short toast (web efToast) and the rewarded ad
// (web game/ads.js). Prefabs load once; one instance per scene sits on top of the Canvas.
import { Node, Prefab, instantiate, director, resources, UIOpacity, Tween, tween, UITransform, Graphics, Color, Layers } from 'cc';
import { findNode, setText, tap, labelIn } from './UiKit';

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

// ---------- scene veil (web src/ui/veil.js): cover in 190 ms, work, uncover in 300 ms ----------
const VEIL_IN = .19, VEIL_OUT = .3;
const VEIL_COLOR = new Color(0xD9, 0xCF, 0xBE, 255);
/** set by cover() before a scene change: the next scene starts covered and uncovers itself */
let veilPending = false;
function veilNode(): Node {
  const canvas = director.getScene()!.getChildByName('Canvas')!;
  let n = canvas.getChildByName('__veil');
  if (!n) {
    n = new Node('__veil'); n.layer = Layers.Enum.UI_2D; canvas.addChild(n);
    n.addComponent(UITransform).setContentSize(420, 760);
    const g = n.addComponent(Graphics); g.fillColor = VEIL_COLOR; g.rect(-420, -760, 840, 1520); g.fill();
    n.addComponent(UIOpacity);
    n.on(Node.EventType.TOUCH_START, () => {}, n);   // swallow taps while covered
  }
  n.setSiblingIndex(canvas.children.length - 1);
  return n;
}
let adPlaying: Promise<boolean> | null = null;

export const Overlays = {
  loadPrefab,

  /** Cover the screen; resolves once fully opaque. Pass `sceneChange` before director.loadScene. */
  cover(sceneChange = false): Promise<void> {
    veilPending = sceneChange;
    const n = veilNode(), op = n.getComponent(UIOpacity)!;
    n.active = true; Tween.stopAllByTarget(op);
    return new Promise(done => tween(op).to(VEIL_IN, { opacity: 255 }).call(() => done()).start());
  },
  /** Uncover after the new content has drawn (two frames later, like the web) */
  uncover(): Promise<void> {
    const n = veilNode(), op = n.getComponent(UIOpacity)!;
    n.active = true; Tween.stopAllByTarget(op);
    return new Promise(done => tween(op).delay(1 / 30).to(VEIL_OUT, { opacity: 0 }).call(() => { n.active = false; done(); }).start());
  },
  /** Called by a scene controller in onLoad: start covered if the previous scene asked for it */
  startCoveredIfPending() {
    if (!veilPending) return false;
    veilPending = false;
    const n = veilNode(); n.active = true; n.getComponent(UIOpacity)!.opacity = 255;
    return true;
  },

  /** Short message floating in the middle of the screen */
  async toast(text: string, seconds = 1.6) {
    const n = await onTop('ui/EfToast', '__toast');
    const l = labelIn(n)!;
    l.string = text;
    l.updateRenderData(true);
    // pill hugs the text (web padding .5em 1.1em)
    n.getComponent(UITransform)!.width = l.node.getComponent(UITransform)!.width + l.fontSize * 2.2;
    l.node.setPosition(0, l.node.position.y, 0);
    const op = n.getComponent(UIOpacity) || n.addComponent(UIOpacity);
    Tween.stopAllByTarget(op);
    n.active = true; op.opacity = 0;
    tween(op).to(.15, { opacity: 255 }).delay(seconds).to(.25, { opacity: 0 }).call(() => { n.active = false; }).start();
  },

  /** Is a rewarded ad available (a real SDK says false while loading / offline) */
  adAvailable: () => true,

  /**
   * TEMPORARY simulated rewarded ad: a "TEST AD" cover counting down. Resolves true when watched
   * to the end, false when closed early. Plug the real ad SDK in here, callers stay the same.
   */
  watchAd(): Promise<boolean> {
    if (adPlaying) return adPlaying;
    adPlaying = (async () => {
      const n = await onTop('ui/AdOverlay', '__ad');
      n.active = true;
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
