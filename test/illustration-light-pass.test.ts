// The colour pass on Light & preview: a metal that reflects a soft room, creased cloth, back light that
// stays the ramp's hue and dies in the middle of a solid body, no jump as the sun crosses the plane,
// a soft shadow on the ground, finishes, the colours a light needs, and a step bar for any ramp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOklch, type Oklch } from '../src/shared/color/index.ts';
import { CLOTHS } from '../src/renderer/tools/illustration/cloth.ts';
import { FINISH_PRESETS, finishOf, finishPresetOf } from '../src/renderer/tools/illustration/finish.ts';
import { nearOne, neededColours } from '../src/renderer/tools/illustration/needed.ts';
import { horizonsOf, lookOf, newStats, read, shade, surface, warm, type Light, type Look, type LookIn, type Shape } from '../src/renderer/tools/illustration/shade.ts';
import { addRamp, emptyDoc, lookForAll, rampOf, setSpec, stepsOf } from '../src/renderer/tools/illustration/doc.ts';

const RAMP: Oklch[] = [
  [0.9, 0.06, 75],
  [0.76, 0.12, 55],
  [0.62, 0.14, 40],
  [0.45, 0.115, 30],
  [0.3, 0.08, 18],
];
const UPPER_LEFT: Light = { azimuth: 320, elevation: 35 };
const lookFor = (material: LookIn['material'], over: Partial<LookIn> = {}): Look => lookOf({ steps: RAMP, material, light: [0.95, 0.05, 85], surround: [0.5, 0, 0], ...over });
const lum = (px: Uint8ClampedArray, p: number) => px[p] + px[p + 1] + px[p + 2];
const render = (shape: Shape, light: Light, size: number, look: Look, fold?: 'curtain' | 'drape' | 'crumple') => {
  const px = new Uint8ClampedArray(size * size * 4);
  shade(surface(shape, size, fold), look, light, px);
  return px;
};

/** mean brightness of the opaque pixels in the left and right halves, and the top and bottom */
function halves(px: Uint8ClampedArray, size: number) {
  const sum = { left: 0, right: 0, top: 0, bottom: 0 };
  const n = { left: 0, right: 0, top: 0, bottom: 0 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      if (px[p + 3] !== 255) continue;
      for (const k of [x < size / 2 ? 'left' : 'right', y < size / 2 ? 'top' : 'bottom'] as const) {
        sum[k] += lum(px, p);
        n[k]++;
      }
    }
  }
  return { left: sum.left / n.left, right: sum.right / n.right, top: sum.top / n.top, bottom: sum.bottom / n.bottom };
}

test('metal reflects a soft room that follows the light: bright on the side the sun is, with no hard horizon', () => {
  const size = 160;
  const metal = lookFor('metal');
  const [fromLeft, fromRight] = [halves(render('sphere', { azimuth: 270, elevation: 12 }, size, metal), size), halves(render('sphere', { azimuth: 90, elevation: 12 }, size, metal), size)];
  assert.ok(fromLeft.left > fromLeft.right + 40, `lit from the left: ${fromLeft.left} against ${fromLeft.right}`);
  assert.ok(fromRight.right > fromRight.left + 40, `lit from the right: ${fromRight.right} against ${fromRight.left}`);
  // no step in the middle of the ball anywhere near as hard as the old fixed horizon, and a duller Gloss softens it further
  const steepest = (look: Look, light: Light) => {
    const px = render('sphere', light, size, look);
    let best = 0;
    for (let y = size * 0.25; y < size * 0.75; y++) best = Math.max(best, Math.abs(lum(px, (Math.floor(y) * size + size / 2) * 4) - lum(px, (Math.floor(y + 1) * size + size / 2) * 4)));
    return best;
  };
  assert.ok(steepest(metal, UPPER_LEFT) < 30 && steepest(metal, { azimuth: 270, elevation: 12 }) < 30, 'a soft room');
  assert.ok(steepest(lookFor('metal', { surface: { gloss: 0 } }), UPPER_LEFT) < steepest(metal, UPPER_LEFT), 'less Gloss, softer still');
  // not four flat quadrants under raking light: each quarter of the ball has a gradient of its own
  const px = render('sphere', { azimuth: 270, elevation: 12 }, size, metal);
  const quarters = [new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>()];
  for (let y = size * 0.25; y < size * 0.75; y += 2) {
    for (let x = size * 0.25; x < size * 0.75; x += 2) {
      const p = (Math.floor(y) * size + Math.floor(x)) * 4;
      if (px[p + 3] === 255) quarters[(y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1)].add(Math.round(lum(px, p) / 6));
    }
  }
  assert.ok(quarters.every((q) => q.size >= 6), `a gradient in each quarter, not a flat one (${quarters.map((q) => q.size)})`);
});

test('a metal cube’s faces are not one flat tone each', () => {
  const size = 200;
  const px = render('cube', UPPER_LEFT, size, lookFor('metal'));
  // the lit left face: its top and bottom differ
  const at = (x: number, y: number) => lum(px, (Math.round(y) * size + Math.round(x)) * 4);
  assert.ok(Math.abs(at(size * 0.3, size * 0.45) - at(size * 0.3, size * 0.68)) > 12, 'a gradient over the face');
});

test('a ball and a block stand on a soft shadow of their own, in the ramp’s shadow colour; a cloth hangs and has none', () => {
  const size = 160;
  for (const light of [UPPER_LEFT, { azimuth: 0, elevation: -45 }]) {
    const px = render('sphere', light, size, lookFor('stone'));
    // just under the ball, at its middle: the contact shadow, warm and dark
    const p = (Math.round(size * 0.815) * size + size / 2) * 4;
    assert.ok(px[p + 3] > 20, `a shadow under the ball (${px[p + 3]})`);
    assert.ok(px[p] > px[p + 2] && Math.max(px[p], px[p + 1], px[p + 2]) < 70, `tinted toward the ramp’s shadow: ${[...px.subarray(p, p + 4)]}`);
  }
  assert.ok(surface('cube', size).foot && surface('sphere', size).foot && !surface('cloth', size).foot);
});

test('back light on thin things glows in the ramp’s own hue, and on a solid body only at its rim', () => {
  const hueGap = (a: Oklch, b: Oklch) => Math.abs((((a[2] - b[2]) % 360) + 540) % 360 - 180);
  const teal: Oklch[] = [[0.9, 0.06, 195], [0.75, 0.09, 195], [0.55, 0.1, 195], [0.4, 0.08, 195], [0.25, 0.05, 195]];
  const at = (lut: Uint8ClampedArray, i: number) => toOklch({ mode: 'rgb', r: lut[i * 3] / 255, g: lut[i * 3 + 1] / 255, b: lut[i * 3 + 2] / 255 });
  const cloth = lookOf({ steps: teal, material: 'cloth', light: [0.95, 0.05, 85], surround: null });
  for (const i of [60, 128, 200]) assert.ok(hueGap(at(cloth.glow, i), at(cloth.lut, i)) < 16, `the glow of cloth stays teal at ${i}: ${hueGap(at(cloth.glow, i), at(cloth.lut, i))}`);
  const skin = lookOf({ steps: teal, material: 'skin', light: [0.95, 0.05, 85], surround: null });
  assert.ok(hueGap(at(skin.glow, 128), at(skin.lut, 128)) > 25, 'skin still turns its glow warm');
  assert.equal(finishOf('cloth').translucency, 0.25, 'cloth lets a quarter of the light through by default');
  // a ball and a block lit from behind: the middle is dark, the glow lives at the edge
  const size = 120;
  for (const shape of ['sphere', 'cube'] as Shape[]) {
    const look = lookFor('foliage');
    const px = render(shape, { azimuth: 0, elevation: -60 }, size, look);
    const stats = newStats();
    shade(surface(shape, size), look, { azimuth: 0, elevation: -60 }, new Uint8ClampedArray(size * size * 4), stats);
    const glow = stats.glow.reduce((a, b) => a + b, 0);
    assert.ok(glow < stats.total * 0.5, `a solid ${shape} is not mostly glow (${glow} of ${stats.total})`);
    assert.ok(lum(px, (size / 2 * size + size / 2) * 4) < 500, `${shape} middle`);
  }
});

test('the shading does not jump as the sun crosses the picture plane', () => {
  const size = 140;
  const sf = surface('cloth', size, 'drape');
  const look = lookFor('cloth', { surface: { translucency: 0.5 } });
  const [a, b] = [new Uint8ClampedArray(size * size * 4), new Uint8ClampedArray(size * size * 4)];
  const change = (from: number, to: number) => {
    shade(sf, look, { azimuth: 270, elevation: from }, a);
    shade(sf, look, { azimuth: 270, elevation: to }, b);
    let [total, n] = [0, 0];
    for (let p = 0; p < a.length; p += 4) if (a[p + 3] === 255 && b[p + 3] === 255) [total, n] = [total + Math.abs(lum(a, p) - lum(b, p)), n + 1];
    return total / n;
  };
  const [before, across, after] = [change(2, 1), change(1, 0), change(0, -1)];
  assert.ok(across < before * 2 + 1 && after < before * 2 + 1, `a degree across the plane changes as much as a degree beside it (${before.toFixed(1)}, ${across.toFixed(1)}, ${after.toFixed(1)})`);
  // an opaque cloth too: its folds shade each other on both sides
  const opaque = lookFor('cloth', { surface: { translucency: 0 } });
  shade(sf, opaque, { azimuth: 270, elevation: 1 }, a);
  shade(sf, opaque, { azimuth: 270, elevation: -1 }, b);
  let [total, n] = [0, 0];
  for (let p = 0; p < a.length; p += 4) if (a[p + 3] === 255) [total, n] = [total + Math.abs(lum(a, p) - lum(b, p)), n + 1];
  assert.ok(total / n < 40, `${(total / n).toFixed(1)}`);
});

test('a crumple is long creases at many angles with a finer set across them, and shows its form in front light', () => {
  const c = CLOTHS.crumple;
  const bins = new Array(8).fill(0);
  let strong = 0;
  for (let i = 0; i < 120; i++) {
    for (let j = 0; j < 120; j++) {
      const [x, y, e] = [-0.55 + (1.1 * i) / 120, -0.65 + (1.3 * j) / 120, 1e-3];
      const [gx, gy] = [(c.z(x + e, y) - c.z(x - e, y)) / (2 * e), (c.z(x, y + e) - c.z(x, y - e)) / (2 * e)];
      if (Math.hypot(gx, gy) < 0.25) continue;
      bins[Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 8) % 8]++;
      strong++;
    }
  }
  assert.ok(strong > 2000 && bins.every((n) => n / strong > 0.03), `slopes face every way: ${bins.map((n) => (n / strong).toFixed(2))}`);
  // the cloth is not a straight-sided rectangle
  const sides = Array.from({ length: 40 }, (_, i) => c.half?.(-0.6 + i * 0.03) ?? 0);
  assert.ok(Math.max(...sides) - Math.min(...sides) > 0.02, 'wavy sides');
  // lit from the front it still has form: the picture is not blank
  const px = render('cloth', { azimuth: 0, elevation: 90 }, 140, lookFor('cloth'), 'crumple');
  let [s1, s2, n] = [0, 0, 0];
  for (let p = 0; p < px.length; p += 4) if (px[p + 3] === 255) [s1, s2, n] = [s1 + lum(px, p), s2 + lum(px, p) ** 2, n + 1];
  assert.ok(Math.sqrt(s2 / n - (s1 / n) ** 2) > 10, 'front light still reads the creases');
});

test('the folds’ horizons can be worked a piece at a time ahead of the first draw', () => {
  const sf = surface('cloth', 100, 'drape');
  assert.ok(horizonsOf(sf, 2).ready === 2 && !sf.horizons!.front.slice(0, 100 * 100).every((v) => v === 0), 'two azimuths are done');
  let calls = 0;
  while (!warm('drape', 100) && calls < 20) calls++;
  assert.equal(sf.horizons!.ready, 8);
  assert.ok(calls <= 8);
  const hz = sf.horizons;
  assert.equal(horizonsOf(sf), hz, 'and drawing then works nothing out');
});

test('Step use counts every step of a long ramp, not the first nine', () => {
  const steps: Oklch[] = Array.from({ length: 13 }, (_, i) => [0.95 - i * 0.055, 0.08, 60]);
  const look = lookOf({ steps, material: 'cloth', light: [0.95, 0.05, 85], surround: null });
  const stats = newStats(13);
  shade(surface('sphere', 96), look, UPPER_LEFT, new Uint8ClampedArray(96 * 96 * 4), stats);
  assert.equal(stats.steps.length, 13);
  assert.ok(stats.steps.every((v) => Number.isFinite(v)) && [...stats.steps].slice(9).some((v) => v > 0), 'the deep steps are counted');
  const counted = [...stats.steps].reduce((a, b) => a + b, 0) + stats.glow.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(counted - stats.total) < 1e-6, `${counted} of ${stats.total}`);
});

test('a glow or a highlight under the pointer reads its colour', () => {
  const sf = surface('cloth', 120);
  const look = lookFor('cloth', { surface: { translucency: 0.8 } });
  const r = read(sf, look, { azimuth: 300, elevation: -45 }, 60, 50);
  assert.equal(r.kind, 'glow');
  assert.ok(r.kind === 'glow' && r.rgb.every((v) => v >= 0 && v <= 255));
});

test('the colours a light needs include the shadow it throws, and are told apart from those in the palette', () => {
  const look = lookFor('stone');
  const stats = newStats();
  shade(surface('sphere', 96), look, UPPER_LEFT, new Uint8ClampedArray(96 * 96 * 4), stats);
  const list = neededColours(stats, look, RAMP, 'Rust');
  const cast = list.find((n) => n.kind === 'cast');
  assert.ok(cast && cast.name === 'Rust cast shadow' && cast.oklch[0] < RAMP[4][0], JSON.stringify(list.map((n) => n.name)));
  assert.ok(nearOne(cast!.oklch, [...RAMP, cast!.oklch]) && !nearOne(cast!.oklch, RAMP));
  // a ball lit from the upper left has some of it in the ground's reach, enough for its bounce
  const bounce = neededColours(stats, lookFor('stone', { surround: [0.5, 0.06, 150] }), RAMP, 'Rust');
  assert.ok(bounce.length >= 1);
});

test('finishes: Satin, Silk, Linen and Gold set the Surface numbers, Gold on a metal, and a ramp reads which it has', () => {
  assert.deepEqual(FINISH_PRESETS.map((p) => p.label), ['Satin', 'Silk', 'Linen', 'Gold']);
  for (const p of FINISH_PRESETS) {
    const material = p.material ?? 'cloth';
    assert.equal(finishPresetOf({ material, surface: p.surface }), p.id);
    const f = finishOf(material, p.surface);
    for (const k of ['gloss', 'softness', 'translucency', 'sheen', 'grain', 'ambient'] as const) assert.ok(f[k] >= 0 && f[k] <= 1, `${p.id} ${k}`);
  }
  assert.ok(finishOf('cloth', FINISH_PRESETS[0].surface).grain > 0.5 && finishOf('cloth', FINISH_PRESETS[0].surface).gloss > finishOf('cloth').gloss, 'satin is glossier, with a streak');
  assert.equal(FINISH_PRESETS.find((p) => p.id === 'gold')!.material, 'metal');
  assert.equal(finishPresetOf({ material: 'cloth', surface: undefined }), 'own');
  assert.equal(finishPresetOf({ material: 'cloth', surface: { gloss: 0.9 } }), 'custom');
});

test('Apply look to every ramp: only the look goes to all (intensity, push, hue shift, saturation); each ramp keeps its colour, material and finish', () => {
  let d = emptyDoc();
  for (const base of [[0.6, 0.12, 30], [0.5, 0.1, 140], [0.7, 0.09, 250]] as Oklch[]) d = addRamp(d, base, 'R').doc;
  const [a, b, c] = d.ramps;
  d = setSpec(d, a.id, { material: 'metal', intensity: 'extreme', push: 1.8, hueShift: 0.4, chromaCurve: -0.3, surface: { gloss: 0.7, grain: 0.2 } });
  d = setSpec(d, c.id, { material: 'skin', surface: { softness: 0.9 } });
  const bases = d.ramps.map((r) => r.base.join());
  const next = lookForAll(d, a.id);
  for (const id of [b.id, c.id]) {
    const r = rampOf(next, id)!;
    assert.equal(r.intensity, 'extreme');
    assert.equal(r.push, 1.8);
    assert.equal(r.hueShift, 0.4);
    assert.equal(r.chromaCurve, -0.3);
  }
  // the material and the finish are not part of the look: a mixed-material study stays mixed
  assert.equal(rampOf(next, b.id)!.material, rampOf(d, b.id)!.material);
  assert.equal(rampOf(next, c.id)!.material, 'skin');
  assert.deepEqual(rampOf(next, c.id)!.surface, { softness: 0.9 });
  assert.equal(rampOf(next, b.id)!.surface, rampOf(d, b.id)!.surface);
  assert.deepEqual(next.ramps.map((r) => r.base.join()), bases);
  assert.notDeepEqual(stepsOf(next, b.id).map((w) => w.oklch), stepsOf(d, b.id).map((w) => w.oklch), 'the other ramps are regenerated for the new look');
  assert.equal(lookForAll(d, 'nope'), d);
});
