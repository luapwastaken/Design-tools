// The one way this tool dithers (plan: the one rule): tone, then the gradient map, then the
// algorithm, all shared/dither. The worker runs it on the working image; the inspector's small
// specimens run it on a handful of pixels. Nothing else turns pixels into palette indices.
import { hexToOklch, linearRgb, type Oklch } from '../../../shared/color/index.ts';
import { dither } from '../../../shared/dither/algorithms.ts';
import { toOklab } from '../../../shared/dither/palette.ts';
import { applyTone, gradientMap } from '../../../shared/dither/tone.ts';
import type { DitherDoc } from './doc.ts';

export type Settings = Pick<DitherDoc, 'algorithm' | 'strength' | 'serpentine' | 'seed' | 'tone'> & { colours: Oklch[] };

export const settingsOf = (d: DitherDoc, colours: Oklch[]): Settings => ({ algorithm: d.algorithm, strength: d.strength, serpentine: d.serpentine, seed: d.seed, tone: d.tone, colours });

// sRGB byte to linear light, through shared/color (the grey of each byte, decoded)
const hex2 = (v: number) => v.toString(16).padStart(2, '0');
export const DECODE = Float32Array.from({ length: 256 }, (_, v) => linearRgb(hexToOklch(`#${hex2(v).repeat(3)}`))[0]);

/** sRGB bytes to linear RGB, w*h*3; what's transparent is flattened on white (the paper of a print) */
export function linearOf(rgba: Uint8ClampedArray, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let p = 0, q = 0, o = 0; p < n; p++, q += 4, o += 3) {
    const a = rgba[q + 3] / 255;
    out[o] = DECODE[rgba[q]] * a + 1 - a;
    out[o + 1] = DECODE[rgba[q + 1]] * a + 1 - a;
    out[o + 2] = DECODE[rgba[q + 2]] * a + 1 - a;
  }
  return out;
}

/** palette indices for a linear RGB image; `img` is the caller's and is left as it was */
export function run(img: Float32Array, w: number, h: number, s: Settings): Uint8Array {
  const palette = toOklab(s.colours);
  const t = s.tone;
  // tone and the gradient map work in place, so they get a copy; the dither itself only reads
  const plain = t.black === 0 && t.white === 1 && t.gamma === 1 && t.contrast === 0 && !t.invert && !t.map;
  let x = plain ? img : applyTone(img.slice(), t);
  if (t.map) x = gradientMap(x, palette);
  return dither(x, w, h, palette, { algorithm: s.algorithm, strength: s.strength, serpentine: s.serpentine, seed: s.seed });
}
