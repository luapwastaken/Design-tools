import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearRgb, rgb255, toOklch, type Oklch } from '../src/shared/color/index.ts';
import { INKS } from '../src/shared/palette/inks.ts';
import { knockedOut, stats, totalInk } from '../src/shared/halftone/coverage.ts';
import { inksAt, MAX_SPOT, separation, toPlates } from '../src/shared/halftone/separate.ts';
import { encodeTable, lookup, NEUTRAL_TONE, toneAt } from '../src/shared/halftone/tone.ts';
import { type Process, type SeparateInk, type Tone } from '../src/shared/halftone/types.ts';

const IDENTITY: [number, number][] = [[0, 0], [1, 1]];
const ink = (colour: Oklch, process?: Process): SeparateInk => ({ colour, curve: IDENTITY, process });
const PROCESS = [
  ink([0.708, 0.1489, 234.36], 'c'),
  ink([0.6157, 0.2527, 355.14], 'm'),
  ink([0.9412, 0.2004, 105.69], 'y'),
  ink([0.2442, 0.0064, 0.59], 'k'),
];
const riso = (name: string) => INKS.riso.find((i) => i.name === name)!.oklch;
const SPOT = ['Blue', 'Yellow', 'Fluorescent Pink'].map((n) => ink(riso(n)));
const WHITE: Oklch = [1, 0, 0];
const BONE: Oklch = [0.9354, 0.0173, 84.59];

/** an sRGB-encoded colour as the linear light the tool hands the core */
const linear = (r: number, g: number, b: number) => linearRgb(toOklch({ mode: 'rgb', r, g, b }));
/** a colour's sRGB-encoded values, 0..1 */
const rgbOf = (o: Oklch) => rgb255(o).map((v) => v / 255);
const inks = (sep: ReturnType<typeof separation>, [r, g, b]: number[], alpha = 1) => {
  const out = new Array<number>(sep.n);
  inksAt(sep, r, g, b, alpha, out);
  return out;
};
const near = (got: number[], want: number[], tol: number, what: string) =>
  got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= tol, `${what}: ink ${i} is ${v.toFixed(4)}, want ${want[i]}`));

test('the linear-to-sRGB table, reached through shared/color, lands on the sRGB curve', () => {
  const enc = encodeTable();
  assert.equal(enc[0], 0);
  assert.equal(enc[enc.length - 1], 1);
  assert.ok(Math.abs(lookup(enc, 0.2140411) - 0.5) < 1e-4);
  assert.ok(Math.abs(lookup(enc, 0.0031308) - 0.04045) < 1e-4);
  for (let i = 1; i < enc.length; i++) assert.ok(enc[i] >= enc[i - 1]);
});

test('process: pure inks separate to that ink alone, and a 50% grey to 50% black', () => {
  const sep = separation(PROCESS, 'process', NEUTRAL_TONE);
  near(inks(sep, [0, 1, 1]), [1, 0, 0, 0], 1e-6, 'cyan');
  near(inks(sep, [1, 0, 1]), [0, 1, 0, 0], 1e-6, 'magenta');
  near(inks(sep, [1, 1, 0]), [0, 0, 1, 0], 1e-6, 'yellow');
  near(inks(sep, [0, 0, 0]), [0, 0, 0, 1], 1e-6, 'black');
  near(inks(sep, [1, 1, 1]), [0, 0, 0, 0], 1e-6, 'white');
  near(inks(sep, linear(0.5, 0.5, 0.5)), [0, 0, 0, 0.5], 0.01, 'grey');
});

test('process: plates follow the inks, whatever order they come in', () => {
  const [c, m, y, k] = PROCESS;
  const sep = separation([k, y, c, m], 'process', NEUTRAL_TONE);
  near(inks(sep, [0, 1, 1]), [0, 0, 1, 0], 1e-6, 'cyan');
  assert.throws(() => separation([ink([0.5, 0, 0])], 'process', NEUTRAL_TONE), /channel/);
});

test('process: light greys take less black and more c, m and y (black generation); dark ones all black', () => {
  const sep = separation(PROCESS, 'process', NEUTRAL_TONE);
  const [c, m, y, k] = inks(sep, linear(0.8, 0.8, 0.8));
  assert.ok(k < 0.1 && c > 0.1 && Math.abs(c - m) < 0.01 && Math.abs(m - y) < 0.01);
  const dark = inks(sep, linear(0.3, 0.3, 0.3));
  near(dark, [0, 0, 0, 0.7], 0.015, 'dark grey');
});

test('spot: a pure ink colour separates to that ink alone', () => {
  for (const set of [SPOT, [...SPOT, ink(riso('Black')), ink(riso('Green')), ink(riso('Orange'))]]) {
    const sep = separation(set, 'spot', NEUTRAL_TONE, { paper: WHITE });
    set.forEach((one, i) => {
      const got = inks(sep, linearRgb(one.colour));
      near(got, set.map((_, j) => (j === i ? 1 : 0)), 0.03, `${set.length} inks, ink ${i}`);
    });
  }
});

test('spot: one ink is density along that ink, its tints come back as their coverage', () => {
  for (const colour of [riso('Blue'), riso('Fluorescent Pink'), riso('Black')]) {
    const sep = separation([ink(colour)], 'spot', NEUTRAL_TONE, { paper: WHITE });
    const solid = linearRgb(colour).map((v) => lookup(encodeTable(), v));
    for (const a of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const tint = solid.map((k) => 1 - a * (1 - k));
      near(inks(sep, linear(tint[0], tint[1], tint[2])), [a], 0.012, `tint ${a}`);
    }
  }
});

test('spot: one black ink follows lightness, so colours print as their greys', () => {
  const sep = separation([ink([0, 0, 0])], 'spot', NEUTRAL_TONE, { paper: WHITE });
  near(inks(sep, linear(0.5, 0.5, 0.5)), [0.5], 0.01, 'grey');
  const [yellow] = inks(sep, [1, 1, 0]);
  const [blue] = inks(sep, [0, 0, 1]);
  assert.ok(yellow < 0.15 && blue > 0.8, `yellow ${yellow}, blue ${blue}`);
});

test('spot: overprint mixes multiply, knockout mixes sit side by side', () => {
  const [blue, yellow] = SPOT;
  const [kb, ky] = [blue, yellow].map((i) => linearRgb(i.colour).map((v) => lookup(encodeTable(), v)));
  const over = separation([blue, yellow], 'spot', NEUTRAL_TONE, { paper: WHITE });
  const both = kb.map((v, c) => v * ky[c]);
  near(inks(over, linear(both[0], both[1], both[2])), [1, 1], 0.03, 'overprinted solids');
  const out = separation([blue, yellow], 'spot', NEUTRAL_TONE, { paper: WHITE, overlap: 'knockout' });
  // yellow on top at 50% over solid blue: half of each shows
  const half = kb.map((v, c) => 0.5 * v + 0.5 * ky[c]);
  near(inks(out, linear(half[0], half[1], half[2])), [1, 0.5], 0.03, 'knocked-out mix');
});

test('spot knockout: an ink lighter than the paper prints where the image is lighter (white on black stock)', () => {
  const white = ink([1, 0, 0]);
  const stock: Oklch = [0.2, 0, 0];
  const out = separation([white], 'spot', NEUTRAL_TONE, { paper: stock, overlap: 'knockout' });
  near(inks(out, [1, 1, 1]), [1], 0.02, 'white on black');
  near(inks(out, [0, 0, 0]), [0], 0.02, 'black is the stock');
  near(inks(out, [0, 0, 0], 0), [0], 0.01, 'transparent');
  // overprinted, a transparent ink can't lighten the sheet, so it isn't asked to
  near(inks(separation([white], 'spot', NEUTRAL_TONE, { paper: stock }), [1, 1, 1]), [0], 0.02, 'overprinted');
});

test('spot knockout: a smooth sweep of colour gives smooth plates (the fit has one answer, so no staircase)', () => {
  const four = ['Black', 'Fluorescent Pink', 'Medium Blue', 'Yellow'].map((n) => ink(riso(n)));
  const sep = separation(four, 'spot', NEUTRAL_TONE, { paper: BONE, overlap: 'knockout' });
  let last: number[] | null = null;
  for (let k = 0; k <= 1000; k++) {
    const f = k / 1000;
    // orange to pink to dark blue, through where the fit changes its inks
    const [r, g, b] = f < 0.5 ? [1 - f * 0.4, 0.5 - f * 0.6, 0.2 + f * 0.8] : [0.8 - (f - 0.5) * 1.4, 0.2 - (f - 0.5) * 0.2, 0.6 - (f - 0.5) * 0.6];
    // what each plate prints once the inks after it cut it (under a nearly solid top ink, the
    // coverage beneath is steep but never seen)
    const cover = inks(sep, linear(r, g, b));
    let free = 1;
    const now = cover.map(() => 0);
    for (let i = cover.length - 1; i >= 0; i--) [now[i], free] = [cover[i] * free, free * (1 - cover[i])];
    if (last) now.forEach((v, i) => assert.ok(Math.abs(v - last![i]) < 0.02, `ink ${i} jumps ${last![i].toFixed(3)} → ${v.toFixed(3)} at ${f}`));
    last = now;
  }
});

test(`spot: at most ${MAX_SPOT} inks`, () => {
  assert.throws(() => separation(Array.from({ length: MAX_SPOT + 1 }, () => ink(riso('Blue'))), 'spot', NEUTRAL_TONE), RangeError);
});

test('the paper is the image white: white and transparent take no ink, and the paper never changes a transparent fit', () => {
  for (const [mode, set] of [['process', PROCESS], ['spot', SPOT]] as const) {
    const sep = separation(set, mode, NEUTRAL_TONE, { paper: BONE });
    const zero = set.map(() => 0);
    near(inks(sep, [1, 1, 1]), zero, 0, `${mode} white on bone`);
    near(inks(sep, [0, 0, 0], 0), zero, 0, `${mode} transparent`);
    const white = separation(set, mode, NEUTRAL_TONE, { paper: WHITE });
    for (const colour of [linear(0.5, 0.5, 0.5), linear(0.9, 0.4, 0.2), linearRgb(BONE)]) near(inks(sep, colour), inks(white, colour), 0, `${mode} on bone as on white`);
  }
});

test('paper-relative: a grey on Bone prints with neutral ink only and takes on the paper, no ink cancels its tint', () => {
  const grey = linear(0.5, 0.5, 0.5);
  near(inks(separation(PROCESS, 'process', NEUTRAL_TONE, { paper: BONE }), grey), [0, 0, 0, 0.5], 0.01, 'process');
  // the Bone itself, as an image, is a light warm tint to print (it is not the image's white)
  const [c, m, y] = inks(separation(PROCESS, 'process', NEUTRAL_TONE, { paper: BONE }), linearRgb(BONE));
  assert.ok(y > m && m >= c, `bone is warm: c ${c.toFixed(3)} m ${m.toFixed(3)} y ${y.toFixed(3)}`);
  // knocked out, the lone black ink prints the grey's own share, not less to make up for the tint
  const out = separation([ink(riso('Black'))], 'spot', NEUTRAL_TONE, { paper: BONE, overlap: 'knockout' });
  near(inks(out, grey), [0.5], 0.01, 'knockout');
  near(inks(out, [1, 1, 1]), [0], 0.01, 'knockout white');
});

test('an opaque ink covers: white ink on dark stock prints the lights, and the stock is the darks', () => {
  const stock: Oklch = [0.2, 0, 0];
  const white = separation([{ ...ink(riso('White')), opaque: true }], 'spot', NEUTRAL_TONE, { paper: stock });
  near(inks(white, [1, 1, 1]), [1], 0.01, 'white');
  // exactly: a dot a fraction of a percent big still prints, as a speck on every cell
  near(inks(white, [0, 0, 0]), [0], 1e-4, 'black is the stock');
  near(inks(white, [0, 0, 0], 0), [0], 0, 'transparent');
  // the image's range laid over the stock's: a grey prints its own share of white
  for (const v of [0.25, 0.5, 0.75]) near(inks(white, linear(v, v, v)), [v], 0.012, `grey ${v}`);
  // the same ink transparent can't lighten the sheet, so it isn't asked to
  near(inks(separation([ink(riso('White'))], 'spot', NEUTRAL_TONE, { paper: stock }), [1, 1, 1]), [0], 0.02, 'transparent white');
});

test('a transparent ink over an opaque one: white goes down under a colour on dark stock, as a Riso underbase', () => {
  const stock: Oklch = [0.25, 0.02, 260];
  const pink = ink(riso('Fluorescent Pink'));
  const sep = separation([{ ...ink(riso('White')), opaque: true }, pink], 'spot', NEUTRAL_TONE, { paper: stock });
  // the pink, lifted a little as the image's black moves up to the stock
  const [w, p] = inks(sep, linearRgb(pink.colour));
  assert.ok(w > 0.97 && p > 0.8 && p < 0.95, `pink on white on the stock: white ${w.toFixed(3)}, pink ${p.toFixed(3)}`);
  near(inks(sep, [1, 1, 1]), [1, 0], 0.03, 'white');
  // the image's black is the stock: no pink spent darkening it towards a black it can't reach
  near(inks(sep, [0, 0, 0]), [0, 0], 1e-4, 'black');
  // an ink darker than the stock is the black, though
  const withBlack = separation([{ ...ink(riso('White')), opaque: true }, ink(riso('Black'))], 'spot', NEUTRAL_TONE, { paper: stock });
  near(inks(withBlack, [0, 0, 0]), [0, 1], 0.03, 'black ink');
  // a grey sweep from the stock up to white: the white ink rises steadily, no staircase
  let last = -1;
  for (let k = 0; k <= 200; k++) {
    const [w] = inks(sep, linear(k / 200, k / 200, k / 200));
    assert.ok(w >= last - 0.005 && (last < 0 || w - last < 0.04), `white ${last.toFixed(3)} → ${w.toFixed(3)} at ${k / 200}`);
    last = w;
  }
});

test('opaque means nothing to process inks: CMYK always overprints', () => {
  const plain = inks(separation(PROCESS, 'process', NEUTRAL_TONE, { paper: BONE }), linear(0.3, 0.6, 0.8));
  const flagged = inks(separation(PROCESS.map((i) => ({ ...i, opaque: true })), 'process', NEUTRAL_TONE, { paper: BONE }), linear(0.3, 0.6, 0.8));
  near(flagged, plain, 0, 'process');
});

test('hidden inks keep their plates, and the others keep theirs (v1 moved data between inks)', () => {
  const w = 16;
  const rgba = new Float32Array(w * 4);
  for (let x = 0; x < w; x++) rgba.set([...linear(x / w, 1 - x / w, 0.5), 1], x * 4);
  const shown = toPlates(rgba, w, 1, PROCESS.map((i) => ({ ...i, visible: true })), 'process', NEUTRAL_TONE);
  const hidden = toPlates(rgba, w, 1, PROCESS.map((i, n) => ({ ...i, visible: n !== 1 })), 'process', NEUTRAL_TONE);
  assert.deepEqual(hidden, shown);
});

test('tone: neutral changes nothing; levels, gamma and contrast move the plate as their names say', () => {
  for (let x = 0; x <= 1; x += 0.125) assert.ok(Math.abs(toneAt(NEUTRAL_TONE, x) - x) < 1e-12);
  const k = (tone: Tone, grey: number) => inks(separation([PROCESS[3]], 'process', tone), linear(grey, grey, grey))[0];
  assert.ok(Math.abs(k({ ...NEUTRAL_TONE, black: 0.3 }, 0.3) - 1) < 0.02, 'the black point prints solid');
  assert.ok(k({ ...NEUTRAL_TONE, white: 0.7 }, 0.7) < 0.02, 'the white point prints nothing');
  assert.ok(k({ ...NEUTRAL_TONE, gamma: 2 }, 0.5) < 0.4, 'gamma above 1 lifts the midtones');
  const s = { ...NEUTRAL_TONE, contrast: 0.5 };
  assert.ok(Math.abs(toneAt(s, 0.5) - 0.5) < 1e-12 && toneAt(s, 0) === 0 && toneAt(s, 1) === 1);
  assert.ok(toneAt(s, 0.25) < 0.25 && toneAt(s, 0.75) > 0.75);
});

test("an ink's curve reshapes its own plate only", () => {
  const half: [number, number][] = [[0, 0], [1, 0.5]];
  const plain = inks(separation(PROCESS, 'process', NEUTRAL_TONE), linear(0.2, 0.4, 0.6));
  const curved = inks(separation(PROCESS.map((i) => (i.process === 'c' ? { ...i, curve: half } : i)), 'process', NEUTRAL_TONE), linear(0.2, 0.4, 0.6));
  near(curved, [plain[0] / 2, plain[1], plain[2], plain[3]], 1e-3, 'curved cyan');
});

// the core keeps float precision; the tool hands it 8-bit values (a 16-bit TIFF is decoded to an ImageBitmap)
test('float input keeps its precision in the core: a fine shadow ramp gives a steady plate with more levels than 8 bits hold', () => {
  // linear light 0..0.012 (the darkest eighth of sRGB, about 30 of its 8-bit codes) in 4096 steps
  const n = 4096;
  const rgba = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) rgba.fill((0.012 * i) / (n - 1), i * 4, i * 4 + 3).fill(1, i * 4 + 3, i * 4 + 4);
  const [k] = toPlates(rgba, n, 1, [PROCESS[3]], 'process', NEUTRAL_TONE);
  let levels = 1;
  for (let i = 1; i < n; i++) {
    assert.ok(k[i] <= k[i - 1] + 1e-6, `black rises at ${i}`);
    if (k[i] !== k[i - 1]) levels++;
  }
  assert.ok(levels > 1000, `${levels} levels`);
});

test('toPlates is inksAt for every pixel', () => {
  const [w, h] = [5, 3];
  const rgba = Float32Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 1 - (i % 7) / 10 : ((i * 37) % 100) / 100));
  const sep = separation(SPOT, 'spot', NEUTRAL_TONE, { paper: BONE });
  const plates = toPlates(rgba, w, h, SPOT, 'spot', NEUTRAL_TONE, { paper: BONE });
  for (let p = 0; p < w * h; p++) {
    const want = inks(sep, [rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]], rgba[p * 4 + 3]);
    plates.forEach((plate, i) => assert.ok(Math.abs(plate[p] - want[i]) < 1e-6));
  }
});

test('coverage meters: mean and peak per plate, the most ink on any one spot', () => {
  const a = Float32Array.from([0, 0.5, 1, 0.5]);
  const b = Float32Array.from([1, 0.5, 0.75, 0]);
  assert.deepEqual(stats([a, b]), [{ mean: 0.5, peak: 1 }, { mean: 0.5625, peak: 1 }]);
  assert.equal(totalInk([a, b]), 1.75);
  assert.equal(totalInk([]), 0);
  assert.equal(totalInk([a, b], 2, 2), 1.0625, 'read in squares, as plates of any resolution are');
});

test('knocked out, each ink prints where no later ink covers it, and the most ink stays within 1', () => {
  const half = () => new Float32Array(4).fill(0.5);
  const both = knockedOut([half(), half()], [true, true], 2);
  assert.deepEqual(both.stats.map((st) => st.mean), [0.25, 0.5]);
  assert.equal(both.maxInk, 0.75);
  // a hidden top ink clears nothing
  assert.deepEqual(knockedOut([half(), half()], [true, false], 2).stats.map((st) => st.mean), [0.5, 0.5]);
});
