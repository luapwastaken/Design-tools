// Value: the grey a colour becomes when the picture is greyed, which is what a painter judges form
// by. One measure for the value lock, the greyscale toggle and every value check: Rec. 709 luma of
// the gamma-encoded sRGB the screen shows, 0..1 (CSS grayscale(), Krita's Luminosity BT.709 and
// v1's value lock). Not OKLCH L: at one L a saturated magenta and yellow sit up to a quarter of the
// scale apart in grey.
import { heldEdge, LUMA } from './fast.ts';
import { displayRgb, toOklch, type Oklch } from './index.ts';
import { maxChroma } from './picker.ts';

export { LUMA };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;

/** the values of an SVG feColorMatrix that greys the picture to this measure: R, G and B all become the luma, alpha stays */
export const greyMatrix = (): string => {
  const row = `${LUMA.join(' ')} 0 0`;
  return `${row} ${row} ${row} 0 0 0 1 0`;
};

/** The value of what the screen shows, 0 (black) to 1 (white). */
export function valueOf(o: Oklch): number {
  const { r, g, b } = displayRgb(o);
  return luma(r, g, b);
}

/** The grey whose value is `v`: an sRGB grey has R = G = B = v. `hue` is kept for the picker. */
export function greyOf(v: number, hue = 0): Oklch {
  const x = clamp01(v);
  return [toOklch({ mode: 'rgb', r: x, g: x, b: x })[0], 0, hue];
}

/**
 * The colour at chroma `c` and hue `h` whose value is `target`. At a fixed chroma and hue, value
 * rises with L, so L is found by bisection. Where no L inside sRGB reaches the target at that
 * chroma, chroma gives way and L is solved again: the value is what is held.
 */
export function holdValue(target: number, c: number, h: number): Oklch {
  const t = clamp01(target);
  if (t <= 0) return [0, 0, h];
  if (t >= 1) return [1, 0, h];
  const solve = (cc: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const m = (lo + hi) / 2;
      if (valueOf([m, cc, h]) < t) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const cc = Math.max(0, c);
  const l = solve(cc);
  if (cc <= maxChroma(l, h, 'srgb')) return [l, cc, h];
  // past the most chroma sRGB has at this value, chroma gives way: to that edge, which bisection finds exactly
  const edge = heldEdge(t, h).c;
  const le = solve(edge);
  // the last solve may leave a hair outside; trimming it moves the value by far less than a hex step
  return [le, Math.min(edge, maxChroma(le, h, 'srgb')), h];
}

/** Rec. 709 luma of the pure HSB hue `h` (S and B 100%), 0..1 */
export function pureLuma(h: number): number {
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return luma(f(5), f(3), f(1));
}

/**
 * HSB saturation and brightness (0-100) at HSB hue `h` with this value, keeping saturation `s`
 * where it can. In HSB, value = B·(1 − S·(1 − pureLuma(h))) exactly; where B would pass 100,
 * saturation gives way instead.
 */
export function hsbHold(target: number, h: number, s: number): [number, number] {
  const t = clamp01(target);
  const p = pureLuma(h);
  const sat = clamp01(s / 100);
  const b = t / (1 - sat * (1 - p));
  if (b <= 1) return [sat * 100, b * 100];
  return [p >= 1 ? 0 : clamp01((1 - t) / (1 - p)) * 100, 100];
}

/** Rec. 709 luma of the HSL colour (h 0-360, s and l 0-1) */
const hslLuma = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return luma(f(0), f(8), f(4));
};

/**
 * HSL lightness (0-100) at HSL hue `h` and saturation `s` (0-100) with this value. Value runs from
 * 0 at L 0 to 1 at L 100 and never falls between, so every value is reachable and saturation never
 * gives way (unlike HSB).
 */
export function hslHold(target: number, h: number, s: number): number {
  const t = clamp01(target);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const m = (lo + hi) / 2;
    if (hslLuma(h, s / 100, m) < t) lo = m;
    else hi = m;
  }
  return ((lo + hi) / 2) * 100;
}
