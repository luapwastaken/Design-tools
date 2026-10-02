import { test } from 'node:test';
import assert from 'node:assert/strict';
import { converter } from 'culori';
import { linearRgb, toOklch } from '../src/shared/color/index.ts';
import { BANDS, mix, paintOf } from '../src/shared/paint/km.ts';
import { BASIS15, colour15, GROUPS, layer15, linear15, mix15, N15, paint15, reflectance15, W15 } from '../src/shared/paint/km15.ts';
import { PIGMENTS } from '../src/shared/paint/pigments.ts';
import { KM } from '../src/renderer/tools/illustration/paint/glsl/km.ts';
import { mixCases } from '../src/renderer/tools/illustration/paint/km-cases.ts';
import { WET } from '../src/renderer/tools/illustration/paint/tuning.ts';

const lrgb = converter('lrgb');
const paints = PIGMENTS.map((p) => paint15(paintOf(p)));
const byId = Object.fromEntries(PIGMENTS.map((p, i) => [p.id, paints[i]]));

test("km.ts's bands fall into 15 flat groups that cover all 36 in order", () => {
  assert.equal(N15, 15);
  assert.deepEqual(GROUPS.flat(), Array.from({ length: BANDS }, (_, i) => i));
  assert.deepEqual(GROUPS.map((g) => g.length), [8, 1, 1, 1, 1, 1, 1, 5, 1, 1, 1, 1, 1, 1, 11]);
  // a flat reflectance of 1 is exactly white, as in km.ts
  for (const w of W15) assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('every paint has one S and a flat K in each group', () => {
  for (const [i, p] of PIGMENTS.entries()) {
    const full = paintOf(p);
    assert.equal(paints[i].S, full.S[0], p.id);
    assert.ok(paints[i].K.every(Number.isFinite), p.id);
  }
});

test('520 mixes at 15 groups match km.ts mix() in float64', () => {
  const cases = mixCases();
  assert.equal(cases.length, 520);
  let worst = 0;
  for (const parts of cases) {
    // straight to linear, not through the hex linearRgb() reads
    const [l, c, h] = mix(parts.map(([i, n]) => ({ pigment: PIGMENTS[i], parts: n })));
    const { r, g, b } = lrgb({ mode: 'oklch', l, c, h });
    const want = [r, g, b];
    const got = colour15(mix15(parts.map(([i, n]) => ({ paint: paints[i], amount: n }))));
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got[c] - want[c]));
  }
  assert.ok(worst < 1e-6, `worst linear difference ${worst}`);
});

test('reflectance15 round-trips a colour as km.ts reflectance() does', () => {
  for (const p of PIGMENTS) {
    const want = linearRgb(p.oklch);
    const got = linear15(reflectance15(want));
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(got[c] - want[c]) < 2e-3, `${p.id} ${got} ${want}`);
  }
});

test('a layer stays finite and between 0 and 1 even where K/S reaches 5000', () => {
  for (const q of [0, 1e-9, 1, 50, 5000, 1e5]) {
    for (const x of [0, 1e-4, 0.05, 1, 40]) {
      for (const Rg of [0, 0.5, 0.9]) {
        const R = layer15(q * 2, 2, x, Rg);
        assert.ok(Number.isFinite(R) && R >= 0 && R <= 1, `q ${q} x ${x} Rg ${Rg}: ${R}`);
      }
    }
  }
  // no thickness leaves the backing; a thick layer is its R-infinity
  assert.ok(Math.abs(layer15(3, 1, 0, 0.7) - 0.7) < 1e-9);
  assert.ok(Math.abs(layer15(3, 1, 200, 0.7) - 1 / (1 + 3 + Math.sqrt(15))) < 1e-9);
});

test('Ultramarine glazed over Hansa Yellow is green', () => {
  const paper = reflectance15([0.88, 0.87, 0.83]);
  const x = WET.glazeCheck;
  const hansa = Array.from(paper, (r, i) => layer15(byId.hansa.K[i], byId.hansa.S, x, r));
  const both = hansa.map((r, i) => layer15(byId.ultra.K[i], byId.ultra.S, x, r));
  const [r, g, b] = linear15(both);
  const [, C, h] = toOklch({ mode: 'lrgb', r, g, b });
  assert.ok(h >= 120 && h <= 165 && C >= 0.05, `hue ${h.toFixed(1)}, chroma ${C.toFixed(3)}`);
});

test('the GLSL constants are 15 finite numbers each, in four vec4s with the 16th lane zero', () => {
  const lanes = [...KM.matchAll(/const vec4 (\w+)_(\d) = vec4\(([^)]*)\);/g)];
  const byName = new Map<string, number[][]>();
  for (const [, name, j, list] of lanes) {
    const row = byName.get(name) ?? [];
    row[Number(j)] = list.split(',').map(Number);
    byName.set(name, row);
  }
  assert.equal(byName.size, 3 + Object.keys(BASIS15).length);
  for (const [name, rows] of byName) {
    const values = rows.flat();
    assert.equal(rows.length, 4, name);
    assert.equal(values.length, 16, name);
    assert.ok(values.every(Number.isFinite), name);
    assert.equal(values[15], 0, name);
  }
  assert.ok(!/NaN|Infinity/.test(KM));
});
