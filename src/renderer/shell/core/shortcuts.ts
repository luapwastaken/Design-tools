import type { Shortcut } from '../tool.ts';
import { parseCombo, sameCombo, type Combo } from './keys.ts';

// What the Keyboard shortcuts sheet lists (aw-03). Pure, so it is unit tested
// (test/shell-shortcuts.test.ts). The tool's rows come from its own shortcuts() list, the keys the
// keymap really fires, never from a copy.

/** one row: `keys` ('Ctrl+Z'), through `to` when it stands for a run ('1' to '7'), and what it does */
export type Row = { keys: string; to?: string; label: string };
export type Group = { title: string; rows: Row[] };

const NAMES: Record<string, string> = { ARROWLEFT: 'Left', ARROWRIGHT: 'Right', ARROWUP: 'Up', ARROWDOWN: 'Down', DELETE: 'Del', ESCAPE: 'Esc', SPACE: 'Space' };

/** 'Ctrl+Shift+Z' to ['Ctrl', 'Shift', 'Z']: one key cap each, arrows and Delete by their short names */
export function keyCaps(keys: string): string[] {
  const c = parseCombo(keys);
  if (!c) return [keys];
  return [...(c.ctrl ? ['Ctrl'] : []), ...(c.alt ? ['Alt'] : []), ...(c.shift ? ['Shift'] : []), NAMES[c.key] ?? c.key];
}

/** the shortcuts the keymap would fire: when two share keys the first wins, as it does there */
export function reachable(list: Shortcut[]): Shortcut[] {
  const seen: Combo[] = [];
  return list.filter((s) => {
    const c = parseCombo(s.keys);
    if (!c) return true;
    if (seen.some((x) => sameCombo(x, c))) return false;
    seen.push(c);
    return true;
  });
}

const isDigit = (keys: string) => /^\d$/.test(keys);

/** a run of bare digit keys counting up (a tool's 1 to 7; a lone 0 after them is its own row) is one row: "Role: Background, Surface...", or "Variations: show N larger" when the labels differ only by the digit */
function collapseDigits(list: Shortcut[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < list.length; ) {
    if (!isDigit(list[i].keys)) {
      out.push({ keys: list[i].keys, label: list[i].label });
      i++;
      continue;
    }
    let j = i;
    while (j < list.length && isDigit(list[j].keys) && (j === i || Number(list[j].keys) === Number(list[j - 1].keys) + 1)) j++;
    const run = list.slice(i, j);
    i = j;
    if (run.length === 1) {
      out.push({ keys: run[0].keys, label: run[0].label });
      continue;
    }
    const first = run[0].label;
    const same = run.every((s) => s.label.replaceAll(s.keys, '#') === first.replaceAll(run[0].keys, '#'));
    const colon = first.indexOf(': ');
    const head = colon > 0 ? first.slice(0, colon + 2) : '';
    const label = same ? first.replaceAll(run[0].keys, 'N') : head && run.every((s) => s.label.startsWith(head)) ? head + run.map((s) => s.label.slice(head.length)).join(', ') : run.map((s) => s.label).join(', ');
    out.push({ keys: run[0].keys, to: run.at(-1)!.keys, label });
  }
  return out;
}

/** a tool's own keys in three groups: its tabs (Alt+N), the single keys, and the keys with Ctrl, Alt or Shift */
export function toolGroups(list: Shortcut[]): Group[] {
  const mine = reachable(list);
  const tabs = mine.filter((s) => /^Alt\+\d$/.test(s.keys));
  const rest = mine.filter((s) => !tabs.includes(s));
  const withMod = rest.filter((s) => {
    const c = parseCombo(s.keys);
    return !!c && (c.ctrl || c.alt || c.shift);
  });
  const single = rest.filter((s) => !withMod.includes(s));
  const groups: Group[] = [
    // the tabs first: they are the keys least people know, and on a short window the list scrolls
    { title: 'Tabs', rows: tabs.map((s) => ({ keys: s.keys, label: s.label })) },
    { title: 'Single keys', rows: collapseDigits(single) },
    { title: 'With Ctrl, Alt or Shift', rows: withMod.map((s) => ({ keys: s.keys, label: s.label })) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** the keys that work in every tool, from the tools actually registered */
export function appRows(tools: { label: string; shortcut: number }[]): Row[] {
  const numbered = tools.filter((t) => t.shortcut > 0).sort((a, b) => a.shortcut - b.shortcut);
  return [
    ...(numbered.length
      ? [{ keys: `Ctrl+${numbered[0].shortcut}`, ...(numbered.length > 1 && { to: `Ctrl+${numbered.at(-1)!.shortcut}` }), label: `Go to a tool: ${numbered.map((t) => t.label).join(', ')}` }]
      : []),
    { keys: 'Ctrl+L', label: 'Show or hide the Library' },
    { keys: 'Ctrl+,', label: 'Open or close Settings' },
    { keys: 'Ctrl+Z', label: 'Undo' },
    { keys: 'Ctrl+Y', label: 'Redo' },
    { keys: 'Ctrl+Shift+Z', label: 'Redo' },
    { keys: 'F6', label: 'Move to the next area' },
    { keys: 'Shift+F6', label: 'Move to the previous area' },
    { keys: '?', label: 'This sheet' },
    { keys: 'F1', label: 'This sheet, even while typing' },
  ];
}
