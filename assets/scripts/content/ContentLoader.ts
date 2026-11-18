// Loads game content shipped inside the app, from the asset bundle "content" (assets/gamecontent):
// levels.json from the web Level Editor, item prefabs and bag prefabs. The bundle is opened the
// first time something is asked for, and only what a level uses is loaded (never a whole chapter):
// the app starts without reading the catalogue of every item and bag. Everything is cached.
// Levels: the levels.json shipped with the app is the default; on Android the Remote Config key
// "levels" (the same file, as JSON) replaces it whenever it holds a valid book (see remoteBook).
import { assetManager, AssetManager, JsonAsset, Prefab, SpriteFrame, sys } from 'cc';
import { RemoteConfig } from '../services/RemoteConfig';
import { NativeBridge } from '../services/NativeBridge';

const prefabCache = new Map<string, Prefab>();
const backgroundCache = new Map<string, SpriteFrame | null>();
let book: any = null;
let appBook: any = null;   // levels.json shipped in the app
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

/** Store page of the game, opened when the levels need a newer app (see needsUpdate) */
const STORE_URL = 'https://play.google.com/store/apps/details?id=everything.fits.packing.puzzle.organize';
/** Remote Config has levels this app cannot play (they use items or bags of a newer app) */
let needsUpdate = false;

/**
 * The levels from Remote Config ("levels", the latest fetched value; Android only), or null to
 * keep the app's own. Only a broken book is refused (not JSON, no chapters / levels). Levels are
 * played in order, so the book stops at the first level that needs an item or a bag this app does
 * not ship (new items come with a new app version): the levels before it stay, that one and every
 * one after it are left out, and needsUpdate is set, so after the last playable level Play and the
 * win popup's Continue ask for an update instead of "Coming Soon". Nothing moves: level numbers
 * and saved progress stay the same as on an updated app. A missing background becomes the default.
 */
async function remoteBook(): Promise<any> {
  if (!NativeBridge.android) return null;            // the Level Editor and the web play the files
  const raw = RemoteConfig.values.levels;
  if (!raw || !raw.trim()) return null;
  let b: any;
  try { b = JSON.parse(raw); } catch { console.warn('[levels] Remote Config levels is not JSON: ignored'); return null; }
  if (!Array.isArray(b?.chapters)) { console.warn('[levels] Remote Config levels has no chapters: ignored'); return null; }
  const content = await openBundle().catch(() => null);
  if (!content) return null;
  return cutAtMissing(b, path => !!content.getInfoWithPath(path));
}

/**
 * The book up to (not including) its first level that is broken or needs an item / bag `has` does
 * not know; null when not even its first level is playable. Sets needsUpdate when levels were cut.
 */
function cutAtMissing(b: any, has: (path: string) => boolean): any {
  const playable = (L: any) => {
    if (!L || typeof L !== 'object' || !Array.isArray(L.items)) return false;
    const ids = L.items.map((it: any) => it?.id).filter((id: any) => id != null && id !== 0);
    if (!ids.length || !ids.every((id: any) => has(`items/${id}`))) return false;
    const skin = L.container?.skin;
    return !skin || has(`bags/${skin}`);
  };
  const chapters: any[] = [];
  for (const ch of b.chapters) {
    if (!ch?.id || !Array.isArray(ch.levels)) continue;
    const stop = ch.levels.findIndex((L: any) => !playable(L));
    if (stop < 0) { chapters.push(ch); continue; }
    console.warn(`[levels] Remote Config: ${ch.id} #${stop + 1} needs a newer app (items / bag not shipped); the levels stop before it`);
    needsUpdate = true;
    if (stop > 0) { ch.levels = ch.levels.slice(0, stop); chapters.push(ch); }
    break;
  }
  for (const ch of chapters) for (const L of ch.levels) if (!L.container || typeof L.container !== 'object') L.container = { skin: 'backpack' };
  b.chapters = chapters;
  if (!chapters.length) { console.warn('[levels] Remote Config levels has no playable level: ignored'); needsUpdate = false; return null; }
  return b;
}

export const ContentLoader = {
  async loadBook(): Promise<any> {
    if (book) return book;
    const json = await load<JsonAsset>('content/cozy/levels', JsonAsset);
    // Remote Config wins unless the app ships a newer book (version number), so a build with new
    // levels can be tested on the phone before the same levels are pasted into Remote Config
    const remote = await remoteBook();
    if (remote && Number(remote.version) < Number(json.json?.version)) console.log(`[levels] Remote Config v${remote.version} is older than the app\x27s v${json.json?.version}: the app\x27s levels are used`);
    appBook = json.json;
    book = remote && !(Number(remote.version) < Number(json.json?.version)) ? remote : json.json;
    console.log(`[levels] v${book?.version} (${book === json.json ? 'in the app' : 'Remote Config'})`);
    return book;
  },
  get book() { return book; },
  /** The levels go on in a newer app version: after the last level here, ask for an update */
  get needsUpdate() { return needsUpdate && book !== null && book !== appBook; },
  /** Open the game's store page (the update) */
  openStore() { sys.openURL(STORE_URL); },
  /** The cut on its own (tests): a book against a test of shipped paths */
  cutAtMissing,
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

  /** Prefab paths a level uses (items, mystery box, bag), as cached by prefab() */
  levelPaths(level: any): string[] {
    if (!level) return [];
    const out = (level.items || []).filter((it: any) => it?.id != null).map((it: any) => `items/${it.id}`);
    if ((level.items || []).some((it: any) => it?.locked)) out.push('items/-1');   // the mystery box
    if (level.container?.skin) out.push(`bags/${level.container.skin}`);
    return out;
  },

  /**
   * Release the item and bag prefabs (with their pictures) not in `keep`. Nothing was ever released
   * before: playing levels 37-50 in a row kept ~260 item pictures (~170 MB of textures) and weak
   * phones lagged on the last levels, while opening level 50 straight away did not. Their pooled
   * nodes must be destroyed first (LevelBuilder.trimPools).
   */
  releaseExcept(keep: Set<string>) {
    for (const [path, p] of Array.from(prefabCache)) {
      if (keep.has(path) || !(path.startsWith('items/') || path.startsWith('bags/'))) continue;
      prefabCache.delete(path);
      if (p.isValid) assetManager.releaseAsset(p);
    }
  },

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
