import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, inSrgb, type Oklch } from '../src/shared/color/index.ts';
import { valueOf } from '../src/shared/color/value.ts';
import { createDocController } from '../src/shared/doc.ts';
import { generateRamp, MATERIALS, newRamp } from '../src/shared/palette/ramp.ts';
import {
  addRamp,
  baseOf,
  carryLight,
  duplicateRamp,
  emptyDoc,
  fromPayload,
  looseOf,
  makeRamps,
  rampName,
  recolour,
  removeRamp,
  setScene,
  stepsOf,
  toPayload,
  type IllustrationDoc,
} from '../src/renderer/tools/illustration/doc.ts';
import { LIGHTS, MAX_RAMPS, paletteBases, presetOf, SETS, sceneLight, SUBJECTS } from '../src/renderer/tools/illustration/scene.ts';

const light = (id: string) => LIGHTS.find((l) => l.id === id)!;
const withRamps = (...bases: Oklch[]): IllustrationDoc => bases.reduce((d, b) => addRamp(d, b).doc, emptyDoc());
const allLit = (d: IllustrationDoc, id: string) => d.ramps.every((r) => JSON.stringify([r.light, r.shadow]) === JSON.stringify([light(id).light, light(id).shadow]));

test('Daylight is the pair a ramp is born with today, so an old file reads as Daylight', () => {
  const r = newRamp([0.6, 0.1, 30]);
  assert.deepEqual([r.light, r.shadow], [light('daylight').light, light('daylight').shadow]);
  assert.equal(sceneLight(withRamps([0.6, 0.1, 30], [0.5, 0.1, 200])).preset?.id, 'daylight');
});

test('the presets are eight, told apart, and warm light goes with cool shadow where the sun is out', () => {
  assert.deepEqual(LIGHTS.map((l) => l.label), ['Daylight', 'Golden hour', 'Dusk', 'Twilight', 'Moonlight', 'Overcast', 'Warm interior', 'Studio neutral']);
  assert.equal(new Set(LIGHTS.map((l) => JSON.stringify([l.light, l.shadow]))).size, LIGHTS.length);
  const hueGap = (a: Oklch, b: Oklch) => Math.abs(((a[2] - b[2] + 540) % 360) - 180);
  for (const id of ['daylight', 'golden']) {
    const l = light(id);
    assert.ok(l.light[2] < 110 && hueGap(l.light, l.shadow) > 80, `${id}: warm light, cool shadow`);
    assert.ok(l.light[0] > l.shadow[0] + 0.4, `${id}: the light is much lighter than the shadow`);
  }
  assert.ok(light('moon').light[2] > 200 && light('moon').shadow[0] < 0.3, 'moonlight is blue and dark');
  assert.ok(light('dusk').light[0] < light('golden').light[0] && light('twilight').shadow[0] < light('dusk').shadow[0], 'the sun goes down: dusk is dimmer than golden hour, twilight darker than dusk');
  assert.ok(LIGHTS.every((l) => inSrgb(l.light) && l.light[0] > l.shadow[0] + 0.25), 'every light sits in sRGB and well above its shadow');
});

test('choosing another preset visibly changes the ramps: every two differ at both ends of a mid base', () => {
  // the lightest step's value is the ramp's own, so a preset moves it by hue and chroma only: the two ends
  // together carry the difference (8 or more between them), each end clear of zero
  const ends = LIGHTS.map((l) => {
    const steps = generateRamp({ ...newRamp([0.62, 0.16, 30]), light: l.light, shadow: l.shadow });
    return { id: l.id, high: steps[0].oklch, deep: steps.at(-1)!.oklch };
  });
  for (const [i, a] of ends.entries()) {
    for (const b of ends.slice(i + 1)) {
      const high = deltaE(a.high, b.high);
      const deep = deltaE(a.deep, b.deep);
      assert.ok(high >= 2 && deep >= 2 && high + deep >= 8, `${a.id} and ${b.id}: highlight ${high.toFixed(1)}, deep shadow ${deep.toFixed(1)}`);
    }
  }
});

test('a preset goes to every ramp as one undo step, hand-edited steps staying', () => {
  let d = withRamps([0.6, 0.12, 30], [0.5, 0.1, 250], [0.7, 0.1, 120]);
  const edited = stepsOf(d, d.ramps[1].id)[3];
  d = recolour(d, edited.id, [0.4, 0.2, 10]);
  const doc = createDocController<IllustrationDoc>('illustration', d, { strict: true });
  const g = light('golden');
  doc.transact('Light the scene: Golden hour', (x) => setScene(x, g.light, g.shadow));
  assert.ok(allLit(doc.get(), 'golden'));
  assert.equal(doc.depth(), 1);
  assert.notDeepEqual(stepsOf(doc.get(), doc.get().ramps[0].id)[0].oklch, stepsOf(d, d.ramps[0].id)[0].oklch, 'the steps follow the new light');
  assert.deepEqual(stepsOf(doc.get(), doc.get().ramps[1].id)[3].oklch, [0.4, 0.2, 10], 'the hand edit stays');
  doc.undo();
  assert.deepEqual(doc.get(), d, 'one undo gives the old light back to every ramp');
});

test('with no ramp, a preset is what the next ramp is born with, and the file keeps it', () => {
  const g = light('moon');
  let d = setScene(emptyDoc(), g.light, g.shadow);
  assert.equal(sceneLight(d).preset?.id, 'moon');
  d = fromPayload(JSON.parse(JSON.stringify(toPayload(d))));
  assert.equal(sceneLight(d).preset?.id, 'moon', 'it survives a reload');
  d = addRamp(d, [0.5, 0.1, 250]).doc;
  assert.deepEqual([d.ramps[0].light, d.ramps[0].shadow], [g.light, g.shadow]);
  // the next ones copy the ramps, as they always did
  d = addRamp(d, [0.6, 0.1, 40]).doc;
  assert.ok(d.ramps.every((r) => JSON.stringify(r.light) === JSON.stringify(g.light)));
});

test('the last ramp deleted leaves its light for the next', () => {
  const g = light('interior');
  let d = setScene(withRamps([0.6, 0.12, 30]), g.light, g.shadow);
  d = removeRamp(d, d.ramps[0].id);
  assert.equal(sceneLight(d).preset?.id, 'interior');
  assert.deepEqual(addRamp(d, [0.5, 0.1, 100]).doc.ramps[0].light, g.light);
});

test('the row reads Mixed when the ramps disagree and Custom when the pair is no preset', () => {
  let d = withRamps([0.6, 0.12, 30], [0.5, 0.1, 250]);
  assert.deepEqual([sceneLight(d).mixed, sceneLight(d).preset?.id], [false, 'daylight']);
  const ramps = [d.ramps[0], { ...d.ramps[1], light: [0.9, 0.06, 150] as Oklch }];
  const mixed = { ...d, ramps };
  const m = sceneLight(mixed, ramps[1].id);
  assert.deepEqual([m.mixed, m.preset], [true, null]);
  assert.deepEqual(m.pair.light, [0.9, 0.06, 150], 'the swatches are the selected ramp’s');
  assert.deepEqual(sceneLight(mixed, 'nope').pair.light, ramps[1].light, 'no selection: the last ramp’s');
  // every ramp the same, but not a preset
  d = setScene(d, [0.9, 0.06, 150], [0.3, 0.05, 20]);
  const custom = sceneLight(d);
  assert.deepEqual([custom.mixed, custom.preset], [false, null]);
  assert.equal(presetOf({ light: [0.9, 0.06, 150], shadow: [0.3, 0.05, 20] }), null);
  // an empty palette that was never lit reads as Daylight
  assert.equal(sceneLight(emptyDoc()).preset?.id, 'daylight');
});

test('a scene in a file that is not a pair of colours is ignored', () => {
  const junk = fromPayload({ swatches: [], notes: '', scene: { light: [1, 2], shadow: 'x' } as never });
  assert.equal(junk.scene, undefined);
  assert.equal(fromPayload({ swatches: [], notes: '' }).scene, undefined);
});

test('a subject makes a named ramp of its material, from a base that sits in sRGB', () => {
  assert.deepEqual(SUBJECTS.map((s) => s.label), ['Skin', 'Hair', 'Foliage', 'Sky', 'Cloth', 'Metal', 'Stone', 'Wood', 'Water']);
  for (const s of SUBJECTS) {
    assert.ok(MATERIALS.some((m) => m.id === s.material), `${s.label}: a real material`);
    assert.ok(inSrgb(s.base), `${s.label}: inside sRGB`);
    const d = addRamp(withRamps([0.5, 0.1, 100]), s.base, s.label, null, s.material).doc;
    const r = d.ramps.at(-1)!;
    assert.equal(r.material, s.material);
    assert.equal(rampName(d, r), s.label);
    assert.deepEqual(baseOf(d, r.id)?.oklch, s.base);
    assert.deepEqual(r.light, d.ramps[0].light, 'lit as the scene is, not by a light of its own');
  }
});

test('a limited set is 3 to 5 bases spaced in value, lightest first, in sRGB', () => {
  assert.deepEqual(SETS.map((s) => s.label), ['Atmospheric triad', 'Complementary pair', 'Analogous', 'Earth four']);
  for (const set of SETS) {
    for (const hue of Array.from({ length: 72 }, (_, i) => i * 5)) {
      const cs = set.make(hue);
      const name = `${set.label} at ${hue}`;
      assert.ok(cs.length >= 2 && cs.length <= 5, `${name}: ${cs.length} bases`);
      assert.ok(cs.every((c) => inSrgb(c)), `${name}: in sRGB`);
      const v = cs.map((c) => valueOf(c));
      assert.deepEqual([...v].sort((a, b) => b - a), v, `${name}: lightest first`);
      v.slice(1).forEach((x, i) => assert.ok(v[i] - x >= 0.08, `${name}: ${i + 1} sits ${(v[i] - x).toFixed(3)} below the one before`));
    }
  }
  assert.deepEqual(SETS.find((s) => s.id === 'earth')!.make(10), SETS.find((s) => s.id === 'earth')!.make(200), 'a fixed set ignores the hue');
});

test('a Library palette adds into this one with new ids, every ramp keeping its material', () => {
  const lib = (() => {
    let d = emptyDoc();
    for (const [i, s] of SUBJECTS.slice(0, 3).entries()) d = addRamp(d, s.base, s.label, null, s.material).doc;
    // and a flat colour no ramp holds
    return { ...d, swatches: [...d.swatches, { id: 'flat', name: 'Flat', role: null, oklch: [0.5, 0.1, 10] as Oklch, type: 'process' as const }] };
  })();
  const { list, total } = paletteBases(lib, 10);
  assert.deepEqual([list.length, total], [4, 4]);
  assert.deepEqual(list.map((c) => c.name), ['Skin', 'Hair', 'Foliage', 'Flat']);
  assert.deepEqual(list.map((c) => c.material), ['skin', 'fur', 'foliage', undefined]);
  // the same palette twice: ramps and swatches are new each time, and nothing collides
  let d = withRamps([0.5, 0.1, 200]);
  for (let pass = 0; pass < 2; pass++) d = list.reduce((x, c) => addRamp(x, c.oklch, c.name ?? '', null, c.material).doc, d);
  assert.equal(d.ramps.length, 1 + 8);
  assert.equal(new Set(d.swatches.map((w) => w.id)).size, d.swatches.length, 'no id twice');
  assert.equal(new Set(d.ramps.map((r) => r.id)).size, d.ramps.length);
  assert.equal(looseOf(d).length, 0);
  assert.equal(lib.ramps.length, 3, 'the source is as it was');
});

test('a palette with too many colours is cut to the room there is, and says how many it had', () => {
  const ramps = withRamps(...Array.from({ length: 24 }, (_, i): Oklch => [0.4 + (i % 5) * 0.08, 0.1, i * 12]));
  // and six colours in no ramp
  const flats = Array.from({ length: 6 }, (_, i) => ({ id: `flat${i}`, name: '', role: null, oklch: [0.5, 0.1, i * 50] as Oklch, type: 'process' as const }));
  const big = { ...ramps, swatches: [...ramps.swatches, ...flats] };
  const { list, total } = paletteBases(big, MAX_RAMPS - 20);
  assert.deepEqual([list.length, total], [4, 30]);
  assert.deepEqual(paletteBases(big, 0).list, []);
  assert.deepEqual(paletteBases(big, -3).list, []);
});

test('a palette holds 24 ramps on every way of adding one', () => {
  const full = Array.from({ length: MAX_RAMPS }).reduce<IllustrationDoc>((d, _, i) => addRamp(d, [0.5, 0.05, i * 15]).doc, emptyDoc());
  assert.equal(full.ramps.length, MAX_RAMPS);
  const more = addRamp(full, [0.6, 0.1, 10]);
  assert.equal(more.doc, full, 'a ramp past the cap changes nothing');
  assert.equal(more.base, '');
  assert.deepEqual(duplicateRamp(full, full.ramps[0].id), { doc: full, id: '' });
  const loose = { id: 'x', name: '', role: null, oklch: [0.5, 0.1, 10] as Oklch, type: 'process' as const };
  assert.equal(makeRamps({ ...full, swatches: [...full.swatches, loose] }, ['x']).ramps.length, MAX_RAMPS);
  // one short of the cap takes one of two
  const near = removeRamp(full, full.ramps[0].id);
  const two = [loose, { ...loose, id: 'y' }];
  const made = makeRamps({ ...near, swatches: [...near.swatches, ...two] }, ['x', 'y']);
  assert.equal(made.ramps.length, MAX_RAMPS);
  assert.equal(looseOf(made).length, 1, 'the one left over stays a loose colour');
});

test('a new palette starts in the light the last one was left in', () => {
  const g = light('golden');
  carryLight({ light: g.light, shadow: g.shadow });
  try {
    const d = emptyDoc();
    assert.equal(sceneLight(d).preset?.id, 'golden');
    assert.deepEqual(addRamp(d, [0.5, 0.1, 40]).doc.ramps[0].light, g.light);
    assert.notEqual(d.scene?.light, g.light, 'a copy, not the preset itself');
  } finally {
    carryLight(null);
  }
  assert.equal(emptyDoc().scene, undefined, 'nothing carried: Daylight');
});
