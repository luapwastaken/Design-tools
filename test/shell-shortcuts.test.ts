import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appGroups, appRows, filterGroups, keyCaps, queryWords, reachable, toolGroups } from '../src/renderer/shell/core/shortcuts.ts';
import { formatKeys } from '../src/renderer/ui/keynames.ts';
import type { Shortcut } from '../src/renderer/shell/tool.ts';

const sc = (keys: string, label: string, more: Partial<Shortcut> = {}): Shortcut => ({ keys, label, run: () => {}, ...more });

test('keys print as one cap each, with the short names', () => {
  assert.deepEqual(keyCaps('Ctrl+Shift+Z'), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(keyCaps('Alt+ArrowLeft'), ['Alt', 'Left']);
  assert.deepEqual(keyCaps('ArrowDown'), ['Down']);
  assert.deepEqual(keyCaps('Delete'), ['Del']);
  assert.deepEqual(keyCaps('Escape'), ['Esc']);
  assert.deepEqual(keyCaps('Space'), ['Space']);
  assert.deepEqual(keyCaps('Ctrl+,'), ['Ctrl', ',']);
  assert.deepEqual(keyCaps('Ctrl++'), ['Ctrl', '+']);
  assert.deepEqual(keyCaps('\\'), ['\\']);
  assert.deepEqual(keyCaps('Shift+['), ['Shift', '[']);
  assert.deepEqual(keyCaps('Hyper+K'), ['Hyper+K']);
});

test('formatKeys prints arrows by name and keeps a plus key readable', () => {
  assert.equal(formatKeys('Ctrl+Shift+Z'), 'Ctrl Shift Z');
  assert.equal(formatKeys('Shift+ArrowLeft'), 'Shift Left');
  assert.equal(formatKeys('Delete'), 'Del');
  assert.equal(formatKeys('Ctrl++'), 'Ctrl +');
  assert.equal(formatKeys('Ctrl+,'), 'Ctrl ,');
  assert.equal(formatKeys('\\'), '\\');
});

test('the list is what the keymap fires: the first of two on the same keys wins', () => {
  const list = [sc('Space', 'Variations: a new set'), sc('Space', 'Reroll'), sc('L', 'Lock'), sc('l', 'Also lock')];
  assert.deepEqual(reachable(list).map((s) => s.label), ['Variations: a new set', 'Lock']);
});

test('listed-only and off rows never shadow a live one, and stay listed', () => {
  const list = [sc('S', 'Smudge', { off: true }), sc('S', 'Other colours'), sc('Space', 'Play, by a tap', { run: undefined }), sc('Space', 'Reroll'), sc('K', 'Play'), sc('K', 'Twice')];
  assert.deepEqual(reachable(list).map((s) => s.label), ['Smudge', 'Other colours', 'Play, by a tap', 'Reroll', 'Play']);
  // a live row's other keys count as taken: Backspace is Delete's, and a US backslash is Y's
  assert.deepEqual(reachable([sc('Delete', 'Delete', { also: ['Backspace'] }), sc('Backspace', 'Back'), sc('Y', 'Original', { us: ['\\'] }), sc('\\', 'Other')]).map((s) => s.label), ['Delete', 'Original']);
});

test('a tool lists its keys in groups: single keys, keys with a modifier, tabs', () => {
  const g = toolGroups([sc('Alt+1', 'Contrast'), sc('Alt+2', 'Check palette'), sc('Space', 'Reroll'), sc('Ctrl+D', 'Duplicate'), sc('Alt+ArrowLeft', 'Move left'), sc('L', 'Lock'), sc('Shift+A', 'Add a colour')]);
  assert.deepEqual(g.map((x) => x.title), ['Tabs', 'Single keys', 'With Ctrl, Alt or Shift']);
  assert.deepEqual(g[0].rows.map((r) => [r.keys, r.label]), [['Alt+1', 'Contrast'], ['Alt+2', 'Check palette']]);
  assert.deepEqual(g[1].rows.map((r) => r.keys), ['Space', 'L']);
  assert.deepEqual(g[2].rows.map((r) => r.keys), ['Ctrl+D', 'Alt+ArrowLeft', 'Shift+A']);
  // an empty group is not shown
  assert.deepEqual(toolGroups([sc('G', 'Greyscale')]).map((x) => x.title), ['Single keys']);
  assert.deepEqual(toolGroups([]), []);
});

test('rows go under the group they name, in the order they first appear, after the three by kind', () => {
  const g = toolGroups([sc('G', 'Greyscale'), sc('Up', 'Previous ramp', { group: 'Ramps' }), sc('Ctrl+Shift+C', 'Copy every colour', { group: 'Copy and export' }), sc('Down', 'Next ramp', { group: 'Ramps' })]);
  assert.deepEqual(g.map((x) => x.title), ['Single keys', 'Ramps', 'Copy and export']);
  assert.deepEqual(g[1].rows.map((r) => r.label), ['Previous ramp', 'Next ramp']);
  // nothing ungrouped: only the named groups
  assert.deepEqual(toolGroups([sc('A', 'Keep', { group: 'Proposals' })]).map((x) => x.title), ['Proposals']);
});

test('a row carries its also, us, when and off', () => {
  const [g] = toolGroups([sc('Delete', 'Delete the colour', { also: ['Backspace'], when: 'Paint tab', off: true }), sc('Y', 'Original', { us: ['\\'], run: undefined })]);
  assert.deepEqual(g.rows, [
    { keys: 'Delete', also: ['Backspace'], label: 'Delete the colour', when: 'Paint tab', off: true },
    { keys: 'Y', us: ['\\'], label: 'Original' },
  ]);
});

test('a run of digit keys is one row', () => {
  const roles = ['Background', 'Surface', 'Text'].map((r, i) => sc(String(i + 1), `Role: ${r}`));
  assert.deepEqual(toolGroups([sc('G', 'Greyscale'), ...roles, sc('0', 'Clear the role')])[0].rows, [
    { keys: 'G', label: 'Greyscale' },
    { keys: '1', to: '3', label: 'Role: Background, Surface, Text' },
    { keys: '0', label: 'Clear the role' },
  ]);
  // labels that differ only by their digit say it once
  const cells = [1, 2, 3].map((n) => sc(String(n), `Variations: show ${n} larger`));
  assert.deepEqual(toolGroups(cells)[0].rows, [{ keys: '1', to: '3', label: 'Variations: show N larger' }]);
  // a lone digit stays as it is
  assert.deepEqual(toolGroups([sc('5', 'Five')])[0].rows, [{ keys: '5', label: 'Five' }]);
  // digits that are on and off do not run together
  assert.deepEqual(toolGroups([sc('1', 'Plate 1'), sc('2', 'Plate 2', { off: true })])[0].rows.map((r) => r.keys), ['1', '2']);
});

test('the app-wide keys name the tools that are there, from the table', () => {
  const rows = appRows([{ label: 'Design', shortcut: 1 }, { label: 'Illustration', shortcut: 2 }, { label: 'Logo', shortcut: 0 }, { label: 'Dither', shortcut: 3 }]);
  assert.deepEqual(rows[0], { keys: 'Ctrl+1', to: 'Ctrl+3', label: 'Go to a tool: Design, Illustration, Dither' });
  for (const k of ['Ctrl+L', 'Ctrl+F', 'Ctrl+E', 'Ctrl+,', 'Escape', 'Ctrl+Z', 'Ctrl+Y', 'F6', 'Shift+F6', '?', 'Ctrl+0', 'Shift+0', 'Space', 'F2']) assert.ok(rows.some((r) => r.keys === k), k);
  assert.deepEqual(rows.find((r) => r.keys === 'Shift+0')?.us, ['Ctrl+Alt+0']);
  assert.deepEqual(rows.find((r) => r.keys === '?')?.also, ['F1']);
  assert.equal(rows.find((r) => r.keys === 'Delete')?.when, 'Library row focused');
  assert.equal(appRows([])[0].keys, 'Ctrl+L');
  assert.deepEqual(appGroups([]).map((g) => g.title), ['Tools and panels', 'Copy and export', 'Undo', 'Zoom and pan', 'Library']);
});

test('a search looks at every tool: words match label, keys and when, and + counts as a space', () => {
  assert.deepEqual(queryWords(' Ctrl+E '), ['ctrl', 'e']);
  assert.deepEqual(queryWords('+'), []);
  const design = toolGroups([sc('Ctrl+Shift+C', 'Copy every colour', { group: 'Copy and export' }), sc('G', 'Show or hide greyscale'), sc('Alt+1', 'Contrast', { when: 'Contrast tab' })]);
  const dither = toolGroups([sc('Ctrl+Shift+C', 'Copy the PNG'), sc('K', 'Play or pause', { also: ['Space'] }), sc('ArrowLeft', 'Previous frame', { when: 'animated' })]);
  const hits = (q: string) => [['Design', design], ['Dither', dither]].flatMap(([tool, groups]) => filterGroups(groups as typeof design, queryWords(q), tool as string)).flatMap((g) => g.rows.map((r) => `${r.tool}: ${r.label}`));
  assert.deepEqual(hits('copy'), ['Design: Copy every colour', 'Dither: Copy the PNG']);
  assert.deepEqual(hits('ctrl+shift+c'), ['Design: Copy every colour', 'Dither: Copy the PNG']);
  assert.deepEqual(hits('shift c'), ['Design: Copy every colour', 'Dither: Copy the PNG']);
  assert.deepEqual(hits('space'), ['Dither: Play or pause']); // an also key
  assert.deepEqual(hits('animated'), ['Dither: Previous frame']); // the when tag
  assert.deepEqual(hits('contrast'), ['Design: Contrast']);
  assert.deepEqual(hits('left'), ['Dither: Previous frame']); // the key by its name
  assert.deepEqual(hits('nothing like this'), []);
  // Everywhere answers the same query
  const every = (q: string) => filterGroups(appGroups([{ label: 'Design', shortcut: 1 }]), queryWords(q)).flatMap((g) => g.rows.map((r) => r.keys));
  assert.deepEqual(every('export'), ['Ctrl+E']);
  assert.deepEqual(every('ctrl+e'), ['Ctrl+E']);
  assert.ok(every('zoom').includes('Shift+0'));
});
