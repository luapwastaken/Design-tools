// Ordered screens and noise, on any palette: each pixel's threshold picks from its colour's mixing
// plan (plans.ts, Knoll's pattern dithering), dark to light, so the lighter colours of a mix take the
// highest thresholds. On black and white a grey comes out its sRGB value's share of white and a
// clustered dot grows as a dot; on a bigger palette a colour mixes from the colours around it, as
// diffusion's would (a pair of colours alone can't reach most colours of a 16-colour palette, and
// left hue bands). Nothing carries from pixel to pixel, so a pixel that doesn't change between
// frames doesn't change in the result (no crawl).
import type { OklabPalette } from './palette.ts';
import { N, planned } from './plans.ts';

/** a threshold 0..1 for each pixel */
export type Threshold = (x: number, y: number) => number;

/** a square matrix repeated from the image's top left */
export function tiled(m: Float32Array): Threshold {
  const n = Math.round(Math.sqrt(m.length));
  return (x, y) => m[(y % n) * n + (x % n)];
}

/** interleaved gradient noise (J. Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", 2014) */
export const ign: Threshold = (x, y) => {
  const v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
  return v - Math.floor(v);
};

/** white noise from a hash of the position and the seed, so each seed is one fixed pattern */
export const noise = (seed: number): Threshold => {
  const s = Math.imul((seed | 0) + 1, 0x9e3779b1);
  return (x, y) => {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ s;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
};

/**
 * The plans' error multiplier X (Knoll leaves it between 0 and 1): the smaller, the fewer colours a mix
 * takes, but the wider the dead zone round each palette colour where every candidate is that colour.
 * At 0.5 a screen mixes only what it needs and keeps the tone.
 */
export const SCREEN_X = 0.5;

/** strength (above 0) squeezes the thresholds towards 0.5, the middle of each plan; `mix` as palette.toMix gives it */
export function screen(mix: Float32Array, w: number, h: number, p: OklabPalette, t: Threshold, strength: number): Uint8Array {
  // the candidate at ceil(t·N) - 1 is lighter than the plan's k darkest exactly when t > k / N
  return planned(mix, w, h, p, SCREEN_X, (x, y) => Math.min(N - 1, Math.max(0, Math.ceil((0.5 + (t(x, y) - 0.5) * strength) * N) - 1)));
}
