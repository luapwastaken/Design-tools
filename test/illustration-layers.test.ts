import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Oklch } from '../src/shared/color/index.ts';
import { ALL_ON, composite8, hexRgb, solveRecipe } from '../src/shared/palette/recipe.ts';
import type { MaterialId } from '../src/shared/types.ts';
import type { Bust } from '../src/renderer/tools/illustration/bust.ts';
import { PART_IDS } from '../src/renderer/tools/illustration/bust.ts';
import { addRamp, emptyDoc, recolour, stepsOf, type IllustrationDoc } from '../src/renderer/tools/illustration/doc.ts';
import { allFlats, allTogether, cleanLayers, cleanPct, DEFAULT_LAYERS, defaultParts, hintOf, paintRecipe, paintTargets, partRamps, proposalName, recipeFlats, rowsOf } from '../src/renderer/tools/illustration/layers.ts';
import { sceneLight } from '../src/renderer/tools/illustration/scene.ts';

const FIXTURE: [Oklch, string, MaterialId][] = [[[0.74, 0.075, 55], 'Skin', 'skin'], [[0.78, 0.09, 85], 'Hair', 'fur'], [[0.55, 0.09, 250], 'Shirt', 'cloth'], [[0.6, 0.12, 140], 'Leaf', 'foliage']];
const palette = (list = FIXTURE): IllustrationDoc => list.reduce((d, [b, n, m]) => addRamp(d, b, n, null, m).doc, emptyDoc());
const flags = (o: Partial<Record<'layerBg' | 'layerStar' | 'layerOut', string[]>> = {}) => ({ layerBg: [], layerStar: [], layerOut: [], ...o });

test('parts default by material, then to the ramps no part has, then to the palette in order', () => {
  const d = palette();
  const ids = d.ramps.map((r) => r.id);
  // skin to Skin, hair to Hair (fur), top to Shirt (cloth), the background to Leaf; with no second cloth the under-top shares the Shirt
  assert.deepEqual(defaultParts(d.ramps), { skin: ids[0], hair: ids[1], top: ids[2], under: ids[2], bg: ids[3] });
  // two cloths: the second is the under-top
  const two = palette([FIXTURE[0], FIXTURE[2], [[0.5, 0.1, 20], 'Coat', 'cloth']]);
  const t = two.ramps.map((r) => r.id);
  assert.equal(defaultParts(two.ramps).top, t[1]);
  assert.equal(defaultParts(two.ramps).under, t[2]);
  // a ramp no part likes goes to the first part without one, in palette order
  const odd = palette([FIXTURE[0], FIXTURE[1], FIXTURE[2], [[0.6, 0.03, 70], 'Rock', 'stone'], [[0.5, 0.1, 20], 'Coat', 'cloth']]);
  const o = odd.ramps.map((r) => r.id);
  assert.deepEqual(defaultParts(odd.ramps), { skin: o[0], hair: o[1], top: o[2], under: o[4], bg: o[3] });
  // one ramp: every part shows it; none: no part has one
  const one = palette([FIXTURE[0]]);
  assert.ok(PART_IDS.every((p) => defaultParts(one.ramps)[p] === one.ramps[0].id));
  assert.ok(PART_IDS.every((p) => defaultParts([])[p] === null));
  // a paper ramp is the background's first choice
  const wall = palette([FIXTURE[0], [[0.78, 0.08, 235], 'Wall', 'paper']]);
  assert.equal(defaultParts(wall.ramps).bg, wall.ramps[1].id);
  // and ahead of a foliage ramp that comes first in the palette: the materials a part likes are ranked
  const both = palette([FIXTURE[0], FIXTURE[3], [[0.78, 0.08, 235], 'Wall', 'paper']]);
  assert.equal(defaultParts(both.ramps).bg, both.ramps[2].id);
});

test('a chosen ramp holds for its part while the palette has it, and is dropped when it is gone', () => {
  const d = palette();
  const [a, b] = d.ramps.map((r) => r.id);
  assert.equal(partRamps(d, { skin: b }).skin, b);
  assert.equal(partRamps(d, { skin: 'gone' }).skin, a);
  assert.equal(partRamps(d, {}).skin, a);
});

test('the view’s Layers part is made sound: percents whole and in range, lists once, only real parts', () => {
  const out: Record<string, unknown> = {};
  cleanLayers({ layerRim: 140.4, layerMood: -3, layerOut: ['a', 'a', 4, 'b'], layerBg: 'x', layerStar: null, layerParts: { skin: 'r1', hair: 4, nonsense: 'r2', bg: 'r3' } }, out);
  assert.deepEqual(out, { layerRim: 100, layerMood: 0, layerOut: ['a', 'b'], layerBg: [], layerStar: [], layerParts: { skin: 'r1', bg: 'r3' } });
  cleanLayers({ layerRim: 'x', layerMood: NaN, layerParts: [1] }, out);
  assert.equal(out.layerRim, DEFAULT_LAYERS.layerRim);
  assert.equal(out.layerMood, DEFAULT_LAYERS.layerMood);
  assert.deepEqual(out.layerParts, {});
  assert.equal(cleanPct(33.6, 1), 34);
  // what is saved comes back: a round trip through JSON
  const saved = { layerRim: 20, layerMood: 80, layerOut: ['a'], layerBg: ['b'], layerStar: ['c'], layerParts: { top: 'r9' } };
  const back: Record<string, unknown> = {};
  cleanLayers(JSON.parse(JSON.stringify(saved)), back);
  assert.deepEqual(back, saved);
});

test('flats are the ramps’ bases and the targets their own steps, a hand-edited one honoured', () => {
  const d = palette();
  const flats = allFlats(d, flags());
  assert.deepEqual(flats.map((f) => f.name), ['Skin', 'Hair', 'Shirt', 'Leaf']);
  assert.ok(flats.every((f) => /^#[0-9A-F]{6}$/.test(f.hex)));
  const skin = d.ramps[0];
  const steps = stepsOf(d, skin.id);
  const first = steps.find((w) => w.step === 1)!;
  assert.deepEqual(flats[0].targets.shadow, first.oklch);
  // recolour that step by hand: the target follows it, and the other flats are as they were
  const edit: Oklch = [0.3, 0.07, 15];
  const edited = recolour(d, first.id, edit);
  const after = allFlats(edited, flags());
  assert.deepEqual(after[0].targets.shadow, edit);
  assert.deepEqual(after[1], flats[1]);
  assert.equal(after[0].hex, flats[0].hex);
});

test('flags: flats out of the recipe are ignored, a star counts three times, the background flag routes to the Cast shadow', () => {
  const d = palette();
  const [a, b, c] = d.ramps.map((r) => r.id);
  const every = allFlats(d, flags({ layerStar: [a], layerBg: [c] }));
  assert.deepEqual(every.map((f) => [f.star, !!f.background]), [[true, false], [false, false], [false, true], [false, false]]);
  assert.equal(recipeFlats(every, flags()).length, 4);
  const inside = recipeFlats(every, flags({ layerOut: [b] }));
  assert.deepEqual(inside.map((f) => f.name), ['Skin', 'Shirt', 'Leaf']);
  const r = solveRecipe(inside);
  assert.ok(!(b in r.shadow.dist) && !(b in r.shaded), 'a flat out of the recipe is not in the solve');
  assert.ok(r.cast && Object.keys(r.cast.dist).join() === c, 'the background flat has the Cast shadow');
  assert.ok(!(c in r.shadow.dist));
  // the same flats, a different flag: no Cast shadow, and the flat is back in the Shadow
  const plain = solveRecipe(recipeFlats(allFlats(d, flags({ layerOut: [b] })), flags({ layerOut: [b] })));
  assert.equal(plain.cast, null);
  assert.ok(c in plain.shadow.dist);
  // a flat that is out and then back in changes nothing else
  assert.deepEqual(recipeFlats(every, flags({ layerOut: [] })), every);
});

test('the layer rows read top first, with the Rim and Mood from the palette’s light, and words for the fit', () => {
  const d = palette();
  const flats = allFlats(d, flags({ layerBg: [d.ramps[3].id] }));
  const r = solveRecipe(flats);
  const { pair } = sceneLight(d);
  const view = { layerRim: 35, layerRimOn: true, layerMood: 15, layerMoodOn: false };
  const rows = rowsOf(r, flats, pair, view, ALL_ON);
  assert.deepEqual(rows.map((x) => x.key), ['rim', 'mood', 'light', ...(r.shadow2 ? ['shadow2'] : []), 'shadow', 'cast']);
  assert.deepEqual(rows.slice(0, 2).map((x) => [x.mode, x.pct, x.on]), [['add', 35, true], ['overlay', 15, false]]);
  assert.ok(rows.every((x) => /^#[0-9A-F]{6}$/.test(x.hex) && Number.isInteger(x.pct) && x.fit));
  assert.equal(rows.find((x) => x.key === 'shadow')!.note, 'clipped to the character');
  assert.equal(rows.find((x) => x.key === 'cast')!.note, 'on the background');
  if (r.shadow2) assert.match(rows.find((x) => x.key === 'shadow2')!.note, /^clipped to: /);
  // the eyes follow into the rows
  const off = rowsOf(r, flats, pair, view, { ...ALL_ON, shadow: false });
  assert.equal(off.find((x) => x.key === 'shadow')!.on, false);
  assert.ok(allTogether(r, flats).every((t) => t.label && t.fit));
  assert.ok(hintOf(r, flats).length > 20);
  // no background flag, no Cast shadow row
  const none = allFlats(d, flags());
  assert.ok(!rowsOf(solveRecipe(none), none, pair, view, ALL_ON).some((x) => x.key === 'cast'));
});

test('proposals are named like “Shadow · Multiply 80%”', () => {
  assert.equal(proposalName({ name: 'Shadow', mode: 'multiply', pct: 80 }), 'Shadow · Multiply 80%');
  assert.equal(proposalName({ name: 'Light', mode: 'add', pct: 30 }), 'Light · Add 30%');
  assert.equal(proposalName({ name: 'Mood', mode: 'overlay', pct: 15 }), 'Mood · Overlay 15%');
});

// ── the picture, on a tiny bust made by hand ─────────────────────────────────────────────────

/** four pixels: skin, hair, top, background; the shadow covers the first and last, the light the second, the rim the third */
const tiny = (): Bust => ({
  size: 2,
  shadow: Float32Array.from([1, 0, 0, 0.5]),
  light: Float32Array.from([0, 1, 0, 0]),
  rim: Float32Array.from([0, 0, 1, 0]),
  part: Uint8Array.from([0, 1, 2, 4]),
  paint: () => {},
  coverage: () => new Float32Array(4),
  outline: () => {},
  face: () => {},
});

test('the recipe is laid over the flats through the masks, clipped, and matches shading each flat by hand', () => {
  const d = palette();
  const flats = allFlats(d, flags({ layerBg: [d.ramps[3].id] }));
  const r = solveRecipe(flats);
  const rows = rowsOf(r, flats, sceneLight(d).pair, { layerRim: 35, layerRimOn: true, layerMood: 15, layerMoodOn: false }, ALL_ON);
  const px = new Uint8ClampedArray(16);
  const colours = [flats[0].hex, flats[1].hex, flats[2].hex, flats[3].hex].map(hexRgb);
  colours.forEach((c, i) => px.set([...c, 255], i * 4));
  const all = Float32Array.from([1, 1, 1, 1]);
  const none = Float32Array.from([0, 0, 0, 0]);
  // the first three pixels are the character, the fourth the background
  paintRecipe(tiny(), px, rows, { character: Float32Array.from([1, 1, 1, 0]), background: Float32Array.from([0, 0, 0, 1]), second: r.shadow2 ? none : null }, 'srgb');
  void all;
  const shadow = rows.find((x) => x.key === 'shadow')!;
  const cast = rows.find((x) => x.key === 'cast')!;
  const rim = rows.find((x) => x.key === 'rim')!;
  const light = rows.find((x) => x.key === 'light')!;
  // pixel 0: the Shadow, whole; pixel 1: the Light; pixel 2: the Rim; pixel 3: the Cast shadow at half coverage
  assert.deepEqual([...px.slice(0, 3)], composite8(colours[0], hexRgb(shadow.hex), 'multiply', shadow.pct));
  assert.deepEqual([...px.slice(4, 7)], composite8(colours[1], hexRgb(light.hex), light.mode, light.pct));
  assert.deepEqual([...px.slice(8, 11)], composite8(colours[2], hexRgb(rim.hex), 'add', rim.pct));
  assert.deepEqual([...px.slice(12, 15)], composite8(colours[3], hexRgb(cast.hex), 'multiply', cast.pct, 'srgb', 0.5));
  // a layer whose eye is off paints nothing
  const px2 = new Uint8ClampedArray(16);
  colours.forEach((c, i) => px2.set([...c, 255], i * 4));
  paintRecipe(tiny(), px2, rows.map((x) => ({ ...x, on: false })), { character: all, background: none, second: null }, 'srgb');
  assert.deepEqual([...px2], colours.flatMap((c) => [...c, 255]));
});

test('the target view paints each flat’s own steps through the same masks', () => {
  const px = new Uint8ClampedArray(16).fill(100);
  const t = (n: number): [[number, number, number], [number, number, number], [number, number, number]] => [[n, n, n], [n + 1, n + 1, n + 1], [n + 2, n + 2, n + 2]];
  paintTargets(tiny(), px, { skin: t(10), hair: t(20), top: t(30), under: null, bg: t(40) });
  assert.deepEqual([...px.slice(0, 3)], [10, 10, 10]); // skin in shadow: its shadow step
  assert.deepEqual([...px.slice(4, 7)], [21, 21, 21]); // hair in the light: its light step
  assert.deepEqual([...px.slice(8, 11)], [32, 32, 32]); // top on the rim: its lightest
  assert.deepEqual([...px.slice(12, 15)], [70, 70, 70]); // background at half shadow: half way to its shadow step (100 to 40)
  // a part with no ramp is left as it is
  const px2 = new Uint8ClampedArray(16).fill(100);
  paintTargets(tiny(), px2, { skin: null, hair: null, top: null, under: null, bg: null });
  assert.ok(px2.every((x) => x === 100));
});
