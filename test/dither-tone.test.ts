import { test } from 'node:test';
import assert from 'node:assert/strict';
import { field, lin, palette } from './dither-fixtures.ts';
import { dither } from '../src/shared/dither/algorithms.ts';
import { labImage, lightOf, mixOf } from '../src/shared/dither/lab.ts';
import { toMix } from '../src/shared/dither/palette.ts';
import { applyTone, gradientMap } from '../src/shared/dither/tone.ts';
import { encodeTable, lookup, toneAt } from '../src/shared/halftone/tone.ts';

const NEUTRAL = { black: 0, white: 1, gamma: 1, contrast: 0 };
/** a row of greys from black to white, each given by its sRGB-encoded value */
function greys(n: number): { img: Float32Array; enc: number[] } {
  const enc = Array.from({ length: n }, (_, i) => i / (n - 1));
  const img = new Float32Array(n * 3);
  enc.forEach((e, i) => img.fill(lin('#' + Math.round(e * 255).toString(16).padStart(2, '0').repeat(3))[0], i * 3, i * 3 + 3));
  return { img, enc: enc.map((e) => Math.round(e * 255) / 255) };
}
const encoded = (v: number) => lookup(encodeTable(), v);

test('neutral tone leaves the image exactly as it was, in place', () => {
  const img = field(40, 30);
  const before = img.slice();
  assert.equal(applyTone(img, { ...NEUTRAL, map: false } as typeof NEUTRAL), img);
  assert.deepEqual(img, before);
});

test("tone is Halftone's levels, gamma and contrast, on each channel's encoded value", () => {
  for (const tone of [
    { black: 0.2, white: 0.8, gamma: 1, contrast: 0 },
    { black: 0, white: 1, gamma: 2, contrast: 0 },
    { black: 0, white: 1, gamma: 1, contrast: 0.6 },
    { black: 0.1, white: 0.9, gamma: 0.6, contrast: -0.4 },
  ]) {
    const { img, enc } = greys(33);
    applyTone(img, tone);
    enc.forEach((e, i) => {
      const got = encoded(img[i * 3]);
      assert.ok(Math.abs(got - toneAt(tone, e)) < 2e-3, `${JSON.stringify(tone)} at ${e}: ${got} vs ${toneAt(tone, e)}`);
    });
  }
  const { img } = greys(11);
  applyTone(img, { black: 0.2, white: 0.8, gamma: 1, contrast: 0 });
  assert.ok(img[2 * 3] < 1e-4, 'the black point is black');
  assert.ok(img[8 * 3] > 0.999, 'the white point is white');
});

test('the gradient map lays lightness along the palette in its own order, where the dither mixes', () => {
  // light first, as the Blueprint look has it: the image's darks take the pale colour
  const p = palette('#dce6ff #0b3d91');
  const half = lightOf(0.5) ** 3;
  const img = Float32Array.of(0, 0, 0, 1, 1, 1, half, half, half); // black, white, the 50% sRGB grey
  const mix = toMix(gradientMap(img, p), p);
  const at = (px: number, k: number) => Math.hypot(...[0, 1, 2].map((c) => mix[px * 3 + c] - p.mix[k * 3 + c]));
  assert.ok(at(0, 0) < 0.005, 'black takes the first colour');
  assert.ok(at(1, 1) < 0.005, 'white takes the last');
  for (let c = 0; c < 3; c++) {
    const mid = (p.mix[c] + p.mix[3 + c]) / 2;
    assert.ok(Math.abs(mix[2 * 3 + c] - mid) < 0.005, `the middle grey is halfway, axis ${c}`);
  }
});

test('after the gradient map, each tone dithers with just the two colours either side of it', () => {
  const p = palette('#1a140d #d0402a #efe6d2');
  const [w, h] = [96, 64];
  const img = gradientMap(field(w, h, 4), p);
  const tone = labImage(field(w, h, 4));
  for (const algorithm of ['bayer8', 'blue-noise', 'floyd-steinberg'] as const) {
    const out = dither(img, w, h, p, { algorithm, strength: 1, serpentine: true, seed: 1 });
    let strays = 0;
    out.forEach((k, i) => {
      const m = mixOf(tone[i * 3]);
      if ((m < 0.45 && k === 2) || (m > 0.55 && k === 0)) strays++;
    });
    // diffusion carries a little error across the middle, the screens none
    assert.ok(strays <= (algorithm === 'floyd-steinberg' ? w * h * 0.01 : 0), `${algorithm}: ${strays} strays`);
  }
});
