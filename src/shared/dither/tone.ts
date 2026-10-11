// Tone before the dither. Levels, gamma and contrast are Halftone's (shared/halftone toneAt, on each
// channel's sRGB-encoded value), so a setting means the same in both tools and the histogram reads in
// the same units. The gradient map lays the image's lightness along the palette in its own order, in
// the coordinates the dither mixes in (lab.ts): a tone halfway between two colours mixes them half
// and half.
import { linearRgb } from '../color/index.ts';
import { encodeTable, lookup, TABLE, toneAt } from '../halftone/tone.ts';
import type { Tone } from '../halftone/types.ts';
import { fromOklab } from '../palette/space.ts';
import { labImage, lightOf, mixOf } from './lab.ts';
import type { OklabPalette } from './palette.ts';

const LAST = TABLE - 1;
const RAMP = 1024;
let ramp: { key: string; values: Float64Array } | null = null;

/** an encoded value (0..1) back to linear light, through the encode table */
function decode(enc: Float32Array, e: number): number {
  let [lo, hi] = [0, LAST];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (enc[m] <= e) lo = m;
    else hi = m;
  }
  const span = enc[hi] - enc[lo];
  return (lo + (span > 0 ? Math.min(1, (e - enc[lo]) / span) : 0)) / LAST;
}

const neutral = (t: Tone) => t.black === 0 && t.white === 1 && t.gamma === 1 && t.contrast === 0 && !t.invert;

/** Levels, gamma, contrast and invert on a linear RGB image (w*h*3), in place; neutral tone leaves it exact. */
export function applyTone(img: Float32Array, tone: Tone): Float32Array {
  if (neutral(tone)) return img;
  const enc = encodeTable();
  const table = Float32Array.from(enc, (e) => decode(enc, toneAt(tone, e)));
  for (let i = 0; i < img.length; i++) img[i] = lookup(table, img[i]);
  return img;
}

/** the palette's ramp in linear light, RAMP steps from its first colour to its last, straight in the mixing coordinates */
function rampOf(p: OklabPalette): Float64Array {
  if (ramp?.key === p.key) return ramp.values;
  const values = new Float64Array(RAMP * 3);
  for (let k = 0; k < RAMP; k++) {
    const x = (k / (RAMP - 1)) * (p.n - 1);
    const i = Math.max(0, Math.min(p.n - 2, Math.floor(x)));
    const j = Math.min(p.n - 1, i + 1);
    const mix = (c: number) => p.mix[i * 3 + c] + (p.mix[j * 3 + c] - p.mix[i * 3 + c]) * (x - i);
    values.set(linearRgb(fromOklab([lightOf(mix(0)), mix(1), mix(2)])), k * 3);
  }
  ramp = { key: p.key, values };
  return values;
}

/**
 * Each pixel's lightness (as the sRGB value of the grey as light) as a place along the palette in its
 * own order: the first colour for black, the last for white, evenly spaced, between the two either
 * side, so the dither then mixes just those two. In place.
 */
export function gradientMap(img: Float32Array, p: OklabPalette): Float32Array {
  const values = rampOf(p);
  const lab = labImage(img);
  for (let q = 0; q < img.length; q += 3) {
    const t = mixOf(lab[q]) * (RAMP - 1);
    const k = t < RAMP - 1 ? t | 0 : RAMP - 2;
    const f = t - k;
    for (let c = 0; c < 3; c++) img[q + c] = values[k * 3 + c] + (values[k * 3 + 3 + c] - values[k * 3 + c]) * f;
  }
  return img;
}
