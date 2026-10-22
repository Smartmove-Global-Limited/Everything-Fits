// Wire the Main scene: MainMenu controller (instantiates the Home and Shop prefabs at load) and
// camera clear colour. Run with Main.scene open, then save the scene.
const fs = require('fs');
const canvas = cc.director.getScene().getChildByName('Canvas');
for (const n of canvas.children.slice()) if (n.name !== 'Camera' && n.name !== 'MainMenu') n.destroy();
let ctrlNode = canvas.getChildByName('MainMenu');
if (!ctrlNode) { ctrlNode = new cc.Node('MainMenu'); ctrlNode.layer = canvas.layer; canvas.addChild(ctrlNode); }
const C = cc.js.getClassByName('MainMenu');
const ctrl = ctrlNode.getComponent(C) || ctrlNode.addComponent(C);
const load = name => new Promise((ok, fail) => cc.assetManager.loadAny(JSON.parse(fs.readFileSync(Editor.Project.path + `/assets/resources/ui/${name}.prefab.meta`, 'utf8')).uuid, (e, a) => (e ? fail(e) : ok(a))));
ctrl.homePrefab = await load('HomeScreen');
ctrl.shopPrefab = await load('ShopScreen');
canvas.getChildByName('Camera').getComponent(cc.Camera).clearColor = new cc.Color(236, 227, 209, 255);
await new Promise(r => setTimeout(r, 50));
return { children: canvas.children.map(n => n.name), wired: !!ctrl.homePrefab && !!ctrl.shopPrefab };
