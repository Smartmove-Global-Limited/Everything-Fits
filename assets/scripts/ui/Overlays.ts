// Screen-wide overlays shared by every scene: the short toast (web efToast) and the rewarded ad
// (web game/ads.js). Prefabs load once; one instance per scene sits on top of the Canvas.
import { Node, Prefab, instantiate, director, resources, UIOpacity, Tween, tween, UITransform } from 'cc';
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
let adPlaying: Promise<boolean> | null = null;

export const Overlays = {
  loadPrefab,

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
