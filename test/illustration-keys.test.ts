import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLive, keysOf, matches, parseCombo, sameCombo, type Combo } from '../src/renderer/shell/core/keys.ts';
import { toolGroups } from '../src/renderer/shell/core/shortcuts.ts';
import { illustrationKeys, type KeyActs, type KeyState } from '../src/renderer/tools/illustration/keys.ts';
import { stepLoad, stepSize } from '../src/renderer/tools/illustration/paint-sources.ts';

const base: KeyState = { tab: 'settings', swatches: true, ramps: true, ramp: true, swapOpen: false, cells: 0, cellOpen: false, onControl: false, proposals: false, copyOff: false, arrowsFree: true };
/** every action records its name and arguments */
const calls: string[] = [];
const acts = new Proxy({}, { get: (_, name: string) => (...a: unknown[]) => void calls.push(`${name}(${a.join(',')})`) }) as KeyActs;
const list = (s: Partial<KeyState> = {}) => illustrationKeys({ ...base, ...s }, acts);
type List = ReturnType<typeof list>;

const VAR = { tab: 'variations', cells: 6 };
/** the states a person can reach */
const STATES: Record<string, Partial<KeyState>> = {
  settings: {},
  paint: { tab: 'paint' },
  light: { tab: 'light' },
  variations: VAR,
  'variations, one open': { ...VAR, cellOpen: true },
  'variations, open and focus on a button': { ...VAR, cellOpen: true, onControl: true },
  'variations, open and the other-colours row open': { ...VAR, cellOpen: true, swapOpen: true },
  layers: { tab: 'layers' },
  proposals: { proposals: true },
  'proposals and the other-colours row': { proposals: true, swapOpen: true },
  'proposals on Variations, one open': { ...VAR, proposals: true, cellOpen: true },
  'proposals on Paint': { proposals: true, tab: 'paint' },
  'text selected': { copyOff: true },
  'focus in an inspector': { arrowsFree: false },
  'no colour': { swatches: false, ramps: false, ramp: false },
  'colours but no ramp': { ramp: false, ramps: false },
};

const live = (l: List) => l.filter(isLive);
const hit = (l: List, combo: Combo) => live(l).find((s) => keysOf(s).some((k) => matches(k, combo)));
const press = (l: List, keys: string) => {
  calls.length = 0;
  const s = hit(l, parseCombo(keys)!);
  s?.run!();
  return s;
};

test('no two live rows share a combo, in any state', () => {
  for (const [name, st] of Object.entries(STATES)) {
    const seen: { c: Combo; label: string }[] = [];
    for (const s of live(list(st))) {
      for (const k of keysOf(s)) {
        const c = parseCombo(k);
        assert.ok(c, `${k} parses`);
        const twin = seen.find((x) => sameCombo(x.c, c!));
        assert.ok(!twin, `${name}: ${k} is both "${twin?.label}" and "${s.label}"`);
        seen.push({ c: c!, label: s.label });
      }
    }
  }
});

test('every row has a group, and the groups are the five', () => {
  const l = list();
  assert.ok(l.every((s) => s.group));
  assert.deepEqual(toolGroups(l).map((g) => g.title), ['Ramps', 'View', 'Paint', 'Variations and Layers', 'Copy and export']);
});

test('the same rows are in the list in every state; only off changes', () => {
  const keys = (l: List) => l.map((s) => `${s.keys}|${s.label}`).join('\n');
  const first = keys(list());
  for (const st of Object.values(STATES)) assert.equal(keys(list(st)), first);
});

test('S is Smudge on the Paint tab and the other colours elsewhere, never both', () => {
  press(list({ tab: 'paint' }), 'S');
  assert.deepEqual(calls, ['paintTool(smudge)']);
  press(list(), 'S');
  assert.deepEqual(calls, ['swap()']);
  press(list({ tab: 'layers' }), 'S');
  assert.deepEqual(calls, ['swap()']);
  assert.equal(press(list({ ramp: false }), 'S'), undefined);
});

test('I picks from the screen, or from the paper on Paint', () => {
  press(list(), 'I');
  assert.deepEqual(calls, ['eyedrop()']);
  press(list({ tab: 'paint' }), 'I');
  assert.deepEqual(calls, ['paintTool(pick)']);
});

test('Up and Down step ramps, but not with focus in an inspector; Alt+Up and Alt+Down move the ramp', () => {
  press(list(), 'ArrowUp');
  assert.deepEqual(calls, ['step(0,-1)']);
  press(list(), 'ArrowDown');
  assert.deepEqual(calls, ['step(0,1)']);
  assert.equal(press(list({ arrowsFree: false }), 'ArrowDown'), undefined);
  press(list({ arrowsFree: false }), 'Alt+ArrowUp');
  assert.deepEqual(calls, ['moveRamp(-1)']);
  press(list(), 'Alt+ArrowDown');
  assert.deepEqual(calls, ['moveRamp(1)']);
  assert.equal(press(list({ ramp: false }), 'Alt+ArrowUp'), undefined);
});

test('Left and Right step along a ramp, and belong to the open Variations palette while one is open', () => {
  press(list(), 'ArrowLeft');
  assert.deepEqual(calls, ['step(-1,0)']);
  press(list({ ...VAR, cellOpen: true }), 'ArrowRight');
  assert.deepEqual(calls, ['cellStep(1)']);
});

test('A keeps and Esc discards proposals, after the other-colours row and the open palette', () => {
  assert.equal(press(list(), 'A'), undefined);
  press(list({ proposals: true }), 'A');
  assert.deepEqual(calls, ['keepAll()']);
  press(list({ proposals: true }), 'Escape');
  assert.deepEqual(calls, ['discard()']);
  press(list({ proposals: true, swapOpen: true }), 'Escape');
  assert.deepEqual(calls, ['closeSwap()']);
  press(list({ ...VAR, proposals: true, cellOpen: true }), 'Escape');
  assert.deepEqual(calls, ['closeCell()']);
  press(list({ ...VAR, proposals: true, cellOpen: true, swapOpen: true }), 'Escape');
  assert.deepEqual(calls, ['closeSwap()']);
});

test('Delete and Backspace both delete the ramp', () => {
  press(list(), 'Delete');
  assert.deepEqual(calls, ['arm()']);
  press(list(), 'Backspace');
  assert.deepEqual(calls, ['arm()']);
});

test('C and Ctrl+C copy the ramp, but Ctrl+C leaves selected text alone; Ctrl+Shift+C copies everything', () => {
  press(list(), 'C');
  assert.deepEqual(calls, ['copyRamp()']);
  press(list(), 'Ctrl+C');
  assert.deepEqual(calls, ['copyRamp()']);
  assert.equal(press(list({ copyOff: true }), 'Ctrl+C'), undefined);
  press(list(), 'Ctrl+Shift+C');
  assert.deepEqual(calls, ['copyAll()']);
  assert.equal(press(list({ swatches: false, ramp: false }), 'Ctrl+Shift+C'), undefined);
});

test('brush size and load: , . by position, [ ] on a US keyboard, Paint tab only; the AltGr keys are gone', () => {
  const l = list({ tab: 'paint' });
  const cases = [[',', 'size(-1)'], ['.', 'size(1)'], ['[', 'size(-1)'], [']', 'size(1)'], ['Shift+,', 'load(-1)'], ['Shift+.', 'load(1)'], ['Shift+{', 'load(-1)'], ['Shift+}', 'load(1)']];
  for (const [k, call] of cases) {
    press(l, k);
    assert.deepEqual(calls, [call], k);
  }
  for (const k of [',', '.', '[', ']', 'Shift+,', 'B']) assert.equal(press(list(), k), undefined, k);
  // what a German keyboard types is on the keys, not behind AltGr
  assert.ok(live(l).every((s) => [s.keys, ...(s.also ?? [])].every((k) => !/[{}\\[\]]/.test(k))));
});

test('the brush steps: a fifth, at least one, inside the range; load by five', () => {
  assert.equal(stepSize(10, 1), 12);
  assert.equal(stepSize(3, 1), 4);
  assert.equal(stepSize(10, -1), 8);
  assert.equal(stepSize(2, -1), 2);
  assert.equal(stepSize(400, 1), 400);
  assert.equal(stepLoad(50, 1), 55);
  assert.equal(stepLoad(5, -1), 5);
  assert.equal(stepLoad(100, 1), 100);
});

test('Variations keys exist only on its tab; Enter leaves a focused button its own', () => {
  assert.equal(press(list(), 'Space'), undefined);
  assert.equal(press(list(VAR), '3')?.label, 'Open a palette larger');
  assert.deepEqual(calls, ['show(3)']);
  press(list(VAR), 'Space');
  assert.deepEqual(calls, ['newSet()']);
  assert.equal(press(list(VAR), 'M'), undefined);
  press(list({ ...VAR, cellOpen: true }), 'M');
  assert.deepEqual(calls, ['more()']);
  press(list({ ...VAR, cellOpen: true }), 'Enter');
  assert.deepEqual(calls, ['use()']);
  assert.equal(press(list({ ...VAR, cellOpen: true, onControl: true }), 'Enter'), undefined);
});

test('Layers: 1 to 3 pick the picture, on its tab only', () => {
  press(list({ tab: 'layers' }), '2');
  assert.deepEqual(calls, ['layerShow(1)']);
  assert.equal(press(list(), '2'), undefined);
});

test('Ctrl+V, Alt+Click and the stroke Esc are listed only', () => {
  const l = list({ tab: 'paint' });
  for (const k of ['Ctrl+V', 'Alt+Click']) {
    const row = l.find((s) => s.keys === k)!;
    assert.ok(row && !row.run, `${k} has no run`);
  }
  const stroke = l.find((s) => s.keys === 'Escape' && s.when === 'while painting')!;
  assert.ok(stroke && !stroke.run);
  assert.equal(press(l, 'Ctrl+V'), undefined);
});

test('tabs: Alt+1 to 7, and all but Ramp settings and Paint wait for a colour', () => {
  press(list(), 'Alt+5');
  assert.deepEqual(calls, ['tab(paint)']);
  const none = { swatches: false, ramp: false, ramps: false };
  assert.equal(press(list(none), 'Alt+2'), undefined);
  press(list(none), 'Alt+1');
  assert.deepEqual(calls, ['tab(settings)']);
});
