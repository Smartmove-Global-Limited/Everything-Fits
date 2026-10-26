// Settings popup (web src/ui/settings.js, Figma "EF · Settings"):
//   BGM / SFX / Vibration switches, saved and applied at once (all ON for a new player);
//   Home and Restart only while a round is being played; inside the Level Editor also the levels.json
//   version at the bottom and « previous / next level » buttons (devLevels);
//   X or a tap on the dim area closes it.
import { _decorator, Component, Node, Color, Vec3, Tween, tween, UITransform, EventTouch, Label, instantiate } from 'cc';
import { findNode, labelIn, tap, openPopup, closePopup, contentOf } from './UiKit';
import { RoundRect } from './RoundRect';
import { Sound } from '../audio/Sound';
const { ccclass } = _decorator;

const ON_BG = new Color(0x34, 0x74, 0x50, 255), OFF_BG = new Color(0xB9, 0xB4, 0xA8, 255);
const KNOB_TRAVEL = 23.4;   // web: knob right 4 → right 52 (×0.972)
const MENU_CARD_HEIGHT = 345.6; // web card height when Home / Restart are hidden
const MENU_BOTTOM_PAD = 24;     // card edge under the last switch row (menu, no version line)
const SIDE_BY_SIDE = 56;        // in game: Home left, Restart right of the centre
/**
 * Level Editor preview only (open({ devLevels: true })): « previous level / next level » on the row
 * Restart used to take, to go through the levels quickly. Players never see them.
 */
const DEV_SIDE = 74;

type Toggle = { node: Node; bg: RoundRect; knob: Node; label: Label };

export type SettingsOptions = { inGame?: boolean; version?: number | string | null; onHome?: () => void; onRestart?: () => void; onClose?: () => void;
  /** Level Editor preview: show the « previous / next level » buttons */
  devLevels?: boolean; onPrevLevel?: () => void; onNextLevel?: () => void };

@ccclass('SettingsPopup')
export class SettingsPopup extends Component {
  private card: Node = null!;
  private toggles: Record<'bgm' | 'sfx' | 'vib', Toggle> = null!;
  private home: Node = null!;
  private restart: Node = null!;
  private prevLevel: Node | null = null;
  private nextLevel: Node | null = null;
  private version: Label | null = null;
  private opts: SettingsOptions = {};
  private cardHeight = 0;
  private baseY = new Map<Node, number>();

  onLoad() {
    const n = this.node;
    this.card = findNode(n, 'efp-card')!;
    const toggle = (id: string): Toggle => { const t = findNode(n, id)!; return { node: t, bg: t.getComponent(RoundRect)!, knob: findNode(t, 'i')!, label: labelIn(findNode(t, 'span'))! }; };
    this.toggles = { bgm: toggle('togBgm'), sfx: toggle('togSfx'), vib: toggle('togVib') };
    this.home = findNode(n, 'setHome')!;
    this.restart = findNode(n, 'setRestart')!;
    this.version = labelIn(findNode(n, 'setVer'));
    this.cardHeight = this.card.getComponent(UITransform)!.height;
    for (const c of contentOf(this.card)) this.baseY.set(c, c.position.y);

    tap(this.toggles.bgm.node, () => { Sound.setMusic(!Sound.musicOn); this.redraw(true); }, 'tap', this);
    tap(this.toggles.sfx.node, () => { Sound.setSfx(!Sound.sfxOn); this.redraw(true); }, null, this);
    tap(this.toggles.vib.node, () => { Sound.setVibration(!Sound.vibrationOn); this.redraw(true); if (Sound.vibrationOn) Sound.vibrate(30); }, 'tap', this);
    tap(findNode(n, 'setX'), () => this.close(), 'tap', this);
    tap(this.home, () => { const cb = this.opts.onHome; this.close(false); cb?.(); }, 'tap', this);
    tap(this.restart, () => { const cb = this.opts.onRestart; this.close(false); cb?.(); }, 'tap', this);
    this.prevLevel = this.devButton('« Level trước', () => this.opts.onPrevLevel);
    this.nextLevel = this.devButton('Level sau »', () => this.opts.onNextLevel);
    // a tap on the dim area (not on the card) closes it
    n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      const ui = this.card.getComponent(UITransform)!;
      const p = e.getUILocation();
      if (!ui.getBoundingBoxToWorld().contains(p)) this.close();
    }, this);
  }

  onDestroy() { this.node.targetOff(this); }

  /** A copy of the Restart button without its icon, for the temporary level buttons */
  private devButton(text: string, cb: () => (() => void) | undefined): Node {
    const b = instantiate(this.restart);
    b.name = 'devLevel';
    b.parent = this.card;
    const icon = findNode(b, 'svg'); if (icon) icon.active = false;
    const label = labelIn(findNode(b, 'span'));
    if (label) { label.string = text; label.fontSize = 17; }
    tap(b, () => { const f = cb(); this.close(false); f?.(); }, 'tap', this);
    return b;
  }

  open(opts: SettingsOptions = {}) {
    this.opts = opts;
    this.home.active = !!opts.inGame;
    this.restart.active = !!opts.inGame;
    const dev = !!opts.inGame && !!opts.devLevels && !!this.prevLevel;
    if (this.prevLevel) this.prevLevel.active = dev;
    if (this.nextLevel) this.nextLevel.active = dev;
    this.layout(!!opts.inGame, dev, opts.version != null);
    if (this.version) this.version.string = opts.version != null ? `Levels v${opts.version}` : '';
    this.redraw(false);
    openPopup(this.node, this.card);
  }

  /** Close; `notify` false when Home / Restart take over (they handle the round themselves) */
  close(notify = true) {
    const cb = notify ? this.opts.onClose : undefined;
    closePopup(this.node, cb);
  }

  /**
   * The prefab is the web in-game layout: Home and Restart stacked, a long card. In game they now
   * sit side by side on one row (shorter card, still centred); from the menu they are hidden and
   * the card collapses around the switches like the web.
   */
  private layout(inGame: boolean, devRow = false, versionLine = false) {
    const homeY = this.baseY.get(this.home)!, restartY = this.baseY.get(this.restart)!;
    const rowGap = homeY - restartY;                          // the stacked Restart row
    // the temporary level buttons take the row Restart left: the card keeps its full height
    const shrink = inGame ? (devRow ? 0 : rowGap) : this.cardHeight - MENU_CARD_HEIGHT;
    this.card.getComponent(UITransform)!.height = this.cardHeight - shrink;
    for (const [c, y] of this.baseY) {
      if (c === this.home || c === this.restart || c === this.prevLevel || c === this.nextLevel) continue;
      const isVersion = c.name === 'setVer';
      c.setPosition(c.position.x, y + (isVersion ? shrink / 2 : -shrink / 2), 0);
    }
    if (inGame) {
      this.home.setPosition(-SIDE_BY_SIDE, homeY - shrink / 2, 0);
      this.restart.setPosition(SIDE_BY_SIDE, homeY - shrink / 2, 0);
    }
    if (devRow) {
      this.prevLevel!.setPosition(-DEV_SIDE, restartY + 14, 0);
      this.nextLevel!.setPosition(DEV_SIDE, restartY + 14, 0);
    }
    // from the menu without the levels version line (Level Editor only): the card ends
    // MENU_BOTTOM_PAD under the last switch row instead of keeping the empty line
    if (!inGame && !versionLine) {
      const cu = this.card.getComponent(UITransform)!;
      const rows = contentOf(this.card).filter(c => c.name === 'efset-row');
      const lowest = Math.min(...rows.map(r => r.position.y - r.getComponent(UITransform)!.height / 2));
      const trim = lowest - (-cu.height * cu.anchorY) - MENU_BOTTOM_PAD;
      if (trim > 0) {
        cu.height -= trim;
        for (const c of contentOf(this.card)) c.setPosition(c.position.x, c.position.y - trim / 2, 0);
      }
    }
  }

  private redraw(animate: boolean) {
    this.drawToggle(this.toggles.bgm, Sound.musicOn, animate);
    this.drawToggle(this.toggles.sfx, Sound.sfxOn, animate);
    this.drawToggle(this.toggles.vib, Sound.vibrationOn, animate);
  }

  private drawToggle(t: Toggle, on: boolean, animate: boolean) {
    t.bg.fill = on ? ON_BG : OFF_BG;
    t.label.string = on ? 'ON' : 'OFF';
    t.label.updateRenderData(true);
    const w = t.node.getComponent(UITransform)!.width, lw = t.label.node.getComponent(UITransform)!.width;
    const ax = t.label.node.getComponent(UITransform)!.anchorX;
    // web: "ON" 13px from the left edge, "OFF" 12px from the right edge
    const left = on ? -w / 2 + 12.6 : w / 2 - 11.7 - lw;
    // the label sits inside its <span> node: move the span so the text's left edge lands there
    const span = t.label.node.parent!;
    span.setPosition(left - t.label.node.position.x + lw * ax, span.position.y, 0);
    const to = new Vec3(on ? KNOB_TRAVEL : -KNOB_TRAVEL, t.knob.position.y, 0);
    Tween.stopAllByTarget(t.knob);
    if (animate) tween(t.knob).to(.2, { position: to }, { easing: 'sineOut' }).start();
    else t.knob.setPosition(to);
  }
}
