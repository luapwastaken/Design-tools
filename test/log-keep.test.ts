import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staleLogs } from '../src/main/log-keep.ts';

test('logs older than the days kept are the stale ones; anything else is left alone', () => {
  const now = new Date(2026, 9, 3, 15, 30); // 3 October 2026
  const names = ['2026-10-03.log', '2026-09-19.log', '2026-09-18.log', '2026-01-01.log', 'crash.txt', '2026-09-18.log.old', 'notes.log'];
  assert.deepEqual(staleLogs(names, now, 14), ['2026-09-18.log', '2026-01-01.log']);
  assert.deepEqual(staleLogs(names, now, 400), []);
});
