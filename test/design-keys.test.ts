import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocController } from '../src/shared/doc.ts';
import { buildRoles } from '../src/shared/palette/brand.ts';
import { ROLES } from '../src/shared/palette/roles.ts';
import { isLive, keysOf, parseCombo, sameCombo } from '../src/renderer/shell/core/keys.ts';
import { toolGroups } from '../src/renderer/shell/core/shortcuts.ts';
import { register } from 'node:module';
import type { DesignDoc } from '../src/renderer/tools/design/doc.ts';

// the tool's files import React components and CSS; a loader hook turns those into no-ops so the keys load without a bundler
register('./design-keys.hooks.mjs', import.meta.url);
const { tool } = await import('../src/renderer/tools/design/index.ts');
const { newSwatch, tabsOf } = await import('../src/renderer/tools/design/doc.ts');
const { getView, patchView } = await import('../src/renderer/tools/design/view-state.ts');

// shortcuts() reads the focus and the text selection; nothing is focused or selected here
Object.assign(globalThis, { window: { getSelection: () => ({ toString: () => '' }) }, document: { activeElement: null, body: {} } });

const roles = buildRoles({ seed: 9, style: 'warm', accent: 'triad' });
const full = (): DesignDoc => ({ notes: '', swatches: ROLES.map((r) => newSwatch(roles[r], r, r)) });
const keys = (d: DesignDoc, view = {}) => {
  patchView({ tab: 'contrast', varOpen: 0, swapRole: '', selected: [], ...view });
  return tool.shortcuts!(createDocController('design', d));
};
const find = (list: ReturnType<typeof keys>, k: string, label?: RegExp) => list.filter((s) => s.keys === k && (!label || label.test(s.label)));

/** no two live entries share a combo, counting `also` and `us` */
function assertNoClash(list: ReturnType<typeof keys>) {
  const seen: { combo: NonNullable<ReturnType<typeof parseCombo>>; label: string }[] = [];
  for (const s of list.filter(isLive))
    for (const k of keysOf(s)) {
      const c = parseCombo(k)!;
      const hit = seen.find((x) => sameCombo(x.combo, c));
      assert.ok(!hit, `${k} is live twice: "${hit?.label}" and "${s.label}"`);
      seen.push({ combo: c, label: s.label });
    }
}

test('no two live entries share a combo on any tab, with a cell open or the other-colours row up', () => {
  const d = full();
  for (const tab of tabsOf(d)) {
    assertNoClash(keys(d, { tab }));
    assertNoClash(keys(d, { tab, varOpen: 2 }));
  }
  assertNoClash(keys(d, { swapRole: 'Primary' }));
  assertNoClash(keys({ notes: '', swatches: [] }, { tab: 'variations' }));
});

test('the Variations rows are always listed, live only on the tab and (for the open-cell ones) with a cell open', () => {
  const d = full();
  const names = ['Space', 'ArrowLeft', 'M', 'Enter', 'Escape'];
  for (const [view, expect] of [[{ tab: 'contrast' }, false], [{ tab: 'variations' }, false], [{ tab: 'variations', varOpen: 1 }, true]] as const) {
    const list = keys(d, view);
    const rows = list.filter((s) => s.group === 'Variations');
    assert.equal(rows.length, 6 + 6, 'six cells and six more');
    assert.ok(rows.every((s) => s.when));
    const live = rows.filter(isLive).map((s) => s.keys);
    assert.equal(rows.filter((s) => s.when === 'Variations tab').every((s) => isLive(s) === (view.tab === 'variations')), true);
    for (const n of names.filter((n) => n !== 'Space')) assert.equal(live.includes(n), expect && n !== 'Escape' ? true : expect, n);
  }
  // off the tab the main Space and arrows are the live ones
  const plain = keys(d);
  assert.equal(plain.filter((s) => s.keys === 'Space' && isLive(s)).length, 1);
  assert.match(plain.find((s) => s.keys === 'Space' && isLive(s))!.label, /Reroll/);
  assert.match(keys(d, { tab: 'variations' }).find((s) => s.keys === 'Space' && isLive(s))!.label, /New set/);
});

test('every row has a group, and the groups come out in the picture\'s order', () => {
  const list = keys(full());
  assert.ok(list.every((s) => s.group));
  assert.deepEqual(toolGroups(list).map((g) => g.title), ['Make colours', 'Select and arrange', 'View', 'Variations', 'Copy and export']);
});

test('Ctrl+V is listed only; Delete takes Backspace; C and Ctrl+C share one row', () => {
  const list = keys(full());
  const paste = find(list, 'Ctrl+V');
  assert.equal(paste.length, 1);
  assert.equal(paste[0].run, undefined);
  assert.ok(!list.some((s) => keysOf(s).includes('Ctrl+V') && s.run));
  assert.deepEqual(find(list, 'Delete')[0].also, ['Backspace']);
  const copy = list.find((s) => s.keys === 'C')!;
  assert.deepEqual(copy.also, ['Ctrl+C']);
  assert.ok(isLive(copy));
});

test('C and Ctrl+C step aside while text is selected, so the page copies it', () => {
  (globalThis as any).window.getSelection = () => ({ toString: () => 'abc' });
  const list = keys(full());
  assert.ok(!isLive(list.find((s) => s.keys === 'C')!));
  (globalThis as any).window.getSelection = () => ({ toString: () => '' });
});

test('Ctrl+A selects every colour, the active one first; Shift+A adds a colour after the selected one', () => {
  const d = full();
  const doc = createDocController('design', d);
  patchView({ tab: 'contrast', selected: [d.swatches[2].id] });
  tool.shortcuts!(doc).find((s) => s.keys === 'Ctrl+A')!.run!();
  assert.equal(getView().selected.length, 7);
  assert.equal(getView().selected[0], d.swatches[2].id);
  patchView({ selected: [d.swatches[1].id] });
  tool.shortcuts!(doc).find((s) => s.keys === 'Shift+A')!.run!();
  const after = doc.get().swatches;
  assert.equal(after.length, 8);
  assert.equal(after[1].id, d.swatches[1].id);
  assert.equal(getView().selected[0], after[2].id);
});
