// Màn THỬ VẬT LÝ (giai đoạn 1 chuyển sang Cocos): Box2D có thay được Matter.js, hết rung không.
//
// Dùng chung dữ liệu của game web (levels.json, ảnh món, hình va chạm, ảnh túi), chép vào
// build/web-desktop/content bằng tools/chep-noi-dung.mjs sau mỗi lần build.
//
// Toạ độ: dữ liệu game web là màn 420×760, gốc ở góc TRÊN trái, y hướng XUỐNG, góc quay
// radian theo chiều kim đồng hồ. Cocos y hướng LÊN, góc độ ngược chiều kim. Mọi chỗ đổi
// qua lại đi qua g2c / gocC.
//
// Mở màn: dựng camera + canvas bằng code (scene main rỗng), tải Level 3 xếp sẵn như lời giải.
// Kéo thả bằng chuột / ngón tay được. Đo từ console: globalThis.TH (xem cuối file).
import {
  director, Director, Node, Camera, Canvas, UITransform, Sprite, SpriteFrame, ImageAsset, assetManager,
  view, ResolutionPolicy, PhysicsSystem2D, RigidBody2D, ERigidBody2DType, PolygonCollider2D, Vec2, Vec3,
  Color, Layers, input, Input, EventTouch, EventMouse, Label, Graphics, ERaycast2DType,
} from 'cc';
import { EDITOR } from 'cc/env';

const W = 420, H = 760;
const FLOOR_Y = H - 130;            // mặt sàn khay (như game web)
const NOI_DUNG = 'content/cozy/';
const LOP = Layers.Enum.UI_2D;

// ---------- đổi toạ độ ----------
const g2c = (x: number, y: number) => new Vec3(x, H - y, 0);          // game → nút gốc (đáy trái)
const gocC = (rad: number) => -rad * 180 / Math.PI;                    // góc game → node.angle
const radG = (deg: number) => -deg * Math.PI / 180;

// ---------- dữ liệu ----------
let BOOK: any = null, CHI_MUC: any = null;
const DEF = new Map<number, any>();
const ANH = new Map<string, SpriteFrame>();

async function docJSON(path: string) { const r = await fetch(NOI_DUNG + path + '?t=' + Date.now()); return r.json(); }
function taiAnh(path: string): Promise<SpriteFrame> {
  if (ANH.has(path)) return Promise.resolve(ANH.get(path)!);
  return new Promise((ok, loi) => assetManager.loadRemote<ImageAsset>(NOI_DUNG + path, { ext: '.png' }, (e, img) => {
    if (e) return loi(e);
    const sf = SpriteFrame.createWithImage(img); ANH.set(path, sf); ok(sf);
  }));
}
async function defMon(id: number) {
  if (DEF.has(id)) return DEF.get(id);
  const d = await docJSON(CHI_MUC.items[String(id)]);
  DEF.set(id, d);
  return d;
}

// ---------- hình va chạm ----------
/** Các đa giác (toạ độ game quanh gốc hình, chưa nhân cỡ) */
function hinhMon(d: any): number[][][] {
  const c = d.collider || {};
  if (c.kind === 'polys') return c.polys;
  if (c.kind === 'poly') return [c.pts];
  if (c.kind === 'circle') { const n = 16, r = c.r, dx = c.dx || 0, dy = c.dy || 0; return [Array.from({ length: n }, (_, i) => [dx + Math.cos(i / n * 2 * Math.PI) * r, dy + Math.sin(i / n * 2 * Math.PI) * r])]; }
  if (c.kind === 'rect') { const w = c.w / 2, h = c.h / 2, dx = c.dx || 0, dy = c.dy || 0; return [[[dx - w, dy - h], [dx + w, dy - h], [dx + w, dy + h], [dx - w, dy + h]]]; }
  return [];
}
/** Bớt đỉnh thừa (Ramer–Douglas–Peucker): hình bo góc 28 đỉnh không cần chừng ấy cho va chạm */
function rutGon(pts: number[][], eps: number): number[][] {
  if (pts.length < 4) return pts;
  const kc = (p: number[], a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L; };
  const rdp = (a: number, b: number, ra: number[][]) => {
    let m = -1, im = -1;
    for (let i = a + 1; i < b; i++) { const d = kc(pts[i], pts[a], pts[b]); if (d > m) { m = d; im = i; } }
    if (m > eps) { rdp(a, im, ra); ra.push(pts[im]); rdp(im, b, ra); }
  };
  const ra = [pts[0]]; rdp(0, pts.length - 1, ra); ra.push(pts[pts.length - 1]);
  // bỏ điểm trùng
  return ra.filter((p, i) => i === 0 || Math.hypot(p[0] - ra[i - 1][0], p[1] - ra[i - 1][1]) > .5);
}
const dienTich = (p: number[][]) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };

// ---------- khối lượng ----------
// bang: mọi món nặng như nhau (như game web hiện tại)
// hang: theo hạng nhẹ / vừa / nặng, chênh tối đa 2,5 lần (gợi ý cho game, sẽ chốt sau)
// gram: gram thật như trước (ca khó nhất)
type KieuKL = 'bang' | 'hang' | 'gram';
function khoiLuong(d: any, kieu: KieuKL) {
  const g = Number(d.meta?.gram) || 150;
  if (kieu === 'bang') return 1;
  if (kieu === 'hang') return g < 100 ? 1 : g < 400 ? 1.6 : 2.5;
  return Math.max(10, Math.min(2000, g)) / 150;
}

// ---------- dựng cảnh ----------
let goc: Node = null!;              // nút gốc, toạ độ đáy trái
let lopThan: Node, lopMon: Node, lopVien: Node, lopTinh: Node;
const MON: { node: Node; rb: RigidBody2D; id: number; i: number }[] = [];
let TUI: any = null;                // { poly (toạ độ game tuyệt đối) }

function nut(ten: string, cha: Node) { const n = new Node(ten); n.layer = LOP; cha.addChild(n); n.addComponent(UITransform); return n; }

function dungKhung() {
  view.setDesignResolutionSize(W, H, ResolutionPolicy.SHOW_ALL);
  const scene = director.getScene()!;
  // cấu trúc chuẩn của Cocos: Canvas ở gốc scene, camera là con của Canvas tại (0,0,1000)
  const canvasN = new Node('Canvas'); canvasN.layer = LOP; scene.addChild(canvasN);
  canvasN.addComponent(UITransform).setContentSize(W, H);
  const camN = new Node('Camera'); camN.layer = LOP; canvasN.addChild(camN); camN.setPosition(0, 0, 1000);
  const cam = camN.addComponent(Camera);
  cam.projection = Camera.ProjectionType.ORTHO; cam.orthoHeight = H / 2; cam.visibility = Layers.Enum.UI_2D | Layers.Enum.DEFAULT;
  cam.clearFlags = Camera.ClearFlag.SOLID_COLOR; cam.clearColor = new Color(216, 203, 182, 255); cam.priority = 0;
  const cv = canvasN.addComponent(Canvas); cv.cameraComponent = cam; cv.alignCanvasWithScreen = true;
  goc = nut('San', canvasN); goc.setPosition(-W / 2, -H / 2, 0);
  lopThan = nut('ThanTui', goc); lopMon = nut('Mon', goc); lopVien = nut('VienTui', goc); lopTinh = nut('Tinh', goc);
  // sàn khay vẽ một vạch cho dễ nhìn
  const gs = nut('VachSan', goc).addComponent(Graphics); gs.strokeColor = new Color(150, 130, 110, 255); gs.lineWidth = 2; gs.moveTo(0, H - FLOOR_Y); gs.lineTo(W, H - FLOOR_Y); gs.stroke();
}

/** Một thân tĩnh gồm các thanh mỏng dọc theo cạnh đa giác (toạ độ game), dày `day` về phía NGOÀI */
function thanhTinh(ten: string, poly: number[][], day: number, kin: boolean, ma = .04) {
  const n = nut(ten, lopTinh);
  const rb = n.addComponent(RigidBody2D); rb.type = ERigidBody2DType.Static;
  // chiều đa giác: dấu diện tích (toạ độ game y xuống)
  let s = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; }
  const chieu = s > 0 ? 1 : -1;
  const so = kin ? poly.length : poly.length - 1;
  for (let i = 0; i < so; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < .5) continue;
    // pháp tuyến hướng ra ngoài (y xuống, đa giác thuận chiều kim → ngoài là bên trái cạnh)
    const nx = -dy / L * chieu, ny = dx / L * chieu;
    const ra = (p: number[], k: number) => [p[0] - nx * k, p[1] - ny * k];
    // nới hai đầu chút cho các thanh gối lên nhau, không hở khe ở góc
    const ex = dx / L * 2, ey = dy / L * 2;
    const q = [[a[0] - ex, a[1] - ey], [b[0] + ex, b[1] + ey], ra([b[0] + ex, b[1] + ey], day), ra([a[0] - ex, a[1] - ey], day)];
    const col = n.addComponent(PolygonCollider2D);
    col.points = q.map(([x, y]) => new Vec2(x, H - y));
    col.friction = ma; col.restitution = .05; col.apply();
  }
  return n;
}

async function dungTui(c: any) {
  const sk = await docJSON(CHI_MUC.bags[c.skin]);
  const s = c.scale || 1;
  const poly = c.shape.map(([x, y]: number[]) => [c.cx + x, c.bottom + y]);
  TUI = { poly, skin: sk, c };
  // ảnh: thân sau đồ, viền trước đồ
  const im = sk.image;
  for (const [lop, cha] of [['body', lopThan], ['frame', lopVien]] as [string, Node][]) {
    if (!sk.layers?.[lop]) continue;
    const sf = await taiAnh(sk.layers[lop]);
    const n = nut('tui-' + lop, cha);
    n.getComponent(UITransform)!.setContentSize(im.w * s, im.h * s);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
    n.setPosition(g2c(c.cx + (im.x + im.w / 2) * s, c.bottom + (im.y + im.h / 2) * s));
  }
  thanhTinh('ThanhTui', poly, 14, true);
}

async function themMon(it: any, i: number, kieu: KieuKL, x: number, y: number, angle: number) {
  const d = await defMon(it.id);
  const k = (Number(it.scale) || 1) * (Number(BOOK._lv?.itemScale) || 1);
  const sf = await taiAnh(d.sprite.src);
  const ppu = d.sprite.pixelsPerUnit || 1;
  const n = nut(`mon-${it.id}-${i}`, lopMon);
  n.getComponent(UITransform)!.setContentSize(sf.originalSize.width / ppu * k, sf.originalSize.height / ppu * k);
  const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
  n.setPosition(g2c(x, y)); n.angle = gocC(angle);
  const rb = n.addComponent(RigidBody2D);
  rb.type = ERigidBody2DType.Dynamic; rb.allowSleep = true; rb.bullet = false;
  rb.enabledContactListener = false;
  const hinh = hinhMon(d);
  const tong = hinh.reduce((t, p) => t + dienTich(p) * k * k, 0) || 1;
  const kl = khoiLuong(d, kieu);
  for (const p of hinh) {
    const gon = rutGon(p, .8);
    if (gon.length < 3) continue;
    const col = n.addComponent(PolygonCollider2D);
    col.points = gon.map(([px, py]) => new Vec2(px * k, -py * k));
    // khối lượng món = kl × hằng số, chia theo diện tích (Box2D: khối lượng = mật độ × diện tích)
    col.density = kl * 3500 / tong;
    col.friction = .6; col.restitution = .05;
    col.apply();
  }
  MON.push({ node: n, rb, id: it.id, i });
  return n;
}

function xoaCanh() {
  for (const lop of [lopThan, lopMon, lopVien, lopTinh]) lop.removeAllChildren();
  MON.length = 0; TUI = null;
}

async function taiLevel(n: number, { giai = true, khoiLuong: kieu = 'bang' as KieuKL, bo = [] as number[], chiMon = null as any[] | null } = {}) {
  xoaCanh();
  const lv = BOOK.chapters[0].levels[n - 1];
  BOOK._lv = lv;
  await dungTui(lv.container);
  thanhTinh('San', [[-40, FLOOR_Y], [W + 40, FLOOR_Y]], 60, false, .8);
  thanhTinh('TuongTrai', [[0, -400], [0, H + 200]], 60, false, .8);
  thanhTinh('TuongPhai', [[W, H + 200], [W, -400]], 60, false, .8);
  // chiMon: bỏ hết đồ của level, chỉ đặt đúng các món này ({id, x, y, angle, scale}, toạ độ game)
  if (chiMon) { for (let i = 0; i < chiMon.length; i++) await themMon(chiMon[i], i, kieu, chiMon[i].x, chiMon[i].y, chiMon[i].angle || 0); return { level: n, tui: lv.container.skin, mon: MON.length, khoiLuong: kieu }; }
  const giaiTheoI = new Map((lv.solution || []).map((s: any) => [s.i, s]));
  for (let i = 0; i < lv.items.length; i++) {
    const it = lv.items[i];
    if (bo.includes(it.id)) continue;
    const st: any = giai ? giaiTheoI.get(i) : null;
    await themMon(it, i, kieu, st ? st.x : it.x, st ? st.y : it.y, st ? st.angle : (it.angle || 0));
  }
  return { level: n, tui: lv.container.skin, mon: MON.length, khoiLuong: kieu };
}

// ---------- kéo thả ----------
let cam: { m: typeof MON[0]; dx: number; dy: number } | null = null;
function diemGame(e: EventTouch | EventMouse) {
  const p = e.getUILocation();            // toạ độ thiết kế, gốc đáy trái
  return { x: p.x, y: H - p.y, c: new Vec2(p.x, p.y) };
}
function batDauKeo(e: EventTouch) {
  const p = diemGame(e);
  const tr = PhysicsSystem2D.instance.testPoint(p.c);
  const col = tr.find(c => MON.some(m => m.node === c.node));
  if (!col) return;
  const m = MON.find(m => m.node === col.node)!;
  m.rb.enabled = false;                    // nhấc lên: rời thế giới vật lý
  const np = m.node.position;
  cam = { m, dx: np.x - p.c.x, dy: np.y - p.c.y };
  m.node.setSiblingIndex(lopMon.children.length - 1);
}
function keo(e: EventTouch) {
  if (!cam) return;
  const p = diemGame(e);
  let y = p.c.y + cam.dy;
  cam.m.node.setPosition(p.c.x + cam.dx, Math.max(H - FLOOR_Y + 10, y), 0);
}
function tha() {
  if (!cam) return;
  const m = cam.m; cam = null;
  m.rb.enabled = true;
  m.rb.linearVelocity = new Vec2(0, 0); m.rb.angularVelocity = 0; m.rb.wakeUp();
}

// ---------- đo ----------
const trongTui = (m: typeof MON[0]) => {
  if (!TUI) return false;
  const x = m.node.position.x, y = H - m.node.position.y, poly = TUI.poly;
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
};
const cho = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Đo rung: mỗi món đi / xoay bao nhiêu trong `giay` giây (đơn vị game, độ) */
async function doRung(giay = 2) {
  const mau = new Map(MON.map(m => [m, [] as number[][]]));
  const buoc = Math.round(giay * 10);
  for (let i = 0; i < buoc; i++) { await cho(100); for (const m of MON) mau.get(m)!.push([m.node.position.x, m.node.position.y, m.node.angle]); }
  const ds = MON.map(m => {
    const v = mau.get(m)!;
    const r = (k: number) => Math.max(...v.map(s => s[k])) - Math.min(...v.map(s => s[k]));
    return { id: m.id, di: +Math.max(r(0), r(1)).toFixed(2), xoay: +r(2).toFixed(2), ngu: !m.rb.isAwake(), tui: trongTui(m) };
  });
  return { rungNhat: Math.max(...ds.map(d => Math.max(d.di, d.xoay / 3))), soMonRung: ds.filter(d => d.di > .3 || d.xoay > 1).length, ngu: ds.filter(d => d.ngu).length + '/' + ds.length, ds };
}
/** Nhấc món `idTren` đặt ngay trên món `idDuoi`, cao hơn `cao` đơn vị, rồi buông cho rơi */
async function thaLen(idTren: number, idDuoi: number, cao = 40) {
  const a = MON.find(m => m.id === idTren), b = MON.find(m => m.id === idDuoi);
  if (!a || !b) return 'không thấy món';
  a.rb.enabled = false;
  const bb = b.node.getComponent(UITransform)!.getBoundingBoxToWorld();
  const ab = a.node.getComponent(UITransform)!;
  a.node.angle = 0;
  a.node.setWorldPosition(new Vec3(bb.center.x, bb.yMax + ab.height / 2 + cao, 0));
  await cho(50);
  a.rb.enabled = true; a.rb.linearVelocity = new Vec2(0, 0); a.rb.angularVelocity = 0; a.rb.wakeUp();
  return 'đã thả';
}

// ---------- khởi động ----------
async function khoiDong() {
  dungKhung();
  const ps = PhysicsSystem2D.instance;
  ps.enable = true;
  ps.gravity = new Vec2(0, -1100);
  ps.fixedTimeStep = 1 / 60; ps.velocityIterations = 10; ps.positionIterations = 10;
  ps.allowSleep = true;
  CHI_MUC = await docJSON('assets/index.json');
  BOOK = await docJSON('levels.json');
  input.on(Input.EventType.TOUCH_START, batDauKeo);
  input.on(Input.EventType.TOUCH_MOVE, keo);
  input.on(Input.EventType.TOUCH_END, tha);
  input.on(Input.EventType.TOUCH_CANCEL, tha);
  const ln = nut('Nhan', goc); ln.setPosition(W / 2, H - 20, 0);
  const lb = ln.addComponent(Label); lb.string = 'THỬ VẬT LÝ BOX2D'; lb.fontSize = 16; lb.color = new Color(60, 50, 70, 255);
  await taiLevel(3);
  (globalThis as any).TH.sanSang = true;
}

(globalThis as any).TH = { taiLevel, doRung, thaLen, MON, cho, sanSang: false, ps: () => PhysicsSystem2D.instance, tui: () => TUI, trongTui };
if (!EDITOR) director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => { khoiDong().catch(e => { console.error('[EF]', e); (globalThis as any).TH.loi = String(e?.stack || e); }); });
