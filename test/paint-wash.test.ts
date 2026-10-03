import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipTip, loadedOf } from '../src/renderer/tools/illustration/paint-sources.ts';
import { PAPER_RGB } from '../src/renderer/tools/illustration/paint/paper.ts';
import { filmStrength, headStrength, makeBrush, wetStrength } from '../src/renderer/tools/illustration/paint/bristles.ts';
import { brushPaint } from '../src/renderer/tools/illustration/paint/stroke.ts';
import { FILM, BRISTLES, WET } from '../src/renderer/tools/illustration/paint/tuning.ts';
import { WASH_THICK, washColour, washRange, washRgb } from '../src/renderer/tools/illustration/paint/wash.ts';
import { deltaE, toOklch, type Oklch } from '../src/shared/color/index.ts';
import { layer15, linear15, reflectance15 } from '../src/shared/paint/km15.ts';
import { PIGMENTS } from '../src/shared/paint/pigments.ts';
import { budget } from './perf.ts';

const tube = (id: string) => loadedOf(PIGMENTS.find((p) => p.id === id)!);
const ramp = (oklch: Oklch) => loadedOf({ id: 'r', name: 'Ramp', oklch, tint: 1, opacity: 0.6, granulation: 0, staining: 0.4 }, true);
const paper = toOklch({ mode: 'lrgb', r: PAPER_RGB[0], g: PAPER_RGB[1], b: PAPER_RGB[2] });

test('the wash is the paint at a film strength, laid as a glaze over bare paper', () => {
  // the composite's middle-of-a-wash thickness, written out from tuning.ts
  assert.equal(WASH_THICK, WET.thick * (WET.wash + (1 - WET.wash) * WET.headAmount) * (1 - WET.hollow));
  const paint = tube('alizarin');
  const p = brushPaint(paint, 'wet');
  const x = WASH_THICK * wetStrength(0.4);
  const bare = reflectance15(PAPER_RGB);
  const want = linear15(Array.from(bare, (r, i) => layer15(p.K[i], p.S, x, r)));
  washRgb(paint, wetStrength(0.4)).forEach((v, c) => assert.ok(Math.abs(v - want[c]) < 1e-12, `channel ${c}`));
  // strength scales K and S together, which a layer reads as thickness: a paint twice as strong at half the thickness is the same wash
  const strong = { ...p, K: p.K.map((k) => 2 * k), S: 2 * p.S };
  const same = linear15(Array.from(bare, (r, i) => layer15(strong.K[i], strong.S, x / 2, r)));
  want.forEach((v, c) => assert.ok(Math.abs(v - same[c]) < 1e-9, `scaling, channel ${c}`));
});

test('a stroke settles to the wash of its run-down film: the engine’s own head strength with the hairs dry', () => {
  for (const load of [0.05, 0.3, 0.4, 0.7, 1]) {
    const b = makeBrush({ kind: 'round', tool: 'paint', medium: 'wet', size: 80, load, seed: 3 });
    b.loadMean = 0;
    const settled = filmStrength(load, 80, 1e9);
    assert.ok(Math.abs(settled - wetStrength(load) * headStrength(b)) < 1e-12, `load ${load}`);
    // it holds a share of the start's paint (the film is only part replaced) and never more than the start
    assert.ok(settled < wetStrength(load) && settled > 0.5 * wetStrength(load), `load ${load}`);
  }
});

test('the film runs down with travel, as the brush’s own hairs do', () => {
  const R = 1 - (1 - FILM) ** BRISTLES.spread.wet;
  const run = (l: number) => WET.strength.floor + WET.strength.slope * l;
  for (const size of [20, 40, 80, 140, 250]) {
    for (const load of [0.3, 0.7, 1]) {
      let last = Infinity;
      for (const travel of [0, 250, 700, 1400, 3000]) {
        const model = filmStrength(load, size, travel);
        assert.ok(model <= last + 1e-12, `size ${size} Load ${load}: rises at ${travel}`);
        last = model;
        // the same from real brushes: their hairs, run down travel / capacity, laid at the paint's strength
        let held = 0;
        let n = 0;
        for (let seed = 1; seed <= 24; seed++) {
          const b = makeBrush({ kind: 'round', tool: 'paint', medium: 'wet', size, load, seed });
          for (const h of b.hairs) {
            held += run(Math.max(0, h.load - travel / b.capacity));
            n++;
          }
        }
        const truth = wetStrength(load) * (1 - R + (R * (held / n)) / run(load));
        assert.ok(Math.abs(model - truth) < 0.012 * truth, `size ${size} Load ${load} at ${travel} px: ${model} against ${truth}`);
      }
    }
  }
  // a small brush holds out longer than a large one (a low Load is dry well before 1200 px, at any size)
  for (const [load, travel] of [[0.4, 250], [1, 1200]]) {
    const [small, mid, large] = [40, 80, 250].map((size) => filmStrength(load, size, travel));
    assert.ok(small > mid && mid > large, `Load ${load}: ${small} ${mid} ${large}`);
  }
});

test('the chip is the middle of a stroke’s run: as far from its start as from its far end', () => {
  for (const p of PIGMENTS) {
    const l = loadedOf(p);
    for (const size of [14, 40, 80, 250]) {
      for (const load of [0.1, 0.4, 0.7, 1]) {
        const { first, last } = washRange(l, load, size);
        const chip = washColour(l, load, size);
        const [a, b, span] = [deltaE(chip, first), deltaE(chip, last), deltaE(first, last)];
        // each end within about half the span, so a stroke is never further from the chip than that
        assert.ok(Math.max(a, b) <= 0.55 * span + 0.2, `${p.id} Size ${size} Load ${load}: ${a} ${b} of ${span}`);
      }
    }
  }
});

test('a smaller brush makes a darker wash: it holds out longer, and a narrow one is mostly rim', () => {
  for (const id of ['ultra', 'dioxazine', 'cadred', 'lampblack']) {
    const l = tube(id);
    for (const load of [0.4, 0.8, 1]) {
      let prev = -Infinity;
      for (const size of [6, 10, 14, 20, 30, 40, 80, 140, 250]) {
        const lightness = washColour(l, load, size)[0];
        assert.ok(lightness >= prev - 1e-9, `${id} Load ${load}: Size ${size} (${lightness}) is darker than the one below (${prev})`);
        prev = lightness;
      }
    }
  }
  // from Size 30 up the rim's tail no longer reaches the middle: only the run-down differs, by a few ΔE00 at most
  const ultra = tube('ultra');
  assert.ok(deltaE(washColour(ultra, 1, 80), washColour(ultra, 1, 140)) < 3);
});

test('a diluted Ultramarine is paler and slightly cyan: the chip shows what km.ts makes of it', () => {
  const ultra = PIGMENTS.find((p) => p.id === 'ultra')!;
  const full = washColour(tube('ultra'), 1, 80);
  const thin = washColour(tube('ultra'), 0.3, 80);
  assert.ok(thin[0] > full[0] && full[0] > ultra.oklch[0] + 0.2, `lightness ${thin[0]} ${full[0]} ${ultra.oklch[0]}`);
  assert.ok(thin[2] < full[2] - 10 && full[2] < ultra.oklch[2] - 20, `hue ${thin[2]} ${full[2]} ${ultra.oklch[2]}`);
  assert.ok(thin[2] > 190 && thin[2] < 225, `Load 30 reads cyan-blue, hue ${thin[2]}`);
});

test('a lower Load is never a darker wash, for every coloured tube', () => {
  // white is the one tube lighter than the paper, so more of it only brightens the sheet
  for (const p of PIGMENTS.filter((q) => q.id !== 'tiwhite')) {
    const l = loadedOf(p);
    let prev = washColour(l, 0.05, 80)[0];
    for (let load = 10; load <= 100; load += 5) {
      const now = washColour(l, load / 100, 80)[0];
      assert.ok(now <= prev + 1e-9, `${p.id}: Load ${load} is lighter (${now}) than ${load - 5} (${prev})`);
      prev = now;
    }
  }
  // and a wash of white barely shows on the paper at any Load
  for (const load of [0.05, 0.3, 1]) assert.ok(deltaE(washColour(tube('tiwhite'), load, 80), paper) < 1, `white at ${load}`);
});

test('a palette colour is laid harder, so at Load 100 its wash lands on the swatch (within ΔE00 10)', () => {
  for (const o of [[0.62, 0.12, 40], [0.55, 0.1, 250], [0.3, 0.08, 300], [0.9, 0.05, 100], [0.45, 0.15, 150], [0.75, 0.18, 330]] as Oklch[]) {
    const wash = washColour(ramp(o), 1, 80);
    assert.ok(deltaE(o, wash) <= 10, `${o.join(' ')} → ${wash.join(' ')}`);
    // the same paint without the push is a far paler wash: the chip must carry the push
    const plain = washColour({ ...ramp(o), swatch: false }, 1, 80);
    assert.ok(plain[0] >= wash[0] - 1e-9, 'unpushed is no darker');
  }
  assert.ok(washColour({ ...ramp([0.3, 0.08, 300]), swatch: false }, 1, 80)[0] > 0.6);
});

test('working out the chip is cheap enough to do on every render of the bar', () => {
  const paint = tube('ultra');
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) washColour(paint, (5 + (i % 96)) / 100, 10 + (i % 300));
  assert.ok(performance.now() - t0 < budget(150), `${performance.now() - t0} ms for 2000`);
});

test('the chip’s tooltip names the paint and the Load, and keeps the paint’s own colour', () => {
  const ultra = PIGMENTS.find((p) => p.id === 'ultra')!;
  const hex = '#26358C';
  assert.equal(chipTip('wet', 'round', ultra.name, ultra.oklch, 70), `Ultramarine Blue · a wash at Load 70 looks like this. Paint colour ${hex}.`);
  assert.equal(chipTip('wet', 'flat', ultra.name, ultra.oklch, 30), `Ultramarine Blue · a wash at Load 30 looks like this. Paint colour ${hex}.`);
  // the Dry brush lays streaks, not a wash: its chip is the paint, and says so
  assert.match(chipTip('wet', 'dry', ultra.name, ultra.oklch, 70)!, /not a wash, so this is the paint colour #26358C/);
  // gouache's chip is the paint: nothing to add
  assert.equal(chipTip('dry', 'flat', ultra.name, ultra.oklch, 70), null);
});
