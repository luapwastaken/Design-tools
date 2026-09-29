// Dot geometry in cell units (the cell is 1 × 1, centred on the dot). Every shape is symmetric
// about both screen axes and shrinks away from them, so a flat tint of equal dots covers each cell
// exactly by the dot's own area inside it, overlap or not: that area is the coverage.
import type { CellShape } from './types.ts';

/** the ellipse's minor axis over its major: chains form along the screen at 47% */
export const ELLIPSE = 0.6;
/** a cross's arm thickness over its length while the arms grow; past 51% they join into a grid */
export const CROSS = 1 / 3;
/**
 * Lines, joined crosses and full dots reach this far into the next cell, so no hairline seam shows
 * where two shapes would only touch.
 */
export const OVERLAP = 0.02;

const CROSS_JOIN = 2 * CROSS - CROSS * CROSS;

/** The area of an ellipse with half-axes a and b inside its unit cell. */
export function ellipseArea(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  // scaled to a unit circle, the cell's half-sides are X and Y; what lies past them is circle segments
  const X = 0.5 / a;
  const Y = 0.5 / b;
  if (X * X + Y * Y <= 1) return 1;
  const segment = (d: number) => (d >= 1 ? 0 : Math.acos(d) - d * Math.sqrt(1 - d * d));
  return a * b * (Math.PI - 2 * segment(X) - 2 * segment(Y));
}

const STEPS = 1024;
const tables = new Map<number, Float64Array>();

/**
 * Major half-axis for coverage c past the point where the dots meet (a > 0.5): tabulated by
 * bisection, since the clipped area has no closed inverse.
 */
function joinedAxis(ratio: number, c: number): number {
  let t = tables.get(ratio);
  if (!t) {
    const from = (Math.PI * ratio) / 4;
    const full = 0.5 * Math.sqrt(1 + 1 / (ratio * ratio));
    t = new Float64Array(STEPS + 1);
    for (let s = 0; s <= STEPS; s++) {
      const want = from + ((1 - from) * s) / STEPS;
      let [lo, hi] = [0.5, full];
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (ellipseArea(mid, mid * ratio) < want) lo = mid;
        else hi = mid;
      }
      t[s] = (lo + hi) / 2;
    }
    tables.set(ratio, t);
  }
  const from = (Math.PI * ratio) / 4;
  const p = ((c - from) / (1 - from)) * STEPS;
  const i = Math.min(STEPS - 1, Math.max(0, Math.floor(p)));
  return t[i] + (t[i + 1] - t[i]) * (p - i);
}

function ellipseAxes(ratio: number, c: number): [number, number] {
  const a = c <= (Math.PI * ratio) / 4 ? Math.sqrt(c / (Math.PI * ratio)) : joinedAxis(ratio, c);
  return [a, a * ratio];
}

/**
 * The dot for coverage c (0..1) as half-extents, cell units: `a` along the screen, `b` across.
 * round: radius (a = b) · ellipse: half-axes · square: half-side (a = b) · diamond: centre to
 * corner (a = b) · line: half-length and half-thickness · cross: arm half-length and half-thickness.
 */
export function extent(shape: CellShape, c: number): [number, number] {
  if (c >= 1) {
    const [a, b] = extent(shape, 1 - 1e-9);
    return [a + OVERLAP, b + OVERLAP];
  }
  if (c <= 0) return [0, 0];
  switch (shape) {
    case 'round':
      return ellipseAxes(1, c);
    case 'ellipse':
      return ellipseAxes(ELLIPSE, c);
    case 'square': {
      const h = Math.sqrt(c) / 2;
      return [h, h];
    }
    case 'diamond': {
      const d = c <= 0.5 ? Math.sqrt(c / 2) : 1 - Math.sqrt((1 - c) / 2);
      return [d, d];
    }
    case 'line':
      return [0.5 + OVERLAP, c / 2];
    case 'cross': {
      if (c > CROSS_JOIN) return [0.5 + OVERLAP, (1 - Math.sqrt(1 - c)) / 2];
      const length = Math.sqrt(c / CROSS_JOIN);
      return [length / 2, (CROSS * length) / 2];
    }
  }
}

const box = (dx: number, dy: number) => Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);

/**
 * Signed distance to the dot's edge, negative inside, at (u, v) from its centre along and across
 * the screen, in the units of a and b: exact, and for the ellipse true to first order off its edge,
 * so an anti-aliased edge is as wide all round. The preview's fragment shader draws round,
 * elliptical and diamond dots with this, line for line (boxes it filters exactly instead).
 */
export function sdf(shape: CellShape, a: number, b: number, u: number, v: number): number {
  if (!(a > 0 && b > 0)) return Infinity;
  u = Math.abs(u);
  v = Math.abs(v);
  switch (shape) {
    case 'round':
      return Math.hypot(u, v) - a;
    case 'ellipse': {
      // the implicit edge over its gradient
      const l = Math.hypot(u / a, v / b);
      return l > 1e-9 ? ((l - 1) * l) / Math.hypot(u / (a * a), v / (b * b)) : -b;
    }
    case 'square':
    case 'line':
      return box(u - a, v - b);
    case 'diamond': {
      // a square turned 45°, centre to corner a
      const h = a * Math.SQRT1_2;
      return box((u + v) * Math.SQRT1_2 - h, Math.abs(u - v) * Math.SQRT1_2 - h);
    }
    case 'cross':
      return Math.min(box(u - a, v - b), box(u - b, v - a));
  }
}
