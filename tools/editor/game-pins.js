// Game.scene on screens taller / wider than 420×760: top HUD row pinned to the screen top (below
// the status bar), booster dock to the bottom (above the navigation bar), background bands filled
// with the picture's edge rows. Run with Game.scene open, then save. Safe to re-run.
const canvas = cc.director.getScene().getChildByName('Canvas');
const hud = canvas.getChildByName('Hud');
const EdgePin = cc.js.getClassByName('EdgePin'), Bleed = cc.js.getClassByName('BackgroundBleed');
const pin = (n, mode) => { const p = n.getComponent(EdgePin) || n.addComponent(EdgePin); p.mode = mode; p.safeArea = true; };
for (const name of ['LevelPill', 'Timer', 'ShakePill', 'Gear']) pin(hud.getChildByName(name), 0);
for (const n of hud.children) if (n.name.startsWith('Booster')) pin(n, 1);
// The Canvas stays at the design centre instead of following the screen: physics works in world
// space and the Field's origin must stay at world (0, 0). The camera (child of the Canvas) still
// shows the whole screen around it; touches are converted through the camera.
const cv = canvas.getComponent(cc.Canvas);
cv.alignCanvasWithScreen = false;
// its full-stretch Widget would move it back to the visible-area centre at runtime
canvas.getComponent(cc.Widget)?.destroy();
canvas.setPosition(210, 380, 0);
const bg = canvas.getChildByName('Background');
if (!bg.getComponent(Bleed)) bg.addComponent(Bleed);
await new Promise(r => setTimeout(r, 50));
return hud.children.map(n => n.name + (n.getComponent(EdgePin) ? ':' + n.getComponent(EdgePin).mode : ''));
