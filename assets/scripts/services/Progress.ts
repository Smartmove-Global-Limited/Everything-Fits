// Player progress (web src/game/progress.js, key snug.progress.v1): levels open in order inside a
// chapter, the next chapter opens when the previous one is fully done.
import { LocalStore } from './LocalStore';

const KEY = 'snug.progress.v1';
type Data = { chapter: string | null; level: number; done: Record<string, boolean[]> };
let data: Data = LocalStore.json<Data>(KEY, { chapter: null, level: 0, done: {} });
const save = () => LocalStore.setJson(KEY, data);
const doneList = (id: string) => (data.done[id] ||= []);

export const Progress = {
  isDone: (chapterId: string, idx: number) => !!doneList(chapterId)[idx],
  levelUnlocked(ch: any, idx: number) { return idx === 0 || this.isDone(ch.id, idx - 1); },
  /** Record a win; true when it is the first time this level is cleared */
  markDone(chapterId: string, idx: number) {
    const l = doneList(chapterId), first = !l[idx];
    l[idx] = true; save();
    return first;
  },
  /** Level the Play button opens */
  getSpot(chapters: any[]): { chapter: any; index: number } | null {
    const ch = chapters.find(c => c.id === data.chapter) || chapters[0];
    if (!ch) return null;
    const idx = Math.min(Math.max(0, data.level | 0), ch.levels.length - 1);
    return { chapter: ch, index: this.levelUnlocked(ch, idx) ? idx : this.nextOpen(ch) };
  },
  nextOpen(ch: any) {
    for (let i = 0; i < ch.levels.length; i++) if (!this.isDone(ch.id, i)) return i;
    return ch.levels.length - 1;
  },
  setSpot(chapterId: string, idx: number) { data.chapter = chapterId; data.level = idx | 0; save(); },
  /**
   * Testers' level picker (Settings): the player is now at this level, as if every level before it
   * was won (it is open, Play and Next go on from it, level-based rules see it)
   */
  jumpTo(chapterId: string, idx: number) {
    const l = doneList(chapterId);
    for (let i = 0; i < idx; i++) l[i] = true;
    data.chapter = chapterId; data.level = idx | 0; save();
  },
  reset() { data = { chapter: null, level: 0, done: {} }; save(); },
};
