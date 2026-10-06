// The OKLCH picker's planes (oklch.com's model): one slice of the colour solid with the third value
// fixed. L by C at H (today's), C by H at L, and H by L at C. Pure maths and pixels, so it runs in
// tests; the renderer only draws it. L is vertical on every plane.
//
// The new planes draw colours with the matrices below instead of culori: about 0.15 µs a pixel, so
// a 340 × 200 plane is a few ms and the value lock's plane (a solve per pixel) fits a frame.
import type { PickerPlane } from '../types.ts';
import type { Oklch } from './index.ts';
import { gamutEdges, planePixels, planeAxis } from './picker.ts';
import { clamp01, edgeChroma, holds, inP3, inSrgb, lrgb, solveL, to8 } from './fast.ts';

/** the chroma axis of the C by H plane: the C field's maximum (sRGB peaks near 0.32, P3 near 0.36) */
export const CMAX = 0.4;
/** a value this near black or white has a single colour: the held plane has nothing to draw */
const BARE = 0.004;
/** opacity of a colour only Display P3 can show, drawn clipped on an sRGB screen (as the L by C plane) */
const DIM = 90;
/** the widest chroma below which a plane is only a sliver by the grey axis: it says there is nothing to pick */
const SLIVER = 0.03;
const RAD = Math.PI / 180;

export type PlaneArt = {
  /** RGBA, `w` × `rows`: sRGB opaque, P3-only dimmed, the rest clear */
  px: Uint8ClampedArray<ArrayBuffer>;
  /** the sRGB and P3 edges as SVG path data in pixel units ('' where a plane has none) */
  srgb: string;
  p3: string;
  /** no sRGB colour at all lives on this plane (L at 0 or 100, a chroma sRGB doesn't reach) */
  empty: boolean;
};

// ── the plane's geometry ──

/** the three planes: which channel is fixed, and what the axes are */
export const PLANES: Record<PickerPlane, { fixed: 'h' | 'l' | 'c'; x: 'c' | 'h'; y: 'l' | 'c'; name: string }> = {
  lc: { fixed: 'h', x: 'c', y: 'l', name: 'Lightness by chroma' },
  ch: { fixed: 'l', x: 'h', y: 'c', name: 'Chroma by hue' },
  hl: { fixed: 'c', x: 'h', y: 'l', name: 'Lightness by hue' },
};

/** the fixed channel's step for the cache: the H field's 0.1, L's 0.005, C's 0.002 */
const STEP = { lc: 0.1, ch: 0.005, hl: 0.002 } as const;
const FIXED = { lc: 2, ch: 0, hl: 1 } as const;

/** the fixed value, quantised: a plane is redrawn only when this changes */
export const planeFixed = (id: PickerPlane, o: Oklch): number => Math.round(o[FIXED[id]] / STEP[id]) * STEP[id];

/** the plane's full scale on x and y (in the units of the axes: C, H degrees or L) */
export function planeScale(id: PickerPlane, axis: number): { x: number; y: number } {
  return id === 'lc' ? { x: axis, y: 1 } : id === 'ch' ? { x: 360, y: CMAX } : { x: 360, y: 1 };
}

/** where a colour sits on the plane, 0..1 from the left and from the bottom (past 0..1 when it is off the scale) */
export function planePoint(id: PickerPlane, [l, c, h]: Oklch, axis: number): [number, number] {
  const k = planeScale(id, axis);
  return id === 'lc' ? [c / k.x, l] : id === 'ch' ? [h / k.x, c / k.y] : [h / k.x, l];
}

/** the colour at a point of the plane: its two channels from the point, the fixed one from `o` */
export function planeColour(id: PickerPlane, u: number, v: number, [l, c, h]: Oklch, axis: number): Oklch {
  const k = planeScale(id, axis);
  return id === 'lc' ? [v, u * k.x, h] : id === 'ch' ? [l, v * k.y, u * k.x] : [v, c, u * k.x];
}

// ── colour, fast (fast.ts) ──

/** a clipped colour into the pixel at `i` */
function put(px: Uint8ClampedArray, i: number, v: Float64Array, alpha: number) {
  px[i] = to8(v[0]);
  px[i + 1] = to8(v[1]);
  px[i + 2] = to8(v[2]);
  px[i + 3] = alpha;
}

// ── paths ──

const px1 = (n: number) => +n.toFixed(1);

/** an edge given by a chroma per pixel row (the L by C plane) */
const rowPath = (edge: Float64Array, w: number, axis: number) =>
  `M0 0${Array.from(edge, (c, y) => `L${px1((c / axis) * w)} ${px1(y + 0.5)}`).join('')}L0 ${edge.length}`;

/** an edge given by a y per pixel column, NaN where the column has none: runs of columns, each its own piece */
function columnPath(ys: ArrayLike<number>): string {
  let d = '';
  let open = false;
  for (let x = 0; x < ys.length; x++) {
    const y = ys[x];
    if (y !== y) open = false;
    else {
      d += `${open ? 'L' : 'M'}${px1(x + 0.5)} ${px1(y)}`;
      open = true;
    }
  }
  return d;
}

// ── the three planes ──

/** L by C at hue `h`, chroma 0..`axis` across: picker.ts's pixels and edges */
export function lcArt(h: number, w: number, rows: number, axis: number): PlaneArt {
  const edges = gamutEdges(h, rows);
  return {
    px: planePixels(h, w, rows, axis, edges),
    srgb: rowPath(edges.srgb, w, axis),
    p3: rowPath(edges.p3, w, axis),
    empty: false,
  };
}

/** C by H at lightness `l`: hue across, chroma up to CMAX; the edges are one chroma per column */
export function chArt(l: number, w: number, rows: number): PlaneArt {
  const px = new Uint8ClampedArray(w * rows * 4);
  const s = new Float64Array(w);
  const p = new Float64Array(w);
  let empty = true;
  for (let x = 0; x < w; x++) {
    const h = ((x + 0.5) / w) * 360 * RAD;
    const [ca, sa] = [Math.cos(h), Math.sin(h)];
    s[x] = Math.min(CMAX, edgeChroma(l, ca, sa, false));
    p[x] = Math.min(CMAX, edgeChroma(l, ca, sa, true));
    if (s[x] > SLIVER) empty = false;
    for (let y = rows - 1; y >= 0; y--) {
      const c = ((rows - y - 0.5) / rows) * CMAX;
      if (c > p[x]) break;
      put(px, (y * w + x) * 4, lrgb(l, c * ca, c * sa), c <= s[x] ? 255 : DIM);
    }
  }
  const y = (e: Float64Array) => Array.from(e, (c) => (1 - c / CMAX) * rows);
  return { px, srgb: columnPath(y(s)), p3: columnPath(y(p)), empty };
}

/** H by L at chroma `c`: hue across, lightness up. At a fixed chroma the L that fits is one run per hue */
export function hlArt(c: number, w: number, rows: number): PlaneArt {
  const px = new Uint8ClampedArray(w * rows * 4);
  const edge = () => Array.from({ length: w }, () => NaN);
  const [sTop, sBot, pTop, pBot] = [edge(), edge(), edge(), edge()];
  let empty = true;
  for (let x = 0; x < w; x++) {
    const h = ((x + 0.5) / w) * 360 * RAD;
    const [a, b] = [c * Math.cos(h), c * Math.sin(h)];
    for (let y = 0; y < rows; y++) {
      const v = lrgb(1 - (y + 0.5) / rows, a, b);
      if (!inP3(v)) continue;
      const srgb = inSrgb(v);
      put(px, (y * w + x) * 4, v, srgb ? 255 : DIM);
      pTop[x] = Number.isNaN(pTop[x]) ? y : pTop[x];
      pBot[x] = y + 1;
      if (srgb) {
        empty = false;
        sTop[x] = Number.isNaN(sTop[x]) ? y : sTop[x];
        sBot[x] = y + 1;
      }
    }
  }
  return { px, srgb: columnPath(sTop) + columnPath(sBot), p3: columnPath(pTop) + columnPath(pBot), empty };
}

// ── the value lock's C by H plane ──

/** the chroma step between the L samples of one column; the colours between are interpolated */
const STEP_C = 0.006;

/**
 * One hue's iso-value curve: L at chroma 0, STEP_C, 2 STEP_C … while the colour stays in sRGB, then
 * the last sample at the edge itself (where the value is no longer reachable). Each solve starts
 * from the L before it.
 */
function holdCurve(target: number, ca: number, sa: number): { cs: number[]; ls: number[] } {
  const cs = [0];
  const ls = [solveL(target, 0, ca, sa, target ** 0.73)]; // a grey's L is the cube root of its linear value: about value^0.73
  for (let k = 1; k * STEP_C < CMAX; k++) {
    const c = k * STEP_C;
    const l = solveL(target, c, ca, sa, ls.at(-1)!);
    if (holds(target, l, c, ca, sa)) {
      cs.push(c);
      ls.push(l);
      continue;
    }
    let [lo, hi, lLo] = [cs.at(-1)!, c, ls.at(-1)!];
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      const lm = solveL(target, m, ca, sa, lLo);
      if (holds(target, lm, m, ca, sa)) [lo, lLo] = [m, lm];
      else hi = m;
    }
    if (lo > cs.at(-1)!) {
      cs.push(lo);
      ls.push(lLo);
    }
    break;
  }
  return { cs, ls };
}

/**
 * C by H with every point at the value `target` (0..1): each pixel's L is solved, so the plane is
 * the literal "hold this value" slice. The colours are the ones sRGB can show at that value, so only
 * the sRGB edge exists (the chroma past it has no colour at this value), and there is no P3 shading.
 */
export function heldChArt(target: number, w: number, rows: number): PlaneArt {
  const px = new Uint8ClampedArray(w * rows * 4);
  if (target < BARE || target > 1 - BARE) return { px, srgb: '', p3: '', empty: true };
  const edge = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const h = ((x + 0.5) / w) * 360 * RAD;
    const [ca, sa] = [Math.cos(h), Math.sin(h)];
    const { cs, ls } = holdCurve(target, ca, sa);
    const top = cs.length - 1;
    if (!top) continue; // no chroma at this value and hue
    edge[x] = cs[top];
    // the samples are STEP_C apart, except the last, which is the edge: find a chroma's segment by its index
    for (let y = rows - 1; y >= 0; y--) {
      const c = ((rows - y - 0.5) / rows) * CMAX;
      if (c > cs[top]) break;
      const i = Math.min(Math.floor(c / STEP_C), top - 1);
      const t = clamp01((c - cs[i]) / (cs[i + 1] - cs[i]));
      put(px, (y * w + x) * 4, lrgb(ls[i] + (ls[i + 1] - ls[i]) * t, c * ca, c * sa), 255);
    }
  }
  return { px, srgb: columnPath(Array.from(edge, (c) => (1 - c / CMAX) * rows)), p3: '', empty: false };
}

// ── the L and H strips: colours where sRGB has them, clear where it doesn't ──

export type StripArt = {
  /** one row of RGBA, `w` px */
  px: Uint8ClampedArray<ArrayBuffer>;
  /** 0..1 along the strip where a run of sRGB colours begins or ends inside it */
  ends: number[];
  /** the strip is painted at a floor chroma (the colour is a grey, where hue is invisible) */
  floor: boolean;
};

/** below this chroma the H strip would be a grey bar, so it is painted at FLOOR instead (the needle stays true) */
export const GREY_STRIP = 0.02;
export const FLOOR = 0.1;

function strip(w: number, at: (t: number) => [l: number, a: number, b: number]): StripArt {
  const px = new Uint8ClampedArray(w * 4);
  const ends: number[] = [];
  let was = false;
  for (let x = 0; x < w; x++) {
    const v = lrgb(...at((x + 0.5) / w));
    const now = inSrgb(v);
    if (now) put(px, x * 4, v, 255);
    if (x > 0 && now !== was) ends.push(x / w);
    was = now;
  }
  return { px, ends, floor: false };
}

/** the L strip: lightness 0..1 at this chroma and hue */
export function lStrip(c: number, h: number, w: number): StripArt {
  const [a, b] = [c * Math.cos(h * RAD), c * Math.sin(h * RAD)];
  return strip(w, (t) => [t, a, b]);
}

/** the H strip: hue 0..360 at this lightness and chroma; at a grey, at the floor chroma (or the most sRGB has at that hue) */
export function hStrip(l: number, c: number, w: number): StripArt {
  const floor = c < GREY_STRIP;
  const art = strip(w, (t) => {
    const [ca, sa] = [Math.cos(t * 360 * RAD), Math.sin(t * 360 * RAD)];
    const cc = floor ? Math.min(FLOOR, edgeChroma(l, ca, sa, false)) : c;
    return [l, cc * ca, cc * sa];
  });
  return { ...art, floor };
}

/** the plane's art; `target` is the value held (the lock on), which changes only the C by H plane */
export function planeArt(id: PickerPlane, fixed: number, w: number, rows: number, axis: number, target: number | null): PlaneArt {
  if (id === 'lc') return lcArt(fixed, w, rows, axis);
  if (id === 'ch') return target === null ? chArt(fixed, w, rows) : heldChArt(target, w, rows);
  return hlArt(fixed, w, rows);
}

export { planeAxis };
