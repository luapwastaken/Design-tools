import type { Item } from './types.ts';

/**
 * Every copy of every item that shows inside a region when the w × h tile repeats: the tile itself
 * by default, so an item over an edge or a corner also appears on the far side(s) and the tile
 * clipped to its edges repeats with no cut shapes; or a whole artboard from the tile's top left.
 * `reach` is how far an item's artwork can extend from its centre; an item further out than a whole
 * tile (jitter, a tiny tile) still lands wherever it shows.
 */
export function wrapItems(items: Item[], w: number, h: number, reach: (item: Item) => number, region = { w, h }): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    const r = reach(it);
    // the repeats i, j whose copy overlaps the region: -r < x + i·w < region.w + r
    const i0 = Math.floor((-r - it.x) / w) + 1;
    const i1 = Math.ceil((region.w + r - it.x) / w) - 1;
    const j0 = Math.floor((-r - it.y) / h) + 1;
    const j1 = Math.ceil((region.h + r - it.y) / h) - 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) out.push(i || j ? { ...it, x: it.x + i * w, y: it.y + j * h } : it);
    }
  }
  return out;
}
