// The Level Editor (Editor.scene = Game.scene + this component). The editor page itself is HTML
// (build-templates/web-desktop: the old web editor's page and style); EditorPage runs it. This
// component only sets up the game for the preview box: the Cocos canvas sits inside that box, the
// game sees its 420×760 design area, and the page tells it which level to play.
import { _decorator, Component, view, ResolutionPolicy, Camera, director, profiler } from 'cc';
import { ScreenFit, DESIGN_W, DESIGN_H } from '../ui/ScreenFit';
import { GameController } from '../game/GameController';
import { EditorPage } from './EditorPage';
const { ccclass } = _decorator;

@ccclass('EditorApp')
export class EditorApp extends Component {
  page: EditorPage | null = null;

  /** The editor page is there (the editor build); not in Cocos Creator's preview of this scene */
  private get onEditorPage() { return typeof document !== 'undefined' && !!document.getElementById('publishBtn'); }

  onLoad() {
    if (!this.onEditorPage) { console.warn('Editor.scene runs inside the Level Editor page only: node tools/build-web.mjs editor, then http://localhost:8088/editor/'); return; }
    ScreenFit.setEmbedded();
    profiler.hideStats();   // debug builds show the FPS panel
    // the canvas is the preview box: show the whole design area, letterboxed if needed
    view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.SHOW_ALL);
    view.resizeWithBrowserSize(true);
  }

  start() {
    if (!this.onEditorPage) return;
    const scene = director.getScene()!;
    const cam = scene.getChildByName('Canvas')!.getComponentInChildren(Camera)!;
    cam.orthoHeight = DESIGN_H / 2;   // Game.scene's Canvas does not follow the screen (ScreenFit.fitCamera)
    const game = scene.getComponentInChildren(GameController)!;
    this.page = new EditorPage(game);
    this.page.boot();
  }
}
