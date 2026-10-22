// Shop (web src/ui/shop.js, Figma "EF · Shop"): No Ads · Free Gold (ad) · Gold Packs · No Ads
// Bundle · Bundles · Spend Gold · Restore purchases. Real money goes through Purchases
// (simulated for now), the free gold through a rewarded ad. While one purchase runs every buy
// button is locked; rewards are granted only when the purchase is confirmed.
import { _decorator, Component, Node, ScrollView, Vec2, UITransform, Color } from 'cc';
import { findNode, findAll, setText, labelIn, tap } from './UiKit';
import { RoundRect } from './RoundRect';
import { Overlays } from './Overlays';
import { Wallet, formatNumber } from '../services/Wallet';
import { Purchases } from '../services/Purchases';
import { Boosters, BoosterKey, BOOSTER_KEYS } from '../services/Boosters';
import { Sound } from '../audio/Sound';
const { ccclass } = _decorator;

const FREE_GOLD = 100;
const GOLD_PACKS = [1000, 5000, 10000, 25000, 50000, 100000];
const NO_ADS_BUNDLE = { name: 'No Ads Bundle', gold: 1000, boosters: 1 };
const BUNDLES = [
  { name: 'Small Bundle', gold: 5000, boosters: 1 },
  { name: 'Medium Bundle', gold: 10000, boosters: 2 },
  { name: 'Ultra Bundle', gold: 25000, boosters: 5 },
];
const SPEND: { key: BoosterKey; name: string; price: number }[] = [
  { key: 'freeze', name: 'Freeze ×3', price: 150 },
  { key: 'resize', name: 'Resize ×3', price: 200 },
  { key: 'throw', name: 'Throw out ×3', price: 150 },
];
const PURCHASED_BG = new Color(0x8F, 0xA5, 0x96, 255);

type Buy = { node: Node; enable: (on: boolean) => void; kind: 'money' | 'ad' | 'gold'; id: string; index: number };

@ccclass('ShopScreen')
export class ShopScreen extends Component {
  actions: { onHome: () => void; onSettings: () => void } | null = null;
  private gold: Node = null!;
  private scroll: ScrollView = null!;
  private buys: Buy[] = [];
  private busy = false;
  private offGold: (() => void) | null = null;

  onLoad() {
    const n = this.node;
    this.gold = findNode(n, 'sGold')!;
    this.scroll = findNode(n, 'shopScroll')!.getComponent(ScrollView)!;
    // buy buttons in page order (same order as the web catalogue)
    const ids = ['no_ads', 'free_gold', ...GOLD_PACKS.map((_, i) => 'gold_' + i), 'noads_bundle', ...BUNDLES.map((_, i) => 'bundle_' + i), ...SPEND.map(s => 'spend_' + s.key)];
    findAll(n, 'efs-buy').forEach((b, i) => {
      const id = ids[i]; if (!id) return;
      const kind: Buy['kind'] = id === 'free_gold' ? 'ad' : id.startsWith('spend_') ? 'gold' : 'money';
      const buy: Buy = { node: b, enable: () => {}, kind, id, index: i };
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
    this.offGold = Wallet.onChange(g => setText(this.gold, formatNumber(g)));
  }
  onDestroy() { this.offGold?.(); }

  show(toGold = false) {
    this.node.active = true;
    setText(this.gold, formatNumber(Wallet.gold));
    this.drawNoAds();
    this.scroll.scrollToTop(0);
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

  private drawNoAds() {
    const b = this.buys.find(x => x.id === 'no_ads'); if (!b) return;
    if (Purchases.noAds) {
      setText(b.node, 'Purchased');
      b.node.getComponent(RoundRect)?.setColors(PURCHASED_BG);
      b.enable(false);
    }
  }

  private async onBuy(b: Buy) {
    if (this.busy) return;
    if (b.kind === 'gold') return this.spendGold(b);
    if (b.kind === 'ad') return this.freeGold();
    this.busy = true;
    const label = labelIn(b.node)!, before = label.string;
    label.string = '…';
    let ok = false;
    try { ok = await Purchases.buy(b.id); } catch { ok = false; }
    this.busy = false;
    if (!ok) { label.string = before; Overlays.toast('Purchase cancelled'); return; }
    label.string = before;
    Sound.play('unlockLv', { gain: .7 });
    this.grant(b.id);
  }

  private grant(id: string) {
    if (id === 'no_ads') { Purchases.enableNoAds(); this.drawNoAds(); Overlays.toast('No Ads activated'); return; }
    if (id.startsWith('gold_')) { const g = GOLD_PACKS[+id.slice(5)]; Wallet.add(g); Overlays.toast(`+${formatNumber(g)} gold`); return; }
    const bundle = id === 'noads_bundle' ? NO_ADS_BUNDLE : BUNDLES[+id.slice(7)];
    if (!bundle) return;
    if (id === 'noads_bundle') { Purchases.enableNoAds(); this.drawNoAds(); }
    Wallet.add(bundle.gold);
    for (const k of BOOSTER_KEYS) Boosters.add(k, bundle.boosters);
    Overlays.toast(`${bundle.name} added!`);
  }

  private async freeGold() {
    if (!Overlays.adAvailable()) { Overlays.toast('Ad unavailable. Try again later.'); return; }
    this.busy = true;
    const full = await Overlays.watchAd();
    this.busy = false;
    if (full) { Wallet.add(FREE_GOLD); Sound.play('unlockLv', { gain: .6 }); Overlays.toast(`+${FREE_GOLD} gold`); }
    else Overlays.toast('Watch the full ad to collect');
  }

  private spendGold(b: Buy) {
    const item = SPEND.find(s => 'spend_' + s.key === b.id)!;
    if (Wallet.gold < item.price) { Sound.play('nope'); Overlays.toast('Not enough gold'); return; }
    Wallet.add(-item.price);
    Boosters.add(item.key, 3);
    Sound.play('unlockLv', { gain: .6 });
    Overlays.toast(`${item.name} added!`);
  }

  private async restore() {
    if (this.busy) return;
    this.busy = true;
    const r = await Purchases.restore().catch(() => null);
    this.busy = false;
    if (r?.noAds) { Purchases.enableNoAds(); this.drawNoAds(); Overlays.toast('Purchases restored'); }
    else Overlays.toast('No purchases to restore');
  }
}
