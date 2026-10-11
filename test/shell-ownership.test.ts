import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docState, editName, findRef, holdsItem, type ItemFacts, lockedIn, planChange, sameStamp, sourceOf } from '../src/renderer/shell/core/ownership.ts';
import type { ChangeCause, DocSource, DocState } from '../src/shared/doc-api.ts';
import type { LibraryIndex, LibraryItemRef } from '../src/shared/types.ts';

const src = (name = 'Monolith core', collection = 'Monolith'): NonNullable<DocSource> => ({
  itemId: 'A',
  kind: 'palette',
  name,
  collection,
  stamp: { mtimeMs: 1000, size: 10 },
});
const facts = (f: Partial<ItemFacts> = {}): ItemFacts => ({ missing: false, lockedIn: null, paused: false, ...f });
const ref = (id: string, collection: string, o: Partial<LibraryItemRef> = {}): LibraryItemRef => ({
  id,
  kind: 'palette',
  name: id,
  collection,
  locked: false,
  path: `C:/L/${collection}/${id}.palette.json`,
  ext: 'json',
  mtimeMs: 5,
  size: 7,
  ...o,
});
const index = (): LibraryIndex => ({
  root: 'C:/L',
  ok: true,
  collections: [
    { name: 'Monolith', locked: true, items: [ref('A', 'Monolith')], notImported: [], ignored: 0 },
    { name: 'Scratch', locked: false, items: [ref('B', 'Scratch')], notImported: [], ignored: 0 },
  ],
});

test('an unlinked document is new, or not saved when its create failed', () => {
  assert.deepEqual(docState('design', null, null, null), { t: 'new' });
  assert.deepEqual(docState('design', null, null, 'The Library folder is missing.'), { t: 'write-failed', message: 'The Library folder is missing.' });
});

test('a linked document it owns reads SAVED with the stamp time and collection', () => {
  assert.deepEqual(docState('design', src(), facts({ owner: 'design' }), null), { t: 'saved', at: 1000, collection: 'Monolith' });
  // unowned (restored, undeleted, unlocked) reads saved too; the shell then claims it
  assert.deepEqual(docState('design', src(), facts(), null), { t: 'saved', at: 1000, collection: 'Monolith' });
});

test('owned by another tool reads OPEN IN that tool', () => {
  assert.deepEqual(docState('design', src(), facts({ owner: 'illustration' }), null), { t: 'owned-elsewhere', by: 'illustration' });
});

test('losing an item is sticky: OPEN IN stays after the other tool lets go', () => {
  assert.deepEqual(docState('design', src(), facts({ lostTo: 'illustration' }), null), { t: 'owned-elsewhere', by: 'illustration' });
  assert.deepEqual(docState('design', src(), facts({ lostTo: 'illustration', owner: 'design' }), null), { t: 'owned-elsewhere', by: 'illustration' });
});

test('missing, locked, changed outside and failed, in that order of precedence', () => {
  assert.deepEqual(docState('design', src(), facts({ missing: true, lockedIn: 'Monolith', paused: true }), 'x'), { t: 'missing' });
  assert.deepEqual(docState('design', src(), facts({ lockedIn: 'Monolith', paused: true }), 'x'), { t: 'locked', collection: 'Monolith' });
  assert.deepEqual(docState('design', src(), facts({ paused: true }), 'x'), { t: 'changed-outside' });
  assert.deepEqual(docState('design', src(), facts(), 'disk full'), { t: 'write-failed', message: 'disk full' });
  assert.deepEqual(docState('design', src(), facts({ owner: 'logo', missing: true }), null), { t: 'owned-elsewhere', by: 'logo' });
});

test('saved, locked, changed-outside and write-failed documents hold their item (the row shows them open)', () => {
  const held: DocState[] = [{ t: 'saved', at: 1, collection: '' }, { t: 'locked', collection: 'M' }, { t: 'changed-outside' }, { t: 'write-failed', message: '' }];
  const detached: DocState[] = [{ t: 'new' }, { t: 'workspace' }, { t: 'owned-elsewhere', by: 'logo' }, { t: 'missing' }];
  for (const s of held) assert.equal(holdsItem(s), true, s.t);
  for (const s of detached) assert.equal(holdsItem(s), false, s.t);
});

const plan = (cause: ChangeCause, source: DocSource, state: DocState, empty = false) => planChange({ cause, kind: 'palette', source, state, empty });
const saved: DocState = { t: 'saved', at: 1, collection: 'Monolith' };

test('restoring never writes', () => {
  for (const state of [saved, { t: 'new' } as DocState, { t: 'missing' } as DocState]) {
    assert.deepEqual(plan('restore', src(), state), { t: 'none' });
    assert.deepEqual(plan('restore', null, state), { t: 'none' });
  }
});

test('a first commit creates Scratch/Untitled <kind>; an empty new document stays in memory', () => {
  assert.deepEqual(plan('commit', null, { t: 'new' }), { t: 'create', name: 'Untitled palette' });
  assert.deepEqual(plan('commit', null, { t: 'new' }, true), { t: 'none' });
  assert.deepEqual(plan('undo', null, { t: 'new' }, true), { t: 'none' });
  // a create that failed before is tried again by the next change
  assert.deepEqual(plan('undo', null, { t: 'write-failed', message: 'x' }), { t: 'create', name: 'Untitled palette' });
  assert.deepEqual(planChange({ cause: 'receive', kind: 'logo', source: null, state: { t: 'new' }, empty: false }), { t: 'create', name: 'Untitled logo' });
});

test('every commit, undo, redo and applied item of an owned item writes it', () => {
  for (const cause of ['commit', 'undo', 'redo', 'receive'] as ChangeCause[]) assert.deepEqual(plan(cause, src(), saved), { t: 'write' }, cause);
  assert.deepEqual(plan('commit', src(), { t: 'write-failed', message: 'x' }), { t: 'write' });
});

test('an edit to a detached document forks; undo and redo only follow it', () => {
  assert.deepEqual(plan('commit', src(), { t: 'owned-elsewhere', by: 'illustration' }), { t: 'fork', name: 'Monolith core', original: true });
  assert.deepEqual(plan('commit', src(), { t: 'locked', collection: 'Monolith' }), { t: 'fork', name: 'Monolith core', original: true });
  assert.deepEqual(plan('receive', src(), { t: 'locked', collection: 'Monolith' }), { t: 'fork', name: 'Monolith core', original: true });
  assert.deepEqual(plan('commit', src(), { t: 'missing' }), { t: 'fork', name: 'Monolith core' });
  for (const state of [{ t: 'owned-elsewhere', by: 'logo' }, { t: 'locked', collection: 'M' }, { t: 'missing' }] as DocState[]) {
    assert.deepEqual(plan('undo', src(), state), { t: 'none' }, state.t);
    assert.deepEqual(plan('redo', src(), state), { t: 'none' }, state.t);
  }
});

test('changed on disk pauses writing', () => {
  for (const cause of ['commit', 'undo', 'redo', 'receive'] as ChangeCause[]) assert.deepEqual(plan(cause, src(), { t: 'changed-outside' }), { t: 'none' });
});

test('sources, stamps and index lookups', () => {
  const r = ref('B', 'Scratch');
  assert.deepEqual(sourceOf(r), { itemId: 'B', kind: 'palette', name: 'B', collection: 'Scratch', stamp: { mtimeMs: 5, size: 7 } });
  assert.deepEqual(sourceOf(r, { mtimeMs: 9, size: 1 }).stamp, { mtimeMs: 9, size: 1 });
  assert.equal(sameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 1, size: 2 }), true);
  assert.equal(sameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 1, size: 3 }), false);
  assert.equal(sameStamp(null, { mtimeMs: 1, size: 2 }), false);
  assert.equal(findRef(index(), 'B')?.collection, 'Scratch');
  assert.equal(findRef(index(), 'Z'), null);
  assert.equal(findRef(null, 'B'), null);
  assert.equal(lockedIn(index(), 'monolith'), 'Monolith');
  assert.equal(lockedIn(index(), 'Scratch'), null);
  assert.equal(lockedIn(index(), 'Gone'), null);
});

test('an edit copy is named "X (edit)", then "X (edit 2)", and never grows a "copy copy"', () => {
  assert.equal(editName('Monolith core', []), 'Monolith core (edit)');
  assert.equal(editName('Monolith core', ['monolith core (EDIT)']), 'Monolith core (edit 2)');
  // a copy of a copy starts from the original's name
  assert.equal(editName('Monolith core (edit)', ['Monolith core (edit)']), 'Monolith core (edit 2)');
  assert.equal(editName('Monolith core (edit 2)', ['Monolith core (edit)', 'Monolith core (edit 2)']), 'Monolith core (edit 3)');
  assert.equal(editName('Monolith core copy copy', []), 'Monolith core (edit)');
});
