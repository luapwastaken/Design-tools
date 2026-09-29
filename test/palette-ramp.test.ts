import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaE, inSrgb, type Oklch } from '../src/shared/color/index.ts';
import { generateRamp, MATERIALS, newRamp, quietFor, regenerate } from '../src/shared/palette/ramp.ts';
import { toOklab } from '../src/shared/palette/space.ts';
import type { MaterialId, RampSpec, Swatch } from '../src/shared/types.ts';

const INTENSITIES: RampSpec['intensity'][] = ['grounded', 'expressive', 'extreme'];
const BASES: Oklch[] = [
  [0.55, 0.15, 30], // brick red
  [0.7, 0.12, 145], // leaf green
  [0.45, 0.14, 250], // blue
  [0.85, 0.08, 95], // pale straw
  [0.25, 0.05, 320], // dark plum
  [0.6, 0.004, 0], // grey
  [0.95, 0.02, 60], // near white
  [0.08, 0.02, 200], // near black
  [1, 0, 0], // white
  [0, 0, 0], // black
];
const spec = (base: Oklch, over: Partial<RampSpec> = {}): RampSpec => ({ ...newRamp(base, 'r'), ...over });
const arc = (a: number, b: number) => Math.abs((((b - a) % 360) + 540) % 360 - 180);
const abDistance = (x: Oklch, y: Oklch) => {
  const [, a1, b1] = toOklab(x);
  const [, a2, b2] = toOklab(y);
  return Math.hypot(a1 - a2, b1 - b2);
};
const sw = (id: string, oklch: Oklch, more: Partial<Swatch> = {}): Swatch => ({ id, name: '', role: null, oklch, type: 'process', ...more });

test('materials: the twelve from the spec, each with a label and a line of description', () => {
  const ids: MaterialId[] = ['skin', 'cloth', 'velvet', 'metal', 'plastic', 'glass', 'water', 'foliage', 'stone', 'wood', 'paper', 'fur'];
  assert.deepEqual(MATERIALS.map((m) => m.id), ids);
  for (const m of MATERIALS) assert.ok(m.label && m.describe.length > 20, m.id);
});

test('value never breaks: lightness falls step by step for every material, intensity and length', () => {
  for (const base of BASES) {
    for (const m of MATERIALS) {
      for (const intensity of INTENSITIES) {
        for (let steps = 3; steps <= 9; steps++) {
          for (const [hueShift, chromaCurve] of [[0, 0], [-1, -1], [1, 1]]) {
            const ramp = generateRamp(spec(base, { material: m.id, intensity, steps, hueShift, chromaCurve }));
            const at = `${base} ${m.id} ${intensity} ${steps} ${hueShift}`;
            assert.equal(ramp.length, steps, at);
            const lo = ramp[0].step;
            assert.deepEqual(ramp.map((r) => r.step), Array.from({ length: steps }, (_, i) => i + lo), at);
            assert.ok(lo <= 0 && ramp.at(-1)!.step >= 0, at);
            // a mid-value base is split evenly; only a near-white or near-black one gives a side away
            if (base[0] > 0.2 && base[0] < 0.8) assert.equal(lo, -Math.floor((steps - 1) / 2), at);
            for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i].oklch[0] < ramp[i - 1].oklch[0], `${at}: step ${ramp[i].step}`);
            for (const r of ramp) assert.ok(r.oklch.every(Number.isFinite) && (r.step === 0 || inSrgb(r.oklch)), `${at}: step ${r.step}`);
          }
        }
      }
    }
  }
});

test('5 steps by default, highlight to deep shadow around the base; an even count adds the extra step to the shadow side', () => {
  assert.deepEqual(generateRamp(spec([0.5, 0.1, 30])).map((r) => r.step), [-2, -1, 0, 1, 2]);
  assert.deepEqual(generateRamp(spec([0.5, 0.1, 30], { steps: 4 })).map((r) => r.step), [-1, 0, 1, 2]);
  assert.deepEqual(generateRamp(spec([0.5, 0.1, 30], { steps: 12 })).length, 9);
});

test('the base step is the base, exactly, even outside sRGB', () => {
  const wide: Oklch = [0.7, 0.3, 150];
  const ramp = generateRamp(spec(wide));
  assert.deepEqual(ramp.find((r) => r.step === 0)!.oklch, wide);
  assert.ok(ramp.filter((r) => r.step !== 0).every((r) => inSrgb(r.oklch)));
});

test('the ends turn toward the light and shadow colours, for every material and intensity', () => {
  for (const base of BASES.filter((b) => b[1] > 0.04)) {
    for (const m of MATERIALS) {
      for (const intensity of INTENSITIES) {
        const s = spec(base, { material: m.id, intensity });
        const ramp = generateRamp(s);
        const [top, bottom] = [ramp[0].oklch, ramp.at(-1)!.oklch];
        const at = `${base} ${m.id} ${intensity}`;
        // across the colour wheel the hue has no short way round to turn; the pull in OKLab still leans in
        if (arc(base[2], s.light[2]) < 120) assert.ok(arc(top[2], s.light[2]) < arc(base[2], s.light[2]), `${at}: highlight hue ${top[2]}`);
        if (arc(base[2], s.shadow[2]) < 120) assert.ok(arc(bottom[2], s.shadow[2]) < arc(base[2], s.shadow[2]), `${at}: deep shadow hue ${bottom[2]}`);
      }
    }
  }
  // and in OKLab, not only in hue
  const s = spec([0.55, 0.15, 30]);
  const ramp = generateRamp(s);
  assert.ok(abDistance(ramp[0].oklch, s.light) < abDistance(s.base, s.light));
  assert.ok(abDistance(ramp.at(-1)!.oklch, s.shadow) < abDistance(s.base, s.shadow));
});

test('no seam: a degree more or less of the light or shadow hue moves every step only a little', () => {
  let worst = 0;
  for (let h = 0; h < 360; h += 15) {
    for (const material of ['cloth', 'skin', 'metal', 'foliage'] as MaterialId[]) {
      const base: Oklch = [0.55, 0.12, h];
      for (let lh = 0; lh < 360; lh += 3) {
        for (const side of ['light', 'shadow'] as const) {
          const at = (hue: number) => {
            const s = spec(base, { material, intensity: 'extreme' });
            return generateRamp({ ...s, [side]: [s[side][0], 0.08, hue] });
          };
          const [a, b] = [at(lh), at(lh + 1)];
          a.forEach((r, i) => (worst = Math.max(worst, deltaE(r.oklch, b[i].oklch))));
        }
      }
    }
  }
  // the rest is sRGB's edge: near the blue primary a dark step's room for chroma grows fast with hue
  assert.ok(worst < 3, `a 1-degree turn moved a step by ΔE ${worst.toFixed(2)}`);
});

test('near white or black, the steps go to the side with room: a white base is all shadow, a black one all light', () => {
  const white = generateRamp(spec([1, 0, 0]));
  assert.deepEqual(white.map((r) => r.step), [0, 1, 2, 3, 4]);
  const black = generateRamp(spec([0, 0, 0]));
  assert.deepEqual(black.map((r) => r.step), [-4, -3, -2, -1, 0]);
  for (const ramp of [white, black, generateRamp(spec([0.97, 0.01, 90], { steps: 9 }))]) {
    for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i - 1].oklch[0] - ramp[i].oklch[0] > 0.01, `step ${ramp[i].step}`);
  }
});

test('a new ramp can take the light of the one it joins; the material stays its own', () => {
  const like = spec([0.5, 0.1, 30], { light: [0.9, 0.1, 250], shadow: [0.3, 0.1, 30], material: 'metal', intensity: 'extreme', steps: 7 });
  const r = newRamp([0.6, 0.1, 140], 'n', like);
  assert.deepEqual([r.light, r.shadow, r.intensity, r.steps, r.material], [like.light, like.shadow, 'extreme', 7, 'cloth']);
  assert.notEqual(r.light, like.light);
});

test('the light colour steers the highlight: a blue light cools it, an orange one warms it', () => {
  const base: Oklch = [0.6, 0.12, 150];
  const hue = (light: Oklch) => generateRamp(spec(base, { light }))[0].oklch[2];
  assert.ok(hue([0.9, 0.08, 250]) > 150, 'blue light');
  assert.ok(hue([0.9, 0.08, 60]) < 150, 'orange light');
  // a white light has no hue to give
  assert.ok(Math.abs(hue([0.95, 0, 0]) - 150) < 1);
});

test('metal saves its light for a sharp highlight that jumps toward the light colour; cloth spreads it', () => {
  const base: Oklch = [0.45, 0.12, 250];
  const metal = generateRamp(spec(base, { material: 'metal' }));
  const cloth = generateRamp(spec(base, { material: 'cloth' }));
  const jump = (r: typeof metal) => (r[0].oklch[0] - r[1].oklch[0]) / (r[1].oklch[0] - r[2].oklch[0]);
  assert.ok(jump(metal) > 2 * jump(cloth));
  const s = spec(base);
  assert.ok(abDistance(metal[0].oklch, s.light) < abDistance(cloth[0].oklch, s.light));
});

test('hue shift and chroma curve fine-tune the ramp', () => {
  const base: Oklch = [0.55, 0.15, 30];
  const turned = (hueShift: number) => arc(generateRamp(spec(base, { hueShift }))[0].oklch[2], base[2]);
  assert.ok(turned(1) > turned(0) && turned(0) > turned(-1));
  // positive keeps the middle steps nearer the base's chroma, negative lets them go sooner
  const chroma = (chromaCurve: number) => generateRamp(spec(base, { chromaCurve, steps: 9, material: 'stone' }))[5].oklch[1];
  assert.ok(chroma(1) > chroma(0) && chroma(0) > chroma(-1));
});

test('hero: the other ramps come out a little quieter, never the hero or a lone ramp', () => {
  const hero = spec([0.55, 0.15, 30], { hero: true });
  const other = spec([0.6, 0.12, 145]);
  assert.equal(quietFor(hero, true), 0);
  assert.equal(quietFor(other, false), 0);
  const q = quietFor(other, true);
  assert.ok(q > 0 && q < 0.3);
  const loud = generateRamp(other);
  const quiet = generateRamp(other, q);
  quiet.forEach((r, i) => {
    if (r.step === 0) assert.deepEqual(r.oklch, other.base);
    else assert.ok(r.oklch[1] < loud[i].oklch[1] && r.oklch[0] === loud[i].oklch[0], `step ${r.step}`);
  });
});

test('regenerate: a new ramp gets a swatch per step, grouped and numbered, with fresh ids', () => {
  const r = spec([0.55, 0.15, 30], { id: 'red' });
  const out = regenerate({ swatches: [sw('loose', [0.5, 0, 0])], ramps: [r] }, 'red');
  assert.equal(out.length, 6);
  assert.equal(out[0].id, 'loose');
  const ramp = out.slice(1);
  assert.deepEqual(ramp.map((w) => w.step), [-2, -1, 0, 1, 2]);
  assert.ok(ramp.every((w) => w.group === 'red' && w.type === 'process' && w.role === null && !w.edited));
  assert.equal(new Set(ramp.map((w) => w.id)).size, 5);
  assert.deepEqual(ramp[2].oklch, r.base);
});

test('regenerate keeps edited steps and ids, rewrites the rest, and keeps the ramp where it was', () => {
  const r = spec([0.55, 0.15, 30], { id: 'red' });
  const g = spec([0.7, 0.12, 145], { id: 'green' });
  const first = regenerate({ swatches: regenerate({ swatches: [], ramps: [r, g] }, 'red'), ramps: [r, g] }, 'green');
  const edited: Oklch = [0.9, 0.2, 90];
  const swatches = [sw('loose', [0.5, 0, 0]), ...first.map((w) => (w.group === 'red' && w.step === 1 ? { ...w, oklch: edited, edited: true } : w))];
  const changed = { ...r, material: 'metal' as const, intensity: 'extreme' as const };
  const out = regenerate({ swatches, ramps: [changed, g] }, 'red');

  assert.deepEqual(out.map((w) => w.id), swatches.map((w) => w.id));
  const red = out.filter((w) => w.group === 'red');
  const kept = red.find((w) => w.step === 1)!;
  assert.deepEqual(kept.oklch, edited);
  assert.equal(kept.edited, true);
  for (const w of red.filter((w) => w.step !== 1 && w.step !== 0)) {
    assert.notDeepEqual(w.oklch, swatches.find((x) => x.id === w.id)!.oklch, `step ${w.step} was rewritten`);
  }
  assert.deepEqual(out.filter((w) => w.group === 'green'), swatches.filter((w) => w.group === 'green'));
});

test('regenerate follows a new step count: new steps are added, dropped ones go, the rest keep their ids', () => {
  const r = spec([0.55, 0.15, 30], { id: 'red' });
  const five = regenerate({ swatches: [], ramps: [r] }, 'red');
  const seven = regenerate({ swatches: five, ramps: [{ ...r, steps: 7 }] }, 'red');
  assert.deepEqual(seven.map((w) => w.step), [-3, -2, -1, 0, 1, 2, 3]);
  for (const w of five) assert.equal(seven.find((x) => x.step === w.step)!.id, w.id);
  const three = regenerate({ swatches: seven, ramps: [{ ...r, steps: 3 }] }, 'red');
  assert.deepEqual(three.map((w) => w.id), seven.filter((w) => Math.abs(w.step!) <= 1).map((w) => w.id));
  // a hand-edited step past the new ends stays, in its place
  const mine = seven.map((w) => (w.step === -3 ? { ...w, oklch: [0.99, 0.01, 90] as Oklch, edited: true } : w));
  const kept = regenerate({ swatches: mine, ramps: [{ ...r, steps: 3 }] }, 'red');
  assert.deepEqual(kept.map((w) => w.step), [-3, -1, 0, 1]);
  assert.equal(kept[0].id, mine[0].id);
});

test('a base made again takes the ramp name its file kept', () => {
  const r = spec([0.55, 0.15, 30], { id: 'red', name: 'Hair' });
  const out = regenerate({ swatches: [sw('x', [0.7, 0.1, 30], { group: 'red', step: -1 })], ramps: [r] }, 'red');
  assert.equal(out.find((w) => w.step === 0)!.name, 'Hair');
  assert.equal(out.find((w) => w.step === -1)!.name, '');
});

test('regenerate: the hero makes the other ramps quieter; an unknown ramp changes nothing', () => {
  const r = spec([0.55, 0.15, 30], { id: 'red' });
  const g = spec([0.7, 0.12, 145], { id: 'green' });
  const alone = regenerate({ swatches: [], ramps: [r, g] }, 'green');
  const quiet = regenerate({ swatches: alone, ramps: [{ ...r, hero: true }, g] }, 'green');
  quiet.forEach((w, i) => {
    if (w.step === 0) assert.deepEqual(w.oklch, alone[i].oklch);
    else assert.ok(w.oklch[1] < alone[i].oklch[1], `step ${w.step}`);
  });
  const swatches = [sw('a', [0.5, 0.1, 10])];
  assert.equal(regenerate({ swatches, ramps: [r] }, 'nope'), swatches);
});
