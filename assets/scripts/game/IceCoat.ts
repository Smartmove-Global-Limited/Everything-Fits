// Ice coat on frozen items (Freeze booster; web render.js draws it while b.frozen && !held): a copy
// of the item's sprite on top of it, drawn by effects/ice-sprite as the item's own silhouette in
// pale ice blue with a blue rim. One child node per item, made on first use and kept (hidden) for
// the next freeze; pooled items carry it along.
import { Node, Sprite, UITransform, Material, EffectAsset, Vec4, resources } from 'cc';
import type { ItemView } from './ItemView';

const NODE_NAME = '__ice';
/** rim width, Field units (web: lineWidth 2) */
const RIM = 2;

let effectLoad: Promise<EffectAsset | null> | null = null;
let material: Material | null = null;
const effect = () => effectLoad ||= new Promise(ok => resources.load('effects/ice-sprite', EffectAsset, (e, a) => ok(e ? null : a)));
/** Load the shader ahead of the first freeze (GameController start) */
export const preloadIceCoat = () => { void effect(); };

const rect = new Vec4(), edge = new Vec4();

/** Show or hide the ice coat of an item */
export function setIceCoat(item: ItemView, on: boolean) {
  const old = item.node.getChildByName(NODE_NAME);
  if (!on) { if (old) old.active = false; return; }
  if (old) { old.active = true; fit(item, old); return; }
  void effect().then(fx => {
    if (!fx || !item.isValid || !item.frozen || item.node.getChildByName(NODE_NAME)) return;
    const src = item.sprite, ui = item.transform2d;
    if (!src?.spriteFrame) return;
    if (!material) { material = new Material(); material.initialize({ effectAsset: fx, defines: { USE_TEXTURE: true } }); }
    const n = new Node(NODE_NAME); n.layer = item.node.layer;
    const t = n.addComponent(UITransform); t.setContentSize(ui.contentSize); t.setAnchorPoint(ui.anchorPoint);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.trim = src.trim; sp.spriteFrame = src.spriteFrame;
    sp.customMaterial = material;
    item.node.addChild(n);
    fit(item, n);
  });
}

/** uv rectangle of the frame and the rim width in uv units (the item's size may have changed) */
function fit(item: ItemView, n: Node) {
  const sp = n.getComponent(Sprite), f = sp?.spriteFrame, tex = f?.texture as any;
  if (!sp || !f || !tex) return;
  n.getComponent(UITransform)!.setContentSize(item.transform2d.contentSize);
  const uv = f.uv;
  let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
  for (let i = 0; i < 8; i += 2) { u0 = Math.min(u0, uv[i]); u1 = Math.max(u1, uv[i]); v0 = Math.min(v0, uv[i + 1]); v1 = Math.max(v1, uv[i + 1]); }
  const ui = item.transform2d, k = item.levelScale || 1;
  // texture pixels per Field unit (the node shows the trimmed rect, or the whole original picture),
  // then RIM units as a share of the texture
  const pw = sp.trim ? f.rect.width : f.originalSize.width, ph = sp.trim ? f.rect.height : f.originalSize.height;
  let ex = RIM * pw / Math.max(1, ui.width * k) / tex.width, ey = RIM * ph / Math.max(1, ui.height * k) / tex.height;
  if (f.rotated) { const t = ex; ex = ey; ey = t; }
  const mi = sp.getMaterialInstance(0)!;
  mi.setProperty('ice', rect.set(u0, v0, u1, v1));
  mi.setProperty('edge', edge.set(ex, ey, 0, 0));
}
