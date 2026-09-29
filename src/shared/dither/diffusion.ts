// Error diffusion by kernel: each pixel takes the nearest palette colour and hands what it missed by,
// a vector in the mixing coordinates (lab.ts), to the pixels ahead of it. Three rows of error are
// kept (the tallest kernel's), padded two pixels each side so the kernel never needs a bounds check;
// what falls off an edge is lost.
import { lightOf, nearest, type OklabPalette } from './palette.ts';

/** [dx, dy, weight]: dx ahead along the row, dy rows down */
export type Kernel = { div: number; cells: [number, number, number][] };

export const KERNELS = {
  'floyd-steinberg': { div: 16, cells: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  // passes on 6/8 of the error: the lost quarter is its high-contrast look
  atkinson: { div: 8, cells: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: {
    div: 48,
    cells: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  stucki: {
    div: 42,
    cells: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  burkes: { div: 32, cells: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra: {
    div: 32,
    cells: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  },
  'sierra-lite': { div: 4, cells: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
} satisfies Record<string, Kernel>;

export type KernelId = keyof typeof KERNELS;

const PAD = 2;

/** `mix` is the image as the dither mixes it, inside the palette's box (palette.toMix); serpentine runs odd rows right to left */
export function diffuse(mix: Float32Array, w: number, h: number, p: OklabPalette, k: Kernel, strength: number, serpentine: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  const stride = (w + 2 * PAD) * 3;
  // three rows of error, taking turns: row y's is (y % 3)
  const err = new Float64Array(stride * 3);
  const n = k.cells.length;
  const f = Float64Array.from(k.cells, (c) => (c[2] * strength) / k.div);
  const to = new Int32Array(n);
  const pm = p.mix;
  const [l0, a0, b0] = p.lo;
  const [l1, a1, b1] = p.hi;
  for (let y = 0; y < h; y++) {
    const back = serpentine && (y & 1) === 1;
    const dir = back ? -1 : 1;
    const row = (y % 3) * stride;
    for (let j = 0; j < n; j++) to[j] = ((y + k.cells[j][1]) % 3) * stride + dir * k.cells[j][0] * 3;
    for (let i = 0, x = back ? w - 1 : 0; i < w; i++, x += dir) {
      const s = (y * w + x) * 3;
      const q = (x + PAD) * 3;
      const M = Math.min(l1, Math.max(l0, mix[s] + err[row + q]));
      const A = Math.min(a1, Math.max(a0, mix[s + 1] + err[row + q + 1]));
      const B = Math.min(b1, Math.max(b0, mix[s + 2] + err[row + q + 2]));
      const c = nearest(p, lightOf(M), A, B);
      out[y * w + x] = c;
      const dL = M - pm[c * 3];
      const dA = A - pm[c * 3 + 1];
      const dB = B - pm[c * 3 + 2];
      for (let j = 0; j < n; j++) {
        const t = to[j] + q;
        err[t] += dL * f[j];
        err[t + 1] += dA * f[j];
        err[t + 2] += dB * f[j];
      }
    }
    err.fill(0, row, row + stride);
  }
  return out;
}
