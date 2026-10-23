// Everything the Level Editor knows about the content: item manifests, bag skins and backgrounds
// (content bundle: content/cozy/assets/index.json and the files it lists), and their pictures,
// loaded on demand and cached. Item manifests can be replaced at runtime (Art library saves).
import { JsonAsset, SpriteFrame } from 'cc';
import { ContentLoader } from '../content/ContentLoader';

const ROOT = 'content/cozy/';
const noExt = (p: string) => p.replace(/\.[a-z]+$/i, '');

export type ItemManifest = {
  id: number; slug: string; code?: string; name: string; nameEn?: string;
  meta: { size: string; shape: string; physics: string; cost?: number; canLink?: boolean; canLock?: boolean; gram?: number; material?: string };
  sprite: { src: string; pixelsPerUnit: number };
  collider: { kind: string; pts?: number[][]; parts?: number[][][]; outer?: number[][]; r?: number; box?: number[] };
  outline?: number[][];
};
export type BagSkin = { id: string; name?: string; nameEn?: string; fixed?: boolean; pixelsPerUnit?: number; inner?: number[][]; walls?: any[]; image?: { x: number; y: number; w: number; h: number }; layers?: { body?: string; frame?: string }; thuTu?: number; [k: string]: any };
export type Background = { id: number; name: string; fill?: string; layers?: { src: string }[] };
/** A picture ready for a 2D canvas (the page's board, thumbnails): the bundle's image and the
 *  trimmed part of it the sprite frame uses, with the untrimmed size and the trim offset */
export type Picture = { img: CanvasImageSource; url: string; sx: number; sy: number; sw: number; sh: number; ow: number; oh: number; ox: number; oy: number };

export class EditorCatalog {
  items = new Map<number, ItemManifest>();
  bags = new Map<string, BagSkin>();
  backgrounds = new Map<number, Background>();
  private frames = new Map<string, Promise<SpriteFrame | null>>();
  private paths = new Map<number, string>();
  private pics = new Map<string, Picture | null>();
  /** called when a picture asked for with picture() has loaded (draw again) */
  onPicture: (() => void) | null = null;

  async load() {
    const index = (await ContentLoader.asset<JsonAsset>(ROOT + 'assets/index', JsonAsset)).json as any;
    const itemIds = Object.keys(index.items || {});
    const itemJson = await ContentLoader.assets<JsonAsset>(itemIds.map(k => ROOT + noExt(index.items[k])), JsonAsset);
    itemIds.forEach((k, i) => { const j = itemJson[i]?.json as ItemManifest | undefined; if (j) this.items.set(Number(k), j); this.paths.set(Number(k), index.items[k]); });
    const bagIds = Object.keys(index.bags || {});
    const bagJson = await ContentLoader.assets<JsonAsset>(bagIds.map(k => ROOT + noExt(index.bags[k])), JsonAsset);
    bagIds.forEach((k, i) => { const j = bagJson[i]?.json as BagSkin | undefined; if (j) this.bags.set(k, { ...j, id: j.id || k }); });
    const bgIds = Object.keys(index.backgrounds || {});
    const bgJson = await ContentLoader.assets<JsonAsset>(bgIds.map(k => ROOT + noExt(index.backgrounds[k])), JsonAsset);
    bgIds.forEach((k, i) => { const j = bgJson[i]?.json as Background | undefined; if (j) this.backgrounds.set(Number(k), { ...j, id: Number(k) }); });
  }

  /** Where an item manifest lives in the project */
  manifestPath(id: number) { const p = this.paths.get(id); return p ? 'assets/gamecontent/content/cozy/' + p : ''; }

  /** Picture of a content file (path as written in the manifests: assets/…/x.png) */
  frame(src: string | undefined): Promise<SpriteFrame | null> {
    if (!src) return Promise.resolve(null);
    let p = this.frames.get(src);
    if (!p) { p = ContentLoader.asset<SpriteFrame>(ROOT + noExt(src) + '/spriteFrame', SpriteFrame).catch(() => null); this.frames.set(src, p); }
    return p;
  }
  itemFrame(id: number) { return this.frame(this.items.get(id)?.sprite.src); }

  /** The picture of a content file now, or null while it loads (then onPicture is called) */
  picture(src: string | undefined): Picture | null {
    if (!src) return null;
    if (this.pics.has(src)) return this.pics.get(src)!;
    this.pics.set(src, null);
    this.frame(src).then(f => {
      const im: any = f?.texture && (f.texture as any).image;
      if (!f || !im?.data) return;
      const r = f.rect, o = f.originalSize;
      this.pics.set(src, { img: im.data, url: im.nativeUrl, sx: r.x, sy: r.y, sw: r.width, sh: r.height, ow: o.width, oh: o.height, ox: f.offset.x, oy: f.offset.y });
      this.onPicture?.();
    });
    return null;
  }
  itemPicture(id: number) { return this.picture(this.items.get(id)?.sprite?.src); }
  bagPicture(skin: string) { return this.picture(this.bags.get(skin)?.layers?.body); }
  bagFrame(skin: string) { return this.frame(this.bags.get(skin)?.layers?.body); }

  /** Outline of an item's real collision shape in its own units (draw.js vienHinh) */
  outline(id: number): number[][] {
    const m = this.items.get(id); if (!m) return [];
    const c = m.collider;
    if (c.kind === 'poly' && c.pts?.length) return c.pts;
    if ((c.kind === 'polys' || c.kind === 'compound') && c.outer?.length) return c.outer;
    if (c.kind === 'circle' && c.r) { const out: number[][] = []; for (let i = 0; i < 20; i++) out.push([Math.cos(i / 20 * 2 * Math.PI) * c.r, Math.sin(i / 20 * 2 * Math.PI) * c.r]); return out; }
    if (m.outline?.length) return m.outline;
    const b = c.box || [-20, -20, 20, 20];
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  }
  /** Fixed bags (with pictures), in catalogue order (main.js refreshPickers) */
  fixedBags(): BagSkin[] { return Array.from(this.bags.values()).filter(b => b.fixed).sort((a, b) => (a.thuTu ?? 99) - (b.thuTu ?? 99)); }
}
