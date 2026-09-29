import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bayer, bayerRanks, blueNoise, clusteredDot, KNUTH, lineScreen } from '../src/shared/dither/matrices.ts';
import { hilbertOrder } from '../src/shared/dither/riemersma.ts';

const ranks = (m: Float32Array) => Array.from(m, (t) => Math.round(t * m.length - 0.5));
const isPermutation = (list: Iterable<number>) => [...list].sort((a, b) => a - b).every((v, i) => v === i);

test("Bayer's matrices: the classic 2 × 2 and 4 × 4, each rank once", () => {
  assert.deepEqual([...bayerRanks(2)], [0, 2, 3, 1]);
  assert.deepEqual([...bayerRanks(4)], [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  for (const n of [2, 4, 8]) {
    const m = bayer(n);
    assert.equal(m.length, n * n);
    assert.ok(isPermutation(ranks(m)), `bayer ${n}`);
  }
});

test('every screen holds each threshold once, so a flat tint prints at its own share', () => {
  for (const [name, m] of [['clustered dot', clusteredDot()], ['line', lineScreen()], ['blue noise', blueNoise()]] as const) {
    assert.ok(isPermutation(ranks(m)), name);
  }
});

test('the clustered dot grows as two round dots per tile, the line screen as rising lines', () => {
  const dot = ranks(clusteredDot());
  // the first 8 cells to darken are two 2 × 2 cores, 4√2 px apart on the 45° lattice
  const first = dot.map((r, i) => [r, i % 8, Math.floor(i / 8)]).filter(([r]) => r < 8).map(([, x, y]) => [x, y]);
  const cores = [first.filter(([x]) => x < 4), first.filter(([x]) => x >= 4)];
  for (const core of cores) {
    assert.equal(core.length, 4);
    const [xs, ys] = [core.map(([x]) => x), core.map(([, y]) => y)];
    assert.ok(Math.max(...xs) - Math.min(...xs) === 1 && Math.max(...ys) - Math.min(...ys) === 1, `a 2 × 2 core: ${core}`);
  }
  const line = ranks(lineScreen());
  // the darkest eight are one diagonal: x + y the same (mod 8) for each
  const diag = new Set(line.map((r, i) => [r, (i % 8) + Math.floor(i / 8)]).filter(([r]) => r < 8).map(([, s]) => s % 8));
  assert.equal(diag.size, 1);
});

test("Knuth's class matrix: 64 classes once each, with his two barons", () => {
  assert.ok(isPermutation(KNUTH));
  let barons = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let later = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && KNUTH[((y + dy + 8) % 8) * 8 + ((x + dx + 8) % 8)] > KNUTH[y * 8 + x]) later++;
      if (!later) barons++;
    }
  }
  assert.equal(barons, 2);
  assert.deepEqual([...KNUTH.slice(0, 8)], [35, 48, 40, 32, 28, 15, 23, 31]);
});

test('the Hilbert curve visits every pixel once, stepping to a neighbour inside a power-of-two square', () => {
  for (const [w, h] of [[1, 1], [8, 8], [37, 13], [5, 64]]) {
    const order = hilbertOrder(w, h);
    assert.equal(order.length, w * h);
    assert.ok(isPermutation(order), `${w}×${h}`);
    assert.equal(order[0], 0, 'starts top left');
  }
  const order = hilbertOrder(16, 16);
  for (let k = 1; k < order.length; k++) {
    const [a, b] = [order[k - 1], order[k]];
    assert.equal(Math.abs((a % 16) - (b % 16)) + Math.abs(Math.floor(a / 16) - Math.floor(b / 16)), 1, `step ${k}`);
  }
});
