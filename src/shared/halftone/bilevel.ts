// 1-bit plates the way a RIP makes them: each cell switches on its share of the print pixels whose
// centres lie in it, in the order its dot grows over them (the shape's spot function), carrying the
// rounding on to the next cell. So every level a cell's pixels can hold prints; thresholding the
// anti-aliased plate instead grew dots by whole rings and lost most of the light tones.
import { axes } from './screen.ts';
import { extent, sdf } from './shapes.ts';
import type { Cells, CellShape } from './types.ts';

/** spot table points per half cell side */
const N = 64;
const tables = new Map<CellShape, Float32Array>();

/**
 * The coverage at which the dot first covers each point of a quarter cell, (|u|, |v|) in cell
 * units on an (N + 1)² grid over [0, ½]²: by bisection on the dot's own edge, so it follows every
 * shape as shapes.ts grows it (dots never shrink as coverage rises).
 */
function spotTable(shape: CellShape): Float32Array {
  let t = tables.get(shape);
  if (t) return t;
  t = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const [u, v] = [i / (2 * N), j / (2 * N)];
      let [lo, hi] = [0, 1];
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        const [a, b] = extent(shape, mid);
        if (sdf(shape, a, b, u, v) <= 0) hi = mid;
        else lo = mid;
      }
      t[j * (N + 1) + i] = hi;
    }
  }
  tables.set(shape, t);
  return t;
}

/** the table read between its points */
function spotAt(t: Float32Array, u: number, v: number): number {
  const [x, y] = [Math.min(N, Math.abs(u) * 2 * N), Math.min(N, Math.abs(v) * 2 * N)];
  const [i, j] = [Math.min(N - 1, x | 0), Math.min(N - 1, y | 0)];
  const [fx, fy] = [x - i, y - j];
  const o = j * (N + 1) + i;
  const top = t[o] + (t[o + 1] - t[o]) * fx;
  const bottom = t[o + N + 1] + (t[o + N + 2] - t[o + N + 1]) * fx;
  return top + (bottom - top) * fy;
}

/**
 * One ink's plate at print resolution, W × H: 0 where it prints, 255 for paper (tiff.ts's order).
 * `coverage` is each cell's inked coverage (after gain and the min dot), `page` the page in print
 * px unrounded (the cells' grid is anchored at its centre).
 */
export function bilevel(cells: Cells, coverage: ArrayLike<number>, shape: CellShape, W: number, H: number, page: { w: number; h: number }): Uint8Array {
  const out = new Uint8Array(W * H).fill(255);
  const table = spotTable(shape);
  const { ux, uy, vx, vy } = axes(cells.angle);
  const [s, p] = [cells.step, cells.pitch];
  const [ox, oy] = [page.w / 2, page.h / 2];
  // the cell's bounding box, half extents
  const ex = (s * Math.abs(ux) + p * Math.abs(vx)) / 2;
  const ey = (s * Math.abs(uy) + p * Math.abs(vy)) / 2;
  const room = (Math.ceil(2 * ex) + 2) * (Math.ceil(2 * ey) + 2);
  const keys = new Float64Array(room);
  const sorted = new Float64Array(room);
  const at = new Int32Array(room);
  let carry = 0;
  for (let k = 0; k < cells.n; k++) {
    const c = coverage[k];
    if (!(c > 0)) continue;
    const [cx, cy] = [cells.x[k], cells.y[k]];
    const [x0, x1] = [Math.ceil(cx - ex - 0.5), Math.floor(cx + ex - 0.5)];
    const [y0, y1] = [Math.ceil(cy - ey - 0.5), Math.floor(cy + ey - 0.5)];
    if (x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) continue;
    // this cell's place in the grid; a pixel is its own when it rounds to the same place, so every
    // pixel belongs to exactly one cell
    const ci = Math.round(((cx - ox) * ux + (cy - oy) * uy) / s);
    const cj = Math.round(((cx - ox) * vx + (cy - oy) * vy) / p);
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - oy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - ox;
        const U = (dx * ux + dy * uy) / s;
        const V = (dx * vx + dy * vy) / p;
        if (Math.round(U) !== ci || Math.round(V) !== cj) continue;
        // ties (a symmetric pixel) go in the order met, so each level adds exactly one pixel
        keys[n] = spotAt(table, U - ci, V - cj) + n * 1e-9;
        at[n] = x >= 0 && y >= 0 && x < W && y < H ? y * W + x : -1;
        n++;
      }
    }
    if (!n) continue;
    const want = c >= 1 ? n : c * n + carry;
    const on = Math.max(0, Math.min(n, Math.round(want)));
    carry = c >= 1 ? 0 : want - on;
    if (!on) continue;
    let last = Infinity;
    if (on < n) {
      sorted.set(keys.subarray(0, n));
      last = sorted.subarray(0, n).sort()[on - 1];
    }
    for (let q = 0; q < n; q++) if (keys[q] <= last && at[q] >= 0) out[at[q]] = 0;
  }
  return out;
}
