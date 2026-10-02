// km.ts's paint at 15 band groups, for the GPU. Every spectrum km.ts builds is a blend of its seven
// basis curves, clamped, so it is flat wherever all seven are: merging those bands (and summing
// their observer weights) loses nothing. The groups are derived here from km.ts, so a change there
// re-derives them, and paint15() throws if a paint stops being flat or its S stops being one number.
// The float64 functions below are the references the tests and the smoke checks hold the GPU to.
import { BANDS, BLUE, CYAN, EPS, FIT, GREEN, MAGENTA, RED, TO_LINEAR, WHITE, YELLOW, type Paint } from './km.ts';

export const BASES = { white: WHITE, red: RED, green: GREEN, blue: BLUE, yellow: YELLOW, cyan: CYAN, magenta: MAGENTA };
export type Basis = keyof typeof BASES;

/** band indices per group, in order */
export const GROUPS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [[0]];
  const curves = Object.values(BASES);
  for (let i = 1; i < BANDS; i++) {
    const flat = curves.every((c) => c[i] === c[i - 1]);
    if (flat) out[out.length - 1].push(i);
    else out.push([i]);
  }
  return out;
})();
export const N15 = GROUPS.length;

/** the observer per group: linear r, g and b weights */
export const W15 = TO_LINEAR.map((row) => Float64Array.from(GROUPS, (g) => g.reduce((t, i) => t + row[i], 0))) as [Float64Array, Float64Array, Float64Array];
/** each basis curve per group */
export const BASIS15 = Object.fromEntries(Object.entries(BASES).map(([k, c]) => [k, Float64Array.from(GROUPS, (g) => c[g[0]])])) as Record<Basis, Float64Array>;

/** paint at 15 groups: K per group and one S (km.ts scales S evenly) */
export type Paint15 = { K: Float64Array; S: number };

export function paint15(p: Paint): Paint15 {
  const S = p.S[0];
  for (let i = 1; i < BANDS; i++) if (p.S[i] !== S) throw new Error('km.ts paint has an S that varies by band; km15 needs one S per paint.');
  const K = Float64Array.from(GROUPS, (g) => {
    const k = p.K[g[0]];
    for (const i of g) if (Math.abs(p.K[i] - k) > 1e-12 * Math.max(1, k)) throw new Error(`km.ts paint isn't flat across bands ${g[0]}-${g.at(-1)}.`);
    return k;
  });
  return { K, S };
}

/** paints mixed by amount, as km.ts mixCurves */
export function mix15(parts: { paint: Paint15; amount: number }[]): Paint15 {
  const K = new Float64Array(N15);
  let S = 0;
  const total = parts.reduce((t, p) => t + Math.max(0, p.amount), 0);
  if (total <= 0) return { K, S: 1 };
  for (const { paint, amount } of parts) {
    const a = Math.max(0, amount) / total;
    for (let i = 0; i < N15; i++) K[i] += a * paint.K[i];
    S += a * paint.S;
  }
  return { K, S };
}

/** R∞ from K/S, in the form that doesn't cancel for dark paints (Phthalo reaches K/S 5000) */
const rInf = (q: number): number => 1 / (1 + q + Math.sqrt(q * q + 2 * q));

/** a reflectance at 15 groups as linear sRGB */
export function linear15(R: ArrayLike<number>): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) for (let i = 0; i < N15; i++) out[c] += W15[c][i] * R[i];
  return out;
}

/** a paint's colour at full cover, linear sRGB */
export const colour15 = (p: Paint15): [number, number, number] => linear15(Array.from(p.K, (k) => rInf(Math.max(0, k) / Math.max(1e-9, p.S))));

function smits([r, g, b]: number[]): Float64Array {
  const B = BASIS15;
  const R = new Float64Array(N15);
  const m = Math.min(r, g, b);
  for (let i = 0; i < N15; i++) {
    let v = m * B.white[i];
    if (r === m) v += (Math.min(g, b) - r) * B.cyan[i] + Math.abs(b - g) * (g <= b ? B.blue[i] : B.green[i]);
    else if (g === m) v += (Math.min(r, b) - g) * B.magenta[i] + Math.abs(b - r) * (r <= b ? B.blue[i] : B.red[i]);
    else v += (Math.min(r, g) - b) * B.yellow[i] + Math.abs(g - r) * (r <= g ? B.green[i] : B.red[i]);
    R[i] = Math.min(1 - EPS, Math.max(EPS, v));
  }
  return R;
}

/** km.ts reflectance() at 15 groups, from linear sRGB */
export function reflectance15(want: readonly number[]): Float64Array {
  let aim = [...want];
  for (let k = 0; ; k++) {
    const R = smits(aim);
    if (k === FIT) return R;
    const got = linear15(R);
    aim = aim.map((v, c) => v + want[c] - got[c]);
  }
}

/** the S of a plain colour read as paint (paint picked up from the painting), km.ts's average traits: tint 1, opacity 0.6 */
export const PLAIN_S = 0.12 + 0.88 * 0.6;

/**
 * A layer of paint (K, S) `x` thick over a backing that reflects Rg: Kubelka's hyperbolic solution
 * written with e^(-2y), which stays finite where sinh overflows.
 */
export function layer15(K: number, S: number, x: number, Rg: number): number {
  const q = Math.max(K / S, 1e-6);
  const a = 1 + q;
  const b = Math.sqrt(q * (q + 2));
  const y = b * S * x;
  const e2 = Math.exp(-2 * y);
  const sh = -Math.expm1(-2 * y);
  const den = a * sh + b * (1 + e2);
  const R = sh / den;
  const T = (2 * b * Math.exp(-y)) / den;
  return R + (T * T * Rg) / (1 - R * Rg);
}
