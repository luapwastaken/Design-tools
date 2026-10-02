import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash, nodules, paperAt, rnd, SCALES } from '../src/renderer/tools/illustration/paint/paper.ts';

test('the integer hash gives the values the shader gives', () => {
  assert.equal(hash(0), 0);
  assert.equal(hash(1), 1753845952);
  assert.equal(hash(0xdeadbeef), 3861431939);
  assert.equal(rnd(3, 4, 1), 0.13620316982269287);
  // negative cells wrap as uint(int) does in GLSL
  assert.equal(rnd(-5, 7, 2), 0.8973027467727661);
});

/** a patch of one of the paper's fields */
function field(fn: (x: number, y: number) => number, n = 192): { v: Float64Array; n: number; mean: number } {
  const v = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v[y * n + x] = fn(x + 311, y + 207);
  return { v, n, mean: v.reduce((a, b) => a + b, 0) / v.length };
}
function autocorr({ v, n, mean }: ReturnType<typeof field>, lag: number): number {
  let s = 0;
  let c = 0;
  let variance = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x + lag < n; x++, c++) s += (v[y * n + x] - mean) * (v[y * n + x + lag] - mean);
  for (const q of v) variance += (q - mean) ** 2;
  return s / c / (variance / v.length);
}

test('the height is centred and spread over 0..1', () => {
  const h = field((x, y) => paperAt(x, y)[0]);
  assert.ok(h.mean >= 0.45 && h.mean <= 0.55, `mean ${h.mean}`);
  const top = h.v.filter((q) => q >= 1).length / h.v.length;
  assert.ok(top < 0.05, `${(top * 100).toFixed(1)} % flat at the top`);
  for (const [, m, f] of [paperAt(10, 10), paperAt(1500, 900)]) assert.ok(m >= 0 && m <= 1 && f >= 0 && f <= 1);
});

test('the nodules show at the 9 px scale', () => {
  const h = field((x, y) => paperAt(x, y)[0]);
  // smooth at a pixel, bumps about 9 px across
  assert.ok(autocorr(h, 1) > 0.7, `lag 1: ${autocorr(h, 1)}`);
  assert.ok(autocorr(h, SCALES.nodules) < 0.1, `lag 9: ${autocorr(h, SCALES.nodules)}`);
  // the nodules alone: correlated inside a cell, anti-correlated a cell away
  const n = field((x, y) => nodules((x + 0.5) / SCALES.nodules, (y + 0.5) / SCALES.nodules, 1));
  const lags = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((l) => autocorr(n, l));
  const dip = lags.indexOf(Math.min(...lags)) + 4;
  assert.ok(autocorr(n, 2) > 0.6 && Math.min(...lags) < 0 && dip >= 7 && dip <= 11, `dip at ${dip}: ${lags.map((v) => v.toFixed(2))}`);
});
