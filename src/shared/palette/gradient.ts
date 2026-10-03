import { inSrgb, type Oklch } from '../color/index.ts';
import { fitChroma, fromOklab, toOklab, wrapHue } from './space.ts';

/** below this chroma a hue is invisible, so it shouldn't steer the blend (CSS "powerless" hue) */
const GREY = 1e-3;

/**
 * `n` stops strictly between `a` and `b`; in OKLCH the hue takes the short way round. Between two
 * sRGB colours the stops stay in sRGB too (an OKLCH arc can bulge out of it), L and h exact.
 */
export function gradientStops(a: Oklch, b: Oklch, n: number, space: 'oklch' | 'oklab'): Oklch[] {
  const stops = blend(a, b, n, space);
  return inSrgb(a) && inSrgb(b) ? stops.map(fitChroma) : stops;
}

function blend(a: Oklch, b: Oklch, n: number, space: 'oklch' | 'oklab'): Oklch[] {
  const count = Math.max(0, Math.floor(n));
  const ts = Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  const mix = (x: number, y: number, t: number) => x + (y - x) * t;
  if (space === 'oklab') {
    const [pa, pb] = [toOklab(a), toOklab(b)];
    const hue = a[1] >= b[1] ? a[2] : b[2];
    return ts.map((t) => fromOklab([mix(pa[0], pb[0], t), mix(pa[1], pb[1], t), mix(pa[2], pb[2], t)], hue));
  }
  const ha = a[1] < GREY ? b[2] : a[2];
  const hb = b[1] < GREY ? ha : b[2];
  const turn = ((hb - ha + 540) % 360) - 180;
  return ts.map((t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), wrapHue(ha + turn * t)]);
}
