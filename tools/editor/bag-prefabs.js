// Generate one prefab per bag style: assets/gamecontent/bags/<skin>.prefab
// Run inside the editor:  node tools/run-in-editor.mjs tools/editor/bag-prefabs.js '{"ids":["box"]}'
// (no ids = every bag in content/cozy/assets/index.json). Run in small batches: the editor writes
// prefabs asynchronously.
//
// Node origin = CENTER-BOTTOM of the bag interior (the level origin), scale 1, y up.
//   Body    Sprite, bag image behind the items
//   Front   Sprite, rim / opening image in front of the items
//   Walls   RigidBody2D static (group BAG): one thin PolygonCollider2D quad outside each edge of the
//           interior outline, a CircleCollider2D cap on each convex corner, plus the dividers printed
//           in the bag image (skin.walls). Slippery (friction .04) so items slide into gaps.
//   BagView interior outline, image bottom, references to the three children.
// Body of an async function: (cc, Editor, args).
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const CONTENT = path.join(ROOT, 'assets/gamecontent/content/cozy');
const index = JSON.parse(fs.readFileSync(path.join(CONTENT, 'assets/index.json'), 'utf8'));
const WALL = 14, GROUP_BAG = 1 << 3;
const { Node, UITransform, Sprite, RigidBody2D, ERigidBody2DType, PolygonCollider2D, CircleCollider2D, Vec2, Layers, assetManager, js } = cc;
const BagView = js.getClassByName('BagView');
if (!BagView) throw new Error('BagView script not compiled yet');

const spriteFrameUuid = png => {
  const m = JSON.parse(fs.readFileSync(png + '.meta', 'utf8'));
  const sub = Object.values(m.subMetas || {}).find(s => s.importer === 'sprite-frame');
  return sub && sub.uuid;
};
const loadAsset = uuid => new Promise((ok, fail) => assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const signedArea2 = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };

function child(parent, name) { const n = new Node(name); n.layer = Layers.Enum.UI_2D; parent.addChild(n); n.addComponent(UITransform); return n; }

const ids = args && args.ids ? args.ids : Object.keys(index.bags);
const report = [];
const scene = cc.director.getScene();
for (const id of ids) {
  const rel = index.bags[id];
  if (!rel) { report.push(`${id}: not in index`); continue; }
  const skin = JSON.parse(fs.readFileSync(path.join(CONTENT, rel), 'utf8'));
  if (!skin.fixed || !(skin.inner && skin.inner.length >= 3)) { report.push(`${id}: not a fixed-shape bag, skipped`); continue; }

  const root = new Node(`Bag_${id}`); root.layer = Layers.Enum.UI_2D; scene.addChild(root);
  root.addComponent(UITransform);
  // images: rect (x, y, w, h) in level units around the origin, y down → node space y up
  const im = skin.image;
  const imgNodes = {};
  for (const layer of ['body', 'frame']) {
    if (!skin.layers || !skin.layers[layer]) continue;
    const n = child(root, layer === 'body' ? 'Body' : 'Front');
    n.getComponent(UITransform).setContentSize(im.w, im.h);
    n.setPosition(im.x + im.w / 2, -(im.y + im.h / 2), 0);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.trim = false;
    sp.spriteFrame = await loadAsset(spriteFrameUuid(path.join(CONTENT, skin.layers[layer])));
    imgNodes[layer] = n;
  }

  // walls (node space, y up)
  const poly = skin.inner.map(([x, y]) => [x, -y]);
  const walls = child(root, 'Walls');
  const body = walls.addComponent(RigidBody2D);
  body.type = ERigidBody2DType.Static; body.group = GROUP_BAG;
  const dir = Math.sign(signedArea2(poly)) || 1;
  const normals = [];
  const addPoly = pts => { const c = walls.addComponent(PolygonCollider2D); c.points = pts.map(([x, y]) => new Vec2(x, y)); c.friction = .04; c.restitution = .05; c.group = GROUP_BAG; };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1) { normals.push(null); continue; }
    // outward normal: for a counter-clockwise outline (positive area) the outside is on the right
    const nx = dir * dy / len, ny = -dir * dx / len;
    normals.push([nx, ny]);
    addPoly([a, b, [b[0] + nx * WALL, b[1] + ny * WALL], [a[0] + nx * WALL, a[1] + ny * WALL]]);
  }
  // caps on convex corners only (concave corners already overlap outside)
  let caps = 0;
  for (let i = 0; i < poly.length; i++) {
    const na = normals[(i - 1 + poly.length) % poly.length], nb = normals[i];
    if (!na || !nb) continue;
    const p = poly[(i - 1 + poly.length) % poly.length], v = poly[i], q = poly[(i + 1) % poly.length];
    const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
    if (Math.sign(cross) !== dir) continue;
    let bx = na[0] + nb[0], by = na[1] + nb[1]; const L = Math.hypot(bx, by);
    if (L < 1e-6) continue;
    const c = walls.addComponent(CircleCollider2D);
    c.radius = WALL / 2; c.offset = new Vec2(v[0] + bx / L * WALL / 2, v[1] + by / L * WALL / 2);
    c.friction = .04; c.restitution = .05; c.group = GROUP_BAG; caps++;
  }
  for (const w of skin.walls || []) addPoly(w.map(([x, y]) => [x, -y]));

  const view = root.addComponent(BagView);
  view.skinId = id; view.displayName = skin.nameEn || skin.name || id;
  view.interior = poly.map(([x, y]) => new Vec2(x, y));
  view.imageBottom = -(im.y + im.h);
  view.body = imgNodes.body || null; view.front = imgNodes.frame || null; view.walls = walls;

  const url = `db://assets/gamecontent/bags/${id}.prefab`;
  const existing = await Editor.Message.request('asset-db', 'query-asset-info', url);
  if (existing) await Editor.Message.request('asset-db', 'delete-asset', url);
  await Editor.Message.request('scene', 'create-prefab', root.uuid, url);
  // create-prefab swaps the scene node for a prefab instance (renamed after the file): remove
  // whatever sits at the scene root now, not only the old reference
  root.removeFromParent(); root.destroy();
  for (const n of scene.children.slice()) if (n.name !== 'Canvas' && !n.name.startsWith('Editor Scene')) n.destroy();
  report.push(`${id}: ${poly.length} edges, ${caps} caps, ${(skin.walls || []).length} dividers`);
}
return report;
