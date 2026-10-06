// Palette from an image: weighted k-means++ in OKLab over the distinct colours of a subsample.
import { toOklch, type Oklch } from '../color/index.ts';
import { random } from './random.ts';
import { fitChroma, fromOklab, toOklab, type Oklab } from './space.ts';

const MAX_SAMPLES = 40_000;
const MAX_ROUNDS = 30;

export type Extracted = { oklch: Oklch; weight: number };

/** Up to `k` colours, heaviest first; `weight` is the share of the opaque pixels sampled (alpha < 128 ignored). */
export function extractColours(rgba: Uint8ClampedArray, w: number, h: number, k: number, seed = 1): Extracted[] {
  const { points, weights } = sample(rgba, w * h);
  const n = Math.min(Math.max(1, Math.floor(k)), points.length);
  if (!n) return [];
  const rnd = random(seed);
  const centres = seeds(points, weights, n, rnd);
  const owner = new Int32Array(points.length);
  // Lloyd's rounds from the seeds' places; `rounds` 0 only hands every point to its nearest centre
  const settle = (rounds = MAX_ROUNDS) => {
    owner.fill(-1);
    for (let round = 0; round <= rounds; round++) {
      let moved = false;
      points.forEach((p, i) => {
        const c = nearest(p, centres).index;
        if (c !== owner[i]) [owner[i], moved] = [c, true];
      });
      if (!moved || round === rounds) break;
      const sums = centres.map(() => [0, 0, 0, 0]);
      points.forEach((p, i) => {
        const s = sums[owner[i]];
        for (let d = 0; d < 3; d++) s[d] += p[d] * weights[i];
        s[3] += weights[i];
      });
      sums.forEach(([l, a, b, m], c) => m && (centres[c] = [l / m, a / m, b / m]));
    }
  };
  settle();
  // an accent keeps the place it is given: the rounds would pull it back into its neighbours
  if (n > 1 && rescue(points, weights, centres, owner)) settle(0);
  const mass = new Float64Array(n);
  owner.forEach((c, i) => (mass[c] += weights[i]));
  const total = weights.reduce((a, b) => a + b, 0);
  return centres
    // a mean of sRGB pixels can land a hair outside sRGB (near white, say): back in, L and h kept
    .map((c, i) => ({ oklch: fitChroma(fromOklab(c)), weight: mass[i] / total }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

/** a colour this chromatic, in OKLab, counts as an accent */
const ACCENT_CHROMA = 0.12;
/** an accent is only one when no centre is nearer than this (OKLab distance) */
const ACCENT_APART = 0.07;
/** its pixels are those this near the most chromatic one */
const ACCENT_REACH = 0.07;
/** and it is an accent when they are at least this share of the pixels sampled */
const ACCENT_SHARE = 0.005;

/**
 * The small, bright colour k-means folds into its neighbours (a fire against a dark forest): the most
 * chromatic colour that no centre is near, if there are enough of its pixels, takes the place of the
 * lightest centre. True when it did.
 */
function rescue(points: Oklab[], weights: number[], centres: Oklab[], owner: Int32Array): boolean {
  const total = weights.reduce((a, b) => a + b, 0);
  const apart = points.map((p) => Math.hypot(p[1], p[2]) > ACCENT_CHROMA && nearest(p, centres).d2 > ACCENT_APART ** 2);
  const seed = points.reduce((best, p, i) => (apart[i] && (best < 0 || Math.hypot(p[1], p[2]) > Math.hypot(points[best][1], points[best][2])) ? i : best), -1);
  if (seed < 0) return false;
  // the accent: the far, chromatic pixels around its most chromatic one
  const mean = [0, 0, 0, 0];
  points.forEach((p, i) => {
    if (!apart[i] || Math.hypot(p[0] - points[seed][0], p[1] - points[seed][1], p[2] - points[seed][2]) > ACCENT_APART / 2) return;
    for (let d = 0; d < 3; d++) mean[d] += p[d] * weights[i];
    mean[3] += weights[i];
  });
  if (mean[3] / total < ACCENT_SHARE) return false;
  const mass = centres.map(() => 0);
  owner.forEach((c, i) => (mass[c] += weights[i]));
  const least = mass.indexOf(Math.min(...mass));
  centres[least] = [mean[0] / mean[3], mean[1] / mean[3], mean[2] / mean[3]];
  return true;
}

/** every `step`th opaque pixel, merged into distinct colours with their counts */
function sample(rgba: Uint8ClampedArray, pixels: number) {
  const step = Math.max(1, Math.ceil(pixels / MAX_SAMPLES));
  const counts = new Map<number, number>();
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    if (rgba[i + 3] < 128) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const points: Oklab[] = [];
  const weights: number[] = [];
  for (const [key, count] of counts) {
    const rgb = { mode: 'rgb' as const, r: (key >> 16) / 255, g: ((key >> 8) & 255) / 255, b: (key & 255) / 255 };
    points.push(toOklab(toOklch(rgb)));
    weights.push(count);
  }
  return { points, weights };
}

/** k-means++: each next centre drawn with odds of weight times squared distance to the nearest so far */
function seeds(points: Oklab[], weights: number[], n: number, rnd: () => number): Oklab[] {
  const centres = [points[draw(weights, rnd)]];
  while (centres.length < n) {
    const odds = points.map((p, i) => weights[i] * nearest(p, centres).d2);
    if (!odds.some((o) => o > 0)) break; // fewer distinct colours than asked for
    centres.push(points[draw(odds, rnd)]);
  }
  return centres.map((c) => [...c]);
}

function draw(odds: number[], rnd: () => number): number {
  let r = rnd() * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < odds.length; i++) if ((r -= odds[i]) < 0) return i;
  return odds.findLastIndex((o) => o > 0);
}

function nearest(p: Oklab, centres: Oklab[]) {
  let [index, d2] = [0, Infinity];
  centres.forEach((c, i) => {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < d2) [index, d2] = [i, d];
  });
  return { index, d2 };
}
