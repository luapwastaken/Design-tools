import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldedTabs } from '../src/renderer/tools/common/tabFit.ts';

const W = [100, 100, 100, 100, 100];
const shown = (gone: boolean[]) => gone.flatMap((g, i) => (g ? [] : [i]));

test('every tab shows when the strip is wide enough for them', () => {
  assert.deepEqual(foldedTabs(W, 0, 5 * 100 + 4 * 4, 80, 4), W.map(() => false));
});

test('short of room the first tabs that fit show beside More, the rest fold', () => {
  // 300 wide, More 80 and a gap: 215 left, two tabs (204) fit
  assert.deepEqual(shown(foldedTabs(W, 0, 300, 80, 4)), [0, 1]);
});

test('the tab you are on always shows, in the place of the last one that fit', () => {
  assert.deepEqual(shown(foldedTabs(W, 4, 300, 80, 4)), [0, 4]);
  assert.deepEqual(shown(foldedTabs(W, 2, 300, 80, 4)), [0, 2]);
});

test('a strip too narrow for any tab still shows the one you are on', () => {
  assert.deepEqual(shown(foldedTabs(W, 3, 60, 80, 4)), [3]);
  assert.deepEqual(shown(foldedTabs(W, -1, 60, 80, 4)), []);
});

test('no tabs fold nothing', () => {
  assert.deepEqual(foldedTabs([], -1, 0, 80, 4), []);
});
