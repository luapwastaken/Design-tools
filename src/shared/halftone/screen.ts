// The screen: for each ink a rotated grid of cells, each holding the plate's mean coverage around
// it, and the dot that coverage makes. The preview, the SVG and the separations all draw this one
// list, so they agree dot for dot.
import { extent } from './shapes.ts';
import type { Cells, CellShape, Screen, Size } from './types.ts';

/** The page in print pixels, unrounded, so the SVG keeps the exact physical size. */
export const pagePx = (size: Size): { w: number; h: number } => ({ w: (size.w * size.dpi) / 25.4, h: (size.h * size.dpi) / 25.4 });

/** The screen's axes in page pixels (y down): u along the screen at `angle` counter-clockwise as seen, v across it. */
export function axes(angle: number): { ux: number; uy: number; vx: number; vy: number } {
  const t = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return { ux: c, uy: -s, vx: s, vy: c };
}

/** o + i·step inside [lo, hi], as a range of i */
function span(o: number, step: number, lo: number, hi: number): [number, number] {
  if (Math.abs(step) < 1e-9) return o >= lo && o <= hi ? [-Infinity, Infinity] : [1, 0];
  const [a, b] = [(lo - o) / step, (hi - o) / step];
  return a < b ? [a, b] : [b, a];
}

/**
 * A summed-area table of the plate, Float64: in float32 the sums of a big plate lose the low bits
 * a mean needs. Read bilinearly it is the exact integral of the plate's pixels, so boxes smaller
 * than a pixel still average right.
 */
function summed(plate: Float32Array, pw: number, ph: number): Float64Array {
  const stride = pw + 1;
  const sat = new Float64Array(stride * (ph + 1));
  for (let y = 0; y < ph; y++) {
    let row = 0;
    const [src, up, at] = [y * pw, y * stride + 1, (y + 1) * stride + 1];
    for (let x = 0; x < pw; x++) {
      row += plate[src + x];
      sat[at + x] = sat[up + x] + row;
    }
  }
  return sat;
}

/**
 * Segments a line screen's cell splits into along the line: each takes the plate's mean over its
 * own length, so a line thins and thickens with the art inside a cell instead of running a whole
 * cell past every edge.
 */
export const LINE_SPLIT = 4;
export const splitOf = (shape: Screen['shape']): number => (shape === 'line' ? LINE_SPLIT : 1);

/**
 * One ink's cells: the grid at `angle` (degrees, counter-clockwise), `lpi` lines to the inch,
 * anchored at the page centre, over the page plus a cell's margin so rotated edges are covered
 * and edge dots reach in whole. `split` cuts each cell into that many along the screen (a line
 * screen's segments). The plate (plateW × plateH, 0..1) spans the page exactly; each cell takes
 * its mean over its own area, the nearest edge pixels standing in off the plate.
 */
export function cells(plate: Float32Array, size: Size, lpi: number, angle: number, plateW: number, plateH: number, split = 1): Cells {
  const { w, h } = pagePx(size);
  const pitch = size.dpi / lpi;
  const step = pitch / split;
  const { ux, uy, vx, vy } = axes(angle);
  const [ox, oy, m] = [w / 2, h / 2, pitch];
  const along = [[-m, -m], [w + m, -m], [-m, h + m], [w + m, h + m]].map(([x, y]) => ((x - ox) * vx + (y - oy) * vy) / pitch);
  const rows: number[] = [];
  let n = 0;
  for (let j = Math.floor(Math.min(...along)); j <= Math.ceil(Math.max(...along)); j++) {
    const [bx, by] = [ox + j * pitch * vx, oy + j * pitch * vy];
    const [x0, x1] = span(bx, step * ux, -m, w + m);
    const [y0, y1] = span(by, step * uy, -m, h + m);
    const [i0, i1] = [Math.ceil(Math.max(x0, y0)), Math.floor(Math.min(x1, y1))];
    if (i1 < i0) continue;
    rows.push(j, i0, i1);
    n += i1 - i0 + 1;
  }
  const out: Cells = { n, x: new Float32Array(n), y: new Float32Array(n), coverage: new Float32Array(n), pitch, step, angle };
  const [pw, ph, stride] = [plateW, plateH, plateW + 1];
  const sat = summed(plate, pw, ph);
  const integral = (x: number, y: number) => {
    const ix = x < pw ? x | 0 : pw - 1;
    const iy = y < ph ? y | 0 : ph - 1;
    const o = iy * stride + ix;
    const top = sat[o] + (sat[o + 1] - sat[o]) * (x - ix);
    const bottom = sat[o + stride] + (sat[o + stride + 1] - sat[o + stride]) * (x - ix);
    return top + (bottom - top) * (y - iy);
  };
  const [sx, sy] = [pw / w, ph / h];
  // a split cell is `split` squares of its step side by side across the screen, each read as a box
  const [hx, hy] = [(step / 2) * sx, (step / 2) * sy];
  const MIN = 1e-3;
  const mean = (x: number, y: number) => {
    const x0 = Math.max(0, Math.min(x * sx - hx, pw - MIN));
    const x1 = Math.min(pw, Math.max(x * sx + hx, x0 + MIN));
    const y0 = Math.max(0, Math.min(y * sy - hy, ph - MIN));
    const y1 = Math.min(ph, Math.max(y * sy + hy, y0 + MIN));
    return (integral(x1, y1) - integral(x0, y1) - integral(x1, y0) + integral(x0, y0)) / ((x1 - x0) * (y1 - y0));
  };
  let k = 0;
  for (let r = 0; r < rows.length; r += 3) {
    const j = rows[r];
    for (let i = rows[r + 1]; i <= rows[r + 2]; i++, k++) {
      const x = ox + step * i * ux + pitch * j * vx;
      const y = oy + step * i * uy + pitch * j * vy;
      out.x[k] = x;
      out.y[k] = y;
      let sum = 0;
      for (let q = 0; q < split; q++) {
        const t = (q - (split - 1) / 2) * step;
        sum += mean(x + t * vx, y + t * vy);
      }
      out.coverage[k] = sum / split;
    }
  }
  return out;
}

/** a press's dot gain as an exponent: 1 − (1 − c)^γ prints 50% as 50% + gain */
const gainExponent = (gain: number) => (gain > 0 ? Math.log(0.5 - Math.min(gain, 0.49)) / Math.log(0.5) : 1);

const unit = (c: number) => (c > 0 ? (c < 1 ? c : 1) : 0);

/** What a press with this dot gain (at 50%) prints for coverage c. */
export const printed = (c: number, gain: number): number => (gain > 0 ? 1 - (1 - unit(c)) ** gainExponent(gain) : unit(c));

/** The coverage to put on the plate so that press prints c. */
export const compensate = (c: number, gain: number): number => (gain > 0 ? 1 - (1 - unit(c)) ** (1 / gainExponent(gain)) : unit(c));

/**
 * Coverage no press holds whatever the min dot says: a 0.1% dot is under 8 µm across at any
 * frequency. Below it a cell is paper and above its inverse solid, so the SVG carries no specks.
 */
const SPECK = 1e-3;

/** compensated with the exponent's inverse `undo`, then dropped out or filled in past the smallest printable dot */
function inked(coverage: number, undo: number, minDot: number): number {
  const c = undo === 1 ? unit(coverage) : 1 - (1 - unit(coverage)) ** undo;
  const least = minDot > SPECK ? minDot : SPECK;
  return c < least ? 0 : c > 1 - least ? 1 : c;
}

/** A cell's coverage as the dot that goes down: gain compensated, then dropped out or filled in past the smallest printable dot. */
export const inkedCoverage = (screen: Screen, coverage: number): number => inked(coverage, 1 / gainExponent(screen.gain), screen.minDot);

export type DotGeom = { a: number; b: number };

/**
 * One dot's half-extents in the units of `pitch` (shapes.extent says what a and b mean per shape);
 * `step` is the cell's side along the screen when it differs (a line screen's segment).
 */
export function dot(screen: Screen, coverage: number, pitch: number, step = pitch): DotGeom {
  const [a, b] = extent(cellShape(screen), inkedCoverage(screen, coverage));
  return { a: a * step, b: b * pitch };
}

/**
 * Every cell's dot as (a, b) pairs in print pixels, and how many dots actually print: the count
 * the status bar shows and the SVG holds.
 */
export function dots(cells: Cells, screen: Screen): { geom: Float32Array; count: number } {
  const shape = cellShape(screen);
  const undo = 1 / gainExponent(screen.gain);
  const geom = new Float32Array(cells.n * 2);
  let count = 0;
  for (let k = 0; k < cells.n; k++) {
    const c = inked(cells.coverage[k], undo, screen.minDot);
    if (c === 0) continue;
    const [a, b] = extent(shape, c);
    geom[2 * k] = a * cells.step;
    geom[2 * k + 1] = b * cells.pitch;
    count++;
  }
  return { geom, count };
}

function cellShape(screen: Screen): CellShape {
  if (screen.shape === 'stochastic') throw new TypeError('A stochastic screen has no cells: use stochastic().');
  return screen.shape;
}
