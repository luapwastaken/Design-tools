import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, hexToOklch, type Oklch } from '../src/shared/color/index.ts';
import { BANDS, colourOf, mix, mixCurves, paintOf, reflectance } from '../src/shared/paint/km.ts';
import { customPigment, PIGMENTS, type Pigment } from '../src/shared/paint/pigments.ts';

const P = Object.fromEntries(PIGMENTS.map((p) => [p.id, p])) as Record<string, Pigment>;
const two = (a: Pigment, b: Pigment, pa = 1, pb = 1) => mix([{ pigment: a, parts: pa }, { pigment: b, parts: pb }]);
/** is hue `h` on the short arc from `a` to `b` */
const between = (h: number, a: number, b: number) => {
  const d = (x: number, y: number) => ((((y - x) % 360) + 540) % 360) - 180;
  return Math.sign(d(a, h)) === Math.sign(d(a, b)) && Math.abs(d(a, h)) < Math.abs(d(a, b));
};

test('pigments: the 14 generic paints, unique ids, traits in range, plain-ASCII names', () => {
  assert.equal(PIGMENTS.length, 14);
  assert.equal(new Set(PIGMENTS.map((p) => p.id)).size, 14);
  for (const p of PIGMENTS) {
    assert.ok(/^[\x20-\x7e]+$/.test(p.name), p.name);
    assert.ok(p.tint > 0 && [p.opacity, p.granulation, p.staining].every((v) => v >= 0 && v <= 1), p.id);
  }
  const mine = customPigment('Quinacridone Rose', [0.55, 0.2, 0]);
  assert.ok(mine.custom && mine.id && mine.tint > 0);
});

test('reflectance: 36 bands over 380-730nm, inside 0..1; yellow reflects red and absorbs blue, blue the reverse', () => {
  const yellow = reflectance(P.hansa.oklch);
  const blue = reflectance(P.ultra.oklch);
  assert.equal(BANDS, 36);
  assert.equal(yellow.length, 36);
  for (const r of [...yellow, ...blue]) assert.ok(r > 0 && r < 1);
  const band = (nm: number) => (nm - 380) / 10;
  assert.ok(yellow[band(650)] > 0.5 && yellow[band(430)] < 0.2);
  assert.ok(blue[band(450)] > blue[band(650)]);
});

test('a paint alone mixes back to its own colour', () => {
  for (const p of PIGMENTS) assert.ok(deltaE(mix([{ pigment: p, parts: 1 }]), p.oklch) < 0.5, p.id);
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#808080', '#123456', '#f0e68c', '#2e1a47']) {
    const o = hexToOklch(hex);
    assert.ok(deltaE(colourOf(paintOf({ oklch: o })), o) < 1.5, hex);
  }
});

test('yellow and blue make green, not grey', () => {
  for (const [y, b] of [[P.hansa, P.phthaloB], [P.hansa, P.ultra], [P.cadyellow, P.ultra]]) {
    const [, c, h] = two(y, b);
    assert.ok(h > 120 && h < 200 && c > 0.05, `${y.id} + ${b.id}: ${c} ${h}`);
  }
  // even as plain screen colours, which light would mix to grey
  const [, c, h] = mix([{ pigment: { oklch: hexToOklch('#ffff00') }, parts: 1 }, { pigment: { oklch: hexToOklch('#0000ff') }, parts: 1 }]);
  assert.ok(h > 120 && h < 200 && c > 0.08, `${c} ${h}`);
});

test('neighbours mix to the hue between them, and stay colourful', () => {
  for (const [a, b] of [[P.cadyellow, P.cadred], [P.ultra, P.alizarin], [P.hansa, P.viridian]]) {
    const [, c, h] = two(a, b);
    assert.ok(between(h, a.oklch[2], b.oklch[2]) && c > 0.05, `${a.id} + ${b.id}: ${c} ${h}`);
  }
});

test('complements cancel toward a dark neutral', () => {
  const [L, c] = two(P.cadred, P.phthaloG);
  assert.ok(c < 0.03 && L < 0.45, `${L} ${c}`);
});

test('white lightens and keeps the hue; strong tinters still win a mix', () => {
  const tint = two(P.tiwhite, P.cadred, 3, 1);
  // a red tint cools toward pink, as it does on a real palette
  assert.ok(tint[0] > P.cadred.oklch[0] && Math.abs(tint[2] - P.cadred.oklch[2]) < 25, `${tint}`);
  // at the same ratio Phthalo stays darker than Ultramarine: Phthalo bullies
  assert.ok(two(P.tiwhite, P.phthaloB, 6, 1)[0] < two(P.tiwhite, P.ultra, 6, 1)[0] - 0.05);
});

test('white covers as on a real palette: tint ladders land where a painter expects', () => {
  const L = (a: Pigment, pa: number, pb: number) => two(P.tiwhite, a, pa, pb)[0];
  const half = L(P.ultra, 1, 1);
  assert.ok(half > 0.6 && half < 0.67, `1:1 white and ultramarine is a mid blue: ${half}`);
  assert.ok(L(P.ultra, 8, 1) > 0.8, 'eight to one is a pale blue');
  const [l, c, h] = two(P.tiwhite, P.cadred, 16, 1);
  assert.ok(l > 0.8 && c < 0.13 && (h > 330 || h < 40), `sixteen to one of cadmium red is a pale pink: ${l} ${c} ${h}`);
  const grey = L(P.lampblack, 1, 1);
  assert.ok(grey > 0.3 && grey < 0.45, `1:1 white and black is a dark grey: ${grey}`);
});

test('parts are proportions: order and scale make no difference', () => {
  const a = two(P.ultra, P.bsienna, 2, 1);
  assert.ok(deltaE(a, two(P.bsienna, P.ultra, 1, 2)) < 1e-9);
  assert.ok(deltaE(a, two(P.ultra, P.bsienna, 4, 2)) < 1e-9);
});

test('mixCurves: a mix is one unit of paint that can go into another mix', () => {
  const [ultra, sienna, white] = [P.ultra, P.bsienna, P.tiwhite].map(paintOf);
  const grey = mixCurves([{ paint: ultra, amount: 1 }, { paint: sienna, amount: 1 }]);
  const again = colourOf(mixCurves([{ paint: grey, amount: 2 }, { paint: white, amount: 2 }]));
  const direct = mix([{ pigment: P.ultra, parts: 1 }, { pigment: P.bsienna, parts: 1 }, { pigment: P.tiwhite, parts: 2 }]);
  assert.ok(deltaE(again, direct) < 1e-6);
  // nothing at all is bare paper
  const paper: Oklch = colourOf(mixCurves([]));
  assert.ok(paper[0] > 0.999);
});
