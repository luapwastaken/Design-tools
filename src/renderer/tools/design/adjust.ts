// Where the inspector and Add swatch put new colours. The checks' fixes are in common/adjust.ts.
import type { Oklch } from '../../../shared/color/index.ts';
import { fitChroma } from '../../../shared/palette/space.ts';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** where a new swatch goes in value (0..1, the grey it becomes): the middle of the widest gap the palette leaves */
export function nextV(vs: number[]): number {
  const stops = [0.05, ...vs.map(clamp01).sort((x, y) => x - y), 0.95];
  let best = 0.6;
  let width = -1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] > width) {
      width = stops[i] - stops[i - 1];
      best = (stops[i] + stops[i - 1]) / 2;
    }
  }
  return best;
}

export const TINT_LS = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];

/** the same hue down the lightness scale at exactly these lightnesses, chroma held where sRGB allows */
export const tints = ([, c, h]: Oklch): Oklch[] => TINT_LS.map((l) => fitChroma([l, c, h]));
