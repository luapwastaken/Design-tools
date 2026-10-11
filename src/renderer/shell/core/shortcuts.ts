import { keyName, splitKeys } from '../../ui/keynames.ts';
import type { Shortcut } from '../tool.ts';
import { EVERYWHERE, isLive, keysOf, parseCombo, sameCombo, type Combo } from './keys.ts';

// What the Keyboard shortcuts sheet lists (aw-03). Pure, so it is unit tested
// (test/shell-shortcuts.test.ts). The tool's rows come from its own shortcuts() list, the keys the
// keymap really fires, never from a copy; Everywhere comes from the table beside shellKey.

/**
 * one row: `keys` ('Ctrl+Z'), through `to` when it stands for a run ('1' to '7'), the `also` keys that
 * do the same, the `shown` keys printed beside them that the keymap never matches, the `us` keys only a US layout reaches, and what it does. `when` and `tool` are the
 * quiet tags; `off` dims a row that doesn't apply right now.
 */
export type Row = { keys: string; to?: string; also?: string[]; shown?: string[]; us?: string[]; label: string; when?: string; off?: boolean; tool?: string };
export type Group = { title: string; rows: Row[] };

/** 'Ctrl+Shift+Z' to ['Ctrl', 'Shift', 'Z']: one key cap each, arrows by name and Delete by its short name */
export function keyCaps(keys: string): string[] {
  const c = parseCombo(keys);
  if (!c) return [keys];
  return [...(c.ctrl ? ['Ctrl'] : []), ...(c.alt ? ['Alt'] : []), ...(c.shift ? ['Shift'] : []), keyName(c.key)];
}

/** the shortcuts the keymap would fire: when two live ones share keys the first wins, as it does there; listed-only and off rows shadow nothing */
export function reachable(list: Shortcut[]): Shortcut[] {
  const seen: Combo[] = [];
  return list.filter((s) => {
    if (!isLive(s)) return true;
    const c = parseCombo(s.keys);
    if (c && seen.some((x) => sameCombo(x, c))) return false;
    for (const k of keysOf(s)) {
      const o = parseCombo(k);
      if (o) seen.push(o);
    }
    return true;
  });
}

const rowOf = (s: Shortcut): Row => ({
  keys: s.keys,
  ...(s.also && { also: s.also }),
  ...(s.shown && { shown: s.shown }),
  ...(s.us && { us: s.us }),
  label: s.label,
  ...(s.when && { when: s.when }),
  ...(s.off && { off: true }),
});

const isDigit = (s: Shortcut) => /^\d$/.test(s.keys) && !s.also && !s.us;

/** a run of bare digit keys counting up (a tool's 1 to 7; a lone 0 after them is its own row) is one row: "Role: Background, Surface...", or "Variations: show N larger" when the labels differ only by the digit */
function collapseDigits(list: Shortcut[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < list.length; ) {
    if (!isDigit(list[i])) {
      out.push(rowOf(list[i]));
      i++;
      continue;
    }
    let j = i;
    while (j < list.length && isDigit(list[j]) && (j === i || (Number(list[j].keys) === Number(list[j - 1].keys) + 1 && list[j].off === list[i].off && list[j].when === list[i].when))) j++;
    const run = list.slice(i, j);
    i = j;
    if (run.length === 1) {
      out.push(rowOf(run[0]));
      continue;
    }
    const first = run[0].label;
    const same = run.every((s) => s.label.replaceAll(s.keys, '#') === first.replaceAll(run[0].keys, '#'));
    const colon = first.indexOf(': ');
    const head = colon > 0 ? first.slice(0, colon + 2) : '';
    const label = same ? first.replaceAll(run[0].keys, 'N') : head && run.every((s) => s.label.startsWith(head)) ? head + run.map((s) => s.label.slice(head.length)).join(', ') : run.map((s) => s.label).join(', ');
    out.push({ keys: run[0].keys, to: run.at(-1)!.keys, label, ...(run[0].when && { when: run[0].when }), ...(run[0].off && { off: true }) });
  }
  return out;
}

/**
 * A tool's own keys: under the heading each names (`group`, in the order they first appear), and
 * the rest of them in three groups: its tabs (Alt+N), the single keys, and the keys with Ctrl, Alt
 * or Shift. Listed-only and off rows are in too (the sheet dims the off ones).
 */
export function toolGroups(list: Shortcut[]): Group[] {
  const mine = reachable(list);
  const plain = mine.filter((s) => !s.group);
  const tabs = plain.filter((s) => /^Alt\+\d$/.test(s.keys));
  const rest = plain.filter((s) => !tabs.includes(s));
  const withMod = rest.filter((s) => {
    const c = parseCombo(s.keys);
    return !!c && (c.ctrl || c.alt || c.shift);
  });
  const single = rest.filter((s) => !withMod.includes(s));
  const groups: Group[] = [
    // the tabs first: they are the keys least people know, and on a short window the list scrolls
    { title: 'Tabs', rows: tabs.map(rowOf) },
    { title: 'Single keys', rows: collapseDigits(single) },
    { title: 'With Ctrl, Alt or Shift', rows: withMod.map(rowOf) },
  ];
  const named = [...new Set(mine.flatMap((s) => (s.group ? [s.group] : [])))].map((title) => ({ title, rows: collapseDigits(mine.filter((s) => s.group === title)) }));
  return [...groups, ...named].filter((g) => g.rows.length > 0);
}

/** the keys that work in every tool, in the table's groups, with the tool names from the tools actually registered */
export function appGroups(tools: { label: string; shortcut: number }[]): Group[] {
  const numbered = tools.filter((t) => t.shortcut > 0).sort((a, b) => a.shortcut - b.shortcut);
  const groups: Group[] = [];
  for (const r of EVERYWHERE) {
    let row: Row = { keys: r.keys, ...(r.to && { to: r.to }), ...(r.also && { also: r.also }), ...(r.us && { us: r.us }), label: r.label, ...(r.when && { when: r.when }) };
    if (r.goTo) {
      if (!numbered.length) continue;
      row = { keys: `Ctrl+${numbered[0].shortcut}`, ...(numbered.length > 1 && { to: `Ctrl+${numbered.at(-1)!.shortcut}` }), label: `${r.label}: ${numbered.map((t) => t.label).join(', ')}` };
    }
    const g = groups.find((x) => x.title === r.group);
    if (g) g.rows.push(row);
    else groups.push({ title: r.group, rows: [row] });
  }
  return groups;
}

export const appRows = (tools: { label: string; shortcut: number }[]): Row[] => appGroups(tools).flatMap((g) => g.rows);

/** a query as words: lower case, and '+' counts as a space, so "ctrl+e" finds Ctrl E */
export const queryWords = (q: string): string[] => q.toLowerCase().replaceAll('+', ' ').split(/\s+/).filter(Boolean);

/**
 * every word is in the row's label or `when` tag, or in its keys as typed or as printed. A one-letter
 * word is a key cap only ("ctrl e" finds Ctrl E, not every label with an e in it).
 */
export function rowMatches(r: Row, words: string[]): boolean {
  const caps = [...keysOf(r), ...(r.shown ?? []), ...(r.to ? [r.to] : [])].flatMap((k) => [...keyCaps(k), ...splitKeys(k)]).map((k) => k.toLowerCase());
  const hay = [r.label, r.when ?? '', ...caps].join(' ').toLowerCase();
  return words.every((w) => caps.includes(w) || (w.length > 1 && hay.includes(w)));
}

/** the groups that still have a row after a query; `tool` tags each row with the tool it belongs to */
export function filterGroups(groups: Group[], words: string[], tool?: string): Group[] {
  return groups
    .map((g) => ({ title: g.title, rows: g.rows.filter((r) => rowMatches(r, words)).map((r) => (tool ? { ...r, tool } : r)) }))
    .filter((g) => g.rows.length > 0);
}
