// Editor.scene = Game.scene + an "Editor" node with EditorApp (assets/scripts/editor). The editor's
// page is HTML (build-templates/web-desktop); this scene only runs the game in its preview box.
// Make it from a fresh copy of Game.scene, opened in Cocos Creator:
//   node tools/run-in-editor.mjs tools/editor/level-editor-scene.js   then save the scene
// Safe to re-run.
const scene = cc.director.getScene();
for (const n of ['Editor', 'EditorCanvas', 'BackCamera']) scene.getChildByName(n)?.destroy();
await new Promise(r => setTimeout(r, 50));
const node = new cc.Node('Editor');
scene.addChild(node);
node.setSiblingIndex(0);   // EditorApp.onLoad runs before the game's components
const App = cc.js.getClassByName('EditorApp');
if (!App) throw new Error('EditorApp script not compiled yet');
node.addComponent(App);
await new Promise(r => setTimeout(r, 50));
return scene.children.map(n => n.name);
