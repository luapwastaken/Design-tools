import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget } from './perf.ts';
import { BW, PICO8, field, flat, lin, palette, ramp, share } from './dither-fixtures.ts';
import { linearRgb } from '../src/shared/color/index.ts';
import { ALGORITHMS, dither, type AlgoSettings, type AlgorithmId } from '../src/shared/dither/algorithms.ts';
import { labImage, labOf, lightOf, mixOf } from '../src/shared/dither/lab.ts';
import { toMix, toOklab, type OklabPalette } from '../src/shared/dither/palette.ts';
import { fromOklab } from '../src/shared/palette/space.ts';
import { random } from '../src/shared/palette/random.ts';

const IDS = ALGORITHMS.map((a) => a.id);
const run = (img: Float32Array, w: number, h: number, p: OklabPalette, algorithm: AlgorithmId, over: Partial<AlgoSettings> = {}) =>
  dither(img, w, h, p, { algorithm, strength: 1, serpentine: true, seed: 1, ...over });
/** OKLab lightness L as a linear grey: L³ */
const grey = (l: number) => [l ** 3, l ** 3, l ** 3];
/** the grey whose sRGB value is v, in linear light */
const srgbGrey = (v: number) => grey(lightOf(v));
const POINTWISE = ALGORITHMS.filter((x) => x.group === 'ordered' || x.group === 'noise').map((x) => x.id);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

test('the list: each algorithm once, in its group, saying which settings it reads', () => {
  assert.equal(new Set(IDS).size, IDS.length);
  assert.equal(IDS.length, 18);
  for (const a of ALGORITHMS) assert.ok(['diffusion', 'ordered', 'noise'].includes(a.group), a.id);
  assert.deepEqual(ALGORITHMS.filter((a) => a.serpentine).map((a) => a.id), ['floyd-steinberg', 'atkinson', 'jarvis', 'stucki', 'burkes', 'sierra', 'sierra-lite']);
  assert.deepEqual(ALGORITHMS.filter((a) => a.seed).map((a) => a.id), ['random']);
  assert.deepEqual(ALGORITHMS.filter((a) => !a.strength).map((a) => a.id), ['threshold']);
  assert.throws(() => run(flat(2, 2, [0, 0, 0]), 2, 2, BW, 'nope' as AlgorithmId), /no dither called "nope"/);
});

test('every algorithm gives only palette indices, at any size and on any palette', () => {
  const rnd = random(3);
  const big = toOklab(Array.from({ length: 256 }, () => [rnd(), rnd() * 0.3, rnd() * 360] as [number, number, number]));
  const five = palette('#0b0b0b #e8643c #3f6b4f #8fb8de #f4f0d8');
  for (const [w, h] of [[1, 1], [7, 3], [3, 7], [64, 48]]) {
    const img = field(w, h);
    for (const p of [BW, five, PICO8, big]) {
      for (const id of IDS) {
        const out = run(img, w, h, p, id);
        assert.equal(out.length, w * h, `${id} ${w}×${h}`);
        assert.ok(out.every((v) => v < p.n), `${id} on ${p.n} colours, ${w}×${h}`);
      }
    }
  }
});

test('a 50% sRGB grey on black and white comes out half white, whatever the algorithm', () => {
  const img = flat(128, 128, srgbGrey(0.5));
  for (const id of IDS.filter((x) => x !== 'threshold')) {
    const white = share(run(img, 128, 128, BW, id), 1);
    // Atkinson loses a quarter of its error, so its midtones sit where it picks white (OKLab 0.5, sRGB 0.39)
    assert.ok(Math.abs(white - 0.5) < (id === 'atkinson' ? 0.05 : 0.02), `${id}: ${white.toFixed(3)}`);
  }
  // threshold matches in OKLab: exactly between the two, it takes the darker everywhere
  assert.equal(share(run(flat(8, 8, grey(0.5)), 8, 8, BW, 'threshold'), 1), 0);
});

test('the families agree on tone: a grey comes out its sRGB value’s share of white', () => {
  // Atkinson passes on only 6/8 of its error, so it clips the ends by design; threshold doesn't dither
  const ids = IDS.filter((id) => id !== 'atkinson' && id !== 'threshold');
  for (const v of [0.2, 0.35, 0.65, 0.8]) {
    const img = flat(128, 128, srgbGrey(v));
    for (const id of ids) {
      const white = share(run(img, 128, 128, BW, id), 1);
      // a 2 × 2 screen only has quarters to give and a 4 × 4 sixteenths, half of one either way,
      // and a screen's mix is counted in 64ths
      const within = id === 'bayer2' ? 0.135 : id === 'bayer4' ? 0.045 : 0.03;
      assert.ok(Math.abs(white - v) <= within, `${id} at ${v}: ${white.toFixed(3)}`);
    }
  }
});

test('shadows stay dark: 1-bit greys come out as the classic dither has them, not lighter', () => {
  // sRGB 16, 32, 64 and 240: 6%, 13%, 25% and 94% white (a share of OKLab lightness was 17%, 24%, 37%)
  for (const byte of [16, 32, 64, 240]) {
    const hex = `#${byte.toString(16).padStart(2, '0').repeat(3)}`;
    const img = flat(128, 128, lin(hex));
    for (const id of ['floyd-steinberg', 'jarvis', 'dot-diffusion', 'bayer8', 'clustered-dot', 'blue-noise', 'ign'] as AlgorithmId[]) {
      const white = share(run(img, 128, 128, BW, id), 1);
      assert.ok(Math.abs(white - byte / 255) < 0.012, `${id} on ${hex}: ${white.toFixed(3)}, want ${(byte / 255).toFixed(3)}`);
    }
  }
});

test('on a 16-colour palette the families agree on colour too: the screens mix what diffusion mixes', () => {
  // colours the palette can reach: light mixes of two or three of its colours
  const rnd = random(11);
  const lut = PICO8.lab;
  const linOf = (k: number) => {
    const [l, a, b] = [lut[k * 3], lut[k * 3 + 1], lut[k * 3 + 2]];
    const lms = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map((v) => v ** 3);
    return [4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2], -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2], -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2]];
  };
  const W = 32;
  const miss = (id: AlgorithmId) => {
    let sum = 0;
    for (let k = 0; k < 60; k++) {
      const picks = [0, 1, 2].map(() => Math.floor(rnd() * PICO8.n));
      const wts = [rnd(), rnd(), k % 2 ? rnd() : 0];
      const total = wts[0] + wts[1] + wts[2];
      const rgb = [0, 1, 2].map((c) => picks.reduce((v, j, q) => v + (linOf(j)[c] * wts[q]) / total, 0));
      const img = flat(W, W, rgb);
      const want = toMix(img.subarray(0, 3), PICO8);
      const out = run(img, W, W, PICO8, id);
      const mean = [0, 1, 2].map((c) => out.reduce((v, j) => v + PICO8.mix[j * 3 + c], 0) / out.length);
      sum += Math.hypot(mean[0] - want[0], mean[1] - want[1], mean[2] - want[2]);
    }
    return sum / 60;
  };
  const fs = miss('floyd-steinberg');
  // a 2 × 2 screen has only quarters to give; the rest mix as closely as diffusion, near enough
  for (const a of ALGORITHMS.filter((x) => (x.group === 'ordered' || x.group === 'noise') && x.id !== 'threshold')) {
    const m = miss(a.id);
    assert.ok(m < (a.id === 'bayer2' ? 0.03 : Math.max(0.015, fs * 2.5)), `${a.id}: ${(m * 100).toFixed(2)} against Floyd–Steinberg's ${(fs * 100).toFixed(2)}`);
  }
});

test('the same frame and settings give the same indices; serpentine and the seed change them', () => {
  const img = field(96, 64);
  for (const id of IDS) assert.ok(same(run(img, 96, 64, PICO8, id), run(img, 96, 64, PICO8, id)), id);
  for (const a of ALGORITHMS.filter((x) => x.serpentine)) {
    assert.ok(!same(run(img, 96, 64, BW, a.id, { serpentine: true }), run(img, 96, 64, BW, a.id, { serpentine: false })), a.id);
  }
  assert.ok(!same(run(img, 96, 64, BW, 'random', { seed: 1 }), run(img, 96, 64, BW, 'random', { seed: 2 })));
  // settings an algorithm doesn't read change nothing
  for (const a of ALGORITHMS.filter((x) => !x.seed)) assert.ok(same(run(img, 96, 64, BW, a.id, { seed: 1 }), run(img, 96, 64, BW, a.id, { seed: 9 })), a.id);
  for (const a of ALGORITHMS.filter((x) => !x.serpentine)) {
    assert.ok(same(run(img, 96, 64, BW, a.id, { serpentine: true }), run(img, 96, 64, BW, a.id, { serpentine: false })), a.id);
  }
});

test('frames are stable: nothing carries from one call to the next, and ordered screens do not crawl', () => {
  const [w, h] = [80, 60];
  const a = field(w, h, 1);
  const b = a.slice();
  // frame b: a square in the middle changes, the rest is the same picture
  for (let y = 20; y < 40; y++) for (let x = 30; x < 50; x++) b.set([0.9, 0.1, 0.2], (y * w + x) * 3);
  for (const id of IDS) {
    const first = run(a, w, h, PICO8, id);
    const second = run(b, w, h, PICO8, id);
    assert.ok(same(first, run(a, w, h, PICO8, id)), `${id}: frame a again`);
    if (!POINTWISE.includes(id)) continue;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= 30 && x < 50 && y >= 20 && y < 40) continue;
        assert.equal(second[y * w + x], first[y * w + x], `${id} moved at ${x},${y}`);
      }
    }
  }
});

test('a pixel of exactly a palette colour shows that colour, whatever the algorithm', () => {
  const hexes = ['#000000', '#1d2b53', '#7e2553', '#ffa300', '#ffccaa', '#fff1e8'];
  const p = palette(hexes.join(' '));
  hexes.forEach((hex, k) => {
    const img = flat(24, 24, lin(hex));
    for (const id of IDS) assert.ok(run(img, 24, 24, p, id).every((v) => v === k), `${id} on ${hex}`);
  });
});

test("a colour the palette can't reach dithers by its lightness, with no error piling up", () => {
  // pure red on black and white: its chroma is out of reach, its lightness (OKLab 0.628, as light as
  // the sRGB grey 0.535) is not
  const img = flat(160, 160, lin('#ff0000'));
  const want = mixOf(labOf(...lin('#ff0000'))[0]);
  for (const id of ['floyd-steinberg', 'jarvis', 'riemersma', 'dot-diffusion', 'bayer8', 'blue-noise'] as AlgorithmId[]) {
    const out = run(img, 160, 160, BW, id);
    const top = share(out.subarray(0, 80 * 160), 1);
    const bottom = share(out.subarray(80 * 160), 1);
    assert.ok(Math.abs(top - want) < 0.03 && Math.abs(bottom - want) < 0.03, `${id}: ${top.toFixed(3)} then ${bottom.toFixed(3)}, want ${want.toFixed(3)}`);
  }
});

test('strength 0 is the nearest colour everywhere', () => {
  const [w, h] = [48, 32];
  const img = field(w, h);
  const nearest = run(img, w, h, PICO8, 'threshold');
  for (const a of ALGORITHMS.filter((x) => x.strength)) assert.ok(same(run(img, w, h, PICO8, a.id, { strength: 0 }), nearest), a.id);
});

/** the longest run of one index along a row */
function longestRun(idx: Uint8Array, w: number, h: number): number {
  let longest = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1, run = 1; x < w; x++) {
      run = idx[y * w + x] === idx[y * w + x - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}

test('an 8 × 8 screen on a 16-colour palette bands less than Floyd–Steinberg on a gradient (Knoll’s plans)', () => {
  const [w, h] = [512, 64];
  for (const [from, to] of [['#402060', '#e08040'], ['#101830', '#f0e0d0']]) {
    const img = ramp(w, h, from, to);
    const fs = longestRun(run(img, w, h, PICO8, 'floyd-steinberg'), w, h);
    const bayer = longestRun(run(img, w, h, PICO8, 'bayer8'), w, h);
    assert.ok(bayer < fs * 0.8, `${from} to ${to}: Bayer 8 ${bayer} px, Floyd–Steinberg ${fs} px`);
  }
});

/** a ramp straight in the mixing coordinates from palette colour i to j; the share of j per 8-column band, against where the band sits */
function bands(hexes: string, i: number, j: number, id: AlgorithmId) {
  const p = palette(hexes);
  const [W, H] = [512, 64];
  const img = new Float32Array(W * H * 3);
  for (let x = 0; x < W; x++) {
    const at = (c: number) => p.mix[i * 3 + c] + ((p.mix[j * 3 + c] - p.mix[i * 3 + c]) * x) / (W - 1);
    const rgb = linearRgb(fromOklab([lightOf(at(0)), at(1), at(2)]));
    for (let y = 0; y < H; y++) img.set(rgb, (y * W + x) * 3);
  }
  const out = run(img, W, H, p, id);
  const shares: number[] = [];
  for (let bx = 0; bx < W; bx += 8) {
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = bx; x < bx + 8; x++) n += out[y * W + x] === j ? 1 : 0;
    shares.push(n / (8 * H));
  }
  return { levels: new Set(shares.map((v) => v.toFixed(4))).size, worst: Math.max(...shares.map((v, k) => Math.abs(v - (k * 8 + 3.5) / (W - 1)))) };
}

test('the screens follow a gradient between two close colours as closely as diffusion does', () => {
  // grey and a pink about as light: the ramp between them is all chroma
  const fs = bands('#8a8a8a #d0506a', 0, 1, 'floyd-steinberg');
  for (const id of ['bayer8', 'blue-noise', 'ign', 'clustered-dot'] as AlgorithmId[]) {
    const r = bands('#8a8a8a #d0506a', 0, 1, id);
    assert.ok(r.worst <= Math.max(0.03, 2 * fs.worst), `${id}: worst band off by ${r.worst.toFixed(3)} (Floyd–Steinberg ${fs.worst.toFixed(3)}), ${r.levels} levels over 64 bands`);
  }
  // the Game Boy's two light greens, on its 4 × 4 screen: the 17 levels it has, not a cell's worth
  const gb = bands('#0f380f #306230 #8bac0f #9bbc0f', 2, 3, 'bayer4');
  assert.ok(gb.levels >= 16, `${gb.levels} levels`);
});

test('a pixel is converted on its own: the same colour gets the same value whatever the pixel before it', () => {
  const rnd = random(5);
  let differ = 0;
  for (let k = 0; k < 2000; k++) {
    const v = [rnd(), rnd(), rnd()];
    const [f1, f2] = [1 + (rnd() - 0.5) * 0.09, 1 + (rnd() - 0.5) * 0.09];
    const a = labImage(Float32Array.of(v[0] * f1, v[1] * f1, v[2] * f1, ...v));
    const b = labImage(Float32Array.of(v[0] * f2, v[1] * f2, v[2] * f2, ...v));
    if (a[3] !== b[3] || a[4] !== b[4] || a[5] !== b[5]) differ++;
  }
  assert.equal(differ, 0, `${differ} of 2000 differ`);
});

test('the pointwise screens never change a pixel whose own colour stays the same, even next to one that changes', () => {
  const rnd = random(5);
  const [W, H] = [1024, 256];
  const A = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) A.set([rnd(), rnd(), rnd()], i * 3);
  for (let i = 3; i < A.length; i++) A[i] = 0.9 * A[i - 3] + 0.1 * A[i];
  const B = A.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 2) for (let c = 0; c < 3; c++) B[(y * W + x) * 3 + c] *= 1.02;
  for (const id of POINTWISE) {
    const [oa, ob] = [A, B].map((img) => run(img, W, H, PICO8, id));
    let moved = 0;
    for (let y = 0; y < H; y++) for (let x = 1; x < W; x += 2) if (oa[y * W + x] !== ob[y * W + x]) moved++;
    assert.equal(moved, 0, `${id}: ${moved} unchanged pixels changed`);
  }
});

test('performance: Floyd–Steinberg dithers a 1920 × 1080 frame in time', () => {
  const [w, h] = [1920, 1080];
  const img = field(w, h);
  // warm, as the tool's worker is after its first frame
  run(img, w, h, BW, 'floyd-steinberg');
  const ms = [0, 1, 2].map(() => {
    const t = performance.now();
    run(img, w, h, BW, 'floyd-steinberg');
    return performance.now() - t;
  });
  // the best of three: test files run side by side and share the CPU
  const best = Math.min(...ms);
  assert.ok(best < budget(120), `${best.toFixed(0)} ms`);
});
