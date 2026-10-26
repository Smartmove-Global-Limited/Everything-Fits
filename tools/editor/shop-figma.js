// Shop + Home prefabs to the Figma "EF · Shop catalogue / Full review" (#204:450) and the
// three-tab navigation (Shop · Home · Coming Soon, #185:342):
//   - gold packs: their own art (coin stacks, cloth pouch, small chest, overflowing chest)
//   - bundle cards: Figma colours, the "reward backdrop" decor behind the rewards, the boosters in
//     one soft box (icon + ×N side by side), art on the left, Figma places (card 144 high)
//   - bottom bar: a third tab "Coming Soon" with the lock art (ShopScreen / HomeScreen show the toast)
// Art: assets/resources/uiart/shop (exported from Figma). Keeps the prefabs' uuids. Safe to re-run.
//   node tools/run-in-editor.mjs tools/editor/shop-figma.js
const fs = require('fs'), path = require('path');
const ROOT = Editor.Project.path;
const load = uuid => new Promise((ok, fail) => cc.assetManager.loadAny(uuid, (e, a) => (e ? fail(e) : ok(a))));
const frameOf = async rel => {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/resources/uiart', rel + '.meta'), 'utf8'));
  return load(Object.values(meta.subMetas).find(s => s.importer === 'sprite-frame').uuid);
};
const C = (hex, a = 255) => new cc.Color(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a);
const find = (n, name) => { if (n.name === name) return n; for (const c of n.children) { const r = find(c, name); if (r) return r; } return null; };
const findAll = (n, name, out = []) => { if (n.name === name) out.push(n); n.children.forEach(c => findAll(c, name, out)); return out; };
const label = n => n && (n.getComponent(cc.Label) || n.getComponentInChildren(cc.Label));
const setText = (n, s) => { const l = label(n); if (l) l.string = s; };
const text = n => label(n)?.string ?? '';
const ui = n => n.getComponent(cc.UITransform);
const unlink = n => { n._prefab = null; n.children.forEach(unlink); };
const report = [];

async function openPrefab(url) {
  const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
  const root = cc.instantiate(await load(info.uuid));
  unlink(root);
  return root;
}
async function savePrefab(root, url) {
  const scene = cc.director.getScene();
  const before = new Set(scene.children);
  scene.addChild(root); root.setPosition(0, 0, 0);
  const tmpUrl = url.replace(/\.prefab$/, '.__new.prefab');
  await Editor.Message.request('scene', 'create-prefab', root.uuid, tmpUrl);
  const tmp = await Editor.Message.request('asset-db', 'query-asset-info', tmpUrl);
  await Editor.Message.request('asset-db', 'save-asset', url, fs.readFileSync(tmp.file, 'utf8'));
  await Editor.Message.request('asset-db', 'delete-asset', tmpUrl);
  await new Promise(r => setTimeout(r, 300));
  for (const n of scene.children.slice()) if (!before.has(n)) n.destroy();
}
/** Sprite showing `frame` inside a w×h box, keeping the picture's proportions */
function fitSprite(node, frame, w, h) {
  const sp = node.getComponent(cc.Sprite);
  sp.spriteFrame = frame; sp.sizeMode = cc.Sprite.SizeMode.CUSTOM; sp.trim = true;
  const r = frame.rect, k = Math.min(w / r.width, h / r.height);
  ui(node).setContentSize(r.width * k, r.height * k);
}

// ================= Shop =================
const SHOP = 'db://assets/resources/ui/ShopScreen.prefab';
const shop = await openPrefab(SHOP);
const list = find(shop, 'shopList');
const K = ui(list).width / 384;                       // Figma card width 384 → ours
/** Figma box (x, y, w, h from the card's top-left, card 384×144) → node place in the card */
const CARD_H = 144;
const place = (node, x, y, w, h) => {
  ui(node).setContentSize(w * K, h * K);
  node.setPosition((x + w / 2 - 192) * K, (CARD_H / 2 - (y + h / 2)) * K, 0);
};

// ---- gold packs: own art, Figma box 78×72 at the top of the card ----
const grids = list.children.filter(c => c.name === 'efs-grid');
const packs = ['500', '1500', '3500', '8000', '18000', '40000'];
for (let i = 0; i < packs.length; i++) {
  const card = grids[0].children[i], img = find(card, 'efs-coins');
  fitSprite(img, await frameOf(`shop/gold_${packs[i]}.webp`), 80 * K, 74 * K);
  img.setPosition(0, 28, 0);
}
report.push('gold pack art');

// ---- bundle cards ----
const STYLE = {
  // Figma #204:506: warm cream card, red-brown title, the badge on a blush backing, solid cream box
  'No Ads Bundle': { fill: '#FFF3DF', border: '#C98570', decor: null, art: null, title: '#81483D', boxFill: '#F4E9D3',
    emblem: { fill: '#F4D7C8', box: [12, 40, 76, 62] }, badgeBox: [26, 47, 48, 48],
    shadow: { y: 3, blur: 3, color: [116, 81, 60, 41] } },
  // Figma #395:184: 3 of each booster, no gold: no picture, the boosters in one wide box
  'Booster Bundle': { fill: '#E1E9DC', border: '#91A88F', decor: null, art: 'gold_500', artBox: [20, 42, 58, 58], boxFill: '#F8F5E8' },
  // Figma: the light-streak backdrop is gone, plain card colours only; the picture a little in
  // from the left edge and under the title, its amount centred under it
  'Small Bundle': { fill: '#DFE6CE', border: '#8D9D7C', decor: null, art: 'gold_500', artBox: [20, 42, 58, 58] },
  'Medium Bundle': { fill: '#A7BF9C', border: '#8D9D7C', decor: null, art: 'gold_18000', artBox: [18, 40, 64, 60] },
  'Ultra Bundle': { fill: '#E8BB62', border: '#B78337', decor: null, art: 'gold_40000', artBox: [18, 40, 64, 60] },
};
const BOX_FILL = C('#FFFAE8', 140), INK2 = C('#293630'), INK = C('#35413F');
/** `over` (with its alpha) painted on `under`, as one solid colour */
const mix = (under, over) => { const a = over.a / 255; return new cc.Color(Math.round(over.r * a + under.r * (1 - a)), Math.round(over.g * a + under.g * (1 - a)), Math.round(over.b * a + under.b * (1 - a)), 255); };
const resized = new Map();                            // card → old height
for (const card of list.children.filter(c => c.name === 'efs-card')) {
  const st = STYLE[text(find(card, 'h3'))]; if (!st) continue;
  const oldH = ui(card).height;
  ui(card).setContentSize(ui(card).width, CARD_H * K);
  resized.set(card, oldH);
  const rr = card.getComponent('RoundRect');
  rr.fill = C(st.fill); rr.borderColor = C(st.border); rr.borderWidth = 1; rr.radius = 20 * K;
  if (st.shadow) { rr.shadowY = st.shadow.y; rr.shadowBlur = st.shadow.blur; rr.shadowColor = new cc.Color(...st.shadow.color); }
  // reward backdrop (Figma "Decor / Bundle reward backdrop"), behind everything else
  let decor = card.getChildByName('efs-backdrop');
  if (!decor) {
    decor = new cc.Node('efs-backdrop'); decor.layer = card.layer;
    card.insertChild(decor, 0); decor.addComponent(cc.UITransform); decor.addComponent(cc.Sprite);
  }
  decor.active = !!st.decor;
  if (st.decor) {
    const sp = decor.getComponent(cc.Sprite);
    sp.spriteFrame = await frameOf(`shop/backdrop_${st.decor}.webp`); sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    place(decor, 0, 38, 384, 66);
  }
  // title, top-left
  const h3 = find(card, 'h3');
  h3.setPosition(h3.position.x, (CARD_H / 2 - 24) * K, 0);
  label(h3).color = st.title ? C(st.title) : INK;   // Figma: dark ink (No Ads: red-brown)
  // body and its left column now in card space
  const body = find(card, 'efs-bundle-body'), left = find(card, 'efs-bundle-left'), bsts = find(card, 'efs-bsts');
  body.setPosition(0, 0, 0); ui(body).setContentSize(ui(card).width, CARD_H * K);
  left.setPosition(0, 0, 0); ui(left).setContentSize(ui(card).width, CARD_H * K);
  const art = left.children.find(c => c.getComponent(cc.Sprite));
  const amount = find(left, 'b');
  // a soft backing panel behind the picture (No Ads)
  let emblem = left.getChildByName('efs-emblem');
  if (st.emblem && !emblem) {
    emblem = new cc.Node('efs-emblem'); emblem.layer = left.layer;
    left.insertChild(emblem, 0); emblem.addComponent(cc.UITransform); emblem.addComponent(cc.Graphics); emblem.addComponent('RoundRect');
  }
  if (emblem) {
    emblem.active = !!st.emblem;
    if (st.emblem) {
      place(emblem, ...st.emblem.box);
      const er = emblem.getComponent('RoundRect'); er.fill = C(st.emblem.fill); er.radius = 14 * K; er.borderWidth = 0;
    }
  }
  art.active = !st.noArt;
  if (st.noArt) amount.active = false;
  else if (st.art) {
    const [x, y, w, h] = st.artBox;
    place(art, x, y, w, h);
    fitSprite(art, await frameOf(`shop/${st.art}.webp`), w * K, h * K);
    // the amount a little under the picture (Figma has it touching), centred on it
    place(amount, x + w / 2 - 45, 106, 90, 18);
    label(amount).horizontalAlign = cc.Label.HorizontalAlign.CENTER; ui(label(amount).node).anchorX = .5;
    if (label(amount).node !== amount) label(amount).node.setPosition(0, label(amount).node.position.y, 0);
    label(amount).color = INK;
    amount.active = !st.noAmount;
  } else {
    place(art, ...(st.badgeBox || [16, 46, 50, 50]));   // No Ads badge, no text under it
    amount.active = false;
  }
  // boosters: one soft box, icon + ×N side by side (Figma "Rewards / Booster cluster")
  // a compact box hugging the three boosters, in the free space right of the picture (centred
  // on the card when there is no picture); solid, so the backdrop's light streaks stay outside it
  const BOX_W = 206, BOX_H = 56, boxX = st.noArt ? (384 - BOX_W) / 2 : 132;
  place(bsts, boxX, 40, BOX_W, BOX_H);
  let box = bsts.getComponent('RoundRect');
  if (!box) { if (!bsts.getComponent(cc.Graphics)) bsts.addComponent(cc.Graphics); box = bsts.addComponent('RoundRect'); }
  box.fill = st.boxFill ? C(st.boxFill) : mix(C(st.fill), BOX_FILL); box.radius = 14 * K; box.borderWidth = 0;
  const step = 64 * K;
  findAll(bsts, 'efs-bst').forEach((b, i) => {
    const f = b.getComponent('RoundRect');
    if (f) { f.fill = C('#FFFFFF', 0); f.borderWidth = 0; f.shadowY = 0; f.shadowBlur = 0; f.lip = 0; }
    ui(b).setContentSize(56 * K, 54 * K);
    b.setPosition((i - 1) * step, 0, 0);
    const img = find(b, 'img'), small = find(b, 'small');
    // the count sits low at the icon's bottom-right corner (store style), not beside it
    ui(img).setContentSize(40 * K, 40 * K); img.setPosition(-5 * K, 3 * K, 0);
    ui(small).setContentSize(24 * K, 18 * K); small.setPosition(17 * K, -14 * K, 0);
    const l = label(small); l.fontSize = 15; l.lineHeight = 18; l.color = INK2;
  });
  // buy button, bottom-right
  const buy = card.children.find(c => c.name === 'efs-buy');
  place(buy, 247, 100, 122, 34);              // 34 high: see buy buttons below
  report.push(`${text(h3)}: ${oldH.toFixed(1)} → ${(CARD_H * K).toFixed(1)}`);
}
// ---- section headers: taller ribbon, soft rim, ornaments (line + diamond) beside the title ----
const SEC_H = 34;
for (const sec of list.children.filter(c => c.name === 'efs-sec')) {
  const oldH = ui(sec).height;
  if (Math.abs(oldH - SEC_H) > .5) { ui(sec).height = SEC_H; resized.set(sec, oldH); }
  const rr = sec.getComponent('RoundRect');
  rr.fill = C('#536F5B'); rr.radius = SEC_H / 2; rr.borderWidth = 1.5; rr.borderColor = C('#6F8A75');
  rr.shadowY = 2; rr.shadowBlur = 2; rr.shadowColor = new cc.Color(46, 51, 41, 46);
  const l = label(sec); l.fontSize = 15; l.lineHeight = 18; l.color = C('#FFF8E9');
  // centred title (the web dump anchored the text run at its left)
  l.horizontalAlign = cc.Label.HorizontalAlign.CENTER; ui(l.node).anchorX = .5;
  l.node.setPosition(0, 1, 0);
  l.updateRenderData(true);
  const tw = ui(l.node).width;
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'orn-l' : 'orn-r';
    let o = sec.getChildByName(name);
    if (!o) {
      o = new cc.Node(name); o.layer = sec.layer; sec.addChild(o); o.addComponent(cc.UITransform);
      for (const part of ['line', 'dot']) {
        const n = new cc.Node(part); n.layer = sec.layer; o.addChild(n); n.addComponent(cc.UITransform);
        n.addComponent(cc.Graphics); n.addComponent('RoundRect');
      }
    }
    o.setPosition(side * (tw / 2 + 12), 1, 0);
    const line = o.getChildByName('line'), dot = o.getChildByName('dot');
    ui(line).setContentSize(34, 2); line.setPosition(side * 26, 0, 0);
    const lr = line.getComponent('RoundRect'); lr.fill = C('#FFF8E9', 110); lr.radius = 1; lr.borderWidth = 0;
    ui(dot).setContentSize(7, 7); dot.setPosition(side * 4, 0, 0); dot.angle = 45;
    const dr = dot.getComponent('RoundRect'); dr.fill = C('#F6D776'); dr.radius = 1.2; dr.borderWidth = 0;
  }
}
report.push('section headers ' + SEC_H + ' high');

// the list closes up under the shorter cards (top edge kept)
const kids = list.children.slice().sort((a, b) => b.position.y - a.position.y);
let shift = 0;
for (const c of kids) {
  if (resized.has(c)) {
    const oldH = resized.get(c), top = c.position.y + oldH / 2 + shift;
    c.setPosition(c.position.x, top - ui(c).height / 2, 0);
    shift += oldH - ui(c).height;
  } else c.setPosition(c.position.x, c.position.y + shift, 0);
}
if (Math.abs(shift) > .01) {
  ui(list).height -= shift;
  list.setPosition(list.position.x, list.position.y + shift / 2, 0);
  for (const c of list.children) c.setPosition(c.position.x, c.position.y - shift / 2, 0);
  ui(list.parent).height -= shift;
  report.push(`list −${shift.toFixed(1)}`);
}

// ---- buy buttons: taller pills (they read long and flat at 28–29 high) ----
const BUY_H = 34;
for (const b of findAll(list, 'efs-buy')) {
  const u = ui(b), grow = BUY_H - u.height;
  if (Math.abs(grow) < .5) continue;
  u.height = BUY_H;
  b.setPosition(b.position.x, b.position.y - grow / 2, 0);       // keeps its top edge
  const rr = b.getComponent('RoundRect'); if (rr) rr.radius = BUY_H / 2;
  const l = label(b); if (l && l.fontSize < 17) { l.fontSize = 17; l.lineHeight = 20; }
}
report.push('buy buttons ' + BUY_H + ' high');

// ================= three-tab bar (Shop and Home) =================
const lock = await frameOf('icons/lock.webp');
async function threeTabs(root, prefix) {
  const nav = find(root, 'efm-nav');
  const shopTab = find(nav, prefix + 'TabShop'), homeTab = find(nav, prefix + 'TabHome');
  let soon = find(nav, prefix + 'TabSoon');
  if (!soon) {
    // a copy of the tab that is not highlighted on this screen
    const lit = t => { const rr = t.getComponent('RoundRect'); return !!rr && rr.fill.a > 0 && rr.fill.toHEX() === 'd4e5ce'; };
    const plain = lit(shopTab) ? homeTab : shopTab;
    soon = cc.instantiate(plain); unlink(soon); soon.name = prefix + 'TabSoon';
    const rr = soon.getComponent('RoundRect'); if (rr) rr.fill = C('#FFF8E9', 0);
    nav.addChild(soon);
  }
  const w = ui(nav).width / 3;
  [shopTab, homeTab, soon].forEach((t, i) => { ui(t).width = w; t.setPosition((i - 1) * w, t.position.y, 0); });
  const img = find(soon, 'img');
  const sp = img.getComponent(cc.Sprite); sp.spriteFrame = lock;
  setText(find(soon, 'span'), 'Coming Soon');
  report.push(`${prefix}: three tabs ${w.toFixed(1)} wide`);
}
await threeTabs(shop, 's');
await savePrefab(shop, SHOP);

const HOME = 'db://assets/resources/ui/HomeScreen.prefab';
const home = await openPrefab(HOME);
await threeTabs(home, 'm');
await savePrefab(home, HOME);
return report;
