import type { Oklch } from '../color/index.ts';
import { fitChroma, wrapHue } from './space.ts';

export type HarmonyKind = 'complementary' | 'analogous' | 'triad' | 'split' | 'tetrad';

const TURNS: Record<HarmonyKind, number[]> = {
  complementary: [180],
  analogous: [-30, 30],
  triad: [120, 240],
  split: [150, 210],
  tetrad: [90, 180, 270],
};

/** the harmony's other colours (not the base): hue turns at the base's L, chroma fitted to sRGB */
export function harmony([l, c, h]: Oklch, kind: HarmonyKind): Oklch[] {
  return TURNS[kind].map((turn) => fitChroma([l, c, wrapHue(h + turn)]));
}
