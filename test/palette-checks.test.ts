import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, hexToOklch, type Oklch } from '../src/shared/color/index.ts';
import { contrastPairs, contrastTarget, cvdClosest, printInfo, valueCollisions } from '../src/shared/palette/checks.ts';
import { INKS } from '../src/shared/palette/inks.ts';
import type { Swatch } from '../src/shared/types.ts';

const sw = (name: string, colour: string | Oklch, role: string | null = null): Swatch => ({
  id: name,
  name,
  role,
  oklch: typeof colour === 'string' ? hexToOklch(colour) : colour,
  type: 'process',
});

/** the Monolith core palette from the mockup */
const MONOLITH = [
  sw('Ground', '#14161a', 'Background'),
  sw('Bone', '#efe9dd', 'Text'),
  sw('Iron', '#6b6f76', 'Muted'),
  sw('Ember', '#e8643c', 'Accent'),
  sw('Moss', '#3f6b4f'),
  sw('Sky', '#8fb8de', 'Highlight'),
];
const pairName = (p: { text: Swatch; ground: Swatch }) => `${p.text.name} on ${p.ground.name}`;

// ── contrast ─────────────────────────────────────────────────────────────────────────────────────

test('contrast: every other swatch on each ground role, with ratio, grade and target', () => {
  const pairs = contrastPairs(MONOLITH);
  assert.deepEqual(pairs.map(pairName), ['Bone on Ground', 'Iron on Ground', 'Ember on Ground', 'Moss on Ground', 'Sky on Ground']);
  assert.deepEqual(pairs.map((p) => p.ratio.toFixed(1)), ['15.0', '3.6', '5.5', '3.0', '8.7']);
  assert.deepEqual(pairs.map((p) => p.grade), ['AAA', 'AA large · non-text', 'AA', 'Fail', 'AAA']);
  assert.deepEqual(pairs.map((p) => p.target), [4.5, 4.5, 4.5, 4.5, 3]);
  assert.deepEqual(pairs.map((p) => p.fix === null), [true, false, true, false, true]);
});

test('contrast: free roles (a border, a disabled grey) are not checked as text', () => {
  const pairs = contrastPairs([sw('Paper', '#fafafa', 'Background'), sw('Ink', '#202020', 'Text'), sw('Hairline', '#dddddd', 'Border'), sw('Ash', '#cccccc', 'Disabled')]);
  assert.deepEqual(pairs.map(pairName), ['Ink on Paper']);
});

test('contrast fix with two grounds: one lightness that passes on both, or none when they sit either side', () => {
  const both = contrastPairs([sw('Page', [0.97, 0, 0], 'Background'), sw('Card', [0.9, 0, 0], 'Surface'), sw('Ink', [0.62, 0, 0], 'Text')]);
  const fixes = both.map((p) => p.fix!.oklch[0]);
  assert.equal(fixes[0], fixes[1], 'the same fix on both rows');
  for (const p of both) assert.ok(contrast(p.fix!.oklch, p.ground.oklch) >= 4.5, pairName(p));
  const apart = contrastPairs([sw('Page', [0.95, 0, 0], 'Background'), sw('Card', [0.3, 0, 0], 'Surface'), sw('Ink', [0.6, 0, 0], 'Text')]);
  assert.deepEqual(apart.map((p) => p.fix), [null, null]);
});

test('contrast fix keeps clear of the other lightnesses when a little more of a move does it', () => {
  const list = [sw('Ground', [0.97, 0.01, 80], 'Background'), sw('Olive', [0.63, 0.1, 110], 'Muted'), sw('Chocolate', [0.52, 0.08, 50], 'Highlight')];
  const least = contrastPairs(list).find((p) => p.text.name === 'Olive')!.fix!.oklch[0];
  const clear = contrastPairs(list, { minGap: 0.06 }).find((p) => p.text.name === 'Olive')!.fix!.oklch[0];
  assert.ok(Math.abs(least - 0.52) < 0.06, `the least move lands on Chocolate: ${least}`);
  assert.ok(Math.abs(clear - 0.52) >= 0.06 - 1e-9 && clear < least, `a clear one: ${clear}`);
});

test('contrast fix keeps a wide-gamut colour wide', () => {
  const laser: Oklch = [0.7, 0.32, 145];
  const [p] = contrastPairs([sw('Page', '#ffffff', 'Background'), sw('Laser', laser, 'Text')]);
  assert.equal(p.fix!.oklch[1], 0.32);
});

test('contrast targets: fills (Primary, Highlight) need 3:1, everything else 4.5:1', () => {
  assert.deepEqual(['Text', 'Muted', 'Accent', 'Primary', 'Highlight', 'Other', null].map(contrastTarget), [4.5, 4.5, 4.5, 3, 3, 4.5, 4.5]);
});

test('contrast fix: the smallest lightness move that reaches the target, hue kept', () => {
  for (const p of contrastPairs(MONOLITH).filter((x) => x.fix)) {
    const { fix, text, ground } = p;
    assert.equal(fix!.swatchId, text.id);
    assert.ok(fix!.ratio >= p.target, `${pairName(p)} reaches ${fix!.ratio}`);
    assert.ok(fix!.ratio < p.target + 0.1, `${pairName(p)} doesn't overshoot: ${fix!.ratio}`);
    assert.equal(fix!.ratio, contrast(fix!.oklch, ground.oklch));
    assert.equal(fix!.oklch[2], text.oklch[2], 'hue exactly kept');
    assert.ok(fix!.oklch[1] <= text.oklch[1], 'chroma never grows');
    assert.ok(fix!.oklch[0] > text.oklch[0], 'lifted, away from the dark ground');
    assert.equal(fix!.oklch[0], Math.round(fix!.oklch[0] * 1000) / 1000, 'a readable L');
  }
  const moss = contrastPairs(MONOLITH).find((p) => p.text.name === 'Moss')!;
  assert.ok(Math.abs(moss.fix!.oklch[0] - 0.58) < 0.02, `the mockup says L 58: ${moss.fix!.oklch[0]}`);
});

test('contrast fix on a light ground darkens; a saturated colour loses chroma only to stay in sRGB', () => {
  const [pair] = contrastPairs([sw('Paper', '#fafafa', 'Background'), sw('Lime', '#a0ff40', 'Text')]);
  assert.ok(pair.fix!.oklch[0] < pair.text.oklch[0]);
  assert.ok(pair.fix!.ratio >= 4.5);
  const [ok] = contrastPairs([sw('Paper', '#fafafa', 'Background'), sw('Ink', '#111111', 'Text')]);
  assert.equal(ok.fix, null);
});

test('contrast: two ground roles check each other swatch on both', () => {
  const pairs = contrastPairs([sw('Page', '#ffffff', 'Background'), sw('Card', '#f0f0f0', 'Surface'), sw('Ink', '#222222', 'Text')]);
  assert.deepEqual(pairs.map(pairName), ['Ink on Page', 'Ink on Card']);
});

test('contrast without roles: darkest and lightest stand in as grounds, each other swatch on its better one', () => {
  const pairs = contrastPairs([sw('Mid', '#777777'), sw('Night', '#101010'), sw('Pale', '#bbbbbb'), sw('Snow', '#fafafa'), sw('Dusk', '#333333')]);
  assert.deepEqual(pairs.map(pairName), ['Mid on Snow', 'Pale on Night', 'Dusk on Snow']);
  assert.deepEqual(contrastPairs([sw('One', '#777777')]), []);
  assert.deepEqual(contrastPairs([sw('Ink', '#202020'), sw('Paper', '#f0f0f0')]).map(pairName), ['Paper on Ink'], 'two swatches: the light on the dark');
});

test('contrast with ink roles but no ground role: grounds come from the swatches without one', () => {
  const pairs = contrastPairs([sw('Body', '#f5f5f5', 'Text'), sw('Base', '#101418'), sw('Brand', '#e8643c', 'Primary')]);
  assert.deepEqual(pairs.map(pairName), ['Body on Base', 'Brand on Base']);
});

// ── value ────────────────────────────────────────────────────────────────────────────────────────

test('value: pairs closer than the threshold in OKLCH L, closest first', () => {
  const list = [sw('A', [0.5, 0.1, 30]), sw('B', [0.54, 0.1, 200]), sw('C', [0.9, 0, 0]), sw('D', [0.51, 0, 0])];
  const hits = valueCollisions(list);
  assert.deepEqual(hits.map((h) => `${h.a.name}${h.b.name}`), ['AD', 'BD', 'AB']);
  assert.ok(Math.abs(hits[0].deltaL - 0.01) < 1e-12);
  assert.deepEqual(valueCollisions(list, 0.02).map((h) => `${h.a.name}${h.b.name}`), ['AD']);
  assert.equal(valueCollisions(MONOLITH).length, 1, 'the mockup shows one collision (Moss and Iron)');
  const grounds = [sw('Page', [0.965, 0, 0], 'Background'), sw('Card', [0.933, 0, 0], 'Surface'), sw('Ink', [0.94, 0, 0])];
  assert.deepEqual(valueCollisions(grounds).map((h) => `${h.a.name}${h.b.name}`), ['CardInk', 'PageInk'], 'a card may sit close to its page');
  assert.equal(valueCollisions([sw('A', [0.52, 0, 0]), sw('B', [0.58, 0, 0])]).length, 0, 'exactly 6.0 apart is not flagged');
});

// ── colour vision ────────────────────────────────────────────────────────────────────────────────

test('colour vision: the closest pair as seen, flagged below the threshold', () => {
  const list = [sw('Red', '#d03030'), sw('Green', '#5a8a2a'), sw('Blue', '#2040c0'), sw('White', '#ffffff')];
  const typical = cvdClosest(list, 'typical')!;
  const deutan = cvdClosest(list, 'deutan')!;
  assert.equal(`${deutan.a.name}/${deutan.b.name}`, 'Red/Green');
  assert.ok(deutan.deltaE < typical.deltaE);
  assert.equal(deutan.flag, deutan.deltaE < 10);
  assert.equal(cvdClosest(list, 'deutan', { flagBelow: 0 })!.flag, false);
  const achromat = cvdClosest(MONOLITH, 'achromat')!;
  assert.deepEqual([achromat.a.name, achromat.b.name], ['Iron', 'Moss'], 'the mockup: Iron and Moss merge');
  assert.ok(achromat.flag);
  assert.equal(cvdClosest([sw('Only', '#123456')], 'protan'), null);
});

// ── print ────────────────────────────────────────────────────────────────────────────────────────

test('print: ≈CMYK, gamut flags and the nearest ink of each library', () => {
  const riso = INKS.riso.find((i) => i.id === 'blue')!;
  const info = printInfo(sw('Riso blue', riso.hex));
  assert.deepEqual(info.nearest.map((n) => n.library), ['riso', 'ral', 'hks', 'ncs']);
  assert.equal(info.nearest[0].id, 'blue');
  assert.ok(info.nearest[0].deltaE < 1e-6);
  assert.ok(info.nearest.every((n) => /^#[0-9a-f]{6}$/.test(n.hex) && n.name && n.deltaE >= 0));
  assert.equal(info.inSrgb, true);
  assert.equal(info.cmyk.length, 4);
  const p3 = printInfo(sw('Wide', [0.85, 0.3, 142]));
  assert.deepEqual([p3.inSrgb, p3.inP3], [false, true]);
});
