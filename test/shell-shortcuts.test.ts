import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appRows, keyCaps, reachable, toolGroups } from '../src/renderer/shell/core/shortcuts.ts';
import type { Shortcut } from '../src/renderer/shell/tool.ts';

const sc = (keys: string, label: string): Shortcut => ({ keys, label, run: () => {} });

test('keys print as one cap each, with the short names', () => {
  assert.deepEqual(keyCaps('Ctrl+Shift+Z'), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(keyCaps('Alt+ArrowLeft'), ['Alt', 'Left']);
  assert.deepEqual(keyCaps('Delete'), ['Del']);
  assert.deepEqual(keyCaps('Space'), ['Space']);
  assert.deepEqual(keyCaps('Ctrl+,'), ['Ctrl', ',']);
  assert.deepEqual(keyCaps('Ctrl++'), ['Ctrl', '+']);
  assert.deepEqual(keyCaps('Hyper+K'), ['Hyper+K']);
});

test('the list is what the keymap fires: the first of two on the same keys wins', () => {
  const list = [sc('Space', 'Variations: a new set'), sc('Space', 'Reroll'), sc('L', 'Lock'), sc('l', 'Also lock')];
  assert.deepEqual(reachable(list).map((s) => s.label), ['Variations: a new set', 'Lock']);
});

test('a tool lists its keys in groups: single keys, keys with a modifier, tabs', () => {
  const g = toolGroups([sc('Alt+1', 'Contrast'), sc('Alt+2', 'Check palette'), sc('Space', 'Reroll'), sc('Ctrl+D', 'Duplicate'), sc('Alt+ArrowLeft', 'Move left'), sc('L', 'Lock'), sc('Shift+A', 'Add a colour')]);
  assert.deepEqual(g.map((x) => x.title), ['Single keys', 'With Ctrl, Alt or Shift', 'Tabs']);
  assert.deepEqual(g[0].rows.map((r) => r.keys), ['Space', 'L']);
  assert.deepEqual(g[1].rows.map((r) => r.keys), ['Ctrl+D', 'Alt+ArrowLeft', 'Shift+A']);
  assert.deepEqual(g[2].rows.map((r) => [r.keys, r.label]), [['Alt+1', 'Contrast'], ['Alt+2', 'Check palette']]);
  // an empty group is not shown
  assert.deepEqual(toolGroups([sc('G', 'Greyscale')]).map((x) => x.title), ['Single keys']);
  assert.deepEqual(toolGroups([]), []);
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
});

test('the app-wide keys name the tools that are there', () => {
  const rows = appRows([{ label: 'Design', shortcut: 1 }, { label: 'Illustration', shortcut: 2 }, { label: 'Logo', shortcut: 0 }, { label: 'Dither', shortcut: 3 }]);
  assert.deepEqual(rows[0], { keys: 'Ctrl+1', to: 'Ctrl+3', label: 'Go to a tool: Design, Illustration, Dither' });
  for (const k of ['Ctrl+L', 'Ctrl+,', 'Ctrl+Z', 'Ctrl+Y', 'F6', '?', 'F1']) assert.ok(rows.some((r) => r.keys === k), k);
  assert.equal(appRows([])[0].keys, 'Ctrl+L');
});
