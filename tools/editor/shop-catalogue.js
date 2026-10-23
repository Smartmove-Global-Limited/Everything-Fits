// Update the Shop prefab to the IAP table (Purchases.ts): a Booster Bundle card above Small Bundle
// (a copy of the Small Bundle card), No Ads Bundle without gold, and the catalogue's texts so the
// prefab looks right in the editor (ShopScreen.ts writes the same values at run time, prices from
// the store). Keeps the prefab's uuid. Safe to run twice: an existing Booster Bundle card is kept.
//   node tools/run-in-editor.mjs tools/editor/shop-catalogue.js
const fs = require('fs');
const url = 'db://assets/resources/ui/ShopScreen.prefab';
const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
const prefab = await new Promise((ok, fail) => cc.assetManager.loadAny(info.uuid, (e, a) => (e ? fail(e) : ok(a))));
const scene = cc.director.getScene();
const root = cc.instantiate(prefab);
(function unlink(n) { n._prefab = null; n.children.forEach(unlink); })(root);   // a plain node tree, rebuilt as the prefab
const find = (n, name) => { if (n.name === name) return n; for (const c of n.children) { const r = find(c, name); if (r) return r; } return null; };
const findAll = (n, name, out = []) => { if (n.name === name) out.push(n); n.children.forEach(c => findAll(c, name, out)); return out; };
const label = n => n && (n.getComponent(cc.Label) || n.getComponentInChildren(cc.Label));
const setText = (n, s) => { const l = label(n); if (l) l.string = s; };
const text = n => label(n)?.string ?? '';
const ui = n => n.getComponent(cc.UITransform);

const list = find(root, 'shopList');
const cards = list.children.filter(c => c.name === 'efs-card');
const titled = t => cards.find(c => text(find(c, 'h3')) === t);
const report = [];

// ---- No Ads Bundle: No Ads + 1 of each booster, no gold ----
const noAdsBundle = titled('No Ads Bundle');
setText(find(find(noAdsBundle, 'efs-bundle-left'), 'b'), 'No Ads');

// ---- Booster Bundle card, above Small Bundle ----
const small = titled('Small Bundle'), medium = titled('Medium Bundle');
if (!titled('Booster Bundle')) {
  const step = small.position.y - medium.position.y;          // card height + gap
  const card = cc.instantiate(small);
  (function unlink(n) { n._prefab = null; n.children.forEach(unlink); })(card);
  setText(find(card, 'h3'), 'Booster Bundle');
  const left = find(card, 'efs-bundle-left');
  setText(find(left, 'b'), 'Worth 1,500');
  // everything from Small Bundle down moves one card lower
  const top = small.position.y + ui(small).height / 2;
  for (const c of list.children) if (c.position.y + ui(c).height / 2 <= top + .5) c.setPosition(c.position.x, c.position.y - step, 0);
  list.insertChild(card, small.getSiblingIndex());
  card.setPosition(small.position.x, small.position.y + step, 0);
  // the list grows downward by one card: keep its top edge, the scroll content grows with it
  const lu = ui(list);
  lu.height += step;
  list.setPosition(list.position.x, list.position.y - step / 2, 0);
  for (const c of list.children) c.setPosition(c.position.x, c.position.y + step / 2, 0);
  const content = list.parent;
  ui(content).height += step;
  report.push('booster bundle added, +' + step.toFixed(1));
}

// ---- texts of the catalogue ----
const goldGrid = list.children.filter(c => c.name === 'efs-grid')[0];
const packs = [500, 1500, 3500, 8000, 18000, 40000], packPrices = ['$0.99', '$2.99', '$5.99', '$9.99', '$19.99', '$39.99'];
goldGrid.children.forEach((c, i) => { setText(find(c, 'b'), packs[i].toLocaleString('en-US')); setText(find(c, 'efs-buy'), packPrices[i]); });
const bundles = { 'No Ads Bundle': [null, 1, '$4.49'], 'Booster Bundle': [null, 3, '$1.99'], 'Small Bundle': [5000, 1, '$3.49'], 'Medium Bundle': [10000, 2, '$6.49'], 'Ultra Bundle': [25000, 3, '$12.99'] };
for (const c of list.children.filter(c => c.name === 'efs-card')) {
  const b = bundles[text(find(c, 'h3'))]; if (!b) continue;
  if (b[0]) setText(find(find(c, 'efs-bundle-left'), 'b'), b[0].toLocaleString('en-US'));
  for (const bst of findAll(c, 'efs-bst')) setText(find(bst, 'small'), '×' + b[1]);
  setText(c.children.find(x => x.name === 'efs-buy'), b[2]);
}
setText(find(cards[0], 'efs-buy'), '$2.99');                     // No Ads
setText(find(cards[1], 'b'), '25');                              // Free Gold
const spendGrid = list.children.filter(c => c.name === 'efs-grid')[1];
[['Freeze ×3', '450'], ['Resize ×3', '450'], ['Throw out ×3', '600']].forEach(([n, p], i) => {
  const c = spendGrid.children[i]; setText(find(c, 'b'), n); setText(find(c, 'efs-buy'), p);
});

// ---- save over the old prefab, keeping its uuid ----
const before = new Set(scene.children);
scene.addChild(root);
root.setPosition(0, 0, 0);
const tmpUrl = 'db://assets/resources/ui/ShopScreen.__new.prefab';
await Editor.Message.request('scene', 'create-prefab', root.uuid, tmpUrl);
const tmp = await Editor.Message.request('asset-db', 'query-asset-info', tmpUrl);
await Editor.Message.request('asset-db', 'save-asset', url, fs.readFileSync(tmp.file, 'utf8'));
await Editor.Message.request('asset-db', 'delete-asset', tmpUrl);
await new Promise(r => setTimeout(r, 300));
for (const n of scene.children.slice()) if (!before.has(n)) n.destroy();
return { report, cards: list.children.filter(c => c.name === 'efs-card').map(c => text(find(c, 'h3')) || text(find(c, 'efs-noads-txt'))) };
