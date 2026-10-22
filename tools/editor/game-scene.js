// Builds the Game scene hierarchy inside the open editor (run with tools/run-in-editor.mjs while
// Game.scene is open, then save the scene). Safe to re-run: the old Game nodes are removed first.
//
//   Canvas
//     Camera
//     Background        Sprite (level background, 420×760)
//     Field             UITransform 420×760, anchor (0,0) at the bottom-left of the design area,
//                       so Field space == physics world space. DragController lives here.
//       BagLayer        bag body images
//       ItemLayer       item nodes
//       FrontLayer      bag rim / opening drawn over the items
//       HeldLayer       the item being dragged (above the rim): Shadow sprite, the item, Outline
//       FxLayer         effects
//       Handle          Graphics for the rotate handle
//       Environment     static RigidBody2D: tray floor, screen sides (WALL), ceiling (CEILING)
//     Hud               built by tools/editor/game-hud.js (run it after this script)
//     GameController
const BG_FRAME = '5c89c5d3-21b9-44e3-87c9-795568e20f72@f9941';
const W = 420, H = 760, FLOOR = 130, T = 60;
const GROUP = { WALL: 1 << 2, CEILING: 1 << 4 };

const load = (uuid) => new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const scene = cc.director.getScene();
const canvas = scene.getChildByName('Canvas');
for (const name of ['Background', 'Field', 'Hud', 'GameController']) canvas.getChildByName(name)?.destroy();
await new Promise(r => setTimeout(r, 50));

const layer = canvas.layer;
const make = (name, parent, w, h) => {
  const n = new cc.Node(name);
  n.layer = layer;
  parent.addChild(n);
  const t = n.addComponent(cc.UITransform);
  if (w != null) t.setContentSize(w, h);
  return n;
};
const cls = (name) => cc.js.getClassByName(name);

// ---- background ----
const bg = make('Background', canvas, W, H);
const bgSprite = bg.addComponent(cc.Sprite);
bgSprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
bgSprite.spriteFrame = await load(BG_FRAME);

// ---- field ----
const field = make('Field', canvas, W, H);
field.getComponent(cc.UITransform).setAnchorPoint(0, 0);
field.setPosition(-W / 2, -H / 2, 0);
const bagLayer = make('BagLayer', field);
const itemLayer = make('ItemLayer', field);
const frontLayer = make('FrontLayer', field);
const heldLayer = make('HeldLayer', field);
const shadow = make('Shadow', heldLayer).addComponent(cc.Sprite);
const outline = make('Outline', heldLayer).addComponent(cc.Graphics);
make('FxLayer', field);
const handle = make('Handle', field).addComponent(cc.Graphics);
const drag = field.addComponent(cls('DragController'));
drag.handle = handle; drag.heldLayer = heldLayer; drag.outline = outline; drag.shadow = shadow; drag.itemLayer = itemLayer;

// ---- environment colliders (Field space) ----
const env = make('Environment', field);
const box = (x, y, w, h, group, name) => {
  const n = make(name, env);
  n.setPosition(x, y, 0);
  const rb = n.addComponent(cc.RigidBody2D);
  rb.type = cc.ERigidBody2DType.Static;
  rb.group = group;
  const c = n.addComponent(cc.BoxCollider2D);
  c.size = new cc.Size(w, h);
  c.friction = .8; c.restitution = .1;
  c.group = group;
};
box(W / 2, FLOOR - T / 2, W + 200, T, GROUP.WALL, 'Floor');
box(-T / 2, H / 2, T, H * 2, GROUP.WALL, 'WallLeft');
box(W + T / 2, H / 2, T, H * 2, GROUP.WALL, 'WallRight');
box(W / 2, H + T, W * 2, T, GROUP.CEILING, 'Ceiling');

// ---- controller ----
const ctrlNode = make('GameController', canvas);
const ctrl = ctrlNode.addComponent(cls('GameController'));
ctrl.bagLayer = bagLayer; ctrl.itemLayer = itemLayer; ctrl.frontLayer = frontLayer;
ctrl.drag = drag;

// camera clears to the background fill so letterbox bands match the paper
const cam = canvas.getChildByName('Camera').getComponent(cc.Camera);
cam.clearColor = new cc.Color(0xD9, 0xCD, 0xBB, 255);

return canvas.children.map(c => `${c.name}: ${c.children.map(x => x.name).join(', ')}`);
