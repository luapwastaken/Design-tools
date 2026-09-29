// Kubelka-Munk paint mixing: the one implementation (v1 had three). Paint doesn't mix like light:
// each pigment absorbs (K) and scatters (S) differently at every wavelength, and only mixing
// those spectra makes yellow + blue a green instead of a grey.
//   colour -> reflectance over 380-730nm -> K and S per band (scaled by tint and opacity)
//   mix: K and S add by concentration -> reflectance -> linear sRGB -> OKLCH
// No data tables: the observer is an analytic fit and reflectances are built from smooth curves.
import { linearRgb, toOklch, type Oklch } from '../color/index.ts';

/** 380-730nm every 10nm */
export const BANDS = 36;

/** Anything that can go in a mix: a pigment, or a plain colour with average traits. */
export type Paintable = { oklch: Oklch; tint?: number; opacity?: number };
/** One unit of paint: absorption and scattering per band, tinting strength already applied. */
export type Paint = { K: Float64Array; S: Float64Array };

const lambda = (i: number) => 380 + 10 * i;

/** a Gaussian that is wider on one side of its peak */
function lobe(x: number, mu: number, below: number, above: number): number {
  const t = (x - mu) / (x < mu ? below : above);
  return Math.exp(-0.5 * t * t);
}

// CIE 1931 2-degree observer, Wyman, Sloan and Shirley's multi-lobe fit (2013), folded into
// XYZ -> linear sRGB. Each row is scaled so a flat reflectance of 1 is exactly white: the fit's
// small errors then wash out instead of tinting every mix.
const TO_LINEAR = (() => {
  const xyzToRgb = [
    [3.2406, -1.5372, -0.4986],
    [-0.9689, 1.8758, 0.0415],
    [0.0557, -0.204, 1.057],
  ];
  const cmf = Array.from({ length: BANDS }, (_, i) => {
    const l = lambda(i);
    return [
      1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
      0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
      1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
    ];
  });
  return xyzToRgb.map((row) => {
    const w = Float64Array.from(cmf, (xyz) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]);
    const white = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / white);
  });
})();

function linearOf(R: Float64Array): [number, number, number] {
  const [wr, wg, wb] = TO_LINEAR;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < BANDS; i++) {
    r += wr[i] * R[i];
    g += wg[i] * R[i];
    b += wb[i] * R[i];
  }
  return [r, g, b];
}

// ── colour -> reflectance ────────────────────────────────────────────────────────────────────────
// Smits' decomposition: white + one secondary (C/M/Y) + one primary (R/G/B). The secondaries have
// a trough in the band they absorb (yellow dips in blue, cyan in red), and that trough is what
// keeps subtractive mixes clean.

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const LO = 0.015;
const HI = 0.985;
const curve = (fn: (l: number) => number) => Float64Array.from({ length: BANDS }, (_, i) => LO + (HI - LO) * fn(lambda(i)));
const WHITE = curve(() => 1);
const RED = curve((l) => smoothstep(560, 610, l));
const GREEN = curve((l) => smoothstep(475, 515, l) * (1 - smoothstep(580, 620, l)));
const BLUE = curve((l) => 1 - smoothstep(455, 500, l));
const YELLOW = curve((l) => smoothstep(460, 505, l));
const CYAN = curve((l) => 1 - smoothstep(565, 610, l));
const MAGENTA = curve((l) => Math.max(1 - smoothstep(470, 515, l), smoothstep(585, 625, l)));

/** keeps K/S finite at both ends */
const EPS = 1e-4;

function smits([r, g, b]: number[], out: Float64Array): Float64Array {
  out.fill(0);
  const add = (basis: Float64Array, w: number) => {
    for (let i = 0; i < BANDS; i++) out[i] += w * basis[i];
  };
  const min = Math.min(r, g, b);
  add(WHITE, min);
  // the secondary covers the two channels above the minimum, the primary the one on top
  if (r === min) {
    add(CYAN, Math.min(g, b) - r);
    add(g <= b ? BLUE : GREEN, Math.abs(b - g));
  } else if (g === min) {
    add(MAGENTA, Math.min(r, b) - g);
    add(r <= b ? BLUE : RED, Math.abs(b - r));
  } else {
    add(YELLOW, Math.min(r, g) - b);
    add(r <= g ? GREEN : RED, Math.abs(g - r));
  }
  for (let i = 0; i < BANDS; i++) out[i] = Math.min(1 - EPS, Math.max(EPS, out[i]));
  return out;
}

/** correction rounds: the bases don't integrate to exactly their RGB, so aim off by the miss */
const FIT = 4;

/** The reflectance curve of a colour as the screen shows it (sRGB), so a paint alone mixes back to its own colour. */
export function reflectance(o: Oklch): Float64Array {
  const want: number[] = linearRgb(o);
  const R = new Float64Array(BANDS);
  let aim = want;
  for (let k = 0; ; k++) {
    smits(aim, R);
    if (k === FIT) return R;
    const got = linearOf(R);
    aim = aim.map((v, c) => v + want[c] - got[c]);
  }
}

// ── Kubelka-Munk ─────────────────────────────────────────────────────────────────────────────────

const ks = (R: number) => ((1 - R) * (1 - R)) / (2 * R);
const reflectanceOfKs = (q: number) => 1 + q - Math.sqrt(q * q + 2 * q);

/**
 * Opacity sets how strongly a paint scatters (opaque paints cover, transparent ones glaze), tint
 * how hard it pushes a mix; both scale K and S together, so a paint alone keeps its colour.
 */
export function paintOf({ oklch, tint = 1, opacity = 0.6 }: Paintable): Paint {
  const R = reflectance(oklch);
  const s = tint * (0.12 + 0.88 * opacity);
  return { K: R.map((r) => ks(r) * s), S: new Float64Array(BANDS).fill(s) };
}

/** Paints mixed by amount (any scale): one unit of the mix, which can itself go into another mix. */
export function mixCurves(parts: { paint: Paint; amount: number }[]): Paint {
  const K = new Float64Array(BANDS);
  const S = new Float64Array(BANDS);
  const total = parts.reduce((t, p) => t + Math.max(0, p.amount), 0);
  if (total <= 0) return { K, S: S.fill(1) }; // nothing: bare white paper
  for (const { paint, amount } of parts) {
    const a = Math.max(0, amount) / total;
    for (let i = 0; i < BANDS; i++) {
      K[i] += a * paint.K[i];
      S[i] += a * paint.S[i];
    }
  }
  return { K, S };
}

const R_MIX = new Float64Array(BANDS);

/** The colour of a paint, full cover. */
export function colourOf({ K, S }: Paint): Oklch {
  for (let i = 0; i < BANDS; i++) R_MIX[i] = reflectanceOfKs(Math.max(0, K[i]) / Math.max(1e-9, S[i]));
  const [r, g, b] = linearOf(R_MIX);
  return toOklch({ mode: 'lrgb', r, g, b });
}

/** "2 parts of this and 1 of that": the colour they make. */
export function mix(parts: { pigment: Paintable; parts: number }[]): Oklch {
  return colourOf(mixCurves(parts.map((p) => ({ paint: paintOf(p.pigment), amount: p.parts }))));
}
