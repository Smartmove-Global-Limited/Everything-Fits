// Dev check for every level: do packed items come to rest, or do they shake forever?
//
// For each level: open it, wait for the bag, place the items of the level's solution (all but the
// last, so the round is not won) like "Máy chơi" does, wait, then watch every item for a few
// seconds. An item is reported when it keeps moving back and forth in place (many direction changes,
// little net movement) or keeps moving a lot. The buzzing phone (physics "vibrating") moves on
// purpose and is only reported when it knocks the others about.
//
// Run it in the browser preview of Game.scene (DEV builds only), in the console:
//   await __ef.checkLevels()            every level of every chapter
//   await __ef.checkLevels([7, 8])      only levels 7 and 8 (numbers as shown in the game)
// It prints a table and returns the problems ([] = all good). Run it after adding or changing levels.
// Why items shook: wedged items were pushed back and forth by Box2D's position solver and never
// slept (see Settle.ts).
import { GameState } from '../core/GameState';
import { ContentLoader } from '../content/ContentLoader';
import { ItemPhysics } from './ItemView';
import { levelToFieldY } from '../core/GameConstants';
import { Progress } from '../services/Progress';
import { computeGhost, itemAABB } from './BagRules';
import { BagView } from './BagView';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Problem = { level: number; id: string; item: number; name: string; what: string };

export async function checkLevels(game: { openLevel(i: number): Promise<void> }, only?: number[]) {
  const S = GameState;
  const book = await ContentLoader.loadBook();
  const spot = Progress.getSpot(book.chapters);   // opening levels moves the saved spot: put it back
  const problems: Problem[] = [];
  const rows: any[] = [];
  for (const chapter of book.chapters) {
    S.chapter = chapter; S.chapterId = chapter.id;
    for (let i = 0; i < chapter.levels.length; i++) {
      const number = ContentLoader.levelNumber(chapter.id, i);
      if (only && !only.includes(number)) continue;
      await game.openLevel(i);
      for (let t = 0; !S.bagReady && t < 100; t++) await sleep(100);
      await sleep(1500);
      const sol: any[] = S.level.solution || [];
      for (let k = 0; k < sol.length - 1; k++) {
        const s = sol[k], it = S.items[s.i];
        if (!it) continue;
        it.node.setPosition(s.x, levelToFieldY(s.y - S.bagLift), 0);
        it.node.angle = -s.angle * 180 / Math.PI;
        it.stop(); it.body.wakeUp();
        await sleep(300);
      }
      await sleep(4000);   // time to settle (and fall asleep, see Settle.ts)
      const found = await watch(3000);
      const levelProblems = found.map(f => ({ level: number, id: S.level.id || String(i), ...f }));
      problems.push(...levelProblems);
      rows.push({
        level: number, id: S.level.id || '', bag: S.level.container?.skin, items: S.items.length,
        solution: sol.length ? 'yes' : 'NO (nothing checked in the bag)',
        resting: `${S.items.filter(it => !it.body.isAwake()).length}/${S.items.length}`,
        result: levelProblems.length ? levelProblems.map(p => `${p.item} ${p.what}`).join('; ') : 'ok',
      });
    }
  }
  if (spot) Progress.setSpot(spot.chapter.id, spot.index);
  console.table(rows);
  console.log(problems.length ? `checkLevels: ${problems.length} problem(s)` : 'checkLevels: all levels come to rest');
  return problems;
}

/** Watch every item on the field; items that shake in place or keep moving */
async function watch(ms: number) {
  const items = GameState.items.filter(it => it.node.activeInHierarchy && !it.waiting);
  const st = items.map(it => ({ x0: it.node.position.x, y0: it.node.position.y, x: it.node.position.x, y: it.node.position.y, a: it.node.eulerAngles.z, path: 0, turn: 0, flips: 0, last: 0 }));
  const t0 = performance.now();
  let frames = 0;
  while (performance.now() - t0 < ms) {
    await sleep(16); frames++;
    items.forEach((it, k) => {
      const s = st[k], p = it.node.position, a = it.node.eulerAngles.z;
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      s.path += Math.hypot(dx, dy); s.turn += Math.abs(a - s.a);
      if (Math.abs(d) > .02) { if (s.last && Math.sign(d) !== Math.sign(s.last)) s.flips++; s.last = d; }
      s.x = p.x; s.y = p.y; s.a = a;
    });
  }
  const perSecond = 1000 / ms;
  const out: { item: number; name: string; what: string }[] = [];
  items.forEach((it, k) => {
    const s = st[k], net = Math.hypot(s.x - s.x0, s.y - s.y0);
    const phone = it.physicsType === ItemPhysics.VIBRATING;
    const shaking = s.flips * perSecond >= 6 && s.path >= 3;               // back and forth in place
    const restless = s.path >= (phone ? 120 : 40) || s.turn >= (phone ? 360 : 90);   // keeps moving / spinning
    if (!shaking && !restless) return;
    if (phone && !restless) return;                                        // the phone buzzes on purpose
    out.push({
      item: it.itemId, name: it.nameEn || it.nameVi,
      what: `${shaking ? 'shakes' : 'moves'}: ${s.path.toFixed(0)} units, ${s.turn.toFixed(0)}°, ${s.flips} turns back, net ${net.toFixed(1)} in ${ms / 1000}s`,
    });
  });
  void frames;
  return out;
}

/**
 * Every item, not only the ones the levels use: items are dropped into a bag in groups, one after
 * another like a player does, then watched. Each group is tried in several bag shapes (straight,
 * slanted and rounded walls).
 *   await __ef.checkItems()                                   all items, default bags
 *   await __ef.checkItems({ ids: [12, 40], bags: ['ctr14'] }) some items / bags
 * Takes about 12 s per group and bag. Prints a table and returns the problems.
 */
export async function checkItems(game: { openLevel(i: number): Promise<void> },
  opts: { ids?: number[]; bags?: string[]; group?: number; scale?: number } = {}) {
  const S = GameState;
  const ids = opts.ids || await ContentLoader.itemIds();
  const bags = opts.bags || ['shopping', 'ctr12', 'ctr14', 'ctr41'];   // straight, hexagon, triangle, shield
  const size = opts.group || 8, scale = opts.scale || 1.2;
  const savedChapter = S.chapter, savedId = S.chapterId;
  const spot = Progress.getSpot((await ContentLoader.loadBook()).chapters);
  const problems: Problem[] = [];
  const rows: any[] = [];
  for (const skin of bags) {
    for (let g = 0; g < ids.length; g += size) {
      const group = ids.slice(g, g + size);
      // a throw-away level: the items lie on the tray, then go into the bag one by one
      const level = { id: `check-${skin}-${g / size + 1}`, timer: 999, container: { skin, scale: 1.2, cx: 210 },
        items: group.map((id, k) => ({ id, x: 40 + (k % 4) * 110, y: 560 + Math.floor(k / 4) * 40, angle: 0, scale })) };
      S.chapter = { id: 'check', levels: [level] }; S.chapterId = 'check';
      await game.openLevel(0);
      for (let t = 0; !S.bagReady && t < 100; t++) await sleep(100);
      await sleep(800);
      const bag = S.bag;
      if (!bag) continue;
      let placed = 0;
      for (const it of S.items) {
        if (dropLikeAPlayer(it, bag)) placed++;
        await sleep(450);
      }
      await sleep(4000);
      const found = await watch(3000);
      problems.push(...found.map(f => ({ level: 0, id: level.id, ...f })));
      rows.push({ bag: skin, items: group.join(' '), inBag: `${placed}/${S.items.length}`, resting: `${S.items.filter(it => !it.body.isAwake()).length}/${S.items.length}`,
        result: found.length ? found.map(p => `${p.item} ${p.what}`).join('; ') : 'ok' });
    }
  }
  S.chapter = savedChapter; S.chapterId = savedId;
  if (spot) Progress.setSpot(spot.chapter.id, spot.index);
  console.table(rows);
  console.log(problems.length ? `checkItems: ${problems.length} problem(s)` : 'checkItems: every group comes to rest');
  return problems;
}

/**
 * Drop one item into the bag the way a player can: only where it overlaps nothing (the same exact
 * shape test as dragging, BagRules.computeGhost), top rows of the bag first so it falls onto the
 * pile. No free spot: the item stays on the tray. Teleporting into occupied spots would wedge items
 * into each other, which a player can never do (the drop turns red), and fake the shaking.
 */
function dropLikeAPlayer(it: any, bag: BagView): boolean {
  const old = it.node.position.clone(), oldAngle = it.node.angle;
  const rows = 8, cols = 7;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols * 2; k++) {
      const x = bag.minX + 12 + Math.random() * Math.max(1, bag.maxX - bag.minX - 24);
      const y = bag.maxY - 12 - r * (bag.maxY - bag.minY) / rows;
      it.node.setPosition(x, y, 0);
      it.node.angle = [0, 90, -90, 180][k % 4] + (Math.random() - .5) * 20;
      itemAABB(it);
      if (!computeGhost(it)) { it.stop(); it.body.wakeUp(); return true; }
    }
  }
  it.node.setPosition(old); it.node.angle = oldAngle; it.stop();
  return false;
}
