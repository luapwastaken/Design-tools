import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, hexToOklch, simulateCvd, type Oklch } from '../src/shared/color/index.ts';
import type { Swatch } from '../src/shared/types.ts';
import { cvdFix, nextL, spreadL, valueFix } from '../src/renderer/tools/design/adjust.ts';
import { moveIds, recolour, type DesignDoc } from '../src/renderer/tools/design/doc.ts';

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

test('spreadL: the lighter stays lighter, exactly `gap` apart', () => {
  const [a, b] = spreadL([0.55, 0.01, 260], [0.5, 0.05, 150], 0.1);
  assert.ok(a[0] > b[0]);
  assert.ok(Math.abs(a[0] - b[0] - 0.1) < 1e-9);
  assert.equal(a[2], 260);
});

test('valueFix moves away from the rest of the palette, not into it', () => {
  // Iron 0.541 and Moss 0.587 collide; Ember sits just above at 0.662, Ground far below at 0.2
  const [iron, moss] = valueFix([[0.541, 0.012, 262], [0.587, 0.067, 155]], 0.06, [0.2, 0.662, 0.767, 0.935]);
  assert.ok(moss[0] - iron[0] >= 0.06);
  assert.ok(0.662 - moss[0] >= 0.06, `Moss ${moss[0]} crowds Ember`);
});

test('valueFix on saturated colours: the gap holds and the hues stay exact', () => {
  for (const [x, y] of [['#0088ff', '#1b998b'], ['#ff0000', '#1b998b'], ['#00aa55', '#ff0088']]) {
    const [a, b] = [hexToOklch(x), hexToOklch(y)];
    const [p, q] = valueFix([a, b], 0.06, []);
    assert.ok(Math.abs(p[0] - q[0]) >= 0.06, `${x} ${y}: ${p[0]} ${q[0]}`);
    assert.equal(p[2], a[2]);
    assert.equal(q[2], b[2]);
  }
});

test('valueFix on a cluster: evenly spaced in one move, order kept', () => {
  const greys: Oklch[] = [0.5, 0.52, 0.54, 0.56, 0.58].map((l) => [l, 0, 0]);
  const out = valueFix([greys[2], greys[0], greys[4], greys[1], greys[3]], 0.06, []).map((o) => o[0]);
  const [g3, g1, g5, g2, g4] = out;
  assert.deepEqual([g1, g2, g3, g4, g5], [...out].sort((a, b) => a - b), 'the ramp keeps its order');
  for (const [lo, hi] of [[g1, g2], [g2, g3], [g3, g4], [g4, g5]]) assert.ok(Math.abs(hi - lo - 0.065) < 1e-9);
  assert.ok(Math.abs((g1 + g5) / 2 - 0.54) < 1e-9, 'around where they sat');
});

test('valueFix skips a placement ok() rules out', () => {
  const a: Oklch = [0.5, 0, 0];
  const b: Oklch = [0.52, 0, 0];
  const [p] = valueFix([a, b], 0.06, [], (next) => next[0][0] === 0.5);
  assert.equal(p[0], 0.5, 'the darker one stays put');
});

test('cvdFix parts a pair under the simulation', () => {
  const red: Oklch = [0.6, 0.15, 30];
  const green: Oklch = [0.62, 0.12, 140];
  const [x, y] = cvdFix(red, green, 'deutan', 12, [])!;
  assert.ok(deltaE(simulateCvd(x, 'deutan'), simulateCvd(y, 'deutan')) >= 12);
});

test('nextL fills the widest lightness gap', () => {
  assert.ok(Math.abs(nextL([0.2, 0.3, 0.9]) - 0.6) < 1e-9);
});
