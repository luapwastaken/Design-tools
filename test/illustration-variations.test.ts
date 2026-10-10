import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, type Oklch } from '../src/shared/color/index.ts';
import { valueOf } from '../src/shared/color/value.ts';
import { createDocController } from '../src/shared/doc.ts';
import { KINDS, subjectBases } from '../src/shared/palette/variations.ts';
import { addRamp, baseOf, emptyDoc, looseOf, recolour, stepsOf, type IllustrationDoc } from '../src/renderer/tools/illustration/doc.ts';
import { LIGHTS, sceneLight, SUBJECTS } from '../src/renderer/tools/illustration/scene.ts';
import {
  alternatives, applyCell, cellRamps, cellsOf, cleanCell, cleanLocks, cleanPath, cleanPicture, fitsPicture, inUse, lockedIn, makeRamps, pictureOf, toggled,
} from '../src/renderer/tools/illustration/variations.ts';
import type { IllustrationView } from '../src/renderer/tools/illustration/view-state.ts';

/** only the fields the grid reads; the rest of a view is nobody's business here */
const view = (o: Partial<IllustrationView> = {}): IllustrationView =>
  ({ varSeed: 4242, varMode: 'colours', varPath: [], varOpen: 0, swapRamp: '', lockedRamps: [], pictureOn: [], pictureTones: {}, ...o }) as IllustrationView;

const palette = (): IllustrationDoc =>
  [[0.74, 0.075, 55], [0.6, 0.12, 140], [0.7, 0.09, 240], [0.5, 0.1, 25]].reduce((d, b) => addRamp(d, b as Oklch, `Colour ${d.ramps.length + 1}`).doc, emptyDoc());
const baseHexes = (d: IllustrationDoc) => d.ramps.map((r) => toHex(baseOf(d, r.id)!.oklch));

test('colour cells: six, the same for the same palette and view, with every locked ramp in each', () => {
  const d = palette();
  const locked = [d.ramps[1].id];
  const cells = cellsOf(d, view({ lockedRamps: locked }));
  assert.equal(cells.length, 6);
  assert.deepEqual(cellsOf(d, view({ lockedRamps: locked })).map((c) => c.bases), cells.map((c) => c.bases));
  for (const c of cells) {
    assert.equal(c.bases.length, 4);
    assert.deepEqual(c.bases[1].base, baseOf(d, d.ramps[1].id)!.oklch);
    assert.ok(c.bases[1].locked);
  }
  assert.equal(new Set(cells.map((c) => JSON.stringify(c.bases))).size, 6);
  assert.notDeepEqual(cellsOf(d, view({ lockedRamps: locked, varSeed: 77 })).map((c) => c.bases), cells.map((c) => c.bases));
});

test('vary the light keeps the bases: five presets and one in-between light', () => {
  const d = palette();
  const cells = cellsOf(d, view({ varMode: 'light' }));
  assert.equal(cells.length, 6);
  for (const c of cells) assert.deepEqual(c.bases.map((b) => b.base), d.ramps.map((r) => baseOf(d, r.id)!.oklch));
  assert.equal(new Set(cells.map((c) => JSON.stringify(c.light))).size, 6);
  assert.equal(cells.filter((c) => LIGHTS.some((l) => JSON.stringify(l.light) === JSON.stringify(c.light.light))).length, 5);
});

test('while subjects are ticked, the cells keep one ramp per subject, each in its material, varied within it', () => {
  const d = palette();
  const v = view({ pictureOn: ['skin', 'foliage', 'sky', 'wood'], pictureTones: { skin: 'skin-deep' } });
  const want = pictureOf(v);
  assert.deepEqual(want, ['skin-deep', 'foliage', 'sky', 'wood']);
  const cells = cellsOf(d, v);
  assert.equal(cells.length, 6);
  for (const c of cells) {
    assert.deepEqual(c.bases.map((b) => b.material), want.map((id) => SUBJECTS.find((s) => s.id === id)!.material));
    assert.equal(c.label, 'This picture');
  }
  assert.equal(new Set(cells.map((c) => JSON.stringify(c.bases))).size, 6);
  // nothing ticked: the usual grid
  assert.notEqual(cellsOf(d, view())[0].label, 'This picture');
});

test('after More like this the parent is cell 1, and adopting cell 1 changes nothing', () => {
  for (const varMode of ['colours', 'light'] as const) {
    const d = palette();
    const wide = cellsOf(d, view({ varMode }));
    const narrowed = cellsOf(d, view({ varMode, varPath: [3] }));
    assert.equal(narrowed.length, 6);
    assert.deepEqual(narrowed[0].bases, wide[2].bases);
    assert.deepEqual(narrowed[0].light, wide[2].light);
    const again = cellsOf(d, view({ varMode, varPath: [3, 4] }));
    assert.deepEqual(again[0].light, narrowed[3].light);
    assert.deepEqual(again[0].bases, narrowed[3].bases);
    const using = applyCell(d, view({ varMode, varPath: [3] }), narrowed[0]);
    assert.equal(applyCell(using, view({ varMode, varPath: [3] }), narrowed[0]), using);
    assert.ok(inUse(using, view({ varMode, varPath: [3] }), narrowed[0]));
  }
});

test('using a colour cell writes the bases, one undo step, leaves locked ramps and hand-edited steps, and undo restores exactly', () => {
  const d0 = palette();
  // a step edited by hand on the first ramp
  const edited = stepsOf(d0, d0.ramps[0].id).find((w) => w.step === 1)!;
  const d = recolour(d0, edited.id, [0.4, 0.05, 90]);
  const locked = [d.ramps[2].id];
  const v = view({ lockedRamps: locked });
  const doc = createDocController<IllustrationDoc>('illustration', d, { strict: true });
  const before = doc.get();
  const cell = cellsOf(before, v)[4];
  doc.transact('Use variation 5', (x) => applyCell(x, v, cell));
  assert.equal(doc.depth(), 1);
  const after = doc.get();
  after.ramps.forEach((r, i) => {
    const base = baseOf(after, r.id)!;
    assert.deepEqual(base.oklch, i === 2 ? baseOf(before, r.id)!.oklch : cell.bases[i].base);
    assert.deepEqual(r.base, base.oklch);
  });
  const kept = stepsOf(after, d.ramps[0].id).find((w) => w.id === edited.id)!;
  assert.deepEqual(kept.oklch, [0.4, 0.05, 90]);
  assert.ok(kept.edited);
  // the ramps follow their new bases
  assert.notDeepEqual(stepsOf(after, d.ramps[0].id).map((w) => w.oklch), stepsOf(before, d.ramps[0].id).map((w) => w.oklch));
  assert.ok(inUse(after, v, cell));
  doc.undo();
  assert.equal(doc.get(), before);
  assert.equal(doc.depth(), 0);
});

test('using a light cell gives the light pair to every ramp and leaves the bases', () => {
  const d = palette();
  const v = view({ varMode: 'light' });
  const cell = cellsOf(d, v)[2];
  const next = applyCell(d, v, cell);
  assert.deepEqual(baseHexes(next), baseHexes(d));
  for (const r of next.ramps) assert.deepEqual([r.light, r.shadow], [cell.light.light, cell.light.shadow]);
  assert.equal(sceneLight(next).mixed, false);
  assert.ok(inUse(next, v, cell));
});

test('the cells show the ramps the scene would make: its steps count and each base in its material', () => {
  const d = palette();
  const cell = cellsOf(d, view())[0];
  const ramps = cellRamps(d, cell);
  assert.equal(ramps.length, 4);
  for (const r of ramps) assert.equal(r.steps.length, d.ramps[0].steps);
  assert.equal(cellRamps(d, cell), ramps);
});

test('Make ramps: the ticked subjects in order with their materials, colours in no ramp stay, the light is the scene\'s', () => {
  const lit = LIGHTS.find((l) => l.id === 'golden')!;
  const base = palette();
  const loose = { id: 'loose-1', name: 'Loose', role: null, oklch: [0.5, 0.05, 100] as Oklch, type: 'process' as const };
  const d = { ...base, swatches: [...base.swatches, loose], ramps: base.ramps.map((r) => ({ ...r, light: lit.light, shadow: lit.shadow })) };
  const v = view({ pictureOn: ['foliage', 'skin', 'cloth', 'metal'], pictureTones: { skin: 'skin-light' } });
  const next = makeRamps(d, v);
  // KINDS order, not tick order: Skin, Cloth, Foliage, Metal
  const order = KINDS.map((k) => k.kind).filter((k) => v.pictureOn.includes(k));
  assert.deepEqual(order, ['skin', 'cloth', 'foliage', 'metal']);
  const subjects = subjectBases(pictureOf(v));
  assert.equal(next.ramps.length, 4);
  assert.deepEqual(next.ramps.map((r) => r.material), subjects.map((s) => s.material));
  next.ramps.forEach((r, i) => {
    assert.deepEqual(baseOf(next, r.id)!.oklch, subjects[i].base);
    assert.equal(baseOf(next, r.id)!.name, subjects[i].name);
    assert.deepEqual([r.light, r.shadow], [lit.light, lit.shadow]);
  });
  assert.deepEqual(looseOf(next), [loose]);
  assert.ok(next.ramps.every((r) => !d.ramps.some((o) => o.id === r.id)));
});

test('Make ramps clears the ramp locks, and one undo brings the ramps and their locks back together', () => {
  const d = palette();
  const v = view({ lockedRamps: [d.ramps[0].id, d.ramps[2].id], pictureOn: ['skin', 'sky'] });
  assert.equal(lockedIn(d, v).length, 2);
  const doc = createDocController<IllustrationDoc>('illustration', d, { strict: true });
  doc.transact('Make 2 ramps', (x) => makeRamps(x, v));
  assert.equal(doc.depth(), 1);
  // the saved ids name ramps that are gone: no ramp is locked, and the cells show none locked
  assert.deepEqual(lockedIn(doc.get(), v), []);
  assert.ok(cellsOf(doc.get(), v).every((c) => c.bases.every((b) => !b.locked)));
  doc.undo();
  assert.equal(doc.get(), d);
  assert.deepEqual(lockedIn(doc.get(), v), [d.ramps[0].id, d.ramps[2].id]);
  assert.ok(cellsOf(doc.get(), view({ lockedRamps: v.lockedRamps })).every((c) => c.bases[0].locked && c.bases[2].locked && !c.bases[1].locked));
});

test('ramp locks round-trip through the saved view, and a stray entry is dropped', () => {
  const ids = ['a1', 'b2', 'c3'];
  const saved = JSON.parse(JSON.stringify({ lockedRamps: ids, varPath: [3, 2], varOpen: 5, ...{ pictureOn: ['skin', 'sky'], pictureTones: { skin: 'skin-deep' } } }));
  assert.deepEqual(cleanLocks(saved.lockedRamps), ids);
  assert.deepEqual(cleanPath(saved.varPath), [3, 2]);
  assert.equal(cleanCell(saved.varOpen), 5);
  assert.deepEqual(cleanPicture(saved.pictureOn, saved.pictureTones), { pictureOn: ['skin', 'sky'], pictureTones: { skin: 'skin-deep' } });
  assert.deepEqual(cleanLocks(['a', 'a', 4, '', null, 'b']), ['a', 'b']);
  assert.deepEqual(cleanLocks('nonsense'), []);
  assert.equal(cleanLocks(Array.from({ length: 100 }, (_, i) => `r${i}`)).length, 64);
  assert.equal(cleanLocks(Array.from({ length: 100 }, (_, i) => `r${i}`)).at(-1), 'r99');
  assert.deepEqual(cleanPath([9, 2, 'x', 0, 3.5, 1]), [2, 1]);
  assert.equal(cleanCell(99), 0);
  assert.deepEqual(cleanPicture(['sky', 'unicorn', 'skin'], { skin: 'hair', sky: 'sky', hair: 'hair-red', nope: 1 }), { pictureOn: ['skin', 'sky'], pictureTones: { hair: 'hair-red' } });
  assert.deepEqual(toggled(ids, 'b2'), ['a1', 'c3']);
  assert.deepEqual(toggled(ids, 'z9'), [...ids, 'z9']);
});

test('a ramp\'s alternatives sit at its grey value, and each comes with its own ramp', () => {
  const d = palette();
  for (const r of d.ramps) {
    const list = alternatives(d, r.id);
    assert.ok(list.length >= 1 && list.length <= 8, `${list.length}`);
    const v = valueOf(baseOf(d, r.id)!.oklch);
    for (const a of list) {
      assert.ok(Math.abs(valueOf(a.base) - v) <= 0.01, `${a.hex}`);
      assert.equal(a.steps.length, r.steps);
    }
  }
  assert.equal(alternatives(d, d.ramps[0].id), alternatives(d, d.ramps[0].id));
  assert.deepEqual(alternatives(d, 'no-such-ramp'), []);
});

test('swapping a ramp\'s colour is one undo step and the ramp follows', () => {
  const d = palette();
  const doc = createDocController<IllustrationDoc>('illustration', d, { strict: true });
  const id = d.ramps[1].id;
  const alt = alternatives(d, id)[0];
  doc.transact('Swap', (x) => recolour(x, baseOf(x, id)!.id, alt.base));
  assert.equal(doc.depth(), 1);
  assert.deepEqual(stepsOf(doc.get(), id).find((w) => w.step === 0)!.oklch, alt.base);
  doc.undo();
  assert.equal(doc.get(), d);
});

test('a picture cell fits only ramps that are the ticked subjects', () => {
  const d = palette();
  const v = view({ pictureOn: ['foliage', 'skin', 'cloth', 'metal'] });
  assert.ok(fitsPicture(d, view()), 'nothing ticked: the cells are the ramps themselves');
  assert.ok(!fitsPicture(d, v), 'four loose-material ramps are not the four subjects');
  assert.ok(!fitsPicture(d, view({ pictureOn: ['skin'] })), 'a different count never fits');
  assert.ok(fitsPicture(makeRamps(d, v), v), 'Make ramps makes ramps that fit');
  assert.ok(fitsPicture(d, view({ ...v, varMode: 'light' })), 'the light grid never reads the ticks');
});
