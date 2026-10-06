import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, hexToOklch, type Oklch } from '../src/shared/color/index.ts';
import type { Swatch } from '../src/shared/types.ts';
import { badgeFor, inkOn, simulated, suggestRoles } from '../src/renderer/tools/design/artboard.ts';

const sw = (id: string, hex: string, role: string | null = null): Swatch => ({ id, name: id, role, oklch: hexToOklch(hex), type: 'process' });

test('inkOn picks the ink that reads on the colour', () => {
  const on = (hex: string) => inkOn(hexToOklch(hex));
  assert.notEqual(on('#ffffff'), on('#000000'));
  assert.equal(on('#f3ecdf'), on('#ffffff'));
  assert.equal(on('#221d1a'), on('#000000'));
});

test('simulated leaves normal alone and moves colour for a deficiency (greyscale is the app-wide view, not a simulation)', () => {
  const red: Oklch = hexToOklch('#cc3322');
  assert.equal(simulated(red, 'normal'), red);
  assert.notDeepEqual(simulated(red, 'deutan'), red);
});

test('a badge pairs an ink with the Background and a ground with the Text', () => {
  const list = [sw('bg', '#f3ecdf', 'Background'), sw('tx', '#221d1a', 'Text'), sw('pr', '#b8482b', 'Primary')];
  const pr = badgeFor(list[2], list)!;
  assert.equal(pr.other.id, 'bg');
  assert.equal(pr.guessed, false);
  assert.ok(Math.abs(pr.ratio - contrast(list[2].oklch, list[0].oklch)) < 1e-9);
  assert.equal(badgeFor(list[0], list)!.other.id, 'tx');
});

test('with no roles the lightest and darkest stand in, and the badge says it guessed', () => {
  const list = [sw('a', '#f3ecdf'), sw('b', '#7a6b54'), sw('c', '#221d1a')];
  const mid = badgeFor(list[1], list)!;
  assert.equal(mid.guessed, true);
  assert.ok(['a', 'c'].includes(mid.other.id));
  assert.equal(badgeFor(list[0], [list[0]]), null, 'a palette of one has nothing to compare with');
});

test('a Primary fill passes at 3:1 where body text needs 4.5:1', () => {
  const list = [sw('bg', '#ffffff', 'Background'), sw('pr', '#8a8a8a', 'Primary'), sw('tx', '#8a8a8a', 'Text')];
  const fill = badgeFor(list[1], list)!;
  const text = badgeFor(list[2], list)!;
  assert.ok(fill.ratio > 3 && fill.ratio < 4.5);
  assert.equal(fill.ok, true);
  assert.equal(text.ok, false);
});

test('suggestRoles gives the lightest Background and the darkest Text, then the most colourful', () => {
  const list: Oklch[] = [[0.2, 0.01, 60], [0.55, 0.15, 30], [0.6, 0.1, 140], [0.95, 0.01, 90]];
  const roles = suggestRoles(list);
  assert.deepEqual(roles, ['Text', 'Primary', 'Accent', 'Background']);
});

test('suggestRoles leaves a held role and a skipped slot alone', () => {
  const list: Oklch[] = [[0.2, 0.01, 60], [0.55, 0.15, 30], [0.95, 0.01, 90]];
  assert.deepEqual(suggestRoles(list, new Set(['Background'])), ['Text', 'Primary', null]);
  assert.deepEqual(suggestRoles(list, new Set(), new Set([2])), ['Text', 'Background', null]);
});

test('suggestRoles: Background is the lightest quiet colour, never a vivid one', () => {
  const list: Oklch[] = [[0.2, 0.01, 60], [0.97, 0.12, 100], [0.9, 0.01, 90], [0.55, 0.15, 30]];
  assert.deepEqual(suggestRoles(list), ['Text', 'Accent', 'Background', 'Primary']);
});

test('suggestRoles: Primary is the most vivid colour with a real share of the picture, not a speck', () => {
  // a photo: a big grey, a big sky, a little red that is the most vivid but is 2% of the pixels
  const list: Oklch[] = [[0.9, 0.01, 90], [0.3, 0.01, 60], [0.6, 0.1, 240], [0.55, 0.22, 25]];
  const shares = [0.4, 0.3, 0.28, 0.02];
  assert.deepEqual(suggestRoles(list, new Set(), new Set(), shares), ['Background', 'Text', 'Primary', 'Accent']);
  assert.deepEqual(suggestRoles(list), ['Background', 'Text', 'Accent', 'Primary'], 'without shares the most vivid wins');
});

test('suggestRoles never takes a role the palette uses', () => {
  const list: Oklch[] = [[0.9, 0.01, 90], [0.3, 0.01, 60], [0.6, 0.1, 240]];
  assert.deepEqual(suggestRoles(list, new Set(['Primary', 'Text'])), ['Background', null, 'Accent']);
});
