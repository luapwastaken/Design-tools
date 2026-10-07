import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, inSrgb, type Oklch } from '../src/shared/color/index.ts';
import { valueOf } from '../src/shared/color/value.ts';
import { valueCollisions } from '../src/shared/palette/checks.ts';
import { generate, PRESETS } from '../src/shared/palette/generate.ts';
import type { Swatch } from '../src/shared/types.ts';

const asSwatches = (list: Oklch[]): Swatch[] => list.map((oklch, i) => ({ id: String(i), name: '', role: null, oklch, type: 'process' }));

test('presets: a handful, each with an id, a label and a line of description', () => {
  assert.ok(PRESETS.length >= 5 && PRESETS.length <= 6);
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  for (const p of PRESETS) assert.ok(p.id && p.label && p.describe.length > 10, p.id);
});

test('every preset, every count up to 7, many seeds: passes the value check and stays in sRGB', () => {
  for (const { id } of PRESETS) {
    for (let count = 1; count <= 7; count++) {
      for (let seed = 0; seed < 40; seed++) {
        const out = generate({ seed, count, preset: id, locked: [] });
        assert.equal(out.length, count);
        assert.deepEqual(valueCollisions(asSwatches(out)), [], `${id} count ${count} seed ${seed}`);
        assert.ok(out.every((o) => o.every(Number.isFinite) && inSrgb(o) && o[0] > 0 && o[0] < 1), `${id} ${count} ${seed}`);
      }
    }
  }
});

test('every preset passes the value check up to the 12 colours Build offers', () => {
  for (const { id } of PRESETS) {
    for (let seed = 0; seed < 40; seed++) {
      const out = generate({ seed, count: 12, preset: id, locked: [] });
      assert.deepEqual(valueCollisions(asSwatches(out)), [], `${id} seed ${seed}`);
    }
  }
});

test('the lightness spread is wide, not bunched', () => {
  for (const { id } of PRESETS) {
    const ls = generate({ seed: 7, count: 6, preset: id, locked: [] }).map((o) => o[0]);
    assert.ok(Math.max(...ls) - Math.min(...ls) > 0.5, `${id}: ${ls}`);
  }
});

test('seeded: the same options give the same palette, another seed a different one', () => {
  const opts = { seed: 42, count: 6, preset: 'bold', locked: [] };
  assert.deepEqual(generate(opts), generate(opts));
  assert.notDeepEqual(generate(opts), generate({ ...opts, seed: 43 }));
});

test('locked colours stay in their slot, unchanged, and the rest spread around them', () => {
  const lockA: Oklch = [0.5, 0.15, 30];
  const lockB: Oklch = [0.9, 0.05, 90];
  for (let seed = 0; seed < 40; seed++) {
    const out = generate({ seed, count: 6, preset: 'quiet', locked: [null, lockA, null, null, lockB, null] });
    assert.deepEqual(out[1], lockA);
    assert.deepEqual(out[4], lockB);
    assert.deepEqual(valueCollisions(asSwatches(out)), [], `seed ${seed}`);
  }
});

test('free slots run dark to light, in value', () => {
  const out = generate({ seed: 3, count: 5, preset: 'warm', locked: [] });
  const vs = out.map(valueOf);
  assert.deepEqual(vs, [...vs].sort((a, b) => a - b));
});

test('a locked colour steers the hue when the preset has no hue range of its own', () => {
  const lock: Oklch = [0.55, 0.18, 250];
  const out = generate({ seed: 5, count: 4, preset: 'quiet', locked: [lock] });
  const away = (h: number) => Math.min(Math.abs(h - 250), 360 - Math.abs(h - 250));
  assert.ok(out.slice(1).every((o) => away(o[2]) <= 30), out.map((o) => o[2]).join(' '));
});

test('editorial and tech carry exactly one strong accent', () => {
  for (const preset of ['editorial', 'tech']) {
    const out = generate({ seed: 11, count: 6, preset, locked: [] });
    assert.equal(out.filter((o) => o[1] > 0.1).length, 1, preset);
  }
});

test('an unknown preset falls back to the first, and count 0 gives nothing', () => {
  assert.deepEqual(generate({ seed: 1, count: 3, preset: 'nope', locked: [] }), generate({ seed: 1, count: 3, preset: PRESETS[0].id, locked: [] }));
  assert.deepEqual(generate({ seed: 1, count: 0, preset: 'bold', locked: [] }), []);
});

test('Suggest follows the palette’s hues, not just its most colourful one, and never repeats a colour', () => {
  const own: Oklch[] = [[0.5, 0.14, 250], [0.55, 0.1, 190], [0.6, 0.16, 25], [0.93, 0.02, 90]];
  const seen = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const made = generate({ seed, count: own.length + 6, preset: 'quiet', locked: own }).slice(own.length);
    assert.ok(made.filter((o) => o[1] >= 0.03).length >= 3, `seed ${seed}: a chromatic palette gets colours with colour in them`);
    made.forEach((o) => seen.add(Math.round(o[2] / 40)));
    [...own, ...made].forEach((a, i, all) => all.slice(i + 1).forEach((b) => assert.ok(deltaE(a, b) > 3, `seed ${seed}: two colours alike`)));
  }
  assert.ok(seen.size >= 5, `hues spread over ${seen.size} bins`);
});
