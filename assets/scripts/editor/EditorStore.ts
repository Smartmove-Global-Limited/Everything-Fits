// Level Editor data: the level book (levels.json), the chapter and level open for editing, what is
// edited but not saved yet, the browser draft, and the files written out (port of the web editor
// src/editor/main.js model: E, GOC / DA_SUA, luuTam, moLevel, chuanBiSach, blankLevel, nextLevelId).
//
// The level being edited is a private copy (`level`). Switching level / chapter writes it back into
// the book first (keepEdits), so several levels can be edited and saved in one go. `saved` holds the
// JSON of every level as last saved, to tell which ones changed.
import { LocalStore } from '../services/LocalStore';

export type Book = { version?: number; publishedAt?: string; note?: string; chapters: Chapter[] };
export type Chapter = { id: string; no?: number; name?: string; background?: number; reward?: any; levels: any[]; assets?: any };

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const DRAFT_KEY = 'ef.editor.draft.cozy';

/** Level number shown to the player: counted on across chapters (loader.js soThuTuLevel) */
export function levelNumber(book: Book | null, chapterId: string, index: number): number {
  let n = 0;
  for (const c of book?.chapters || []) { if (c.id === chapterId) return n + index + 1; n += c.levels?.length || 0; }
  return index + 1;
}

/** Next free level id of a chapter: initials of the chapter id + number (manage.js nextLevelId) */
export function nextLevelId(chapterId: string, existing: string[]): string {
  const prefix = chapterId.split('-').map(w => w[0]).join('').slice(0, 3) || 'lv';
  const used = new Set(existing);
  let n = existing.length + 1, id = `${prefix}-${String(n).padStart(2, '0')}`;
  while (used.has(id)) id = `${prefix}-${String(++n).padStart(2, '0')}`;
  return id;
}

/** A new empty level (main.js blankLevel) */
export function blankLevel(id: string): any {
  return {
    id, timer: 90,
    container: { skin: 'backpack', cx: 210, bottom: 404, shape: [[-127, -220], [127, -220], [127, 0], [-127, 0]], blocks: [] },
    mode: 'fixed', items: [], reward: { coin: 20 }, background: 1,
  };
}

/** Short fingerprint of a book, to know whether a browser draft was made on this very file */
function fingerprint(book: Book): string {
  const t = JSON.stringify(book);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + '.' + t.length;
}

export class EditorStore {
  book: Book = { chapters: [] };
  chapter: Chapter | null = null;
  level: any = null;
  private saved = new Map<string, string>();     // level id → JSON as last saved
  private editedOthers = new Set<string>();      // other levels edited but not saved
  private bookPrint = '';
  private draftTimer: any = 0;

  /** Load a book (from the project file); a browser draft made on the same file is restored */
  load(book: Book): { restored: boolean; edited: number; open: [string, string] | null } {
    this.book = book;
    this.snapshot();
    this.bookPrint = fingerprint(book);
    let draft: any = null;
    try { draft = JSON.parse(LocalStore.get(DRAFT_KEY) || 'null'); } catch { draft = null; }
    if (!draft?.book?.chapters?.length) return { restored: false, edited: 0, open: null };
    if (draft.base !== this.bookPrint) { LocalStore.set(DRAFT_KEY, ''); return { restored: false, edited: 0, open: null }; }
    // levels not marked as edited come from the file, so the • mark only flags real edits
    const fromFile = new Map<string, any>();
    for (const c of book.chapters) for (const lv of c.levels) fromFile.set(lv.id, lv);
    const edited = new Set<string>((draft.edited || []).filter((x: any) => typeof x === 'string'));   // level ids only
    for (const c of draft.book.chapters as Chapter[]) c.levels = c.levels.map(lv => (!edited.has(lv.id) && fromFile.has(lv.id) ? fromFile.get(lv.id) : lv));
    this.book = draft.book;
    for (const id of edited) this.editedOthers.add(id);
    return { restored: true, edited: edited.size, open: draft.open || null };
  }

  private snapshot() {
    this.saved = new Map();
    for (const c of this.book.chapters) for (const lv of c.levels) this.saved.set(lv.id, JSON.stringify(lv));
    this.editedOthers.clear();
  }

  isEdited(id: string): boolean {
    if (id === this.level?.id) return this.saved.get(id) !== JSON.stringify(this.level);
    return this.editedOthers.has(id);
  }
  /** How many levels differ from the saved file */
  editedCount(): number {
    const cur = this.level?.id;
    return this.editedOthers.size - (this.editedOthers.has(cur) ? 1 : 0) + (cur && this.isEdited(cur) ? 1 : 0);
  }

  /** Copy the level being edited back to its place in the chapter (only if it still exists) */
  keepEdits() {
    if (!this.level || !this.chapter) return;
    const i = this.chapter.levels.findIndex(l => l.id === this.level.id);
    if (i < 0) return;
    this.chapter.levels[i] = clone(this.level);
    if (this.saved.get(this.level.id) !== JSON.stringify(this.level)) this.editedOthers.add(this.level.id);
    else this.editedOthers.delete(this.level.id);
  }

  openChapter(chapterId: string, levelId?: string) {
    this.keepEdits();
    this.chapter = this.book.chapters.find(c => c.id === chapterId) || this.book.chapters[0] || null;
    if (!this.chapter) return;
    let pick = this.chapter.levels.find(l => l.id === levelId) || this.chapter.levels[0];
    if (!pick) { pick = blankLevel(nextLevelId(this.chapter.id, [])); this.chapter.levels.push(pick); }
    this.openLevelObject(pick);
  }

  openLevel(id: string) {
    this.keepEdits();
    const lv = this.chapter?.levels.find(l => l.id === id);
    if (lv) this.openLevelObject(lv);
  }

  /** `normalize` fixes a freshly opened level (bag placement); an untouched level stays "not edited" */
  normalize: (level: any) => void = () => {};
  private openLevelObject(lv: any) {
    const clean = !this.editedOthers.has(lv.id) && this.saved.get(lv.id) === JSON.stringify(lv);
    this.level = clone(lv);
    this.normalize(this.level);
    if (clean) this.saved.set(lv.id, JSON.stringify(this.level));
  }

  /** Replace the level being edited (paste JSON), keeping its id */
  replaceLevel(level: any) {
    level.id = this.level?.id ?? level.id;
    this.normalize(level);
    this.level = level;
  }

  newLevel(): any {
    this.keepEdits();
    if (!this.chapter) return null;
    const id = nextLevelId(this.chapter.id, this.chapter.levels.map(l => l.id));
    const lv = blankLevel(id);
    if (this.level) lv.container = clone(this.level.container);
    this.chapter.levels.push(lv);
    this.level = clone(lv);
    this.normalize(this.level);
    return this.level;
  }

  indexOfLevel(): number { return this.chapter && this.level ? this.chapter.levels.findIndex(l => l.id === this.level.id) : -1; }
  numberOfLevel(): number { return this.chapter ? levelNumber(this.book, this.chapter.id, Math.max(0, this.indexOfLevel())) : 1; }

  /**
   * The book ready to be written: level being edited copied back, version up, and each chapter's
   * assets list (items / backgrounds / bags the game preloads) recomputed (main.js chuanBiSach).
   */
  prepareBook(note = ''): Book {
    this.keepEdits();
    const b = this.book;
    b.version = (b.version || 0) + 1;
    b.publishedAt = new Date().toISOString();
    if (note) b.note = note;
    for (const ch of b.chapters) {
      const items = new Set<number>(), bgs = new Set<number>(), bags = new Set<string>();
      for (const lv of ch.levels) {
        for (const it of lv.items || []) items.add(Number(it.id));
        if (lv.background != null) bgs.add(Number(lv.background));
        if (lv.container?.skin) bags.add(lv.container.skin);
      }
      ch.assets = { items: Array.from(items).sort((a, c) => a - c), backgrounds: Array.from(bgs).sort((a, c) => a - c), bags: Array.from(bags).sort() };
    }
    return b;
  }

  /** After a successful save: everything counts as saved, the draft follows the new file */
  markSaved() {
    this.snapshot();
    if (this.level) this.saved.set(this.level.id, JSON.stringify(this.level));
    this.bookPrint = fingerprint(this.book);
    this.writeDraft(true);
  }

  /** Browser draft (survives a reload); `now` skips the 0.4 s debounce */
  writeDraft(now = false) {
    const write = () => {
      if (!this.book.chapters.length) return;
      this.keepEdits();
      const edited = Array.from(this.editedOthers);
      if (this.level && this.isEdited(this.level.id) && !edited.includes(this.level.id)) edited.push(this.level.id);
      LocalStore.setJson(DRAFT_KEY, { base: this.bookPrint, at: Date.now(), open: [this.chapter?.id, this.level?.id], edited, book: this.book });
    };
    clearTimeout(this.draftTimer);
    if (now) write(); else this.draftTimer = setTimeout(write, 400);
  }

  /** Remove the browser draft (start again from the project file) */
  dropDraft() { LocalStore.set(DRAFT_KEY, ''); }
}
