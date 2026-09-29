// The lit preview's maths (plan unit P). Each shape is worked out once per size as a buffer of
// surface normals; a frame is then one pass that lights them and looks the result up in the ramp,
// so dragging the light costs a few milliseconds. Pure, so it runs in tests.
import { rgb255, type Oklch } from '../../../shared/color/index.ts';
import { fromOklab, toOklab } from '../../../shared/palette/space.ts';

export type Shape = 'sphere' | 'cube' | 'cloth';

/**
 * Degrees. Azimuth runs clockwise from straight up in the picture (315 is the upper left);
 * elevation from the picture plane (0, raking light) to the viewer (90, flat front light).
 */
export type Light = { azimuth: number; elevation: number };

/** A shape seen straight on, per pixel. Camera space: x right, y up, z toward the viewer. */
export type Surface = {
  size: number;
  normal: Float32Array;
  /** how much of the pixel the shape covers, 0..1: its antialiased edge */
  cover: Float32Array;
  /** 1 where the light reaches freely, less deep in the cloth's folds */
  open: Float32Array;
  /** `cover`, blurred: the soft shadow the shape throws on the backdrop behind it */
  blur: Float32Array;
};

type V3 = [number, number, number];
/** normal x, y, z and openness of the surface at a point, or false for a miss */
type Hit = (x: number, y: number, out: Float64Array) => boolean;

const RAD = Math.PI / 180;
const norm = (x: number, y: number, z: number): V3 => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function direction({ azimuth, elevation }: Light): V3 {
  const a = azimuth * RAD;
  const e = elevation * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** What one light position needs per pixel: the light, the bounce opposite it, and the half vector. */
export type Frame = { l: V3; b: V3; h: V3 };

export function frame(light: Light): Frame {
  const l = direction(light);
  // light bounced back off the surroundings arrives from the far side, a little toward the viewer
  return { l, b: norm(-l[0], -l[1], 0.4), h: norm(l[0], l[1], l[2] + 1) };
}

/**
 * How lit a point is, 0 (the ramp's deepest shadow) to 1 (its highlight), in the painter's order:
 * lit planes and halftone on the light side, a soft terminator, the core shadow just past it,
 * reflected light lifting the far edge, and a specular spot.
 */
export function tone(nx: number, ny: number, nz: number, open: number, f: Frame): number {
  const ndl = nx * f.l[0] + ny * f.l[1] + nz * f.l[2];
  const lit = smooth(-0.06, 0.22, ndl);
  // eased, so the planes turned to the light and the halftone share the lit side about evenly
  const d = ndl > 0 ? ndl : 0;
  const lightSide = 0.34 + 0.52 * d * (0.7 + 0.3 * d);
  const nb = nx * f.b[0] + ny * f.b[1] + nz * f.b[2];
  const shadowSide = nb > 0 ? 0.3 * nb * nb * smooth(0, 0.2, -ndl) : 0;
  const v = (shadowSide + (lightSide - shadowSide) * lit) * open;
  let s = nx * f.h[0] + ny * f.h[1] + nz * f.h[2];
  if (s <= 0) return v;
  s *= s; // to the 32nd power by squaring: Math.pow per pixel costs more than the rest together
  s *= s;
  s *= s;
  s *= s;
  s *= s;
  return v + (1 - v) * s * lit;
}

/**
 * 256 sRGB colours along the ramp (index 255 is its first, lightest step), blended between
 * neighbouring steps in OKLab. Banded holds each step flat, with one blended entry at each edge
 * so the bands come out antialiased.
 */
export function rampLut(steps: Oklch[], banded = false): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const n = steps.length;
  if (!n) return lut;
  const lab = steps.map(toOklab);
  const flat = steps.map(rgb255);
  const edge = (255 / Math.max(1, n - 1)) / 2;
  for (let i = 0; i < 256; i++) {
    const p = (1 - i / 255) * (n - 1);
    const k = Math.max(0, Math.min(n - 2, Math.floor(p)));
    let f = n > 1 ? p - k : 0;
    if (banded) f = clamp01((f - 0.5) * edge + 0.5);
    if (f === 0 || f === 1) {
      lut.set(flat[k + f], i * 3);
      continue;
    }
    const [a, b] = [lab[k], lab[k + 1]];
    const mixed = fromOklab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], steps[k][2]);
    lut.set(rgb255(mixed), i * 3);
  }
  return lut;
}

/** shadow on the backdrop, as opacity over the surround */
const SHADOW = 0.34;
/** how far behind the shapes the backdrop hangs, in half-widths of the picture */
const DEPTH = 0.2;

/**
 * Light `sf` with `light` and write RGBA into `out` (size² × 4). Content colours come only from
 * the ramp; the backdrop stays clear except for the shape's shadow, which is neutral black.
 */
export function shade(sf: Surface, lut: Uint8ClampedArray, light: Light, out: Uint8ClampedArray): void {
  const f = frame(light);
  const { size, normal, cover, open, blur } = sf;
  // a backdrop point is shaded when the shape covers the point on its way to the light; raking
  // light is capped, or the shadow would run off to infinity
  const lz = Math.max(f.l[2], 0.25);
  const dx = Math.round(((DEPTH * f.l[0]) / lz) * (size / 2));
  const dy = Math.round(((-DEPTH * f.l[1]) / lz) * (size / 2));
  const fade = edgeFade(size);
  for (let j = 0, p = 0; j < size; j++) {
    const sj = j + dy;
    const row = sj >= 0 && sj < size ? sj * size : -1;
    for (let i = 0; i < size; i++, p++) {
      const si = i + dx;
      const sh = row >= 0 && si >= 0 && si < size ? SHADOW * blur[row + si] * fade[i] * fade[j] : 0;
      const a = cover[p];
      const o = p * 4;
      if (a === 0) {
        out[o] = out[o + 1] = out[o + 2] = 0;
        out[o + 3] = sh * 255;
        continue;
      }
      const x = tone(normal[p * 3], normal[p * 3 + 1], normal[p * 3 + 2], open[p], f) * 255;
      const k = x >= 254 ? 254 : x | 0;
      const t = x - k;
      const q = k * 3;
      // the shape over its own shadow: premultiplied, then back
      const alpha = a + sh * (1 - a);
      const m = a / alpha;
      out[o] = (lut[q] + (lut[q + 3] - lut[q]) * t) * m;
      out[o + 1] = (lut[q + 1] + (lut[q + 4] - lut[q + 1]) * t) * m;
      out[o + 2] = (lut[q + 2] + (lut[q + 5] - lut[q + 2]) * t) * m;
      out[o + 3] = alpha * 255;
    }
  }
}

const fades = new Map<number, Float32Array>();

/** the shadow thins out toward the picture's edge instead of stopping at it */
function edgeFade(size: number): Float32Array {
  let f = fades.get(size);
  if (!f) {
    const band = size * 0.12;
    fades.set(size, (f = Float32Array.from({ length: size }, (_, i) => smooth(0, 1, Math.min(i + 0.5, size - i - 0.5) / band))));
  }
  return f;
}

// ── the shapes, in picture coordinates -1..1 (y up) ─────────────────────────────────────────────

const SPHERE_R = 0.64;
const SPHERE_Y = 0.03;

const sphere: Hit = (x, y, out) => {
  const X = x / SPHERE_R;
  const Y = (y - SPHERE_Y) / SPHERE_R;
  const d = X * X + Y * Y;
  if (d >= 1) return false;
  out[0] = X;
  out[1] = Y;
  out[2] = Math.sqrt(1 - d);
  out[3] = 1;
  return true;
};

/** half the cube's edge, and the radius its edges are rounded to (they catch a line of light) */
const CUBE_B = 0.45;
const CUBE_R = 0.045;
/** object to camera: turned 42° about the vertical, then tipped 27° to show the top */
const CUBE_M = (() => {
  const [cy, sy] = [Math.cos(42 * RAD), Math.sin(42 * RAD)];
  const [cx, sx] = [Math.cos(27 * RAD), Math.sin(27 * RAD)];
  // Rx(pitch) · Ry(yaw), row-major
  return [cy, 0, sy, sx * sy, cx, -sx * cy, -cx * sy, sx, cx * cy];
})();
const CUBE_Y = 0.02;

const cube: Hit = (x, y, out) => {
  const M = CUBE_M;
  y -= CUBE_Y;
  // the view ray (x, y, 4) + t (0, 0, -1), into the cube's own space by the transpose
  const o = [M[0] * x + M[3] * y + M[6] * 4, M[1] * x + M[4] * y + M[7] * 4, M[2] * x + M[5] * y + M[8] * 4];
  const d = [-M[6], -M[7], -M[8]];
  let near = -Infinity;
  let far = Infinity;
  for (let a = 0; a < 3; a++) {
    const t1 = (-CUBE_B - o[a]) / d[a];
    const t2 = (CUBE_B - o[a]) / d[a];
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (near > far) return false;
  // the rounded box's normal: from the inner box (shrunk by the radius) out to the hit point
  const inner = CUBE_B - CUBE_R;
  const q = [0, 1, 2].map((a) => {
    const p = o[a] + near * d[a];
    return p - Math.max(-inner, Math.min(inner, p));
  });
  const [nx, ny, nz] = norm(q[0], q[1], q[2]);
  out[0] = M[0] * nx + M[1] * ny + M[2] * nz;
  out[1] = M[3] * nx + M[4] * ny + M[5] * nz;
  out[2] = M[6] * nx + M[7] * ny + M[8] * nz;
  out[3] = 1;
  return true;
};

/** a cloth hung from a straight top, falling into two soft folds that deepen toward the hem */
const CLOTH_X = 0.64;
const CLOTH_TOP = 0.76;
const CLOTH_HEM = -0.74;
// deep enough that even a small preview spans the ramp from lit ridge to shaded valley
const CLOTH_DEPTH = 0.15;
/** the view looks down a touch, so the hem swings with the folds */
const CLOTH_TILT = 0.55;

const fold = (x: number) => {
  const u = (x / CLOTH_X + 1) / 2;
  // unequal widths, as cloth never falls evenly
  return -Math.cos(4 * Math.PI * (u + 0.05 * Math.sin(2 * Math.PI * u)));
};
const drop = (y: number) => 0.3 + 0.7 * clamp01((CLOTH_TOP - y) / (CLOTH_TOP - CLOTH_HEM));
const clothZ = (x: number, y: number) => CLOTH_DEPTH * drop(y) * fold(x);

const cloth: Hit = (x, y, out) => {
  if (x < -CLOTH_X || x > CLOTH_X) return false;
  if (y > CLOTH_TOP - CLOTH_TILT * clothZ(x, CLOTH_TOP)) return false;
  if (y < CLOTH_HEM - CLOTH_TILT * clothZ(x, CLOTH_HEM)) return false;
  const e = 1e-3;
  const zx = (clothZ(x + e, y) - clothZ(x - e, y)) / (2 * e);
  const zy = (clothZ(x, y + e) - clothZ(x, y - e)) / (2 * e);
  const [nx, ny, nz] = norm(-zx, -zy, 1);
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
  // the valleys see less of the room, most of all where the folds are deep
  out[3] = 1 - 0.4 * ((1 - fold(x)) / 2) * drop(y);
  return true;
};

const HITS: Record<Shape, Hit> = { sphere, cube, cloth };
/** subsamples per pixel side on the silhouette, for an antialiased edge */
const SS = 4;

function build(hit: Hit, size: number): Surface {
  const n = size * size;
  const normal = new Float32Array(n * 3);
  const cover = new Float32Array(n);
  const open = new Float32Array(n);
  const at = new Float64Array(4);
  const sample = (p: number, ss: number) => {
    const [i, j] = [p % size, Math.floor(p / size)];
    let [hits, nx, ny, nz, op] = [0, 0, 0, 0, 0];
    for (let b = 0; b < ss; b++) {
      for (let a = 0; a < ss; a++) {
        if (!hit(((i + (a + 0.5) / ss) / size) * 2 - 1, 1 - ((j + (b + 0.5) / ss) / size) * 2, at)) continue;
        hits++;
        nx += at[0];
        ny += at[1];
        nz += at[2];
        op += at[3];
      }
    }
    cover[p] = hits / (ss * ss);
    if (!hits) return;
    normal.set(norm(nx, ny, nz), p * 3);
    open[p] = op / hits;
  };
  for (let p = 0; p < n; p++) sample(p, 1);
  // the insides are smooth (the cube's creases are rounded), so only the silhouette needs more
  const edge = [];
  for (let p = 0; p < n; p++) {
    const c = cover[p];
    const i = p % size;
    if ((i > 0 && cover[p - 1] !== c) || (i < size - 1 && cover[p + 1] !== c) || (p >= size && cover[p - size] !== c) || (p < n - size && cover[p + size] !== c)) edge.push(p);
  }
  for (const p of edge) sample(p, SS);
  return { size, normal, cover, open, blur: blurred(cover, size, Math.max(1, Math.round(size * 0.035))) };
}

/** three box blurs each way: close to a gaussian */
function blurred(src: Float32Array, size: number, r: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 6; pass++) {
    const across = pass % 2 === 0;
    for (let line = 0; line < size; line++) {
      const at = (k: number) => (across ? line * size + k : k * size + line);
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += k >= 0 && k < size ? a[at(k)] : 0;
      for (let k = 0; k < size; k++) {
        b[at(k)] = sum / (2 * r + 1);
        const add = k + r + 1;
        const sub = k - r;
        if (add < size) sum += a[at(add)];
        if (sub >= 0) sum -= a[at(sub)];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

const surfaces = new Map<string, Surface>();

/** Built on first use and kept: the shapes never change, only the light and the ramp. */
export function surface(shape: Shape, size: number): Surface {
  const key = `${shape}:${size}`;
  let sf = surfaces.get(key);
  if (!sf) surfaces.set(key, (sf = build(HITS[shape], size)));
  return sf;
}
