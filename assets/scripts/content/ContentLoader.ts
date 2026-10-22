// Loads game content shipped inside the app (assets/resources): levels.json from the web Level
// Editor, item prefabs and bag prefabs. Everything is cached; nothing touches the network.
import { resources, JsonAsset, Prefab, SpriteFrame } from 'cc';

const prefabCache = new Map<string, Prefab>();
let book: any = null;

function load<T>(path: string, type: any): Promise<T> {
  return new Promise((ok, fail) => resources.load(path, type, (err, asset) => (err ? fail(err) : ok(asset as T))));
}

export const ContentLoader = {
  async loadBook(): Promise<any> {
    if (book) return book;
    const json = await load<JsonAsset>('content/cozy/levels', JsonAsset);
    book = json.json;
    return book;
  },
  get book() { return book; },
  chapters(): any[] { return book?.chapters || []; },
  chapterById(id: string) { return this.chapters().find((c: any) => c.id === id) || this.chapters()[0] || null; },

  /** Level number shown to the player: counted continuously across chapters */
  levelNumber(chapterId: string, index: number): number {
    let n = 0;
    for (const c of this.chapters()) { if (c.id === chapterId) return n + index + 1; n += c.levels?.length || 0; }
    return index + 1;
  },

  async prefab(path: string): Promise<Prefab> {
    const hit = prefabCache.get(path);
    if (hit) return hit;
    const p = await load<Prefab>(path, Prefab);
    prefabCache.set(path, p);
    return p;
  },
  itemPrefab(id: number) { return this.prefab(`items/${id}`); },
  bagPrefab(skin: string) { return this.prefab(`bags/${skin}`); },

  /** Preload every prefab a chapter needs so the round starts without hitches */
  async preloadChapter(ch: any) {
    const ids: number[] = ch?.assets?.items || [];
    const bags: string[] = ch?.assets?.bags || [];
    await Promise.all([...ids.map(id => this.itemPrefab(id).catch(() => null)), ...bags.map(b => this.bagPrefab(b).catch(() => null))]);
  },

  spriteFrame(path: string) { return load<SpriteFrame>(`${path}/spriteFrame`, SpriteFrame); },
};
