import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToOklch, inSrgb, toHex, type Oklch } from '../src/shared/color/index.ts';
import { gradientStops } from '../src/shared/palette/gradient.ts';
import { harmony, type HarmonyKind } from '../src/shared/palette/harmony.ts';
import { INK_LIBRARIES, INKS, nearestInks } from '../src/shared/palette/inks.ts';
import { autoName } from '../src/shared/palette/names.ts';
import { isGround, isInk, ROLES } from '../src/shared/palette/roles.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ── roles ────────────────────────────────────────────────────────────────────────────────────────

test('roles: job names; grounds and inks split them, free strings and null are neither', () => {
  assert.deepEqual([...ROLES], ['Background', 'Surface', 'Text', 'Muted', 'Primary', 'Accent', 'Highlight']);
  assert.deepEqual(ROLES.filter(isGround), ['Background', 'Surface']);
  assert.deepEqual(ROLES.filter(isInk), ['Text', 'Muted', 'Primary', 'Accent', 'Highlight']);
  for (const other of ['Secondary', '', null]) assert.deepEqual([isGround(other), isInk(other)], [false, false]);
});

// ── harmony ──────────────────────────────────────────────────────────────────────────────────────

test('harmony: hue turns at the base lightness, not including the base', () => {
  const base: Oklch = [0.62, 0.12, 40];
  const turns: Record<HarmonyKind, number[]> = {
    complementary: [220],
    analogous: [10, 70],
    triad: [160, 280],
    split: [190, 250],
    tetrad: [130, 220, 310],
  };
  for (const [kind, hues] of Object.entries(turns) as [HarmonyKind, number[]][]) {
    const out = harmony(base, kind);
    assert.deepEqual(out.map((o) => Math.round(o[2])), hues, kind);
    for (const o of out) {
      assert.equal(o[0], base[0]);
      assert.ok(o[1] <= base[1] && inSrgb(o), `${kind}: fitted to sRGB`);
    }
  }
});

test('harmony: chroma a hue cannot carry in sRGB is cut, L and h exact', () => {
  const [opposite] = harmony([0.88, 0.2, 100], 'complementary'); // bright yellow; its opposite blue can't be that light and vivid
  assert.equal(opposite[0], 0.88);
  assert.equal(opposite[2], 280);
  assert.ok(opposite[1] < 0.2 && inSrgb(opposite));
});

// ── gradient ─────────────────────────────────────────────────────────────────────────────────────

test('gradient: n stops strictly between, evenly', () => {
  const stops = gradientStops([0.2, 0.1, 30], [0.8, 0.1, 90], 3, 'oklch');
  assert.equal(stops.length, 3);
  stops.forEach((o, i) => {
    near(o[0], 0.2 + 0.15 * (i + 1));
    near(o[2], 30 + 15 * (i + 1));
  });
  assert.deepEqual(gradientStops([0.2, 0.1, 30], [0.8, 0.1, 90], 0, 'oklch'), []);
});

test('gradient: between two sRGB colours the stops stay in sRGB', () => {
  const stops = gradientStops([0.62, 0.25, 350], [0.9, 0.05, 180], 5, 'oklch');
  assert.ok(stops.every(inSrgb), 'an OKLCH arc bulges out of sRGB; the stops are brought back in');
});

test('gradient: in OKLCH the hue takes the short way round', () => {
  const [mid] = gradientStops([0.5, 0.1, 350], [0.5, 0.1, 30], 1, 'oklch');
  near(mid[2], 10);
  const [back] = gradientStops([0.5, 0.1, 30], [0.5, 0.1, 350], 1, 'oklch');
  near(back[2], 10);
});

test('gradient: a grey end takes the other end’s hue instead of sweeping', () => {
  const white = hexToOklch('#ffffff');
  const stops = gradientStops(white, [0.5, 0.15, 250], 3, 'oklch');
  assert.ok(stops.every((o) => Math.abs(o[2] - 250) < 1e-9));
});

test('gradient: OKLab runs straight, so complements pass through grey', () => {
  const [mid] = gradientStops([0.6, 0.1, 0], [0.6, 0.1, 180], 1, 'oklab');
  near(mid[0], 0.6, 1e-6);
  near(mid[1], 0, 1e-6);
  const ends = gradientStops(hexToOklch('#000000'), hexToOklch('#ffffff'), 1, 'oklab');
  assert.equal(toHex(ends[0]), toHex([0.5, 0, 0]));
});

// ── inks and names ───────────────────────────────────────────────────────────────────────────────

test('inks: the four libraries ported from v1, as OKLCH with 6-digit hex', () => {
  assert.deepEqual(INK_LIBRARIES, ['riso', 'ral', 'hks', 'ncs']);
  assert.deepEqual(INK_LIBRARIES.map((l) => INKS[l].length), [35, 187, 46, 48]);
  for (const lib of INK_LIBRARIES)
    for (const ink of INKS[lib]) {
      assert.match(ink.hex, /^#[0-9a-f]{6}$/);
      assert.equal(toHex(ink.oklch), ink.hex);
      assert.ok(ink.id && ink.name);
    }
});

test('nearestInks: closest first, n of them', () => {
  const ral = INKS.ral.find((i) => i.id === 'RAL3020')!;
  const out = nearestInks(ral.oklch, 'ral', 3);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 'RAL3020');
  assert.ok(out[0].deltaE <= out[1].deltaE && out[1].deltaE <= out[2].deltaE);
  assert.deepEqual(Object.keys(out[0]).sort(), ['deltaE', 'hex', 'id', 'library', 'name']);
});

test('autoName: the nearest name of the v1 list', () => {
  assert.equal(autoName(hexToOklch('#e52b50')), 'Amaranth');
  assert.equal(autoName(hexToOklch('#fefefe')), 'White');
  assert.equal(autoName(hexToOklch('#010101')), 'Black');
  assert.equal(typeof autoName([0.62, 0.14, 150]), 'string');
});
