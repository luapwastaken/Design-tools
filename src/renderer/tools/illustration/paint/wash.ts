// The colour a watercolour stroke gives on bare paper at a Load and Size, worked out on the CPU from the
// engine's own constants (tuning.ts, the composite's watercolour layer, km15's float64 references), so the
// brush chip can show what the stroke will be instead of the tube. Gouache lays the paint's own colour at
// full cover and needs no prediction.
import { toOklch, type Oklch } from '../../../../shared/color/index.ts';
import { gradientStops } from '../../../../shared/palette/gradient.ts';
import { layer15, linear15, reflectance15 } from '../../../../shared/paint/km15.ts';
import { filmStrength } from './bristles.ts';
import { PAPER_RGB } from './paper.ts';
import { brushPaint } from './stroke.ts';
import { WET } from './tuning.ts';
import type { Loaded } from './types.ts';

/**
 * How thick the middle of a wash lays at strength 1, in km.ts paint units (glsl/composite.ts, mode 0):
 * the water carries WET.wash of it and the hairs the rest at the amount a body has on average, and the
 * middle is WET.hollow paler than the rim. Far from an edge and a pixel's pooling and grain average out.
 */
export const WASH_THICK = WET.thick * (WET.wash + (1 - WET.wash) * WET.headAmount) * (1 - WET.hollow);

/**
 * A narrow stroke is nearly all rim: the rim's tail (WET.rimW px) still reaches its middle, so its wash
 * is thicker there by `1 + amp * exp(-size / tau)`. Fitted to the engine's own strokes at Sizes 10 to 60
 * (+18 % at 20, +46 % at 14, +86 % at 10; about 1 % at 40), so a brush under 10 is read as a 10.
 */
const NARROW = { amp: 4, tau: 6.5, min: 10 };
const narrow = (size: number): number => 1 + NARROW.amp * Math.exp(-Math.max(size, NARROW.min) / NARROW.tau);

/**
 * Where along a stroke the chip's two ends are read, px of travel at the engine's own pace: just past
 * the start's head (a wash's first 150 px or so are its darkest), and near the end of a run across the
 * 2048 px painting. Fitted on the engine's strokes (a sweep of 2128: 19 paints, Round and Flat, seven
 * Loads, Sizes 10 to 250), where it put the most strokes within 3 along their whole length; the fit is
 * flat from 150-300 px to 1200-1600 px.
 */
export const RUN = { from: 250, to: 1400 };

const PAPER = reflectance15(PAPER_RGB);

/**
 * The wash as the painting holds it, linear sRGB: the paint at film strength `strength` (0..1) as a
 * glaze over bare paper. Strength scales K and S together, which a layer reads as thickness.
 */
export function washRgb(loaded: Loaded, strength: number): [number, number, number] {
  const p = brushPaint(loaded, 'wet');
  const x = WASH_THICK * strength;
  return linear15(Array.from(PAPER, (r, i) => layer15(p.K[i], p.S, x, r)));
}

const washOf = (loaded: Loaded, strength: number): Oklch => {
  const [r, g, b] = washRgb(loaded, strength);
  return toOklch({ mode: 'lrgb', r, g, b });
};

/**
 * The two washes a stroke runs between, `first` near its start and `last` near the far end of a run
 * across the painting (`run`: where, in px of travel). The paint thins with travel, so a stroke is paler
 * the further it goes, and by more in a dark or strong pigment, whose colour moves fastest with
 * thickness, and a small brush holds out longer than a large one.
 */
export const washRange = (loaded: Loaded, load: number, size: number, run = RUN): { first: Oklch; last: Oklch } => {
  const at = (travel: number) => washOf(loaded, filmStrength(load, size, travel) * narrow(size));
  return { first: at(run.from), last: at(run.to) };
};

/**
 * The brush chip: the wash halfway between the two (in OKLab, so as far from one as from the other).
 * A stroke is never further from it than half the span between them. No one colour can be within ΔE00
 * 3 of both ends of a stroke that thins by more than 6 (a strong or dark paint at a high Load); for the
 * rest the whole stroke reads as the chip within 3 along its length, apart from the wash's own pooling.
 */
export function washColour(loaded: Loaded, load: number, size: number): Oklch {
  const { first, last } = washRange(loaded, load, size);
  return gradientStops(first, last, 1, 'oklab')[0];
}
