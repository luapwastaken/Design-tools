// The four checks over one palette, computed once per change and shared by the Checks view and the
// status slot.
import { inSrgb } from '../../../shared/color/index.ts';
import { contrastPairs, cvdClosest, valueCollisions, type ContrastPair, type CvdClosest, type ValueCollision } from '../../../shared/palette/checks.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { named } from '../common/names.ts';
import { VISIONS, type Kind as Vision } from '../common/Vision.tsx';

export type Results = {
  /** the palette as the checks name it: blank names filled in (an Illustration step by its ramp) */
  shown: Swatch[];
  contrast: ContrastPair[];
  /** below their target (4.5:1, or 3:1 for fills) */
  failing: ContrastPair[];
  collisions: ValueCollision[];
  vision: Record<Vision, CvdClosest | null>;
  outOfSrgb: Swatch[];
  /** what the checks call failures, for the status bar; out of sRGB is Print's own readout, not a failure */
  problems: number;
};

let last: { swatches: Swatch[]; flagL: number; flagE: number; out: Results } | null = null;

export function results(raw: Swatch[], ramps: RampSpec[] | undefined, flagL: number, flagE: number): Results {
  if (last && last.swatches === raw && last.flagL === flagL && last.flagE === flagE) return last.out;
  const swatches = named(raw, ramps);
  const contrast = contrastPairs(swatches, { minGap: flagL / 100 });
  const failing = contrast.filter((p) => p.ratio < p.target);
  const collisions = valueCollisions(swatches, flagL / 100);
  const vision = Object.fromEntries(VISIONS.map((k) => [k, cvdClosest(swatches, k, { flagBelow: flagE })])) as Results['vision'];
  const outOfSrgb = swatches.filter((w) => !inSrgb(w.oklch));
  // one pair merging under several simulations is one problem with one fix (as Vision shows it)
  const merged = new Set(VISIONS.filter((k) => k !== 'typical' && vision[k]?.flag).map((k) => [vision[k]!.a.id, vision[k]!.b.id].sort().join()));
  const out = { shown: swatches, contrast, failing, collisions, vision, outOfSrgb, problems: failing.length + collisions.length + merged.size };
  last = { swatches: raw, flagL, flagE, out };
  return out;
}
