import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgb255, type Oklch } from '../src/shared/color/index.ts';
import { fromOklab, toOklab } from '../src/shared/palette/space.ts';
import { DEFAULT_FINISH, finishOf, type Finish } from '../src/renderer/tools/illustration/finish.ts';
import { direction, frame, lookOf, plainLook, rampLut, read, shade, surface, tone, transmission, type Light, type Look, type Shape } from '../src/renderer/tools/illustration/shade.ts';
import { budget } from './perf.ts';

// highlight, light, base, shadow, deep shadow: a warm-lit terracotta
const RAMP: Oklch[] = [
  [0.9, 0.06, 75],
  [0.76, 0.12, 55],
  [0.62, 0.14, 40],
  [0.45, 0.115, 30],
  [0.3, 0.08, 18],
];
const UPPER_LEFT: Light = { azimuth: 320, elevation: 35 };
const SIZE = 96;
const at = (lut: Uint8ClampedArray, i: number) => [...lut.subarray(i * 3, i * 3 + 3)];

function render(shape: Shape, light: Light, banded = false, size = SIZE, look: Look = plainLook(RAMP, banded)) {
  const px = new Uint8ClampedArray(size * size * 4);
  shade(surface(shape, size), look, light, px);
  return px;
}

test('the light points where the azimuth says: 0 up, 90 right, 320 upper left', () => {
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(direction({ azimuth: 0, elevation: 0 }), [0, 1, 0]));
  assert.ok(near(direction({ azimuth: 90, elevation: 0 }), [1, 0, 0]));
  assert.ok(near(direction({ azimuth: 0, elevation: 90 }), [0, 6.123233995736766e-17, 1]));
  const [x, y, z] = direction(UPPER_LEFT);
  assert.ok(x < 0 && y > 0 && z > 0);
});

test('the ramp table runs from the last step (0) to the first (255), blended in OKLab', () => {
  const lut = rampLut(RAMP);
  assert.deepEqual(at(lut, 255), rgb255(RAMP[0]));
  assert.deepEqual(at(lut, 0), rgb255(RAMP[4]));
  // index 255 × 7/8 sits halfway between the first two steps
  const [a, b] = [toOklab(RAMP[0]), toOklab(RAMP[1])];
  const mid = fromOklab([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], RAMP[0][2]);
  const i = Math.round(255 * 7 / 8);
  assert.ok(Math.abs(255 * 7 / 8 - i) < 0.5);
  at(lut, i).forEach((v, k) => assert.ok(Math.abs(v - rgb255(mid)[k]) <= 2, `channel ${k}: ${v} vs ${rgb255(mid)[k]}`));
});

test('banded: every entry is a step, but for one blended entry at each edge', () => {
  const lut = rampLut(RAMP, true);
  const steps = RAMP.map((c) => rgb255(c).join());
  const off = Array.from({ length: 256 }, (_, i) => at(lut, i).join()).filter((c) => !steps.includes(c));
  assert.ok(off.length <= (RAMP.length - 1) * 2, `${off.length} blended entries`);
  assert.deepEqual(rampLut([RAMP[2]], true).subarray(0, 3), new Uint8ClampedArray(rgb255(RAMP[2])));
});

/** the normal turned from the light toward the viewer by `deg`: always a visible one, through the highlight's half vector */
const arc = (l: [number, number, number], deg: number): [number, number, number] => {
  const dot = l[2];
  const s = [-l[0] * dot, -l[1] * dot, 1 - l[2] * dot];
  const k = Math.hypot(...s);
  const side = s.map((v) => v / k);
  const [c, n] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  return l.map((v, i) => v * c + side[i] * n) as [number, number, number];
};
const MATTE: Finish = { ...DEFAULT_FINISH, gloss: 0 };

test('tone: the painter’s order from the light round to the far side', () => {
  const f = frame(UPPER_LEFT, MATTE);
  const [lx, ly, lz] = f.l;
  const facing = tone(lx, ly, lz, 1, f);
  const along = [0, 20, 40, 60, 80, 90].map((d) => tone(...arc(f.l, d), 1, f));
  assert.ok(along.every((v, i) => i === 0 || v < along[i - 1] + 1e-9), `darkens toward the terminator: ${along}`);
  assert.ok(facing > 0.625 && facing < 0.875, `facing the light: the light step (${facing})`);
  const core = along[5];
  assert.ok(core < 0.125, `at the terminator: the deepest shadow (${core})`);
  assert.ok(tone(...arc(f.l, 100), 1, f) > core, 'and reflected light lifts it again past the core');
  // the far edge, turned from the light and lit back by the ground: lighter than the core
  assert.ok(tone(0, -1, 0, 1, f) > core + 0.1, 'reflected light from below lifts the shadow side');
  assert.ok(tone(lx, ly, lz, 0.6, f) < facing, 'less open, less light');
  const [hx, hy, hz] = frame(UPPER_LEFT).h;
  assert.ok(tone(hx, hy, hz, 1, frame(UPPER_LEFT)) > 0.875, 'halfway between the light and the viewer: the highlight');
});

/** how fast the tone falls round the terminator, per degree, at the steepest: a wide terminator is a gentle one */
function steepest(f: Finish): number {
  const fr = frame(UPPER_LEFT, { ...f, gloss: 0, sheen: 0, metal: 0, translucency: 0 });
  const at = (d: number) => tone(...arc(fr.l, d), 1, fr);
  let worst = 0;
  for (let d = 60; d < 110; d += 0.5) worst = Math.max(worst, (at(d) - at(d + 0.5)) / 0.5);
  return worst;
}

test('the terminator is wider for skin and wax than for stone, and the material’s softness is the cause', () => {
  const [skin, stone, paper] = [steepest(finishOf('skin')), steepest(finishOf('stone')), steepest(finishOf('paper'))];
  assert.ok(skin < stone * 0.6, `skin ${skin} stone ${stone}`);
  assert.ok(paper < stone && paper > skin, `paper ${paper}`);
  // the same material with its Softness slider moved
  assert.ok(steepest(finishOf('stone', { softness: 1 })) < stone * 0.6);
  assert.ok(steepest(finishOf('skin', { softness: 0 })) > skin * 1.6);
});

test('a sphere lit from the upper left is lighter there and throws its shadow lower right', () => {
  const px = render('sphere', UPPER_LEFT);
  const lum = (x: number, y: number) => {
    const p = (Math.round(y) * SIZE + Math.round(x)) * 4;
    return px[p] + px[p + 1] + px[p + 2];
  };
  const c = SIZE / 2;
  const r = 0.64 * c;
  assert.ok(lum(c - r * 0.4, c - r * 0.4) > lum(c + r * 0.4, c + r * 0.4));
  const alpha = (x: number, y: number) => px[(Math.round(y) * SIZE + Math.round(x)) * 4 + 3];
  const off = r * 1.08;
  assert.equal(alpha(c - off * 0.72, c - off * 0.72), 0, 'no shadow toward the light');
  assert.ok(alpha(c + off * 0.72, c + off * 0.72) > 20, 'a shadow on the backdrop away from it');
});

test('banded, each shape shows the ramp’s steps: all five on the sphere, three planes on the cube', () => {
  const colours = (px: Uint8ClampedArray) => {
    const seen = new Map<string, number>();
    for (let p = 0; p < px.length; p += 4) if (px[p + 3] === 255) seen.set(`${px[p]},${px[p + 1]},${px[p + 2]}`, (seen.get(`${px[p]},${px[p + 1]},${px[p + 2]}`) ?? 0) + 1);
    const steps = RAMP.map((c) => rgb255(c).join());
    return steps.map((s) => seen.get(s) ?? 0);
  };
  const sphere = colours(render('sphere', UPPER_LEFT, true));
  assert.ok(sphere.every((n) => n > 8), `sphere steps ${sphere}`);
  const cube = colours(render('cube', UPPER_LEFT, true));
  // light top, base on the lit side, shadow on the far side: one plane each
  const big = cube.map((n) => n > SIZE * SIZE * 0.05);
  assert.deepEqual(big, [false, true, true, true, false], `cube steps ${cube}`);
  const cloth = colours(render('cloth', UPPER_LEFT, true));
  assert.ok(cloth.filter((n) => n > 8).length >= 4, `cloth steps ${cloth}`);
});

test('shapes cover what they should, edges antialiased', () => {
  const sf = surface('sphere', SIZE);
  const area = sf.cover.reduce((a, b) => a + b, 0);
  const want = Math.PI * (0.64 * SIZE / 2) ** 2;
  assert.ok(Math.abs(area - want) / want < 0.01, `${area} vs ${want}`);
  assert.ok(sf.cover.some((c) => c > 0 && c < 1));
  for (const shape of ['cube', 'cloth'] as Shape[]) {
    const { cover, normal } = surface(shape, SIZE);
    cover.forEach((c, p) => c > 0 && assert.ok(Math.abs(Math.hypot(normal[p * 3], normal[p * 3 + 1], normal[p * 3 + 2]) - 1) < 1e-4));
  }
});

test('a light drag stays well inside a frame: three shapes at full size', () => {
  const look = lookOf({ steps: RAMP, material: 'cloth', light: [0.95, 0.05, 85], surround: [0.5, 0.01, 90] });
  const px = new Uint8ClampedArray(288 * 288 * 4);
  const shapes: Shape[] = ['sphere', 'cube', 'cloth'];
  shapes.forEach((s) => shade(surface(s, 288), look, UPPER_LEFT, px)); // built and warmed
  // the quickest of ten: a busy machine (every test file runs at once) slows a frame, never speeds it
  let best = Infinity;
  for (let a = 0; a < 10; a++) {
    const t = performance.now();
    shapes.forEach((s) => shade(surface(s, 288), look, { azimuth: a * 36, elevation: 30 }, px));
    best = Math.min(best, performance.now() - t);
  }
  assert.ok(best < budget(16), `${best.toFixed(1)}ms per frame`);
});
