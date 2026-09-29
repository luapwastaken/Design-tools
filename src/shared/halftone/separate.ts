// Plates: how much of each ink every pixel needs, 0..1. One print model for every mode, the one the
// preview and the SVG draw: the paper, and on it each ink's dots, seen area-averaged. Overprinting,
// the inks are transparent and the sheet reflects paper × Π (1 − aᵢ(1 − inkᵢ)); knocked out, each
// ink shows its own colour where no later ink prints (as Illustrator draws stacked fills), so it is
// fitted to the image as it is, not over the paper: a light ink can print lighter than dark stock.
// It works on sRGB-encoded values, where a 50% grey takes 50% black, as shared/color's ≈CMYK estimate
// (which is the overprint model with ideal process inks) already does.
//
// A pixel goes through small tables: tone per channel (tone.ts), a GRID³ colour table holding every
// ink's coverage, then each ink's curve. The Halftone tool runs this in a worker for the view and
// every export alike (tools/halftone/screen.worker.ts), so no second separation exists.
import { cmykEstimate, rgb255, toOklch, type Oklch } from '../color/index.ts';
import { channelTables, curveTable, lookup, TABLE } from './tone.ts';
import type { Mode, Overlap, Process, SeparateInk, Tone } from './types.ts';

export const GRID = 33;
/** the most spot inks the engine separates: the preview holds them in two RGBA tables */
export const MAX_SPOT = 6;

const NODES = GRID ** 3;
const PROCESS: Process[] = ['c', 'm', 'y', 'k'];

/**
 * Everything a pixel's inks come from, laid out so a GPU pass could read it (none does yet): `tone`
 * is a TABLE × 3 texture (a row per channel) and `curves` a TABLE × n one, both read linear-filtered
 * at texel centres,
 * (v × (TABLE − 1) + 0.5) / TABLE. `lut` is a GRID³ 3D texture (red along x, n values per texel:
 * split into RGBA layers) read with texelFetch at the 4 corners inksAt picks, weighted as it does.
 */
export type Separation = {
  n: number;
  /** linear light to toned value, per channel (tone.channelTables): over the paper, or as it is under knockout */
  tone: Float32Array;
  /** what a transparent pixel reads as in those values: the paper */
  blank: [number, number, number];
  /** GRID³ nodes, red fastest, then green, then blue; each node's n coverages together */
  lut: Float32Array;
  /** each ink's curve table, end to end */
  curves: Float32Array;
};

export type SeparateOptions = { paper?: Oklch; overlap?: Overlap };

/** Ink values 0..255 over the sheet, the screen colour the preview multiplies. */
const encodedOf = (o: Oklch) => rgb255(o).map((v) => v / 255);

/**
 * Ink order is printing order: the first ink goes down first, so under knockout the last one shows
 * on top. Visibility never enters: a hidden ink keeps its plate and the others keep theirs.
 */
export function separation(inks: SeparateInk[], mode: Mode, tone: Tone, opts: SeparateOptions = {}): Separation {
  const curves = new Float32Array(TABLE * inks.length);
  inks.forEach((ink, i) => curves.set(curveTable(ink.curve), i * TABLE));
  const paper = opts.paper ? encodedOf(opts.paper) : [1, 1, 1];
  const knockout = mode === 'spot' && opts.overlap === 'knockout';
  const white = [1, 1, 1];
  return {
    n: inks.length,
    tone: channelTables(tone, knockout ? white : paper),
    blank: (knockout ? paper : white) as [number, number, number],
    lut: mode === 'process' ? processLut(inks) : spotLut(inks.map((ink) => encodedOf(ink.colour)), knockout, paper),
    curves,
  };
}

/** Every ink's plate for an image in linear light with straight alpha; transparent pixels take no ink. */
export function toPlates(
  rgbaLinear: Float32Array,
  w: number,
  h: number,
  inks: SeparateInk[],
  mode: Mode,
  tone: Tone,
  opts: SeparateOptions = {},
): Float32Array[] {
  const sep = separation(inks, mode, tone, opts);
  const plates = inks.map(() => new Float32Array(w * h));
  const out = new Float32Array(sep.n);
  for (let p = 0, q = 0; p < w * h; p++, q += 4) {
    inksAt(sep, rgbaLinear[q], rgbaLinear[q + 1], rgbaLinear[q + 2], rgbaLinear[q + 3], out);
    for (let i = 0; i < sep.n; i++) plates[i][p] = out[i];
  }
  return plates;
}

/** One pixel's inks (linear light, straight alpha) into `out`: the cursor readout uses it too. */
export function inksAt(sep: Separation, r: number, g: number, b: number, alpha: number, out: Float32Array | number[]): void {
  const { n, tone, lut, curves, blank } = sep;
  const a = alpha > 0 ? (alpha < 1 ? alpha : 1) : 0;
  // transparent is paper
  const fr = (a * lookup(tone, r, 0) + (1 - a) * blank[0]) * (GRID - 1);
  const fg = (a * lookup(tone, g, TABLE) + (1 - a) * blank[1]) * (GRID - 1);
  const fb = (a * lookup(tone, b, 2 * TABLE) + (1 - a) * blank[2]) * (GRID - 1);
  const ir = fr < GRID - 1 ? fr | 0 : GRID - 2;
  const ig = fg < GRID - 1 ? fg | 0 : GRID - 2;
  const ib = fb < GRID - 1 ? fb | 0 : GRID - 2;
  // tetrahedral: the cube splits along its grey diagonal, so a neutral reads only neutral nodes and
  // takes no colour (trilinear would leak c, m and y into greys across the black-generation kink).
  // The largest step first: d1 ≥ d2 ≥ d3 along strides s1, s2, s3.
  let d1 = fr - ir;
  let d2 = fg - ig;
  let d3 = fb - ib;
  let s1 = n;
  let s2 = GRID * n;
  let s3 = GRID * GRID * n;
  if (d1 < d2) {
    [d1, d2] = [d2, d1];
    [s1, s2] = [s2, s1];
  }
  if (d2 < d3) {
    [d2, d3] = [d3, d2];
    [s2, s3] = [s3, s2];
  }
  if (d1 < d2) {
    [d1, d2] = [d2, d1];
    [s1, s2] = [s2, s1];
  }
  const base = ((ib * GRID + ig) * GRID + ir) * n;
  const o1 = base + s1;
  const o2 = o1 + s2;
  const o3 = o2 + s3;
  for (let i = 0; i < n; i++) {
    const c0 = lut[base + i];
    const c1 = lut[o1 + i];
    const c2 = lut[o2 + i];
    out[i] = lookup(curves, c0 + d1 * (c1 - c0) + d2 * (c2 - c1) + d3 * (lut[o3 + i] - c2), i * TABLE);
  }
}

function forEachNode(fn: (node: number, r: number, g: number, b: number) => void): void {
  for (let bi = 0, node = 0; bi < GRID; bi++) {
    for (let gi = 0; gi < GRID; gi++) {
      for (let ri = 0; ri < GRID; ri++, node++) fn(node, ri / (GRID - 1), gi / (GRID - 1), bi / (GRID - 1));
    }
  }
}

let cmyk: Float32Array | null = null;

function processLut(inks: SeparateInk[]): Float32Array {
  const channel = inks.map((ink) => {
    const c = ink.process ? PROCESS.indexOf(ink.process) : -1;
    if (c < 0) throw new TypeError('A process ink needs its channel (c, m, y or k).');
    return c;
  });
  const all = (cmyk ??= cmykTable());
  const n = inks.length;
  const lut = new Float32Array(NODES * n);
  for (let node = 0; node < NODES; node++) for (let i = 0; i < n; i++) lut[node * n + i] = all[node * 4 + channel[i]];
  return lut;
}

/** The ≈CMYK estimate at every node, with its grey handed back from black in the highlights. */
function cmykTable(): Float32Array {
  const out = new Float32Array(NODES * 4);
  forEachNode((node, r, g, b) => {
    const [c, m, y, k] = cmykEstimate(toOklch({ mode: 'rgb', r, g, b })).map((v) => v / 100);
    const black = blackOf(k);
    // the estimate puts all of the grey into black; what black leaves goes back into c, m and y
    const back = (ink: number) => (black < 1 ? (ink * (1 - k) + k - black) / (1 - black) : 0);
    out.set([back(c), back(m), back(y), black], node * 4);
  });
  return out;
}

/**
 * Black generation: all of the grey from the midtones down (a 50% grey is 50% black), fading to
 * none in the highlights, where lone black dots would show.
 */
function blackOf(k: number): number {
  if (k >= 0.5) return k;
  const x = 2 * k;
  return k * x * x * (3 - 2 * x);
}

// Spot fit weights: the error is the lightness miss (Rec. 709 luma, the weights of shared/color's
// WCAG luminance) plus CHROMA times the colour miss, so one ink follows the image's lightness.
const LUMA = [0.2126, 0.7152, 0.0722];
const CHROMA = 0.5;
/** among fits that match about equally, the one with less ink (costs at most ~0.2% coverage) */
const LESS_INK = 1e-3;
/** no ink channel is quite 0, so the running product can divide an ink back out */
const DARKEST = 1 / 512;
const SWEEPS = 100;
/** a sweep that improves the fit less than this is the end: past it, only the tie-break creeps */
const SETTLED = 1e-8;

let spotKey = '';
let spotCache = new Float32Array(0);

function spotLut(inks: number[][], knockout: boolean, paper: number[]): Float32Array {
  const n = inks.length;
  if (n > MAX_SPOT) throw new RangeError(`The engine separates at most ${MAX_SPOT} spot inks.`);
  const key = JSON.stringify([inks, knockout, knockout ? paper : null]);
  if (key === spotKey) return spotCache;
  const lut = new Float32Array(NODES * n);
  // overprinted, the fit is over the paper (the inks only multiply it); knocked out, an ink hides
  // the paper, so the fit is to the colour as it is with the paper showing where no ink prints
  const solve = knockout ? shareSolver(inks, paper) : solver(inks);
  const a = new Float64Array(n);
  forEachNode((node, r, g, b) => {
    // start from the neighbour just solved, so the table stays smooth where several mixes fit
    const from = node % GRID ? node - 1 : Math.floor(node / GRID) % GRID ? node - GRID : node - GRID * GRID;
    for (let i = 0; i < n && from >= 0; i++) a[i] = lut[from * n + i];
    solve(r, g, b, a);
    for (let i = 0; i < n; i++) lut[node * n + i] = a[i];
  });
  [spotKey, spotCache] = [key, lut];
  return lut;
}

const weigh = (x0: number, x1: number, x2: number, y0: number, y1: number, y2: number) => {
  const lx = LUMA[0] * x0 + LUMA[1] * x1 + LUMA[2] * x2;
  const ly = LUMA[0] * y0 + LUMA[1] * y1 + LUMA[2] * y2;
  return lx * ly + CHROMA * ((x0 - lx) * (y0 - ly) + (x1 - lx) * (y1 - ly) + (x2 - lx) * (y2 - ly));
};

/**
 * Overprint: bounded least squares, one ink at a time. The model is linear in each ink alone, so
 * each step is an exact 1D minimum clamped to 0..1.
 */
function solver(inks: number[][]): (r: number, g: number, b: number, a: Float64Array) => void {
  const n = inks.length;
  const k = Float64Array.from(inks.flat(), (v) => Math.max(DARKEST, v));
  const sheet = new Float64Array(3);
  const lo = new Float64Array(3);
  const hi = new Float64Array(3);
  const model = (a: Float64Array, out: Float64Array) => {
    out.fill(1);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c] *= 1 - a[i] * (1 - k[i * 3 + c]);
  };
  // the sheet without ink i (lo) and with it solid (hi): the running product divides it out
  const split = (a: Float64Array, i: number) => {
    for (let c = 0; c < 3; c++) {
      lo[c] = sheet[c] / (1 - a[i] * (1 - k[i * 3 + c]));
      hi[c] = lo[c] * k[i * 3 + c];
    }
  };
  const cost = (a: Float64Array, r: number, g: number, b: number) => {
    let ink = 0;
    for (let i = 0; i < n; i++) ink += a[i];
    const [e0, e1, e2] = [sheet[0] - r, sheet[1] - g, sheet[2] - b];
    return weigh(e0, e1, e2, e0, e1, e2) + LESS_INK * ink;
  };
  const descend = (r: number, g: number, b: number, a: Float64Array) => {
    model(a, sheet);
    let last = cost(a, r, g, b);
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      for (let i = 0; i < n; i++) {
        split(a, i);
        const [d0, d1, d2] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        const curve = weigh(d0, d1, d2, d0, d1, d2);
        const x = curve > 1e-12 ? -(weigh(d0, d1, d2, lo[0] - r, lo[1] - g, lo[2] - b) + LESS_INK / 2) / curve : 0;
        a[i] = x > 0 ? (x < 1 ? x : 1) : 0;
        for (let c = 0; c < 3; c++) sheet[c] = lo[c] + a[i] * (hi[c] - lo[c]);
      }
      model(a, sheet); // afresh, so the running product can't drift
      const now = cost(a, r, g, b);
      const settled = last - now < SETTLED;
      last = now;
      if (settled) break;
    }
    return last;
  };
  const alone = new Float64Array(n);
  return (r, g, b, a) => {
    const near = descend(r, g, b, a);
    // the product model has more than one valley: a mix carried over from the neighbour can hold
    // on where one ink alone fits better (an ink's own colour), so also start from the best single ink
    let [best, amount, bestCost] = [-1, 0, near];
    for (let i = 0; i < n; i++) {
      // alone on the paper: 1 − x(1 − ink)
      const [d0, d1, d2] = [k[i * 3] - 1, k[i * 3 + 1] - 1, k[i * 3 + 2] - 1];
      const curve = weigh(d0, d1, d2, d0, d1, d2);
      const x = curve > 1e-12 ? Math.min(1, Math.max(0, -(weigh(d0, d1, d2, 1 - r, 1 - g, 1 - b) + LESS_INK / 2) / curve)) : 0;
      const [e0, e1, e2] = [1 + x * d0 - r, 1 + x * d1 - g, 1 + x * d2 - b];
      const c = weigh(e0, e1, e2, e0, e1, e2) + LESS_INK * x;
      if (c < bestCost) [best, amount, bestCost] = [i, x, c];
    }
    if (best < 0) return;
    alone.fill(0);
    alone[best] = amount;
    if (descend(r, g, b, alone) < near) a.set(alone);
  };
}

/** a knockout fit's tie-break between mixes of one colour, so the fit has a single answer */
const SPREAD = 1e-4;
const PAIR_SWEEPS = 80;

/**
 * Knockout, solved in what each ink shows: its share sᵢ = aᵢ·Π(1 − a_later) of the sheet, the paper
 * showing in the rest. The sheet is then paper + Σ sᵢ(inkᵢ − paper), a plain mix of the ink colours
 * and the paper, so the fit is convex, with one best answer that moves smoothly with the colour (in
 * coverages it has several valleys, and a table hopping between them printed a staircase across a
 * smooth gradient). Shares move in pairs, mass from one to another with the paper among them, so
 * they stay on the simplex; then each ink's coverage is its share over what the inks above leave.
 */
function shareSolver(inks: number[][], paper: number[]): (r: number, g: number, b: number, a: Float64Array) => void {
  const n = inks.length;
  const d = inks.map((ink) => ink.map((v, c) => v - paper[c]));
  const G = d.map((x) => d.map((y) => weigh(x[0], x[1], x[2], y[0], y[1], y[2])));
  // the shares, the paper's last, and (G s) for the inks
  const s = new Float64Array(n + 1);
  const gs = new Float64Array(n);
  const h = new Float64Array(n);
  return (r, g, b, a) => {
    const [m0, m1, m2] = [paper[0] - r, paper[1] - g, paper[2] - b];
    for (let i = 0; i < n; i++) h[i] = weigh(d[i][0], d[i][1], d[i][2], m0, m1, m2);
    // the neighbour's coverages as shares, top ink down
    let open = 1;
    for (let i = n - 1; i >= 0; i--) {
      s[i] = a[i] * open;
      open *= 1 - a[i];
    }
    s[n] = open;
    for (let i = 0; i < n; i++) {
      gs[i] = 0;
      for (let j = 0; j < n; j++) gs[i] += G[i][j] * s[j];
    }
    // the cost's slope along share i (the paper's is flat) and its curvature
    const slope = (i: number) => (i === n ? 0 : 2 * (gs[i] + h[i]) + LESS_INK + 2 * SPREAD * s[i]);
    const bend = (i: number) => (i === n ? 0 : 2 * (G[i][i] + SPREAD));
    for (let sweep = 0; sweep < PAIR_SWEEPS; sweep++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j <= n; j++) {
          const curve = bend(i) + bend(j) - (j === n ? 0 : 4 * G[i][j]);
          if (curve <= 1e-12) continue;
          // move t from j to i: the exact minimum along that line, kept on the simplex
          const t = Math.min(s[j], Math.max(-s[i], -(slope(i) - slope(j)) / curve));
          if (t === 0) continue;
          s[i] += t;
          s[j] -= t;
          for (let k = 0; k < n; k++) gs[k] += t * (G[k][i] - (j === n ? 0 : G[k][j]));
          moved = Math.max(moved, Math.abs(t));
        }
      }
      if (moved < 1e-7) break;
    }
    let free = 1;
    for (let i = n - 1; i >= 0; i--) {
      a[i] = free > 1e-6 ? Math.min(1, Math.max(0, s[i] / free)) : 0;
      free -= s[i];
    }
  };
}
