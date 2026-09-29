// The palette as the dither sees it: each colour as its hex shows it (shared/color's linearRgb), in
// OKLab, where colours are matched, and in the mixing coordinates (lab.ts), where errors and mixes
// are measured. Colours and pixels go through the same conversion, so a pixel of exactly a palette
// colour lands on it with no error.
import { linearRgb, type Oklch } from '../color/index.ts';
import { extractColours } from '../palette/extract.ts';
import { labOf, lightOf, mixImage, mixOf } from './lab.ts';

export { lightOf } from './lab.ts';

/**
 * Up to this many colours a straight scan beats the walk (measured). The scan sits in `nearest`
 * itself and the walk apart, so `nearest` stays small enough for the engine to inline into the
 * pixel loops.
 */
const SCAN = 16;

export type OklabPalette = {
  n: number;
  /** L, a, b of each colour, in palette order */
  lab: Float64Array;
  /** M, a, b of each colour (M the mixing lightness), in palette order */
  mix: Float64Array;
  /** the box the colours span in M, a and b: wanted colours and diffused values are held inside it */
  lo: [number, number, number];
  hi: [number, number, number];
  /** palette indices from dark to light (ties in palette order) */
  byL: Uint8Array;
  /** L, a and b of the colours in that order, for the search */
  sl: Float64Array;
  sa: Float64Array;
  sb: Float64Array;
  /** the same colours give the same key */
  key: string;
};

/** Up to 256 colours, as the file will show them: the sRGB hex of each, not its stored OKLCH. */
export function toOklab(colours: Oklch[]): OklabPalette {
  const n = Math.min(256, colours.length);
  const lab = new Float64Array(n * 3);
  colours.slice(0, n).forEach((c, i) => lab.set(labOf(...linearRgb(c)), i * 3));
  // as a pixel's M is kept, in single precision
  const mix = Float64Array.from(lab, (v, i) => (i % 3 ? v : Math.fround(mixOf(v))));
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) {
    lo[i % 3] = Math.min(lo[i % 3], mix[i]);
    hi[i % 3] = Math.max(hi[i % 3], mix[i]);
  }
  const byL = Uint8Array.from({ length: n }, (_, i) => i).sort((x, y) => lab[x * 3] - lab[y * 3] || x - y);
  const axis = (c: number) => Float64Array.from(byL, (i) => lab[i * 3 + c]);
  return { n, lab, mix, lo, hi, byL, sl: axis(0), sa: axis(1), sb: axis(2), key: lab.join() };
}

/**
 * The palette index nearest (L, a, b), exactly; a tie goes to the darker, then the earlier. Up to 16
 * colours a straight scan is fastest; past that the search starts at the colours of the same
 * lightness and walks out both ways until lightness alone is further than the best found.
 */
export function nearest(p: OklabPalette, l: number, a: number, b: number): number {
  if (p.n > SCAN) return walk(p, l, a, b);
  const { sl, sa, sb, n } = p;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const dl = sl[i] - l;
    const da = sa[i] - a;
    const db = sb[i] - b;
    const d = dl * dl + da * da + db * db;
    if (d < best) {
      best = d;
      at = i;
    }
  }
  return p.byL[at];
}

function walk(p: OklabPalette, l: number, a: number, b: number): number {
  const { sl, sa, sb, n } = p;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sl[m] < l) lo = m + 1;
    else hi = m;
  }
  let best = Infinity;
  let at = 0;
  for (let i = lo - 1; i >= 0; i--) {
    const dl = l - sl[i];
    if (dl * dl > best) break;
    const da = sa[i] - a;
    const db = sb[i] - b;
    const d = dl * dl + da * da + db * db;
    if (d <= best) {
      best = d;
      at = i;
    }
  }
  for (let i = lo; i < n; i++) {
    const dl = sl[i] - l;
    if (dl * dl >= best) break;
    const da = sa[i] - a;
    const db = sb[i] - b;
    const d = dl * dl + da * da + db * db;
    if (d < best) {
      best = d;
      at = i;
    }
  }
  return p.byL[at];
}

/** the palette index nearest a point in the mixing coordinates, matched in OKLab */
export const nearestMix = (p: OklabPalette, m: number, a: number, b: number): number => nearest(p, lightOf(m), a, b);

/**
 * A linear RGB image (w*h*3) as the dither mixes it, each pixel held inside the palette's box: a
 * colour the palette can't get near (red, on black and white) would otherwise pile up error without end.
 */
export const toMix = (img: Float32Array, p: OklabPalette): Float32Array => mixImage(img, p);

/** `k` colours from an image's sRGB bytes (shared/palette's k-means in OKLab), dark to light. */
export const extractPalette = (rgba: Uint8ClampedArray, w: number, h: number, k: number): Oklch[] =>
  extractColours(rgba, w, h, k)
    .map((c) => c.oklch)
    .sort((x, y) => x[0] - y[0]);
