import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocController } from '../src/shared/doc.ts';
import { MERGE_MS, same } from '../src/shared/history.ts';
import type { ChangeCause, DocControllerOptions, DocSource } from '../src/shared/doc-api.ts';

type Doc = { n: number; tags: string[] };
const inc = (d: Doc): Doc => ({ ...d, n: d.n + 1 });
const dec = (d: Doc): Doc => ({ ...d, n: d.n - 1 });
const to = (n: number) => (d: Doc): Doc => ({ ...d, n });
const src = (itemId: string, mtimeMs = 1): DocSource => ({
  itemId,
  kind: 'palette',
  name: itemId,
  collection: 'Scratch',
  stamp: { mtimeMs, size: 10 },
});

function setup(options: DocControllerOptions = {}) {
  let t = 1000;
  const doc = createDocController<Doc>('dev-palette', { n: 0, tags: [] }, { strict: true, now: () => t, ...options });
  const log: [number, ChangeCause][] = [];
  doc.onChange((e, cause) => log.push([e.data.n, cause]));
  let notified = 0;
  doc.subscribe(() => notified++);
  return { doc, log, tick: (ms: number) => (t += ms), notified: () => notified };
}

test('starts empty with nothing to undo', () => {
  const { doc } = setup();
  assert.deepEqual(doc.get(), { n: 0, tags: [] });
  assert.equal(doc.toolId, 'dev-palette');
  assert.equal(doc.source(), null);
  assert.deepEqual(doc.state(), { t: 'new' });
  assert.equal(doc.depth(), 0);
  assert.equal(doc.canUndo(), false);
  assert.equal(doc.canRedo(), false);
  assert.equal(doc.undoLabel(), null);
  assert.equal(doc.redoLabel(), null);
  assert.equal(doc.inGesture(), false);
});

test('transact adds one labelled step; undo and redo walk it with their causes', () => {
  const { doc, log } = setup();
  doc.transact('Add one', inc);
  doc.transact('Add two', (d) => ({ ...d, n: d.n + 2 }));
  assert.equal(doc.get().n, 3);
  assert.equal(doc.depth(), 2);
  assert.equal(doc.undoLabel(), 'Add two');

  doc.undo();
  assert.equal(doc.get().n, 1);
  assert.equal(doc.undoLabel(), 'Add one');
  assert.equal(doc.redoLabel(), 'Add two');
  doc.undo();
  assert.equal(doc.get().n, 0);
  assert.equal(doc.canUndo(), false);
  doc.undo(); // nothing left: no change, no hook
  doc.redo();
  doc.redo();
  doc.redo(); // nothing left
  assert.equal(doc.get().n, 3);
  assert.deepEqual(log, [
    [1, 'commit'],
    [3, 'commit'],
    [1, 'undo'],
    [0, 'undo'],
    [1, 'redo'],
    [3, 'redo'],
  ]);
});

test('a gesture updates the live doc without steps or hooks until commit', () => {
  const { doc, log, notified } = setup();
  doc.begin();
  assert.equal(doc.inGesture(), true);
  doc.set(inc);
  doc.set(inc);
  assert.equal(doc.get().n, 2);
  assert.equal(doc.depth(), 0);
  assert.deepEqual(log, []);
  assert.ok(notified() >= 3);

  doc.commit('Drag');
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.depth(), 1);
  assert.equal(doc.undoLabel(), 'Drag');
  assert.deepEqual(log, [[2, 'commit']]);
  doc.undo();
  assert.equal(doc.get().n, 0);
});

test('get() is referentially stable between changes', () => {
  const { doc } = setup();
  assert.equal(doc.get(), doc.get());
  doc.begin();
  const before = doc.get();
  doc.set((d) => d); // same reference: nothing happens
  assert.equal(doc.get(), before);
});

test('cancel restores the state from begin and adds no step', () => {
  const { doc, log } = setup();
  doc.transact('One', inc);
  const committed = doc.get();
  doc.begin();
  doc.set(inc);
  doc.set(inc);
  doc.cancel();
  assert.equal(doc.get(), committed);
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.depth(), 1);
  assert.deepEqual(log, [[1, 'commit']]);
});

test('a commit that changes nothing adds no step, by reference or by value', () => {
  const { doc, log } = setup();
  const start = doc.get();
  doc.begin();
  doc.commit('Nothing');
  doc.begin();
  doc.set((d) => ({ ...d, tags: [...d.tags] })); // new objects, same contents
  doc.commit('Same');
  doc.begin();
  doc.set(inc);
  doc.set(dec); // dragged away and back
  doc.commit('Back');
  doc.transact('Noop', (d) => ({ ...d }));
  assert.equal(doc.depth(), 0);
  assert.equal(doc.canUndo(), false);
  assert.deepEqual(log, []);
  assert.equal(doc.get(), start, 'the committed reference is kept');
});

test('set outside a gesture throws when strict and is ignored otherwise', () => {
  assert.throws(() => setup().doc.set(inc), /outside a gesture/);
  const { doc, log } = setup({ strict: false });
  doc.set(inc);
  assert.equal(doc.get().n, 0);
  assert.deepEqual(log, []);
});

test('commit and cancel without begin do nothing', () => {
  const { doc, log } = setup();
  doc.commit('Stray');
  doc.commit('Stray', 'k');
  doc.cancel();
  assert.equal(doc.depth(), 0);
  assert.deepEqual(log, []);
});

test('begin while in a gesture keeps the first start', () => {
  const { doc } = setup();
  doc.begin();
  doc.set(inc);
  doc.begin();
  doc.set(inc);
  assert.equal(doc.get().n, 2);
  doc.cancel();
  assert.equal(doc.get().n, 0);

  doc.begin();
  doc.set(inc);
  doc.begin();
  doc.set(inc);
  doc.commit('Both');
  assert.equal(doc.depth(), 1);
  doc.undo();
  assert.equal(doc.get().n, 0);
});

test('transact inside an open gesture ends it as one step', () => {
  const { doc, log } = setup();
  doc.begin();
  doc.set(inc);
  doc.transact('Shortcut', inc);
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.depth(), 1);
  assert.equal(doc.undoLabel(), 'Shortcut');
  assert.deepEqual(log, [[2, 'commit']]);
});

test('a throwing transact leaves no gesture open and no step', () => {
  const { doc } = setup();
  assert.throws(() => doc.transact('Boom', () => { throw new Error('boom'); }), /boom/);
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.depth(), 0);
  doc.transact('Fine', inc);
  assert.equal(doc.depth(), 1);
});

test('undo during a gesture cancels it and adds no step', () => {
  const { doc, log } = setup();
  doc.transact('One', inc);
  doc.begin();
  assert.equal(doc.canUndo(), true);
  doc.set(inc);
  doc.set(inc);
  doc.undo();
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.get().n, 1, 'back to the gesture start, not past the previous step');
  assert.equal(doc.depth(), 1);
  assert.equal(doc.canRedo(), false);
  assert.deepEqual(log, [[1, 'commit']]);
  doc.undo();
  assert.equal(doc.get().n, 0);
});

test('undo during a gesture on a fresh doc cancels it; can*/labels count steps only', () => {
  const { doc } = setup();
  doc.begin();
  doc.set(inc);
  assert.equal(doc.canUndo(), false, 'an open gesture is not a step');
  assert.equal(doc.undoLabel(), null);
  doc.undo();
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.get().n, 0);
});

test('redo during a gesture cancels it, then redoes', () => {
  const { doc, log } = setup();
  doc.transact('One', inc);
  doc.undo();
  doc.begin();
  doc.set(to(50));
  doc.redo();
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.get().n, 1);
  assert.deepEqual(log.at(-1), [1, 'redo']);
});

test('redo during a gesture with nothing to redo leaves the gesture alone', () => {
  const { doc, log } = setup();
  doc.begin();
  doc.set(to(5));
  doc.redo();
  assert.equal(doc.inGesture(), true);
  assert.equal(doc.get().n, 5);
  doc.commit('Drag');
  assert.deepEqual(log, [[5, 'commit']]);
});

test('a new step after undo drops redo', () => {
  const { doc } = setup();
  doc.transact('One', inc);
  doc.transact('Two', inc);
  doc.undo();
  assert.equal(doc.canRedo(), true);
  doc.transact('Other', to(10));
  assert.equal(doc.canRedo(), false);
  assert.equal(doc.redoLabel(), null);
  assert.equal(doc.depth(), 2);
  doc.undo();
  assert.equal(doc.get().n, 1);
  doc.redo();
  assert.equal(doc.get().n, 10);
});

test('fast undo right after a commit (the old debounce race)', () => {
  const { doc, tick } = setup();
  doc.transact('Nudge', inc, 'n');
  doc.undo(); // same tick as the commit
  assert.equal(doc.get().n, 0);
  assert.equal(doc.redoLabel(), 'Nudge');
  tick(500); // where the old debounced snapshot used to land and wipe redo
  assert.equal(doc.canRedo(), true);
  assert.equal(doc.get().n, 0);
  doc.redo();
  assert.equal(doc.get().n, 1);

  // an undo in between stops key-repeat coalescing: the undone step never comes back
  doc.undo();
  doc.transact('Nudge', to(7), 'n');
  assert.equal(doc.depth(), 1);
  doc.undo();
  assert.equal(doc.get().n, 0);
});

test('key repeat coalesces within 1s: same key and label, nothing in between', () => {
  const { doc, log, tick } = setup();
  doc.transact('Nudge', inc, 'n');
  tick(100);
  doc.transact('Nudge', inc, 'n');
  tick(MERGE_MS); // exactly 1s after the last repeat still merges
  doc.transact('Nudge', inc, 'n');
  assert.equal(doc.depth(), 1);
  assert.equal(doc.get().n, 3);
  assert.deepEqual(log.map((l) => l[1]), ['commit', 'commit', 'commit'], 'every repeat lands at once');
  doc.undo();
  assert.equal(doc.get().n, 0);
  doc.redo();

  tick(MERGE_MS + 1);
  doc.transact('Nudge', inc, 'n'); // too late
  assert.equal(doc.depth(), 2);
});

test('key repeat does not coalesce across keys, labels, keyless steps or later edits', () => {
  const { doc, tick } = setup();
  doc.transact('Nudge', inc, 'a');
  tick(10);
  doc.transact('Nudge', inc, 'b'); // other control
  tick(10);
  doc.transact('Nudge', inc, 'a'); // something in between
  tick(10);
  doc.transact('Scale', inc, 'a'); // other label
  tick(10);
  doc.transact('Scale', inc); // no key
  tick(10);
  doc.transact('Scale', inc); // no key never merges
  tick(10);
  doc.begin();
  doc.set(inc);
  doc.commit('Scale', 'a'); // previous step is keyless
  assert.equal(doc.depth(), 7);
});

test('a coalesced run that ends where it began leaves no step', () => {
  const { doc, tick } = setup();
  doc.transact('Other', to(5));
  doc.transact('Nudge', inc, 'n');
  tick(50);
  doc.transact('Nudge', dec, 'n');
  assert.equal(doc.get().n, 5);
  assert.equal(doc.depth(), 1);
  assert.equal(doc.undoLabel(), 'Other');
  tick(50);
  doc.transact('Nudge', inc, 'n'); // starts a fresh step
  assert.equal(doc.depth(), 2);
});

test('history keeps `limit` steps, dropping the oldest', () => {
  const { doc } = setup({ limit: 3 });
  for (let i = 0; i < 5; i++) doc.transact(`Step ${i + 1}`, inc);
  assert.equal(doc.depth(), 3);
  doc.undo();
  doc.undo();
  doc.undo();
  assert.equal(doc.get().n, 2);
  assert.equal(doc.canUndo(), false);
  doc.redo();
  doc.redo();
  doc.redo();
  assert.equal(doc.get().n, 5);
  assert.equal(doc.canRedo(), false);
});

test('limit 0 keeps no steps and survives key repeat', () => {
  const { doc } = setup({ limit: 0 });
  doc.transact('Nudge', inc, 'n');
  doc.transact('Nudge', inc, 'n');
  assert.equal(doc.get().n, 2);
  assert.equal(doc.canUndo(), false);
});

test('a clock that steps back does not coalesce', () => {
  const { doc, tick } = setup();
  doc.transact('Nudge', inc, 'n');
  tick(-5000);
  doc.transact('Nudge', inc, 'n');
  assert.equal(doc.depth(), 2);
});

test('the default limit is 200', () => {
  const { doc } = setup({ strict: true });
  for (let i = 0; i < 205; i++) doc.transact('Step', inc);
  assert.equal(doc.depth(), 200);
});

test('receive is one step; undo restores the previous document and source', () => {
  const { doc, log } = setup();
  const a = src('a');
  doc.receive('Open A', { n: 10, tags: ['a'] }, a);
  doc.transact('Edit A', inc);
  const b = src('b');
  doc.receive('Open B', { n: 20, tags: ['b'] }, b);
  assert.equal(doc.depth(), 3);
  assert.equal(doc.undoLabel(), 'Open B');
  assert.equal(doc.source(), b);

  doc.undo();
  assert.equal(doc.get().n, 11);
  assert.equal(doc.source(), a);
  doc.undo();
  doc.undo();
  assert.equal(doc.source(), null);
  assert.equal(doc.get().n, 0);
  doc.redo();
  doc.redo();
  doc.redo();
  assert.equal(doc.source(), b);
  assert.deepEqual(log.map((l) => l[1]), ['receive', 'commit', 'receive', 'undo', 'undo', 'undo', 'redo', 'redo', 'redo']);
});

test('receive drops redo, is never coalesced and is never skipped', () => {
  const { doc } = setup();
  doc.transact('One', inc, 'k');
  doc.undo();
  doc.receive('Colours from X', doc.get(), doc.source()); // same data: still a step, Ctrl+Z must go back
  assert.equal(doc.canRedo(), false);
  assert.equal(doc.depth(), 1);
  doc.receive('Colours from X', doc.get(), doc.source());
  assert.equal(doc.depth(), 2);
  doc.transact('Colours from X', inc, 'k');
  assert.equal(doc.depth(), 3);
});

test('receive during a gesture ends it; the half-done drag never lands', () => {
  const { doc, log } = setup();
  const current = doc.get(); // the shell reads current, then awaits tool.receive
  doc.begin();
  doc.set(to(42)); // the user drags while the item decodes
  doc.receive('Colours from Monolith', { ...current, tags: ['monolith'] }, null);
  assert.equal(doc.inGesture(), false);
  assert.throws(() => doc.set(inc), /outside a gesture/);
  doc.cancel(); // Esc or pointer-up after the fact: nothing
  doc.commit('Drag');
  assert.deepEqual(doc.get(), { n: 0, tags: ['monolith'] });
  assert.equal(doc.depth(), 1);
  doc.undo();
  assert.deepEqual(doc.get(), { n: 0, tags: [] });
  assert.deepEqual(log, [[0, 'receive'], [0, 'undo']]);
});

test('reset replaces doc and source with no step', () => {
  const { doc, log } = setup();
  const a = src('a');
  doc.reset({ n: 4, tags: ['x'] }, a, 'restore');
  assert.equal(doc.get().n, 4);
  assert.equal(doc.source(), a);
  assert.equal(doc.depth(), 0, 'restore on launch leaves no history');
  assert.equal(doc.canUndo(), false);
  assert.deepEqual(log, [[4, 'restore']]);
});

test('reset after an Open keeps the Open undoable (load-time analysis)', () => {
  const { doc } = setup();
  doc.transact('One', inc);
  doc.receive('Open photo', { n: 50, tags: [] }, null);
  doc.reset({ n: 50, tags: ['analysed'] }, null, 'restore');
  assert.equal(doc.depth(), 2);
  assert.equal(doc.undoLabel(), 'Open photo');
  doc.undo();
  assert.equal(doc.get().n, 1);
  doc.redo();
  assert.deepEqual(doc.get().tags, ['analysed']);
});

test('reset during a gesture ends it', () => {
  const { doc } = setup();
  doc.begin();
  doc.set(to(9));
  doc.reset({ n: 30, tags: [] }, null, 'restore');
  assert.equal(doc.inGesture(), false);
  assert.equal(doc.get().n, 30);
  doc.cancel();
  assert.equal(doc.get().n, 30);
  assert.equal(doc.depth(), 0);
});

test('receive and reset give older entries of the same item the fresh stamp', () => {
  const { doc } = setup();
  doc.receive('Open B', { n: 1, tags: [] }, src('b', 1));
  doc.receive('Open A', { n: 10, tags: [] }, src('a', 1));
  doc.transact('Edit', inc);
  doc.setSource(src('a', 2)); // the shell wrote the edit
  const a9 = src('a', 9); // changed outside; the app re-read it
  doc.receive('Reload from disk', { n: 50, tags: [] }, a9);
  doc.undo();
  assert.equal(doc.source(), a9, 'undo writes with the stamp the app last read');
  doc.undo();
  assert.equal(doc.source(), a9);
  doc.undo();
  assert.equal(doc.source()?.stamp.mtimeMs, 1, 'another item keeps its own stamp');

  doc.redo();
  const a12 = src('a', 12);
  doc.reset({ n: 10, tags: ['analysed'] }, a12, 'restore');
  doc.redo();
  assert.equal(doc.source(), a12);
});

test('setSource relinks every entry of the same item, with no step and no hook', () => {
  const { doc, log, notified } = setup();
  const a1 = src('a', 1);
  doc.receive('Open A', { n: 10, tags: [] }, a1);
  doc.transact('Edit', inc);
  const before = notified();
  const a2 = src('a', 2); // the shell wrote the file: fresher stamp
  doc.setSource(a2);
  assert.equal(doc.source(), a2);
  assert.equal(doc.depth(), 2);
  assert.equal(log.length, 2);
  assert.ok(notified() > before);

  doc.undo(); // back to the Open: must write with the fresh stamp
  assert.equal(doc.source(), a2);
  doc.undo(); // before the Open: another document, untouched
  assert.equal(doc.source(), null);
  doc.redo();
  doc.redo();
  assert.deepEqual(log.at(-1), [11, 'redo']);
});

test('setSource(s, null) links the unlinked run (first commit creates the item)', () => {
  const { doc } = setup();
  doc.transact('One', inc);
  const s = src('scratch-1');
  doc.setSource(s, null);
  assert.equal(doc.source(), s);
  doc.undo();
  assert.equal(doc.source(), s, 'undo writes to the item, not a second new one');
});

test('setSource relinks the item the write was for, not the one open now', () => {
  const { doc, log } = setup();
  const sources: DocSource[] = [];
  doc.onChange((e) => sources.push(e.source));
  const b = src('b', 5);
  doc.receive('Open A', { n: 1, tags: [] }, src('a', 1));
  doc.transact('Edit A', inc); // write of A queued
  doc.receive('Open B', { n: 100, tags: [] }, b); // user opens B before it resolves
  const a2 = src('a', 2);
  doc.setSource(a2); // A's write resolves
  assert.equal(doc.source(), b);
  doc.transact('Edit B', inc);
  assert.deepEqual([log.at(-1), sources.at(-1)], [[101, 'commit'], b]);
  doc.undo();
  doc.undo();
  assert.equal(doc.source(), a2);
});

test('a late first-commit create or fork relinks only its own run', () => {
  const { doc } = setup();
  doc.transact('New edit', inc); // create of Scratch 1 queued
  doc.receive('Open A', { n: 10, tags: [] }, src('a', 1));
  doc.transact('Edit A', inc); // A is locked: fork queued
  const b = src('b', 3);
  doc.receive('Open B', { n: 20, tags: [] }, b);
  const scratch = src('scratch-1');
  const fork = src('a-copy');
  doc.setSource(scratch, null);
  doc.setSource(fork, src('a', 1));
  assert.equal(doc.source(), b);
  doc.undo();
  assert.equal(doc.source(), fork);
  doc.undo();
  assert.equal(doc.source(), fork);
  doc.undo();
  assert.equal(doc.source(), scratch);
});

test('setSource during a gesture survives cancel and does not break coalescing', () => {
  const { doc, tick } = setup();
  doc.receive('Open A', { n: 0, tags: [] }, src('a', 1));
  doc.transact('Nudge', inc, 'n');
  doc.setSource(src('a', 2)); // write finished between repeats
  tick(30);
  doc.transact('Nudge', inc, 'n');
  assert.equal(doc.depth(), 2, 'still one Nudge step');

  doc.begin();
  doc.set(inc);
  const a3 = src('a', 3);
  doc.setSource(a3);
  doc.cancel();
  assert.equal(doc.source(), a3);
  assert.equal(doc.get().n, 2);
});

test('setState is not part of history', () => {
  const { doc, log, notified } = setup();
  doc.transact('One', inc);
  const before = notified();
  doc.setState({ t: 'locked', collection: 'Monolith' });
  assert.ok(notified() > before);
  assert.equal(doc.depth(), 1);
  doc.undo();
  assert.deepEqual(doc.state(), { t: 'locked', collection: 'Monolith' });
  doc.redo();
  assert.deepEqual(doc.state(), { t: 'locked', collection: 'Monolith' });
  assert.deepEqual(log.map((l) => l[1]), ['commit', 'undo', 'redo']);
});

test('unsubscribe and onChange disposers stop calls', () => {
  const doc = createDocController<Doc>('dev-palette', { n: 0, tags: [] }, { strict: true });
  let subs = 0;
  let hooks = 0;
  const offSub = doc.subscribe(() => subs++);
  const offHook = doc.onChange(() => hooks++);
  doc.transact('One', inc);
  const seen = subs;
  assert.ok(seen > 0);
  offSub();
  offHook();
  doc.transact('Two', inc);
  assert.equal(subs, seen);
  assert.equal(hooks, 1);
});

test('same() compares JSON-shaped values structurally', () => {
  assert.ok(same({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] }));
  assert.ok(!same({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!same([1, 2], { 0: 1, 1: 2 }));
  assert.ok(!same(new Map([[1, 1]]), new Map([[1, 1]])), 'non-plain objects only equal themselves');
  assert.ok(!same(null, {}));
  assert.ok(same({ h: NaN }, { h: NaN }), 'a NaN doc dragged away and back is unchanged');
  assert.ok(same(0, -0));
});
