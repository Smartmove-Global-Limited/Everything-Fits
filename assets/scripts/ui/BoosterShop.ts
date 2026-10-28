// Booster shop popup (gameplay: a booster with none left was tapped). Short, like the other popups:
// the player's gold top-left, X top-right, "More boosters", then the Shop's Spend Gold tiles
// (three of a booster for gold) and the Booster Bundle (money). What is bought goes to the stock:
// nothing is used until the player taps the booster. Built once per scene from the
// Shop's and the Shake popup's own nodes (same Figma look), never from the whole Shop page.
// GameController stops the clock while it is open.
import { Node, Graphics, UITransform, BlockInputEvents, Layers, Color, Vec3, instantiate, director, tween, Tween } from 'cc';
import { findNode, findAll, setText, labelIn, tap, openPopup, closePopup, centerOnParent, centerContent } from './UiKit';
import { Overlays } from './Overlays';
import { SPEND } from './ShopScreen';
import { Wallet, formatNumber } from '../services/Wallet';
import { Purchases, product, BuyResult } from '../services/Purchases';
import { Boosters } from '../services/Boosters';
import { Sound } from '../audio/Sound';

const NAME = 'BoosterShop';
const BUNDLE_ID = 'fit.booster.bundle.3';
const SPEND_IDS = ['spend_freeze', 'spend_resize', 'spend_throw'];
const CARD_W = 366, PAD = 14, GAP = 10;
const DIM = new Color(0x35, 0x41, 0x3F, 122);   // the popups' dark veil (ShakePopup root)
const FAIL: Record<string, string> = {
  cancelled: 'Purchase cancelled', pending: 'Payment pending. It arrives once confirmed.',
  unavailable: 'Store unavailable. Try again later.', error: 'Purchase failed. Try again later.',
};

type View = { root: Node; card: Node; gold: Node; goldPill: Node; bundleBuy: Node; enables: ((on: boolean) => void)[] };
let view: View | null = null;
let onClosed: (() => void) | null = null;
let busy = false;
let offGold: (() => void) | null = null;

/** Open the popup; `onClose` runs once it is closed */
export async function openBoosterShop(onClose: () => void) {
  onClosed = onClose;
  if (!view || !view.root.isValid) view = await build();
  const v = view;
  v.root.setSiblingIndex(v.root.parent!.children.length - 1);
  showGold(v);
  offGold?.(); offGold = Wallet.onChange(() => showGold(v));
  setText(v.bundleBuy, Purchases.price(BUNDLE_ID));
  fitPrice(v.bundleBuy);
  Sound.play('menuOpen');
  openPopup(v.root, v.card);
}

function close() {
  if (!view || busy) return;
  offGold?.(); offGold = null;
  Sound.play('menuClose');
  closePopup(view.root, () => { const f = onClosed; onClosed = null; f?.(); });
}

async function build(): Promise<View> {
  const [shopT, popT] = await Promise.all([Overlays.loadPrefab('ui/ShopScreen'), Overlays.loadPrefab('ui/ShakePopup')]);
  // templates: instantiated but never added to the scene (their components never start)
  const shop = instantiate(shopT), pop = instantiate(popT);
  const canvas = director.getScene()!.getChildByName('Canvas')!;

  const root = new Node(NAME); root.layer = Layers.Enum.UI_2D; canvas.addChild(root);
  root.addComponent(UITransform).setContentSize(4000, 4000);
  const veil = root.addComponent(Graphics); veil.fillColor = DIM; veil.rect(-2000, -2000, 4000, 4000); veil.fill();
  root.addComponent(BlockInputEvents);

  // the Shake popup's card, emptied but for its X and title
  const card = findNode(pop, 'efp-card')!;
  for (const c of card.children.slice()) if (c.name !== '__skin' && c.name !== 'shakeX' && c.name !== 'efp-title' && c.name !== 'efl-sub') c.destroy();
  card.removeFromParent(); root.addChild(card);
  const x = findNode(card, 'shakeX')!, title = findNode(card, 'efp-title')!, sub = findNode(card, 'efl-sub')!;
  setText(title, 'More boosters');
  setText(sub, 'Buy with gold or get a bundle');

  // gold pill (the Shop's, without its "+")
  const goldPill = findNode(shop, 'sGold')!.parent!;
  findNode(goldPill, 'sAddGold')!.active = false;
  goldPill.removeFromParent(); card.addChild(goldPill);
  const gold = findNode(goldPill, 'sGold')!;

  // the Shop's Spend Gold tiles and Booster Bundle, a little smaller to fit the card
  const list = findNode(shop, 'shopList')!;
  const grid = findAll(list, 'efs-grid').pop()!;               // the last grid: Spend Gold
  const bundle = findAll(list, 'efs-card').find(c => labelIn(findNode(c, 'h3'))?.string === 'Booster Bundle')!;
  const k = (CARD_W - PAD * 2) / grid.getComponent(UITransform)!.width;
  for (const n of [grid, bundle]) { n.removeFromParent(); card.addChild(n); n.setScale(k, k, 1); }

  // texts and prices from the catalogue (as the Shop draws them)
  const enables: ((on: boolean) => void)[] = [];
  grid.children.filter(c => c.name === 'efs-card').forEach((tile, i) => {
    const id = SPEND_IDS[i], s = SPEND[id]; if (!s) return;
    setText(findNode(tile, 'b'), s.name); centerOnParent(findNode(tile, 'b'));
    const buy = findNode(tile, 'efs-buy')!;
    setText(buy, formatNumber(s.price)); centerContent(buy);
    enables.push(tap(buy, () => spendGold(id, tile), 'tap'));
  });
  const p = product(BUNDLE_ID)!;
  const left = findNode(bundle, 'efs-bundle-left');
  if (left && p.gold) setText(findNode(left, 'b'), formatNumber(p.gold));
  for (const bst of findAll(bundle, 'efs-bst')) setText(findNode(bst, 'small'), `×${p.boosters}`);
  const bundleBuy = findNode(bundle, 'efs-buy')!;
  enables.push(tap(bundleBuy, () => buyBundle(), 'tapBig'));

  // layout, top to bottom
  const h = (n: Node, s = 1) => n.getComponent(UITransform)!.height * s;
  const pillH = h(goldPill), parts: [Node, number, number][] = [   // node, height, gap after
    [goldPill, pillH, 6], [title, h(title), 2], [sub, h(sub), GAP], [grid, h(grid, k), GAP], [bundle, h(bundle, k), 0],
  ];
  const cardH = PAD * 2 + parts.reduce((s, [, ph, g]) => s + ph + g, 0);
  const cu = card.getComponent(UITransform)!;
  cu.setContentSize(CARD_W, cardH);
  let y = cardH / 2 - PAD;
  for (const [n, ph, g] of parts) {
    if (n !== goldPill) n.setPosition(0, y - ph / 2, 0);
    y -= ph + g;
  }
  goldPill.setPosition(-CARD_W / 2 + PAD + goldPill.getComponent(UITransform)!.width / 2, cardH / 2 - PAD - pillH / 2, 0);
  const xu = x.getComponent(UITransform)!;
  x.setPosition(CARD_W / 2 - PAD - xu.width / 2, cardH / 2 - PAD - pillH / 2, 0);
  tap(x, () => close(), null);   // after placing it: tap() keeps the button's resting height; close() plays the menu-close sound
  shop.destroy(); pop.destroy();
  root.active = false;
  return { root, card, gold, goldPill, bundleBuy, enables };
}

/** Amount on the pill; the pill hugs coin + amount and keeps its left edge */
function showGold(v: View) {
  setText(v.gold, formatNumber(Wallet.gold));
  const l = labelIn(v.gold)!; l.updateRenderData(true);
  const pill = v.goldPill, pu = pill.getComponent(UITransform)!, coin = findNode(pill, 'img')!;
  const cw = coin.getComponent(UITransform)!.width, tw = l.node.getComponent(UITransform)!.width;
  const w = 8 + cw + 7 + tw + 12, left = pill.position.x - pu.width / 2;
  pu.width = w;
  pill.setPosition(left + w / 2, pill.position.y, 0);
  coin.setPosition(-w / 2 + 8 + cw / 2, coin.position.y, 0);
  const au = v.gold.getComponent(UITransform)!; au.width = tw;
  v.gold.setPosition(-w / 2 + 8 + cw + 7 + tw * au.anchorX, v.gold.position.y, 0);
  l.node.setPosition((l.node.getComponent(UITransform)!.anchorX - au.anchorX) * tw, l.node.position.y, 0);
}

/** A price button as wide as its text plus padding, centred where it was */
const priceBase = new Map<Node, number>();
function fitPrice(btn: Node) {
  const l = labelIn(btn), u = btn.getComponent(UITransform);
  if (!l || !u) return;
  if (!priceBase.has(btn)) priceBase.set(btn, u.width);
  l.updateRenderData(true);
  u.width = Math.max(priceBase.get(btn)!, l.node.getComponent(UITransform)!.width + 36);
}

function lock(on: boolean) { busy = on; for (const e of view?.enables || []) e(!on); }

function spendGold(id: string, tile: Node) {
  const s = SPEND[id];
  if (busy || !s) return;
  if (Wallet.gold < s.price) { Sound.play('nope'); Overlays.toast('Not enough gold'); return; }
  Wallet.add(-s.price);
  Boosters.add(s.key, 3);
  Sound.play('purchase', { gain: .6 });
  Overlays.toast(`${s.name} added!`);
  pop(tile);
}

async function buyBundle() {
  if (busy || !view) return;
  const btn = view.bundleBuy, label = labelIn(btn)!, before = label.string;
  lock(true);
  label.string = '…';
  let r: BuyResult = 'error';
  try { r = await Purchases.buy(BUNDLE_ID); } catch { r = 'error'; }
  label.string = before;
  lock(false);
  if (r === 'ok') {
    Sound.play('purchase', { gain: .7 });
    Overlays.toast(`${product(BUNDLE_ID)!.name} added!`);
    pop(btn.parent!);
  } else Overlays.toast(FAIL[r] || FAIL.error);
}

/** Little bounce on what was just bought */
function pop(n: Node) {
  const s = n.scale.clone();
  Tween.stopAllByTarget(n);
  tween(n).to(.1, { scale: new Vec3(s.x * 1.06, s.y * 1.06, 1) }).to(.16, { scale: s }, { easing: 'backOut' }).start();
}
