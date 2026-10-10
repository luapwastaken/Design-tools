import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inSrgb, toHex } from '../src/shared/color/index.ts';
import { colourToKelvin, KELVIN, kelvinToColour, kelvinWords } from '../src/shared/color/kelvin.ts';
import { linearOf } from '../src/shared/palette/zones.ts';

const KS = [1000, 1500, 1900, 2700, 3200, 3500, 4500, 5600, 6500, 7500, 9000, 12000];

test('warm to cool: red falls and blue rises as the temperature climbs', () => {
  // at a middle lightness, where sRGB can show them (a pale warm light is clipped at red = 1 and the order blurs there)
  const up = KS.filter((k) => k >= 2700);
  let prev = linearOf(kelvinToColour(up[0], 0.5));
  for (const k of up.slice(1)) {
    const now = linearOf(kelvinToColour(k, 0.5));
    // the blue share of the light rises, the red share falls
    const share = (c: number[]) => [c[0] / (c[0] + c[1] + c[2]), c[2] / (c[0] + c[1] + c[2])];
    assert.ok(share(now)[0] < share(prev)[0] + 1e-9, `red ${k}`);
    assert.ok(share(now)[1] > share(prev)[1] - 1e-9, `blue ${k}`);
    prev = now;
  }
});

test('6500 K is neutral', () => {
  const c = kelvinToColour(KELVIN.neutral);
  assert.ok(c[1] < 0.003, `chroma ${c[1]}`);
  const [r, g, b] = linearOf(c);
  assert.ok(Math.abs(r - g) < 0.01 && Math.abs(g - b) < 0.01);
  // candle light is orange, noon sky is bluer than 6500 K
  assert.ok(kelvinToColour(1900)[2] < 90 && kelvinToColour(1900)[1] > 0.05);
  assert.ok(kelvinToColour(10000)[2] > 230);
});

test('every temperature, at the lightnesses a light has, is a colour sRGB can show', () => {
  for (const k of KS) for (const l of [0.3, 0.64, 0.9, 0.98]) assert.ok(inSrgb(kelvinToColour(k, l)), `${k} K at ${l}: ${toHex(kelvinToColour(k, l))}`);
  // out-of-range and junk are pulled in
  assert.deepEqual(kelvinToColour(500), kelvinToColour(KELVIN.min));
  assert.deepEqual(kelvinToColour(99999), kelvinToColour(KELVIN.max));
  assert.deepEqual(kelvinToColour(NaN), kelvinToColour(KELVIN.neutral));
});

test('reading back gives the temperature it came from', () => {
  for (const k of KS) {
    for (const l of [0.64, 0.9]) {
      const back = colourToKelvin(kelvinToColour(k, l));
      assert.ok(!back.off, `${k} at ${l} read as off the line`);
      assert.ok(Math.abs(back.k - k) <= Math.max(60, k * 0.02), `${k} K at ${l} read as ${back.k}`);
    }
  }
  assert.equal(kelvinWords(kelvinToColour(3200)), 'about 3200 K');
});

test('a colour well off the line says so', () => {
  assert.equal(kelvinWords([0.675, 0.16, 1.5]), 'off the blackbody line');
  assert.equal(kelvinWords([0.7, 0.15, 150]), 'off the blackbody line');
  assert.ok(colourToKelvin([0.8, 0.12, 330]).off);
});
