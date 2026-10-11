// Plates: how much of each ink every pixel needs, 0..1. One print model for every mode, the one the
// preview and the SVG draw: the paper, and on it each ink in printing order, seen area-averaged. A
// transparent ink multiplies the sheet below it by 1 − a(1 − ink); an opaque one covers it, as white
// or screen-print ink does (spec §6.3); knocked out, each ink shows its own colour where no later
// ink prints (as Illustrator draws stacked fills), which is covering too.
//
// Colour is paper-relative (spec §6.1): the image's white is the paper, so a grey prints with
// neutral ink and takes on the paper's tint, and no ink is spent cancelling it. Transparent inks are
// fitted as if on white. Once an ink covers, the paper is part of the fit, and the image's white is
// the lightest of the paper and the covering inks: white ink on dark stock prints the lights, and
// the image's black is then the stock.
// It works on sRGB-encoded values, where a 50% grey takes 50% black, as shared/color's ≈CMYK estimate
// (which is the overprint model with ideal process inks) already does.
//
// A pixel goes through small tables: tone (tone.ts), a GRID³ table over the image's colours holding
// every ink's coverage (each node fitted where its colour lands on the sheet), then each ink's
// curve. The Halftone tool runs this in a worker for the view and every export alike
// (tools/halftone/screen.worker.ts), so no second separation exists.
import { cmykEstimate, rgb255, toOklch, type Oklch } from '../color/index.ts';
import { curveTable, lookup, TABLE, toneTable } from './tone.ts';
import type { Mode, Overlap, Process, SeparateInk, Tone } from './types.ts';

export const GRID = 33;
/** the most spot inks the engine separates: the preview holds them in two RGBA tables */
export const MAX_SPOT = 6;

const NODES = GRID ** 3;
const PROCESS: Process[] = ['c', 'm', 'y', 'k'];

/**
 * Everything a pixel's inks come from, laid out so a GPU pass could read it (none does yet): `tone`
 * is a TABLE × 1 texture and `curves` a TABLE × n one, both read linear-filtered at texel centres,
 * (v × (TABLE − 1) + 0.5) / TABLE. `lut` is a GRID³ 3D texture (red along x, n values per texel:
 * split into RGBA layers) read with texelFetch at the 4 corners inksAt picks, weighted as it does.
 */
export type Separation = {
  n: number;
  /** linear light to toned sRGB-encoded value (tone.toneTable) */
  tone: Float32Array;
  /** what a transparent pixel reads as in those values: the paper */
  blank: [number, number, number];
  /** GRID³ nodes, red fastest, then green, then blue; each node's n coverages together */
  lut: Float32Array;
  /** each ink's curve table, end to end */
  curves: Float32Array;
};

/** `stack`: which inks take part, by their place in the list; one left out is not in the separation and gets an empty plate */
export type SeparateOptions = { paper?: Oklch; overlap?: Overlap; stack?: boolean[] };

/** Ink values 0..255 over the sheet, the screen colour the preview multiplies. */
const encodedOf = (o: Oklch) => rgb255(o).map((v) => v / 255);

/** which inks cover what is under them instead of multiplying it: opaque spot inks, and every knocked-out one */
export const covering = (inks: SeparateInk[], mode: Mode, overlap?: Overlap): boolean[] =>
  inks.map((ink) => mode === 'spot' && (overlap === 'knockout' || !!ink.opaque));

/**
 * Ink order is printing order: the first ink goes down first, so the last one shows on top.
 * Visibility never enters here: a hidden ink keeps its plate and the others keep theirs. Only a
 * knockout stack leaves a hidden ink out (toPlates `stack`), since it would cut holes in the rest.
 */
export function separation(inks: SeparateInk[], mode: Mode, tone: Tone, opts: SeparateOptions = {}): Separation {
  const curves = new Float32Array(TABLE * inks.length);
  inks.forEach((ink, i) => curves.set(curveTable(ink.curve), i * TABLE));
  const cover = covering(inks, mode, opts.overlap);
  // only a covering ink sees the paper; without one the fit is on white and the paper tints it all
  const paperO = cover.some(Boolean) && opts.paper ? opts.paper : null;
  const paper = paperO ? encodedOf(paperO) : [1, 1, 1];
  const whiteO = inks.reduce<Oklch | null>((w, ink, i) => (w && cover[i] && ink.colour[0] > w[0] ? ink.colour : w), paperO);
  // with a light ink as its white (dark stock), the image's black is the stock, or an ink darker
  // still: no ink is spent darkening the stock towards a black it can't reach
  const blackO = paperO && whiteO !== paperO ? inks.reduce((b, ink) => (ink.colour[0] < b[0] ? ink.colour : b), paperO) : null;
  const range = { white: whiteO ? encodedOf(whiteO) : [1, 1, 1], black: blackO ? encodedOf(blackO) : [0, 0, 0] };
  return {
    n: inks.length,
    tone: toneTable(tone),
    // the paper as an image colour: where it lies between the image's black and white
    blank: paper.map((p, c) => {
      const span = range.white[c] - range.black[c];
      return span > 1e-6 ? Math.min(1, Math.max(0, (p - range.black[c]) / span)) : 0;
    }) as [number, number, number],
    lut: mode === 'process' ? processLut(inks) : spotLut(inks.map((ink) => encodedOf(ink.colour)), cover, mode === 'spot' && opts.overlap === 'knockout', paper, range),
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
  const taking = inks.flatMap((_, i) => (opts.stack && !opts.stack[i] ? [] : [i]));
  const sep = separation(taking.map((i) => inks[i]), mode, tone, opts);
  const plates = inks.map(() => new Float32Array(w * h));
  const out = new Float32Array(sep.n);
  for (let p = 0, q = 0; p < w * h; p++, q += 4) {
    inksAt(sep, rgbaLinear[q], rgbaLinear[q + 1], rgbaLinear[q + 2], rgbaLinear[q + 3], out);
    for (let k = 0; k < sep.n; k++) plates[taking[k]][p] = out[k];
  }
  return plates;
}

/** One pixel's inks (linear light, straight alpha) into `out`: the cursor readout uses it too. */
export function inksAt(sep: Separation, r: number, g: number, b: number, alpha: number, out: Float32Array | number[]): void {
  const { n, tone, lut, curves, blank } = sep;
  const a = alpha > 0 ? (alpha < 1 ? alpha : 1) : 0;
  // transparent is paper, exactly: the paper can fall between nodes, whose mixes would leave specks
  if (!a) {
    for (let i = 0; i < n; i++) out[i] = 0;
    return;
  }
  const fr = (a * lookup(tone, r) + (1 - a) * blank[0]) * (GRID - 1);
  const fg = (a * lookup(tone, g) + (1 - a) * blank[1]) * (GRID - 1);
  const fb = (a * lookup(tone, b) + (1 - a) * blank[2]) * (GRID - 1);
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
const SWEEPS = 100;
/** a sweep that improves the fit less than this is the end: past it, only the tie-break creeps */
const SETTLED = 1e-8;

let spotKey = '';
let spotCache = new Float32Array(0);

/**
 * Each node is an image colour, fitted where it lands on the sheet: between `range.black` and
 * `range.white` (the image's black and white on it), so both sit on nodes and nothing between
 * nodes reads a colour outside the image's range.
 */
function spotLut(inks: number[][], cover: boolean[], knockout: boolean, paper: number[], range: { white: number[]; black: number[] }): Float32Array {
  const n = inks.length;
  if (n > MAX_SPOT) throw new RangeError(`The engine separates at most ${MAX_SPOT} spot inks.`);
  const key = JSON.stringify([inks, cover, knockout, paper, range]);
  const { white: w, black: k } = range;
  if (key === spotKey) return spotCache;
  const lut = new Float32Array(NODES * n);
  const solve = knockout ? shareSolver(inks, paper) : solver(inks, cover, paper);
  const a = new Float64Array(n);
  forEachNode((node, r, g, b) => {
    // start from the neighbour just solved, so the table stays smooth where several mixes fit
    const from = node % GRID ? node - 1 : Math.floor(node / GRID) % GRID ? node - GRID : node - GRID * GRID;
    for (let i = 0; i < n && from >= 0; i++) a[i] = lut[from * n + i];
    solve(k[0] + r * (w[0] - k[0]), k[1] + g * (w[1] - k[1]), k[2] + b * (w[2] - k[2]), a);
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
 * Overprint: bounded least squares, one ink at a time. Each ink goes over the sheet below it (a
 * transparent one multiplying it, an opaque one covering it), so the finished sheet is affine in
 * any one ink alone and each step is an exact 1D minimum clamped to 0..1.
 */
function solver(inks: number[][], cover: boolean[], paper: number[]): (r: number, g: number, b: number, a: Float64Array) => void {
  const n = inks.length;
  const k = Float64Array.from(inks.flat());
  // what the inks from i on do to the sheet under ink i, per channel: x·A + B (past the last, x)
  const A = new Float64Array(3 * (n + 1));
  const B = new Float64Array(3 * (n + 1));
  // the sheet so far
  const s = new Float64Array(3);
  const lay = (i: number, x: number) => {
    const o = i * 3;
    if (cover[i]) {
      s[0] += x * (k[o] - s[0]);
      s[1] += x * (k[o + 1] - s[1]);
      s[2] += x * (k[o + 2] - s[2]);
    } else {
      s[0] *= 1 - x * (1 - k[o]);
      s[1] *= 1 - x * (1 - k[o + 1]);
      s[2] *= 1 - x * (1 - k[o + 2]);
    }
  };
  const above = (a: Float64Array) => {
    A.fill(1, 3 * n);
    B.fill(0, 3 * n);
    for (let i = n - 1, o = i * 3; i >= 0; i--, o -= 3) {
      const x = a[i];
      for (let c = 0; c < 3; c++) {
        const up = A[o + 3 + c];
        A[o + c] = (cover[i] ? 1 - x : 1 - x * (1 - k[o + c])) * up;
        B[o + c] = (cover[i] ? x * k[o + c] * up : 0) + B[o + 3 + c];
      }
    }
  };
  const cost = (a: Float64Array, r: number, g: number, b: number) => {
    let ink = 0;
    for (let i = 0; i < n; i++) ink += a[i];
    const e0 = s[0] - r;
    const e1 = s[1] - g;
    const e2 = s[2] - b;
    return weigh(e0, e1, e2, e0, e1, e2) + LESS_INK * ink;
  };
  /** ink i's best coverage over the sheet, the inks after it doing what A and B say */
  const best = (i: number, r: number, g: number, b: number) => {
    const [o, q] = [i * 3, i * 3 + 3];
    const l0 = s[0] * A[q] + B[q];
    const l1 = s[1] * A[q + 1] + B[q + 1];
    const l2 = s[2] * A[q + 2] + B[q + 2];
    const t = cover[i] ? 1 : 0;
    // solid, over the sheet: the ink itself if it covers, the sheet times it if not
    const d0 = (t ? k[o] : s[0] * k[o]) * A[q] + B[q] - l0;
    const d1 = (t ? k[o + 1] : s[1] * k[o + 1]) * A[q + 1] + B[q + 1] - l1;
    const d2 = (t ? k[o + 2] : s[2] * k[o + 2]) * A[q + 2] + B[q + 2] - l2;
    const curve = weigh(d0, d1, d2, d0, d1, d2);
    const x = curve > 1e-12 ? -(weigh(d0, d1, d2, l0 - r, l1 - g, l2 - b) + LESS_INK / 2) / curve : 0;
    return x > 0 ? (x < 1 ? x : 1) : 0;
  };
  const descend = (r: number, g: number, b: number, a: Float64Array) => {
    s.set(paper);
    for (let i = 0; i < n; i++) lay(i, a[i]);
    let last = cost(a, r, g, b);
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      above(a);
      s.set(paper);
      for (let i = 0; i < n; i++) lay(i, (a[i] = best(i, r, g, b)));
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
    // the model has more than one valley: a mix carried over from the neighbour can hold on where
    // one ink alone fits better (an ink's own colour), so also start from the best single ink
    let [one, amount, oneCost] = [-1, 0, near];
    alone.fill(0);
    A.fill(1);
    B.fill(0);
    for (let i = 0; i < n; i++) {
      s.set(paper);
      const x = best(i, r, g, b);
      lay(i, x);
      const c = cost(alone, r, g, b) + LESS_INK * x;
      if (c < oneCost) [one, amount, oneCost] = [i, x, c];
    }
    if (one < 0) return;
    alone[one] = amount;
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
