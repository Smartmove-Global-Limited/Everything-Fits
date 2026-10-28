// Loads game content shipped inside the app, from the asset bundle "content" (assets/gamecontent):
// levels.json from the web Level Editor, item prefabs and bag prefabs. The bundle is opened the
// first time something is asked for, and only what a level uses is loaded (never a whole chapter):
// the app starts without reading the catalogue of every item and bag. Everything is cached.
// Levels: the levels.json shipped with the app is the default; on Android the Remote Config key
// "levels" (the same file, as JSON) replaces it whenever it holds a valid book (see remoteBook).
import { assetManager, AssetManager, JsonAsset, Prefab, SpriteFrame } from 'cc';
import { RemoteConfig } from '../services/RemoteConfig';
import { NativeBridge } from '../services/NativeBridge';

const prefabCache = new Map<string, Prefab>();
const backgroundCache = new Map<string, SpriteFrame | null>();
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

/**
 * The levels from Remote Config ("levels", the latest fetched value; Android only), or null to
 * keep the app's own. Only a broken book is refused (not JSON, no chapters / levels). What the
 * installed app lacks is dealt with while playing: a missing item is left out of its level (and
 * not counted), a missing bag becomes the backpack, a missing background the default one. A level
 * none of whose items exist here is dropped (it could never be won).
 */
async function remoteBook(): Promise<any> {
  if (!NativeBridge.android) return null;            // the Level Editor and the web play the files
  const raw = RemoteConfig.values.levels;
  if (!raw || !raw.trim()) return null;
  let b: any;
  try { b = JSON.parse(raw); } catch { console.warn('[levels] Remote Config levels is not JSON: ignored'); return null; }
  if (!Array.isArray(b?.chapters)) { console.warn('[levels] Remote Config levels has no chapters: ignored'); return null; }
  const content = await openBundle().catch(() => null);
  const hasItem = (id: any) => !!content?.getInfoWithPath(`items/${id}`);
  const dropped: string[] = [];
  b.chapters = b.chapters.filter((ch: any) => {
    if (!ch?.id || !Array.isArray(ch.levels)) return false;
    ch.levels = ch.levels.filter((L: any, i: number) => {
      const ok = L && typeof L === 'object' && Array.isArray(L.items) && L.items.some((it: any) => it && it.id !== 0 && hasItem(it.id));
      if (!ok) dropped.push(`${ch.id} #${i + 1}`);
      if (ok && (!L.container || typeof L.container !== 'object')) L.container = { skin: 'backpack' };
      return ok;
    });
    return ch.levels.length > 0;
  });
  if (dropped.length) console.warn('[levels] Remote Config levels without any item of this app, left out:', dropped.join(', '));
  if (!b.chapters.length) { console.warn('[levels] Remote Config levels has no playable level: ignored'); return null; }
  return b;
}

export const ContentLoader = {
  async loadBook(): Promise<any> {
    if (book) return book;
    const json = await load<JsonAsset>('content/cozy/levels', JsonAsset);
    book = (await remoteBook()) || json.json;
    console.log(`[levels] v${book?.version} (${book === json.json ? 'in the app' : 'Remote Config'})`);
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

  /** Load the bag, items and background of one level (a level object of levels.json), so it opens without hitches */
  async preloadLevel(level: any) {
    if (!level) return;
    const ids: number[] = (level.items || []).map((it: any) => it?.id).filter((id: any) => id != null);
    if ((level.items || []).some((it: any) => it?.locked)) ids.push(-1);   // the mystery box
    const skin: string | undefined = level.container?.skin;
    await Promise.all([...Array.from(new Set(ids)).map(id => this.itemPrefab(id).catch(() => null)), skin ? this.bagPrefab(skin).catch(() => null) : null,
      this.background(level.background)]);
  },

  /**
   * Picture of a level background (levels.json "background" id → content index → background json →
   * its first layer). Cached; an unknown or broken id gives the default background (1).
   */
  async background(id: number): Promise<SpriteFrame | null> {
    const key = String(id || 1);
    const hit = backgroundCache.get(key);
    if (hit !== undefined) return hit;
    let frame: SpriteFrame | null = null;
    try {
      const index = (await load<JsonAsset>('content/cozy/assets/index', JsonAsset)).json as any;
      const defPath: string | undefined = index.backgrounds?.[key];
      if (defPath) {
        const def = (await load<JsonAsset>('content/cozy/' + defPath.replace(/\.json$/, ''), JsonAsset)).json as any;
        const src: string | undefined = def.layers?.[0]?.src;
        if (src) frame = await load<SpriteFrame>('content/cozy/' + src.replace(/\.[a-z]+$/i, '') + '/spriteFrame', SpriteFrame);
      }
    } catch { frame = null; }
    // an unknown / broken background: the default one (1), never the previous level's picture
    if (!frame && key !== '1') frame = await this.background(1);
    backgroundCache.set(key, frame);
    return frame;
  },

  /** Ids of every item shipped (content index), for dev checks */
  async itemIds(): Promise<number[]> {
    const index = await load<JsonAsset>('content/cozy/assets/index', JsonAsset);
    return Object.keys((index.json as any).items || {}).map(Number).filter(n => n > 0).sort((a, b) => a - b);
  },

  /** Any asset of the content bundle by path (dev tools / Level Editor) */
  asset<T>(path: string, type: any): Promise<T> { return load<T>(path, type); },
  /** Several assets of the content bundle in one request; failed ones come back null */
  assets<T>(paths: string[], type: any): Promise<(T | null)[]> {
    return openBundle().then(b => new Promise(ok => b.load(paths, type, (_e, list: any) => ok((list || paths.map(() => null)) as (T | null)[]))));
  },

  spriteFrame(path: string) { return load<SpriteFrame>(`${path}/spriteFrame`, SpriteFrame); },
};
