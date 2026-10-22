// Build a Cocos prefab from a processed web UI dump (see tools/web-ui/import-dump.mjs).
// Each DOM element becomes a node named after its id (else its first class, else its tag), placed
// at the same box (420×760 design space). Backgrounds / borders / shadows → RoundRect,
// <img> and rasterised <svg> → Sprite, text runs → Label (font matched by family + weight).
// args: { dump: 'tools/web-ui/dumps/<name>.processed.json', prefab: '<name>', component?: '<ControllerClass>' }
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const dump = JSON.parse(fs.readFileSync(path.join(ROOT, args.dump), 'utf8'));
const load = uuid => new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const fontUuid = (family, weight) => {
  const f = /nunito/i.test(family) ? (weight >= 800 ? 'Nunito-ExtraBold' : 'Nunito-Bold')
    : weight >= 800 ? 'Baloo2-ExtraBold' : weight >= 700 ? 'Baloo2-Bold' : 'Baloo2-SemiBold';
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/fonts', f + '.ttf.meta'), 'utf8')).uuid;
};
const frameCache = {};
async function frameFor(src) {
  const rel = src.replace(/^\.?\/?ui\//, '');
  if (frameCache[rel]) return frameCache[rel];
  const metaPath = path.join(ROOT, 'assets/resources/uiart', rel + '.meta');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const sub = Object.values(meta.subMetas || {}).find(s => s.importer === 'sprite-frame');
  return (frameCache[rel] = sub ? await load(sub.uuid) : null);
}
const fonts = {};
const fontFor = async (family, weight) => { const u = fontUuid(family, weight); return fonts[u] || (fonts[u] = await load(u)); };
const colour = c => new cc.Color(c[0], c[1], c[2], Math.round((c[3] ?? 1) * 255));
const cls = name => cc.js.getClassByName(name);
const layer = cc.Layers.Enum.UI_2D;
const nameOf = d => d.id || (d.cls || '').split(/\s+/).filter(Boolean)[0] || d.tag;
const centre = d => [d.x + d.w / 2, d.y + d.h / 2];
const report = [];

async function build(d, parent, parentCentre) {
  const node = new cc.Node(d.tag === '#text' ? 'Text' : nameOf(d));
  node.layer = layer;
  parent.addChild(node);
  const [cx, cy] = centre(d);
  node.setPosition(cx - parentCentre[0], -(cy - parentCentre[1]), 0);
  const ui = node.addComponent(cc.UITransform);
  ui.setContentSize(d.w, d.h);

  if (d.tag === '#text') {
    const l = node.addComponent(cc.Label);
    l.font = await fontFor(d.font, d.weight); l.useSystemFont = false;
    l.string = d.text; l.fontSize = d.size; l.lineHeight = d.h;
    l.color = colour(d.color);
    l.verticalAlign = cc.Label.VerticalAlign.CENTER;
    // anchor like the CSS text-align, so a label whose text changes grows the same way as on the web
    const a = d.align === 'right' || d.align === 'end' ? 1 : d.align === 'center' || d.align === '-webkit-center' ? .5 : 0;
    l.horizontalAlign = a === 0 ? cc.Label.HorizontalAlign.LEFT : a === 1 ? cc.Label.HorizontalAlign.RIGHT : cc.Label.HorizontalAlign.CENTER;
    ui.setAnchorPoint(a, .5);
    node.setPosition(node.position.x + (a - .5) * d.w, node.position.y, 0);
    l.overflow = cc.Label.Overflow.NONE; l.enableWrapText = false;
    l.spacingX = (d.letterSpacing || 0) + (d.tabular ? 1.6 : 0);
    // glyphs sit lower in a Cocos line box than in the browser's: measured on screenshots,
    // 0.13 × font size for Baloo 2, about 0.1 × for Nunito
    node.setPosition(node.position.x, node.position.y + d.size * (/nunito/i.test(d.font) ? .1 : .13), 0);
    return node;
  }
  const shadows = d.shadows || [];
  const lip = shadows.find(s => !s.inset && !s.blur && s.y > 0);
  const soft = shadows.find(s => !s.inset && s.blur > 0);
  const inset = shadows.find(s => s.inset);
  if (d.bg || d.border || lip || soft || inset) {
    node.addComponent(cc.Graphics);
    const rr = node.addComponent(cls('RoundRect'));
    rr.fill = d.bg ? colour(d.bg) : new cc.Color(0, 0, 0, 0);
    rr.radius = d.radius || 0;
    const ring = d.border || (inset && { w: inset.spread, color: inset.color });
    if (ring && ring.w) { rr.borderWidth = ring.w; rr.borderColor = colour(ring.color); }
    if (lip) { rr.lip = lip.y; rr.lipColor = colour(lip.color); }
    if (soft) { rr.shadowY = soft.y; rr.shadowBlur = soft.blur; rr.shadowColor = colour(soft.color); }
  }
  // CSS background-image: url(...) → a sprite filling the box (gradients are not converted)
  const bgUrl = d.bgImage && (d.bgImage.match(/url\("?[^")]*\/(ui\/[^")]+)"?\)/) || [])[1];
  if (bgUrl && !d.src) d.src = './' + bgUrl;
  if (d.src) {
    const f = await frameFor(d.src);
    if (f) { const s = node.addComponent(cc.Sprite); s.sizeMode = cc.Sprite.SizeMode.CUSTOM; s.trim = false; s.spriteFrame = f; }
    else report.push('missing image ' + d.src);
  }
  if (d.opacity != null && d.opacity < 1) node.addComponent(cc.UIOpacity).opacity = Math.round(d.opacity * 255);
  for (const c of d.children || []) await build(c, node, [cx, cy]);
  // scrolling list (web overflow-y:auto): mask the box, scroll its first child vertically
  if (/\befs-scroll\b/.test(d.cls || '') && node.children.length) {
    const list = node.children[0];
    // ScrollView wants a content node as wide as the view, anchored at its top edge
    const lu = list.getComponent(cc.UITransform), vu = node.getComponent(cc.UITransform);
    const content = new cc.Node('Content'); content.layer = layer; node.addChild(content);
    const cu = content.addComponent(cc.UITransform);
    const top = Math.max(vu.height / 2, list.position.y + lu.height / 2);
    cu.setContentSize(vu.width, lu.height + Math.max(0, (vu.height / 2 - (list.position.y + lu.height / 2))));
    cu.setAnchorPoint(.5, 1); content.setPosition(0, top, 0);
    list.setParent(content, true);
    const m = node.addComponent(cc.Mask); m.type = cc.Mask.Type.GRAPHICS_RECT;
    const sv = node.addComponent(cc.ScrollView);
    sv.content = content; sv.horizontal = false; sv.vertical = true; sv.inertia = true; sv.elastic = true; sv.brake = .6;
  }
  return node;
}

const scene = cc.director.getScene();
const canvas = scene.getChildByName('Canvas');
const holder = new cc.Node('__ui_build'); holder.layer = layer; canvas.addChild(holder);
const root = await build(dump.tree, holder, [210, 380]);
root.name = args.prefab;
// controller component of the screen / popup (finds its nodes by name in onLoad)
if (args.component) { const C = cls(args.component); if (!C) throw new Error('component not compiled: ' + args.component); root.addComponent(C); }
// full-screen overlays and screens swallow touches: nothing under a popup reacts
if (/\b(overlay|screen|adsim)\b/.test(dump.tree.cls || '')) root.addComponent(cc.BlockInputEvents);
let count = 0; (function c(n) { count++; n.children.forEach(c); })(root);
root.setParent(scene, false);
root.setPosition(0, 0, 0);          // prefab root sits at the Canvas centre
holder.destroy();
const url = `db://assets/resources/ui/${args.prefab}.prefab`;
const existing = await Editor.Message.request('asset-db', 'query-asset-info', url);
if (existing) await Editor.Message.request('asset-db', 'delete-asset', url);
await Editor.Message.request('scene', 'create-prefab', root.uuid, url);
// create-prefab swaps the node for a prefab instance: clear everything but the Canvas from the root
await new Promise(r => setTimeout(r, 300));
for (const n of scene.children.slice()) if (n.name !== 'Canvas' && !n.name.startsWith('Editor Scene')) n.destroy();
return { prefab: url, nodes: count, report };
