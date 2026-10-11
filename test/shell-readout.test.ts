import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_LABELS, readoutOf, when } from '../src/renderer/shell/core/readout.ts';
import type { ToolId } from '../src/shared/types.ts';

const labels: Partial<Record<ToolId, string>> = { illustration: 'Illustration', dither: 'Dither' };
const label = (id: ToolId) => labels[id] ?? id;
const at = new Date(2026, 8, 28, 14, 32).getTime();
const later = new Date(2026, 8, 28, 18, 5).getTime();

test('saved: the time today, the date on another day, then the collection', () => {
  assert.deepEqual(readoutOf({ t: 'saved', at, collection: 'Scratch' }, label, later), { text: 'Scratch · saved 14:32', tone: 'normal', actions: [] });
  assert.equal(readoutOf({ t: 'saved', at, collection: '' }, label, later).text, 'Library · saved 14:32');
  assert.equal(readoutOf({ t: 'saved', at, collection: 'Monolith' }, label, new Date(2026, 8, 30).getTime()).text, 'Monolith · saved 28 Sep');
  assert.equal(when(new Date(2026, 0, 3, 9, 7).getTime(), new Date(2026, 0, 3, 23).getTime()), '09:07');
});

test('the detached states, with what each offers (spec §7.3)', () => {
  assert.deepEqual(readoutOf({ t: 'owned-elsewhere', by: 'illustration' }, label, later), { text: 'Open in Illustration', tone: 'warn', actions: ['take-back'] });
  assert.deepEqual(readoutOf({ t: 'locked', collection: 'Monolith' }, label, later), { text: 'Monolith · locked', tone: 'normal', actions: [] });
  assert.deepEqual(readoutOf({ t: 'missing' }, label, later), { text: 'Not in Library', tone: 'warn', actions: [] });
  assert.deepEqual(readoutOf({ t: 'changed-outside' }, label, later), { text: 'Changed on disk', tone: 'warn', actions: ['reload', 'keep-copy'] });
});

test('image tools, new documents, failures and no state', () => {
  assert.equal(readoutOf({ t: 'workspace' }, label, later).text, 'Workspace');
  assert.equal(readoutOf({ t: 'new' }, label, later).text, 'Not saved yet');
  assert.deepEqual(readoutOf({ t: 'write-failed', message: 'Disk full' }, label, later), { text: 'Not saved', tone: 'danger', actions: ['retry'] });
  assert.deepEqual(readoutOf(undefined, label, later), { text: '', tone: 'normal', actions: [] });
});

test('the action that gets a document back says so in plain words', () => {
  assert.equal(ACTION_LABELS['take-back'], 'Open it here');
});
