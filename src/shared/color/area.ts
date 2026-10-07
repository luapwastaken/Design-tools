// The Square's areas, one per colour model (as Photoshop's picker does): the area shows two
// components of the model, a bar the third. HSB is saturation by brightness and HSL saturation by
// lightness, both with the hue on the bar; RGB is blue across and green up with red on the bar;
// the OKLCH model is the L by C plane (plane.ts). The maths here is the RGB and HSL areas' (the
// rest is hold.ts and plane.ts), pure so it runs in tests; the renderer only draws it.
import { LUMA } from './fast.ts';
import { hslHold } from './value.ts';
import type { Rgb255 } from './picker.ts';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** the colour at a point of the RGB area at red `r`: blue across (x, 0..1), green up (y, 0..1) */
export const rgbAt = (r: number, x: number, y: number): Rgb255 => [r, Math.round(y * 255), Math.round(x * 255)];
/** the point of the RGB area a colour stands at: [x, y], 0..1 */
export const rgbPos = ([, g, b]: Rgb255): [number, number] => [b / 255, g / 255];

/** the HSL area's iso-value line at hue `h`: [saturation, lightness] (0-100) from S 0 to S 100 */
export function hslLine(target: number, h: number, n = 24): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = (100 * i) / n;
    return [s, hslHold(target, h, s)];
  });
}

/**
 * Where blue is allowed to run along the value line at red `r` (0-255), as 0..1 of the area's width:
 * value = 0.2126 R + 0.7152 G + 0.0722 B is a straight line in (B, G), and the square clips it.
 * Null where no colour at this red has the value.
 */
function reach(target: number, r: number): [number, number] | null {
  const rest = target - LUMA[0] * (r / 255);
  const lo = Math.max(0, (rest - LUMA[1]) / LUMA[2]);
  const hi = Math.min(1, rest / LUMA[2]);
  return lo <= hi + 1e-9 ? [lo, Math.max(lo, hi)] : null;
}

/** the RGB area's iso-value line at red `r`: its two ends as [x, y] (0..1, y up), or null where there is none */
export function rgbLine(target: number, r: number): [[number, number], [number, number]] | null {
  const span = reach(target, r);
  if (!span) return null;
  const at = (x: number): [number, number] => [x, clamp((target - LUMA[0] * (r / 255) - LUMA[2] * x) / LUMA[1], 0, 1)];
  return [at(span[0]), at(span[1])];
}

/** the colour on that line at blue `x` (0..1; clamped to where the line is): the drag rides it. Null where there is no line. */
export function rgbOnLine(target: number, r: number, x: number): Rgb255 | null {
  const span = reach(target, r);
  if (!span) return null;
  const bx = clamp(x, span[0], span[1]);
  return rgbAt(r, bx, clamp((target - LUMA[0] * (r / 255) - LUMA[2] * bx) / LUMA[1], 0, 1));
}
