// Tone before screening, as 1D tables, interpolated straight between entries (as a linear-filtered
// texture would read them).
import { toOklch } from '../color/index.ts';
import type { Tone } from './types.ts';

/** entries in every 1D table */
export const TABLE = 4096;
const LAST = TABLE - 1;

export const NEUTRAL_TONE: Tone = { black: 0, white: 1, gamma: 1, contrast: 0 };

let encoded: Float32Array | null = null;

/**
 * Linear light to sRGB-encoded, tabulated. shared/color holds the only transfer function; it is
 * reached through OKLCH lightness, which rises along the greys in both encodings, so matching
 * lightness matches the value.
 */
export function encodeTable(): Float32Array {
  if (encoded) return encoded;
  const lightness = (mode: 'rgb' | 'lrgb', v: number) => toOklch({ mode, r: v, g: v, b: v })[0];
  const byCode = Float64Array.from({ length: TABLE }, (_, k) => lightness('rgb', k / LAST));
  const table = new Float32Array(TABLE);
  for (let j = 0, k = 0; j < TABLE; j++) {
    const l = lightness('lrgb', j / LAST);
    while (k < LAST - 1 && byCode[k + 1] < l) k++;
    const f = (l - byCode[k]) / (byCode[k + 1] - byCode[k]);
    table[j] = Math.min(1, Math.max(0, (k + f) / LAST));
  }
  return (encoded = table);
}

/** a table's value at x (clamped to 0..1), straight between entries; `at` picks a table out of several laid end to end */
export function lookup(table: Float32Array, x: number, at = 0): number {
  const p = (x > 0 ? (x < 1 ? x : 1) : 0) * LAST;
  const i = p < LAST ? p | 0 : LAST - 1;
  const lo = table[at + i];
  return lo + (table[at + i + 1] - lo) * (p - i);
}

/** Levels (black and white input points), gamma (above 1 lifts the midtones), then an S-curve for contrast. */
export function toneAt(t: Tone, x: number): number {
  const span = t.white - t.black;
  let v = span > 1e-6 ? (x - t.black) / span : x >= t.white ? 1 : 0;
  v = v > 0 ? (v < 1 ? v : 1) : 0;
  if (t.gamma > 0 && t.gamma !== 1) v **= 1 / t.gamma;
  if (t.contrast) {
    // x^p / (x^p + (1 − x)^p): ends and middle stay put; p = 4 at full contrast, 1/4 at the least
    const p = 4 ** t.contrast;
    const a = v ** p;
    v = a / (a + (1 - v) ** p);
  }
  return v;
}

/** Linear light to toned sRGB, the same for each channel. */
export const toneTable = (tone: Tone): Float32Array => encodeTable().map((v) => toneAt(tone, v));

/** a transfer curve's output at x: [in, out] points in rising order, straight between them */
export function curveAt(curve: [number, number][], x: number): number {
  if (!curve.length) return x;
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return curve[curve.length - 1][1];
}

export function curveTable(curve: [number, number][]): Float32Array {
  return Float32Array.from({ length: TABLE }, (_, j) => Math.min(1, Math.max(0, curveAt(curve, j / LAST))));
}
