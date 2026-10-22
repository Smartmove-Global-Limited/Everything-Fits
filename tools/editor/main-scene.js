// Wire the Main scene: MainMenu controller (loads the Home and Shop prefabs from resources/ui) and
// camera clear colour. Run with Main.scene open, then save the scene.
const canvas = cc.director.getScene().getChildByName('Canvas');
for (const n of canvas.children.slice()) if (n.name !== 'Camera' && n.name !== 'MainMenu') n.destroy();
let ctrlNode = canvas.getChildByName('MainMenu');
if (!ctrlNode) { ctrlNode = new cc.Node('MainMenu'); ctrlNode.layer = canvas.layer; canvas.addChild(ctrlNode); }
const C = cc.js.getClassByName('MainMenu');
const ctrl = ctrlNode.getComponent(C) || ctrlNode.addComponent(C);
canvas.getChildByName('Camera').getComponent(cc.Camera).clearColor = new cc.Color(236, 227, 209, 255);
await new Promise(r => setTimeout(r, 50));
return { children: canvas.children.map(n => n.name), controller: !!ctrl };
