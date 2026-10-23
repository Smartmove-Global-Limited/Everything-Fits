// levels.json helpers used when adding designed levels to a chapter. Port of the merge rules of
// snug/tools/thietke-tam/gop-level.mjs (background rotation, chapter asset lists).
import type { Chapter } from './types';

/**
 * Background of level number n (1-based, counted across the chapter): levels 1–9 keep the first
 * background (beige paper, id 1), from level 10 the other backgrounds rotate (2..10 for 10 ids).
 * `ids` = available background ids in index order (default 1..10).
 */
export function backgroundForLevel(n: number, ids: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]): number {
  if (n < 10 || ids.length < 2) return ids[0];
  return ids[1 + ((n - 10) % (ids.length - 1))];
}

/** Recompute chapter.assets (items / backgrounds / bags the game preloads) from its levels */
export function computeChapterAssets(ch: Chapter): { items: number[]; backgrounds: number[]; bags: string[] } {
  const items = new Set<number>(), bags = new Set<string>(), bgs = new Set<number>();
  // backgrounds are numeric ids in levels.json
  for (const lv of ch.levels) { lv.items.forEach(it => items.add(it.id)); bags.add(lv.container.skin); bgs.add(lv.background as number); }
  return { items: Array.from(items).sort((a, b) => a - b), backgrounds: Array.from(bgs).sort((a, b) => a - b), bags: Array.from(bags).sort() };
}
