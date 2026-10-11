import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Oklch } from '../src/shared/color/index.ts';
import { ALL_ON, composite8, fitWord, hexRgb, solveRecipe, type Recipe } from '../src/shared/palette/recipe.ts';
import type { MaterialId } from '../src/shared/types.ts';
import { addRamp, emptyDoc, recolour, stepsOf, type IllustrationDoc } from '../src/renderer/tools/illustration/doc.ts';
import { allFlats, allTogether, cleanLayers, cleanPct, DEFAULT_LAYERS, defaultParts, GLOSS, hintOf, paintRecipe, paintTargets, partRamps, proposalName, recipeFlats, rowsOf } from '../src/renderer/tools/illustration/layers.ts';
import { sceneLight } from '../src/renderer/tools/illustration/scene.ts';
import type { StillLife } from '../src/renderer/tools/illustration/still-life.ts';
import { PART_IDS } from '../src/renderer/tools/illustration/still-life.ts';

const FIXTURE: [Oklch, string, MaterialId][] = [[[0.74, 0.075, 55], 'Skin', 'skin'], [[0.78, 0.09, 85], 'Hair', 'fur'], [[0.55, 0.09, 250], 'Shirt', 'cloth'], [[0.6, 0.12, 140], 'Leaf', 'foliage']];
const palette = (list = FIXTURE): IllustrationDoc => list.reduce((d, [b, n, m]) => addRamp(d, b, n, null, m).doc, emptyDoc());
const flags = (o: Partial<Record<'layerBg' | 'layerStar' | 'layerOut', string[]>> = {}) => ({ layerBg: [], layerStar: [], layerOut: [], ...o });

test('parts default: the table and wall to background-like materials, the objects to the rest in palette order', () => {
  const d = palette();
  const ids = d.ramps.map((r) => r.id);
  // no ramp is background-like: the parts take the palette in order, and the wall shares the first
  assert.deepEqual(defaultParts(d.ramps), { box: ids[0], ball: ids[1], can: ids[2], table: ids[3], wall: ids[0] });
  // a paper ramp is the wall's and the table's first choice, and the objects take the others
  const wall = palette([...FIXTURE.slice(0, 3), [[0.78, 0.08, 235], 'Wall', 'paper']]);
  const w = wall.ramps.map((r) => r.id);
  assert.deepEqual(defaultParts(wall.ramps), { box: w[0], ball: w[1], can: w[2], table: w[3], wall: w[3] });
  // wood for the table, then paper for the wall, ahead of an object that comes first in the palette
  const room = palette([FIXTURE[0], [[0.78, 0.08, 235], 'Wall', 'paper'], [[0.5, 0.08, 60], 'Oak', 'wood'], FIXTURE[2]]);
  const r = room.ramps.map((x) => x.id);
  assert.deepEqual(defaultParts(room.ramps), { box: r[0], ball: r[3], can: r[2], table: r[2], wall: r[1] });
  // one ramp: every part shows it; none: no part has one
  const one = palette([FIXTURE[0]]);
  assert.ok(PART_IDS.every((p) => defaultParts(one.ramps)[p] === one.ramps[0].id));
  assert.ok(PART_IDS.every((p) => defaultParts([])[p] === null));
});

test('a chosen ramp holds for its part while the palette has it, and is dropped when it is gone', () => {
  const d = palette();
  const [a, b] = d.ramps.map((r) => r.id);
  assert.equal(partRamps(d, { box: b }).box, b);
  assert.equal(partRamps(d, { box: 'gone' }).box, a);
  assert.equal(partRamps(d, {}).box, a);
});

test('the view’s Layers part is made sound: percents whole and in range, lists once, only real parts', () => {
  const out: Record<string, unknown> = {};
  cleanLayers({ layerRim: 140.4, layerMood: -3, layerOut: ['a', 'a', 4, 'b'], layerBg: 'x', layerStar: null, layerParts: { box: 'r1', ball: 4, nonsense: 'r2', wall: 'r3' } }, out);
  assert.deepEqual(out, { layerRim: 100, layerMood: 0, layerOut: ['a', 'b'], layerBg: [], layerStar: [], layerParts: { box: 'r1', wall: 'r3' } });
  cleanLayers({ layerRim: 'x', layerMood: NaN, layerParts: [1] }, out);
  assert.equal(out.layerRim, DEFAULT_LAYERS.layerRim);
  assert.equal(out.layerMood, DEFAULT_LAYERS.layerMood);
  assert.deepEqual(out.layerParts, {});
  // a view saved when the picture was a bust: its part keys are gone, not carried along
  cleanLayers({ layerParts: { skin: 'r1', hair: 'r2', top: 'r3', 'under-top': 'r4', under: 'r5', background: 'r6', bg: 'r7', can: 'r8' } }, out);
  assert.deepEqual(out.layerParts, { can: 'r8' });
  assert.equal(cleanPct(33.6, 1), 34);
  // what is saved comes back: a round trip through JSON
  const saved = { layerRim: 20, layerMood: 80, layerOut: ['a'], layerBg: ['b'], layerStar: ['c'], layerParts: { can: 'r9' } };
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

// ── the picture, on a tiny picture made by hand ─────────────────────────────────────────────────

/** four pixels: box, ball, can, wall; the shadow covers the first and last, the light the second, the rim the third */
const tiny = (): StillLife => ({
  width: 2,
  height: 2,
  shadow: Float32Array.from([1, 0, 0, 0.5]),
  light: Float32Array.from([0, 1, 0, 0]),
  rim: Float32Array.from([0, 0, 1, 0]),
  part: Uint8Array.from([0, 1, 2, 4]),
  paint: () => {},
  coverage: () => new Float32Array(4),
  outline: () => {},
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
  paintTargets(tiny(), px, { box: t(10), ball: t(20), can: t(30), table: null, wall: t(40) });
  assert.deepEqual([...px.slice(0, 3)], [10, 10, 10]); // box in shadow: its shadow step
  assert.deepEqual([...px.slice(4, 7)], [21, 21, 21]); // ball in the light: its light step
  assert.deepEqual([...px.slice(8, 11)], [32, 32, 32]); // can on the rim: its lightest
  assert.deepEqual([...px.slice(12, 15)], [70, 70, 70]); // wall at half shadow: half way to its shadow step (100 to 40)
  // a part with no ramp is left as it is
  const px2 = new Uint8ClampedArray(16).fill(100);
  paintTargets(tiny(), px2, { box: null, ball: null, can: null, table: null, wall: null });
  assert.ok(px2.every((x) => x === 100));
});

test('the sentence under the stack is made from the same distance as the Shadow row, so the two never disagree', () => {
  const flats = allFlats(palette(), flags());
  const alone = (dist: number) => ({ shadow2: null, shadow: { worst: { id: flats[0].id, dist } }, shadowAll: { id: flats[0].id, dist }, cast: null, lightAll: { id: flats[0].id, dist: 0 }, lightMode: 'add' }) as unknown as Recipe;
  const name = flats[0].name;
  for (const dist of [0.01, 0.04, 0.09]) {
    const hint = hintOf(alone(dist), flats);
    const word = fitWord(dist, name);
    if (word === 'close') assert.match(hint, /^One Multiply fits every character flat, so there is no second shadow layer\./);
    else if (word.startsWith('near')) assert.match(hint, new RegExp(`a little off on ${name}`));
    else assert.match(hint, new RegExp(`One Multiply is off on ${name}`));
    assert.equal(/fits every character flat, so/.test(hint), word === 'close', `${word}: ${hint}`);
  }
  // and on real recipes: a Shadow row that says it is off never sits beside "fits every flat"
  for (const list of [FIXTURE, FIXTURE.slice(0, 2), [FIXTURE[0], [[0.62, 0.02, 260], 'Plate', 'metal'] as [Oklch, string, MaterialId]]]) {
    const d = palette(list);
    const fl = allFlats(d, flags());
    const r = solveRecipe(fl);
    const row = rowsOf(r, fl, sceneLight(d).pair, { layerRim: 35, layerRimOn: true, layerMood: 15, layerMoodOn: true }, ALL_ON).find((x) => x.key === 'shadow')!;
    if (!r.shadow2 && /^off on/.test(row.fit)) assert.doesNotMatch(hintOf(r, fl), /fits every character flat, so/);
  }
});

test('the layers a name alone would not explain have a one-line gloss, and the clipped ones name the clipping mask in the three apps', () => {
  for (const k of ['rim', 'mood', 'cast', 'shadow', 'shadow2'] as const) assert.ok(GLOSS[k] && GLOSS[k]!.length < 220, k);
  for (const k of ['shadow', 'shadow2'] as const) assert.match(GLOSS[k]!, /Krita.*Clip Studio.*Procreate/);
});
