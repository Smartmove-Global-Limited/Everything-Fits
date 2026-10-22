// Game.scene: Fx component on Field/FxLayer (floating text font, camera shake), wired to the
// GameController; removes the old drag shadow node. Run with Game.scene open, then save.
const fs = require('fs');
const canvas = cc.director.getScene().getChildByName('Canvas');
const field = canvas.getChildByName('Field');
const fxNode = field.getChildByName('FxLayer');
const Fx = cc.js.getClassByName('Fx');
if (!fxNode.getComponent(cc.Graphics)) fxNode.addComponent(cc.Graphics);
const fx = fxNode.getComponent(Fx) || fxNode.addComponent(Fx);
const uuid = JSON.parse(fs.readFileSync(Editor.Project.path + '/assets/fonts/Nunito-ExtraBold.ttf.meta', 'utf8')).uuid;
fx.font = await new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
fx.shakeTarget = canvas.getChildByName('Camera');
const ctrl = canvas.getChildByName('GameController').getComponent(cc.js.getClassByName('GameController'));
ctrl.fx = fx;
field.getChildByName('HeldLayer')?.getChildByName('Shadow')?.destroy();
await new Promise(r => setTimeout(r, 50));
return { fx: !!ctrl.fx, held: field.getChildByName('HeldLayer').children.map(n => n.name) };
