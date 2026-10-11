import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocController } from '../src/shared/doc.ts';
import { isLive, keysOf, parseCombo, sameCombo } from '../src/renderer/shell/core/keys.ts';
import { reachable, toolGroups } from '../src/renderer/shell/core/shortcuts.ts';
import type { Shortcut } from '../src/renderer/shell/tool.ts';
import { emptyDoc, spotInk, type HalftoneDoc } from '../src/renderer/tools/halftone/doc.ts';
import { copyPng, halftoneKeys, SHAPES, stepIndex } from '../src/renderer/tools/halftone/keys.ts';
import type { Show } from '../src/renderer/tools/halftone/view-state.ts';

const source = { asset: 'dt://asset/halftone/x.png', name: 'x', w: 100, h: 100 };
const make = (d: HalftoneDoc) => createDocController<HalftoneDoc>('halftone', d, { strict: true });

function rig(d: HalftoneDoc) {
  const doc = make(d);
  const calls: string[] = [];
  const shown: Show[] = [];
  const list = () => halftoneKeys(doc, { pick: () => void calls.push('pick'), flip: () => void calls.push('flip'), show: (s) => void shown.push(s) });
  const press = (keys: string) => {
    const hit = list().find((s) => isLive(s) && keysOf(s).includes(keys));
    assert.ok(hit, `${keys} is live`);
    hit.run!();
  };
  return { doc, calls, shown, list, press };
}

const states: [string, HalftoneDoc][] = [
  ['no image', emptyDoc()],
  ['CMYK', { ...emptyDoc(), source }],
  ['six spot inks', { ...emptyDoc(), source, mode: 'spot', inks: Array.from({ length: 6 }, (_, n) => spotInk(`Ink ${n}`, [0.5, 0.1, n * 50], n)) }],
];

test('no two live entries share a combo in any state, and listing every row keeps the keymap whole', () => {
  for (const [name, d] of states) {
    const live = halftoneKeys(make(d), { pick() {}, flip() {}, show() {} }).filter(isLive);
    const seen: ReturnType<typeof parseCombo>[] = [];
    for (const k of live.flatMap(keysOf)) {
      const c = parseCombo(k)!;
      assert.ok(c, k);
      assert.ok(!seen.some((o) => sameCombo(o!, c)), `${k} twice in ${name}`);
      seen.push(c);
    }
  }
});

test('every row has a group, and nothing is shadowed on the sheet', () => {
  const list = halftoneKeys(make(states[1][1]), { pick() {}, flip() {}, show() {} });
  assert.ok(list.every((s) => s.group === 'Image' || s.group === 'Copy and export'));
  assert.equal(reachable(list).length, list.length);
  assert.deepEqual(toolGroups(list).map((g) => g.title), ['Image', 'Copy and export']);
});

test('Ctrl+V and Space are never live entries; the dial hint is listed only', () => {
  for (const [, d] of states) {
    const list = halftoneKeys(make(d), { pick() {}, flip() {}, show() {} });
    assert.ok(!list.some((s) => isLive(s) && keysOf(s).some((k) => ['Ctrl+V', 'Space', 'Up', 'Down'].includes(k))));
    const snap = list.find((s) => s.keys === 'Shift')!;
    assert.equal(snap.run, undefined);
    assert.match(snap.label, /drag the dial/);
  }
});

test('Alt+1 to 3 pick Original, Result and Separations; Y flips; Ctrl+O opens', () => {
  const r = rig(states[1][1]);
  r.press('Alt+1');
  r.press('Alt+2');
  r.press('Alt+3');
  assert.deepEqual(r.shown, ['original', 'result', 'separations']);
  r.press('Y');
  r.press('\\');
  r.press('Ctrl+O');
  assert.deepEqual(r.calls, ['flip', 'flip', 'pick']);
});

test('with no image the view keys are off, and Copy the PNG waits for the view', () => {
  const none = halftoneKeys(make(emptyDoc()), { pick() {}, flip() {}, show() {} });
  for (const k of ['Alt+1', 'Alt+2', 'Alt+3', 'Y']) assert.equal(none.find((s) => s.keys === k)!.off, true, k);
  assert.equal(none.find((s) => s.keys === 'Ctrl+O')!.off, undefined);
  const list = () => halftoneKeys(make(states[1][1]), { pick() {}, flip() {}, show() {} }).find((s) => s.keys === 'Ctrl+Shift+C')!;
  assert.equal(list().off, true, 'no view yet');
  let ran = 0;
  copyPng.now = { run: () => void ran++, off: false };
  assert.equal(list().off, false);
  list().run!();
  assert.equal(ran, 1);
  copyPng.now = { run() {}, off: true };
  assert.equal(list().off, true);
  copyPng.now = null;
});

test('digits are the plates: only as many as there are, each toggles its own ink', () => {
  const r = rig(states[1][1]);
  const digits = (l: Shortcut[]) => l.filter((s) => /^\d$/.test(s.keys)).map((s) => s.keys);
  assert.deepEqual(digits(r.list()), ['1', '2', '3', '4']);
  assert.deepEqual(digits(halftoneKeys(make(states[2][1]), { pick() {}, flip() {}, show() {} })), ['1', '2', '3', '4', '5', '6']);
  r.press('2');
  assert.deepEqual(r.doc.get().inks.map((k) => k.visible), [true, false, true, true]);
  r.press('2');
  assert.ok(r.doc.get().inks.every((k) => k.visible));
  assert.equal(toolGroups(r.list()).find((g) => g.title === 'Image')!.rows.find((row) => row.to)!.to, '4');
});

test(', and . step the dot shape in the Screen group order, stopping at the ends; [ and ] are the same keys', () => {
  const r = rig(states[1][1]);
  const shape = () => r.doc.get().screen.shape;
  assert.equal(shape(), 'round');
  r.press(',');
  assert.equal(shape(), 'round');
  r.press('.');
  assert.equal(shape(), SHAPES[1].value);
  r.press(']');
  assert.equal(shape(), SHAPES[2].value);
  r.press('[');
  r.press(',');
  assert.equal(shape(), SHAPES[0].value);
  for (let n = 0; n < 10; n++) r.press('.');
  assert.equal(shape(), 'stochastic');
  assert.equal(stepIndex(6, 1), 6);
  assert.equal(stepIndex(0, -4), 0);
});
