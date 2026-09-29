// The four checks over one palette, computed once per change and shared by the Check tab, its
// count on the tab and the status slot.
import { inSrgb, type Cvd } from '../../../shared/color/index.ts';
import { contrastPairs, cvdClosest, valueCollisions, type ContrastPair, type CvdClosest, type ValueCollision } from '../../../shared/palette/checks.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import type { IconName } from '../../shell/tool.ts';
import { displayName, named, plural } from '../common/names.ts';
import { VISIONS, type Kind as Vision } from '../common/Vision.tsx';
import type { CheckId } from './doc.ts';

/** a check's line in the Check tab's list; `ok` unset while the palette is too small to judge */
export type Verdict = { id: CheckId; label: string; verdict: string; ok?: boolean; icon: IconName };

export type Results = {
  /** the palette as the checks name it: blank names filled in (an Illustration step by its ramp) */
  shown: Swatch[];
  contrast: ContrastPair[];
  /** below their target (4.5:1, or 3:1 for fills) */
  failing: ContrastPair[];
  collisions: ValueCollision[];
  vision: Record<Vision, CvdClosest | null>;
  outOfSrgb: Swatch[];
  /** pairs that merge under some simulation, once each however many merge them */
  merged: number;
  verdicts: Verdict[];
  /** problems, each with its own fix: the Check tab's count and the status bar's */
  toLookAt: number;
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
  const merged = new Set(VISIONS.filter((k) => k !== 'typical' && vision[k]?.flag).map((k) => [vision[k]!.a.id, vision[k]!.b.id].sort().join())).size;
  const r = { shown: swatches, contrast, failing, collisions, vision, outOfSrgb, merged };
  const verdicts = [contrastVerdict(r), valueVerdict(r), visionVerdict(r), printVerdict(r)];
  const out = { ...r, verdicts, toLookAt: failing.length + collisions.length + merged + outOfSrgb.length };
  last = { swatches: raw, flagL, flagE, out };
  return out;
}

type Raw = Omit<Results, 'verdicts' | 'toLookAt'>;

function contrastVerdict({ shown, contrast, failing }: Raw): Verdict {
  const v = { id: 'contrast', label: 'Contrast', icon: 'contrast' } as const;
  if (!contrast.length) return { ...v, verdict: shown.length < 2 ? 'Needs a text colour and a background' : 'No text and background pairs to check' };
  const n = contrast.length;
  if (!failing.length) return { ...v, ok: true, verdict: n === 1 ? 'The text pair passes' : `All ${n} text pairs pass` };
  return { ...v, ok: false, verdict: `${failing.length} of ${n} text pairs ${failing.length === 1 ? 'is' : 'are'} too faint` };
}

function valueVerdict({ shown, collisions }: Raw): Verdict {
  const v = { id: 'value', label: 'Value', icon: 'tonality' } as const;
  if (shown.length < 2) return { ...v, verdict: 'Needs two or more colours' };
  if (!collisions.length) return { ...v, ok: true, verdict: 'Every colour stands apart in value' };
  const [first, ...more] = collisions;
  return { ...v, ok: false, verdict: `${displayName(first.a)} and ${displayName(first.b)} read as the same grey${more.length ? `, and ${plural(more.length, 'more pair')}` : ''}` };
}

/** names the pair of `shown` when that simulation merges one, so the line agrees with the detail beside it */
export function visionVerdict({ shown, vision, merged }: Raw, cvd?: Cvd): Verdict {
  const v = { id: 'vision', label: 'Colour vision', icon: 'visibility' } as const;
  if (shown.length < 2) return { ...v, verdict: 'Needs two or more colours' };
  const first = cvd && vision[cvd]?.flag ? cvd : VISIONS.find((k) => k !== 'typical' && vision[k]?.flag);
  if (!first) return { ...v, ok: true, verdict: 'Every colour stays apart in all four simulations' };
  const p = vision[first]!;
  const more = merged - 1;
  return { ...v, ok: false, verdict: `${displayName(p.a)} and ${displayName(p.b)} merge in ${first} vision${more ? `, and ${plural(more, 'more pair')}` : ''}` };
}

function printVerdict({ shown, outOfSrgb }: Raw): Verdict {
  const v = { id: 'print', label: 'Print', icon: 'print' } as const;
  if (!shown.length) return { ...v, verdict: 'Each colour’s ≈CMYK and nearest inks' };
  if (!outOfSrgb.length) return { ...v, ok: true, verdict: `${shown.length === 1 ? 'It is' : `All ${shown.length} are`} in sRGB. ≈CMYK and nearest inks listed` };
  const out = outOfSrgb.length === 1 ? `${displayName(outOfSrgb[0])} is` : `${outOfSrgb.length} colours are`;
  return { ...v, ok: false, verdict: `${out} outside sRGB` };
}
