import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, deltaE, hexToOklch, toHex } from '../src/shared/color/index.ts';
import { valueOf } from '../src/shared/color/value.ts';
import { LIGHTS, SUBJECTS } from '../src/renderer/tools/illustration/scene.ts';
import { newRamp } from '../src/shared/palette/ramp.ts';
import { ROLES } from '../src/shared/palette/roles.ts';
import {
  basesKey, checkRoles, colourCells, designAlternatives, designCells, jitterLight, KINDS, lightCells, lightKey, LIGHT_PRESETS, nextSeed, pairsOf, pickedIds, rampAlternatives,
  rampsFor, relatives, roleChecks, rolesKey, subjectBases, type Base, type DesignVary,
} from '../src/shared/palette/variations.ts';

const brand = hexToOklch('#E8643C');
const vary: DesignVary = { style: true, accent: true, ground: true };
const current = { style: 'warm', accent: 'triad' as const, ground: 'light' as const };
const design = (seed: number, locked = { Primary: brand }) => designCells({ seed, locked, vary, current });

// ── Design cells ─────────────────────────────────────────────────────────────────────────────────

test('design cells are deterministic for a seed and differ between seeds', () => {
  assert.deepEqual(design(4242), design(4242));
  assert.notDeepEqual(design(4242).map((c) => rolesKey(c.roles)), design(4243).map((c) => rolesKey(c.roles)));
});

test('locked roles are identical in all six design cells', () => {
  const locked = { Primary: brand, Muted: hexToOklch('#6b6a66') };
  for (const seed of [1, 4242, 99999]) {
    const cells = design(seed, locked);
    assert.equal(cells.length, 6);
    for (const c of cells) {
      assert.deepEqual(c.roles.Primary, brand);
      assert.deepEqual(c.roles.Muted, locked.Muted);
    }
  }
});

test('six distinct design palettes, even when nothing may vary but the seed', () => {
  for (const seed of [1, 7, 4242, 123456]) assert.equal(new Set(design(seed).map((c) => rolesKey(c.roles))).size, 6);
  const still = designCells({ seed: 5, locked: { Primary: brand }, vary: { style: false, accent: false, ground: false }, current });
  assert.equal(new Set(still.map((c) => rolesKey(c.roles))).size, 6);
});

test('every design cell reads Text 7:1 on Background and Surface', () => {
  for (const seed of [1, 7, 4242, 123456, 777777]) {
    for (const c of design(seed)) {
      assert.ok(contrast(toHex(c.roles.Text), toHex(c.roles.Background)) >= 7, `${seed}/${c.n} on Background`);
      assert.ok(contrast(toHex(c.roles.Text), toHex(c.roles.Surface)) >= 7, `${seed}/${c.n} on Surface`);
      assert.ok(c.checks.text >= 7);
    }
  }
});

test('every role is present in a design cell, and the checks are the pairs checkRoles counts', () => {
  for (const c of design(2)) {
    for (const r of ROLES) assert.equal(c.roles[r].length, 3);
    assert.deepEqual(checkRoles(c.roles), c.checks);
    assert.equal(pairsOf(c.roles).length, c.checks.total);
  }
});

test('extreme brand colours: finite, locked exactly, six distinct, Text 7:1', () => {
  for (const h of ['#E8643C', '#000000', '#ffffff', '#808080', '#fff700', '#ffeecc', '#0000ff', '#ff00ff', '#111111', '#f5f5f5', '#00ff00']) {
    const primary = hexToOklch(h);
    for (const seed of [1, 4242, 555555]) {
      const cells = design(seed, { Primary: primary });
      assert.equal(new Set(cells.map((c) => rolesKey(c.roles))).size, 6, `${h}/${seed} distinct`);
      for (const c of cells) {
        for (const k of ROLES) for (const v of c.roles[k]) assert.ok(Number.isFinite(v), `${h}/${seed}/${c.n} ${k}`);
        assert.deepEqual(c.roles.Primary, primary, `${h}/${seed}/${c.n} Primary`);
        assert.ok(c.checks.text >= 7, `${h}/${seed}/${c.n} text ${c.checks.text.toFixed(2)}`);
      }
    }
  }
});

test('odd seeds still give six finite cells', () => {
  for (const s of [0, -1, 1.5, 2 ** 40, NaN]) {
    const cells = designCells({ seed: s, locked: {}, vary, current });
    assert.equal(cells.length, 6);
    for (const c of cells) for (const k of ROLES) for (const v of c.roles[k]) assert.ok(Number.isFinite(v));
  }
  for (const s of [0, 4242, NaN, -5]) {
    const n = nextSeed(s);
    assert.ok(Number.isInteger(n) && n >= 100000 && n < 1000000, String(n));
  }
});

test('the vary flags decide what changes', () => {
  const only = (v: DesignVary) => designCells({ seed: 11, locked: { Primary: brand }, vary: v, current });
  const hold = only({ style: false, accent: false, ground: false });
  assert.ok(hold.every((c) => c.style === 'warm' && c.accent === 'triad'));
  const styles = new Set(only({ style: true, accent: false, ground: false }).map((c) => c.style));
  assert.ok(styles.size > 1);
  assert.ok(only({ style: false, accent: true, ground: false }).every((c) => c.style === 'warm'));
});

test('every locked role at once: six cells that are all the locked palette', () => {
  const locked = Object.fromEntries(ROLES.map((r) => [r, design(5, {} as never)[0].roles[r]]));
  const cells = designCells({ seed: 3, locked, vary, current });
  assert.equal(cells.length, 6);
  for (const c of cells) assert.deepEqual(c.roles, locked);
});

// ── Illustration cells ───────────────────────────────────────────────────────────────────────────

const bases: Base[] = [
  { name: 'Skin medium', base: [0.74, 0.075, 55], material: 'skin', locked: true },
  { name: 'Hair brown', base: [0.36, 0.06, 50], material: 'fur' },
  { name: 'Cloth', base: [0.55, 0.09, 250], material: 'cloth' },
  { name: 'Foliage', base: [0.6, 0.12, 140], material: 'foliage' },
  { name: 'Sky', base: [0.78, 0.08, 235], material: 'paper' },
];
const light = { light: LIGHTS[1].light, shadow: LIGHTS[1].shadow };
const sub = (id: string, locked = false): Base => {
  const s = SUBJECTS.find((x) => x.id === id)!;
  return { name: s.label, base: s.base, material: s.material, locked };
};

test('colour cells are deterministic, distinct, and keep locked ramps', () => {
  const a = colourCells({ seed: 31, current: bases, light });
  assert.deepEqual(a, colourCells({ seed: 31, current: bases, light }));
  assert.equal(a.length, 6);
  assert.equal(new Set(a.map((c) => basesKey(c.bases))).size, 6);
  for (const c of a) {
    assert.ok(c.bases.some((b) => b.name === 'Skin medium' && b.locked && b.base.every((v, i) => v === bases[0].base[i])));
    assert.deepEqual(c.light, light);
  }
});

test('every colour cell has the scene\'s ramp count and slot names, even with few or all locked', () => {
  for (const n of [3, 5]) for (const lockAll of [false, true]) {
    const cur = bases.slice(0, n).map((b) => ({ ...b, locked: lockAll }));
    for (const seed of [1, 777, 31]) for (const c of colourCells({ seed, current: cur, light })) {
      assert.equal(c.bases.length, n);
      assert.deepEqual(c.bases.map((b) => b.name), cur.map((b) => b.name));
    }
  }
});

test('colour cells with few, one or no ramps still come out finite', () => {
  const cases: Base[][] = [[sub('skin')], [sub('skin', true)], [], ['skin', 'hair', 'cloth'].map((i) => sub(i, true)), [sub('skin', true), sub('hair'), sub('cloth', true), sub('sky'), sub('foliage')]];
  for (const cur of cases) for (const seed of [1, 31, 777]) {
    const cells = colourCells({ seed, current: cur, light });
    assert.equal(cells.length, 6);
    for (const c of cells) {
      assert.equal(c.bases.length, Math.max(1, cur.length));
      for (const r of rampsFor(c.bases, c.light)) for (const s of r.steps) assert.ok(s.oklch.every(Number.isFinite));
      cur.forEach((b, i) => b.locked && assert.deepEqual(c.bases.find((x) => x.locked && x.name === b.name)?.base, b.base, `locked ${i}`));
    }
  }
});

test('vary the light keeps the bases and changes only the light; five presets plus one in between', () => {
  const cells = lightCells({ seed: 8, bases, current: light });
  assert.equal(cells.length, 6);
  for (const c of cells) assert.deepEqual(c.bases, bases);
  assert.equal(new Set(cells.map((c) => lightKey(c.light))).size, 6);
  assert.deepEqual(cells, lightCells({ seed: 8, bases, current: light }));
  assert.equal(cells.filter((c) => c.presetId).length, 5);
  assert.equal(cells[5].presetId, null);
  assert.equal(LIGHT_PRESETS.length, 5);
  // Space renews only the in-between one
  const again = lightCells({ seed: 9, bases, current: light });
  assert.deepEqual(cells.slice(0, 5), again.slice(0, 5));
  assert.notDeepEqual(cells[5].light, again[5].light);
  for (const s of [0, 1, 99, 4242]) {
    const j = lightCells({ seed: s, bases: [], current: light })[5].light;
    for (const v of [...j.light, ...j.shadow]) assert.ok(Number.isFinite(v));
  }
});

test('a nudged light stays a light: finite for every preset', () => {
  for (const l of LIGHTS) for (const v of [...jitterLight(l, 3).light, ...jitterLight(l, 3).shadow]) assert.ok(Number.isFinite(v), l.id);
});

test('ramps follow the scene: one base step, the scene\'s steps, push, hue shift and curve, the light given', () => {
  for (const s of SUBJECTS) for (const l of LIGHTS) {
    const r = rampsFor([{ name: s.label, base: s.base, material: s.material }], l)[0];
    assert.equal(r.steps.filter((x) => x.step === 0).length, 1, s.id);
  }
  const like = { ...newRamp([0.5, 0.1, 30], 'x'), steps: 7, push: 1.4, hueShift: 0.4, chromaCurve: -0.3, intensity: 'expressive' as const };
  const plain = rampsFor([bases[2]], light)[0];
  const scene = rampsFor([bases[2]], light, like)[0];
  assert.equal(scene.steps.length, 7);
  assert.equal(plain.steps.length, 5);
  assert.notDeepEqual(scene.steps.map((s) => toHex(s.oklch)), plain.steps.map((s) => toHex(s.oklch)));
  // the cell's own light wins over the scene ramp's
  assert.notDeepEqual(rampsFor([bases[2]], { light: LIGHTS[4].light, shadow: LIGHTS[4].shadow }, like)[0].steps, scene.steps);
});

// ── More like this ───────────────────────────────────────────────────────────────────────────────

type DCell = ReturnType<typeof design>[number];
const meanRoleDelta = (parent: DCell, list: DCell[]) => list.reduce((t, c) => t + ROLES.reduce((u, r) => u + deltaE(c.roles[r], parent.roles[r]), 0) / ROLES.length, 0) / list.length;

test('design relatives: the parent is cell 1, then five that are closer than a fresh set, narrower at depth 2, locks hold, all distinct', () => {
  let near1 = 0, near2 = 0, fresh = 0, n = 0;
  const locks = ['Primary' as const];
  for (const seed of [1, 7, 4242, 99999, 123456, 31337]) {
    for (const parent of design(seed).slice(0, 3)) {
      const one = relatives(parent, 1, seed + 1, { locks });
      const two = relatives(parent, 2, seed + 2, { locks });
      for (const list of [one, two]) {
        assert.equal(list.length, 6);
        assert.deepEqual(list[0], { ...parent, n: 1 });
        assert.deepEqual(list.map((c) => c.n), [1, 2, 3, 4, 5, 6]);
        assert.equal(new Set(list.map((c) => rolesKey(c.roles))).size, 6);
        for (const c of list) { assert.deepEqual(c.roles.Primary, brand); assert.equal(c.style, parent.style); assert.equal(c.accent, parent.accent); }
      }
      near1 += meanRoleDelta(parent, one.slice(1));
      near2 += meanRoleDelta(parent, two.slice(1));
      fresh += meanRoleDelta(parent, design(seed + 5));
      n++;
    }
  }
  assert.ok(near1 < fresh * 0.75, `relatives ${(near1 / n).toFixed(2)} vs fresh ${(fresh / n).toFixed(2)}`);
  assert.ok(near2 < near1, `depth 2 ${(near2 / n).toFixed(2)} vs depth 1 ${(near1 / n).toFixed(2)}`);
});

test('design relatives keep every user lock, not just Primary, and are deterministic', () => {
  const locked = { Primary: brand, Muted: hexToOklch('#6b6a66'), Accent: hexToOklch('#2f6fd0') };
  const parent = designCells({ seed: 12, locked, vary, current })[2];
  for (const depth of [1, 2, 3]) for (const c of relatives(parent, depth, 77, { locks: ['Primary', 'Muted', 'Accent'] })) {
    for (const r of ['Primary', 'Muted', 'Accent'] as const) assert.deepEqual(c.roles[r], locked[r]);
  }
  assert.deepEqual(relatives(parent, 1, 5, { locks: ['Primary'] }), relatives(parent, 1, 5, { locks: ['Primary'] }));
});

test('a parent that passes every pair gets relatives that pass them, and every relative is finite', () => {
  let total = 0;
  for (const seed of [1, 4242]) {
    for (const parent of design(seed).filter((c) => c.checks.passed === c.checks.total).slice(0, 3)) for (const depth of [1, 2, 3]) {
      const rel = relatives(parent, depth, seed + depth, { locks: ['Primary'] });
      assert.equal(rel.length, 6);
      for (const c of rel) {
        total++;
        assert.equal(c.checks.passed, c.checks.total, `${seed}/${depth}/${c.n} ${c.checks.fails.join()}`);
        for (const k of ROLES) for (const v of c.roles[k]) assert.ok(Number.isFinite(v));
      }
    }
  }
  assert.ok(total > 0);
});

test('design relatives with everything locked is the parent alone', () => {
  const all = Object.fromEntries(ROLES.map((r) => [r, design(5, {} as never)[0].roles[r]]));
  const parent = designCells({ seed: 5, locked: all, vary, current })[0];
  const rel = relatives(parent, 1, 3, { locks: [...ROLES] });
  assert.equal(rel.length, 1);
  assert.deepEqual(rel[0], { ...parent, n: 1 });
});

test('colour relatives: the parent first, then the light, locks and every grey value held; narrower at depth 2', () => {
  const parent = colourCells({ seed: 31, current: bases, light })[1];
  const one = relatives(parent, 1, 3);
  const two = relatives(parent, 2, 3);
  for (const list of [one, two]) {
    assert.equal(list.length, 6);
    assert.deepEqual(list[0], { ...parent, n: 1 });
    assert.equal(new Set(list.map((c) => basesKey(c.bases))).size, 6);
    for (const c of list) {
      assert.deepEqual(c.light, parent.light);
      c.bases.forEach((b, i) => {
        if (b.locked) assert.deepEqual(b.base, parent.bases[i].base);
        else assert.ok(Math.abs(valueOf(b.base) - valueOf(parent.bases[i].base)) < 0.01, `value ${b.name}`);
      });
    }
  }
  const mean = (list: { bases: Base[] }[]) => list.reduce((t, c) => t + c.bases.reduce((u, b, i) => u + deltaE(b.base, parent.bases[i].base), 0) / c.bases.length, 0) / list.length;
  assert.ok(mean(one.slice(1)) < mean(colourCells({ seed: 99, current: bases, light })), 'closer than fresh');
  assert.ok(mean(two.slice(1)) < mean(one.slice(1)), 'depth 2 narrower');
});

test('colour relatives: every ramp locked is the parent alone; a small scene gives no copies at any depth', () => {
  const locked = colourCells({ seed: 3, current: SUBJECTS.slice(0, 3).map((s) => ({ name: s.label, base: s.base, material: s.material, locked: true })), light, subjects: [] })[0];
  assert.equal(relatives({ ...locked, bases: locked.bases.map((b) => ({ ...b, locked: true })) }, 1, 5).length, 1);
  const one = colourCells({ seed: 3, current: [sub('cloth')], light, subjects: ['cloth'] })[0];
  for (const depth of [1, 2, 3]) {
    const rel = relatives(one, depth, 11);
    assert.equal(new Set(rel.map((c) => basesKey(c.bases))).size, rel.length);
  }
});

test('light relatives: the parent first, then only the light pair nudged, less at depth 2', () => {
  const wide = lightCells({ seed: 8, bases, current: light });
  const parent = wide[0];
  const one = relatives(parent, 1, 4);
  const two = relatives(parent, 2, 4);
  for (const list of [one, two]) {
    assert.equal(list.length, 6);
    assert.deepEqual(list[0], { ...parent, n: 1 });
    assert.equal(new Set(list.map((c) => lightKey(c.light))).size, 6);
    for (const c of list) assert.deepEqual(c.bases, bases);
  }
  const gap = (c: { light: typeof light }) => deltaE(c.light.light, parent.light.light) + deltaE(c.light.shadow, parent.light.shadow);
  const mean = (list: { light: typeof light }[]) => list.reduce((t, c) => t + gap(c), 0) / list.length;
  assert.ok(mean(two.slice(1)) < mean(one.slice(1)));
  assert.ok(mean(one.slice(1)) < mean(wide.slice(1, 5)));
});

// ── Swap one colour ──────────────────────────────────────────────────────────────────────────────

test('design alternatives pass their pairs with the other roles unchanged, are distinct and deterministic', () => {
  for (const seed of [4242, 7]) {
    const cell = design(seed)[seed === 7 ? 1 : 0];
    for (const role of ROLES) {
      const o = { seed: 11, role, roles: cell.roles, style: cell.style, accent: cell.accent };
      const alts = designAlternatives(o);
      assert.ok(alts.length >= 3, `${role} has ${alts.length}`);
      assert.ok(alts.length <= 8);
      assert.equal(new Set(alts.map((a) => a.hex)).size, alts.length);
      for (const a of alts) {
        const trial = { ...cell.roles, [role]: a.colour };
        const checks = roleChecks(trial, role);
        assert.ok(checks.every((p) => p.pass), `${role} ${a.hex}`);
        assert.equal(a.hex, toHex(a.colour));
        assert.ok(a.figure >= Math.min(...checks.map((p) => p.need)) - 0.005);
        for (const other of ROLES) if (other !== role) assert.deepEqual(trial[other], cell.roles[other]);
      }
      assert.deepEqual(alts, designAlternatives(o));
    }
  }
});

test('Accent has a full row of eight, and accent "none" still has answers', () => {
  const cell = design(4242)[0];
  assert.equal(designAlternatives({ seed: 3, role: 'Accent', roles: cell.roles, style: cell.style, accent: cell.accent }).length, 8);
  assert.ok(designAlternatives({ seed: 1, role: 'Accent', roles: cell.roles, style: cell.style, accent: 'none' }).length > 0);
});

test('ramp alternatives keep the grey value, differ, are deterministic and follow the scene\'s ramp', () => {
  for (const b of bases) {
    const alts = rampAlternatives({ seed: 5, base: b, light });
    assert.ok(alts.length >= 6, `${b.name} ${alts.length}`);
    assert.equal(new Set(alts.map((a) => a.hex)).size, alts.length);
    for (const a of alts) {
      assert.ok(Math.abs(valueOf(a.base) - valueOf(b.base)) < 0.01, `${b.name} ${a.hex}`);
      assert.equal(a.steps.length, 5);
    }
    assert.deepEqual(alts, rampAlternatives({ seed: 5, base: b, light }));
  }
  const like = { ...newRamp([0.5, 0.1, 30], 'x'), steps: 7 };
  assert.equal(rampAlternatives({ seed: 5, base: bases[2], light, like })[0].steps.length, 7);
});

test('ramp alternatives from extreme bases hold the value within 0.01 and are finite', () => {
  const extremes: Base[] = [
    { name: 'dark', base: [0.15, 0.02, 30], material: 'cloth' }, { name: 'white', base: [0.97, 0.01, 90], material: 'paper' },
    { name: 'grey', base: [0.6, 0, 0], material: 'stone' }, { name: 'sat', base: [0.7, 0.3, 140], material: 'foliage' }, { name: 'black', base: [0.02, 0, 0], material: 'metal' },
    ...SUBJECTS.map((s): Base => ({ name: s.id, base: s.base, material: s.material })),
  ];
  for (const b of extremes) for (const l of LIGHTS.slice(0, 3)) {
    for (const a of rampAlternatives({ seed: 9157, base: b, light: { light: l.light, shadow: l.shadow } })) {
      assert.ok(Math.abs(valueOf(a.base) - valueOf(b.base)) < 0.01, `${b.name} ${a.hex}`);
      assert.ok(a.base.every(Number.isFinite), `${b.name} NaN`);
      assert.ok(deltaE(a.base, b.base) >= 3 - 1e-9, `${b.name} too close`);
    }
  }
});

// ── What is in the picture ───────────────────────────────────────────────────────────────────────

test('Make ramps gives exactly the ticked subjects, in order, with their materials', () => {
  const ids = pickedIds(['metal', 'skin', 'cloth', 'hair'], { skin: 'skin-deep', hair: 'hair-red' });
  assert.deepEqual(ids, ['skin-deep', 'hair-red', 'cloth', 'metal']);
  const made = subjectBases(ids);
  assert.deepEqual(made.map((b) => b.name), ['Skin deep', 'Hair red', 'Cloth', 'Metal']);
  assert.deepEqual(made.map((b) => b.material), ids.map((id) => SUBJECTS.find((s) => s.id === id)!.material));
  assert.deepEqual(pickedIds([], {}), []);
  assert.equal(KINDS.length, 9);
  // every subject ticked, an unknown tone falls back
  const all = pickedIds(KINDS.map((k) => k.kind), { skin: 'skin-deep', hair: 'hair-black' });
  assert.equal(new Set(all).size, 9);
  assert.equal(pickedIds(['skin'], { skin: 'nonsense' }).length, 1);
});

test('colour cells with subjects ticked keep the subject list, vary within each, honour locks', () => {
  const ids = pickedIds(['skin', 'hair', 'cloth', 'foliage', 'sky'], {});
  const cur = subjectBases(ids).map((b, i) => ({ ...b, locked: i === 0 }));
  for (const seed of [1, 31, 777]) {
    const cells = colourCells({ seed, current: cur, light, subjects: ids });
    assert.equal(cells.length, 6);
    assert.equal(new Set(cells.map((c) => basesKey(c.bases))).size, 6);
    for (const c of cells) {
      assert.deepEqual(c.bases.map((b) => b.material), cur.map((b) => b.material));
      assert.deepEqual(c.bases[0].base, cur[0].base);
      ['Skin', 'Hair', 'Cloth', 'Foliage', 'Sky'].forEach((w, i) => assert.ok(c.bases[i].name.startsWith(w) || i === 4, c.bases[i].name));
      for (const b of c.bases) assert.ok(b.base.every(Number.isFinite));
    }
    assert.ok(new Set(cells.map((c) => c.bases[2].base[2].toFixed(0))).size > 1, 'cloth hue varies');
  }
});
