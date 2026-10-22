// Multi-resolution: the game is designed on 420×760. Taller screens (phones 19.5–21:9) keep the
// width and get extra height; wider screens (tablets) keep the height and get extra width. The
// 420×760 design box is always fully visible; EdgePin moves bars to the real screen edges.
import { view, ResolutionPolicy, sys, Rect, profiler, Camera } from 'cc';

export const DESIGN_W = 420, DESIGN_H = 760;
let applied = false;

export const ScreenFit = {
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
  /** Visible area in design units */
  visible() { return view.getVisibleSize(); },
  /** Insets of the unsafe areas (notch, status bar, gesture bar) in design units */
  insets(out = { top: 0, bottom: 0 }) {
    const vis = view.getVisibleSize();
    let safe: Rect | null = null;
    try { safe = sys.getSafeAreaRect(); } catch { safe = null; }
    if (!safe || safe.width <= 0) { out.top = 0; out.bottom = 0; return out; }
    out.bottom = Math.max(0, safe.y);
    out.top = Math.max(0, vis.height - (safe.y + safe.height));
    return out;
  },
};
