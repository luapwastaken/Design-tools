import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocController } from '../src/shared/doc.ts';
import { keysOf, isLive } from '../src/renderer/shell/core/keys.ts';
import { reachable } from '../src/renderer/shell/core/shortcuts.ts';
import { emptyDoc, type PatternDoc } from '../src/renderer/tools/pattern/doc.ts';
import { patternShortcuts as build, type Acts } from '../src/renderer/tools/pattern/keys.ts';
import { made, swatchCopier } from '../src/renderer/tools/pattern/keystate.ts';

const calls: string[] = [];
const acts: Acts = {
  newPattern: async () => void calls.push('new'),
  reseed: () => void calls.push('reseed'),
  surprise: (doc) => doc.transact('Surprise me', (x) => ({ ...x, seed: x.seed + 1, arrangement: 'brick' })),
};
const patternShortcuts = (doc: ReturnType<typeof fresh>) => build(doc, acts);

const fresh = () => {
  made.set(null);
  swatchCopier.set(null);
  return createDocController<PatternDoc>('pattern', emptyDoc());
};
const find = (doc: ReturnType<typeof fresh>, keys: string) => patternShortcuts(doc).find((s) => s.keys === keys)!;

test('no two live rows share a combo, with or without a surprise showing', () => {
  for (const showing of [false, true]) {
    const doc = fresh();
    swatchCopier.set(() => {});
    if (showing) find(doc, 'Shift+R').run!();
    const live = patternShortcuts(doc).filter(isLive);
    const all = live.flatMap((s) => keysOf(s).map((k) => k.toUpperCase()));
    assert.equal(new Set(all).size, all.length, `showing=${showing}`);
    assert.equal(reachable(patternShortcuts(doc)).length, patternShortcuts(doc).length);
  }
});

test('Keep and Go back are off until a surprise shows, and Go back undoes it', () => {
  const doc = fresh();
  assert.equal(find(doc, 'A').off, true);
  assert.equal(find(doc, 'Escape').off, true);
  const before = doc.get();
  find(doc, 'Shift+R').run!();
  assert.notEqual(doc.get(), before);
  assert.equal(find(doc, 'A').off, false);
  find(doc, 'Escape').run!();
  assert.equal(doc.get(), before);
  assert.equal(find(doc, 'A').off, true);
});

test('Keep drops the proposal and leaves the layout; an edit also keeps it', () => {
  const doc = fresh();
  find(doc, 'Shift+R').run!();
  const surprised = doc.get();
  find(doc, 'A').run!();
  assert.equal(doc.get(), surprised);
  assert.equal(find(doc, 'A').off, true);
  find(doc, 'Shift+R').run!();
  doc.transact('Edit', (x) => ({ ...x, seed: x.seed + 1 }));
  assert.equal(find(doc, 'A').off, true);
});

test('Alt+1..4 set the arrangement', () => {
  const doc = fresh();
  ['grid', 'halfdrop', 'brick', 'scatter'].forEach((a, n) => {
    find(doc, `Alt+${n + 1}`).run!();
    assert.equal(doc.get().arrangement, a);
  });
});

test('Ctrl+Shift+C copies through the mounted view, and is off without one', () => {
  const doc = fresh();
  assert.equal(find(doc, 'Ctrl+Shift+C').off, true);
  let n = 0;
  swatchCopier.set(() => void n++);
  find(doc, 'Ctrl+Shift+C').run!();
  assert.equal(n, 1);
});

test('Ctrl+N and R call the own actions', () => {
  const doc = fresh();
  calls.length = 0;
  find(doc, 'Ctrl+N').run!();
  find(doc, 'R').run!();
  assert.deepEqual(calls, ['new', 'reseed']);
});

test('Ctrl+V is listed only, and Space is not a row', () => {
  const doc = fresh();
  assert.equal(find(doc, 'Ctrl+V').run, undefined);
  assert.ok(!patternShortcuts(doc).some((s) => s.keys === 'Space' && isLive(s)));
  assert.ok(patternShortcuts(doc).every((s) => s.group));
});
