// Linear light to OKLab, fast enough for every pixel of a frame, with shared/color the only source
// of the colour maths. OKLab is a 3 × 3, a cube root per channel and another 3 × 3, so it scales with
// the cube root of intensity: lab(s·x) = ∛s·lab(x). A pixel is its sum s = r + g + b times a point on
// the triangle r + g + b = 1, so a table over that triangle, filled once through shared/color, gives
// any pixel with one cube root and a bilinear read, within 1e-4 of shared/color.
//
// Colours are matched in OKLab, but a dither pattern mixes light, and OKLab lightness is a cube root
// of it: a share L of white pixels reads far lighter than a grey of lightness L. So the dither mixes
// in (M, a, b), where M is the sRGB-encoded value of the grey as light as the colour: a grey's share
// of white is its sRGB value, as in the classic dither, and hue and chroma still mix in OKLab.
import { toOklch } from '../color/index.ts';
import { toOklab } from '../palette/space.ts';

const SIDE = 128;
/** nodes per row and rows: a pure red or green reads one node past the edge, weighted 0 */
const ROW = SIDE + 2;
let table: Float32Array | null = null;

function triangle(): Float32Array {
  if (table) return table;
  const t = new Float32Array(ROW * ROW * 3);
  for (let j = 0; j < ROW; j++) {
    for (let i = 0; i < ROW; i++) {
      const [r, g] = [i / SIDE, j / SIDE];
      t.set(toOklab(toOklch({ mode: 'lrgb', r, g, b: 1 - r - g })), (j * ROW + i) * 3);
    }
  }
  return (table = t);
}

// ∛s for s = r + g + b (0..3), read straight between the steps of a table, within 2e-5 (the
// darkest pixels, where the steps are too coarse, take Math.cbrt). Each pixel's root is its own, so
// a pixel that doesn't change between frames keeps its value.
const ROOTS = 16384;
let roots: Float64Array | null = null;
const rootTable = () => (roots ??= Float64Array.from({ length: ROOTS + 2 }, (_, j) => Math.cbrt((j / ROOTS) * 3)));

// the mixing lightness M and back, tabulated through shared/color's greys
const MIXES = 4096;
let lights: Float64Array | null = null;
let mixes: Float64Array | null = null;

function mixTables(): { lights: Float64Array; mixes: Float64Array } {
  if (lights && mixes) return { lights, mixes };
  // OKLab lightness of the sRGB grey k / MIXES, rising from 0 to 1
  const l = Float64Array.from({ length: MIXES + 1 }, (_, k) => toOklch({ mode: 'rgb', r: k / MIXES, g: k / MIXES, b: k / MIXES })[0]);
  const m = new Float64Array(MIXES + 1);
  for (let j = 0, k = 0; j <= MIXES; j++) {
    const want = j / MIXES;
    while (k < MIXES - 1 && l[k + 1] < want) k++;
    m[j] = Math.min(1, Math.max(0, (k + (want - l[k]) / (l[k + 1] - l[k])) / MIXES));
  }
  return { lights: (lights = l), mixes: (mixes = m) };
}

const read = (t: Float64Array, x: number) => {
  const p = (x > 0 ? (x < 1 ? x : 1) : 0) * MIXES;
  const i = p < MIXES ? p | 0 : MIXES - 1;
  return t[i] + (t[i + 1] - t[i]) * (p - i);
};

/** OKLab lightness L to the mixing lightness M: the sRGB value of the grey as light */
export const mixOf = (l: number): number => read(mixes ?? mixTables().mixes, l);

/** the mixing lightness M back to OKLab lightness, for matching */
export const lightOf = (m: number): number => read(lights ?? mixTables().lights, m);

type Box = { lo: readonly number[]; hi: readonly number[] };
const OPEN: Box = { lo: [-Infinity, -Infinity, -Infinity], hi: [Infinity, Infinity, Infinity] };

function convert(img: Float32Array, box: Box, mixed: boolean): Float32Array {
  const t = triangle();
  const R = rootTable();
  const mt = mixTables().mixes;
  const out = new Float32Array(img.length);
  const [l0, a0, b0] = box.lo;
  const [l1, a1, b1] = box.hi;
  for (let q = 0; q < img.length; q += 3) {
    let r = img[q];
    let g = img[q + 1];
    let b = img[q + 2];
    r = r > 0 ? r : 0;
    g = g > 0 ? g : 0;
    b = b > 0 ? b : 0;
    const s = r + g + b;
    if (!(s > 1e-9)) {
      out[q] = Math.min(l1, Math.max(l0, 0));
      out[q + 1] = Math.min(a1, Math.max(a0, 0));
      out[q + 2] = Math.min(b1, Math.max(b0, 0));
      continue;
    }
    const x = s * (ROOTS / 3);
    const j = x | 0;
    const k = j < 16 || j >= ROOTS ? Math.cbrt(s) : R[j] + (R[j + 1] - R[j]) * (x - j);
    const f = SIDE / s;
    const u = r * f;
    const v = g * f;
    const i = u | 0;
    const jj = v | 0;
    const fu = u - i;
    const fv = v - jj;
    const p00 = (jj * ROW + i) * 3;
    const p01 = p00 + ROW * 3;
    const w00 = (1 - fu) * (1 - fv) * k;
    const w10 = fu * (1 - fv) * k;
    const w01 = (1 - fu) * fv * k;
    const w11 = fu * fv * k;
    const L = t[p00] * w00 + t[p00 + 3] * w10 + t[p01] * w01 + t[p01 + 3] * w11;
    const A = t[p00 + 1] * w00 + t[p00 + 4] * w10 + t[p01 + 1] * w01 + t[p01 + 4] * w11;
    const B = t[p00 + 2] * w00 + t[p00 + 5] * w10 + t[p01 + 2] * w01 + t[p01 + 5] * w11;
    if (!mixed) {
      out[q] = L;
      out[q + 1] = A;
      out[q + 2] = B;
      continue;
    }
    // mixOf, by hand: this loop is hot
    const m = (L > 0 ? (L < 1 ? L : 1) : 0) * MIXES;
    const e = m < MIXES ? m | 0 : MIXES - 1;
    // min and max, not a branch: a clamp that bites every other pixel would stall on each guess
    out[q] = Math.min(l1, Math.max(l0, mt[e] + (mt[e + 1] - mt[e]) * (m - e)));
    out[q + 1] = Math.min(a1, Math.max(a0, A));
    out[q + 2] = Math.min(b1, Math.max(b0, B));
  }
  return out;
}

/** A linear RGB image (w*h*3, each channel 0..1) in OKLab. */
export const labImage = (img: Float32Array): Float32Array => convert(img, OPEN, false);

/** The same image as the dither mixes it, (M, a, b), each pixel held inside `box` (in those units). */
export const mixImage = (img: Float32Array, box: Box): Float32Array => convert(img, box, true);

/** OKLab of one linear-light colour, [L, a, b] */
export function labOf(r: number, g: number, b: number): [number, number, number] {
  const [l, a, bb] = labImage(Float32Array.of(r, g, b));
  return [l, a, bb];
}
