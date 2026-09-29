import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BW, PICO8, flat, lin, palette } from './dither-fixtures.ts';
import { hexToOklch, rgb255, toHex, toOklch, type Oklch } from '../src/shared/color/index.ts';
import { labImage, labOf, lightOf, mixOf } from '../src/shared/dither/lab.ts';
import { extractPalette, nearest, toMix, toOklab } from '../src/shared/dither/palette.ts';
import { toOklab as polar } from '../src/shared/palette/space.ts';
import { random } from '../src/shared/palette/random.ts';

/** OKLab of linear light the slow way, through shared/color */
const exact = (r: number, g: number, b: number) => polar(toOklch({ mode: 'lrgb', r, g, b }));

test('pixels reach OKLab within 1e-4 of shared/color, from black to the primaries', () => {
  const rnd = random(11);
  const cases: [number, number, number][] = [
    [0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1],
    [1e-6, 0, 0], [0.002, 0.001, 0.003], [0.5, 0.5, 0.5],
    ...Array.from({ length: 4000 }, () => [rnd() ** 2.4, rnd() ** 2.4, rnd() ** 2.4] as [number, number, number]),
  ];
  const img = Float32Array.from(cases.flat());
  const fast = labImage(img);
  cases.forEach(([r, g, b], i) => {
    // the table reads the float32 the image holds
    const want = exact(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(fast[i * 3 + c] - want[c]) < 1e-4, `${[r, g, b]} axis ${c}: ${fast[i * 3 + c]} vs ${want[c]}`);
  });
  const white = labOf(1, 1, 1);
  assert.ok(Math.abs(white[0] - 1) < 1e-4 && Math.abs(white[1]) < 1e-4 && Math.abs(white[2]) < 1e-4, `${white}`);
});

test('a palette colour is what its hex shows, so one outside sRGB lands where the file will', () => {
  const vivid: Oklch = [0.7, 0.35, 150]; // far outside sRGB
  const p = toOklab([vivid]);
  const shown = hexToOklch(toHex(vivid));
  const want = polar(shown);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(p.lab[c] - want[c]) < 1e-4, `axis ${c}`);
  // and a pixel of that hex, decoded as the tool decodes it, is that exact point: no error to diffuse
  const px = labImage(Float32Array.from(lin(toHex(vivid))));
  for (let c = 0; c < 3; c++) assert.equal(Math.fround(p.lab[c]), px[c]);
});

test('the palette keeps its order, its box and a dark-to-light index', () => {
  const p = palette('#ffffff #000000 #ff0000 #808080');
  assert.equal(p.n, 4);
  assert.deepEqual([...p.byL], [1, 3, 2, 0]);
  assert.ok(Math.abs(p.lo[0]) < 1e-6 && Math.abs(p.hi[0] - 1) < 1e-4);
  assert.ok(p.hi[1] > 0.2, 'red widens the box in a');
  assert.equal(palette('#000000 #ffffff').key, BW.key);
  assert.notEqual(palette('#ffffff #000000').key, BW.key);
  assert.equal(toOklab(Array.from({ length: 300 }, () => [0.5, 0, 0] as Oklch)).n, 256);
});

test('nearest is exact on large palettes too, and a tie goes to the darker, then the earlier', () => {
  const rnd = random(5);
  const big = toOklab(Array.from({ length: 200 }, () => [rnd(), rnd() * 0.25, rnd() * 360] as Oklch));
  const brute = (l: number, a: number, b: number) => {
    let [best, at] = [Infinity, -1];
    for (let i = 0; i < big.n; i++) {
      const d = (big.lab[i * 3] - l) ** 2 + (big.lab[i * 3 + 1] - a) ** 2 + (big.lab[i * 3 + 2] - b) ** 2;
      if (d < best) [best, at] = [d, i];
    }
    return at;
  };
  for (let k = 0; k < 20000; k++) {
    const [l, a, b] = [rnd() * 1.1 - 0.05, rnd() * 0.6 - 0.3, rnd() * 0.6 - 0.3];
    assert.equal(nearest(big, l, a, b), brute(l, a, b), `${l} ${a} ${b}`);
  }
  for (let k = 0; k < 2000; k++) {
    const [l, a, b] = [rnd(), rnd() * 0.4 - 0.2, rnd() * 0.4 - 0.2];
    assert.equal(nearest(PICO8, l, a, b), (() => {
      let [best, at] = [Infinity, -1];
      for (let i = 0; i < PICO8.n; i++) {
        const d = (PICO8.lab[i * 3] - l) ** 2 + (PICO8.lab[i * 3 + 1] - a) ** 2 + (PICO8.lab[i * 3 + 2] - b) ** 2;
        if (d < best) [best, at] = [d, i];
      }
      return at;
    })());
  }
  const half = [0, 1, 2].map((c) => (BW.lab[c] + BW.lab[3 + c]) / 2);
  assert.equal(nearest(BW, half[0], half[1], half[2]), 0, 'the darker of two equally near');
  const twice = palette('#808080 #808080 #ffffff');
  assert.equal(nearest(twice, 0.6, 0, 0), 0);
  // past 16 colours (the walk): two equal colours at 30 and 31, and two equally far either side
  const ramp = Array.from({ length: 30 }, (_, i) => hexToOklch('#' + (i * 8).toString(16).padStart(2, '0').repeat(3)));
  const many = toOklab([...ramp, hexToOklch('#336699'), hexToOklch('#336699')]);
  const [l, a, b] = many.lab.slice(30 * 3, 31 * 3);
  assert.equal(nearest(many, l, a, b), 30, 'the earlier of two equal colours');
  const mid = (many.lab[10 * 3] + many.lab[11 * 3]) / 2;
  assert.equal(nearest(many, mid, 0, 0), 10, 'the darker of two equally near');
});

test('the dither mixes lightness as sRGB greys have it: a grey’s mixing lightness is its sRGB value', () => {
  for (const byte of [0, 1, 16, 64, 128, 200, 255]) {
    const hex = `#${byte.toString(16).padStart(2, '0').repeat(3)}`;
    const m = mixOf(labOf(...lin(hex))[0]);
    assert.ok(Math.abs(m - byte / 255) < 2e-4, `${hex}: ${m}`);
  }
  for (let k = 0; k <= 200; k++) {
    const l = k / 200;
    assert.ok(Math.abs(lightOf(mixOf(l)) - l) < (l < 0.05 ? 2e-3 : 1e-5), `${l} back as ${lightOf(mixOf(l))}`);
  }
});

test('pixels are held inside the palette box: black and white leave only lightness', () => {
  const mix = toMix(flat(2, 1, lin('#ff0000')), BW);
  assert.ok(Math.abs(mix[0] - mixOf(0.628)) < 0.001, `M ${mix[0]}`);
  assert.ok(Math.abs(mix[1]) < 1e-6 && Math.abs(mix[2]) < 1e-6);
});

test('extract: the colours of an image, dark to light', () => {
  const hexes = ['#e8643c', '#14161a', '#8fb8de', '#3f6b4f'];
  const rgba = new Uint8ClampedArray(40 * 40 * 4);
  for (let i = 0; i < 1600; i++) rgba.set([...rgb255(hexToOklch(hexes[Math.floor(i / 400)])), 255], i * 4);
  const out = extractPalette(rgba, 40, 40, 4).map(toHex);
  assert.deepEqual(out, ['#14161a', '#3f6b4f', '#e8643c', '#8fb8de']);
  assert.equal(extractPalette(rgba, 40, 40, 2).length, 2);
});
