// Generate one prefab per item: assets/gamecontent/items/<id>.prefab
// Run inside the editor:  node tools/run-in-editor.mjs tools/editor/item-prefabs.js '{"ids":[13]}'
// (no ids = every item in content/cozy/assets/index.json)
//
// Each prefab: Sprite (item image, size = pixels / pixelsPerUnit), RigidBody2D (dynamic, group ITEM,
// sleeping allowed, contact listener on), one PolygonCollider2D per polygon of the item collider
// (Cocos splits concave shapes itself) or CircleCollider2D, and ItemView with the item metadata.
// Density is set so the body mass = MASS_BY_CLASS[massClass] × BASE_MASS (gameplay weight class).
// Existing prefabs are replaced. Body of an async function: (cc, Editor, args).
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const CONTENT = path.join(ROOT, 'assets/gamecontent/content/cozy');
const index = JSON.parse(fs.readFileSync(path.join(CONTENT, 'assets/index.json'), 'utf8'));
const PTM = 32;                                  // Cocos physics: pixels per meter
const MASS_BY_CLASS = [1, 1.6, 2.5], BASE_MASS = 3;
const GROUP_ITEM = 1 << 1;
const PHYSICS = { normal: 0, rolling: 1, float: 2, vibrating: 3, bouncy: 4 };
const { Node, UITransform, Sprite, RigidBody2D, ERigidBody2DType, PolygonCollider2D, CircleCollider2D, Vec2, Layers, assetManager, js } = cc;
const ItemView = js.getClassByName('ItemView');
if (!ItemView) throw new Error('ItemView script not compiled yet');

const pngSize = f => { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const spriteFrameUuid = png => {
  const m = JSON.parse(fs.readFileSync(png + '.meta', 'utf8'));
  const sub = Object.values(m.subMetas || {}).find(s => s.importer === 'sprite-frame');
  return sub && sub.uuid;
};
const loadAsset = uuid => new Promise((ok, fail) => assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const area = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
// Ramer–Douglas–Peucker on a closed outline: fewer vertices = cheaper collisions, same shape
function simplify(pts, eps) {
  if (pts.length < 6) return pts;
  const sq = eps * eps;
  const d2 = (p, a, b) => { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy; };
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) { const [s, e] = stack.pop(); let m = 0, im = -1; for (let i = s + 1; i < e; i++) { const d = d2(pts[i], pts[s], pts[e]); if (d > m) { m = d; im = i; } } if (m > sq) { keep[im] = true; stack.push([s, im], [im, e]); } }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}
const rectPts = (w, h, dx = 0, dy = 0) => [[dx - w / 2, dy - h / 2], [dx + w / 2, dy - h / 2], [dx + w / 2, dy + h / 2], [dx - w / 2, dy + h / 2]];

const ids = args && args.ids ? args.ids : Object.keys(index.items).map(Number);
const report = [];
const scene = cc.director.getScene();
for (const id of ids) {
  const rel = index.items[id];
  if (!rel) { report.push(`${id}: not in index`); continue; }
  const m = JSON.parse(fs.readFileSync(path.join(CONTENT, rel), 'utf8'));
  if (!m.sprite) { report.push(`${id}: no sprite`); continue; }
  const png = path.join(CONTENT, m.sprite.src);
  const ppu = m.sprite.pixelsPerUnit || 3;
  const size = pngSize(png);
  const meta = m.meta || {};
  const physics = PHYSICS[meta.physics] ?? 0;
  const grams = Number(meta.gram) || 150;
  const massClass = grams < 100 ? 0 : grams < 400 ? 1 : 2;

  const node = new Node(`Item_${id}`);
  node.layer = Layers.Enum.UI_2D;
  scene.addChild(node);
  node.addComponent(UITransform).setContentSize(size.w / ppu, size.h / ppu);
  const sprite = node.addComponent(Sprite);
  sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
  sprite.spriteFrame = await loadAsset(spriteFrameUuid(png));

  const body = node.addComponent(RigidBody2D);
  body.type = ERigidBody2DType.Dynamic; body.allowSleep = true; body.enabledContactListener = true;
  body.group = GROUP_ITEM; body.linearDamping = .05; body.angularDamping = .1;

  // collider outline in item units (y down, around the image center) → node space (y up)
  const c = m.collider || {};
  const polys = c.kind === 'poly' ? [c.pts] : c.kind === 'polys' ? c.parts : c.kind === 'rect' ? [rectPts(c.w, c.h, c.dx || 0, c.dy || 0)] : [];
  const circles = c.kind === 'circle' ? [c] : [];
  if (!polys.length && !circles.length) polys.push(rectPts(size.w / ppu * .9, size.h / ppu * .9));
  const totalArea = polys.reduce((s, p) => s + area(p), 0) + circles.reduce((s, k) => s + Math.PI * k.r * k.r, 0);
  let density = MASS_BY_CLASS[massClass] * BASE_MASS / (totalArea / (PTM * PTM));
  if (physics === PHYSICS.float) density *= .35;
  const friction = physics === PHYSICS.rolling ? .15 : physics === PHYSICS.float ? .08 : .6;
  const restitution = physics === PHYSICS.bouncy ? .85 : physics === PHYSICS.float ? .35 : .05;
  let vertices = 0;
  for (const p of polys) {
    const col = node.addComponent(PolygonCollider2D);
    const pts = simplify(p, .6);
    vertices += pts.length;
    col.points = pts.map(([x, y]) => new Vec2(x, -y));
    col.density = density; col.friction = friction; col.restitution = restitution; col.group = GROUP_ITEM;
  }
  for (const k of circles) {
    const col = node.addComponent(CircleCollider2D);
    col.radius = k.r; col.offset = new Vec2(k.dx || 0, -(k.dy || 0));
    col.density = density; col.friction = friction; col.restitution = restitution; col.group = GROUP_ITEM;
  }

  const view = node.addComponent(ItemView);
  view.itemId = Number(id); view.nameVi = m.name || ''; view.nameEn = m.nameEn || '';
  view.physicsType = physics; view.massClass = massClass;
  view.material = meta.material || ''; view.fragile = !!meta.fragile; view.grams = grams;
  view.sizeClass = meta.size || 'Medium'; view.shapeTag = meta.shape || '';
  view.canLink = meta.canLink !== false; view.canLock = meta.canLock !== false;
  // outer outline drawn while held (web: def.outline, else the collider outline)
  const outline = m.outline || (c.kind === 'poly' || c.kind === 'compound' ? c.pts : null);
  view.outline = outline && outline.length >= 3 ? outline.map(([x, y]) => new Vec2(x, -y)) : [];

  const url = `db://assets/gamecontent/items/${id}.prefab`;
  const existing = await Editor.Message.request('asset-db', 'query-asset-info', url);
  if (existing) await Editor.Message.request('asset-db', 'delete-asset', url);
  await Editor.Message.request('scene', 'create-prefab', node.uuid, url);
  // create-prefab swaps the scene node for a prefab instance (renamed after the file): remove
  // whatever sits at the scene root now, not only the old reference
  node.removeFromParent(); node.destroy();
  for (const n of scene.children.slice()) if (n.name !== 'Canvas' && !n.name.startsWith('Editor Scene')) n.destroy();
  report.push(`${id}: ${m.name} · ${polys.length} poly (${vertices} pts) ${circles.length} circle · class ${massClass}`);
}
return report;
