// Mixing plans (T. Knoll, US patent 6,606,166; as J. Yliluoma describes and codes it in
// "Arbitrary-palette positional dithering algorithm"). For a colour C, 64 candidates: each is the
// palette colour nearest C + E·X, where E is the sum of what the candidates so far missed C by, so
// together they average to C with colours near it. Sorted dark to light, a pixel's rank 0..63 picks
// one: the ordered screens rank by their own thresholds. A plan depends on the colour alone, so
// plans are kept for later pixels and frames, one per small cell of colours.
import { blueNoise } from './matrices.ts';
import { lightOf, nearest, type OklabPalette } from './palette.ts';

export const N = 64;
/**
 * A cell is 1/128 in mixing lightness and 1/64 in a and b. Which cell a pixel takes is dithered by a
 * fixed blue noise, so over a few pixels the cells average to the pixel's own colour: a gradient
 * between two close colours still steps 1/64 at a time, not a cell at a time.
 */
const [QL, QAB] = [128, 64];
/** a pixel this close to a palette colour, on every axis, is that colour, whatever its cell mixes */
const EXACT = 1e-4;
/** 16 MB of plans at most, for each of the two kept */
const MAX_PLANS = 1 << 18;

type Kept = { plans: Map<number, number>; pool: Uint8Array; used: number };
/** by multiplier and palette; two, so two screens' plans don't rebuild each other's */
const kept = new Map<string, Kept>();

function keptFor(key: string): Kept {
  let k = kept.get(key);
  if (k) {
    kept.delete(key);
  } else {
    k = { plans: new Map(), pool: new Uint8Array(N * 1024), used: 0 };
    if (kept.size >= 2) kept.delete(kept.keys().next().value!);
  }
  kept.set(key, k);
  return k;
}

/** each pixel's candidate at `rank(x, y)` (0..63) of its colour's plan with error multiplier `mult`; `mix` as palette.toMix gives it */
export function planned(mix: Float32Array, w: number, h: number, p: OklabPalette, mult: number, rank: (x: number, y: number) => number): Uint8Array {
  const k = keptFor(`${mult}|${p.key}`);
  const counts = new Uint16Array(p.n);
  const pm = p.mix;
  const [l0, a0, b0] = p.lo;
  const [l1, a1, b1] = p.hi;
  const noise = blueNoise();

  /** the plan's place in the pool times 256, plus 1 + the palette colour that may sit in the cell (0: none) */
  const plan = (cL: number, cA: number, cB: number): number => {
    counts.fill(0);
    let [eL, eA, eB] = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const tL = Math.min(l1, Math.max(l0, cL + eL * mult));
      const tA = Math.min(a1, Math.max(a0, cA + eA * mult));
      const tB = Math.min(b1, Math.max(b0, cB + eB * mult));
      const c = nearest(p, lightOf(tL), tA, tB);
      counts[c]++;
      eL += cL - pm[c * 3];
      eA += cA - pm[c * 3 + 1];
      eB += cB - pm[c * 3 + 2];
    }
    // X under 1 leaves what's missed on one side of 0, up to a candidate's worth, and next to a
    // palette colour every candidate is that colour: trade candidates between the colours the plan
    // holds, and the one nearest what it missed, while that brings its mean nearer C
    const held: number[] = [];
    for (let c = 0; c < p.n; c++) if (counts[c]) held.push(c);
    const fill = nearest(p, lightOf(Math.min(l1, Math.max(l0, cL + eL))), Math.min(a1, Math.max(a0, cA + eA)), Math.min(b1, Math.max(b0, cB + eB)));
    if (!counts[fill]) held.push(fill);
    for (;;) {
      let [best, from, to] = [eL * eL + eA * eA + eB * eB - 1e-12, -1, -1];
      for (const u of held) {
        if (!counts[u]) continue;
        for (const v of held) {
          const dL = eL + pm[u * 3] - pm[v * 3];
          const dA = eA + pm[u * 3 + 1] - pm[v * 3 + 1];
          const dB = eB + pm[u * 3 + 2] - pm[v * 3 + 2];
          const d = dL * dL + dA * dA + dB * dB;
          if (d < best) [best, from, to] = [d, u, v];
        }
      }
      if (from < 0) break;
      counts[from]--;
      counts[to]++;
      eL += pm[from * 3] - pm[to * 3];
      eA += pm[from * 3 + 1] - pm[to * 3 + 1];
      eB += pm[from * 3 + 2] - pm[to * 3 + 2];
    }
    if (k.used + N > k.pool.length) {
      const grown = new Uint8Array(k.pool.length * 2);
      grown.set(k.pool);
      k.pool = grown;
    }
    const at = k.used;
    for (let r = 0, o = at; r < p.n; r++) {
      const c = p.byL[r];
      for (let j = 0; j < counts[c]; j++) k.pool[o++] = c;
    }
    k.used += N;
    // a pixel maps to a cell whose centre is within a step of it on each axis
    const c0 = nearest(p, lightOf(cL), cA, cB);
    const near = Math.abs(pm[c0 * 3] - cL) < 1 / QL && Math.abs(pm[c0 * 3 + 1] - cA) < 1 / QAB && Math.abs(pm[c0 * 3 + 2] - cB) < 1 / QAB;
    return at * 256 + (near ? c0 + 1 : 0);
  };

  const out = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    // shifted off the blue-noise screen's own, so a pixel's cell and its rank don't follow each other
    const row = ((y + 23) & 63) * 64;
    for (let x = 0; x < w; x++, i++) {
      const o = noise[row + ((x + 41) & 63)];
      const M = mix[i * 3];
      const A = mix[i * 3 + 1];
      const B = mix[i * 3 + 2];
      const qL = Math.floor(M * QL + o);
      const qA = Math.floor(A * QAB + o);
      const qB = Math.floor(B * QAB + o);
      const id = (qL * 1024 + qA + 512) * 1024 + qB + 512;
      let code = k.plans.get(id);
      if (code === undefined) {
        // the pixels so far have read theirs already, so dropping every plan costs only time
        if (k.plans.size >= MAX_PLANS) [k.plans, k.used] = [new Map(), 0];
        k.plans.set(id, (code = plan(qL / QL, qA / QAB, qB / QAB)));
      }
      const c = (code & 255) - 1;
      out[i] = c >= 0 && Math.abs(pm[c * 3] - M) < EXACT && Math.abs(pm[c * 3 + 1] - A) < EXACT && Math.abs(pm[c * 3 + 2] - B) < EXACT ? c : k.pool[(code >>> 8) + rank(x, y)];
    }
  }
  return out;
}

/** every pixel its nearest colour; `lab` in OKLab (lab.labImage) */
export function nearestAll(lab: Float32Array, w: number, h: number, p: OklabPalette): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = nearest(p, lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]);
  return out;
}
