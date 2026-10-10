// Colour temperature as a light colour (plan #10): the colour a Corona or C4D light of that many
// kelvin gives, and the way back. A blackbody's spectrum is integrated against an analytic fit of
// the CIE observer, turned into linear sRGB and divided by 6500 K's, so 6500 K is neutral as
// renderers have it. Pure.
import { fitChroma } from '../palette/space.ts';
import { toOklch, type Oklch } from './index.ts';

/** the range the Kelvin field runs over */
export const KELVIN = { min: 1000, max: 12000, neutral: 6500 } as const;

/** the lightness a light colour is given when nothing else says (the presets' lights sit between 0.64 and 0.98) */
const LIGHT_L = 0.9;
/** farther than this from the blackbody line (in OKLab a/b at the colour's own lightness) a colour reads as off it */
const ON_LINE = 0.015;

/** Wyman, Sloan and Shirley (2013): the CIE 1931 observer as sums of two-sided gaussians */
const lobe = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};
const xBar = (w: number) => 1.056 * lobe(w, 599.8, 37.9, 31.0) + 0.362 * lobe(w, 442.0, 16.0, 26.7) - 0.065 * lobe(w, 501.1, 20.4, 26.2);
const yBar = (w: number) => 0.821 * lobe(w, 568.8, 46.9, 40.5) + 0.286 * lobe(w, 530.9, 16.3, 31.1);
const zBar = (w: number) => 1.217 * lobe(w, 437.0, 11.8, 36.0) + 0.681 * lobe(w, 459.0, 26.0, 13.8);

/** Planck's second radiation constant, m·K */
const C2 = 1.4388e-2;

const bodies = new Map<number, [number, number, number]>();

/** linear sRGB of a blackbody, unnormalised (kept: reading a colour back walks the whole line) */
function blackbody(k: number): [number, number, number] {
  const kept = bodies.get(k);
  if (kept) return kept;
  let [X, Y, Z] = [0, 0, 0];
  for (let w = 380; w <= 780; w += 5) {
    const m = w * 1e-9;
    const b = m ** -5 / (Math.expm1(C2 / (m * k)) || 1e-300);
    X += b * xBar(w);
    Y += b * yBar(w);
    Z += b * zBar(w);
  }
  const rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map((v) => v / (Y || 1)) as [number, number, number];
  bodies.set(k, rgb);
  return rgb;
}

const WHITE = blackbody(KELVIN.neutral);

/**
 * The light colour of `k` kelvin at lightness `l`: the hue and chroma of the blackbody, 6500 K
 * neutral, with chroma giving way where sRGB cannot show it (the low end at a high lightness).
 */
export function kelvinToColour(k: number, l = LIGHT_L): Oklch {
  const t = Math.min(KELVIN.max, Math.max(KELVIN.min, Number.isFinite(k) ? k : KELVIN.neutral));
  const [r, g, b] = blackbody(t).map((v, i) => Math.max(0, v / WHITE[i]));
  // the same luminance as a grey of lightness l, so the chroma read off is the chroma at that lightness
  const want = l ** 3;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
  const [, c, h] = toOklch({ mode: 'lrgb', r: (r * want) / y, g: (g * want) / y, b: (b * want) / y });
  return fitChroma([l, c, c < 1e-4 ? 0 : h]);
}

const ab = (o: Oklch): [number, number] => [o[1] * Math.cos((o[2] * Math.PI) / 180), o[1] * Math.sin((o[2] * Math.PI) / 180)];

/**
 * What a light colour reads as: the kelvin whose blackbody colour (at the colour's own lightness)
 * is nearest, and `off` when none comes near. Whole kelvin; to the hundred is for the words.
 */
export function colourToKelvin(o: Oklch): { k: number; off: boolean } {
  const [pa, pb] = ab(o);
  const away = (k: number) => {
    const [qa, qb] = ab(kelvinToColour(k, o[0]));
    return Math.hypot(pa - qa, pb - qb);
  };
  // a coarse walk down the line, then the best step's neighbourhood
  let best: number = KELVIN.min;
  let d = Infinity;
  for (let k = KELVIN.min; k <= KELVIN.max; k += 50) {
    const x = away(k);
    if (x < d) [best, d] = [k, x];
  }
  let [lo, hi] = [Math.max(KELVIN.min, best - 50), Math.min(KELVIN.max, best + 50)];
  for (let i = 0; i < 20; i++) {
    const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
    if (away(m1) < away(m2)) hi = m2;
    else lo = m1;
  }
  const k = Math.round((lo + hi) / 2);
  return { k, off: away(k) > ON_LINE };
}

/** "about 3200 K", or "not a lamp colour" for one no temperature makes */
export const kelvinWordsOf = ({ k, off }: { k: number; off: boolean }): string => (off ? 'not a lamp colour' : `about ${Math.round(k / 100) * 100} K`);
export const kelvinWords = (o: Oklch): string => kelvinWordsOf(colourToKelvin(o));
