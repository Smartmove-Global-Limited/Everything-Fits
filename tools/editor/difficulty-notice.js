// Builds the prefab assets/resources/ui/DifficultyNotice.prefab (DifficultyNotice.ts) to the Figma
// frames "EF · Overlay / Hard Level" #436:185 and "EF · Overlay / Super Hard Level" #436:223
// (file 2z3Xf0kDb5u4w6YejoI9iG): a dimmed screen and the luggage-tag notice card. The Figma frame
// is 432 wide, the game 420: every Figma measure is scaled by K. The card is dressed for Hard
// here; DifficultyNotice.show() recolours it per difficulty at run time.
// Art: assets/resources/uiart/notice/tag_hard.webp, tag_super_hard.webp (Figma image fills).
// Re-running rebuilds the prefab keeping its uuid.
//   node tools/run-in-editor.mjs tools/editor/difficulty-notice.js
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const load = uuid => new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const meta = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel + '.meta'), 'utf8'));
const frame = async rel => load(Object.values(meta('assets/resources/uiart/' + rel).subMetas).find(s => s.importer === 'sprite-frame').uuid);
const font = async name => load(meta('assets/fonts/' + name + '.ttf').uuid);
const cls = name => cc.js.getClassByName(name);
const C = (hex, a = 255) => new cc.Color(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a);
const layer = cc.Layers.Enum.UI_2D;
const scene = cc.director.getScene();
const canvas = scene.getChildByName('Canvas');
for (const need of ['DifficultyNotice', 'DashedRect', 'RoundRect', 'EdgePin']) if (!cls(need)) throw new Error(`class ${need} not compiled yet`);

await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/resources/uiart/notice');
const baloo = await font('Baloo2-ExtraBold');
const K = 420 / 432;                                   // Figma frame width → design width

function node(name, parent, w, h, x = 0, y = 0) {
  const n = new cc.Node(name); n.layer = layer;
  (parent || canvas).addChild(n);
  n.addComponent(cc.UITransform).setContentSize(w, h);
  n.setPosition(x, y, 0);
  return n;
}
function panel(n, o) {
  n.addComponent(cc.Graphics);
  const rr = n.addComponent(cls('RoundRect'));
  rr.fill = o.fill; rr.radius = o.radius;
  if (o.border) { rr.borderWidth = o.border; rr.borderColor = o.borderColor; }
  if (o.shadowBlur) { rr.shadowY = o.shadowY; rr.shadowBlur = o.shadowBlur; rr.shadowColor = o.shadowColor; }
  return rr;
}
/** Save a node tree as db://assets/resources/ui/<name>.prefab, keeping the uuid of an older one */
async function save(root, name) {
  const url = `db://assets/resources/ui/${name}.prefab`;
  const before = new Set(scene.children);
  await new Promise(r => setTimeout(r, 100));
  root.setParent(scene, false);
  root.setPosition(0, 0, 0);
  const existing = await Editor.Message.request('asset-db', 'query-asset-info', url);
  if (existing) {
    const tmpUrl = `db://assets/resources/ui/${name}.__new.prefab`;
    await Editor.Message.request('scene', 'create-prefab', root.uuid, tmpUrl);
    const tmp = await Editor.Message.request('asset-db', 'query-asset-info', tmpUrl);
    await Editor.Message.request('asset-db', 'save-asset', url, fs.readFileSync(tmp.file, 'utf8'));
    await Editor.Message.request('asset-db', 'delete-asset', tmpUrl);
  } else await Editor.Message.request('scene', 'create-prefab', root.uuid, url);
  await new Promise(r => setTimeout(r, 300));
  for (const n of scene.children.slice()) if (!before.has(n)) n.destroy();
  return url;
}

// ---------- root: the whole design box, fades as one ----------
const root = node('DifficultyNotice', null, 420, 760);
root.addComponent(cc.UIOpacity);

// ---------- dim backdrop (Figma rgba(31,26,23,.38); no blur: costly on weak phones) ----------
// Graphics only, no touch listener: the player can still drag items under it
const dim = node('dim', root, 420, 760);
panel(dim, { fill: new cc.Color(31, 26, 23, 97), radius: 0 });
const pin = dim.addComponent(cls('EdgePin')); pin.mode = 2; pin.safeArea = false;

// ---------- the card: Figma "Notice / Hard Level" 392×88 at (20, 184) of the 432×768 frame ----------
const CW = 392 * K, CH = 88 * K;
// Figma: 184 + 44 from the frame top → the same share of the design height
const card = node('card', root, CW, CH, 0, 380 - 228 / 768 * 760);
/** child from a Figma box (x, y, w, h from the card's top-left) → centred node in the card */
const at = (name, parent, x, y, w, h) => node(name, parent, w * K, h * K, (x + w / 2 - 392 / 2) * K, (88 / 2 - (y + h / 2)) * K);

const edge = panel(at('edge', card, 4, 5, 384, 84), { fill: C('#D6B575'), radius: 17 * K });
const face = panel(at('face', card, 0, 0, 392, 88), {
  fill: C('#FFF3D8'), radius: 18 * K, border: 2, borderColor: C('#C9944D'),
  shadowY: 5, shadowBlur: 12, shadowColor: new cc.Color(48, 34, 29, 61),
});
const stitchNode = at('stitch', card, 7, 7, 378, 74);
stitchNode.addComponent(cc.Graphics);
const stitch = stitchNode.addComponent(cls('DashedRect'));
stitch.radius = 12 * K; stitch.dash = 4; stitch.gap = 4; stitch.lineWidth = 1; stitch.color = new cc.Color(207, 172, 112, 178);
const backing = panel(at('backing', card, 10, 10, 82, 68), { fill: C('#F0D59A'), radius: 12 * K });
const ribbon = panel(at('ribbon', card, 368, 13, 9, 62), { fill: new cc.Color(214, 156, 72, 89), radius: 4 * K });
// the tag picture: a square image fitted in the 104×116 box at (0, -15), so 104×104 centred at (52, 43)
const artNode = at('art', card, 0, -9, 104, 104);
const art = artNode.addComponent(cc.Sprite);
art.sizeMode = cc.Sprite.SizeMode.CUSTOM; art.trim = false;
art.spriteFrame = await frame('notice/tag_hard.webp');

// ---------- words: a column at x = 105, 252 wide, centred vertically (kicker 14, title 34, line 16) ----------
function words(name, str, size, line, color, y, spacing = 0) {
  const n = at(name, card, 105, y, 252, line);
  const ui = n.getComponent(cc.UITransform); ui.anchorX = 0;
  n.setPosition(n.position.x - ui.width / 2, n.position.y + 1, 0);   // Baloo 2 sits low in a Cocos line box
  const l = n.addComponent(cc.Label);
  l.font = baloo; l.useSystemFont = false; l.string = str;
  l.fontSize = size * K; l.lineHeight = line * K; l.color = color;
  l.horizontalAlign = cc.Label.HorizontalAlign.LEFT; l.verticalAlign = cc.Label.VerticalAlign.CENTER;
  l.overflow = cc.Label.Overflow.NONE; l.enableWrapText = false;
  if (spacing) l.spacingX = spacing;
  return l;
}
const kicker = words('kicker', 'PACKING CHALLENGE', 10, 14, C('#9A7845'), 12, 1);
const title = words('title', 'Hard Level', 27, 34, C('#79502B'), 26);
const subtitle = words('subtitle', 'A little extra challenge!', 12, 16, C('#987648'), 60);

// ---------- component + wiring ----------
const view = root.addComponent(cls('DifficultyNotice'));
view.dim = dim; view.card = card;
view.face = face; view.edge = edge; view.stitch = stitch; view.backing = backing; view.ribbon = ribbon;
view.art = art; view.kicker = kicker; view.title = title; view.subtitle = subtitle;
view.hardTag = await frame('notice/tag_hard.webp');
view.superHardTag = await frame('notice/tag_super_hard.webp');
root.active = false;                                   // shown by DifficultyNotice.show()

const url = await save(root, 'DifficultyNotice');
return { url, card: `${CW.toFixed(1)}×${CH.toFixed(1)} @ y ${card.position.y.toFixed(1)}` };
