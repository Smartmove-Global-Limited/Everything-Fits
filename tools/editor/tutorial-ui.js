// Build two prefabs in assets/resources/ui (loaded by path):
//   TutorialOverlay  Tutorial component: pointing hand, tap ring, speech bubble (Tutorial.ts)
//   TestBanner       the simulated 50-unit banner strip shown at the bottom edge until the AppLovin
//                    keys exist (Overlays.ts)
// Art: assets/resources/uiart/tutorial/hand.png, ring.png. Re-running rebuilds both, keeping uuids.
//   node tools/run-in-editor.mjs tools/editor/tutorial-ui.js
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const load = uuid => new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const meta = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel + '.meta'), 'utf8'));
const frame = async rel => load(Object.values(meta('assets/resources/uiart/' + rel).subMetas).find(s => s.importer === 'sprite-frame').uuid);
const font = async name => load(meta('assets/fonts/' + name + '.ttf').uuid);
const cls = name => cc.js.getClassByName(name);
const layer = cc.Layers.Enum.UI_2D;
const scene = cc.director.getScene();

await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/resources/uiart/tutorial');
const ink = new cc.Color(0x3B, 0x2A, 0x4A, 255), cream = new cc.Color(0xFF, 0xF8, 0xE9, 255);
const baloo = await font('Baloo2-ExtraBold'), nunito = await font('Nunito-ExtraBold');

// every node is built inside the open scene's Canvas: the editor only registers nodes added there
const canvas = scene.getChildByName('Canvas');
function node(name, parent, w, h, x = 0, y = 0) {
  const n = new cc.Node(name); n.layer = layer;
  (parent || canvas).addChild(n);
  n.addComponent(cc.UITransform).setContentSize(w, h);
  n.setPosition(x, y, 0);
  return n;
}
function label(n, text, f, size, color) {
  const l = n.addComponent(cc.Label);
  l.font = f; l.useSystemFont = false; l.string = text; l.fontSize = size; l.lineHeight = size * 1.2;
  l.color = color; l.horizontalAlign = cc.Label.HorizontalAlign.CENTER; l.verticalAlign = cc.Label.VerticalAlign.CENTER;
  return l;
}
function sprite(n, f) { const s = n.addComponent(cc.Sprite); s.sizeMode = cc.Sprite.SizeMode.CUSTOM; s.spriteFrame = f; return s; }

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

// ---------- TutorialOverlay ----------
const tut = node('TutorialOverlay', null, 420, 760);
{
  const ring = node('ring', tut, 64, 64);
  sprite(ring, await frame('tutorial/ring.png'));
  ring.addComponent(cc.UIOpacity);
  // the fingertip sits at the node origin: the picture hangs below-right of it
  const hand = node('hand', tut, 0, 0);
  hand.addComponent(cc.UIOpacity);
  const pic = node('picture', hand, 58, 72, 12, -33);
  sprite(pic, await frame('tutorial/hand.png'));
  const bubble = node('bubble', tut, 360, 46, 0, 290);
  const rr = bubble.addComponent(cls('RoundRect'));
  rr.fill = cream; rr.radius = 18; rr.borderWidth = 2.5; rr.borderColor = ink;
  rr.shadowY = 4; rr.shadowBlur = 10;
  const text = node('text', bubble, 340, 40, 0, 2);
  const l = label(text, 'Drag items into the bag', baloo, 18, ink);
  l.overflow = cc.Label.Overflow.SHRINK; l.enableWrapText = false;
  text.getComponent(cc.UITransform).setContentSize(340, 40);   // NONE resized it to the text
  const t = tut.addComponent(cls('Tutorial'));
  t.hand = hand; t.ring = ring; t.bubble = bubble; t.text = l;
  // covers the screen on tall phones too (touches pass through, see Tutorial.ts)
  const pin = tut.addComponent(cls('EdgePin')); pin.mode = 2; pin.safeArea = false;
}
const tutUrl = await save(tut, 'TutorialOverlay');

// ---------- TestBanner ----------
const banner = node('TestBanner', null, 420, 50);
{
  const rr = banner.addComponent(cls('RoundRect'));
  rr.fill = new cc.Color(0x2E, 0x3A, 0x48, 255); rr.radius = 0;
  label(node('title', banner, 200, 22, 0, 8), 'TEST BANNER', nunito, 15, new cc.Color(255, 255, 255, 255));
  label(node('placement', banner, 300, 16, 0, -12), 'banner_main_menu', nunito, 11, new cc.Color(0xC9, 0xD4, 0xE0, 255));
  banner.addComponent(cc.BlockInputEvents);   // a tap on the banner does not reach the screen below
}
const bannerUrl = await save(banner, 'TestBanner');
return { tutUrl, bannerUrl };
