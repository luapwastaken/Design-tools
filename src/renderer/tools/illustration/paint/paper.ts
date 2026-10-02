// The paper (plan §1): a warm off-white cold-press sheet, made once on the GPU at the painting's
// full size (no tile, so no seams). This is the TypeScript reference of the shader in
// glsl/common.ts, texel for texel within 1/255: integer hashing, so it's the same on any GPU.
//   height: rounded nodules at two scales, a soft swell, short fibres turning slowly
//   mottle: where a wash pools, a slow noise
//   fibre: the fibres alone
import { PAPER } from './tuning.ts';

/** bare paper, linear sRGB */
export const PAPER_RGB = PAPER.rgb;

/** px */
export const SCALES = { nodules: 9, fine: 4.2, swell: 26, turn: 180, fibre: [1.2, 5.5], mottle: 95 } as const;
/** the raw height's median and the contrast that spreads its 5th to 95th percentile over about 0.1 to 0.9 */
export const LEVEL = { centre: 0.645, contrast: 2 } as const;

/** lowbias32 */
export function hash(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** 0..1 for integer point (x, y) and seed s */
export function rnd(x: number, y: number, s: number): number {
  const a = Math.imul(x >>> 0, 0x8da6b343) >>> 0;
  const b = hash((Math.imul(y >>> 0, 0xd8163841) ^ s) >>> 0);
  return (hash((a ^ b) >>> 0) >>> 8) / 16777216;
}

const ease = (t: number) => t * t * (3 - 2 * t);

export function vnoise(x: number, y: number, s: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const tx = ease(x - i);
  const ty = ease(y - j);
  const a = rnd(i, j, s) + (rnd(i + 1, j, s) - rnd(i, j, s)) * tx;
  const b = rnd(i, j + 1, s) + (rnd(i + 1, j + 1, s) - rnd(i, j + 1, s)) * tx;
  return a + (b - a) * ty;
}

/** rounded bumps, one in each cell at a random place */
export function nodules(x: number, y: number, s: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  let d = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const rx = dx + rnd(i + dx, j + dy, s) - (x - i);
      const ry = dy + rnd(i + dx, j + dy, s + 7) - (y - j);
      d = Math.min(d, rx * rx + ry * ry);
    }
  }
  return Math.sqrt(Math.max(0, 1 - d / 0.55));
}

export function fbm(x: number, y: number, s: number): number {
  let a = 0.5;
  let t = 0;
  for (let k = 0; k < 4; k++) {
    t += a * vnoise(x, y, s + k * 101);
    [x, y] = [1.6 * x - 1.2 * y, 1.2 * x + 1.6 * y];
    a *= 0.5;
  }
  return t / 0.9375;
}

/** height, mottle and fibre at pixel (x, y) of the painting */
export function paperAt(x: number, y: number): [number, number, number] {
  const px = x + 0.5;
  const py = y + 0.5;
  const n = 0.66 * nodules(px / SCALES.nodules, py / SCALES.nodules, 1) + 0.34 * nodules(px / SCALES.fine + 17, py / SCALES.fine + 17, 2);
  const swell = fbm(px / SCALES.swell, py / SCALES.swell, 3);
  const ang = fbm(px / SCALES.turn, py / SCALES.turn, 4) * 6.283;
  const qx = Math.cos(ang) * px - Math.sin(ang) * py;
  const qy = Math.sin(ang) * px + Math.cos(ang) * py;
  const fibre = vnoise(qx / SCALES.fibre[0], qy / SCALES.fibre[1], 5);
  const h = Math.min(1, Math.max(0, (0.55 * n + 0.28 * swell + 0.17 * fibre - LEVEL.centre) * LEVEL.contrast + 0.5));
  return [h, fbm(px / SCALES.mottle, py / SCALES.mottle, 6), fibre];
}
