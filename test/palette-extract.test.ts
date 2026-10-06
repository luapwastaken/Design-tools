import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, toHex } from '../src/shared/color/index.ts';
import { extractColours } from '../src/shared/palette/extract.ts';

/** a w×h RGBA image painted in horizontal bands: [hex, rows, alpha?] */
function bands(w: number, spec: [string, number, number?][]) {
  const h = spec.reduce((n, [, rows]) => n + rows, 0);
  const px = new Uint8ClampedArray(w * h * 4);
  let y = 0;
  for (const [hex, rows, alpha = 255] of spec) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let i = y * w; i < (y + rows) * w; i++) px.set([r, g, b, alpha], i * 4);
    y += rows;
  }
  return { px, w, h };
}

test('a 4-colour image gives those 4 colours, heaviest first, with their shares', () => {
  const { px, w, h } = bands(50, [['#e8643c', 10], ['#14161a', 40], ['#8fb8de', 20], ['#3f6b4f', 30]]);
  const out = extractColours(px, w, h, 4);
  assert.deepEqual(out.map((c) => toHex(c.oklch)), ['#14161a', '#3f6b4f', '#8fb8de', '#e8643c']);
  const weights = out.map((c) => c.weight);
  [0.4, 0.3, 0.2, 0.1].forEach((want, i) => assert.ok(Math.abs(weights[i] - want) < 1e-9, `${weights}`));
});

test('asking for fewer colours merges the nearest ones', () => {
  const { px, w, h } = bands(20, [['#ff0000', 10], ['#fa0505', 10], ['#0000ff', 20]]);
  const out = extractColours(px, w, h, 2);
  assert.equal(out.length, 2);
  assert.equal(toHex(out[0].oklch), '#0000ff');
  assert.ok(Math.abs(out[1].weight - 0.5) < 1e-9);
});

test('more colours asked for than the image has: one per distinct colour', () => {
  const { px, w, h } = bands(10, [['#000000', 5], ['#ffffff', 5]]);
  assert.deepEqual(extractColours(px, w, h, 8).map((c) => toHex(c.oklch)).sort(), ['#000000', '#ffffff']);
});

test('pixels with alpha under 128 are ignored', () => {
  const { px, w, h } = bands(10, [['#ff0000', 5, 127], ['#00ff00', 5, 128]]);
  const out = extractColours(px, w, h, 3);
  assert.deepEqual(out.map((c) => toHex(c.oklch)), ['#00ff00']);
  assert.equal(out[0].weight, 1);
  assert.deepEqual(extractColours(bands(4, [['#ff0000', 4, 0]]).px, 4, 4, 3), []);
});

test('large images are subsampled, and the result is seeded', () => {
  const { px, w, h } = bands(1000, [['#e8643c', 300], ['#14161a', 500], ['#8fb8de', 200]]);
  const t = performance.now();
  const a = extractColours(px, w, h, 5, 9);
  assert.ok(performance.now() - t < 2000, 'a megapixel stays quick');
  assert.deepEqual(a, extractColours(px, w, h, 5, 9));
  assert.deepEqual(a.map((c) => toHex(c.oklch)), ['#14161a', '#e8643c', '#8fb8de']);
});

test('a small bright accent beside a dull neighbour is kept, as the default count finds it', () => {
  // a dusk forest: murky bands, a tan sky, and a campfire that is 1% of the picture
  const dull = ['#bf8c5e', '#5b4976', '#456c33', '#264c2a', '#1e2e27', '#835b7f'];
  const { px, w, h } = bands(100, [...dull.map((hex, i): [string, number] => [hex, i ? 16 : 20]), ['#f89e45', 1]]);
  for (const k of [3, 4, 6]) {
    const out = extractColours(px, w, h, k);
    assert.ok(out.length <= k);
    assert.ok(out.some((c) => deltaE(c.oklch, '#f89e45') < 4), `${k} colours: ${out.map((c) => toHex(c.oklch))}`);
  }
  // an image with nothing bright in it gets what it always got
  const plain = bands(100, dull.map((hex): [string, number] => [hex, 16]));
  assert.ok(extractColours(plain.px, plain.w, plain.h, 6).every((c) => c.oklch[1] < 0.12));
});
