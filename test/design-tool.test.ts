import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, hexToOklch, simulateCvd, type Oklch } from '../src/shared/color/index.ts';
import { greyOf, holdValue, valueOf } from '../src/shared/color/value.ts';
import type { RampSpec, Swatch } from '../src/shared/types.ts';
import { cvdFix, partPair, spreadCluster, spreadV, spreadVs, valueFix } from '../src/renderer/tools/common/adjust.ts';
import { nextV } from '../src/renderer/tools/design/adjust.ts';
import { fromPayload, moveIds, recolour, toPayload, type DesignDoc } from '../src/renderer/tools/design/doc.ts';

const sw = (id: string, oklch: Oklch): Swatch => ({ id, name: id, role: null, oklch, type: 'process' });
const doc = (...ids: string[]): DesignDoc => ({ notes: '', swatches: ids.map((id, i) => sw(id, [i / 10, 0, 0])) });
const order = (d: DesignDoc) => d.swatches.map((w) => w.id).join('');

test('moveIds: the moved run keeps its order and lands before the index', () => {
  assert.equal(order(moveIds(doc('a', 'b', 'c', 'd'), ['a'], 3)), 'bcad');
  assert.equal(order(moveIds(doc('a', 'b', 'c', 'd'), ['a', 'c'], 4)), 'bdac');
  assert.equal(order(moveIds(doc('a', 'b', 'c', 'd'), ['d'], 0)), 'dabc');
});

test('recolour drops the imported values of what it edits only', () => {
  const d: DesignDoc = { notes: '', swatches: [{ ...sw('a', [0.5, 0.1, 30]), source: { space: 'cmyk', values: [0, 0, 0, 1] } }, { ...sw('b', [0.5, 0, 0]), source: { space: 'rgb', values: [1, 1, 1] } }] };
  const next = recolour(d, { a: [0.6, 0.1, 30] });
  assert.equal(next.swatches[0].source, undefined);
  assert.deepEqual(next.swatches[0].oklch, [0.6, 0.1, 30]);
  assert.equal(next.swatches[1], d.swatches[1]);
});

const val = (o: Oklch) => valueOf(o);

test('spreadV: the lighter stays lighter, exactly `gap` apart in value, hues kept', () => {
  const [a, b] = spreadV([0.55, 0.01, 260], [0.5, 0.05, 150], 0.1);
  assert.ok(val(a) > val(b));
  assert.ok(Math.abs(val(a) - val(b) - 0.1) < 1e-6);
  assert.equal(a[2], 260);
  assert.equal(b[2], 150);
});

test('valueFix moves away from the rest of the palette, not into it', () => {
  // Iron and Moss collide; Ember sits just above, Ground far below (all in value)
  const iron = holdValue(0.42, 0.012, 262);
  const moss = holdValue(0.465, 0.067, 155);
  const [i, m] = valueFix([iron, moss], 0.06, [0.05, 0.56, 0.7, 0.93]);
  assert.ok(val(m) - val(i) >= 0.06 - 1e-6);
  assert.ok(0.56 - val(m) >= 0.06 - 1e-6, `Moss ${val(m)} crowds Ember`);
});

test('valueFix on saturated colours: the value gap holds and the hues stay exact', () => {
  for (const [x, y] of [['#0088ff', '#1b998b'], ['#ff0000', '#1b998b'], ['#00aa55', '#ff0088']]) {
    const [a, b] = [hexToOklch(x), hexToOklch(y)];
    const [p, q] = valueFix([a, b], 0.06, []);
    assert.ok(Math.abs(val(p) - val(q)) >= 0.06 - 1e-3, `${x} ${y}: ${val(p)} ${val(q)}`);
    assert.equal(p[2], a[2]);
    assert.equal(q[2], b[2]);
  }
});

test('a value fix lands on the value it places: red, yellow, blue and magenta all hit the target', () => {
  for (const hex of ['#ff0000', '#ffdd00', '#0033ff', '#ff00cc', '#22aa66']) {
    const o = hexToOklch(hex);
    const [moved] = spreadVs([o], 0.1, []);
    assert.ok(Math.abs(val(moved) - val(o)) < 2e-3, `${hex} stays at its value alone: ${val(moved)} vs ${val(o)}`);
    const [x, y] = spreadVs([o, hexToOklch('#808080')], 0.2, []);
    assert.ok(Math.abs(Math.abs(val(x) - val(y)) - 0.2) < 2e-3, `${hex} pair ${val(x)} ${val(y)}`);
  }
});

test('valueFix on a cluster: evenly spaced in value in one move, order kept', () => {
  const greys: Oklch[] = [0.5, 0.52, 0.54, 0.56, 0.58].map((v) => greyOf(v));
  const out = valueFix([greys[2], greys[0], greys[4], greys[1], greys[3]], 0.06, []).map(val);
  const [g3, g1, g5, g2, g4] = out;
  assert.deepEqual([g1, g2, g3, g4, g5], [...out].sort((a, b) => a - b), 'the ramp keeps its order');
  for (const [lo, hi] of [[g1, g2], [g2, g3], [g3, g4], [g4, g5]]) assert.ok(Math.abs(hi - lo - 0.065) < 1e-6);
  assert.ok(Math.abs((g1 + g5) / 2 - 0.54) < 1e-6, 'around where they sat');
});

test('valueFix skips a placement ok() rules out', () => {
  const a = greyOf(0.5);
  const b = greyOf(0.52);
  const [p] = valueFix([a, b], 0.06, [], (next) => Math.abs(val(next[0]) - 0.5) < 1e-6);
  assert.ok(Math.abs(val(p) - 0.5) < 1e-6, 'the darker one stays put');
});

test('cvdFix parts a pair under the simulation', () => {
  const red: Oklch = [0.6, 0.15, 30];
  const green: Oklch = [0.62, 0.12, 140];
  const [x, y] = cvdFix(red, green, 'deutan', 12, [])!;
  assert.ok(deltaE(simulateCvd(x, 'deutan'), simulateCvd(y, 'deutan')) >= 12);
});

test('nextV fills the widest value gap', () => {
  assert.ok(Math.abs(nextV([0.2, 0.3, 0.9]) - 0.6) < 1e-9);
});

test('an Illustration palette goes back to its file with its ramps, groups, steps and edits', () => {
  const ramp: RampSpec = { id: 'r', base: [0.5, 0.1, 30], light: [0.95, 0.05, 85], shadow: [0.4, 0.08, 275], material: 'skin', intensity: 'expressive', steps: 3, hueShift: 0.2, chromaCurve: -0.1, hero: true };
  const file = {
    notes: 'n',
    ramps: [ramp],
    scene: { light: [0.95, 0.05, 85] as Oklch, shadow: [0.4, 0.08, 275] as Oklch },
    swatches: [
      { ...sw('light', [0.7, 0.08, 40]), group: 'r', step: -1 },
      { ...sw('base', [0.5, 0.1, 30]), group: 'r', step: 0 },
      { ...sw('shadow', [0.3, 0.08, 10]), group: 'r', step: 1, edited: true },
      sw('loose', [0.2, 0, 0]),
    ],
  };
  const read = fromPayload(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(toPayload(read), file);
  // an edit in Design: a ramp step becomes hand-edited, a loose colour doesn't
  const edited = toPayload(recolour(read, { light: [0.75, 0.08, 40], loose: [0.25, 0, 0] }));
  assert.equal(edited.swatches[0].edited, true);
  assert.equal(edited.swatches[0].group, 'r');
  assert.equal(edited.swatches[3].edited, undefined);
  assert.deepEqual(edited.ramps, [ramp]);
  // a plain palette stays plain
  assert.equal('ramps' in toPayload(fromPayload({ notes: '', swatches: [sw('a', [0.5, 0, 0])] })), false);
});

test('a held colour never moves in a spread: the free ones make room round it, or nothing moves', () => {
  const a: Oklch = holdValue(0.5, 0.1, 30);
  const b: Oklch = holdValue(0.52, 0.1, 200);
  const [x, y] = spreadV(a, b, 0.1, [], undefined, [true, false]);
  assert.deepEqual(x, a, 'the held one is exactly as it was');
  assert.ok(Math.abs(val(y) - val(x)) >= 0.1 - 1e-6 && val(y) > val(x), 'the free one moved clear, still the lighter');
  // darker free colour: it steps down, not through the held one
  const [p, q] = spreadV(b, a, 0.1, [], undefined, [false, true]);
  assert.deepEqual(q, a);
  assert.ok(val(a) - val(p) >= 0.1 - 1e-6 || val(p) - val(a) >= 0.1 - 1e-6);
  // no room: the held one at white, the other can only be lighter than it is
  const white: Oklch = [1, 0, 0];
  assert.deepEqual(spreadVs([white, holdValue(0.98, 0.02, 30)], 0.2, [], undefined, [true, false]).map(val).map((v) => +v.toFixed(2)), [1, 0.8], 'it steps down away from the white');
  // a run between two held colours that cannot hold it comes back as it was
  const [lo, hi] = [holdValue(0.4, 0, 0), holdValue(0.5, 0, 0)];
  const mid = holdValue(0.45, 0.05, 90);
  assert.deepEqual(spreadVs([lo, mid, hi], 0.1, [], undefined, [true, false, true]), [lo, mid, hi]);
});

test('partPair: a locked colour stays, the colour that moves first moves alone, and a passing contrast pair is not broken', () => {
  const red = { ...sw('red', [0.6, 0.15, 30]), role: 'Primary' };
  const green = { ...sw('green', [0.62, 0.12, 140]), role: 'Highlight' };
  const rank = (w: Swatch) => (w.role === 'Highlight' ? 0 : 2);
  const both = [red, green];
  const free = partPair(red, green, ['deutan'], 12, both, { rank });
  assert.ok(free.changes && free.changes.red === red.oklch, 'the Primary stays where it is: the Highlight moves first');
  assert.notDeepEqual(free.changes!.green, green.oklch);
  assert.ok(deltaE(simulateCvd(free.changes!.red, 'deutan'), simulateCvd(free.changes!.green, 'deutan')) >= 12);
  const lockedGreen = partPair(red, green, ['deutan'], 12, both, { locked: ['green'], rank });
  assert.ok(lockedGreen.changes && lockedGreen.changes.green === green.oklch && lockedGreen.changes.red !== red.oklch, 'the locked one stays, the other moves');
  assert.deepEqual(partPair(red, green, ['deutan'], 12, both, { locked: ['red', 'green'] }), { changes: null, blocked: true });
});

test('spreadCluster: a run that reads as one grey spreads round its locked colours, the supporting ones first', () => {
  const run = [sw('a', greyOf(0.5)), sw('b', greyOf(0.52)), sw('c', greyOf(0.54))].map((w, i) => ({ ...w, role: i === 1 ? 'Highlight' : 'Primary' }));
  const moved = spreadCluster(run, 0.06, [], { locked: ['a'], rank: (w) => (w.role === 'Highlight' ? 0 : 2) });
  const out = moved.changes!;
  assert.deepEqual(out.a, run[0].oklch, 'locked, so it stays');
  const vs = ['a', 'b', 'c'].map((id) => val(out[id]));
  assert.ok(vs[1] - vs[0] >= 0.06 - 1e-6 && vs[2] - vs[1] >= 0.06 - 1e-6, `spaced ${vs.map((v) => v.toFixed(3))}`);
  assert.deepEqual(spreadCluster(run, 0.06, [], { locked: ['a', 'b', 'c'] }), { changes: null, blocked: true });
});

test('blank names that would repeat are numbered, so a sentence never names two colours alike', async () => {
  const { named } = await import('../src/renderer/tools/common/names.ts');
  const list = [sw('a', [0.12, 0.01, 30]), sw('b', [0.14, 0.01, 30]), { ...sw('c', [0.13, 0.01, 30]), name: 'Black 2' }];
  const names = named(list).map((w) => w.name);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 3, names.join());
  assert.equal(names[2], 'Black 2', 'a name the user gave is never changed');
  assert.ok(names[0] !== names[1]);
});
