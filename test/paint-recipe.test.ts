import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, hexToOklch } from '../src/shared/color/index.ts';
import { mix } from '../src/shared/paint/km.ts';
import { customPigment, PIGMENTS, type Pigment } from '../src/shared/paint/pigments.ts';
import { recipes } from '../src/shared/paint/recipe.ts';

const P = Object.fromEntries(PIGMENTS.map((p) => [p.id, p])) as Record<string, Pigment>;
const TARGETS = ['#6b8e23', '#c0504d', '#4f81bd', '#f2dcdb', '#1f497d', '#ffc000', '#7f7f7f', '#8064a2', '#4bacc6', '#f79646', '#2c1810', '#d8e4bc'].map(hexToOklch);

test("a pigment's own masstone comes back as that pigment alone", () => {
  for (const p of PIGMENTS) {
    const [best] = recipes(p.oklch, PIGMENTS, { maxPigments: 3, count: 3 });
    assert.deepEqual(best.parts, [{ pigment: p, parts: 1 }], p.id);
    assert.ok(best.deltaE < 0.5, p.id);
  }
  const mine = customPigment('Quinacridone Rose', [0.55, 0.2, 0]);
  assert.equal(recipes(mine.oklch, [...PIGMENTS, mine], { maxPigments: 3, count: 1 })[0].parts[0].pigment, mine);
});

test('recipes: whole parts 1..6 (the white up to 128, for tints), at most maxPigments paints, closest first, each result the true mix', () => {
  for (const target of TARGETS.slice(0, 4)) {
    for (const maxPigments of [1, 2, 3] as const) {
      const list = recipes(target, PIGMENTS, { maxPigments, count: 4 });
      assert.equal(list.length, 4);
      list.forEach((r, i) => {
        assert.ok(r.parts.length >= 1 && r.parts.length <= maxPigments);
        assert.ok(r.parts.every((p) => Number.isInteger(p.parts) && p.parts >= 1 && p.parts <= (p.pigment === P.tiwhite ? 128 : 6)));
        assert.ok(r.parts.every((p, j) => j === 0 || p.parts <= r.parts[j - 1].parts), 'largest part first');
        assert.equal(new Set(r.parts.map((p) => p.pigment.id)).size, r.parts.length);
        assert.ok(deltaE(r.result, mix(r.parts)) < 1e-9);
        assert.ok(Math.abs(r.deltaE - deltaE(target, r.result)) < 1e-9);
        if (i) assert.ok(r.deltaE >= list[i - 1].deltaE);
      });
    }
  }
});

test('a mix of owned paints is found again', () => {
  for (const parts of [
    [{ pigment: P.ultra, parts: 2 }, { pigment: P.bsienna, parts: 1 }],
    [{ pigment: P.tiwhite, parts: 5 }, { pigment: P.yochre, parts: 2 }, { pigment: P.viridian, parts: 1 }],
  ]) {
    const [best] = recipes(mix(parts), PIGMENTS, { maxPigments: 3, count: 1 });
    assert.ok(best.deltaE < 1, `${best.deltaE}`);
  }
});

test('a third paint is only listed when it beats the simpler recipe inside it', () => {
  for (const target of TARGETS) {
    const list = recipes(target, PIGMENTS, { maxPigments: 3, count: 20 });
    for (const r of list) {
      const inner = list.filter((x) => x.parts.length < r.parts.length && x.parts.every((p) => r.parts.some((q) => q.pigment === p.pigment)));
      for (const x of inner) assert.ok(r.deltaE < x.deltaE - 1);
    }
  }
});

test('pale tints and greys: a little colour in a lot of white comes close', () => {
  // a cool near-white from a warm Titanium White is the hardest: it only gets near
  for (const [hex, within] of [['#808080', 5], ['#bebebe', 5], ['#fcd2b0', 5], ['#e0dedb', 5], ['#ddf2fb', 5], ['#d9eafc', 6]] as const) {
    const [best] = recipes(hexToOklch(hex), PIGMENTS, { maxPigments: 3, count: 1 });
    assert.ok(best.deltaE < within, `${hex}: ${best.deltaE.toFixed(1)} from ${best.parts.map((p) => `${p.parts} ${p.pigment.name}`).join(' + ')}`);
  }
  // without a white there is no ladder: parts stay at 6 or fewer
  const noWhite = PIGMENTS.filter((p) => p !== P.tiwhite);
  const [r] = recipes(hexToOklch('#d9eafc'), noWhite, { maxPigments: 3, count: 1 });
  assert.ok(r.parts.every((p) => p.parts <= 6));
});

test('nothing owned, nothing asked: no recipes', () => {
  assert.deepEqual(recipes(TARGETS[0], [], { maxPigments: 3, count: 3 }), []);
  assert.deepEqual(recipes(TARGETS[0], PIGMENTS, { maxPigments: 3, count: 0 }), []);
});

test('performance: 12 targets from 14 pigments in under 300ms', () => {
  const t = performance.now();
  for (const target of TARGETS) recipes(target, PIGMENTS, { maxPigments: 3, count: 3 });
  const ms = performance.now() - t;
  assert.ok(ms < 300, `${ms.toFixed(0)}ms`);
});
