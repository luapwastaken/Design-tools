// Layer recipe: the blend maths, the solves and the muddy check. Lifted from the demo's 16 + 488 tests, with
// the ramps' own steps as the targets and equal weights (a starred flat counts three times) where the demo
// measured its picture's shares; the changes are marked where they are.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToOklch, toHex, type Oklch } from '../src/shared/color/index.ts';
import { generateRamp, newRamp } from '../src/shared/palette/ramp.ts';
import {
  blendChannel,
  blendRgb,
  CLOSE,
  composite8,
  fromLinear,
  hexRgb,
  muddyAll,
  muddyCheck,
  oklchToSrgb,
  parseRecipeLine,
  recipeText,
  rgbHex,
  rimColour,
  shadeFlat,
  shadowStack,
  solveLayer,
  solveRecipe,
  srgbToOklab,
  STAR_WEIGHT,
  targetsFrom,
  fitWord,
  type FlatIn,
  type Item,
  type Mode,
  type Targets,
} from '../src/shared/palette/recipe.ts';
import { toOklab } from '../src/shared/palette/space.ts';
import type { MaterialId } from '../src/shared/types.ts';
import { LIGHTS } from '../src/renderer/tools/illustration/scene.ts';
import { budget } from './perf.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const DAY = LIGHTS[0];
type Pair = { light: Oklch; shadow: Oklch };

/** a flat whose targets are its ramp's own steps under `pair` (what the tab reads off a palette) */
function flatOf(id: string, name: string, hex: string, material: MaterialId, pair: Pair, o: Partial<FlatIn> & { intensity?: 'grounded' | 'expressive' | 'extreme' } = {}): FlatIn {
  const { intensity = 'expressive', ...rest } = o;
  const spec = { ...newRamp(hexToOklch(hex), `t-${id}`), material, light: pair.light, shadow: pair.shadow, intensity, steps: 5 };
  return { id, name, hex, material, star: false, targets: targetsFrom(spec, generateRamp(spec)), ...rest };
}

/** the demo's five flats: a bust in skin, hair, a red jacket, a shirt and a wall behind */
const sample = (pair: Pair = DAY, o: { intensity?: 'grounded' | 'expressive' | 'extreme' } = {}): FlatIn[] => [
  flatOf('skin', 'Skin', '#E7AE8A', 'skin', pair, { star: true, ...o }),
  flatOf('hair', 'Hair', '#C9A15A', 'fur', pair, o),
  flatOf('jacket', 'Jacket', '#D8433B', 'cloth', pair, o),
  flatOf('shirt', 'Shirt', '#EFE6D8', 'cloth', pair, o),
  flatOf('wall', 'Wall', '#7FB7C9', 'paper', pair, { background: true, ...o }),
];
const SAMPLE = sample();
const weightOf = (f: FlatIn) => (f.star ? STAR_WEIGHT : 1);

test('blend formulas match hand-computed values', () => {
  near(blendChannel('multiply', 0.5, 0.4), 0.2);
  near(blendChannel('screen', 0.5, 0.4), 0.7);
  near(blendChannel('add', 0.2, 0.3), 0.5);
  near(blendChannel('add', 0.7, 0.6), 1); // clips, never above 1
  near(blendChannel('overlay', 0.25, 0.6), 0.3); // dark half: 2BL
  near(blendChannel('overlay', 0.75, 0.6), 0.8); // light half: 1 - 2(1-B)(1-L)
  near(blendChannel('overlay', 0.5, 0.6), 0.6); // the seam sits on the light branch: 1 - 2(0.5)(0.4)
});

test('opacity 0 leaves the colour alone, opacity 1 is the full blend', () => {
  const B = hexRgb('#C86432');
  const L = hexRgb('#8A7FB5');
  for (const mode of ['multiply', 'screen', 'add', 'overlay'] as Mode[]) {
    assert.deepEqual(composite8(B, L, mode, 0), B, mode);
    const full = blendRgb(mode, B.map((v) => v / 255) as [number, number, number], L.map((v) => v / 255) as [number, number, number], 1);
    assert.deepEqual(composite8(B, L, mode, 100), full.map((v) => Math.round(v * 255)), mode);
  }
  // 200*128/255 = 100.4, 100*128/255 = 50.2, 50*128/255 = 25.1
  assert.deepEqual(composite8([200, 100, 50], [128, 128, 128], 'multiply', 100), [100, 50, 25]);
  // zero coverage is no layer at all
  assert.deepEqual(composite8(B, L, 'multiply', 100, 'srgb', 0), B);
  // and a half-opaque Multiply lands half way between the colour and the full blend, per channel
  assert.deepEqual(composite8([200, 100, 50], [128, 128, 128], 'multiply', 50), [150, 75, 38]);
});

test('own OKLab maths agrees with the app colour code', () => {
  for (const hex of ['#E7AE8A', '#3F6E8C', '#101010', '#FFFFFF', '#7FB7C9']) {
    const [r, g, b] = hexRgb(hex);
    const ours = srgbToOklab(r / 255, g / 255, b / 255);
    const theirs = toOklab(hexToOklch(hex));
    for (let i = 0; i < 3; i++) near(ours[i], theirs[i], 2e-3);
  }
  assert.equal(rgbHex(oklchToSrgb(...hexToOklch('#E7AE8A')).map((v) => v * 255)), '#E7AE8A');
  assert.equal(toHex(hexToOklch('#E7AE8A')).toUpperCase(), '#E7AE8A');
  near(fromLinear(0.5), 0.7353569830524495, 1e-9);
});

// the Shadow layer is solved over the character flats only (the wall has its own Cast shadow)
const shadowItems = (): Item[] => SAMPLE.filter((f) => !f.background).map((f) => ({ id: f.id, base: hexRgb(f.hex), target: toOklab(f.targets.shadow), w: weightOf(f) }));

test('the solver beats a plain grey Multiply', () => {
  const items = shadowItems();
  const measure = (g: number, pct: number) => {
    let sum = 0;
    let wsum = 0;
    let worst = 0;
    for (const it of items) {
      const o = composite8(it.base, [g, g, g], 'multiply', pct);
      const lab = srgbToOklab(o[0] / 255, o[1] / 255, o[2] / 255);
      const d = Math.hypot(lab[0] - it.target[0], lab[1] - it.target[1], lab[2] - it.target[2]);
      sum += it.w * d;
      wsum += it.w;
      worst = Math.max(worst, d);
    }
    return { cost: sum / wsum, worst };
  };
  // the best a grey layer can do, at any grey and any opacity
  let grey = { cost: Infinity, worst: 0 };
  for (let g = 0; g <= 255; g += 5) {
    for (let pct = 10; pct <= 100; pct += 5) {
      const m = measure(g, pct);
      if (m.cost < grey.cost) grey = m;
    }
  }
  const solved = solveLayer('multiply', items);
  assert.ok(solved.cost < grey.cost * 0.95, `one coloured layer ${solved.cost.toFixed(4)} vs best grey ${grey.cost.toFixed(4)}`);
  // with the clipped second layer, even the worst flat is better off than under the best grey
  const r = solveRecipe(SAMPLE);
  const worst = Math.max(...SAMPLE.filter((f) => !f.background).map((f) => r.shaded[f.id].shadowDist));
  assert.ok(worst < grey.worst * 0.95, `worst flat ${worst.toFixed(3)} vs ${grey.worst.toFixed(3)} under grey`);
  // the stock choice, Multiply 808080 at 50%, is worse again
  assert.ok(solved.cost < measure(128, 50).cost * 0.85, `stock grey ${measure(128, 50).cost.toFixed(4)}`);
});

test('the solve is deterministic and fast', () => {
  const first = solveRecipe(SAMPLE);
  assert.deepEqual(solveRecipe(SAMPLE), first);
  // warm, then the slowest of a few presets and both spaces
  let slowest = 0;
  for (const light of [LIGHTS[0], LIGHTS[1], LIGHTS[2], LIGHTS[5]]) {
    const flats = sample(light);
    for (const space of ['srgb', 'linear'] as const) {
      const t = performance.now();
      solveRecipe(flats, { space });
      slowest = Math.max(slowest, performance.now() - t);
    }
  }
  assert.ok(slowest < budget(200), `slowest solve ${slowest.toFixed(0)} ms`);
});

test('twelve flats solve in under 150 ms', () => {
  const hexes = ['#E7AE8A', '#C9A15A', '#D8433B', '#EFE6D8', '#7FB7C9', '#3F6E8C', '#8A5A3C', '#5B8C3E', '#B44F8C', '#2B2B33', '#F2C94C', '#9B9B9B'];
  const mats: MaterialId[] = ['skin', 'fur', 'cloth', 'cloth', 'paper', 'water', 'wood', 'foliage', 'cloth', 'metal', 'cloth', 'stone'];
  const flats = hexes.map((h, i) => flatOf(`f${i}`, `Flat ${i}`, h, mats[i], DAY, { star: i === 0, background: i === 4 }));
  solveRecipe(flats); // warm
  let slowest = 0;
  for (const lightMode of ['add', 'screen'] as const) {
    for (const space of ['srgb', 'linear'] as const) {
      const t = performance.now();
      solveRecipe(flats, { lightMode, space });
      slowest = Math.max(slowest, performance.now() - t);
    }
  }
  assert.ok(slowest < budget(150), `slowest 12-flat solve ${slowest.toFixed(0)} ms`);
});

test('a flat one layer cannot fit gets a second, clipped layer that helps', () => {
  const r = solveRecipe(SAMPLE);
  assert.ok(r.shadow2, 'the sample has a red jacket and blonde hair: one layer is not enough');
  assert.ok(r.shadow2.clip.length <= 2);
  assert.ok(!r.shadow2.clip.includes('wall'));
  assert.ok(r.shadow2.worst.dist < Math.max(...r.shadow2.clip.map((id) => r.shadow.dist[id])));
  const [id] = r.shadow2.clip;
  assert.ok(r.shaded[id].shadowDist < r.shadow.dist[id]);
  // flats outside the clip are untouched by it; the wall gets only the Cast shadow
  const out = SAMPLE.find((f) => !f.background && !r.shadow2!.clip.includes(f.id))!;
  assert.equal(r.shaded[out.id].shadow, shadeFlat(out.hex, [{ ...r.shadow, on: true }]));
  assert.equal(r.shaded.wall.shadow, shadeFlat(SAMPLE[4].hex, [{ ...r.cast!, on: true }]));
});

test('on every light preset the starred skin is never muddy in shadow', () => {
  for (const light of LIGHTS) {
    const flats = sample(light);
    for (const space of ['srgb', 'linear'] as const) {
      const r = solveRecipe(flats, { space });
      const bad = muddyAll(flats, r).filter((w) => w.zone === 'shadow' && w.id === 'skin');
      assert.equal(bad.length, 0, `${light.label} ${space}: ${bad.map((w) => w.text)}`);
    }
  }
});

test('the Shadow layer is solved without the background, and the Cast shadow for it alone', () => {
  for (const light of LIGHTS) {
    const flats = sample(light);
    const r = solveRecipe(flats);
    assert.ok(!('wall' in r.shadow.dist), `${light.label}: the wall must not weigh in the Shadow`);
    assert.deepEqual(Object.keys(r.shadow.dist).sort(), ['hair', 'jacket', 'shirt', 'skin']);
    assert.ok(!r.shadow2?.clip.includes('wall'));
    assert.ok(r.cast, 'a background flat gets a Cast shadow');
    assert.deepEqual(Object.keys(r.cast.dist), ['wall']);
    assert.ok(r.cast.dist.wall < CLOSE, `${light.label}: wall ${r.cast.dist.wall.toFixed(3)}`);
    assert.ok(r.shaded.wall.shadowDist < CLOSE);
  }
  // no background flat, no Cast shadow
  assert.equal(solveRecipe(SAMPLE.filter((f) => !f.background)).cast, null);
});

// the demo measured each flat's share of the picture; here a flat's `share` only keeps a sliver from earning the second Shadow
test('a flat with a tiny shadow share never earns the second layer', () => {
  for (const light of LIGHTS) {
    const flats = sample(light).map((f) => (f.id === 'shirt' ? { ...f, share: 0.0006 } : f));
    const r = solveRecipe(flats);
    assert.ok(!r.shadow2?.clip.includes('shirt'), `${light.label}: Shirt is at 0.0006 of the canvas`);
  }
  // even when the tiny flat is the only one far off its target
  const flats = sample().filter((f) => f.id === 'skin' || f.id === 'hair' || f.id === 'shirt').map((f) => (f.id === 'shirt' ? { ...flatOf('shirt', 'Shirt', '#2030F0', 'cloth', DAY), share: 0.0004 } : f));
  const r = solveRecipe(flats);
  assert.ok(!r.shadow2?.clip.includes('shirt'));
});

test('the solve is deterministic on every preset', () => {
  for (const light of LIGHTS) assert.deepEqual(solveRecipe(sample(light)), solveRecipe(sample(light)));
});

test('the 8-bit recipe typed from the text reproduces the preview exactly', () => {
  for (const space of ['srgb', 'linear'] as const) {
    const flats = sample(LIGHTS[1]);
    const r = solveRecipe(flats, { space });
    const layers = [
      { name: 'Light', mode: r.light.mode, hex: r.light.hex, pct: r.light.pct, on: true },
      ...(r.shadow2 ? [{ name: 'Shadow 2', mode: r.shadow2.mode, hex: r.shadow2.hex, pct: r.shadow2.pct, on: true, note: `clipped to: ${r.shadow2.clip.join(', ')}` }] : []),
      { name: 'Shadow', mode: r.shadow.mode, hex: r.shadow.hex, pct: r.shadow.pct, on: true, note: 'clipped to the character' },
      { name: 'Cast shadow', mode: r.cast!.mode, hex: r.cast!.hex, pct: r.cast!.pct, on: true, note: 'on the background' },
    ];
    const text = recipeText(layers, 'test');
    assert.match(text, /Shadow: Multiply #[0-9A-F]{6} at \d+%, clipped to the character/);
    assert.match(text, /Cast shadow: Multiply #[0-9A-F]{6} at \d+%, on the background/);
    const typed = text
      .split(String.fromCharCode(10))
      .slice(1)
      .map((l) => parseRecipeLine(l)!);
    assert.equal(typed.length, layers.length);
    for (const l of typed) assert.ok(Number.isInteger(l.pct) && /^#[0-9A-F]{6}$/.test(l.hex));
    const named = (n: string) => typed.find((l) => l.name === n)!;
    const lightLine = named('Light');
    for (const f of flats) {
      const clipped = r.shadow2?.clip.includes(f.id);
      const stack = f.background ? [named('Cast shadow')] : [named('Shadow'), ...(clipped ? [named('Shadow 2')] : [])]; // bottom first
      assert.equal(shadeFlat(f.hex, stack.map((l) => ({ ...l, on: true })), space), r.shaded[f.id].shadow, `${f.id} shadow, ${space}`);
      // the light falls on the character; the wall stays as it is
      assert.equal(shadeFlat(f.hex, f.background ? [] : [{ ...lightLine, on: true }], space), r.shaded[f.id].light, `${f.id} light, ${space}`);
    }
  }
});

test('the muddy check flags grey-brown skin and passes a good one', () => {
  const skin = SAMPLE[0];
  const target = skin.targets.shadow;
  const good = toHex(target);
  assert.equal(muddyCheck(skin, good, target, 'shadow'), null);
  const muddy = '#7A6A62'; // the same darkness, the colour drained out
  const w = muddyCheck(skin, muddy, target, 'shadow');
  assert.ok(w && w.kind === 'colour');
  assert.match(w.text, /Skin goes grey-brown in shadow: it loses \d+% of its colour/);
  assert.match(w.text, /grey value is \d+% where the ramp has \d+%/);
  // skin that is only a little pale against a pale target is fine, but grey-beige skin trips the floor
  const paleTarget = hexToOklch('#BFAFA6');
  const floor = muddyCheck(skin, '#8C847F', paleTarget, 'shadow');
  assert.ok(floor && floor.kind === 'skin');
  // hair gone grey, and a hue drift
  const hair = SAMPLE[1];
  const hairTarget: [number, number, number] = [0.3, 0.06, 330];
  assert.ok(muddyCheck(hair, '#4A4648', hairTarget, 'shadow'));
  assert.ok(muddyCheck(hair, '#4A3A20', hairTarget, 'shadow')?.kind === 'hue');
  // and the full recipe on the sample lists only real problems, each tied to a flat
  const r = solveRecipe(SAMPLE);
  for (const x of muddyAll(SAMPLE, r)) assert.ok(SAMPLE.some((f) => f.id === x.id));
});

test('blending in sRGB and in linear light give different results, and different recipes', () => {
  const B = hexRgb('#E7AE8A');
  const L = hexRgb('#8A7FB5');
  const s = composite8(B, L, 'multiply', 80, 'srgb');
  const l = composite8(B, L, 'multiply', 80, 'linear');
  assert.notDeepEqual(s, l);
  assert.ok(Math.abs(s[0] - l[0]) + Math.abs(s[1] - l[1]) + Math.abs(s[2] - l[2]) > 10);
  const a = solveRecipe(SAMPLE, { space: 'srgb' });
  const b = solveRecipe(SAMPLE, { space: 'linear' });
  assert.notEqual(a.shadow.hex + a.shadow.pct, b.shadow.hex + b.shadow.pct);
  // the same typed layer lands on different pixels depending on where the app blends
  assert.notEqual(shadeFlat('#E7AE8A', [{ mode: 'multiply', hex: a.shadow.hex, pct: a.shadow.pct, on: true }], 'srgb'), shadeFlat('#E7AE8A', [{ mode: 'multiply', hex: a.shadow.hex, pct: a.shadow.pct, on: true }], 'linear'));
});

test('a grey skin flat that matches its grey target is not called muddy', () => {
  const skin = flatOf('skin', 'Skin', '#808080', 'skin', DAY);
  const target = skin.targets.shadow;
  assert.equal(muddyCheck(skin, toHex(target), target, 'shadow'), null);
});

test('the light layer is a visible colour, not a near-black Add', () => {
  for (const lightMode of ['add', 'screen'] as const) {
    const r = solveRecipe(SAMPLE, { lightMode });
    const [R, G, B] = hexRgb(r.light.hex);
    assert.ok(Math.max(R, G, B) >= 110, `${lightMode} ${r.light.hex}`);
  }
});

test('the recipe reports the worst flat with every layer on', () => {
  const r = solveRecipe(SAMPLE);
  assert.ok(r.shadowAll.id && r.shadowAll.dist >= 0 && r.lightAll.id);
  assert.ok(r.shadowAll.dist <= r.shadow.worst.dist + 1e-9);
});

// ── what the equal-weight, ramp-steps model adds ──────────────────────────────────────────────

test('targets are read from the ramp’s own steps, a hand-edited one honoured', () => {
  const spec = { ...newRamp(hexToOklch('#C9A15A'), 'r'), material: 'fur' as const, steps: 5 };
  const steps = generateRamp(spec);
  const t = targetsFrom(spec, steps);
  assert.deepEqual(t.shadow, steps.find((s) => s.step === 1)!.oklch);
  assert.deepEqual(t.light, steps.find((s) => s.step === -1)!.oklch);
  assert.deepEqual(t.rim, steps.find((s) => s.step === -2)!.oklch);
  // the user recoloured the first shadow step and the lightest: the targets follow
  const shadow: Oklch = [0.3, 0.08, 20];
  const rim: Oklch = [0.97, 0.02, 90];
  const edited = steps.map((s) => (s.step === 1 ? { ...s, oklch: shadow } : s.step === -2 ? { ...s, oklch: rim } : s));
  const e = targetsFrom(spec, edited);
  assert.deepEqual(e.shadow, shadow);
  assert.deepEqual(e.rim, rim);
  assert.deepEqual(e.light, t.light);
  // and the solve aims at the edit: the edited flat lands nearer its new shadow
  const mk = (tg: Targets) => ({ ...flatOf('a', 'A', '#C9A15A', 'fur', DAY), targets: tg });
  const other = flatOf('b', 'B', '#3F6E8C', 'cloth', DAY);
  const before = solveRecipe([mk(t), other]).shaded.a.shadow;
  const after = solveRecipe([mk(e), other]).shaded.a.shadow;
  assert.notEqual(before, after);
});

test('steps in the order the document keeps them give the same targets', () => {
  const spec = { ...newRamp(hexToOklch('#D8433B'), 'r'), steps: 7 };
  const steps = generateRamp(spec);
  assert.deepEqual(targetsFrom(spec, [...steps].reverse()), targetsFrom(spec, steps));
  // with seven steps the first darker step is +1 and the first lighter is -1, not the far ends
  const t = targetsFrom(spec, steps);
  assert.deepEqual(t.shadow, steps.find((s) => s.step === 1)!.oklch);
  assert.deepEqual(t.light, steps.find((s) => s.step === -1)!.oklch);
  assert.deepEqual(t.rim, steps.find((s) => s.step === -3)!.oklch);
});

test('a ramp with one side missing takes that side from generateRamp', () => {
  const spec = { ...newRamp(hexToOklch('#C9A15A'), 'r'), steps: 5 };
  const made = generateRamp(spec);
  const noLights = made.filter((s) => s.step >= 0);
  const a = targetsFrom(spec, noLights);
  assert.deepEqual(a.light, made.find((s) => s.step === -1)!.oklch);
  assert.deepEqual(a.rim, made.find((s) => s.step === -2)!.oklch);
  assert.deepEqual(a.shadow, made.find((s) => s.step === 1)!.oklch);
  const noShadows = made.filter((s) => s.step <= 0);
  const b = targetsFrom(spec, noShadows);
  assert.deepEqual(b.shadow, made.find((s) => s.step === 1)!.oklch);
  assert.deepEqual(b.light, made.find((s) => s.step === -1)!.oklch);
  // only the base: both sides generated
  assert.deepEqual(targetsFrom(spec, [{ step: 0, oklch: spec.base }]), targetsFrom(spec, made));
  // a base at white has no lighter side to make: the base stands in, and nothing is NaN
  const white = { ...newRamp([1, 0, 0], 'w'), steps: 5 };
  const w = targetsFrom(white, [{ step: 0, oklch: white.base }]);
  for (const o of [w.shadow, w.light, w.rim]) assert.ok(o.every(Number.isFinite));
});

test('every flat in the recipe counts the same, a starred one three times', () => {
  const a = flatOf('a', 'A', '#E7AE8A', 'skin', DAY);
  const b = flatOf('b', 'B', '#3F6E8C', 'cloth', DAY);
  const plain = solveRecipe([a, b]);
  near(plain.shadow.cost, (plain.shadow.dist.a + plain.shadow.dist.b) / 2, 1e-12);
  const starred = solveRecipe([{ ...a, star: true }, b]);
  near(starred.shadow.cost, (STAR_WEIGHT * starred.shadow.dist.a + starred.shadow.dist.b) / (STAR_WEIGHT + 1), 1e-12);
  // the star pulls the layer toward its flat, never away
  assert.ok(starred.shadow.dist.a <= plain.shadow.dist.a + 1e-9, `${starred.shadow.dist.a} vs ${plain.shadow.dist.a}`);
  // two identical flats weigh the same whichever is first
  const x = flatOf('x', 'X', '#E7AE8A', 'skin', DAY);
  const y = { ...x, id: 'y', name: 'Y' };
  const xy = solveRecipe([x, y]);
  const yx = solveRecipe([y, x]);
  assert.equal(xy.shadow.hex + xy.shadow.pct, yx.shadow.hex + yx.shadow.pct);
});

test('the background flag routes a flat to the Cast shadow', () => {
  const a = flatOf('a', 'A', '#E7AE8A', 'skin', DAY);
  const b = flatOf('b', 'B', '#7FB7C9', 'paper', DAY);
  const c = flatOf('c', 'C', '#D8433B', 'cloth', DAY);
  const none = solveRecipe([a, b, c]);
  assert.equal(none.cast, null);
  assert.deepEqual(Object.keys(none.shadow.dist).sort(), ['a', 'b', 'c']);
  const withBg = solveRecipe([a, { ...b, background: true }, c]);
  assert.ok(withBg.cast);
  assert.deepEqual(Object.keys(withBg.cast.dist), ['b']);
  assert.deepEqual(Object.keys(withBg.shadow.dist).sort(), ['a', 'c']);
  assert.deepEqual(shadowStack({ id: 'b', background: true }, withBg).map((l) => l.hex), [withBg.cast.hex]);
  assert.deepEqual(shadowStack({ id: 'a' }, withBg)[0].hex, withBg.shadow.hex);
  // the eyes decide what lands: the Cast shadow off leaves the wall as it is
  assert.deepEqual(shadowStack({ id: 'b', background: true }, withBg, { shadow: true, shadow2: true, cast: false, light: true }), []);
  // the light falls on the character: the wall has none
  const lit = solveRecipe([a, { ...b, background: true }, c]);
  assert.equal(lit.shaded.b.light, b.hex);
  // all flats background: they stand in as the character, with no Cast shadow
  const all = solveRecipe([{ ...a, background: true }, { ...b, background: true }]);
  assert.equal(all.cast, null);
  assert.deepEqual(Object.keys(all.shadow.dist).sort(), ['a', 'b']);
});

test('one flat alone solves, and none is refused', () => {
  const r = solveRecipe([flatOf('a', 'A', '#E7AE8A', 'skin', DAY)]);
  assert.equal(r.shadow2, null);
  assert.ok(/^#[0-9A-F]{6}$/.test(r.shadow.hex));
  assert.throws(() => solveRecipe([]), RangeError);
});

test('the muddy check follows the eyes: a layer switched off cannot muddy a flat', () => {
  const r = solveRecipe(SAMPLE);
  const off = { shadow: false, shadow2: false, cast: false, light: false };
  assert.deepEqual(muddyAll(SAMPLE, r, off), []);
  for (const w of muddyAll(SAMPLE, r)) assert.ok(/^#[0-9A-F]{6}$/.test(w.shaded) && /^#[0-9A-F]{6}$/.test(w.target));
});

test('fit words and the rim colour', () => {
  assert.equal(fitWord(0.01, 'Hair'), 'close');
  assert.equal(fitWord(0.04, 'Hair'), 'near, a little off on Hair');
  assert.equal(fitWord(0.08, 'Hair'), 'off on Hair');
  for (const l of LIGHTS) assert.ok(/^#[0-9A-F]{6}$/.test(rimColour(l)));
});

test('multiply opacity and colour survive the text round trip in linear light', () => {
  const r = solveRecipe(SAMPLE, { space: 'linear' });
  const line = parseRecipeLine(recipeText([{ name: 'Shadow', mode: 'multiply', hex: r.shadow.hex, pct: r.shadow.pct, on: true }], 'h').split(String.fromCharCode(10))[1])!;
  assert.equal(line.hex, r.shadow.hex);
  assert.equal(line.pct, r.shadow.pct);
});

test('add clips at white and the edge cases stay sound', () => {
  assert.deepEqual(composite8([255, 255, 255], [255, 255, 255], 'add', 100), [255, 255, 255]);
  assert.equal(muddyCheck({ id: 'a', name: 'A', material: 'cloth' }, '#000000', [0.3, 0.0, 0], 'shadow'), null);
});

// ── the demo's extremes: black, white, grey, saturated and near-neutral flats on every preset, strength, space and light mode ──

const SETS = [['#000000', '#FFFFFF', '#808080'], ['#FFFFFF', '#FFFFFF', '#FFFFFF'], ['#000000'], ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF'], ['#FEFEFE', '#010101', '#7F7F7F', '#0A0A0A', '#F5F5F5']];
const MATS = ['skin', 'fur', 'cloth', 'paper', 'cloth'] as const;
for (const set of SETS) {
  for (const light of LIGHTS) {
    for (const strength of ['grounded', 'expressive', 'extreme'] as const) {
      for (const space of ['srgb', 'linear'] as const) {
        for (const lightMode of ['add', 'screen'] as const) {
          test(`extreme ${set.join('')} ${light.id} ${strength} ${space} ${lightMode}`, () => {
            const flats = set.map((hex, i) => flatOf('f' + i, 'F' + i, hex, MATS[i % 5], light, { star: i === 0, intensity: strength }));
            const t = performance.now();
            const r = solveRecipe(flats, { space, lightMode });
            const ms = performance.now() - t;
            for (const s of [r.shadow, r.light, ...(r.shadow2 ? [r.shadow2] : [])]) {
              assert.ok(/^#[0-9A-F]{6}$/.test(s.hex), s.hex);
              assert.ok(Number.isInteger(s.pct) && s.pct >= 20 && s.pct <= 100, String(s.pct));
              assert.ok(Number.isFinite(s.cost));
            }
            assert.ok(ms < budget(400), `ms ${ms}`);
            for (const x of muddyAll(flats, r)) assert.ok(!/NaN|undefined/.test(x.text), x.text);
            // determinism
            assert.deepEqual(solveRecipe(flats, { space, lightMode }).shadow, r.shadow);
            // shaded matches shadeFlat
            for (const fl of flats) assert.equal(r.shaded[fl.id].shadow, shadeFlat(fl.hex, shadowStack(fl, r), space));
          });
        }
      }
    }
  }
}
