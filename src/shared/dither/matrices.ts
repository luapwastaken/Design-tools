// Threshold matrices for the ordered screens, row by row, each value (rank + 0.5) / cells, and the
// class matrix of Knuth's dot diffusion. Every screen is anchored at the image's top left.
export { blueNoise } from '../halftone/stochastic.ts';

/** Bayer's recursive ranks, n a power of two: each quadrant interleaves the one below it */
export function bayerRanks(n: number): Uint16Array {
  if (n <= 1) return Uint16Array.of(0);
  const half = bayerRanks(n / 2);
  const h = n / 2;
  const out = new Uint16Array(n * n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const v = half[y * h + x] * 4;
      out[y * n + x] = v;
      out[y * n + x + h] = v + 2;
      out[(y + h) * n + x] = v + 3;
      out[(y + h) * n + x + h] = v + 1;
    }
  }
  return out;
}

const thresholds = (ranks: ArrayLike<number>) => Float32Array.from(ranks, (r) => (r + 0.5) / ranks.length);

/** cells in order of `spot` (lowest first, so they darken first), ties in Bayer order */
function rankBy(spot: (x: number, y: number) => number): Float32Array {
  const tie = bayerRanks(8);
  const cells = Array.from({ length: 64 }, (_, i) => ({ i, v: spot((i % 8) + 0.5, Math.floor(i / 8) + 0.5) }));
  cells.sort((a, b) => a.v - b.v || tie[a.i] - tie[b.i]);
  const rank = new Uint16Array(64);
  cells.forEach((c, r) => (rank[c.i] = r));
  return thresholds(rank);
}

export const bayer = (n: number): Float32Array => thresholds(bayerRanks(n));

/**
 * Round dots on a 45° lattice, two to the 8 × 8 tile (4√2 px apart): the cosine spot, whose dark
 * dots join in a checkerboard at 50% and leave light dots shrinking the same way past it. Shifted so
 * every dot's 2 × 2 core sits inside the tile.
 */
export const clusteredDot = (): Float32Array =>
  rankBy((x, y) => Math.cos((Math.PI * (x + y - 4)) / 4) + Math.cos((Math.PI * (x - y)) / 4));

/** Lines rising at 45° as seen, 4√2 px apart, thickening from their centre line both ways. */
export const lineScreen = (): Float32Array => rankBy((x, y) => Math.abs((((x + y) % 8) + 8) % 8 - 4));

/**
 * Knuth's class matrix ("Digital halftones by dot diffusion", ACM TOG 6(4), 1987), as his own
 * dot-diff.w builds it with store_eight: the order of a 45° dot font, row by row.
 */
export const KNUTH = Uint8Array.of(
  35, 48, 40, 32, 28, 15, 23, 31,
  43, 59, 56, 52, 20, 4, 7, 11,
  51, 62, 60, 44, 12, 1, 3, 19,
  38, 46, 54, 36, 25, 17, 9, 27,
  29, 14, 22, 30, 34, 49, 41, 33,
  21, 5, 6, 10, 42, 58, 57, 53,
  13, 0, 2, 18, 50, 63, 61, 45,
  24, 16, 8, 26, 39, 47, 55, 37,
);
