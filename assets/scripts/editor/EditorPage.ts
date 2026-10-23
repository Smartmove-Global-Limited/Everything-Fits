// The Level Editor page (port of the web editor src/editor/main.js): tabs, the level being edited,
// the live preview (the real Cocos game in the preview box), the checks column, saving.
// The page's HTML and style are build-templates/web-desktop (the web editor's editor.html / .css).
//
// Saving: through tools/serve.mjs (http://localhost:8088/editor/) "Lưu" writes
// assets/gamecontent/content/cozy/levels.json of the Cocos project. Without that server edits stay
// in the browser draft (or go to GitHub with a token); "Tải JSON" gives a levels.json to put in that
// same place of the project, "Tải level này" the level being edited (paste it with "Dán JSON").
import { director, PhysicsSystem2D, EPhysics2DDrawFlags } from 'cc';
import { GameState } from '../core/GameState';
import { GameController } from '../game/GameController';
import { ContentLoader } from '../content/ContentLoader';
import { Sound } from '../audio/Sound';
import { EditorStore, levelNumber } from './EditorStore';
import { EditorApi } from './EditorApi';
import { EditorCatalog } from './EditorCatalog';
import { EditorAutoPlay } from './EditorAutoPlay';
import { GitHub } from './EditorGitHub';
import { EditorBoard } from './EditorBoard';
import { initGenerate } from './EditorGenerate';
import { EditorPool } from './EditorPool';
import { initManage } from './EditorManage';
import { ItemCatalog, BagSkinMap, isFixedSkin, placeFixed, maxScale, MIN_SCALE, resolveContainer, itemArea, difficulty, solve, validSolution, pointInPolygon, KEY_ID } from './logic';

export const $ = (id: string): any => document.getElementById(id);
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export class EditorPage {
  store = new EditorStore();
  catalog = new EditorCatalog();
  items!: ItemCatalog;
  skins: BagSkinMap = {};
  canWrite = false;
  board!: EditorBoard;
  pool!: EditorPool;
  gen: { refresh(): void } | null = null;
  manage: { render(): void } | null = null;
  readonly autoplay = new EditorAutoPlay();
  private areaCache = new Map<number, number>();

  constructor(public game: GameController) {}

  get level() { return this.store.level; }
  get chapter() { return this.store.chapter!; }

  // ---------- status ----------
  status(text: string, cls = '', ms = 3000) {
    const s = $('status'); s.textContent = text; s.className = 'status ' + cls;
    if (text) setTimeout(() => { if (s.textContent === text) s.textContent = ''; }, ms);
  }

  areaOf = (id: number) => {
    let a = this.areaCache.get(Number(id));
    if (a === undefined) { const d = this.items?.defById(id); a = d ? itemArea(d) : 0; this.areaCache.set(Number(id), a); }
    return a;
  };
  clearAreaCache() { this.areaCache.clear(); }

  // ---------- level model ----------
  /** Fixed bags: interior and placement recomputed from the bag picture (main.js dongBoTui) */
  syncBag(level: any) {
    const sk = this.skins[level.container?.skin];
    if (isFixedSkin(sk)) level.container = placeFixed(level.container, sk!, Math.min(maxScale(), Math.max(MIN_SCALE, level.container.scale || 1)));
  }
  /** main.js setLevel: show a level that replaced the one being edited (paste, generator) */
  setLevel(level: any, { keepId = false } = {}) {
    if (keepId) this.store.replaceLevel(level);
    else { this.syncBag(level); this.store.level = level; }
    this.afterOpen();
    this.onChange();
  }
  private afterOpen() {
    const L = this.level;
    this.board?.syncBagUi();
    this.paintLevelNumber();
    $('lvTimer').value = L.timer || 90;
    this.refreshPickers();
    $('lvCoin').value = L.reward?.coin ?? 20;
    this.paintItemScale();
    this.board?.clearSelection();
  }
  /** "Cỡ đồ": size of every item of the level (level.itemScale), 1 is not written */
  private paintItemScale() { const v = Math.round((Number(this.level?.itemScale) || 1) * 100); $('itemScale').value = $('itemScaleNum').value = v; }
  private setItemScale(pct: number) {
    const v = Math.min(150, Math.max(50, Math.round(pct || 100)));
    if (v === 100) delete this.level.itemScale; else this.level.itemScale = v / 100;
    this.paintItemScale(); this.onChange();
  }

  /** After every change: draw again, measure again, push to the preview, mark unsaved */
  onChange() {
    this.board?.render();
    this.metrics();
    this.pushPreview();
    this.markDirty();
  }

  markDirty() {
    this.store.writeDraft();
    const n = this.level ? this.store.editedCount() : 0;
    $('publishBtn').classList.toggle('dirty', n > 0);
    $('dirtyDot').hidden = n === 0;
    $('dirtyCount').textContent = n > 1 ? ` (${n})` : '';
    $('publishBtn').title = n ? `${n} level đã sửa chưa lưu. Bấm để lưu tất cả (Cmd/Ctrl + S)` : 'Không có gì cần lưu (Cmd/Ctrl + S)';
    // the • of the level open in the list, without rebuilding the list on every drag
    const o = $('levelSelect')?.selectedOptions?.[0];
    if (o && this.level) { const has = o.textContent.startsWith('• '), want = this.store.isEdited(this.level.id); if (has !== want) o.textContent = (want ? '• ' : '') + o.textContent.replace(/^• /, ''); }
  }

  private paintLevelNumber() {
    if (!this.level) return;
    const n = this.store.numberOfLevel();
    $('lvSo').textContent = `Level ${n}`;
    $('lvMa').textContent = this.level.id;
    $('downloadLevelBtn').textContent = `Tải level ${n}`;
    $('downloadLevelBtn').title = `Tải JSON của riêng level ${n} (levels_${n}.json) — dán lại bằng Dán JSON`;
  }

  // ---------- live preview ----------
  private pushT: any = 0;
  private building = false;
  private again = false;
  pushPreview() {
    clearTimeout(this.pushT);
    this.pushT = setTimeout(() => this.buildPreview(), 200);
  }
  private async buildPreview() {
    if (!this.level) return;
    if (this.building) { this.again = true; return; }
    this.building = true;
    try {
      this.autoplay.stop();
      hidePopups();
      const idx = Math.max(0, this.store.indexOfLevel());
      await this.game.playLevel(clone(this.level), { id: this.chapter.id, levels: this.chapter.levels.slice() }, idx);
      this.applyToggles();
    } catch (e) { console.error(e); }
    finally {
      this.building = false;
      if (this.again) { this.again = false; this.buildPreview(); }
    }
  }
  /** Timer, collision shapes and sound of the preview (the web editor's preview toggles) */
  private applyToggles() {
    GameState.timerOn = $('timerToggle').checked;
    PhysicsSystem2D.instance.debugDrawFlags = $('colliderToggle').checked ? EPhysics2DDrawFlags.Shape : EPhysics2DDrawFlags.None;
    Sound.setMuted(!$('audioToggle').checked);
  }

  // ---------- save ----------
  /**
   * Write the book (main.js publish): the level being edited goes back to its chapter, version up,
   * chapter asset lists recomputed. Through the local server it goes into the project file; with a
   * GitHub token into the repo; otherwise it stays in the browser draft.
   */
  async publish(): Promise<number> {
    const b = this.store.prepareBook();
    if (this.canWrite) { await EditorApi.saveLevels(b); this.store.markSaved(); }
    else if (GitHub.hasToken()) { const r = await GitHub.putBook(b); this.store.markSaved(); this.status(`Đã ghi lên GitHub · commit ${r.commit}`, 'ok'); }
    else this.store.writeDraft(true);
    return b.version!;
  }
  private async saveAll() {
    const btn = $('publishBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const v = await this.publish();
      this.refreshLevelSelect();
      $('liveTag').textContent = `v${v}`;
      this.markDirty();
      if (this.canWrite) this.status(`Đã lưu levels.json của project · bản v${v}`, 'ok');
      else if (!GitHub.hasToken()) this.status('Đã giữ trong bản nháp của trình duyệt (tải lại trang không mất). Bấm Tải JSON → chép levels.json vào project.', 'ok', 8000);
    } catch (e: any) { this.status('Lỗi lưu: ' + e.message, 'bad', 8000); }
    finally { btn.disabled = false; }
  }

  // ---------- metrics ----------
  /** Level with the bag as built in the game: fixed bags get their printed walls (bag.js) */
  private built(L: any) { return L && { ...L, container: resolveContainer(L.container || {}, this.skins) }; }
  private solveT: any = 0;
  /** Run the solver a little later: dragging calls onChange every frame (main.js chayMayXep) */
  private runSolver() {
    const L = this.built(this.level); if (!L) return;
    const sv = $('solvable');
    if (!L.items.length) { sv.textContent = 'Chưa có món'; sv.className = 'solv'; return; }
    const d = difficulty(L, this.areaOf, this.items);
    const giai = validSolution(L);
    if (giai) { sv.textContent = `Có lời giải lưu sẵn · ${giai.length}/${giai.length} món (Máy chơi xếp theo lời giải này)`; sv.className = 'solv ok'; return; }
    const sol = solve(L, this.items, { tries: 300 });
    if (sol.solvable) { sv.textContent = `Xếp được · ${sol.needCount}/${sol.needCount} món, sau ${sol.tries} lần thử`; sv.className = 'solv ok'; }
    else if (d.density <= .88) { sv.textContent = `Chặt tay · máy chỉ xếp được ${sol.placedCount}/${sol.needCount} món`; sv.className = 'solv warn'; }
    else { sv.textContent = `Rất có thể không xếp nổi · ${sol.placedCount}/${sol.needCount} món, density ${(d.density * 100).toFixed(0)}%`; sv.className = 'solv bad'; }
  }
  metrics() {
    const L = this.built(this.level); if (!L || !this.items) return;
    const d = difficulty(L, this.areaOf, this.items);
    const sv = $('solvable');
    if (!L.items.length) { sv.textContent = 'Chưa có món'; sv.className = 'solv'; }
    else { sv.textContent = 'Đang thử xếp…'; sv.className = 'solv'; }
    clearTimeout(this.solveT); this.solveT = setTimeout(() => this.runSolver(), 220);
    const pct = Math.min(100, d.density * 100);
    const bar = $('densBar'); bar.style.width = pct + '%'; bar.style.background = pct > 92 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--ok)';
    $('kv').innerHTML = [
      ['density', `${(d.density * 100).toFixed(1)}%`],
      ['usable area', `${Math.round(d.usable).toLocaleString()} px²`],
      ['items area', `${Math.round(d.itemArea).toLocaleString()} px²`],
      ['items', `${d.count}`],
      ['timer', `${L.timer}s`],
      ['coin', `${L.reward?.coin ?? 0}`],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    $('diffTotal').textContent = `${d.total} · ${d.tier}`;
    $('diffRows').innerHTML = d.rows.map(r => `<tr><td>${r.label}<span class="c">${r.cond}</span></td><td>${r.pts ? '+' + r.pts : 0}</td></tr>`).join('');
    // warnings
    const warns: string[] = [];
    const locked = L.items.filter((i: any) => i.locked), key = L.items.find((i: any) => Number(i.id) === KEY_ID);
    if (locked.length && !key) warns.push('Có hộp bí ẩn nhưng chưa có chìa khóa.');
    if (key && !key.inBag) warns.push('GDD: chìa khóa phải nằm sẵn trong túi (bật "Đặt sẵn trong túi").');
    if (key?.inBag && !pointInPolygon(key.x ?? 0, key.y ?? -30, L.container.shape)) warns.push('Chìa khóa nằm ngoài lòng túi.');
    for (const it of L.items) if (it.link && !L.items.find((j: any) => j.id === it.link)) warns.push(`${it.id} buộc dây với ${it.link} nhưng món đó không có trong level.`);
    for (const it of L.items) if (!this.catalog.items.has(Number(it.id))) warns.push(`Món #${it.id} chưa có trong project.`);
    if (!this.catalog.bags.has(L.container.skin)) warns.push(`Túi "${L.container.skin}" chưa có trong project.`);
    if (d.density > .95) warns.push('Density > 95%: gần như không xếp được với vật lý.');
    const wc = $('warnCard'); wc.hidden = !warns.length; wc.innerHTML = warns.map(w => `<div>⚠ ${w}</div>`).join('');
  }

  // ---------- bag and background pickers ----------
  bagList(): { id: string; name: string }[] {
    const fixed = this.catalog.fixedBags();
    const ds = fixed.length ? fixed.map(s => ({ id: s.id, name: s.name || s.id })) : Array.from(this.catalog.bags.values()).map(s => ({ id: s.id, name: s.name || s.id }));
    const cur = this.level?.container?.skin;
    if (cur && !ds.some(b => b.id === cur)) ds.push({ id: cur, name: `${cur} (chưa có ảnh ở bộ này)` });
    return ds;
  }
  /** main.js refreshPickers: bags (with pictures) and backgrounds */
  refreshPickers() {
    const skin = $('lvSkin'), ds = this.bagList();
    skin.innerHTML = ds.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    const bgs = Array.from(this.catalog.backgrounds.values()).sort((a, b) => a.id - b.id);
    $('lvBg').innerHTML = bgs.map(b => `<option value="${b.id}">${b.id} · ${b.name || 'Nền ' + b.id}</option>`).join('');
    if (this.level) { skin.value = this.level.container.skin || 'backpack'; $('lvBg').value = String(this.level.background ?? 1); }
    // picture grid: names alone do not tell the bags apart
    $('skinGrid').replaceChildren(...ds.map(b => {
      const el = document.createElement('button'); el.type = 'button'; el.dataset.id = b.id; el.title = b.name;
      el.innerHTML = `<i class="no-img">…</i><span>${b.name}</span>`;
      this.bagImage(b.id, url => { el.querySelector('i')?.replaceWith(Object.assign(document.createElement('img'), { src: url, alt: '' })); });
      el.addEventListener('click', () => { skin.value = b.id; skin.dispatchEvent(new Event('change')); $('skinPick').hidden = true; });
      return el;
    }));
    this.paintSkinButton();
  }
  /** URL of a bag picture (the image of the game bundle) */
  private bagImage(id: string, use: (url: string) => void) {
    this.catalog.bagFrame(id).then(f => { const u = (f?.texture as any)?.image?.nativeUrl; if (u) use(u); });
  }
  private paintSkinButton() {
    const id = $('lvSkin').value, sk = this.catalog.bags.get(id);
    const img = $('lvSkinImg');
    img.hidden = true;
    this.bagImage(id, url => { if ($('lvSkin').value === id) { img.src = url; img.hidden = false; } });
    $('lvSkinName').textContent = sk?.name || id || '—';
    for (const b of Array.from($('skinGrid').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.id === id);
  }

  // ---------- levels ----------
  refreshLevelSelect() {
    const ch = this.chapter, sel = $('levelSelect');
    sel.innerHTML = ch.levels.map((lv, i) => `<option value="${lv.id}">${this.store.isEdited(lv.id) ? '• ' : ''}Level ${levelNumber(this.store.book, ch.id, i)}</option>`).join('');
    if (this.level) sel.value = this.level.id;
    this.paintLevelNumber();
  }
  openChapter(chapterId: string, levelId?: string) {
    this.store.openChapter(chapterId, levelId);
    this.refreshLevelSelect();
    this.afterOpen(); this.onChange();
  }
  openLevel(id: string) {
    this.store.openLevel(id);
    this.refreshLevelSelect();
    this.afterOpen(); this.onChange();
  }

  /** Clipboard; when the browser refuses or it is not a level, ask (main.js readLevelJson) */
  private async readLevelJson() {
    let txt = '';
    try { txt = (await navigator.clipboard.readText()) || ''; } catch { /* refused */ }
    const parse = (t: string) => { const lv = JSON.parse(t); if (!lv.container || !Array.isArray(lv.items)) throw new Error('thiếu container hoặc items'); return lv; };
    if (txt.trim()) { try { return parse(txt); } catch { /* not a level: ask */ } }
    const typed = window.prompt('Dán JSON của level vào đây:');
    if (typed == null) return null;
    return parse(typed);
  }

  // ======================================================================== boot
  private wire() {
    // the browser refills inputs by ORDER after a reload: every input is loaded from the level, so off
    for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) (el as any).autocomplete = 'off';
    $('itemScale').addEventListener('input', (e: any) => this.setItemScale(+e.target.value));
    $('itemScaleNum').addEventListener('change', (e: any) => this.setItemScale(+e.target.value));
    $('itemScaleReset').addEventListener('click', () => this.setItemScale(100));
    // art sets: only Cozy is in the Cocos project
    $('artSeg').addEventListener('click', (e: any) => {
      const b = e.target.closest('button'); if (!b || b.dataset.art === 'cozy') return;
      this.status('Bộ Casual chưa có trong project Cocos (chỉ có Cozy)', 'bad', 5000);
    });
    $('publishBtn').addEventListener('click', () => this.saveAll());
    window.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveAll(); }
    });
    $('downloadBtn').addEventListener('click', () => {
      const b = this.store.prepareBook();
      this.store.writeDraft(true);
      EditorApi.download('levels.json', JSON.stringify(b, null, 2) + '\n');
      this.markDirty();
      this.status('Đã tải levels.json — chép đè vào assets/gamecontent/content/cozy/ của project Cocos', 'ok', 8000);
    });
    $('downloadLevelBtn').addEventListener('click', () => {
      const n = this.store.numberOfLevel();
      // named after the level number shown everywhere (Level 1 → levels_1.json)
      EditorApi.download(`levels_${n}.json`, JSON.stringify(this.level, null, 2) + '\n');
      this.status(`Đã tải levels_${n}.json (Level ${n}) — dán lại bằng nút Dán JSON`, 'ok', 6000);
    });
    // GitHub (editor without the project's server)
    const paintGh = () => { $('ghTag').textContent = GitHub.hasToken() ? `${GitHub.REPO.owner}/${GitHub.REPO.repo}` : 'chưa nối'; $('ghBtn').classList.toggle('warn', !GitHub.hasToken()); };
    paintGh();
    $('ghBtn').addEventListener('click', () => {
      $('ghRepoName').textContent = `${GitHub.REPO.owner}/${GitHub.REPO.repo}`;
      $('ghBranchName').textContent = GitHub.REPO.branch;
      $('ghPath').textContent = GitHub.REPO.path;
      $('ghToken').value = GitHub.hasToken() ? '••••••••' : '';
      $('ghStatus').textContent = '';
      $('ghModal').hidden = false;
    });
    $('ghClose').addEventListener('click', () => { $('ghModal').hidden = true; });
    $('ghModal').addEventListener('click', (e: any) => { if (e.target === $('ghModal')) $('ghModal').hidden = true; });
    $('ghSave').addEventListener('click', async () => {
      const typed = $('ghToken').value.trim();
      const token = typed === '••••••••' ? GitHub.readToken() : typed;
      if (!token) { $('ghStatus').textContent = 'Chưa dán token'; return; }
      $('ghStatus').textContent = 'đang kiểm tra…';
      try {
        const name = await GitHub.check(token);
        GitHub.writeToken(token); paintGh();
        $('ghStatus').textContent = `Đã nối ${name}`;
        setTimeout(() => { $('ghModal').hidden = true; }, 900);
      } catch (e: any) { $('ghStatus').textContent = 'Lỗi: ' + e.message; }
    });
    $('ghForget').addEventListener('click', () => { GitHub.clearToken(); paintGh(); $('ghToken').value = ''; $('ghStatus').textContent = 'Đã xoá token khỏi trình duyệt này'; });
    // bag picker
    $('lvSkinBtn').addEventListener('click', () => { this.paintSkinButton(); $('skinPick').hidden = false; });
    $('skinPickClose').addEventListener('click', () => { $('skinPick').hidden = true; });
    $('skinPick').addEventListener('click', (e: any) => { if (e.target === $('skinPick')) $('skinPick').hidden = true; });
    // level form
    $('lvTimer').addEventListener('change', (e: any) => { this.level.timer = +e.target.value; this.onChange(); });
    $('lvBg').addEventListener('change', (e: any) => { this.level.background = Number(e.target.value); this.onChange(); });
    $('lvSkin').addEventListener('change', (e: any) => { this.level.container.skin = e.target.value; this.syncBag(this.level); this.board.syncBagUi(); this.paintSkinButton(); this.onChange(); });
    $('lvCoin').addEventListener('change', (e: any) => { this.level.reward = { ...(this.level.reward || {}), coin: +e.target.value }; this.onChange(); });
    // tabs
    $('tabs').addEventListener('click', (e: any) => {
      const b = e.target.closest('button'); if (!b) return;
      Array.from($('tabs').children as HTMLElement[]).forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab-page').forEach((p: any) => (p.hidden = p.id !== 'tab-' + b.dataset.tab));
      if (b.dataset.tab === 'library') this.pool?.render();
    });
    // preview: the machine plays / play again
    $('autoplayBtn').addEventListener('click', () => this.runAutoplay());
    $('restartBtn').addEventListener('click', () => { this.autoplay.stop(); hidePopups(); this.game.restart(); this.status('Đã dựng lại màn', 'ok'); });
    for (const id of ['timerToggle', 'colliderToggle', 'audioToggle']) $(id).addEventListener('change', () => this.applyToggles());
    // generator dialog
    $('genBtn').addEventListener('click', () => { $('genModal').hidden = false; this.gen?.refresh(); });
    $('genClose').addEventListener('click', () => { $('genModal').hidden = true; });
    $('genModal').addEventListener('click', (e: any) => { if (e.target === $('genModal')) $('genModal').hidden = true; });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') $('genModal').hidden = true; });
    // levels
    $('levelSelect').addEventListener('change', (e: any) => this.openLevel(e.target.value));
    $('newLevel').addEventListener('click', () => {
      const lv = this.store.newLevel(); if (!lv) return;
      this.refreshLevelSelect(); this.afterOpen(); this.onChange();
      this.status(`Đã thêm level ${this.chapter.levels.length}, chưa lưu. Bấm Lưu để ghi vào game.`);
    });
    // copy / paste
    $('copyJson').addEventListener('click', async () => {
      const ok = await EditorApi.copyText(JSON.stringify(this.level, null, 2));
      this.status(ok ? 'Đã chép JSON' : 'Trình duyệt không cho chép', ok ? 'ok' : 'bad');
    });
    $('pasteJson').addEventListener('click', async () => {
      try {
        const lv = await this.readLevelJson();
        if (!lv) return;
        this.setLevel(lv, { keepId: true });
        this.status(`Đã dán level · ${lv.items.length} món`, 'ok');
      } catch (e: any) { this.status('Không dán được: ' + e.message, 'bad'); }
    });
    // closing the tab: write the draft now; with the project's server, warn about unsaved levels
    window.addEventListener('pagehide', () => this.store.writeDraft(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.store.writeDraft(true); });
    window.addEventListener('beforeunload', e => { if (this.canWrite && this.level && this.store.editedCount() > 0) { e.preventDefault(); e.returnValue = ''; } });
  }

  private async runAutoplay() {
    this.autoplay.stop();
    hidePopups();
    await this.game.restart();
    this.applyToggles();
    this.status('Máy đang xếp thử…', '', 60000);
    const r = await this.autoplay.play(GameState.level, this.items, this.skins, (t, k) => this.status(t, k, 5000));
    if (!r) return;
    for (let t = 0; t < 30 && !GameState.won && r.placed >= r.need; t++) await new Promise(ok => setTimeout(ok, 100));   // the win needs the bag to settle
    if (GameState.won) this.status('Máy xếp xong · level giải được', 'ok', 6000);
    else this.status(`Máy xếp được ${r.placed}/${r.need} món`, r.placed >= r.need ? 'ok' : 'bad', 6000);
  }

  async boot() {
    try {
      this.wire();
      this.status('Đang nạp…', '', 60000);
      await this.catalog.load();
      const server = await EditorApi.server();
      this.canWrite = server.write;
      // item manifests as they are in the project now (art library edits made after the build)
      if (server.ok) for (const m of await EditorApi.loadItems()) this.catalog.items.set(Number(m.id), m);
      this.items = new ItemCatalog(Array.from(this.catalog.items.values()) as any);
      for (const [k, b] of this.catalog.bags) this.skins[k] = b as any;
      // the level book: the project file through the local server, else the one built in
      const book = (server.ok && await EditorApi.loadLevels()) || await ContentLoader.loadBook();
      if (!book?.chapters?.length) throw new Error('levels.json chưa có chương nào');
      this.store.normalize = lv => this.syncBag(lv);
      const draft = this.store.load(clone(book));
      $('ghBtn').hidden = this.canWrite;
      this.board = new EditorBoard(this);
      // pictures arrive one by one: draw again once they stop coming for a moment
      let picT: any = 0;
      this.catalog.onPicture = () => { clearTimeout(picT); picT = setTimeout(() => { this.board.render(); this.board.refreshPalette(); this.pool?.paintThumbs(); }, 120); };
      this.gen = initGenerate(this);
      this.pool = new EditorPool(this);
      this.manage = initManage(this);
      this.openChapter(draft.open?.[0] || this.store.book.chapters[0].id, draft.open?.[1]);
      $('liveTag').textContent = `v${this.store.book.version || 1}`;
      const n = this.store.editedCount();
      if (draft.restored) this.status(`Đã mở lại bản nháp chưa lưu${n ? ` (${n} level đã sửa)` : ''}. Bấm Lưu khi xong.`, 'ok', 8000);
      else if (server.ok && !this.canWrite) this.status('Mở từ máy khác: sửa thoải mái, editor tự giữ bản nháp. Xong thì bấm Tải JSON (hoặc Tải level N) rồi gửi file.', '', 12000);
      else if (!this.canWrite) this.status('Không thấy máy chủ của project: sửa thoải mái, editor tự giữ bản nháp. Xong thì bấm Tải JSON → chép levels.json vào project.', '', 9000);
      else this.status('Sẵn sàng · Lưu là ghi thẳng levels.json của project Cocos', 'ok');
      this.markDirty();
    } catch (e: any) {
      console.error(e);
      this.status('Lỗi khởi động: ' + (e?.message || e), 'bad', 60000);
    }
  }
}

/** Close the game's round popups at once (the preview rebuilds the level under an open win / lose popup) */
function hidePopups() {
  const canvas = director.getScene()?.getChildByName('Canvas');
  for (const name of ['SettingsPopup', 'WinPopup', 'LosePopup', 'ShakePopup']) {
    const n = canvas?.getChildByName(name);
    if (n) n.active = false;
  }
}
