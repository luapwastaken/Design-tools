// Riemersma dithering (T. Riemersma, "A Balanced Dithering Technique", C/C++ Users Journal, Dec 1998):
// the pixels are visited along a Hilbert curve, and each one is nudged by the errors of the last 16
// visited, weighted exponentially from 1 (the newest) down to 1/16. As in his reference code, the
// error kept is the wanted colour less the one chosen, not counting the nudge, and the curve covers
// the smallest power-of-two square round the image, skipping the points outside it.
import { lightOf, nearest, type OklabPalette } from './palette.ts';

const QUEUE = 16;
const RATIO = 16;
/** weight by age, oldest first */
const WEIGHTS = Float64Array.from({ length: QUEUE }, (_, i) => RATIO ** (i / (QUEUE - 1)) / RATIO);

let curve: { w: number; h: number; order: Uint32Array } | null = null;

/** the image's pixel indices in Hilbert order, starting top left; kept for the next frame of the same size */
export function hilbertOrder(w: number, h: number): Uint32Array {
  if (curve?.w === w && curve.h === h) return curve.order;
  let n = 1;
  while (n < Math.max(w, h)) n *= 2;
  const order = new Uint32Array(w * h);
  let k = 0;
  for (let d = 0; d < n * n; d++) {
    // the curve's d-th point (the classic d2xy)
    let [x, y, t] = [0, 0, d];
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      if (ry === 0) {
        if (rx === 1) [x, y] = [s - 1 - x, s - 1 - y];
        [x, y] = [y, x];
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    if (x < w && y < h) order[k++] = y * w + x;
  }
  curve = { w, h, order };
  return order;
}

export function riemersma(mix: Float32Array, w: number, h: number, p: OklabPalette, strength: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const order = hilbertOrder(w, h);
  const eL = new Float64Array(QUEUE);
  const eA = new Float64Array(QUEUE);
  const eB = new Float64Array(QUEUE);
  const pm = p.mix;
  const [l0, a0, b0] = p.lo;
  const [l1, a1, b1] = p.hi;
  let oldest = 0;
  for (let k = 0; k < order.length; k++) {
    const px = order[k];
    const s = px * 3;
    let [nL, nA, nB] = [0, 0, 0];
    for (let age = 0, j = oldest; age < QUEUE; age++, j = j + 1 === QUEUE ? 0 : j + 1) {
      nL += eL[j] * WEIGHTS[age];
      nA += eA[j] * WEIGHTS[age];
      nB += eB[j] * WEIGHTS[age];
    }
    let L = mix[s] + nL * strength;
    let A = mix[s + 1] + nA * strength;
    let B = mix[s + 2] + nB * strength;
    L = L < l0 ? l0 : L > l1 ? l1 : L;
    A = A < a0 ? a0 : A > a1 ? a1 : A;
    B = B < b0 ? b0 : B > b1 ? b1 : B;
    const c = nearest(p, lightOf(L), A, B);
    out[px] = c;
    // the newest error takes the oldest one's place
    eL[oldest] = mix[s] - pm[c * 3];
    eA[oldest] = mix[s + 1] - pm[c * 3 + 1];
    eB[oldest] = mix[s + 2] - pm[c * 3 + 2];
    oldest = oldest + 1 === QUEUE ? 0 : oldest + 1;
  }
  return out;
}
