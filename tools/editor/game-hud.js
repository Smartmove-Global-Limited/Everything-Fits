// Builds the gameplay HUD (Canvas/Hud + Field/BagHint) inside the open Game.scene, with the exact
// boxes measured from the web game DOM at 420×760 (snug, html[data-art=cozy]). Safe to re-run.
// Run: node tools/run-in-editor.mjs tools/editor/game-hud.js   then save the scene.
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const FONT_XB = '277c3683-52ba-4f39-8bb4-d8d8d588c412';   // Baloo 2 ExtraBold (web weight 800)
const FONT_NUNITO = '688fc403-0a39-4b62-89b3-89e589281361'; // Nunito Bold (toast)
const FONT_SB = '69aeb3fb-5831-4bcc-a8d1-38892fa0b4af';    // Baloo 2 SemiBold (bag hint, web weight 600)
const load = uuid => new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const frameOf = async rel => {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/art/ui', rel + '.meta'), 'utf8'));
  const sub = Object.values(meta.subMetas).find(s => s.importer === 'sprite-frame');
  return load(sub.uuid);
};
const C = (hex, a = 255) => new cc.Color(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a);
const INK = C('#35413F'), CREAM = C('#FFF8E9');

const scene = cc.director.getScene();
const canvas = scene.getChildByName('Canvas');
const field = canvas.getChildByName('Field');
canvas.getChildByName('Hud')?.destroy();
field.getChildByName('BagHint')?.destroy();
await new Promise(r => setTimeout(r, 50));
const layer = canvas.layer;
const fontXB = await load(FONT_XB), fontNunito = await load(FONT_NUNITO), fontSB = await load(FONT_SB);
// Label boxes below are raised a few px over the web box: Baloo 2 sits low in a Cocos line box
// (measured against web screenshots: glyphs land at the same pixels).
const cls = name => cc.js.getClassByName(name);

// web rect [x, y, w, h] (top-left origin, y down) → centre in Canvas space
const centre = r => [r[0] + r[2] / 2 - 210, 380 - (r[1] + r[3] / 2)];
/** node from a web rect, positioned relative to its parent's web rect */
function box(name, parent, r, parentRect) {
  const n = new cc.Node(name); n.layer = layer; parent.addChild(n);
  n.addComponent(cc.UITransform).setContentSize(r[2], r[3]);
  const [x, y] = centre(r);
  if (parentRect) { const [px, py] = centre(parentRect); n.setPosition(x - px, y - py, 0); } else n.setPosition(x, y, 0);
  return n;
}
function panel(n, o) {
  n.addComponent(cc.Graphics);
  const rr = n.addComponent(cls('RoundRect'));
  rr.fill = o.fill; rr.radius = o.radius;
  if (o.border) { rr.borderWidth = o.border; rr.borderColor = o.borderColor || o.fill; }
  if (o.lip) { rr.lip = o.lip; rr.lipColor = o.lipColor; }
  if (o.shadowBlur) { rr.shadowY = o.shadowY; rr.shadowBlur = o.shadowBlur; rr.shadowColor = o.shadowColor; }
  return rr;
}
async function image(n, rel) {
  const s = n.addComponent(cc.Sprite);
  s.sizeMode = cc.Sprite.SizeMode.CUSTOM; s.trim = false;
  s.spriteFrame = await frameOf(rel);
  return s;
}
function text(n, str, size, color, font = fontXB, align = cc.Label.HorizontalAlign.CENTER) {
  const l = n.addComponent(cc.Label);
  l.font = font; l.useSystemFont = false; l.string = str;
  l.fontSize = size; l.lineHeight = Math.round(size * 1.15);
  l.color = color; l.horizontalAlign = align; l.verticalAlign = cc.Label.VerticalAlign.CENTER;
  l.overflow = cc.Label.Overflow.NONE; l.enableWrapText = false;
  return l;
}

const hudRect = [0, 0, 420, 760];
const hud = box('Hud', canvas, hudRect);
// HUD sits right after the Field (above the play area)
hud.setSiblingIndex(canvas.children.indexOf(field) + 1);

// ---- top row (web .efh-top / .efh-timerwrap) ----
const lvR = [21, 28, 80, 31];
const lv = box('LevelPill', hud, lvR, hudRect);
panel(lv, { fill: C('#E9DEC5', 235), radius: 15.5 });
const lvText = text(box('Text', lv, [21, 26.5, 80, 31], lvR), 'Lv. 1', 17.5, INK);

const tR = [158, 24, 103, 39];
const timer = box('Timer', hud, tR, hudRect);
panel(timer, { fill: CREAM, radius: 14.6 });
await image(box('Icon', timer, [163, 29, 29, 29], tR), 'icons/timer.webp');
const tText = text(box('Text', timer, [190, 21, 68, 39], tR), '00:00', 20.4, INK);
tText.spacingX = 1.6;   // web: font-variant-numeric tabular-nums (wider digits)

const sR = [284, 29, 74, 29];
const shake = box('ShakePill', hud, sR, hudRect);
const shakeFace = panel(shake, { fill: CREAM, radius: 14.5 });
const sIcR = [287, 32, 23, 23];
const shakeIc = box('Icon', shake, sIcR, sR);
const shakeIcon = await image(shakeIc, 'icons/shake.webp');
const shakeLock = box('Lock', shakeIc, [296, 41, 14, 14], sIcR);
await image(shakeLock, 'icons/lock.webp');
shakeLock.active = false;
const barR = [314, 40, 35, 8];
const bar = box('Bar', shake, barR, sR);
panel(bar, { fill: C('#D7D5D1'), radius: 4 });
const fill = box('Fill', bar, barR, barR);
const fillUi = fill.getComponent(cc.UITransform); fillUi.setAnchorPoint(0, .5); fill.setPosition(-17.5, 0, 0);
const shakeFill = panel(fill, { fill: C('#8C7AD0'), radius: 4 });

const gR = [366, 24, 39, 39];
const gear = box('Gear', hud, gR, hudRect);
panel(gear, { fill: CREAM, radius: 15.5 });
await image(box('Icon', gear, [372, 30, 27, 27], gR), 'menu/gear.webp');

// ---- booster dock (web .efh-dock .efb) ----
const boosters = [];
const defs = [['Freeze', 'icons/freeze.webp', 66], ['Resize', 'icons/resize.webp', 167], ['Throw out', 'icons/throw.webp', 268]];
for (const [name, icon, x] of defs) {
  const bR = [x, 639, 86, 88];
  const b = box('Booster' + name.replace(' ', ''), hud, bR, hudRect);
  const face = panel(b, { fill: CREAM, radius: 19.4, border: 1.3, borderColor: CREAM, lip: 2.9, lipColor: C('#E2D6BC'),
    shadowY: 3.9, shadowBlur: 5.8, shadowColor: new cc.Color(71, 77, 64, 46) });
  const ic = await image(box('Icon', b, [x + 19.5, 646, 47, 47], bR), icon);
  const nm = text(box('Name', b, [x, 699.5, 86, 13], bR), name, 11.7, INK);
  const lock = box('Lock', b, [x + 25, 648, 36, 36], bR);
  await image(lock, 'icons/lock.webp'); lock.active = false;
  const lockLv = text(box('LockLevel', b, [x, 688, 86, 16], bR), 'Lv. 3', 14, INK); lockLv.node.active = false;
  const badgeR = [x + 61, 634, 21, 21];
  const badge = box('Badge', b, badgeR, bR);
  panel(badge, { fill: C('#BD6D69'), radius: 10.5, border: 2, borderColor: CREAM });
  const bt = text(box('Count', badge, [x + 61, 635, 21, 21], badgeR), '0', 12.6, CREAM);
  const BB = cls('BoosterButton');
  const entry = new BB();
  entry.root = b; entry.face = face; entry.icon = ic; entry.title = nm; entry.badge = badge; entry.badgeText = bt; entry.lock = lock; entry.lockLevel = lockLv;
  boosters.push(entry);
}

// ---- toast (web .hint: pill in the middle, rgba(90,58,34,.85), Nunito 700) ----
const toastR = [72, 280, 276, 31];
const toast = box('Toast', hud, toastR, hudRect);
panel(toast, { fill: new cc.Color(90, 58, 34, 217), radius: 15.5 });
toast.addComponent(cc.UIOpacity).opacity = 0;
const toastText = text(box('Text', toast, toastR, toastR), '', 12.5, CREAM, fontNunito);

// ---- bag hint, drawn over the bag body, under the items (web bags.js drawEmptyLabel) ----
const hint = new cc.Node('BagHint'); hint.layer = layer;
field.insertChild(hint, field.children.indexOf(field.getChildByName('ItemLayer')));
hint.addComponent(cc.UITransform).setContentSize(300, 24);
const hintLabel = text(hint, 'Pack your things here!', 15, new cc.Color(0x8A, 0x73, 0x58, 140), fontSB);
hint.active = false;

// ---- component + wiring ----
const view = hud.addComponent(cls('GameHud'));
view.levelLabel = lvText; view.timerLabel = tText;
view.shakePill = shake; view.shakeFace = shakeFace; view.shakeIcon = shakeIcon; view.shakeLock = shakeLock; view.shakeFill = shakeFill;
view.gear = gear; view.boosters = boosters;
view.toast = toast; view.toastText = toastText; view.bagHint = hintLabel;
const ctrl = canvas.getChildByName('GameController').getComponent(cls('GameController'));
ctrl.hud = view;

return hud.children.map(c => `${c.name} @${c.position.x.toFixed(1)},${c.position.y.toFixed(1)}`);
