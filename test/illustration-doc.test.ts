import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeJson } from '../src/shared/palette/writers.ts';
import type { Swatch } from '../src/shared/types.ts';
import {
  addRamp,
  baseOf,
  brokenSteps,
  duplicateRamp,
  emptyDoc,
  fromPayload,
  lightForAll,
  looseOf,
  makeRamps,
  moveRamp,
  named,
  rampName,
  recolour,
  regen,
  removeLoose,
  removeRamp,
  revertStep,
  setSpec,
  stepsOf,
  stepWord,
  toPayload,
  type IllustrationDoc,
} from '../src/renderer/tools/illustration/doc.ts';
import { named as namedAnywhere } from '../src/renderer/tools/common/names.ts';

const withRamps = (...bases: [number, number, number][]): IllustrationDoc => bases.reduce((d, b, i) => addRamp(d, b, `R${i}`).doc, emptyDoc());
const flat = (id: string, oklch: [number, number, number]): Swatch => ({ id, name: id, role: null, oklch, type: 'process' });

test('a new ramp: five steps around its base, lightest first, value falling', () => {
  const d = withRamps([0.6, 0.12, 30]);
  const r = d.ramps[0];
  const steps = stepsOf(d, r.id);
  assert.deepEqual(steps.map((w) => w.step), [-2, -1, 0, 1, 2]);
  assert.deepEqual(baseOf(d, r.id)?.oklch, [0.6, 0.12, 30]);
  assert.deepEqual(brokenSteps(steps), []);
  assert.deepEqual(d.swatches.map((w) => w.id), steps.map((w) => w.id), 'the file holds the ramp in row order');
});

test('an edited step stays put when the Light settings change; the rest follow', () => {
  let d = withRamps([0.6, 0.12, 30]);
  const id = d.ramps[0].id;
  const shadow = stepsOf(d, id)[3];
  d = recolour(d, shadow.id, [0.4, 0.2, 10]);
  assert.equal(d.swatches.find((w) => w.id === shadow.id)?.edited, true);
  const before = stepsOf(d, id);
  d = setSpec(d, id, { material: 'metal', intensity: 'extreme' });
  const after = stepsOf(d, id);
  assert.deepEqual(after[3].oklch, [0.4, 0.2, 10], 'the hand edit survives');
  assert.equal(after[3].id, shadow.id);
  assert.notDeepEqual(after[0].oklch, before[0].oklch, 'the highlight regenerated');
  d = revertStep(d, shadow.id);
  assert.equal(stepsOf(d, id)[3].edited, undefined);
  assert.notDeepEqual(stepsOf(d, id)[3].oklch, [0.4, 0.2, 10]);
});

test('recolouring the base moves the ramp and its spec, and marks nothing edited', () => {
  let d = withRamps([0.6, 0.12, 30]);
  const id = d.ramps[0].id;
  const base = baseOf(d, id)!;
  const hi = stepsOf(d, id)[0].oklch;
  d = recolour(d, base.id, [0.5, 0.1, 250]);
  assert.deepEqual(d.ramps[0].base, [0.5, 0.1, 250]);
  assert.deepEqual(baseOf(d, id)?.oklch, [0.5, 0.1, 250]);
  assert.ok(stepsOf(d, id).every((w) => !w.edited));
  assert.notDeepEqual(stepsOf(d, id)[0].oklch, hi);
});

test('more steps add swatches, fewer drop them, and ids of the steps kept stay', () => {
  let d = withRamps([0.55, 0.1, 140]);
  const id = d.ramps[0].id;
  const ids = stepsOf(d, id).map((w) => w.id);
  d = setSpec(d, id, { steps: 9 });
  assert.equal(stepsOf(d, id).length, 9);
  assert.ok(ids.every((x) => d.swatches.some((w) => w.id === x)));
  d = setSpec(d, id, { steps: 3 });
  assert.deepEqual(stepsOf(d, id).map((w) => w.step), [-1, 0, 1]);
});

test('one hero at most; the other ramps go quieter', () => {
  let d = withRamps([0.6, 0.15, 30], [0.6, 0.15, 200]);
  const [a, b] = d.ramps.map((r) => r.id);
  const chromaB = stepsOf(d, b)[0].oklch[1];
  d = setSpec(d, a, { hero: true });
  assert.ok(stepsOf(d, b)[0].oklch[1] < chromaB, 'B quietens');
  d = setSpec(d, b, { hero: true });
  assert.deepEqual(d.ramps.map((r) => r.hero), [false, true]);
});

test('a flat palette opens as loose colours; each can become a ramp base', () => {
  let d = fromPayload({ swatches: [flat('a', [0.5, 0.1, 30]), flat('b', [0.7, 0.1, 120])], notes: '' });
  assert.equal(d.ramps.length, 0);
  assert.equal(looseOf(d).length, 2);
  d = makeRamps(d, ['a', 'b']);
  assert.equal(d.ramps.length, 2);
  assert.equal(looseOf(d).length, 0);
  assert.equal(baseOf(d, d.ramps[0].id)?.id, 'a', 'the swatch is the base, id and name kept');
  assert.equal(baseOf(d, d.ramps[0].id)?.name, 'a');
});

test('a file another tool changed: strays go loose, empty ramps go, a recoloured base leads', () => {
  const d = withRamps([0.6, 0.12, 30], [0.5, 0.1, 250]);
  const [a, b] = d.ramps;
  const baseA = baseOf(d, a.id)!;
  const swatches = [
    ...d.swatches.filter((w) => w.group === a.id).map((w) => (w.id === baseA.id ? { ...w, oklch: [0.3, 0.05, 90] as [number, number, number], edited: true } : w)),
    { ...stepsOf(d, a.id)[1], id: 'dup' }, // Design's Duplicate: a second swatch at the same step
    { ...flat('stray', [0.4, 0.1, 10]), group: 'gone', step: 1 },
  ];
  const back = fromPayload({ swatches, notes: 'n', ramps: [a, b] });
  assert.deepEqual(back.ramps.map((r) => r.id), [a.id], 'B has no swatches left');
  assert.deepEqual(back.ramps[0].base, [0.3, 0.05, 90]);
  assert.equal(baseOf(back, a.id)?.edited, undefined);
  assert.deepEqual(looseOf(back).map((w) => w.id).sort(), ['dup', 'stray']);
  assert.equal(back.notes, 'n');
});

test('a round trip through the file changes nothing', () => {
  let d = withRamps([0.6, 0.12, 30], [0.5, 0.1, 250]);
  d = recolour(d, stepsOf(d, d.ramps[1].id)[1].id, [0.62, 0.09, 240]);
  d = setSpec(d, d.ramps[0].id, { hero: true, hueShift: 0.4 });
  const back = fromPayload(JSON.parse(JSON.stringify({ swatches: d.swatches, notes: d.notes, ramps: d.ramps })));
  assert.deepEqual(back, d);
});

test('rows move, duplicate and delete with their swatches', () => {
  let d = withRamps([0.6, 0.12, 30], [0.5, 0.1, 250], [0.7, 0.1, 120]);
  const [a, b, c] = d.ramps.map((r) => r.id);
  d = moveRamp(d, c, 0);
  assert.deepEqual(d.ramps.map((r) => r.id), [c, a, b]);
  assert.deepEqual([...new Set(d.swatches.map((w) => w.group))], [c, a, b]);
  const dup = duplicateRamp(d, a);
  assert.deepEqual(dup.doc.ramps.map((r) => r.id), [c, a, dup.id, b]);
  assert.equal(stepsOf(dup.doc, dup.id).length, 5);
  d = removeRamp(dup.doc, a);
  assert.ok(!d.swatches.some((w) => w.group === a));
});

test('the JSON export says which ramp each step is in and where', () => {
  const d = withRamps([0.6, 0.12, 30]);
  const out = JSON.parse(writeJson('P', named(d))).swatches;
  assert.deepEqual(out.map((w: { step: number }) => w.step), [-2, -1, 0, 1, 2]);
  assert.ok(out.every((w: { group: string }) => w.group === d.ramps[0].id));
  assert.equal(JSON.parse(writeJson('P', [flat('a', [0.5, 0.1, 30])])).swatches[0].group, undefined, 'a plain swatch stays as it was');
});

test('steps are named from where they sit', () => {
  const words = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => stepWord(lo + i, lo, hi));
  assert.deepEqual(words(-1, 1), ['light', 'base', 'shadow']);
  assert.deepEqual(words(-2, 2), ['highlight', 'light', 'base', 'shadow', 'deep shadow']);
  assert.deepEqual(words(-3, 3), ['highlight', 'light 2', 'light 1', 'base', 'shadow 1', 'shadow 2', 'deep shadow']);
  assert.deepEqual(words(-1, 2), ['light', 'base', 'shadow', 'deep shadow']);
  assert.deepEqual(named(withRamps([0.6, 0.12, 30])).map((w) => w.name), ['R0 highlight', 'R0 light', 'R0', 'R0 shadow', 'R0 deep shadow']);
});

test('one scene, one light: a new ramp takes the light of the ramp it follows, and one ramp can light them all', () => {
  let d = withRamps([0.6, 0.12, 30]);
  const first = d.ramps[0].id;
  d = setSpec(d, first, { light: [0.8, 0.1, 250], shadow: [0.3, 0.1, 30], intensity: 'extreme', material: 'metal' });
  d = addRamp(d, [0.5, 0.1, 140], 'Leaf', first).doc;
  const leaf = d.ramps[1];
  assert.deepEqual([leaf.light, leaf.shadow, leaf.intensity, leaf.material], [[0.8, 0.1, 250], [0.3, 0.1, 30], 'extreme', 'cloth']);
  d = makeRamps({ ...d, swatches: [...d.swatches, flat('x', [0.4, 0.1, 300])] }, ['x']);
  assert.deepEqual(d.ramps[2].light, [0.8, 0.1, 250]);
  d = setSpec(d, leaf.id, { light: [0.95, 0.05, 85] });
  const before = stepsOf(d, first).map((w) => w.oklch);
  d = lightForAll(d, leaf.id);
  assert.ok(d.ramps.every((r) => r.light.join() === '0.95,0.05,85' && r.shadow.join() === '0.3,0.1,30'));
  assert.notDeepEqual(stepsOf(d, first).map((w) => w.oklch), before, 'the others regenerate');
});

test('loose colours: make a ramp from just one, or delete one; ramps are left alone', () => {
  const d0 = withRamps([0.6, 0.12, 30]);
  const d = { ...d0, swatches: [...d0.swatches, flat('a', [0.5, 0.1, 100]), flat('b', [0.4, 0.1, 200]), flat('c', [0.3, 0.1, 300])] };
  const one = makeRamps(d, ['b']);
  assert.deepEqual(looseOf(one).map((w) => w.id), ['a', 'c']);
  assert.equal(one.ramps.length, 2);
  const gone = removeLoose(one, 'a');
  assert.deepEqual(looseOf(gone).map((w) => w.id), ['c']);
  assert.equal(removeLoose(one, baseOf(one, one.ramps[0].id)!.id).swatches.length, one.swatches.length, 'a ramp step is no loose colour');
});

test('a copy of the hero is no hero, and quietens like the others', () => {
  let d = withRamps([0.6, 0.12, 30], [0.5, 0.1, 250]);
  d = setSpec(d, d.ramps[0].id, { hero: true });
  const { doc, id } = duplicateRamp(d, d.ramps[0].id);
  const copy = stepsOf(doc, id);
  assert.equal(doc.ramps.find((r) => r.id === id)!.hero, false);
  assert.deepEqual(copy.map((w) => w.oklch), stepsOf(regen(doc, id), id).map((w) => w.oklch), 'already what a regenerate makes');
  const hero = stepsOf(doc, doc.ramps[0].id);
  assert.ok(copy[0].oklch[1] < hero[0].oklch[1]);
});

test('from a file: a ramp listed twice counts once; a base deleted elsewhere leaves its name', () => {
  const d = withRamps([0.6, 0.12, 30]);
  const r = d.ramps[0];
  const named2 = { ...d, swatches: d.swatches.map((w) => (w.step === 0 ? { ...w, name: 'Hair' } : w)) };
  const file = toPayload(named2);
  assert.equal(file.ramps![0].name, 'Hair');
  const twice = fromPayload({ ...file, ramps: [file.ramps![0], { ...file.ramps![0], material: 'metal' }] });
  assert.equal(twice.ramps.length, 1);
  assert.equal(twice.ramps[0].material, r.material);
  const noBase = fromPayload({ ...file, swatches: file.swatches.filter((w) => w.step !== 0) });
  assert.equal(rampName(noBase, noBase.ramps[0]), 'Hair');
  const rebuilt = regen(noBase, noBase.ramps[0].id);
  assert.equal(baseOf(rebuilt, r.id)?.name, 'Hair');
  // a base with no name of its own writes no name
  const blank = addRamp(emptyDoc(), [0.6, 0.12, 30]).doc;
  assert.equal(toPayload(blank).ramps![0].name, undefined);
});

test('other tools name a blank ramp step by its ramp, as Illustration does', () => {
  const d = withRamps([0.6, 0.12, 30]);
  const plain = { ...d, swatches: d.swatches.map((w) => ({ ...w, name: w.step === 0 ? 'Cloth' : '' })) };
  assert.deepEqual(namedAnywhere(plain.swatches, plain.ramps).map((w) => w.name), named(plain).map((w) => w.name));
  assert.deepEqual(namedAnywhere(plain.swatches).map((w) => w.name), ['Cloth highlight', 'Cloth light', 'Cloth', 'Cloth shadow', 'Cloth deep shadow']);
});
