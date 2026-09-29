import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget } from './perf.ts';
import {
  axes,
  blueNoise,
  cells,
  compensate,
  dot,
  dots,
  extent,
  inkedCoverage,
  pagePx,
  printed,
  sdf,
  stochastic,
  type CellShape,
  type Screen,
  type Size,
} from '../src/shared/halftone/index.ts';

const SHAPES: CellShape[] = ['round', 'ellipse', 'square', 'line', 'diamond', 'cross'];
const A4: Size = { w: 210, h: 297, unit: 'mm', dpi: 300 };
const screen = (over: Partial<Screen> = {}): Screen => ({ shape: 'round', lpi: 60, minDot: 0, gain: 0, ...over });

/**
 * The share of one cell a flat tint of equal dots covers, sampled on a fine grid: a point is ink
 * if the dot of its own cell or of any neighbour holds it, as a printed sheet would show.
 */
function tintArea(shape: CellShape, c: number, steps = 240): number {
  const [a, b] = extent(shape, c);
  let inside = 0;
  for (let y = 0; y < steps; y++) {
    for (let x = 0; x < steps; x++) {
      const [u, v] = [(x + 0.5) / steps - 0.5, (y + 0.5) / steps - 0.5];
      let hit = false;
      for (let j = -1; j <= 1 && !hit; j++) for (let i = -1; i <= 1 && !hit; i++) hit = sdf(shape, a, b, u - i, v - j) < 0;
      if (hit) inside++;
    }
  }
  return inside / (steps * steps);
}

test('coverage 0, 0.5 and 1 make dots covering none, half and all of the sheet, for every shape', () => {
  for (const shape of SHAPES) {
    assert.equal(tintArea(shape, 0), 0, `${shape} at 0`);
    assert.ok(Math.abs(tintArea(shape, 0.5) - 0.5) < 0.01, `${shape} at 0.5: ${tintArea(shape, 0.5)}`);
    assert.equal(tintArea(shape, 1), 1, `${shape} at 1`);
  }
});

test('every coverage prints as itself, below and past the point where the dots join', () => {
  for (const shape of SHAPES) {
    for (const c of [0.05, 0.2, 0.4, 0.6, 0.75, 0.85, 0.95]) {
      const got = tintArea(shape, c);
      assert.ok(Math.abs(got - c) < 0.01, `${shape} at ${c}: ${got.toFixed(4)}`);
    }
  }
});

test('dots grow steadily with coverage', () => {
  for (const shape of SHAPES) {
    let last = [0, 0];
    for (let c = 0.01; c < 1; c += 0.01) {
      const now = extent(shape, c);
      assert.ok(now[0] >= last[0] - 1e-9 && now[1] >= last[1] - 1e-9, `${shape} shrinks at ${c}`);
      last = now;
    }
  }
});

/** the lattice cell a page point falls in, as cells() numbers them (from the page centre) */
function cellOf(p: { x: number; y: number }, page: { w: number; h: number }, pitch: number, angle: number): string {
  const { ux, uy, vx, vy } = axes(angle);
  const [dx, dy] = [p.x - page.w / 2, p.y - page.h / 2];
  return `${Math.round((dx * ux + dy * uy) / pitch)},${Math.round((dx * vx + dy * vy) / pitch)}`;
}

test('the cells cover the whole page at any angle, once each, and stay within a cell of it', () => {
  const size: Size = { w: 40, h: 25, unit: 'mm', dpi: 300 };
  const page = pagePx(size);
  const plate = new Float32Array(4).fill(0.5);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const angle of [0, 7.5, 15, 45, 75, 90, 105, 135, 180, -30, 333.3]) {
    const c = cells(plate, size, 20, angle, 2, 2);
    const have = new Set<string>();
    for (let k = 0; k < c.n; k++) {
      const key = cellOf({ x: c.x[k], y: c.y[k] }, page, c.pitch, angle);
      assert.ok(!have.has(key), `angle ${angle}: cell ${key} twice`);
      have.add(key);
      assert.ok(c.x[k] >= -c.pitch - 1e-3 && c.x[k] <= page.w + c.pitch + 1e-3 && c.y[k] >= -c.pitch - 1e-3 && c.y[k] <= page.h + c.pitch + 1e-3);
    }
    const corners = [[0, 0], [page.w, 0], [0, page.h], [page.w, page.h]];
    const points = [...corners, ...Array.from({ length: 4000 }, () => [rnd() * page.w, rnd() * page.h])];
    for (const [x, y] of points) assert.ok(have.has(cellOf({ x, y }, page, c.pitch, angle)), `angle ${angle}: (${x.toFixed(1)}, ${y.toFixed(1)}) has no cell`);
  }
});

test("a cell's coverage is the plate's mean around it, at any plate resolution", () => {
  const size: Size = { w: 50, h: 30, unit: 'mm', dpi: 300 };
  const page = pagePx(size);
  const ramp = (w: number, h: number) => Float32Array.from({ length: w * h }, (_, i) => ((i % w) + 0.5) / w);
  for (const [pw, ph] of [[591, 354], [120, 70], [2000, 1200]]) {
    const c = cells(ramp(pw, ph), size, 30, 30, pw, ph);
    for (let k = 0; k < c.n; k++) {
      const x = c.x[k];
      if (x < c.pitch || x > page.w - c.pitch) continue; // edge cells average only what is on the page
      assert.ok(Math.abs(c.coverage[k] - x / page.w) < 1.5 / pw, `${pw} px plate at x ${x.toFixed(1)}: ${c.coverage[k]}`);
    }
  }
  const flat = cells(new Float32Array(12).fill(0.3), size, 30, 45, 4, 3);
  for (let k = 0; k < flat.n; k++) assert.ok(Math.abs(flat.coverage[k] - 0.3) < 1e-6);
});

test('gain compensation: ends stay put, the press then prints what was meant', () => {
  for (const gain of [0, 0.1, 0.15, 0.3]) {
    assert.equal(compensate(0, gain), 0);
    assert.ok(Math.abs(compensate(1, gain) - 1) < 1e-12);
    let last = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const plate = compensate(c, gain);
      assert.ok(plate >= last, 'rising');
      assert.ok(plate <= c + 1e-12, 'never adds ink');
      assert.ok(Math.abs(printed(plate, gain) - c) < 1e-9, 'the press undoes it');
      last = plate;
    }
  }
  assert.ok(Math.abs(printed(0.5, 0.15) - 0.65) < 1e-12, 'gain is quoted at 50%');
  assert.ok(compensate(0.5, 0.15) < 0.4);
});

test('the smallest printable dot: smaller ones drop out, smaller holes fill in', () => {
  const s = screen({ minDot: 0.05 });
  assert.equal(inkedCoverage(s, 0.04), 0);
  assert.equal(inkedCoverage(s, 0.06), 0.06);
  assert.equal(inkedCoverage(s, 0.96), 1);
  assert.deepEqual(dot(s, 0.03, 5), { a: 0, b: 0 });
  assert.equal(inkedCoverage(screen({ minDot: 0.05, gain: 0.2 }), 0.07), 0, 'gain compensation comes first');
});

test('dots are cell-sized, and the count is the dots that print', () => {
  const size: Size = { w: 30, h: 30, unit: 'mm', dpi: 300 };
  const plate = Float32Array.from({ length: 100 }, (_, i) => (i % 10) / 9);
  const c = cells(plate, size, 40, 15, 10, 10);
  for (const shape of SHAPES) {
    const { geom, count } = dots(c, screen({ shape, lpi: 40 }));
    let printing = 0;
    for (let k = 0; k < c.n; k++) {
      const one = dot(screen({ shape, lpi: 40 }), c.coverage[k], c.pitch);
      assert.ok(Math.abs(one.a - geom[2 * k]) < 1e-4 && Math.abs(one.b - geom[2 * k + 1]) < 1e-4);
      if (one.b > 0) printing++;
    }
    assert.equal(count, printing);
  }
});

test('A4 at 300 DPI, 60 LPI: cells and dots for four inks in under 300 ms', () => {
  // plates at the tool's working resolution, 2.5 plate pixels a cell (tools/halftone/screening.ts)
  const page = pagePx(A4);
  const k = 2.5 / (A4.dpi / 60);
  const [pw, ph] = [Math.round(page.w * k), Math.round(page.h * k)];
  const plates = [3, 5, 7, 11].map((step) => {
    const p = new Float32Array(pw * ph);
    for (let i = 0; i < p.length; i++) p[i] = ((i * step) % 997) / 997;
    return p;
  });
  const run = () => {
    const t = performance.now();
    let n = 0;
    [15, 75, 0, 45].forEach((angle, i) => {
      const c = cells(plates[i], A4, 60, angle, pw, ph);
      n += dots(c, screen({ gain: 0.12, minDot: 0.02 })).count;
    });
    return { ms: performance.now() - t, n };
  };
  // the best of three: test files run side by side and share the CPU
  const best = [run(), run(), run()].sort((a, b) => a.ms - b.ms)[0];
  assert.ok(best.n > 1_000_000, `${best.n} dots`);
  assert.ok(best.ms < budget(300), `${best.ms.toFixed(0)} ms`);
});

test('stochastic: each threshold once, and flat plates print at their own coverage', () => {
  const noise = blueNoise();
  const ranks = new Set(Array.from(noise, (t) => Math.round(t * noise.length - 0.5)));
  assert.equal(ranks.size, noise.length);
  const [w, h] = [256, 192];
  for (const c of [0, 0.02, 0.1, 0.5, 0.9, 1]) {
    const out = stochastic(new Float32Array(w * h).fill(c), w, h, 3);
    const inked = out.reduce((s, v) => s + (v === 0 ? 1 : 0), 0) / (w * h);
    assert.ok(Math.abs(inked - c) < 0.005, `${c}: ${inked}`);
  }
  const compensated = stochastic(new Float32Array(w * h).fill(0.5), w, h, 3, { gain: 0.15 });
  const inked = compensated.reduce((s, v) => s + (v === 0 ? 1 : 0), 0) / (w * h);
  assert.ok(Math.abs(inked - compensate(0.5, 0.15)) < 0.005);
});

test('stochastic: the plate is resampled to the output size, and each seed lays its own dots', () => {
  const plate = Float32Array.from({ length: 64 * 48 }, (_, i) => (i % 64) / 63);
  const out = stochastic(plate, 64, 48, 1, { outW: 640, outH: 480 });
  assert.equal(out.length, 640 * 480);
  const band = (x0: number) => {
    let ink = 0;
    for (let y = 0; y < 480; y++) for (let x = x0; x < x0 + 64; x++) ink += out[y * 640 + x] === 0 ? 1 : 0;
    return ink / (64 * 480);
  };
  assert.ok(band(0) < 0.1 && Math.abs(band(288) - 0.5) < 0.03 && band(576) > 0.9);
  const other = stochastic(plate, 64, 48, 2, { outW: 640, outH: 480 });
  assert.notDeepEqual(other, out);
});

test('blue noise: a flat 10% tint has no clumps (dots keep apart)', () => {
  const [w, h] = [128, 128];
  const out = stochastic(new Float32Array(w * h).fill(0.1), w, h, 0);
  let touching = 0;
  let dotsSeen = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (out[y * w + x]) continue;
      dotsSeen++;
      if (!out[y * w + ((x + 1) % w)] || !out[((y + 1) % h) * w + x]) touching++;
    }
  }
  // white noise at 10% puts about a fifth of dots against a right or lower neighbour
  assert.ok(touching / dotsSeen < 0.03, `${touching} of ${dotsSeen} touch`);
});
