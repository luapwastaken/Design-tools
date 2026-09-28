import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readoutOf, when } from '../src/renderer/shell/core/readout.ts';
import type { ToolId } from '../src/shared/types.ts';

const labels: Partial<Record<ToolId, string>> = { illustration: 'Illustration', 'dev-image': 'Dev image' };
const label = (id: ToolId) => labels[id] ?? id;
const at = new Date(2026, 8, 28, 14, 32).getTime();
const later = new Date(2026, 8, 28, 18, 5).getTime();

test('saved: the time today, the date on another day, then the collection', () => {
  assert.deepEqual(readoutOf({ t: 'saved', at, collection: 'Scratch' }, label, later), { text: 'SAVED 14:32 · SCRATCH', tone: 'normal', actions: [] });
  assert.equal(readoutOf({ t: 'saved', at, collection: '' }, label, later).text, 'SAVED 14:32 · LIBRARY ROOT');
  assert.equal(readoutOf({ t: 'saved', at, collection: 'Monolith' }, label, new Date(2026, 8, 30).getTime()).text, 'SAVED 28 SEP · MONOLITH');
  assert.equal(when(new Date(2026, 0, 3, 9, 7).getTime(), new Date(2026, 0, 3, 23).getTime()), '09:07');
});

test('the detached states, with what each offers (spec §7.3)', () => {
  assert.deepEqual(readoutOf({ t: 'owned-elsewhere', by: 'illustration' }, label, later), { text: 'OPEN IN ILLUSTRATION', tone: 'warn', actions: ['take-back'] });
  assert.deepEqual(readoutOf({ t: 'locked', collection: 'Monolith' }, label, later), { text: 'LOCKED · MONOLITH', tone: 'normal', actions: [] });
  assert.deepEqual(readoutOf({ t: 'missing' }, label, later), { text: 'NOT IN LIBRARY', tone: 'warn', actions: [] });
  assert.deepEqual(readoutOf({ t: 'changed-outside' }, label, later), { text: 'CHANGED ON DISK', tone: 'warn', actions: ['reload', 'keep-copy'] });
});

test('image tools, new documents, failures and no state', () => {
  assert.equal(readoutOf({ t: 'workspace' }, label, later).text, 'WORKSPACE');
  assert.equal(readoutOf({ t: 'new' }, label, later).text, 'NEW');
  assert.deepEqual(readoutOf({ t: 'write-failed', message: 'Disk full' }, label, later), { text: 'NOT SAVED', tone: 'danger', actions: ['retry'] });
  assert.deepEqual(readoutOf(undefined, label, later), { text: '', tone: 'normal', actions: [] });
});
