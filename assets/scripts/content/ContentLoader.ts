// Loads game content shipped inside the app, from the asset bundle "content" (assets/gamecontent):
// levels.json from the web Level Editor, item prefabs and bag prefabs. The bundle is opened the
// first time something is asked for, and only what a level uses is loaded (never a whole chapter):
// the app starts without reading the catalogue of every item and bag. Everything is cached;
// nothing touches the network.
import { assetManager, AssetManager, JsonAsset, Prefab, SpriteFrame } from 'cc';

const prefabCache = new Map<string, Prefab>();
let book: any = null;
let bundle: Promise<AssetManager.Bundle> | null = null;

function openBundle(): Promise<AssetManager.Bundle> {
  return bundle ||= new Promise((ok, fail) => assetManager.loadBundle('content', (err, b) => {
    if (err) { bundle = null; fail(err); } else ok(b);
  }));
}

async function load<T>(path: string, type: any): Promise<T> {
  const b = await openBundle();
  return new Promise((ok, fail) => b.load(path, type, (err, asset) => (err ? fail(err) : ok(asset as T))));
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

  /** Load the bag and items of one level (a level object of levels.json), so it opens without hitches */
  async preloadLevel(level: any) {
    if (!level) return;
    const ids: number[] = (level.items || []).map((it: any) => it.id);
    const skin: string | undefined = level.container?.skin;
    await Promise.all([...[...new Set(ids)].map(id => this.itemPrefab(id).catch(() => null)), skin ? this.bagPrefab(skin).catch(() => null) : null]);
  },

  spriteFrame(path: string) { return load<SpriteFrame>(`${path}/spriteFrame`, SpriteFrame); },
};
