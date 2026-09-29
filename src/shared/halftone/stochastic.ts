// FM (stochastic) screening: every print pixel is its own dot, set where the plate beats a blue-noise
// threshold (void and cluster, Ulichney 1993) tiled over the page. There are no cells, so no SVG:
// an A4 plate at 300 DPI holds millions of dots.
import { printed } from './screen.ts';

const M = 64;
const SIGMA = 1.5;
const REACH = 6;

let matrix: Float32Array | null = null;

/** Thresholds 0..1, M × M, each rank once: a pixel below c prints at coverage c. */
export function blueNoise(): Float32Array {
  return (matrix ??= voidAndCluster());
}

function voidAndCluster(): Float32Array {
  const N = M * M;
  const side = 2 * REACH + 1;
  const kernel = Float64Array.from({ length: side * side }, (_, i) => {
    const [dx, dy] = [(i % side) - REACH, Math.floor(i / side) - REACH];
    return Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  });
  const energy = new Float64Array(N);
  const on = new Uint8Array(N);
  const flip = (p: number, bit: 0 | 1) => {
    on[p] = bit;
    const [px, py, s] = [p % M, Math.floor(p / M), bit ? 1 : -1];
    for (let dy = -REACH, k = 0; dy <= REACH; dy++) {
      const row = ((py + dy + M) % M) * M;
      for (let dx = -REACH; dx <= REACH; dx++, k++) energy[row + ((px + dx + M) % M)] += s * kernel[k];
    }
  };
  // the tightest cluster is the set pixel with the most energy; the largest void the unset one with the least
  const extreme = (bit: 0 | 1) => {
    let [best, at] = [bit ? -Infinity : Infinity, -1];
    for (let p = 0; p < N; p++) if (on[p] === bit && (bit ? energy[p] > best : energy[p] < best)) [best, at] = [energy[p], p];
    return at;
  };

  let seed = 0x9e3779b9;
  const random = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
  const start = Math.round(N / 10);
  for (let set = 0; set < start; ) {
    const p = Math.floor(random() * N);
    if (!on[p]) (flip(p, 1), set++);
  }
  // spread the starting pattern: move the tightest cluster into the largest void until it stays put
  for (let guard = 0; guard < N; guard++) {
    const cluster = extreme(1);
    flip(cluster, 0);
    const hole = extreme(0);
    flip(hole, 1);
    if (hole === cluster) break;
  }

  const rank = new Int32Array(N);
  const [startOn, startEnergy] = [on.slice(), energy.slice()];
  for (let r = start - 1; r >= 0; r--) {
    const cluster = extreme(1);
    rank[cluster] = r;
    flip(cluster, 0);
  }
  on.set(startOn);
  energy.set(startEnergy);
  // past half, the tightest cluster of the unset pixels is the largest void of the set ones (the kernel sums alike everywhere)
  for (let r = start; r < N; r++) {
    const hole = extreme(0);
    rank[hole] = r;
    flip(hole, 1);
  }
  return Float32Array.from(rank, (r) => (r + 0.5) / N);
}

export type StochasticOptions = { outW?: number; outH?: number; gain?: number };

/**
 * One plate (w × h, 0..1) screened at the output size (outW × outH print pixels, by default the
 * plate's), as a separation: 0 where ink prints, 255 where the paper shows. `seed` shifts the
 * tile, so each ink gets its own arrangement. Gain compensation moves the thresholds instead of
 * every pixel.
 */
export function stochastic(plate: Float32Array, w: number, h: number, seed: number, opts: StochasticOptions = {}): Uint8Array {
  const [W, H, gain] = [opts.outW ?? w, opts.outH ?? h, opts.gain ?? 0];
  // compensate(c) > t exactly when c > printed(t)
  const thresholds = blueNoise().map((t) => printed(t, gain));
  const hash = Math.imul(seed + 1, 0x9e3779b1) >>> 0;
  const [ox, oy] = [hash % M, (hash >>> 16) % M];
  const out = new Uint8Array(W * H);
  const [sx, sy] = [w / W, h / H];
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.min(fy | 0, Math.max(0, h - 2));
    const [dy, r0, r1] = [fy - y0, y0 * w, Math.min(h - 1, y0 + 1) * w];
    const row = ((y + oy) % M) * M;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.min(fx | 0, Math.max(0, w - 2));
      const [dx, x1] = [fx - x0, Math.min(w - 1, x0 + 1)];
      const top = plate[r0 + x0] + (plate[r0 + x1] - plate[r0 + x0]) * dx;
      const bottom = plate[r1 + x0] + (plate[r1 + x1] - plate[r1 + x0]) * dx;
      out[y * W + x] = top + (bottom - top) * dy > thresholds[row + ((x + ox) % M)] ? 0 : 255;
    }
  }
  return out;
}
