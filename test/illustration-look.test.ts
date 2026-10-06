// What the material does to the lit preview (finish.ts, shade.ts): light through thin cloth, the
// highlight of metal and of plastic, sheen, grain, self-shadowing, the colours light adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgb255, type Oklch } from '../src/shared/color/index.ts';
import { finishOf } from '../src/renderer/tools/illustration/finish.ts';
import { direction, frame, horizonsOf, lookOf, newStats, read, shade, surface, tone, transmission, type Light, type Look, type LookIn, type Shape } from '../src/renderer/tools/illustration/shade.ts';
import { budget } from './perf.ts';

// highlight, light, base, shadow, deep shadow: a warm-lit terracotta
const RAMP: Oklch[] = [
  [0.9, 0.06, 75],
  [0.76, 0.12, 55],
  [0.62, 0.14, 40],
  [0.45, 0.115, 30],
  [0.3, 0.08, 18],
];
const LIGHT_COLOUR: Oklch = [0.95, 0.05, 85];
const SURROUND: Oklch = [0.5, 0, 0];
const UPPER_LEFT: Light = { azimuth: 320, elevation: 35 };
const BEHIND: Light = { azimuth: 300, elevation: -45 };
const FRONT: Light = { azimuth: 0, elevation: 90 };

const lookFor = (material: LookIn['material'], over: Partial<LookIn> = {}) => lookOf({ steps: RAMP, material, light: LIGHT_COLOUR, surround: SURROUND, ...over });

function render(shape: Shape, light: Light, size: number, look: Look) {
  const px = new Uint8ClampedArray(size * size * 4);
  shade(surface(shape, size), look, light, px);
  return px;
}
const rgbaAt = (px: Uint8ClampedArray, size: number, x: number, y: number) => {
  const p = (Math.round(y) * size + Math.round(x)) * 4;
  return [...px.subarray(p, p + 4)];
};
const sum = (c: number[]) => c[0] + c[1] + c[2];

test('the light can go behind the object', () => {
  assert.ok(direction({ azimuth: 0, elevation: -60 })[2] < -0.8);
  assert.ok(Math.abs(direction({ azimuth: 90, elevation: -90 })[2] + 1) < 1e-9);
});

test('light goes through only where the material lets it: back light transmits with translucency above 0 and not otherwise', () => {
  const facing = [0, 0, 1] as const;
  const none = frame(BEHIND, { ...finishOf('cloth'), translucency: 0 });
  assert.equal(transmission(...facing, 1, 0, none)[0], 0, 'an opaque material lets nothing through');
  assert.equal(transmission(...facing, 1, 0, frame(BEHIND, finishOf('stone')))[0], 0);
  const some = frame(BEHIND, { ...finishOf('cloth'), translucency: 0.5 });
  const [glow, lit] = transmission(...facing, 1, 0, some);
  assert.ok(glow > 0.3 && lit > 0.5, `thin cloth with the light behind it glows (${glow}, ${lit})`);
  const more = transmission(...facing, 1, 0, frame(BEHIND, { ...finishOf('cloth'), translucency: 1 }))[0];
  assert.ok(more > glow, 'and the more translucent glows more');
  // with the light in front of it a flat sheet shows none of that
  assert.ok(transmission(...facing, 1, 0, frame(FRONT, { ...finishOf('cloth'), translucency: 0.5 }))[0] < 0.01);
  // a thick body lets less through than a thin sheet
  assert.ok(transmission(...facing, 1, 1, some)[0] < glow * 0.4);
  // the glow follows the cosine of the light on the back of the sheet
  const edge = transmission(-0.9, 0, Math.sqrt(1 - 0.81), 1, 0, some)[0];
  assert.ok(edge < glow, `a sheet turned from the light glows less (${edge} vs ${glow})`);
});

test('back-lit, thin translucent cloth glows, an opaque one goes dark, and a solid ball only at its thin rim', () => {
  const size = 120;
  const opaque = render('cloth', BEHIND, size, lookFor('cloth', { surface: { translucency: 0 } }));
  const sheer = render('cloth', BEHIND, size, lookFor('cloth', { surface: { translucency: 0.6 } }));
  const mid = [size * 0.5, size * 0.4] as const;
  assert.ok(sum(rgbaAt(sheer, size, ...mid)) > sum(rgbaAt(opaque, size, ...mid)) + 90, `${rgbaAt(sheer, size, ...mid)} vs ${rgbaAt(opaque, size, ...mid)}`);
  // front light: translucency makes next to no difference to the lit face
  const [a, b] = [render('cloth', UPPER_LEFT, size, lookFor('cloth', { surface: { translucency: 0 } })), render('cloth', UPPER_LEFT, size, lookFor('cloth', { surface: { translucency: 0.6 } }))];
  let [moved, farther] = [0, 0];
  for (let p = 0; p < a.length; p += 4) {
    if (a[p + 3] !== 255) continue;
    moved += Math.abs(a[p] - b[p]);
    farther += Math.abs(sheer[p] - opaque[p]);
  }
  assert.ok(moved < farther * 0.5, `lit from the front the difference is small (${moved}) next to back-lit (${farther})`);
  // a solid ball: the middle stays dark, the rim glows
  const ball = render('sphere', { azimuth: 0, elevation: -60 }, size, lookFor('foliage'));
  const [c, R] = [size / 2, size * 0.32];
  let [ring, middle] = [0, 0];
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * 2 * Math.PI;
    ring += sum(rgbaAt(ball, size, c + Math.sin(t) * R * 0.95, c - size * 0.03 + Math.cos(t) * R * 0.95)) / 24;
    middle += sum(rgbaAt(ball, size, c + Math.sin(t) * R * 0.2, c - size * 0.03 + Math.cos(t) * R * 0.2)) / 24;
  }
  assert.ok(ring > middle + 25, `rim ${ring} centre ${middle}`);
});

test('the cast shadow of a translucent surface is paler and tinted; of an opaque one it is black; none falls from behind', () => {
  const size = 120;
  /** the densest partly clear pixel on the lower right: the shadow on the backdrop */
  const densest = (px: Uint8ClampedArray) => {
    let best = [0, 0, 0, 0];
    for (let y = size * 0.1; y < size * 0.95; y += 3) {
      for (let x = size * 0.86; x < size * 0.95; x += 3) {
        const c = rgbaAt(px, size, x, y);
        if (c[3] > 0 && c[3] < 120 && c[3] > best[3]) best = c;
      }
    }
    return best;
  };
  const at = (translucency: number) => densest(render('cloth', UPPER_LEFT, size, lookFor('cloth', { surface: { translucency } })));
  const [pale, dense] = [at(0.8), at(0)];
  assert.ok(pale[3] < dense[3] * 0.7, `paler: alpha ${pale[3]} against ${dense[3]}`);
  assert.deepEqual(dense.slice(0, 3), [0, 0, 0], 'an opaque shadow is black');
  assert.ok(Math.max(...pale.slice(0, 3)) > 20 && pale[0] > pale[2], `tinted by the glow: ${pale}`);
  assert.deepEqual(rgbaAt(render('sphere', UPPER_LEFT, size, lookFor('stone')), size, size * 0.8, size * 0.8).slice(0, 3), [0, 0, 0]);
  // from behind there is no wall for it to fall on
  const behind = render('sphere', BEHIND, size, lookFor('stone'));
  let alpha = 0;
  for (let y = size * 0.75; y < size * 0.95; y += 2) for (let x = size * 0.75; x < size * 0.95; x += 2) alpha = Math.max(alpha, rgbaAt(behind, size, x, y)[3]);
  assert.ok(alpha < 12, `no cast shadow from behind (${alpha})`);
  let front = 0;
  const lit = render('sphere', UPPER_LEFT, size, lookFor('stone'));
  for (let y = size * 0.75; y < size * 0.95; y += 2) for (let x = size * 0.75; x < size * 0.95; x += 2) front = Math.max(front, rgbaAt(lit, size, x, y)[3]);
  assert.ok(front > 40, `and from the front there is (${front})`);
});

test('metal and plastic differ at the highlight: metal takes the body’s colour, plastic the light’s', () => {
  const size = 200;
  // the highlight sits where the normal is the half vector between the light and the viewer
  const [hx, hy, hz] = frame(UPPER_LEFT).h;
  const [x, y] = [((0.64 * hx + 1) / 2) * size, ((1 - (0.03 + 0.64 * hy)) / 2) * size];
  assert.ok(hz > 0);
  const [metal, plastic] = [lookFor('metal'), lookFor('plastic')];
  const [m, pl] = [rgbaAt(render('sphere', UPPER_LEFT, size, metal), size, x, y), rgbaAt(render('sphere', UPPER_LEFT, size, plastic), size, x, y)];
  const white = metal.spec;
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(dist(pl, white) < dist(m, white) - 8, `plastic ${pl} is nearer the light ${white} than metal ${m}`);
  // the metal's is a colour of the ramp itself
  assert.ok(dist(m, rgb255(RAMP[0])) < 14, `metal ${m} against the ramp's highlight ${rgb255(RAMP[0])}`);
  // and the metal reflects a horizon: sky over ground, which plastic doesn't have
  const split = (look: Look) => {
    const px = render('sphere', FRONT, size, look);
    return sum(rgbaAt(px, size, size / 2, size * 0.3)) - sum(rgbaAt(px, size, size / 2, size * 0.7));
  };
  assert.ok(split(metal) > 120, `sky over ground in the metal: ${split(metal)}`);
  assert.ok(split(plastic) < split(metal) - 60, `plastic is less split (${split(plastic)})`);
});

test('gloss sets the size of the highlight, and a matte material has none to speak of', () => {
  const sf = surface('sphere', 256);
  const area = (gloss: number) => {
    const f = frame(UPPER_LEFT, finishOf('plastic', { gloss }));
    let n = 0;
    for (let p = 0; p < 256 * 256; p++) if (sf.cover[p] === 1 && tone(sf.normal[p * 3], sf.normal[p * 3 + 1], sf.normal[p * 3 + 2], 1, f) > 0.93) n++;
    return n;
  };
  const [matte, soft, mid, shiny, mirror] = [0.05, 0.2, 0.5, 0.8, 0.95].map(area);
  assert.equal(matte, 0, 'no highlight on a matte surface');
  assert.ok(soft === 0 && mid > shiny && shiny > mirror && mirror > 0, `${matte} ${soft} ${mid} ${shiny} ${mirror}`);
});

test('sheen: velvet glows at the rim over a darker body, as cloth does less', () => {
  const [velvet, none] = [frame(FRONT, finishOf('velvet')), frame(FRONT, { ...finishOf('velvet'), sheen: 0 })];
  const rim = [0.96, 0, 0.28] as const;
  const middle = [0.1, 0, 0.995] as const;
  assert.ok(tone(...rim, 1, velvet) > tone(...rim, 1, none) + 0.08, 'brighter at the rim');
  assert.ok(tone(...middle, 1, velvet) < tone(...middle, 1, none), 'darker in the middle');
  const [cloth, cloth0] = [frame(FRONT, finishOf('cloth')), frame(FRONT, { ...finishOf('cloth'), sheen: 0 })];
  assert.ok(tone(...rim, 1, velvet) - tone(...rim, 1, none) > tone(...rim, 1, cloth) - tone(...rim, 1, cloth0));
});

test('grain stretches the highlight into a streak, and the toggle turns it', () => {
  const size = 200;
  const spread = (across: boolean, grain: number) => {
    const px = render('sphere', { azimuth: 0, elevation: 50 }, size, lookFor('cloth', { surface: { gloss: 0.7, grain, across } }));
    const lum = (p: number) => px[p] + px[p + 1] + px[p + 2];
    let top = 0;
    for (let p = 0; p < px.length; p += 4) if (px[p + 3] === 255) top = Math.max(top, lum(p));
    let [x0, x1, y0, y1] = [size, 0, size, 0];
    for (let p = 0; p < px.length; p += 4) {
      if (px[p + 3] !== 255 || lum(p) < top - 30) continue;
      const [x, y] = [(p / 4) % size, Math.floor(p / 4 / size)];
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const [round, along, across] = [spread(false, 0), spread(false, 1), spread(true, 1)];
  assert.ok(Math.abs(round.w - round.h) <= round.w * 0.6, `round without grain ${round.w}x${round.h}`);
  // along the folds (the default) the streak stands up; across them it lies down
  assert.ok(along.h > along.w * 1.4, `streak along the folds ${along.w}x${along.h}`);
  assert.ok(across.w > across.h * 1.4, `streak across the folds ${across.w}x${across.h}`);
});

test('the folds of the cloth shade each other under raking light', () => {
  const size = 160;
  const sf = surface('cloth', size);
  const hz = horizonsOf(sf);
  const n = size * size;
  // the horizon toward the light (from the left, azimuth 270) is higher in a valley than on a ridge
  let [valley, ridge] = [0, 0];
  for (let p = 0; p < n; p++) {
    if (sf.cover[p] < 1) continue;
    const h = hz.front[6 * n + p];
    if (sf.open[p] < 0.82) valley = Math.max(valley, h);
    if (sf.open[p] > 0.99) ridge = Math.max(ridge, h);
  }
  assert.ok(valley > 15 && valley > ridge - 1, `valley ${valley} ridge ${ridge}`);
  // a pixel is lit when the light is above its horizon and shaded when below it
  let pick = -1;
  for (let p = 0; p < n; p++) {
    if (sf.cover[p] === 1 && hz.front[6 * n + p] > 20 && hz.front[6 * n + p] < 50) {
      pick = p;
      break;
    }
  }
  assert.ok(pick >= 0);
  const h = hz.front[6 * n + pick];
  const look = lookFor('stone');
  const [x, y] = [pick % size, Math.floor(pick / size)];
  const lum = (elevation: number) => {
    const px = new Uint8ClampedArray(n * 4);
    shade(sf, look, { azimuth: 270, elevation }, px);
    return sum(rgbaAt(px, size, x, y));
  };
  assert.ok(lum(h + 12) > lum(h - 12) + 40, `lit above its horizon (${lum(h + 12)}) and shaded below (${lum(h - 12)})`);
  assert.equal(read(sf, look, { azimuth: 270, elevation: h - 12 }, x, y).kind, 'step');
});

test('behind the cloth, folds in the way block the light', () => {
  const size = 160;
  const sf = surface('cloth', size);
  const hz = horizonsOf(sf);
  const n = size * size;
  assert.ok(hz.back.some((v) => v > 10), 'there are layers to be seen through');
  let pick = -1;
  for (let p = 0; p < n; p++) {
    if (sf.cover[p] === 1 && hz.back[6 * n + p] > 20 && hz.back[6 * n + p] < 50) {
      pick = p;
      break;
    }
  }
  assert.ok(pick >= 0);
  const h = hz.back[6 * n + pick];
  const [x, y] = [pick % size, Math.floor(pick / size)];
  const at = (translucency: number, elevation: number) => {
    const px = new Uint8ClampedArray(n * 4);
    shade(sf, lookFor('cloth', { surface: { translucency } }), { azimuth: 270, elevation }, px);
    return sum(rgbaAt(px, size, x, y));
  };
  // with the light behind the ridge in the way, the sheet is as dark as an opaque one; above that ridge it glows
  assert.ok(at(0.8, -(h + 12)) > at(0, -(h + 12)) + 80, 'unblocked it glows');
  assert.ok(at(0.8, -(h - 12)) < at(0, -(h - 12)) + 30, 'blocked it does not');
});

test('the ramp, and what light adds to it: the glow is richer, the bounce takes the surround', () => {
  const look = lookFor('cloth', { surround: [0.55, 0.08, 150] });
  const chroma = (lut: Uint8ClampedArray, i: number) => Math.max(...lut.subarray(i * 3, i * 3 + 3)) - Math.min(...lut.subarray(i * 3, i * 3 + 3));
  assert.ok(chroma(look.glow, 128) > chroma(look.lut, 128), 'light through the cloth is more saturated than light off it');
  const green = (lut: Uint8ClampedArray, i: number) => lut[i * 3 + 1] - (lut[i * 3] + lut[i * 3 + 2]) / 2;
  assert.ok(green(look.bounce, 60) > green(look.lut, 60), 'light bounced off a green surround is greener');
  assert.deepEqual([...lookFor('cloth', { surround: null }).bounce], [...lookFor('cloth', { surround: null }).lut], 'with no surround the bounce keeps the ramp’s colours');
  assert.equal(lookFor('cloth').tinted, true);
  assert.equal(lookFor('cloth', { surround: null }).tinted, false);
  // the warm materials turn their glow toward the warm of skin and leaves
  const cool: Oklch[] = [[0.9, 0.05, 200], [0.6, 0.05, 200], [0.3, 0.04, 200]];
  const redness = (lut: Uint8ClampedArray, i: number) => lut[i * 3] - lut[i * 3 + 2];
  const [skin, stone] = [lookFor('skin', { steps: cool }), lookFor('stone', { steps: cool, light: [0.95, 0.01, 200] })];
  assert.ok(redness(skin.glow, 128) - redness(skin.lut, 128) > redness(stone.glow, 128) - redness(stone.lut, 128) + 10);
});

test('stats: where the pixels go, the share of each step, and the glow when back-lit', () => {
  const size = 96;
  const sf = surface('sphere', size);
  const look = lookFor('cloth');
  const px = new Uint8ClampedArray(size * size * 4);
  const stats = newStats();
  shade(sf, look, UPPER_LEFT, px, stats);
  const area = sf.cover.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(stats.total - area) < 1e-6);
  const counted = [...stats.steps].slice(0, 5).reduce((a, b) => a + b, 0) + stats.glow.reduce((a, b) => a + b, 0);
  assert.ok(counted <= area + 1e-6 && counted > area * 0.85, `${counted} of ${area}`);
  const glossy = newStats();
  shade(sf, lookFor('plastic'), UPPER_LEFT, px, glossy);
  assert.ok([...glossy.steps].slice(0, 5).every((v) => v > 0), `every step of a glossy ball is used: ${[...glossy.steps]}`);
  assert.ok([...stats.steps].slice(1, 5).every((v) => v > 0), `a matte one uses all but the highlight: ${[...stats.steps]}`);
  const back = newStats();
  shade(surface('cloth', size), lookFor('cloth', { surface: { translucency: 0.8 } }), BEHIND, px, back);
  assert.ok(back.glow.reduce((a, b) => a + b, 0) > back.total * 0.4, 'back-lit cloth is mostly glow');
});

test('hovering reads the step a pixel shows: a lighter one on the lit side, nothing off the object', () => {
  const sf = surface('sphere', 200);
  const look = lookFor('plastic');
  const c = 100;
  const r = 0.64 * c;
  const light = { azimuth: 90, elevation: 30 };
  const at = (px: number, py: number) => read(sf, look, light, px, py);
  const [lit, dark] = [at(c + r * 0.3, c + r * 0.3), at(c - r * 0.8, c - 0.03 * c)];
  assert.equal(at(c + r * 0.55, c - 0.03 * c).kind, 'shine', 'the highlight is not a step of the ramp');
  assert.equal(lit.kind, 'step');
  assert.equal(dark.kind, 'step');
  assert.ok((lit as { step: number }).step < (dark as { step: number }).step, 'the lit side reads a lighter step');
  assert.equal(at(2, 2).kind, 'none');
  assert.equal(at(-1, 5).kind, 'none');
  assert.equal((lit as { of: number }).of, 5);
});

test('a drag costs little: a frame of one shape at full size, and three at drag size', () => {
  const look = lookFor('cloth');
  for (const shape of ['sphere', 'cube', 'cloth'] as Shape[]) {
    const sf = surface(shape, 560);
    const px = new Uint8ClampedArray(560 * 560 * 4);
    shade(sf, look, UPPER_LEFT, px);
    const t = performance.now();
    for (let a = 0; a < 6; a++) shade(sf, look, { azimuth: a * 60, elevation: a % 2 ? -30 : 30 }, px);
    const ms = (performance.now() - t) / 6;
    assert.ok(ms < budget(26), `${shape} at 560: ${ms.toFixed(1)}ms`);
  }
  const px = new Uint8ClampedArray(280 * 280 * 4);
  const shapes: Shape[] = ['sphere', 'cube', 'cloth'];
  shapes.forEach((s) => shade(surface(s, 280), look, UPPER_LEFT, px));
  const t = performance.now();
  for (let a = 0; a < 10; a++) shapes.forEach((s) => shade(surface(s, 280), look, { azimuth: a * 36, elevation: -30 + a * 6 }, px));
  const ms = (performance.now() - t) / 10;
  assert.ok(ms < budget(10), `three shapes at drag size: ${ms.toFixed(1)}ms`);
});

test('every material has a finish, kept to 0..1, and a ramp’s own numbers win over it', () => {
  for (const m of ['skin', 'cloth', 'velvet', 'metal', 'plastic', 'glass', 'water', 'foliage', 'stone', 'wood', 'paper', 'fur'] as const) {
    const f = finishOf(m);
    for (const k of ['gloss', 'softness', 'translucency', 'sheen', 'grain', 'ambient', 'metal'] as const) assert.ok(f[k] >= 0 && f[k] <= 1, `${m} ${k}`);
  }
  assert.ok(finishOf('foliage').translucency > finishOf('skin').translucency && finishOf('skin').translucency > finishOf('stone').translucency);
  assert.ok(finishOf('velvet').sheen > finishOf('cloth').sheen && finishOf('metal').metal === 1 && finishOf('plastic').metal === 0);
  assert.ok(finishOf('skin').softness > finishOf('stone').softness && finishOf('metal').gloss > finishOf('stone').gloss);
  assert.equal(finishOf('metal', { gloss: 0.1 }).gloss, 0.1);
  assert.equal(finishOf('metal', { gloss: 0.1 }).softness, finishOf('metal').softness);
  assert.equal(finishOf('cloth', { across: true }).across, true);
  assert.equal(finishOf('cloth', { gloss: 'x' as never }).gloss, finishOf('cloth').gloss);
});
