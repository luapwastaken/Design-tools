import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, type HistoryStep } from '../src/renderer/tools/illustration/paint/history.ts';

type Copy = { id: number; released: number; release(): void };
function copies() {
  const all: Copy[] = [];
  const make = (): Copy => {
    const c: Copy = { id: all.length, released: 0, release: () => void c.released++ };
    all.push(c);
    return c;
  };
  return { all, make };
}
const rect = { x: 0, y: 0, w: 10, h: 10 };
const step = (copy: Copy, kind: 'stroke' | 'clear' = 'stroke', bytes = 100): HistoryStep<Copy> => ({ kind, rect, bytes, copy, blank: [false, false] });

test('20 steps, the oldest dropped first and released', () => {
  const c = copies();
  const h = new History<Copy>({ steps: 20, bytes: 1e9 });
  for (let i = 0; i < 25; i++) h.push(step(c.make()));
  assert.equal(h.depth, 20);
  assert.deepEqual(c.all.filter((x) => x.released).map((x) => x.id), [0, 1, 2, 3, 4]);
});

test('the byte cap drops the oldest first, but keeps the newest', () => {
  const c = copies();
  const h = new History<Copy>({ steps: 20, bytes: 250 });
  for (let i = 0; i < 4; i++) h.push(step(c.make()));
  assert.equal(h.depth, 2);
  assert.equal(h.bytes, 200);
  h.push(step(c.make(), 'clear', 1000));
  assert.equal(h.depth, 1);
  assert.ok(h.lastIsClear);
});

test('undo then redo round-trips, and a new step releases what was undone', () => {
  const c = copies();
  const h = new History<Copy>({ steps: 20, bytes: 1e9 });
  const [a, b] = [c.make(), c.make()];
  h.push(step(a));
  h.push(step(b));
  assert.equal(h.undo()?.copy, b);
  assert.deepEqual([h.depth, h.redoDepth], [1, 1]);
  assert.equal(h.redo()?.copy, b);
  assert.equal(h.redo(), null);
  assert.equal(h.undo()?.copy, b);
  assert.equal(h.undo()?.copy, a);
  assert.equal(h.undo(), null);
  assert.deepEqual([h.depth, h.redoDepth], [0, 2]);
  h.push(step(c.make()));
  assert.equal(h.redoDepth, 0);
  assert.deepEqual([a.released, b.released], [1, 1]);
});

test('a clear is one step; reset releases everything once', () => {
  const c = copies();
  const h = new History<Copy>({ steps: 20, bytes: 1e9 });
  h.push(step(c.make()));
  h.push(step(c.make(), 'clear'));
  assert.ok(h.lastIsClear);
  h.undo();
  assert.ok(!h.lastIsClear);
  h.reset();
  h.reset();
  assert.deepEqual([h.depth, h.redoDepth], [0, 0]);
  assert.ok(c.all.every((x) => x.released === 1));
});
