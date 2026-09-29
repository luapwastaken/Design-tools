import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Oklch } from '../src/shared/color/index.ts';
import { layoutTile, reachOf } from '../src/shared/pattern/layout.ts';
import { cellRandom } from '../src/shared/pattern/seeds.ts';
import type { Arrangement, Item, PatternDoc, ShapeSlot, Tile } from '../src/shared/pattern/types.ts';

const slot = (id: string, w = 100, h = 100, more: Partial<ShapeSlot> = {}): ShapeSlot => ({
  id,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`,
  name: id,
  weight: 1,
  recolour: false,
  colour: null,
  bounds: { x: 0, y: 0, w, h },
  ...more,
});

const doc = (over: Partial<PatternDoc> = {}): PatternDoc => ({
  slots: [slot('a')],
  arrangement: 'grid',
  cols: 4,
  rows: 4,
  gapX: 12,
  gapY: 12,
  sizeMin: 50,
  sizeMax: 50,
  rotation: { mode: 'fixed', angle: 0, min: 0, max: 0 },
  jitter: 0,
  seed: 7,
  background: null,
  palette: [],
  paletteMode: 'by-slot',
  exportUnit: 'px',
  dpi: 96,
  artboard: { w: 1000, h: 1000 },
  ...over,
});

const RED: Oklch = [0.6, 0.2, 25];
const GREEN: Oklch = [0.7, 0.15, 145];
const BLUE: Oklch = [0.5, 0.15, 260];
const LATTICES: Arrangement[] = ['grid', 'halfdrop', 'brick'];
const COUNTS = [1, 2, 3, 4, 5, 6, 7];
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const torus = (d: number, period: number) => d - period * Math.round(d / period);
const posKey = (x: number, y: number, t: Tile) => {
  const m = (v: number, p: number) => (((v % p) + p) % p + 1e-7) % p; // wraps a hair below the edge to 0
  return `${m(x, t.width).toFixed(5)},${m(y, t.height).toFixed(5)}`;
};
/** cells actually laid out: an odd count doubles for the offset arrangements */
const cellsOf = (d: PatternDoc) => [
  d.cols * (d.arrangement === 'halfdrop' && d.cols % 2 ? 2 : 1),
  d.rows * (d.arrangement === 'brick' && d.rows % 2 ? 2 : 1),
];

test('cellRandom: fixed by its four inputs, 0..1, even, and each input changes it', () => {
  assert.equal(cellRandom(7, 3, 2, 1), cellRandom(7, 3, 2, 1));
  const base = cellRandom(7, 3, 2, 1);
  for (const other of [cellRandom(8, 3, 2, 1), cellRandom(7, 4, 2, 1), cellRandom(7, 3, 3, 1), cellRandom(7, 3, 2, 2)]) assert.notEqual(other, base);
  const buckets = new Array(10).fill(0);
  for (let c = 0; c < 100; c++) {
    for (let r = 0; r < 100; r++) {
      const v = cellRandom(12345, c, r, 3);
      assert.ok(v >= 0 && v < 1);
      buckets[Math.floor(v * 10)]++;
    }
  }
  for (const b of buckets) assert.ok(Math.abs(b - 1000) < 120, `bucket ${b} of 10000`);
});

test('every lattice arrangement is a true period for odd and even counts: the repeat has the inner pitch across every seam', () => {
  for (const arrangement of LATTICES) {
    for (const cols of COUNTS) {
      for (const rows of COUNTS) {
        const d = doc({ arrangement, cols, rows, gapX: 12, gapY: 20 });
        const t = layoutTile(d);
        const [cx, cy] = cellsOf(d);
        const px = 50 + 12;
        const py = 50 + 20;
        const what = `${arrangement} ${cols}×${rows}`;
        assert.ok(close(t.width, cx * px) && close(t.height, cy * py), `${what}: tile ${t.width}×${t.height}`);
        assert.equal(t.items.length, cx * cy, what);
        // the items, repeated, must be the ideal lattice: shifting by each basis vector (mod the tile)
        // maps the set onto itself, so no seam differs from the inside
        const set = new Set(t.items.map((it) => posKey(it.x, it.y, t)));
        assert.equal(set.size, t.items.length, `${what}: two items on one spot`);
        const basis =
          arrangement === 'grid' ? [[px, 0], [0, py]] : arrangement === 'halfdrop' ? [[px, py / 2], [0, py]] : [[px, 0], [px / 2, py]];
        for (const [vx, vy] of basis) {
          for (const it of t.items) assert.ok(set.has(posKey(it.x + vx, it.y + vy, t)), `${what}: no neighbour at +(${vx}, ${vy}) of (${it.x}, ${it.y})`);
        }
      }
    }
  }
});

test('the gap holds across the seam: the space between shapes at the tile edge is the space inside (v1 dropped it)', () => {
  for (const cols of [1, 2, 3, 5]) {
    for (const gap of [-10, 0, 12, 40]) {
      const d = doc({ cols, rows: cols, gapX: gap, gapY: gap + 5 });
      const t = layoutTile(d);
      const row0 = t.items.filter((it) => close(it.y, t.items[0].y)).sort((a, b) => a.x - b.x);
      const col0 = t.items.filter((it) => close(it.x, t.items[0].x)).sort((a, b) => a.y - b.y);
      const half = 25; // square artwork, 50 px
      for (let i = 1; i < row0.length; i++) assert.ok(close(row0[i].x - half - (row0[i - 1].x + half), gap));
      for (let i = 1; i < col0.length; i++) assert.ok(close(col0[i].y - half - (col0[i - 1].y + half), gap + 5));
      // the first shape of the next tile against the last of this one
      assert.ok(close(row0[0].x + t.width - half - (row0.at(-1)!.x + half), gap), `cols ${cols} gap ${gap}`);
      assert.ok(close(col0[0].y + t.height - half - (col0.at(-1)!.y + half), gap + 5), `rows ${cols} gap ${gap}`);
    }
  }
});

test('a large negative gap overlaps shapes but never collapses the tile (v1 went to 2 px)', () => {
  const t = layoutTile(doc({ cols: 3, rows: 3, gapX: -1000, gapY: -49 }));
  assert.ok(close(t.width, 3 * 12.5), `width ${t.width}`); // a quarter of the 50 px cell
  assert.ok(close(t.height, 3 * 12.5));
  assert.equal(layoutTile(doc({ cols: 0, rows: Number.NaN })).items.length, 1);
});

test('cells fit every slot by its real artwork and turn, so shapes of different proportions pack', () => {
  const one = (over: Partial<PatternDoc>) => layoutTile(doc({ cols: 1, rows: 1, gapX: 0, gapY: 0, ...over }));
  // a tall and a wide shape: each is 50 on its long side
  let t = one({ slots: [slot('tall', 50, 100), slot('wide', 100, 50)] });
  assert.ok(close(t.width, 50) && close(t.height, 50));
  t = one({ slots: [slot('wide', 100, 25)] });
  assert.ok(close(t.width, 50) && close(t.height, 12.5), `${t.width}×${t.height}`);
  t = one({ slots: [slot('wide', 100, 25)], rotation: { mode: 'fixed', angle: 90, min: 0, max: 0 } });
  assert.ok(close(t.width, 12.5) && close(t.height, 50));
  t = one({ rotation: { mode: 'fixed', angle: 45, min: 0, max: 0 } });
  assert.ok(close(t.width, 50 * Math.SQRT2), `45°: ${t.width}`);
  // a 2:1 box turned 0..30°: its diagonal (26.6°) is in range across, not down
  t = one({ slots: [slot('w', 100, 50)], rotation: { mode: 'random', angle: 0, min: 0, max: 30 } });
  assert.ok(close(t.width, 50 * Math.hypot(1, 0.5)), `across ${t.width}`);
  assert.ok(close(t.height, 50 * (0.5 * Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6))), `down ${t.height}`);
  t = one({ slots: [slot('w', 100, 50)], rotation: { mode: 'random', angle: 0, min: -180, max: 180 } });
  assert.ok(close(t.width, 50 * Math.hypot(1, 0.5)) && close(t.height, t.width));
});

const busy = (over: Partial<PatternDoc> = {}) =>
  doc({
    slots: [slot('a', 100, 60, { recolour: true }), slot('b', 40, 100, { weight: 2 })],
    sizeMin: 20,
    sizeMax: 60,
    rotation: { mode: 'random', angle: 0, min: -90, max: 90 },
    jitter: 9,
    palette: [RED, GREEN, BLUE],
    paletteMode: 'random',
    ...over,
  });

test('seeds are per cell: more columns, rows or gap leave the existing cells as they were', () => {
  const same = (a: Item, b: Item, dx = 0, dy = 0, what = '') => {
    assert.deepEqual([a.slot, a.size, a.rotation, a.colour], [b.slot, b.size, b.rotation, b.colour], what);
    assert.ok(close(a.x + dx, b.x) && close(a.y + dy, b.y), `${what}: moved`);
  };
  for (const arrangement of LATTICES) {
    const at = (d: PatternDoc, t: Tile, c: number, r: number) => t.items[r * cellsOf(d)[0] + c];
    const a = busy({ arrangement, cols: 4, rows: 4 });
    const ta = layoutTile(a);
    for (const change of [{ cols: 5 }, { rows: 5 }, { cols: 3 }, { rows: 7 }] as Partial<PatternDoc>[]) {
      const b = busy({ arrangement, cols: 4, rows: 4, ...change });
      const tb = layoutTile(b);
      const [c1, r1] = [Math.min(a.cols, b.cols), Math.min(a.rows, b.rows)];
      for (let r = 0; r < r1; r++) for (let c = 0; c < c1; c++) same(at(a, ta, c, r), at(b, tb, c, r), 0, 0, `${arrangement} ${JSON.stringify(change)} cell ${c},${r}`);
    }
    // a wider gap moves each cell by whole pitches only; its draws stay
    const g = busy({ arrangement, gapX: 30, gapY: 2 });
    const tg = layoutTile(g);
    const [pa, pg] = [ta.width / cellsOf(a)[0], tg.width / cellsOf(g)[0]];
    const [qa, qg] = [ta.height / cellsOf(a)[1], tg.height / cellsOf(g)[1]];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const [dx, dy] = [(pg - pa) * (c + 0.5 + (arrangement === 'brick' && r % 2 ? 0.5 : 0)), (qg - qa) * (r + 0.5 + (arrangement === 'halfdrop' && c % 2 ? 0.5 : 0))];
        same(at(a, ta, c, r), at(g, tg, c, r), dx, dy, `${arrangement} gap, cell ${c},${r}`);
      }
    }
  }
  // Reseed does reshuffle
  const [base, other] = [layoutTile(busy()), layoutTile(busy({ seed: 8 }))];
  assert.ok(other.items.every((it, i) => it.rotation !== base.items[i].rotation));
});

test('jitter stays within its reach, sizes within the range, turns within the range', () => {
  const d = busy({ cols: 6, rows: 6 });
  const t = layoutTile(d);
  const px = t.width / 6;
  const py = t.height / 6;
  t.items.forEach((it, i) => {
    const [c, r] = [i % 6, Math.floor(i / 6)];
    assert.ok(Math.abs(it.x - (c + 0.5) * px) <= 9 + 1e-9 && Math.abs(it.y - (r + 0.5) * py) <= 9 + 1e-9);
    assert.ok(it.size >= 20 && it.size <= 60);
    assert.ok(it.rotation >= -90 && it.rotation <= 90);
  });
  const fixed = layoutTile(doc({ rotation: { mode: 'fixed', angle: 30, min: -90, max: 90 } }));
  assert.ok(fixed.items.every((it) => it.rotation === 30 && it.size === 50));
});

test('weights: 0 never appears, the rest in proportion; no slot to draw gives an empty tile', () => {
  const d = doc({ slots: [slot('a', 100, 100, { weight: 3 }), slot('b', 100, 100, { weight: 1 }), slot('z', 100, 100, { weight: 0 })], cols: 40, rows: 40 });
  const t = layoutTile(d);
  const n = (id: string) => t.items.filter((it) => it.slot === id).length;
  assert.equal(n('z'), 0);
  assert.ok(Math.abs(n('a') / 1600 - 0.75) < 0.05, `a ${n('a')}`);
  const empty = layoutTile(doc({ slots: [slot('z', 100, 100, { weight: 0 })] }));
  assert.equal(empty.items.length, 0);
  assert.ok(empty.width > 0 && empty.height > 0);
});

test('shapes are picked per slot: adding, removing or reweighting one only changes the cells it wins or loses (spec §4)', () => {
  const [a, b, c] = [slot('a'), slot('b', 100, 100, { weight: 2 }), slot('c')];
  const of = (slots: ShapeSlot[]) => layoutTile(doc({ slots, cols: 16, rows: 16 })).items.map((it) => it.slot);
  const base = of([a, b, c]);
  const without = of([a, c]);
  base.forEach((id, i) => id !== 'b' && assert.equal(without[i], id, `cell ${i} moved when b left`));
  const more = of([a, b, c, slot('d')]);
  more.forEach((id, i) => id !== 'd' && assert.equal(id, base[i], `cell ${i} moved when d came`));
  assert.ok(more.includes('d'));
  const heavier = of([a, { ...b, weight: 5 }, c]);
  base.forEach((id, i) => (id === 'b' ? assert.equal(heavier[i], 'b') : heavier[i] !== 'b' && assert.equal(heavier[i], id)));
  assert.ok(heavier.filter((id) => id === 'b').length > base.filter((id) => id === 'b').length);
  // the order of the list doesn't matter either
  assert.deepEqual(of([c, a, b]), base);
});

test('colours: own colours unless the slot recolours; its own colour wins; the palette by slot or at random', () => {
  const slots = [
    slot('own'),
    slot('mine', 100, 100, { recolour: true, colour: BLUE }),
    slot('p1', 100, 100, { recolour: true }),
    slot('p2', 100, 100, { recolour: true }),
  ];
  const colourOf = (t: Tile, id: string) => [...new Set(t.items.filter((it) => it.slot === id).map((it) => JSON.stringify(it.colour)))];
  let t = layoutTile(doc({ slots, cols: 12, rows: 12, palette: [RED, GREEN] }));
  assert.deepEqual(colourOf(t, 'own'), ['null']);
  assert.deepEqual(colourOf(t, 'mine'), [JSON.stringify(BLUE)]);
  // the recolouring slots take it in order; 'mine' keeps its place, so its own colour moves no one else's
  assert.deepEqual(colourOf(t, 'p1'), [JSON.stringify(GREEN)]);
  assert.deepEqual(colourOf(t, 'p2'), [JSON.stringify(RED)]);
  t = layoutTile(doc({ slots, cols: 12, rows: 12, palette: [RED, GREEN], paletteMode: 'random' }));
  assert.equal(colourOf(t, 'p1').length, 2);
  assert.deepEqual(colourOf(t, 'mine'), [JSON.stringify(BLUE)]);
  // no palette: palette-following slots keep their own colours
  t = layoutTile(doc({ slots, palette: [] }));
  assert.deepEqual(colourOf(t, 'p1'), ['null']);
});

// ── scatter ─────────────────────────────────────────────────────────────────────────────────────

const scatterDoc = (over: Partial<PatternDoc> = {}) =>
  doc({
    arrangement: 'scatter',
    slots: [slot('sq'), slot('wide', 300, 100, { weight: 2 }), slot('tall', 30, 100)],
    sizeMin: 20,
    sizeMax: 60,
    rotation: { mode: 'random', angle: 0, min: 0, max: 360 },
    jitter: 40, // ignored by scatter
    ...over,
  });

/** every pair, measured to the nearest repeat of the other, keeps its reaches plus the gap apart */
function assertNoOverlap(d: PatternDoc, t: Tile, what: string) {
  const reach = reachOf(d.slots);
  const gap = Math.max(0, (d.gapX + d.gapY) / 2);
  for (const it of t.items) {
    assert.ok(it.x >= 0 && it.x < t.width && it.y >= 0 && it.y < t.height, `${what}: outside the tile`);
    assert.ok(2 * reach(it) + gap <= Math.min(t.width, t.height) + 1e-9, `${what}: meets its own repeat`);
  }
  for (let i = 0; i < t.items.length; i++) {
    for (let j = i + 1; j < t.items.length; j++) {
      const [a, b] = [t.items[i], t.items[j]];
      const dist = Math.hypot(torus(a.x - b.x, t.width), torus(a.y - b.y, t.height));
      assert.ok(dist >= reach(a) + reach(b) + gap - 1e-9, `${what}: items ${i} and ${j} overlap across ${dist}`);
    }
  }
}

test('scatter: no overlaps anywhere, across the seam included, for odd and even counts and many seeds', () => {
  for (const cols of COUNTS) {
    for (const rows of [1, 2, 3, 6]) {
      for (const [gapX, gapY] of [[0, 0], [10, 6], [-30, -30]]) {
        for (let seed = 1; seed <= 4; seed++) {
          const d = scatterDoc({ cols, rows, gapX, gapY, seed });
          assertNoOverlap(d, layoutTile(d), `${cols}×${rows} gap ${gapX},${gapY} seed ${seed}`);
        }
      }
    }
  }
});

test('scatter: count = cols × rows, best effort, nearly always reached; even spread (one per cell at most)', () => {
  let placed = 0;
  let asked = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const d = scatterDoc({ cols: 8, rows: 6, seed });
    const t = layoutTile(d);
    placed += t.items.length;
    asked += 48;
    const p = t.width / 8;
    const cells = new Set(t.items.map((it) => `${Math.floor(it.x / p)},${Math.floor(it.y / p)}`));
    assert.equal(cells.size, t.items.length);
  }
  assert.ok(placed / asked > 0.95, `placed ${placed} of ${asked}`);
});

test('scatter: more columns leave all but the old last column as they were, and a new seed reshuffles', () => {
  const a = layoutTile(scatterDoc({ cols: 4, rows: 5 }));
  const b = layoutTile(scatterDoc({ cols: 5, rows: 5 }));
  const p = a.width / 4;
  const first3 = (t: Tile) => t.items.filter((it) => it.x < 3 * p);
  assert.ok(first3(a).length >= 12);
  assert.deepEqual(first3(b), first3(a));
  const c = layoutTile(scatterDoc({ cols: 4, rows: 5, seed: 99 }));
  assert.notDeepEqual(c.items, a.items);
});
