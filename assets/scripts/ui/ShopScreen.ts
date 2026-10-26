// Shop (web src/ui/shop.js, Figma "EF · Shop"; catalogue = the IAP table in Purchases.ts):
// No Ads · Free Gold (rewarded ad, once a day) · Gold Packs · No Ads Bundle · Booster Bundle and
// Bundles · Spend Gold · Restore purchases. Prices come from the store. While one purchase runs
// every buy button is locked; the reward is granted by Purchases only once the store confirms.
import { _decorator, Component, Node, ScrollView, Vec2, UITransform, Color, Sprite, Label } from 'cc';
import { findNode, findAll, setText, labelIn, tap, fitGoldPill } from './UiKit';
import { RoundRect } from './RoundRect';
import { Overlays } from './Overlays';
import { Wallet, formatNumber } from '../services/Wallet';
import { Purchases, product, BuyResult } from '../services/Purchases';
import { Boosters, BoosterKey } from '../services/Boosters';
import { FreeGold, FREE_GOLD } from '../services/Daily';
import { Ads } from '../services/Ads';
import { Sound } from '../audio/Sound';
import { ShopFx } from './ShopFx';
const { ccclass } = _decorator;

/** Buy buttons in page order: store product ids, the free gold ad, then the Spend Gold cards */
const BUY_IDS = [
  'fit.remove.ads', 'free_gold',
  'fit.gold.500', 'fit.gold.1500', 'fit.gold.3500', 'fit.gold.8000', 'fit.gold.18000', 'fit.gold.40000',
  'fit.remove.ads.bundle',
  'fit.booster.bundle.3', 'fit.small.bundle', 'fit.medium.bundle', 'fit.ultra.bundle',
  'spend_freeze', 'spend_resize', 'spend_throw',
];
/** Spend Gold: three of a booster for gold (booster economy table: 150 / 150 / 200 gold each) */
const SPEND: Record<string, { key: BoosterKey; name: string; price: number }> = {
  spend_freeze: { key: 'freeze', name: 'Freeze ×3', price: 450 },
  spend_resize: { key: 'resize', name: 'Re:Size ×3', price: 450 },   // names as in the Figma catalogue
  spend_throw: { key: 'throw', name: 'Remove ×3', price: 600 },
};
const PURCHASED_BG = new Color(0x8F, 0xA5, 0x96, 255);

type Buy = { node: Node; enable: (on: boolean) => void; kind: 'money' | 'ad' | 'gold'; id: string };

@ccclass('ShopScreen')
export class ShopScreen extends Component {
  actions: { onHome: () => void; onSettings: () => void } | null = null;
  private gold: Node = null!;
  private scroll: ScrollView = null!;
  private buys: Buy[] = [];
  private busy = false;
  private offs: (() => void)[] = [];
  private fx: ShopFx = null!;
  /** while bought coins fly in, the counter counts up with them instead of jumping */
  private holdGold = false;

  onLoad() {
    const n = this.node;
    this.gold = findNode(n, 'sGold')!;
    this.scroll = findNode(n, 'shopScroll')!.getComponent(ScrollView)!;
    findAll(n, 'efs-buy').forEach((b, i) => {
      const id = BUY_IDS[i]; if (!id) return;
      const kind: Buy['kind'] = id === 'free_gold' ? 'ad' : SPEND[id] ? 'gold' : 'money';
      const buy: Buy = { node: b, enable: () => {}, kind, id };
      buy.enable = tap(b, () => this.onBuy(buy), 'tap', this);
      this.buys.push(buy);
    });
    tap(findNode(n, 'shopRestore'), () => this.restore(), 'tap', this);
    const restore = labelIn(findNode(n, 'shopRestore'));
    if (restore) restore.isUnderline = true;               // web .efs-restore: text-decoration underline
    // web .efs-scroll padding-bottom 20: room under the last row
    const content = this.scroll.content!.getComponent(UITransform)!;
    content.height += 20;
    tap(findNode(n, 'sAddGold'), () => this.scrollToGold(), 'tap', this);
    tap(findNode(n, 'sSettings'), () => this.actions?.onSettings(), 'tap', this);
    tap(findNode(n, 'sTabShop'), () => this.scroll.scrollToTop(.3), 'tap', this);
    tap(findNode(n, 'sTabHome'), () => this.actions?.onHome(), 'tap', this);
    tap(findNode(n, 'sTabSoon'), () => Overlays.comingSoon(findNode(n, 'efm-nav')!), 'tap', this);
    this.offs.push(
      Wallet.onChange(g => { if (!this.holdGold) this.showGold(formatNumber(g)); }),
      Purchases.onPrices(() => this.drawPrices()),
      Purchases.onNoAds(() => this.drawNoAds()),
    );
    this.drawCatalogue();
    // effects: gold pack art (500 → 40,000), bundle artwork, flights above everything
    const grid = findAll(n, 'efs-grid')[0];
    const goldArts = grid ? grid.children.map(c => findNode(c, 'efs-coins')!).filter(Boolean) : [];
    const bundleArts = findAll(n, 'efs-bundle-left').map(l => l.children.find(c => c.active && c.getComponent(Sprite))!).filter(Boolean);
    this.fx = this.node.addComponent(ShopFx);
    this.fx.setup(goldArts, bundleArts, this.node, [findNode(n, 'efs-noads-ic'), findNode(n, 'efs-gift')].filter(Boolean) as Node[]);
  }
  /** Amount on the gold pill, the pill hugging it */
  private showGold(text: string) { setText(this.gold, text); fitGoldPill(this.gold); }

  onDestroy() { for (const f of this.offs) f(); }

  show(toGold = false) {
    this.node.active = true;
    this.showGold(formatNumber(Wallet.gold));
    this.drawPrices();
    this.drawNoAds();
    this.drawFreeGold();
    this.scroll.scrollToTop(0);
    this.fx.intro();
    if (toGold) this.scheduleOnce(() => this.scrollToGold(), 0);
  }

  private scrollToGold() {
    const sec = findAll(this.node, 'efs-sec')[1];          // GOLD PACKS
    if (!sec) return;
    const content = this.scroll.content!, cu = content.getComponent(UITransform)!;
    const top = cu.convertToNodeSpaceAR(sec.worldPosition);
    const offset = -top.y - sec.getComponent(UITransform)!.height / 2 - 8;
    this.scroll.scrollToOffset(new Vec2(0, Math.max(0, offset)), .4);
  }

  /** Amounts from the catalogue: gold of each pack / bundle, boosters ×N, Spend Gold prices */
  private drawCatalogue() {
    for (const b of this.buys) {
      const card = b.node.parent!;
      const p = product(b.id);
      if (p && !p.boosters && p.gold) setText(findNode(card, 'b'), formatNumber(p.gold));   // gold pack
      if (p?.boosters) {
        const left = findNode(card, 'efs-bundle-left');
        if (left && p.gold) setText(findNode(left, 'b'), formatNumber(p.gold));
        for (const bst of findAll(card, 'efs-bst')) setText(findNode(bst, 'small'), `×${p.boosters}`);
      }
      const spend = SPEND[b.id];
      if (spend) { setText(findNode(card, 'b'), spend.name); setText(b.node, formatNumber(spend.price)); }
    }
    const free = this.buys.find(b => b.kind === 'ad');
    if (free) {
      const b = findNode(free.node.parent!, 'b');
      setText(b, String(FREE_GOLD));
      if (b?.parent) this.flowLine(b.parent);
    }
  }

  /** Text runs of one line (web inline text): put them back side by side after a run changed width */
  private flowLine(line: Node) {
    const runs = line.children.filter(c => c.active);
    if (!runs.length) return;
    for (const r of runs) {
      const l = labelIn(r); if (!l) continue;
      l.updateRenderData(true);
      // a box around a text run (<b>) takes the width of its text
      if (l.node !== r) {
        const box = r.getComponent(UITransform)!, t = l.node.getComponent(UITransform)!;
        box.width = t.width;
        l.node.setPosition((t.anchorX - box.anchorX) * t.width, l.node.position.y, 0);
      }
    }
    let x = runs[0].position.x - runs[0].getComponent(UITransform)!.width * runs[0].getComponent(UITransform)!.anchorX;
    for (const r of runs) {
      const ui = r.getComponent(UITransform)!;
      r.setPosition(x + ui.width * ui.anchorX, r.position.y, 0);
      x += ui.width;
    }
  }

  /** Store prices (the design price until the store answers) */
  private drawPrices() {
    for (const b of this.buys) {
      if (b.kind !== 'money' || (product(b.id)?.noAds && Purchases.noAds)) continue;
      setText(b.node, Purchases.price(b.id));
      this.fitButton(b.node);
    }
  }

  /**
   * A price button as wide as its text plus padding (store prices differ in length): buttons on
   * the right of a card keep their right edge, the ones in the middle of a card stay centred.
   */
  private buttonBase = new Map<Node, { x: number; w: number }>();
  private fitButton(btn: Node) {
    const l = labelIn(btn), u = btn.getComponent(UITransform);
    if (!l || !u) return;
    if (!this.buttonBase.has(btn)) this.buttonBase.set(btn, { x: btn.position.x, w: u.width });
    const base = this.buttonBase.get(btn)!;
    l.updateRenderData(true);
    const w = Math.max(76, Math.min(base.w + 20, l.node.getComponent(UITransform)!.width + 36));
    u.width = w;
    const right = base.x > 20;                                   // right-aligned on its card
    btn.setPosition(right ? base.x + base.w / 2 - w / 2 : base.x, btn.position.y, 0);
  }

  private drawNoAds() {
    if (!Purchases.noAds) return;
    for (const b of this.buys) {
      if (!product(b.id)?.noAds) continue;
      setText(b.node, 'Purchased');
      this.fitButton(b.node);
      b.node.getComponent(RoundRect)?.setColors(PURCHASED_BG);
      b.enable(false);
    }
  }

  /** Free gold: once a day; after that the button waits for tomorrow */
  private freeLabelX: number | null = null;
  private freeAnchor: number | null = null;
  private drawFreeGold() {
    const b = this.buys.find(x => x.kind === 'ad'); if (!b) return;
    const done = FreeGold.claimedToday;
    const label = labelIn(b.node);
    if (label) {
      this.freeLabelX ??= label.node.position.x;
      // claimed: a countdown to the next one, centred on the button (no ad icon)
      label.string = done ? this.countdown(FreeGold.secondsLeft()) : 'Collect';
      label.horizontalAlign = Label.HorizontalAlign.CENTER;
      label.updateRenderData(true);
      // the label box is centred on its own x; done: on the button's centre
      const lu = label.node.getComponent(UITransform)!;
      this.freeAnchor ??= lu.anchorX;
      lu.anchorX = done ? .5 : this.freeAnchor;
      label.node.setPosition(done ? 0 : this.freeLabelX!, label.node.position.y, 0);
    }
    const icon = findNode(b.node, 'efs-ad');
    if (icon) icon.active = !done;
    b.enable(!done && !this.busy);
    this.fx?.attract(b.node, !done);                 // "Collect" bobs and twinkles to be noticed
    this.unschedule(this.tickFreeGold);
    if (done) this.schedule(this.tickFreeGold, 1);
  }
  /** Countdown, once a second while the Shop is open (back to Collect at midnight) */
  private tickFreeGold() {
    if (!this.node.activeInHierarchy) return;
    if (!FreeGold.claimedToday) { this.drawFreeGold(); return; }
    const label = labelIn(this.buys.find(x => x.kind === 'ad')?.node ?? null);
    if (label) label.string = this.countdown(FreeGold.secondsLeft());
  }
  private countdown(sec: number) {
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /** Lock every buy button while one purchase / ad runs */
  private lock(on: boolean) {
    this.busy = on;
    for (const b of this.buys) b.enable(!on);
    if (!on) { this.drawNoAds(); this.drawFreeGold(); }
  }

  private async onBuy(b: Buy) {
    if (this.busy) return;
    if (b.kind === 'gold') return this.spendGold(b);
    if (b.kind === 'ad') return this.freeGold();
    this.lock(true);
    const label = labelIn(b.node)!, before = label.string;
    label.string = '…';
    let r: BuyResult = 'error';
    const goldBefore = Wallet.gold;
    this.holdGold = true;
    try { r = await Purchases.buy(b.id); } catch { r = 'error'; }
    label.string = before;
    this.lock(false);
    const p = product(b.id)!;
    if (r === 'ok') {
      Sound.play('unlockLv', { gain: .7 });
      if (p.noAds) Ads.hideBanner();
      this.celebrate(b, goldBefore);
      Overlays.toast(p.noAds && !p.boosters ? 'No Ads activated' : p.gold && !p.boosters ? `+${formatNumber(p.gold)} gold` : `${p.name} added!`);
    } else {
      this.holdGold = false;
      this.showGold(formatNumber(Wallet.gold));
    }
    if (r !== 'ok') Overlays.toast({
      cancelled: 'Purchase cancelled', pending: 'Payment pending. It arrives once confirmed.',
      unavailable: 'Store unavailable. Try again later.', error: 'Purchase failed. Try again later.',
    }[r]);
  }

  /**
   * Confirmed purchase / free gold: ring from the card, coins to the counter (counting up),
   * boosters to Home
   */
  private async celebrate(b: Buy, goldBefore: number) {
    const card = b.node.parent!, p = product(b.id);
    const gained = Wallet.gold - goldBefore;
    const coins = gained > 0 ? Math.min(10, 4 + Math.round(Math.log10(gained))) : 0;
    let shown = goldBefore, landed = 0;
    const coinFrom = findNode(card, 'efs-coins') || findNode(card, 'efs-gift')
      || findAll(card, 'efs-bundle-left')[0]?.children.find(c => c.active && c.getComponent(Sprite)) || null;
    await this.fx.purchased(card, {
      coinFrom, coins, goldTarget: findNode(findNode(this.node, 'efm-gold')!, 'img')!,
      boosterIcons: p?.boosters ? findAll(card, 'efs-bst').map(x => findNode(x, 'img')!) : [],
      boosterTarget: findNode(findNode(this.node, 'sTabHome')!, 'img')!,
      onCoin: () => { landed++; shown = landed >= coins ? Wallet.gold : goldBefore + Math.round(gained * landed / coins); this.showGold(formatNumber(shown)); },
    });
    this.holdGold = false;
    this.showGold(formatNumber(Wallet.gold));
  }

  private async freeGold() {
    const b = this.buys.find(x => x.kind === 'ad');
    if (FreeGold.claimedToday || !b) return;
    this.lock(true);
    const goldBefore = Wallet.gold;
    this.holdGold = true;
    const full = await Overlays.rewarded('free_gold');
    if (full) {
      FreeGold.markClaimed(); Wallet.add(FREE_GOLD); Sound.play('unlockLv', { gain: .6 }); Overlays.toast(`+${FREE_GOLD} gold`);
      this.lock(false);
      await this.celebrate(b, goldBefore);         // coins fly up to the counter
      return;
    }
    this.holdGold = false;
    this.lock(false);
  }

  private spendGold(b: Buy) {
    const item = SPEND[b.id];
    if (Wallet.gold < item.price) { Sound.play('nope'); Overlays.toast('Not enough gold'); return; }
    Wallet.add(-item.price);
    Boosters.add(item.key, 3);
    Sound.play('unlockLv', { gain: .6 });
    Overlays.toast(`${item.name} added!`);
  }

  private async restore() {
    if (this.busy) return;
    this.lock(true);
    const r = await Purchases.restore().catch(() => null);
    this.lock(false);
    if (r?.noAds) { this.drawNoAds(); Ads.hideBanner(); Overlays.toast('Purchases restored'); }
    else Overlays.toast(r?.error ? 'Store unavailable. Try again later.' : 'No purchases to restore');
  }
}
