import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Shortcut } from '../src/renderer/shell/tool.ts';
import type { Doc } from '../src/renderer/tools/logo/actions.ts';
import { fix } from '../src/renderer/tools/logo/doc.ts';
import { logoShortcuts, type Io } from '../src/renderer/tools/logo/keys.ts';
import type { LogoView } from '../src/renderer/tools/logo/view-state.ts';
import { doc, icon, lockup } from './logo-fixtures.ts';

// view-state.ts reaches the shell, which node can't load: only the fields the keys read
const DEFAULT_VIEW = { mode: 'edit', clearspace: true, guides: false } as LogoView;

const live = (s: Shortcut) => !!s.run && !s.off;
const keysOf = (s: Shortcut) => [s.keys, ...(s.also ?? []), ...(s.us ?? [])];

function rig(d = fix(doc()), free = true, view: LogoView = DEFAULT_VIEW) {
  const calls: string[] = [];
  let v = view;
  const io: Io = {
    newLogo: () => void calls.push('new'),
    step: (_, by) => void calls.push(`step ${by}`),
    stepVersion: (by) => void calls.push(`version ${by}`),
    copySvg: () => void calls.push('copy'),
    view: () => v,
    patch: (p) => void ((v = { ...v, ...p }), calls.push(`patch ${Object.keys(p)}`)),
    arrowsFree: () => free,
  };
  const list = logoShortcuts({ get: () => d } as Doc, io);
  const row = (k: string) => list.find((s) => s.keys === k)!;
  return { list, row, calls, view: () => v };
}

const states: [string, Parameters<typeof rig>][] = [
  ['full pair', [fix(doc())]],
  ['empty', [fix(doc({ icon: null, wordmark: null }))]],
  ['icon only', [fix(doc({ wordmark: null }))]],
  ['all lockups off', [fix(doc({ lockups: [lockup('horizontal', { on: false })] }))]],
  ['sheet mode', [fix(doc()), true, { ...DEFAULT_VIEW, mode: 'sheet' }]],
  ['focus in a panel', [fix(doc()), false]],
];

test('no two live entries share a combo, in any state', () => {
  for (const [name, args] of states) {
    const seen = new Set<string>();
    for (const s of rig(...args).list.filter(live)) {
      for (const k of keysOf(s)) {
        assert.ok(!seen.has(k.toUpperCase()), `${name}: ${k} twice`);
        seen.add(k.toUpperCase());
      }
    }
  }
});

test('every row has a group; Ctrl+V is listed only; the shell\'s Ctrl+E is not repeated', () => {
  const { list, row } = rig();
  assert.ok(list.every((s) => s.group));
  assert.equal(row('Ctrl+V').run, undefined);
  assert.ok(!list.some((s) => s.keys === 'Ctrl+E' || s.keys === 'Space' || s.keys === 'Ctrl+C'));
  assert.ok(list.every((s) => !keysOf(s).some((k) => /[\[\]{}\\]/.test(k))));
});

test('the keys call the right actions', () => {
  const r = rig();
  for (const k of ['Ctrl+N', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Ctrl+Shift+C']) r.row(k).run!();
  assert.deepEqual(r.calls, ['new', 'step -1', 'step 1', 'version -1', 'version 1', 'copy']);
  r.row('Alt+2').run!();
  assert.equal(r.view().mode, 'sheet');
  r.row('Alt+1').run!();
  assert.equal(r.view().mode, 'edit');
  r.row('C').run!();
  r.row('G').run!();
  assert.equal(r.view().clearspace, !DEFAULT_VIEW.clearspace);
  assert.equal(r.view().guides, !DEFAULT_VIEW.guides);
});

test('rows that cannot work now stay in the list but are off', () => {
  const empty = rig(fix(doc({ icon: null, wordmark: null })));
  for (const k of ['ArrowUp', 'ArrowDown', 'Alt+1', 'Alt+2', 'Ctrl+Shift+C']) assert.ok(empty.row(k).off, `${k} off when empty`);
  assert.ok(live(empty.row('Ctrl+N')));
  const panel = rig(fix(doc()), false);
  assert.ok(panel.row('ArrowUp').off && panel.row('ArrowDown').off);
  assert.ok(live(panel.row('ArrowLeft')));
  assert.ok(rig(fix(doc({ lockups: [lockup('horizontal', { on: false })] }))).row('Ctrl+Shift+C').off);
  const one = rig(fix(doc({ wordmark: null, icon: icon() })));
  assert.ok(live(one.row('Ctrl+Shift+C')));
});
