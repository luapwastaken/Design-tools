// The lit preview's maths (plan unit P). Each shape is worked out once per size as a buffer of
// surface normals; a frame is then one pass that lights them and looks the result up in the ramp,
// so dragging the light costs a few milliseconds. Pure, so it runs in tests.
//
// The picture is the ramp's: how lit a point is picks a colour from the ramp's own steps. Only the
// colours light does that no step holds (a glow through thin cloth, light bounced off the surround,
// a whitened highlight) come from three small tables built from the ramp (see `lookOf`), and the
// tab offers them to the palette. What decides how lit a point is follows the material (see
// finish.ts): how wide the terminator is, the highlight, sheen, grain, light through the surface.
import { rgb255, type Oklch } from '../../../shared/color/index.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import { fitChroma, fromOklab, toOklab, wrapHue } from '../../../shared/palette/space.ts';
import type { MaterialId, SurfaceSpec } from '../../../shared/types.ts';
import { CLOTHS, type Fold } from './cloth.ts';
import { DEFAULT_FINISH, finishOf, type Finish } from './finish.ts';

export type Shape = 'sphere' | 'cube' | 'cloth';

/**
 * Degrees. Azimuth runs clockwise from straight up in the picture (315 is the upper left);
 * elevation from the picture plane (0, raking light) to the viewer (90, flat front light), and on
 * past the plane to -90, light from straight behind the object.
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
  /** how much material light would cross here, 0 (a thin sheet) to 1: the sphere's rim is thin, its middle is not */
  thick: Float32Array;
  /** the share of the shape that is thin: how pale and tinted its shadow gets */
  thin: number;
  /** how far the surface stands toward the viewer, in picture units; only the cloth has one */
  height: Float32Array | null;
  horizons?: Horizons;
};

type V3 = [number, number, number];
/** normal x, y, z, openness, thickness and height of the surface at a point, or false for a miss */
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

// ── a light position, and what it needs per pixel ───────────────────────────────────────────────

/** entries of the highlight tables, indexed by sqrt(1 - n.h) so a tight highlight still has many of them */
const LOBE = 1023;
/** the sky and the ground a shiny surface reflects, as how lit they are */
const SKY = 0.8;
/** a streak is stretched by using this share of the highlight's exponent across it */
const STREAK = 0.14;

/** What one light position and finish need per pixel: the light, the half vector, the highlight tables. */
export type Frame = {
  l: V3;
  h: V3;
  /** degrees above the picture plane (negative: behind it) and round the picture */
  elev: number;
  az: number;
  fin: Finish;
  /** the terminator's window over n.l, and how far its diffuse light wraps past it */
  lo: number;
  hi: number;
  wrap: number;
  /** twice the ambient: 1 is the default fill */
  amb: number;
  /** the highlight's strength, its table (n.h to the exponent) and the streak's */
  amp: number;
  lobe: Float32Array;
  streak: Float32Array;
  /** the way the fibres run in the picture; the highlight is stretched across them (so along the folds when they run across) */
  axis: [number, number];
  /** a dielectric's edge reflection */
  fres: number;
  /** how blurred the horizon a shiny surface reflects is, and how lit the ground is */
  blur: number;
  ground: number;
  /** how far the bounce takes the surround's colour (0 with no surround to take it from) */
  tint: number;
  /** transmission: how much of the light goes through, and how much of that shows with the light in front */
  through: number;
  back: number;
};

const lobes = new Map<number, Float32Array>();
/** n.h ^ e at LOBE+1 points of sqrt(1 - n.h); cached by exponent (a drag changes the light, not the gloss) */
function lobe(e: number): Float32Array {
  const key = Math.round(e * 4);
  let t = lobes.get(key);
  if (!t) {
    if (lobes.size > 64) lobes.clear();
    lobes.set(key, (t = Float32Array.from({ length: LOBE + 1 }, (_, i) => (1 - (i / LOBE) ** 2) ** (key / 4))));
  }
  return t;
}

/**
 * `ground`: how lit the surround is, for what a shiny surface reflects below the horizon;
 * `tint`: whether the bounce takes the surround's colour.
 */
export function frame(light: Light, fin: Finish = DEFAULT_FINISH, ground = 0.28, tint = 0): Frame {
  const l = direction(light);
  const hh = norm(l[0], l[1], l[2] + 1);
  // straight behind the object there is no half vector toward the viewer: the highlight has nowhere to be
  const h: V3 = l[2] < -0.98 ? [0, 0, 1] : hh;
  const e = 3 + 520 * fin.gloss ** 3;
  const soft = fin.softness;
  return {
    l,
    h,
    elev: light.elevation,
    az: ((light.azimuth % 360) + 360) % 360,
    fin,
    lo: -0.06 - 0.55 * soft,
    hi: 0.22 + 0.2 * soft,
    wrap: 0.5 * soft,
    amb: 2 * fin.ambient,
    amp: Math.min(1, 2.2 * fin.gloss),
    lobe: lobe(e),
    streak: lobe(Math.max(2, e * STREAK)),
    axis: fin.across ? [0, 1] : [1, 0],
    fres: fin.gloss * (1 - fin.metal),
    blur: 0.12 + 0.5 * (1 - fin.gloss),
    ground,
    tint,
    through: Math.min(1, 1.8 * fin.translucency),
    back: 0.12 + 0.88 * smooth(0.1, -0.35, l[2]),
  };
}

/** what `lightPixel` works out */
const S = new Float64Array(5);
const TONE = 0;
const GLOW = 1;
const GLOW_TONE = 2;
const BOUNCE = 3;
const SHINE = 4;

/**
 * How lit a point is, 0 (the ramp's deepest shadow) to 1 (its highlight), in the painter's order:
 * lit planes and halftone on the light side, a terminator as soft as the material's, the core
 * shadow just past it, reflected light from sky and ground lifting the far edge, and the highlight.
 * Also in `S`: how much light comes through and how lit that is, how much bounce takes the
 * surround's colour, and how much of the highlight is the light's own colour. `selfF` and `selfB`
 * are how much of the light reaches the surface from the front and from behind (the folds shade
 * each other).
 */
function lightPixel(nx: number, ny: number, nz: number, open: number, thick: number, selfF: number, selfB: number, f: Frame): void {
  const { fin } = f;
  const ndl = nx * f.l[0] + ny * f.l[1] + nz * f.l[2];
  const lit = smooth(f.lo, f.hi, ndl) * selfF;
  // eased, so the planes turned to the light and the halftone share the lit side about evenly
  const wd = (ndl + f.wrap) / (1 + f.wrap);
  const d = wd > 0 ? wd : 0;
  const lightSide = (0.34 + 0.52 * d * (0.7 + 0.3 * d)) * (0.75 + 0.25 * open);
  // the room: sky above, the ground's bounce below, held back by the folds around it
  const sky = 0.5 + 0.5 * ny;
  const down = 1 - sky;
  const fill = f.amb * (0.07 + 0.06 * sky + 0.2 * down);
  // the core shadow is where the lit side ends; the room lifts the shadow again from there
  const shadowSide = ndl < f.lo ? fill * open * smooth(f.lo, f.lo - 0.2, ndl) : 0;
  let v = shadowSide + (lightSide - shadowSide) * lit;

  // what a shiny surface reflects: sky over a horizon, the ground under it
  const ry = 2 * nz * ny;
  let env = 0;
  if (fin.metal > 0 || f.fres > 0.02) env = f.ground + (SKY - f.ground) * smooth(-f.blur, f.blur, ry) + 0.12 * ry;
  if (fin.metal > 0) v += (env * (0.62 + 0.38 * lit) - v) * 0.9 * fin.metal;
  if (f.fres > 0.02) {
    const x = nz > 0 ? 1 - nz : 1;
    const x2 = x * x;
    v += (env - v) * (0.04 + 0.96 * x2 * x2 * x) * f.fres;
  }
  // sheen: a glow at grazing angles over a darker body
  if (fin.sheen > 0) {
    const x = 1 - nz;
    v = v * (1 - 0.3 * fin.sheen * nz * nz) + (1 - v) * fin.sheen * x * x * (0.5 + 0.5 * smooth(-0.4, 0.3, ndl)) * 0.9;
  }

  // the highlight: round, or stretched into a streak by the grain
  let sp = 0;
  const nh = nx * f.h[0] + ny * f.h[1] + nz * f.h[2];
  if (nh > 0) {
    sp = f.lobe[(Math.sqrt(nh < 1 ? 1 - nh : 0) * LOBE) | 0];
    if (fin.grain > 0.01) {
      // Kajiya-Kay: the highlight follows the angle between the grain and the half vector
      const an = f.axis[0] * nx + f.axis[1] * ny;
      const den = 1 - an * an;
      if (den > 1e-4) {
        const th = (f.axis[0] * f.h[0] + f.axis[1] * f.h[1] - an * nh) / Math.sqrt(den);
        const sn = 1 - th * th;
        const aniso = f.streak[(Math.sqrt(1 - (sn > 0 ? Math.sqrt(sn) : 0)) * LOBE) | 0] * smooth(0.25, 0.8, nh);
        sp += (aniso - sp) * fin.grain;
      }
    }
  }
  const shine = sp * f.amp * smooth(0, 0.12, ndl) * selfF;
  v += (1 - v) * shine;

  // light through: a thin sheet with the light behind it glows, and the more the thinner it is
  let wg = 0;
  let tg = 0;
  if (f.through > 0) {
    const toward = ndl < 0 ? -ndl : 0;
    const trf = ndl < 0 ? 0.4 + 0.6 * toward : 0.5 * (1 - smooth(0, 0.35 + 0.3 * fin.softness, ndl));
    wg = f.through * trf * (1 - 0.85 * thick) * f.back * (ndl < 0 ? selfB : 1);
    tg = 0.38 + 0.55 * (toward * (0.35 + 0.65 * f.back) + 0.22 * (ndl < 0 ? 0 : 1 - smooth(0, 0.5, ndl)));
    v *= 1 - 0.4 * wg;
  }

  S[TONE] = v < 0 ? 0 : v > 1 ? 1 : v;
  S[GLOW] = wg;
  S[GLOW_TONE] = tg > 1 ? 1 : tg;
  S[BOUNCE] = f.tint > 0 ? Math.min(0.7, f.amb * 0.8 * down * (1 - lit)) * f.tint : 0;
  S[SHINE] = shine * (1 - fin.metal);
}

/**
 * How lit a point is, as `lightPixel` works it out (the finish decides the terminator, the highlight
 * and the rest), with the glow and bounce left out: the tone the ramp is read at.
 */
export function tone(nx: number, ny: number, nz: number, open: number, f: Frame): number {
  lightPixel(nx, ny, nz, open, 1, 1, 1, f);
  return S[TONE];
}

/** how much light comes through at a point (0 to 1), and how lit that glow is */
export function transmission(nx: number, ny: number, nz: number, open: number, thick: number, f: Frame): [number, number] {
  lightPixel(nx, ny, nz, open, thick, 1, 1, f);
  return [S[GLOW], S[GLOW_TONE]];
}

// ── the ramp, and the colours light adds to it ──────────────────────────────────────────────────

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

/** What the picture is lit from: the ramp, the material and the surround. */
export type LookIn = {
  steps: Oklch[];
  material: MaterialId;
  /** the ramp's light colour: the glow and the highlight lean toward it */
  light: Oklch;
  surface?: SurfaceSpec;
  banded?: boolean;
  /** the colour the object sits on, or null for none (the bounce keeps the ramp's colours) */
  surround?: Oklch | null;
};

/** A ramp ready to light: its colours, the three tables of what light adds, and its finish. */
export type Look = {
  finish: Finish;
  banded: boolean;
  /** how many steps the ramp has */
  steps: number;
  lut: Uint8ClampedArray;
  /** the ramp as light coming through it: lighter and richer, toward the warm of the material or the light colour */
  glow: Uint8ClampedArray;
  /** the ramp as light bounced off the surround takes its colour */
  bounce: Uint8ClampedArray;
  /** a dielectric's highlight: the light colour, near white */
  spec: [number, number, number];
  /** how lit the ground a shiny surface reflects is, and whether the bounce has a surround to take its colour from */
  ground: number;
  tinted: boolean;
};

/** subsurface light turns toward this hue: red-orange, the colour light picks up inside skin or a leaf */
const WARM = 40;
/** a light colour with less chroma than this has no hue to turn toward */
const HUED = 0.04;

/** the short way round, `f` of the way from `a` to `b` */
const turn = (a: number, b: number, f: number): number => wrapHue(a + ((((b - a) % 360) + 540) % 360 - 180) * f);

export function lookOf(i: LookIn): Look {
  const banded = !!i.banded;
  const sub = MATERIALS.find((m) => m.id === i.material)?.sub ?? 0;
  const finish = finishOf(i.material, i.surface);
  // light through the material is richer than light off it, and turns toward the warm inside a skin or a leaf, or the light's own colour
  const warm = sub >= 0.25;
  const target = warm ? WARM : i.light[1] >= HUED ? i.light[2] : null;
  const amount = warm ? 0.35 + 0.3 * sub : 0.3;
  const glow = i.steps.map(([l, c, h]): Oklch => fitChroma([l + (1 - l) * 0.16, c * 1.4 + 0.015, target === null ? h : turn(h, target, amount)]));
  const s = i.surround ? toOklab(i.surround) : null;
  // light bounced off a surround arrives in its colour: the same lightness, the surround's hue and chroma part of the way
  const bounce = s
    ? i.steps.map((c): Oklch => {
        const [l, a, b] = toOklab(c);
        return fromOklab([l, a + (s[1] - a) * 0.55, b + (s[2] - b) * 0.55], c[2]);
      })
    : i.steps;
  const spec = rgb255(fitChroma([0.97, Math.min(i.light[1], 0.03), i.light[2]]));
  return {
    finish,
    banded,
    steps: i.steps.length,
    lut: rampLut(i.steps, banded),
    glow: rampLut(glow, banded),
    bounce: rampLut(bounce, banded),
    spec,
    ground: i.surround ? 0.1 + 0.35 * i.surround[0] : 0.28,
    tinted: !!s,
  };
}

/** a Look of the ramp with a finish of no particular material: what the preview was before materials */
export function plainLook(steps: Oklch[], banded = false): Look {
  return { ...lookOf({ steps, material: 'cloth', light: [0.95, 0, 0], banded }), finish: DEFAULT_FINISH };
}

// ── self-shadowing: the folds of the cloth shade each other ─────────────────────────────────────

/** per pixel, the angle (degrees above the picture plane) at which the cloth stops hiding the light, from 8 azimuths round */
export type Horizons = { front: Uint8Array; back: Uint8Array };
const AZIMUTHS = 8;
/** distances (in 1/560 of the picture) the horizon is marched out to */
const REACH = Array.from({ length: 16 }, (_, k) => 1.5 * 1.3 ** k);

/**
 * For each pixel of a height field, how high the cloth around it stands in each of 8 directions: a
 * light lower than that behind the folds is blocked. `front` looks for ridges toward the viewer
 * (light in front of the cloth); `back` for ridges toward the wall (light behind it: the light
 * crosses another layer before it reaches this one).
 */
export function horizonsOf(sf: Surface): Horizons {
  if (sf.horizons) return sf.horizons;
  const { size, cover, height } = sf;
  const n = size * size;
  const front = new Uint8Array(AZIMUTHS * n);
  const back = new Uint8Array(AZIMUTHS * n);
  if (height) {
    for (let k = 0; k < AZIMUTHS; k++) {
      const dx = Math.sin((k * 360 * RAD) / AZIMUTHS);
      const dy = -Math.cos((k * 360 * RAD) / AZIMUTHS);
      for (let p = 0; p < n; p++) {
        if (cover[p] < 0.5) continue;
        const [i, j] = [p % size, (p / size) | 0];
        const z0 = height[p];
        let up = 0;
        let down = 0;
        for (const r of REACH) {
          const [x, y] = [Math.round(i + dx * r * (size / 560)), Math.round(j + dy * r * (size / 560))];
          if (x < 0 || y < 0 || x >= size || y >= size) break;
          const q = y * size + x;
          if (cover[q] < 0.5) continue;
          const slope = (height[q] - z0) / (r * (size / 560) * (2 / size));
          if (slope > up) up = slope;
          else if (-slope > down) down = -slope;
        }
        front[k * n + p] = Math.min(90, Math.atan(up) / RAD);
        back[k * n + p] = Math.min(90, Math.atan(down) / RAD);
      }
    }
  }
  return (sf.horizons = { front, back });
}

// ── a frame ─────────────────────────────────────────────────────────────────────────────────────

/** shadow on the backdrop, as opacity over the surround */
const SHADOW = 0.34;
/** how far behind the shapes the backdrop hangs, in half-widths of the picture */
const DEPTH = 0.2;

/** what a frame found, for the bar of how much of the object each step has and for the colours light adds */
export type Stats = {
  /** the object's area, in pixels */
  total: number;
  /** per step, the area it fills; the glow is counted apart */
  steps: Float64Array;
  /** per entry of the glow and bounce tables, the area weighted by how much of it shows */
  glow: Float64Array;
  bounce: Float64Array;
  /** the highlight whitened by the light colour: area, weighted */
  shine: number;
};

export const newStats = (): Stats => ({ total: 0, steps: new Float64Array(9), glow: new Float64Array(256), bounce: new Float64Array(256), shine: 0 });

/** the step a tone is nearest to: 0 is the lightest */
const stepAt = (tone: number, n: number) => Math.max(0, Math.min(n - 1, Math.round((1 - tone) * (n - 1))));

/** the lower and upper horizon slice of an azimuth, and how far between them */
function slices(az: number): [number, number, number] {
  const x = az / (360 / AZIMUTHS);
  const k = Math.floor(x) % AZIMUTHS;
  return [k, (k + 1) % AZIMUTHS, x - Math.floor(x)];
}

/** how much of the light gets past the folds at a pixel, from the front and from behind (set by `reach`) */
let reachF = 1;
let reachB = 1;
function reach(hz: Horizons, n: number, p: number, s: [number, number, number], elev: number): void {
  const [k0, k1, w] = s;
  reachF = reachB = 1;
  if (elev > 0) {
    const [a, b] = [hz.front[k0 * n + p], hz.front[k1 * n + p]];
    reachF = smooth(-2.5, 2.5, elev - (a + (b - a) * w));
  } else {
    const [a, b] = [hz.back[k0 * n + p], hz.back[k1 * n + p]];
    reachB = smooth(-2.5, 2.5, -elev - (a + (b - a) * w));
  }
}

/** how thick a cast shadow is and the colour it takes: black for an opaque shape, paler and the glow's colour for a thin one */
function shadowOf(look: Look, f: Frame, sf: Surface): { alpha: number; rgb: [number, number, number] } {
  const t = f.through * sf.thin;
  const mid = 128 * 3;
  const [r, g, b] = [look.glow[mid], look.glow[mid + 1], look.glow[mid + 2]];
  return { alpha: SHADOW * (1 - 0.7 * t), rgb: [r * t, g * t, b * t] };
}

/**
 * Light `sf` with `light` and write RGBA into `out` (size² × 4). Content colours come from the ramp
 * and what light adds to it; the backdrop stays clear except for the shape's shadow, which is
 * neutral black for an opaque shape and thinner and tinted for a translucent one. Behind the
 * object there is no backdrop for it to fall on. `stats` takes what the frame found.
 */
export function shade(sf: Surface, look: Look, light: Light, out: Uint8ClampedArray, stats?: Stats): void {
  const f = frame(light, look.finish, look.ground, look.tinted ? 1 : 0);
  const { size, normal, cover, open, blur, thick } = sf;
  const { lut, glow, bounce, spec, banded } = look;
  const hz = sf.height && (f.through > 0 || f.elev > 0) ? horizonsOf(sf) : null;
  reachF = reachB = 1;
  const sl = slices(f.az);
  const n = size * size;
  // a backdrop point is shaded when the shape covers the point on its way to the light; raking
  // light is capped, or the shadow would run off to infinity
  const lz = Math.max(f.l[2], 0.25);
  const dx = Math.round(((DEPTH * f.l[0]) / lz) * (size / 2));
  const dy = Math.round(((-DEPTH * f.l[1]) / lz) * (size / 2));
  const fade = edgeFade(size);
  const cast = shadowOf(look, f, sf);
  // a light behind the picture plane throws its shadow toward the viewer, where there is no backdrop
  const onWall = smooth(-0.05, 0.12, f.l[2]);
  const hard = (w: number) => (banded ? (w > 0.5 ? 1 : 0) : w);
  for (let j = 0, p = 0; j < size; j++) {
    const sj = j + dy;
    const row = sj >= 0 && sj < size ? sj * size : -1;
    for (let i = 0; i < size; i++, p++) {
      const si = i + dx;
      const sh = row >= 0 && si >= 0 && si < size ? cast.alpha * onWall * blur[row + si] * fade[i] * fade[j] : 0;
      const a = cover[p];
      const o = p * 4;
      if (a === 0) {
        out[o] = cast.rgb[0];
        out[o + 1] = cast.rgb[1];
        out[o + 2] = cast.rgb[2];
        out[o + 3] = sh * 255;
        continue;
      }
      if (hz) reach(hz, n, p, sl, f.elev);
      lightPixel(normal[p * 3], normal[p * 3 + 1], normal[p * 3 + 2], open[p], thick[p], reachF, reachB, f);
      const x = S[TONE] * 255;
      const k = x >= 254 ? 254 : x | 0;
      const t = x - k;
      const q = k * 3;
      let r = lut[q] + (lut[q + 3] - lut[q]) * t;
      let g = lut[q + 1] + (lut[q + 4] - lut[q + 1]) * t;
      let b = lut[q + 2] + (lut[q + 5] - lut[q + 2]) * t;
      const bw = hard(S[BOUNCE]);
      if (bw > 0.02) {
        r += (bounce[q] + (bounce[q + 3] - bounce[q]) * t - r) * bw;
        g += (bounce[q + 1] + (bounce[q + 4] - bounce[q + 1]) * t - g) * bw;
        b += (bounce[q + 2] + (bounce[q + 5] - bounce[q + 2]) * t - b) * bw;
      }
      const sw = hard(S[SHINE] * 0.6);
      if (sw > 0.02) {
        r += (spec[0] - r) * sw;
        g += (spec[1] - g) * sw;
        b += (spec[2] - b) * sw;
      }
      const wg = hard(S[GLOW]);
      let gi = 0;
      if (wg > 0.02) {
        const y = S[GLOW_TONE] * 255;
        gi = y >= 254 ? 254 : y | 0;
        const u = y - gi;
        const w = gi * 3;
        r += (glow[w] + (glow[w + 3] - glow[w]) * u - r) * wg;
        g += (glow[w + 1] + (glow[w + 4] - glow[w + 1]) * u - g) * wg;
        b += (glow[w + 2] + (glow[w + 5] - glow[w + 2]) * u - b) * wg;
      }
      if (stats) {
        stats.total += a;
        if (S[GLOW] >= 0.5) stats.glow[gi] += a * S[GLOW];
        else stats.steps[stepAt(S[TONE], look.steps)] += a;
        if (S[BOUNCE] > 0.05) stats.bounce[k] += a * S[BOUNCE];
        if (S[SHINE] > 0.05) stats.shine += a * S[SHINE];
      }
      // the shape over its own shadow: premultiplied, then back
      const alpha = a + sh * (1 - a);
      const m = a / alpha;
      out[o] = r * m + cast.rgb[0] * (1 - m);
      out[o + 1] = g * m + cast.rgb[1] * (1 - m);
      out[o + 2] = b * m + cast.rgb[2] * (1 - m);
      out[o + 3] = alpha * 255;
    }
  }
}

/** what one pixel of the picture reads as: a step of the ramp, a colour light added, or the cast shadow */
export type Reading = { kind: 'step'; step: number; of: number } | { kind: 'glow' | 'bounce' | 'shine' | 'shadow' | 'none' };

/** Which step of the ramp the pixel (x, y) of `sf` reads, under `light`: the same maths as `shade`. */
export function read(sf: Surface, look: Look, light: Light, x: number, y: number): Reading {
  if (x < 0 || y < 0 || x >= sf.size || y >= sf.size) return { kind: 'none' };
  const p = Math.floor(y) * sf.size + Math.floor(x);
  if (sf.cover[p] < 0.5) return { kind: 'none' };
  const f = frame(light, look.finish, look.ground, look.tinted ? 1 : 0);
  const hz = sf.height && (f.through > 0 || f.elev > 0) ? horizonsOf(sf) : null;
  if (hz) reach(hz, sf.size * sf.size, p, slices(f.az), f.elev);
  else reachF = reachB = 1;
  lightPixel(sf.normal[p * 3], sf.normal[p * 3 + 1], sf.normal[p * 3 + 2], sf.open[p], sf.thick[p], reachF, reachB, f);
  if (S[GLOW] >= 0.5) return { kind: 'glow' };
  if (S[SHINE] >= 0.5) return { kind: 'shine' };
  return { kind: 'step', step: stepAt(S[TONE], look.steps), of: look.steps };
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
  // the way through a ball is long in the middle and short at its rim
  out[4] = out[2];
  out[5] = 0;
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
  // a block: the way through is far, a little less at its edges
  out[4] = 0.85;
  out[5] = 0;
  return true;
};

/** the view looks down a touch, so the hem swings with the folds */
const CLOTH_TILT = 0.55;

function clothHit(fold: Fold): Hit {
  const c = CLOTHS[fold];
  return (x, y, out) => {
    if (x < -c.xmax || x > c.xmax) return false;
    if (y > c.top(x) - CLOTH_TILT * c.z(x, c.top(x))) return false;
    if (y < c.hem(x) - CLOTH_TILT * c.z(x, c.hem(x))) return false;
    const e = 1e-3;
    const zx = (c.z(x + e, y) - c.z(x - e, y)) / (2 * e);
    const zy = (c.z(x, y + e) - c.z(x, y - e)) / (2 * e);
    const [nx, ny, nz] = norm(-zx, -zy, 1);
    out[0] = nx;
    out[1] = ny;
    out[2] = nz;
    out[3] = c.open(x, y);
    // a sheet, doubled where it gathers
    out[4] = 0.9 * (1 - out[3]);
    out[5] = c.z(x, y);
    return true;
  };
}

const HITS: Record<Shape, Hit> = { sphere, cube, cloth: clothHit('curtain') };
/** subsamples per pixel side on the silhouette, for an antialiased edge */
const SS = 4;

function build(hit: Hit, size: number, cloth: boolean): Surface {
  const n = size * size;
  const normal = new Float32Array(n * 3);
  const cover = new Float32Array(n);
  const open = new Float32Array(n);
  const thick = new Float32Array(n);
  const height = cloth ? new Float32Array(n) : null;
  const at = new Float64Array(6);
  const sample = (p: number, ss: number) => {
    const [i, j] = [p % size, Math.floor(p / size)];
    let [hits, nx, ny, nz, op, th, hg] = [0, 0, 0, 0, 0, 0, 0];
    for (let b = 0; b < ss; b++) {
      for (let a = 0; a < ss; a++) {
        if (!hit(((i + (a + 0.5) / ss) / size) * 2 - 1, 1 - ((j + (b + 0.5) / ss) / size) * 2, at)) continue;
        hits++;
        nx += at[0];
        ny += at[1];
        nz += at[2];
        op += at[3];
        th += at[4];
        hg += at[5];
      }
    }
    cover[p] = hits / (ss * ss);
    if (!hits) return;
    normal.set(norm(nx, ny, nz), p * 3);
    open[p] = op / hits;
    thick[p] = th / hits;
    if (height) height[p] = hg / hits;
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
  let [area, mass] = [0, 0];
  for (let p = 0; p < n; p++) {
    area += cover[p];
    mass += cover[p] * thick[p];
  }
  const thin = area ? 1 - mass / area : 0;
  return { size, normal, cover, open, thick, thin, height, blur: blurred(cover, size, Math.max(1, Math.round(size * 0.035))) };
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

/** Built on first use and kept: the shapes never change, only the light and the ramp. `fold` is the cloth's drape. */
export function surface(shape: Shape, size: number, fold: Fold = 'curtain'): Surface {
  const key = shape === 'cloth' ? `cloth:${fold}:${size}` : `${shape}:${size}`;
  let sf = surfaces.get(key);
  if (!sf) surfaces.set(key, (sf = build(shape === 'cloth' ? clothHit(fold) : HITS[shape], size, shape === 'cloth')));
  return sf;
}
