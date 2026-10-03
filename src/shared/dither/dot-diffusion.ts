// Knuth's dot diffusion ("Digital halftones by dot diffusion", ACM TOG 6(4), 1987; his dot-diff.w):
// the class matrix tiles the image, and pixels are decided class by class, 0 to 63. Each hands its
// error to those of its 8 neighbours in a later class, orthogonal ones weighted 2 and diagonal ones 1,
// shared out over those neighbours. The error of a pixel with no later neighbour (a baron) goes
// nowhere, and error off the image's edge is lost, as in his program. His laser-printer model and
// sharpening are for paper, so they're left out.
import { KNUTH } from './matrices.ts';
import { lightOf, nearest, type OklabPalette } from './palette.ts';

type Step = { x: number; y: number; to: { dx: number; dy: number; f: number }[] };

/** for each class in turn: where it sits in the tile and whom it hands error to */
const STEPS: Step[] = Array.from({ length: 64 }, (_, k) => {
  const at = KNUTH.indexOf(k);
  const [x, y] = [at % 8, Math.floor(at / 8)];
  const to: Step['to'] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (KNUTH[((y + dy + 8) % 8) * 8 + ((x + dx + 8) % 8)] > k) to.push({ dx, dy, f: dx && dy ? 1 : 2 });
    }
  }
  const sum = to.reduce((s, t) => s + t.f, 0);
  to.forEach((t) => (t.f /= sum));
  return { x, y, to };
});

export function dotDiffusion(mix: Float32Array, w: number, h: number, p: OklabPalette, strength: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const v = mix.slice();
  const pm = p.mix;
  const [l0, a0, b0] = p.lo;
  const [l1, a1, b1] = p.hi;
  for (const { x: cx, y: cy, to } of STEPS) {
    for (let y = cy; y < h; y += 8) {
      for (let x = cx; x < w; x += 8) {
        const s = (y * w + x) * 3;
        const L = v[s] < l0 ? l0 : v[s] > l1 ? l1 : v[s];
        const A = v[s + 1] < a0 ? a0 : v[s + 1] > a1 ? a1 : v[s + 1];
        const B = v[s + 2] < b0 ? b0 : v[s + 2] > b1 ? b1 : v[s + 2];
        const c = nearest(p, lightOf(L), A, B);
        out[y * w + x] = c;
        const dL = (L - pm[c * 3]) * strength;
        const dA = (A - pm[c * 3 + 1]) * strength;
        const dB = (B - pm[c * 3 + 2]) * strength;
        for (const t of to) {
          const [nx, ny] = [x + t.dx, y + t.dy];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = (ny * w + nx) * 3;
          v[q] += dL * t.f;
          v[q + 1] += dA * t.f;
          v[q + 2] += dB * t.f;
        }
      }
    }
  }
  return out;
}
