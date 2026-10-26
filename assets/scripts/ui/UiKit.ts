// Shared helpers for the screens and popups built from the web UI (tools/editor/build-ui.js):
// node lookup by name (run once in onLoad, never per frame), web-like press feedback, popup
// open/close animation, label access.
import { Node, Label, UIOpacity, Tween, tween, Vec3, Sprite, Color, UITransform } from 'cc';
import { RoundRect } from './RoundRect';
import { Sound, SfxName } from '../audio/Sound';

/** First node called `name` under root (breadth first) */
export function findNode(root: Node, name: string): Node | null {
  const queue: Node[] = [root];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (n.name === name) return n;
    for (const c of n.children) queue.push(c);
  }
  return null;
}
/** Every node called `name` under root, in tree order */
export function findAll(root: Node, name: string, out: Node[] = []): Node[] {
  if (root.name === name) out.push(root);
  for (const c of root.children) findAll(c, name, out);
  return out;
}
/** The label showing the text of a web element (its "Text" child, or itself) */
export function labelIn(node: Node | null): Label | null {
  if (!node) return null;
  return node.getComponent(Label) || node.getComponentInChildren(Label);
}
export function setText(node: Node | null, text: string) { const l = labelIn(node); if (l) l.string = text; }

const DOWN = new Vec3(.94, .94, 1);
/**
 * Make a node a button. Boxes with a solid "lip" shadow sink by it while pressed (web
 * .efbtn:active translateY + shadow off), others shrink a little (web transform scale(.94)).
 * Returns a setter to enable / disable the button.
 */
export function tap(node: Node | null, onClick: () => void, sound: SfxName | null = 'tap', target?: object) {
  if (!node) return (_on: boolean) => {};
  const face = node.getComponent(RoundRect);
  const lip = face ? face.lip : 0;
  let down = false, enabled = true;
  const baseY = node.position.y;
  const press = () => {
    if (!enabled) return;
    down = true;
    if (lip > 0) { face!.lip = 0; node.setPosition(node.position.x, baseY - lip, node.position.z); }
    else node.setScale(DOWN);
  };
  const release = (fire: boolean) => {
    if (!down) return;
    down = false;
    if (lip > 0) { face!.lip = lip; node.setPosition(node.position.x, baseY, node.position.z); }
    else node.setScale(Vec3.ONE);
    if (fire && enabled) { if (sound) Sound.play(sound); onClick(); }
  };
  node.on(Node.EventType.TOUCH_START, press, target);
  node.on(Node.EventType.TOUCH_END, () => release(true), target);
  node.on(Node.EventType.TOUCH_CANCEL, () => release(false), target);
  return (on: boolean) => {
    enabled = on;
    const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    op.opacity = on ? 255 : 153;          // web :disabled{opacity:.6}
  };
}

/**
 * Popup open / close like the web overlay: the dim layer fades in, the card grows from 90%
 * with a little overshoot (cubic-bezier(.2,.9,.3,1.3), .3 s).
 */
export function openPopup(root: Node, card: Node | null) {
  root.active = true;
  const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
  Tween.stopAllByTarget(op);
  op.opacity = 0;
  tween(op).to(.18, { opacity: 255 }).start();
  if (card) {
    Tween.stopAllByTarget(card);
    card.setScale(.9, .9, 1);
    tween(card).to(.3, { scale: Vec3.ONE }, { easing: 'backOut' }).start();
  }
}
export function closePopup(root: Node, done?: () => void) {
  const op = root.getComponent(UIOpacity) || root.addComponent(UIOpacity);
  Tween.stopAllByTarget(op);
  tween(op).to(.15, { opacity: 0 }).call(() => { root.active = false; done?.(); }).start();
}

/** Grey out an image (web filter: grayscale + opacity) */
export function dimSprite(node: Node | null, dim: boolean) {
  const s = node?.getComponent(Sprite); if (!s) return;
  s.color = dim ? new Color(150, 150, 150, 128) : Color.WHITE;
}

/** A panel's own children, without the smooth background picture RoundRect adds ("__skin") */
export const contentOf = (n: Node) => n.children.filter(c => c.name !== '__skin');

/**
 * Gold counter pill (Home / Shop top bar): coin, amount, "+" button. The pill hugs the amount
 * (no empty run before the "+") and the amount keeps a little room after the coin; the left
 * edge stays where the layout put it.
 */
const pillLeft = new WeakMap<Node, number>();
export function fitGoldPill(amount: Node) {
  const pill = amount.parent!, pu = pill.getComponent(UITransform)!;
  const coin = findNode(pill, 'img'), plus = pill.children.find(c => /AddGold$/.test(c.name));
  const label = labelIn(amount);
  if (!coin || !plus || !label) return;
  if (!pillLeft.has(pill)) pillLeft.set(pill, pill.position.x - pu.width * pu.anchorX);
  label.updateRenderData(true);
  const lu = label.node.getComponent(UITransform)!, au = amount.getComponent(UITransform)!;
  const cw = coin.getComponent(UITransform)!.width, pw = plus.getComponent(UITransform)!.width;
  const PAD_L = 8, GAP_TEXT = 7, GAP_PLUS = 10, PAD_R = 9;
  const textW = lu.width, w = PAD_L + cw + GAP_TEXT + textW + GAP_PLUS + pw + PAD_R;
  pu.width = w;
  pill.setPosition(pillLeft.get(pill)! + w * pu.anchorX, pill.position.y, 0);
  const left = -w * pu.anchorX;
  coin.setPosition(left + PAD_L + cw / 2, coin.position.y, 0);
  au.width = textW;
  amount.setPosition(left + PAD_L + cw + GAP_TEXT + textW * au.anchorX, amount.position.y, 0);
  if (label.node !== amount) label.node.setPosition((lu.anchorX - au.anchorX) * textW, label.node.position.y, 0);
  plus.setPosition(left + w - PAD_R - pw / 2, plus.position.y, 0);
}

