// Remove stray nodes left at the scene root (e.g. by prefab generation): everything that is not the
// Canvas. Run with Game.scene open, then save the scene.
const scene = cc.director.getScene();
const removed = [];
for (const n of scene.children.slice()) {
  if (n.name === 'Canvas' || n.name.startsWith('Editor Scene')) continue;
  removed.push(n.name || '(unnamed)');
  n.destroy();
}
await new Promise(r => setTimeout(r, 50));
return { removed: removed.length, sample: removed.slice(0, 5), left: scene.children.map(n => n.name) };
