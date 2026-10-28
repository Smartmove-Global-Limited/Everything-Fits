// Multi-resolution: the game is designed on 420×760. Taller screens (phones 19.5–21:9) keep the
// width and get extra height; wider screens (tablets) keep the height and get extra width. The
// 420×760 design box is always fully visible; EdgePin moves bars to the real screen edges.
import { view, ResolutionPolicy, sys, Rect, profiler, Camera, Size } from 'cc';

export const DESIGN_W = 420, DESIGN_H = 760;
const EMBEDDED_SIZE = new Size(DESIGN_W, DESIGN_H);
let applied = false;

let embedded = false;
/** Height of the bottom ad banner in design units (0 = none); bottom bars sit above it */
let adBottom = 0;
const insetListeners: (() => void)[] = [];

export const ScreenFit = {
  /**
   * The game runs inside the Level Editor (Editor.scene): its camera draws into the editor's
   * preview box, the editor owns the design resolution. The game then sees exactly the 420×760
   * design area (no extra height, no notch insets), so bars and the field keep their design places.
   */
  setEmbedded() { embedded = true; applied = true; },
  get embedded() { return embedded; },
  /** Call once from the first scene controller (MainMenu / GameController onLoad) */
  apply() {
    if (applied) return;
    applied = true;
    profiler.hideStats();   // the FPS panel the debug template turns on; players never see it
    const fit = () => {
      const frame = view.getFrameSize();
      const tall = frame.height / frame.width >= DESIGN_H / DESIGN_W;
      view.setDesignResolutionSize(DESIGN_W, DESIGN_H, tall ? ResolutionPolicy.FIXED_WIDTH : ResolutionPolicy.FIXED_HEIGHT);
    };
    fit();
    view.on('canvas-resize', fit);
  },
  /**
   * For a Canvas that does not follow the screen (alignCanvasWithScreen off, Game.scene): Cocos no
   * longer sizes the camera then, so its view height is set here to the visible height, now and
   * on every resize. Returns an unsubscribe function for onDestroy.
   */
  fitCamera(camera: Camera) {
    const fit = () => { camera.orthoHeight = view.getVisibleSize().height / 2; };
    fit();
    view.on('canvas-resize', fit);
    view.on('design-resolution-changed', fit);
    return () => { view.off('canvas-resize', fit); view.off('design-resolution-changed', fit); };
  },
  /** Visible area in design units (the bare design area inside the editor) */
  visible() { return embedded ? EMBEDDED_SIZE : view.getVisibleSize(); },
  /**
   * The bottom banner appeared (height in design units) or went away (0): bars pinned to the
   * bottom edge (EdgePin) move up above it.
   */
  setAdBottom(h: number) {
    if (Math.abs(h - adBottom) < .5) return;
    adBottom = h;
    for (const f of insetListeners) f();
  },
  get adBottom() { return adBottom; },
  onInsetsChange(fn: () => void) { insetListeners.push(fn); return () => { const i = insetListeners.indexOf(fn); if (i >= 0) insetListeners.splice(i, 1); }; },
  /** Insets of the unsafe areas in design units: top the notch / camera, bottom the ad banner */
  insets(out = { top: 0, bottom: 0 }) {
    if (embedded) { out.top = 0; out.bottom = 0; return out; }
    const vis = view.getVisibleSize();
    let safe: Rect | null = null;
    try { safe = sys.getSafeAreaRect(); } catch { safe = null; }
    if (!safe || safe.width <= 0) { out.top = 0; out.bottom = adBottom; return out; }
    // bottom: only the ad banner. The game runs full screen with the navigation bar hidden
    // (AppActivity.hideSystemBars), yet the engine's safe area still kept the bar's height at the
    // bottom (about 34 dp on a Redmi), which lifted the tab bar and the banner's strip off the edge.
    out.bottom = adBottom;
    out.top = Math.max(0, vis.height - (safe.y + safe.height));
    return out;
  },
};
