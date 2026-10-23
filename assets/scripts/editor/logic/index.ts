/**
 * Level-editor logic (pure TypeScript, no 'cc' imports, no DOM, no top-level side effects).
 * Ported from the web game repo `snug` so the Cocos Level Editor produces levels identical to the
 * web editor (same math, constants and JSON formats as public/content/<art>/levels.json).
 *
 * Modules:
 *   types.ts        TS types: Level, Container, Block, BagSkin, LevelItem, SolutionStep, ItemDef, ItemManifest…
 *   geom.ts         src/util/geom.js — polygonArea, pointInPolygon, bbox, convexHull, simplify, isConvex, mulberry32…
 *   blocks.ts       src/data/blocks.js — blockPoly, blockArea, blocksArea, BLOCK_KINDS, BLOCK_COLOR, darker
 *   bag.ts          src/data/bag.js — isFixedSkin, fixedShape, fixedWalls, resolveContainer, placeFixed,
 *                   fitScreenScale (vuaManHinh), maxScale, MIN_SCALE, BAG_FLOOR/BAG_CEIL
 *   items.ts        src/data/items.js + data/collider.js + content/loader.js applyManifest + game/physics.js
 *                   itemArea: ItemCatalog (built from manifest JSON), applyCollider, effectiveScale
 *                   (coTrongLevel), labelOf, boxArea, itemArea
 *   itemsLegacy.ts  built-in ITEM_DEFS table of the web game (data)
 *   difficulty.ts   src/gen/difficulty.js — difficulty, tierOf, containerArea, containerComplexity
 *   solver.ts       src/gen/solver.js — itemPolygons (hinhMon), rotateScale (xoay), solve, solveAsync
 *   solution.ts     src/gen/solution.js — validSolution (loiGiaiHopLe), bottomEdge (mepDuoi), placementOrder (thuTuDat)
 *   designer.ts     src/editor/thietke.js — LevelDesigner: setBag, mask (matNa), placeOne (datMot),
 *                   buildGreedy (xay), fillGaps (lap2), growInPlace (bom), layoutTray (khay),
 *                   buildLevel (thanhLevel), measureGap, selectPool, autoDesign; shrinkLevel (thuNho)
 *   generator.ts    src/gen/generator.js — template generator: generate, layoutTray, tierNames
 *   book.ts         tools/thietke-tam/gop-level.mjs — backgroundForLevel, computeChapterAssets
 *
 * Runtime data (item manifests, bag skins) is passed in by the caller:
 *   const catalog = new ItemCatalog(manifests);          // manifests: parsed items/<id>.json
 *   const designer = new LevelDesigner(catalog, skins);  // skins: { [key]: parsed bags/<key>.json }
 *   const d = await designer.autoDesign({ bagKey: 'ctr13', usage, levelId: 'sd-32', levelNumber: 31,
 *     background: backgroundForLevel(31), onProgress, signal, verify: async (design, level) => box2dCheck(level) });
 *   const level = d?.level;   // or designer.buildLevel(d, id, n, { background })
 */
export * from './types';
export * from './geom';
export * from './blocks';
export * from './bag';
export * from './items';
export { createLegacyItemDefs, createMysteryDef } from './itemsLegacy';
export * from './difficulty';
export * from './solver';
export * from './solution';
export * from './designer';
export * from './generator';
export * from './book';
