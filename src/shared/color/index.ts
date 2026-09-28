// Colour, as a thin wrapper over culori (spec §10.2). OKLCH is the stored truth; hex is always
// 6-digit sRGB. Gamut checks run on OKLCH, never on hex.
import {
  clampRgb,
  converter,
  differenceCiede2000,
  differenceEuclidean,
  displayable,
  filterDeficiencyDeuter,
  filterDeficiencyProt,
  filterDeficiencyTrit,
  formatHex,
  interpolate,
  wcagContrast,
  wcagLuminance,
  type Color,
  type Oklch as CuloriOklch,
  type Rgb,
} from 'culori';

/** [L 0..1, C 0..~0.4, H 0..360], as in `Swatch.oklch` */
export type Oklch = [number, number, number];
/** A hex string (anything `parseHex` accepts) or an OKLCH triple. */
export type ColorIn = string | Oklch;
export type WcagGrade = 'AAA' | 'AA' | 'AA large · non-text' | 'Fail';
export type Cvd = 'protan' | 'deutan' | 'tritan' | 'achromat';

const rgbOf = converter('rgb');
const p3Of = converter('p3');
const lrgbOf = converter('lrgb');
const oklchOf = converter('oklch');
const ciede2000 = differenceCiede2000();
const deltaEOK = differenceEuclidean('oklab');

/** float slack, so a colour that came from a hex still counts as in gamut */
const EPS = 1e-6;
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const culoriOf = ([l, c, h]: Oklch): CuloriOklch => ({ mode: 'oklch', l, c, h });
const within = ({ r, g, b }: { r: number; g: number; b: number }) =>
  [r, g, b].every((v) => v >= -EPS && v <= 1 + EPS);

/** Any culori colour to an OKLCH triple, L held to 0..1; achromatic colours (no hue) take `hue`. */
export function toOklch(color: Color, hue = 0): Oklch {
  const { l, c, h } = oklchOf(color);
  return [Math.min(1, Math.max(0, l)), c, h ?? hue];
}

/** '#abc', 'abc', '#aabbcc' or 'aabbcc' → '#aabbcc'; null for anything else. */
export function parseHex(s: string): string | null {
  const m = HEX.exec(s.trim());
  if (!m) return null;
  const d = m[1].toLowerCase();
  return '#' + (d.length === 3 ? d.replace(/./g, '$&$&') : d);
}

/** Throws on junk: callers validate user input with `parseHex` first. */
export function hexToOklch(hex: string): Oklch {
  return toOklch(hexRgb(hex));
}

export const toHex = (o: Oklch): string => formatHex(srgb(o));
export const inSrgb = (o: Oklch): boolean => within(rgbOf(culoriOf(o)));
export const inP3 = (o: Oklch): boolean => within(p3Of(culoriOf(o)));

export function toSrgbGamut(o: Oklch): Oklch {
  return inSrgb(o) ? [...o] : toOklch(srgb(o), o[2]);
}

/** WCAG 2 contrast ratio (1–21) of what an sRGB screen shows. */
export const contrast = (a: ColorIn, b: ColorIn): number => wcagContrast(shown(a), shown(b));

export const wcagGrade = (ratio: number): WcagGrade =>
  ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large · non-text' : 'Fail';

/** CIEDE2000, 0 (same) to ~100 (black against white). */
export const deltaE = (a: ColorIn, b: ColorIn): number => ciede2000(truth(a), truth(b));

const MACHADO = { protan: filterDeficiencyProt, deutan: filterDeficiencyDeuter, tritan: filterDeficiencyTrit };

/** What a viewer with this colour vision deficiency sees on an sRGB screen (Machado 2009; achromat = luminance only). */
export function simulateCvd(o: Oklch, type: Cvd, severity = 1): Oklch {
  const rgb = srgb(o);
  const s = Math.min(1, Math.max(0, severity));
  const seen = type === 'achromat' ? achromat(rgb, s) : machado(type, rgb, s);
  return toOklch(clampRgb(seen), o[2]);
}

/**
 * ≈CMYK, 0–100 each: the naive formula on the sRGB colour, no ICC profile.
 * Always label it as an estimate wherever it shows.
 */
export function cmykEstimate(o: Oklch): [number, number, number, number] {
  const { r, g, b } = srgb(o);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const ink = (v: number) => Math.round(((1 - v - k) / (1 - k)) * 100);
  return [ink(r), ink(g), ink(b), Math.round(k * 100)];
}

/**
 * `oklch(L C H)` for inline styles of content colours, showing exactly the hex readout: gamut-mapped
 * first, because Chromium clips an out-of-sRGB oklch() per channel; 5 decimals, because 4 moves
 * some hex colours by one 8-bit step.
 */
export function cssColor(o: Oklch): string {
  const [l, c, h] = toSrgbGamut(o);
  return `oklch(${+l.toFixed(5)} ${+c.toFixed(5)} ${+h.toFixed(3)})`;
}

const JND = 0.02;
const clip = (c: Color): Rgb => clampRgb(rgbOf(c));

/**
 * The sRGB colour a screen shows: CSS Color 4 gamut mapping (§13.2) as written. culori's `toGamut`
 * skips the first clip test and bisects differently, landing up to ΔE 1 away. That first test
 * also keeps hex round trips exact where float error puts a colour a hair outside sRGB.
 */
function srgb([l, c, h]: Oklch): Rgb {
  if (l >= 1) return { mode: 'rgb', r: 1, g: 1, b: 1 };
  if (l <= 0) return { mode: 'rgb', r: 0, g: 0, b: 0 };
  const current: CuloriOklch = { mode: 'oklch', l, c, h };
  let clipped = clip(current);
  if (deltaEOK(clipped, current) < JND) return clipped; // in gamut, or close enough
  let min = 0;
  let max = c;
  let minInGamut = true;
  while (max - min > 1e-4) {
    current.c = (min + max) / 2;
    if (minInGamut && displayable(current)) {
      min = current.c;
      continue;
    }
    clipped = clip(current);
    const e = deltaEOK(clipped, current);
    if (e >= JND) max = current.c;
    else if (JND - e < 1e-4) return clipped;
    else {
      minInGamut = false;
      min = current.c;
    }
  }
  return clipped;
}

/** culori snaps severity to its 0.1 table steps; blend the two steps either side instead. */
function machado(type: Exclude<Cvd, 'achromat'>, rgb: Rgb, s: number): Color {
  const i = Math.floor(s * 10);
  const [a, b] = [i, Math.min(10, i + 1)].map((step) => MACHADO[type](step / 10)(rgb));
  return interpolate([a, b], 'rgb')(s * 10 - i);
}

function hexRgb(hex: string): Rgb {
  const h = parseHex(hex);
  if (!h) throw new TypeError(`Not a hex colour: "${hex}"`);
  return rgbOf(h)!;
}

const shown = (c: ColorIn): Color => (typeof c === 'string' ? hexRgb(c) : srgb(c));
const truth = (c: ColorIn): Color => (typeof c === 'string' ? hexRgb(c) : culoriOf(c));

function achromat(rgb: Rgb, s: number): Color {
  const y = wcagLuminance(rgb);
  const { r, g, b } = lrgbOf(rgb);
  return { mode: 'lrgb', r: r + (y - r) * s, g: g + (y - g) * s, b: b + (y - b) * s };
}
