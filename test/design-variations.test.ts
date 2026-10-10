import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, type Oklch } from '../src/shared/color/index.ts';
import { createDocController } from '../src/shared/doc.ts';
import { buildRoles } from '../src/shared/palette/brand.ts';
import { ROLES, type Role } from '../src/shared/palette/roles.ts';
import { roleChecks } from '../src/shared/palette/variations.ts';
import { newSwatch, type DesignDoc, type DesignView } from '../src/renderer/tools/design/doc.ts';
import { alternatives, applyRoles, cellsOf, inUse } from '../src/renderer/tools/design/variations.ts';

/** only the fields the grid reads; the rest of a view is nobody's business here */
const view = (o: Partial<DesignView> = {}): DesignView =>
  ({ preset: 'warm', accent: 'triad', locked: [], varSeed: 4242, varStyle: true, varAccent: true, varGround: true, varPath: [], varOpen: 0, swapRole: '', ...o }) as DesignView;

const roles = buildRoles({ seed: 9, style: 'warm', accent: 'triad' });
const palette = (extra: DesignDoc['swatches'] = []): DesignDoc => ({ notes: '', swatches: [...ROLES.map((r) => newSwatch(roles[r], r, r)), ...extra] });
const held = (d: DesignDoc, role: Role) => d.swatches.find((w) => w.role === role)!;

test('cells: six, the same for the same palette and view, with every locked colour in each', () => {
  const d = palette();
  const locked = [held(d, 'Primary').id, held(d, 'Muted').id];
  const v = view({ locked });
  const cells = cellsOf(d, v);
  assert.equal(cells.length, 6);
  assert.deepEqual(cellsOf(d, view({ locked })).map((c) => c.roles), cells.map((c) => c.roles));
  for (const c of cells) {
    assert.deepEqual(c.roles.Primary, held(d, 'Primary').oklch);
    assert.deepEqual(c.roles.Muted, held(d, 'Muted').oklch);
  }
  assert.notDeepEqual(cellsOf(d, view({ locked, varSeed: 77 })).map((c) => c.roles), cells.map((c) => c.roles));
});

test('after More like this the parent is cell 1, and adopting cell 1 changes nothing', () => {
  const d = palette();
  const wide = cellsOf(d, view());
  const narrowed = cellsOf(d, view({ varPath: [3] }));
  assert.equal(narrowed.length, 6);
  assert.deepEqual(narrowed[0].roles, wide[2].roles);
  // twice: the second parent is one of the first row's cells, cell 1 again
  const again = cellsOf(d, view({ varPath: [3, 4] }));
  assert.deepEqual(again[0].roles, narrowed[3].roles);
  // a palette that already holds the parent is unchanged by adopting cell 1
  const using = applyRoles(d, narrowed[0].roles, []);
  assert.equal(applyRoles(using, narrowed[0].roles, []), using);
  assert.ok(inUse(using, narrowed[0]));
  assert.ok(!inUse(using, narrowed[1]));
});

test('adopting a cell writes the roles into the swatches that hold them, and leaves other swatches alone', () => {
  const extra = [newSwatch([0.5, 0.05, 100], 'No role'), newSwatch([0.4, 0.1, 200], 'Other job', 'Quote')];
  const d = palette(extra);
  const cell = cellsOf(d, view())[2];
  const next = applyRoles(d, cell.roles, []);
  for (const r of ROLES) assert.deepEqual(held(next, r).oklch, cell.roles[r]);
  assert.equal(next.swatches.length, d.swatches.length);
  assert.deepEqual(next.swatches.slice(7), extra);
  assert.deepEqual(next.swatches.map((w) => w.id), d.swatches.map((w) => w.id));
});

test('a locked swatch is never touched, and a role the palette lacks is added', () => {
  const d = palette();
  const cell = cellsOf(d, view())[1];
  const lock = held(d, 'Accent');
  const next = applyRoles(d, cell.roles, [lock.id]);
  assert.equal(held(next, 'Accent'), lock);
  const small: DesignDoc = { notes: '', swatches: [newSwatch(roles.Background, 'Ground', 'Background'), newSwatch([0.5, 0.05, 100], 'Loose')] };
  const grown = applyRoles(small, cell.roles, []);
  assert.deepEqual(grown.swatches.map((w) => w.role), ['Background', null, 'Surface', 'Text', 'Muted', 'Primary', 'Accent', 'Highlight']);
  assert.equal(grown.swatches[1], small.swatches[1]);
  assert.deepEqual(grown.swatches[0].oklch, cell.roles.Background);
});

test('using a cell is one undo step, and undo restores the palette exactly', () => {
  const doc = createDocController<DesignDoc>('design', palette(), { strict: true });
  const before = doc.get();
  const cell = cellsOf(before, view())[4];
  doc.transact('Use variation 5', (d) => applyRoles(d, cell.roles, []));
  assert.equal(doc.depth(), 1);
  assert.ok(inUse(doc.get(), cell));
  doc.undo();
  assert.equal(doc.get(), before);
  assert.equal(doc.depth(), 0);
});

test('swap: the alternatives for each held role pass every pair that role is in, the others unchanged', () => {
  const d = palette();
  const v = view({ preset: 'warm', accent: 'triad' });
  for (const role of ROLES) {
    const list = alternatives(d, v, role);
    assert.ok(list.length >= 3, `${role} has ${list.length}`);
    for (const a of list) {
      const trial = { ...roles, [role]: a.colour };
      assert.ok(roleChecks(trial, role).every((p) => p.pass), `${role} ${a.hex}`);
    }
  }
  assert.equal(alternatives(d, v, 'Accent'), alternatives(d, v, 'Accent'));
});

test('swap works on a palette with roles missing, judged against colours made round the ones it has', () => {
  const d: DesignDoc = { notes: '', swatches: [newSwatch(roles.Background, 'G', 'Background'), newSwatch(roles.Text, 'T', 'Text'), newSwatch(roles.Primary, 'P', 'Primary')] };
  const list = alternatives(d, view(), 'Primary');
  assert.ok(list.length > 0);
  assert.ok(list.every((a) => a.colour.every(Number.isFinite) && typeof a.hex === 'string'));
  const oklch: Oklch = list[0].colour;
  assert.equal(oklch.length, 3);
});
