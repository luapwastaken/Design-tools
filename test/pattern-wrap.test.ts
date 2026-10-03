// Seams by rasterising: the tile's items and their wrapped copies, clipped to the tile, must cover
// every point exactly as the endless pattern does. Shapes are the slots' artwork boxes, turned,
// with a pure point-in-shape check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTile, reachOf } from '../src/shared/pattern/layout.ts';
import type { Arrangement, Item, PatternDoc, ShapeSlot } from '../src/shared/pattern/types.ts';
import { wrapItems } from '../src/shared/pattern/wrap.ts';

const slot = (id: string, w: number, h: number): ShapeSlot => ({
  id,
  svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  name: id,
  weight: 1,
  recolour: false,
  colour: null,
  bounds: { x: 0, y: 0, w, h },
});
const SLOTS = [slot('sq', 100, 100), slot('wide', 300, 100), slot('tall', 20, 100)];

const doc = (over: Partial<PatternDoc>): PatternDoc => ({
  slots: SLOTS,
  arrangement: 'grid',
  cols: 3,
  rows: 3,
  gapX: 6,
  gapY: 10,
  sizeMin: 30,
  sizeMax: 70,
  rotation: { mode: 'random', angle: 0, min: 0, max: 360 },
  jitter: 14,
  seed: 3,
  background: null,
  palette: [],
  paletteMode: 'by-slot',
  exportUnit: 'px',
  dpi: 96,
  artboard: { w: 100, h: 100 },
  ...over,
});

/** is (x, y) inside the item's artwork box, turned and scaled? */
function covers(it: Item, x: number, y: number): boolean {
  const s = SLOTS.find((q) => q.id === it.slot)!.bounds;
  const long = Math.max(s.w, s.h);
  const a = (-it.rotation * Math.PI) / 180;
  const [dx, dy] = [x - it.x, y - it.y];
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= (it.size * s.w) / long / 2 && Math.abs(ly) <= (it.size * s.h) / long / 2;
}

/** sample points across the tile, dense at the edges and corners where seams break */
function samples(w: number, h: number): [number, number][] {
  const along = (len: number) => [...Array.from({ length: 61 }, (_, i) => (i / 60) * len), 0.01, 0.5, len - 0.5, len - 0.01].filter((v) => v < len);
  return along(w).flatMap((x) => along(h).map((y): [number, number] => [x, y]));
}

/** how many copies the wrap added */
function assertSeamless(d: PatternDoc, what: string): number {
  const t = layoutTile(d);
  const reach = reachOf(d.slots);
  const wrapped = wrapItems(t.items, t.width, t.height, reach);
  // the endless pattern near the tile: every repeat of every item within a whole shape's length (a
  // looser test than the reach, so a reach too short fails here), far enough out to catch any jitter
  const far = Math.ceil((d.jitter + d.sizeMax) / Math.min(t.width, t.height)) + 1;
  const pattern: Item[] = [];
  for (const it of t.items) {
    for (let i = -far; i <= far; i++) {
      for (let j = -far; j <= far; j++) {
        const [x, y] = [it.x + i * t.width, it.y + j * t.height];
        if (Math.abs(x - t.width / 2) < t.width / 2 + d.sizeMax && Math.abs(y - t.height / 2) < t.height / 2 + d.sizeMax) pattern.push({ ...it, x, y });
      }
    }
  }
  for (const [x, y] of samples(t.width, t.height)) {
    const shown = wrapped.filter((it) => covers(it, x, y)).length;
    const truth = pattern.filter((it) => covers(it, x, y)).length;
    assert.equal(shown, truth, `${what}: at (${x.toFixed(2)}, ${y.toFixed(2)}) the tile shows ${shown} shapes, the pattern ${truth}`);
  }
  return wrapped.length - t.items.length;
}

test('every arrangement, odd and even counts: the clipped tile shows exactly what the endless pattern shows', () => {
  const arrangements: Arrangement[] = ['grid', 'halfdrop', 'brick', 'scatter'];
  for (const arrangement of arrangements) {
    for (const [cols, rows] of [[1, 1], [2, 3], [3, 2], [4, 4], [5, 3]]) {
      assertSeamless(doc({ arrangement, cols, rows }), `${arrangement} ${cols}×${rows}`);
    }
  }
});

test('shapes bigger than the tile and jitter past a whole tile still land wherever they show', () => {
  assert.ok(assertSeamless(doc({ cols: 1, rows: 1, gapX: -60, gapY: -60, jitter: 120 }), 'tiny tile') > 3);
  assertSeamless(doc({ arrangement: 'halfdrop', cols: 1, rows: 2, gapX: -40, gapY: -50, jitter: 30 }), 'tiny half-drop');
});

test('an item over a corner comes back on all four corners; one inside stays single', () => {
  const at = (x: number, y: number): Item => ({ slot: 'sq', x, y, size: 10, rotation: 0, colour: null });
  const corner = wrapItems([at(2, 3)], 100, 80, () => 5);
  assert.deepEqual(corner.map((it) => [it.x, it.y]).sort(), [[102, 3], [102, 83], [2, 3], [2, 83]].sort());
  assert.equal(wrapItems([at(50, 40)], 100, 80, () => 5).length, 1);
  // entirely outside the tile: only the copy that shows
  assert.deepEqual(wrapItems([at(-150, 40)], 100, 80, () => 5).map((it) => it.x), [50]);
});
