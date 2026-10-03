// OKLCH geometry the palette code shares: its Cartesian form (OKLab) and chroma fitting.
import type { Color } from 'culori';
import { inSrgb, toOklch, type Oklch } from '../color/index.ts';

export type Oklab = [number, number, number];

const RAD = Math.PI / 180;

export const toOklab = ([l, c, h]: Oklch): Oklab => [l, c * Math.cos(h * RAD), c * Math.sin(h * RAD)];

/** `hue` is kept for colours with no chroma to carry one */
export const fromOklab = ([l, a, b]: Oklab, hue = 0): Oklch => toOklch({ mode: 'oklab', l, a, b } satisfies Color, hue);

export const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

/**
 * The same L and h with as much of its chroma as sRGB can show. Unlike `toSrgbGamut` (CSS gamut
 * mapping, which may shift L and h a hair), L and h stay exact: contrast fixes and harmonies
 * promise both.
 */
export function fitChroma([l, c, h]: Oklch): Oklch {
  if (inSrgb([l, c, h])) return [l, c, h];
  let [lo, hi] = [0, c];
  while (hi - lo > 1e-5) {
    const mid = (lo + hi) / 2;
    if (inSrgb([l, mid, h])) lo = mid;
    else hi = mid;
  }
  return [l, lo, h];
}
