// Settings popup (web src/ui/settings.js, Figma "EF · Settings"):
//   BGM / SFX / Vibration switches, saved and applied at once (all ON for a new player);
//   Home and Restart only while a round is being played; inside the Level Editor also the levels.json
//   version at the bottom and « previous / next level » buttons (devLevels);
//   testers: 10 taps in a row on the levels version line turn on a "Chọn level" button (kept on this
//   device) that opens a grid of every level;
//   X or a tap on the dim area closes it.
import { _decorator, Component, Node, Color, Vec3, Tween, tween, UITransform, EventTouch, Label, instantiate } from 'cc';
import { findNode, labelIn, tap, openPopup, closePopup, contentOf } from './UiKit';
import { RoundRect } from './RoundRect';
import { Sound } from '../audio/Sound';
import { LocalStore } from '../services/LocalStore';
import { Overlays } from './Overlays';
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
/** Testers' level picker: hidden for players, turned on for good on this device by 10 quick taps on the version line */
const PICKER_KEY = 'ef.tester.levelPicker';
const UNLOCK_TAPS = 10, TAP_GAP_MS = 1500;     // taps closer than this count as "in a row"
const GRID_COLS = 5, CELL_W = 52, CELL_H = 44, CELL_GAP = 8, GRID_TOP = 64, GRID_BOTTOM = 28;
const CELL_FILL = new Color(0xEA, 0xE0, 0xCB, 255), CURRENT_FILL = new Color(0xE2, 0x63, 0x7F, 255);
const CELL_INK = new Color(0x3B, 0x2A, 0x4A, 255), CURRENT_INK = Color.WHITE;

type Toggle = { node: Node; bg: RoundRect; knob: Node; label: Label };

export type SettingsOptions = { inGame?: boolean; version?: number | string | null; onHome?: () => void; onRestart?: () => void; onClose?: () => void;
  /** Level Editor preview: show the « previous / next level » buttons */
  devLevels?: boolean; onPrevLevel?: () => void; onNextLevel?: () => void;
  /** Testers' level picker (shown once turned on): how many levels, the one played now, open one */
  levelPicker?: { count: number; current: number; onPick: (index: number) => void } };

@ccclass('SettingsPopup')
export class SettingsPopup extends Component {
  private card: Node = null!;
  private toggles: Record<'bgm' | 'sfx' | 'vib', Toggle> = null!;
  private home: Node = null!;
  private restart: Node = null!;
  private prevLevel: Node | null = null;
  private nextLevel: Node | null = null;
  private version: Label | null = null;
  private picker: Node | null = null;
  private grid: Node | null = null;
  private gridTitle: Node | null = null;
  private verTaps = 0;
  private verTapAt = 0;
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
    tap(findNode(n, 'setX'), () => this.close(), null, this);   // close() plays the menu-close sound
    tap(this.home, () => { const cb = this.opts.onHome; this.close(false); cb?.(); }, 'tap', this);
    tap(this.restart, () => { const cb = this.opts.onRestart; this.close(false); cb?.(); }, 'tap', this);
    this.prevLevel = this.devButton('« Level trước', () => this.opts.onPrevLevel);
    this.nextLevel = this.devButton('Level sau »', () => this.opts.onNextLevel);
    this.picker = this.plainButton('Chọn level', 18);
    this.picker.getComponent(UITransform)!.setContentSize(170, 44);
    tap(this.picker, () => this.showGrid(), 'tap', this);
    tap(findNode(n, 'setVer'), () => this.onVersionTap(), null, this);
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

  /** A copy of the Restart button without its icon (picker button, level cells) */
  private plainButton(text: string, fontSize: number): Node {
    const b = instantiate(this.restart);
    b.name = 'tester';
    b.parent = this.card;
    const icon = findNode(b, 'svg'); if (icon) icon.active = false;
    const span = findNode(b, 'span');
    span?.setPosition(0, 0, 0);               // the text sat under the icon: centred on the button
    const label = labelIn(span);
    if (label) { label.string = text; label.fontSize = fontSize; label.color = CELL_INK; }
    // the Restart button has no face of its own: a rounded tile
    const face = b.getComponent(RoundRect) || b.addComponent(RoundRect);
    face.radius = 12; face.fill = CELL_FILL;
    b.active = false;
    return b;
  }

  private get pickerOn() { return LocalStore.get(PICKER_KEY) === '1'; }

  /** 10 quick taps on the version line: the level picker is on for good on this device */
  private onVersionTap() {
    const now = Date.now();
    this.verTaps = now - this.verTapAt < TAP_GAP_MS ? this.verTaps + 1 : 1;
    this.verTapAt = now;
    if (this.verTaps < UNLOCK_TAPS || !this.opts.levelPicker) return;
    this.verTaps = 0;
    if (!this.pickerOn) { LocalStore.set(PICKER_KEY, '1'); Overlays.toast('Đã bật Chọn level'); }
    this.open(this.opts);                     // laid out again, now with the button
  }

  /** The grid of every level (in place of the switches); a tap opens that level */
  private showGrid() {
    const lp = this.opts.levelPicker; if (!lp) return;
    const content = contentOf(this.card);
    // the card title ("Settings"), copied for the grid's own title
    const title = content.find(c => labelIn(c)?.string === 'Settings') || null;
    for (const c of content) if (c.name !== 'setX') c.active = false;
    const rows = Math.ceil(lp.count / GRID_COLS);
    const cardH = GRID_TOP + rows * CELL_H + (rows - 1) * CELL_GAP + GRID_BOTTOM;
    this.card.getComponent(UITransform)!.height = cardH;
    if (!this.grid) {
      this.grid = new Node('levelGrid');
      this.grid.layer = this.card.layer;
      this.grid.parent = this.card;
      this.grid.addComponent(UITransform);
    }
    const g = this.grid;
    g.active = true;
    g.removeAllChildren();
    if (!this.gridTitle && title) { this.gridTitle = instantiate(title); this.gridTitle.name = 'gridTitle'; }
    if (this.gridTitle) {
      this.gridTitle.parent = g;
      this.gridTitle.active = true;
      const l = labelIn(this.gridTitle); if (l) l.string = 'Chọn level';
      this.gridTitle.setPosition(0, cardH / 2 - 34, 0);
    }
    const x0 = -((GRID_COLS - 1) * (CELL_W + CELL_GAP)) / 2, y0 = cardH / 2 - GRID_TOP - CELL_H / 2;
    for (let i = 0; i < lp.count; i++) {
      const c = this.plainButton(String(i + 1), 18);
      c.name = 'levelCell';
      c.parent = g;
      c.active = true;
      c.getComponent(UITransform)!.setContentSize(CELL_W, CELL_H);
      // the level played now in pink
      if (i === lp.current) c.getComponent(RoundRect)!.fill = CURRENT_FILL;
      const label = labelIn(c); if (label) label.color = i === lp.current ? CURRENT_INK : CELL_INK;
      c.setPosition(x0 + (i % GRID_COLS) * (CELL_W + CELL_GAP), y0 - Math.floor(i / GRID_COLS) * (CELL_H + CELL_GAP), 0);
      tap(c, () => { this.close(false); lp.onPick(i); }, 'tap', this);
    }
    const x = findNode(this.card, 'setX');
    if (x) x.setPosition(x.position.x, cardH / 2 - 30, 0);
  }

  open(opts: SettingsOptions = {}) {
    this.opts = opts;
    // the grid of the last time gives the card back to the switches
    if (this.grid) this.grid.active = false;
    for (const c of contentOf(this.card)) if (c !== this.grid && c.name !== 'tester') c.active = true;
    this.home.active = !!opts.inGame;
    this.restart.active = !!opts.inGame;
    const dev = !!opts.inGame && !!opts.devLevels && !!this.prevLevel;
    if (this.prevLevel) this.prevLevel.active = dev;
    if (this.nextLevel) this.nextLevel.active = dev;
    const picking = !dev && !!opts.levelPicker && this.pickerOn && !!this.picker;
    if (this.picker) this.picker.active = picking;
    this.layout(!!opts.inGame, dev, opts.version != null, picking);
    if (this.version) this.version.string = opts.version != null ? `Levels v${opts.version}` : '';
    this.redraw(false);
    Sound.play('menuOpen');
    openPopup(this.node, this.card);
  }

  /** Close; `notify` false when Home / Restart take over (they handle the round themselves) */
  close(notify = true) {
    const cb = notify ? this.opts.onClose : undefined;
    Sound.play('menuClose');
    closePopup(this.node, cb);
  }

  /**
   * The prefab is the web in-game layout: Home and Restart stacked, a long card. In game they now
   * sit side by side on one row (shorter card, still centred); from the menu they are hidden and
   * the card collapses around the switches like the web.
   */
  private layout(inGame: boolean, devRow = false, versionLine = false, pickerRow = false) {
    const homeY = this.baseY.get(this.home)!, restartY = this.baseY.get(this.restart)!;
    const rowGap = homeY - restartY;                          // the stacked Restart row
    // the temporary level buttons take the row Restart left: the card keeps its full height; the
    // testers' picker button too in game, and from the menu it takes the row Home would have
    const shrink = inGame ? (devRow || pickerRow ? 0 : rowGap) : pickerRow ? rowGap : this.cardHeight - MENU_CARD_HEIGHT;
    this.card.getComponent(UITransform)!.height = this.cardHeight - shrink;
    for (const [c, y] of this.baseY) {
      if (c === this.home || c === this.restart || c === this.prevLevel || c === this.nextLevel || c === this.picker) continue;
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
    if (pickerRow) this.picker!.setPosition(0, inGame ? restartY + 14 : homeY - shrink / 2, 0);
    // from the menu without the levels version line (Level Editor only): the card ends
    // MENU_BOTTOM_PAD under the last switch row instead of keeping the empty line
    if (!inGame && !versionLine && !pickerRow) {
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
