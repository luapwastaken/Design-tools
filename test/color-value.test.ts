import { test } from 'node:test';
import assert from 'node:assert/strict';
import { converter } from 'culori';
import { inSrgb, rgb255, type Oklch } from '../src/shared/color/index.ts';
import { fromHsb } from '../src/shared/color/picker.ts';
import { greyOf, holdValue, hsbHold, LUMA, pureLuma, valueOf } from '../src/shared/color/value.ts';

const HUES = Array.from({ length: 72 }, (_, i) => i * 5);
const rgbOf = converter('rgb');

test('value is Rec. 709 luma of the gamma-encoded colour the screen shows', () => {
  for (const o of [[0.7, 0.15, 90], [0.45, 0.3, 264], [0.62, 0.25, 29], [0.9, 0.05, 200]] as Oklch[]) {
    const [r, g, b] = rgb255(o);
    const expect = (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / 255;
    assert.ok(Math.abs(valueOf(o) - expect) < 0.5 / 255, `${o}: ${valueOf(o)} vs ${expect}`);
  }
  assert.equal(valueOf([0, 0, 0]), 0);
  assert.ok(Math.abs(valueOf([1, 0, 0]) - 1) < 1e-9);
});

test('OKLCH L is not value: at one L the grey moves with hue, which is why the lock holds value', () => {
  const vs = HUES.map((h) => valueOf([0.7, 0.12, h]));
  assert.ok(Math.max(...vs) - Math.min(...vs) > 0.03);
});

test('greyOf is the grey with that value', () => {
  for (const v of [0, 0.05, 0.18, 0.5, 0.613, 0.92, 1]) {
    const g = greyOf(v, 123);
    assert.equal(g[1], 0);
    assert.equal(g[2], 123);
    assert.ok(Math.abs(valueOf(g) - v) < 1e-6, `${v}: ${valueOf(g)}`);
    const { r, g: gg, b } = rgbOf({ mode: 'oklch', l: g[0], c: 0, h: 0 })!;
    assert.ok(Math.abs(r - gg) < 1e-9 && Math.abs(gg - b) < 1e-9);
  }
});

test('holdValue keeps the value across the whole hue circle (a red to a blue reads as one grey)', () => {
  const start: Oklch = [0.62, 0.2, 29];
  const target = valueOf(start);
  for (const h of HUES) {
    const o = holdValue(target, start[1], h);
    assert.equal(o[2], h);
    assert.ok(inSrgb(o), `${h}: ${o} outside sRGB`);
    assert.ok(Math.abs(valueOf(o) - target) < 1e-4, `${h}: ${valueOf(o)} vs ${target}`);
  }
});

test('holdValue keeps chroma where it can, and gives chroma up only where the value needs it', () => {
  const kept = holdValue(0.5, 0.05, 145);
  assert.ok(Math.abs(kept[1] - 0.05) < 1e-9);
  // a light value at a strong blue chroma: no L reaches it inside sRGB, so chroma yields
  const blue = holdValue(0.85, 0.25, 264);
  assert.ok(blue[1] < 0.25);
  assert.ok(inSrgb(blue));
  assert.ok(Math.abs(valueOf(blue) - 0.85) < 1e-3, `${valueOf(blue)}`);
});

test('holdValue at the ends: black and white have no chroma', () => {
  assert.deepEqual(holdValue(0, 0.2, 30), [0, 0, 30]);
  assert.deepEqual(holdValue(1, 0.2, 30), [1, 0, 30]);
  const dark = holdValue(0.02, 0.1, 30);
  assert.ok(Math.abs(valueOf(dark) - 0.02) < 1e-3);
});

test('pureLuma is the luma of the pure HSB hues', () => {
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;
  assert.ok(close(pureLuma(0), LUMA[0]));
  assert.ok(close(pureLuma(120), LUMA[1]));
  assert.ok(close(pureLuma(240), LUMA[2]));
  assert.ok(close(pureLuma(60), LUMA[0] + LUMA[1]));
  assert.ok(close(pureLuma(180), LUMA[1] + LUMA[2]));
  assert.ok(close(pureLuma(300), LUMA[0] + LUMA[2]));
});

test('hsbHold lands on the value in HSB exactly, and saturation gives way above the hue', () => {
  for (const h of [0, 47, 120, 200, 240, 333]) {
    for (const t of [0.1, 0.35, 0.6, 0.85]) {
      const [s, b] = hsbHold(t, h, 70);
      assert.ok(b <= 100 + 1e-9 && s >= 0 && s <= 100);
      const v = valueOf(fromHsb([h, s, b]));
      assert.ok(Math.abs(v - t) < 1e-6, `h ${h} t ${t}: ${v}`);
    }
  }
  // pure blue is dark: a light value keeps B at 100 and drops saturation
  const [s, b] = hsbHold(0.8, 240, 100);
  assert.equal(b, 100);
  assert.ok(s < 30);
});
