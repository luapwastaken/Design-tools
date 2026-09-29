// The colour picker's maths (plan unit F): gamut edges and pixels of the L-by-C plane at one hue,
// and the RGB, HSB, HSL and ≈CMYK channel views. Pure, so it runs in tests; the renderer only draws it.
import { clampRgb, convertOklabToRgb, converter, type Rgb } from 'culori';
import { hexToOklch, inP3, inSrgb, toHex, toOklch, toSrgbGamut, type Oklch } from './index.ts';

export type Gamut = 'srgb' | 'p3';
export type Rgb255 = [number, number, number];
export type Cmyk = [number, number, number, number];
/** hue 0-360, saturation and brightness 0-100, as Photoshop and Figma show them */
export type Hsb = [number, number, number];
/** hue 0-360, saturation and lightness 0-100 */
export type Hsl = [number, number, number];

const INSIDE = { srgb: inSrgb, p3: inP3 };
/** below this chroma the hue is noise, so a picked or typed grey keeps the hue you were on */
const GREY = 5e-4;
/** opacity of a colour only Display P3 can show, drawn clipped on an sRGB screen */
const DIM = 90;

/**
 * The largest chroma inside the gamut at this L and hue. A constant-hue slice of sRGB or P3 is one
 * run from the grey axis outwards, so bisection finds its edge.
 */
export function maxChroma(l: number, h: number, gamut: Gamut): number {
  const inside = INSIDE[gamut];
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 15; i++) {
    const m = (lo + hi) / 2;
    if (inside([l, m, h])) lo = m;
    else hi = m;
  }
  return lo;
}

/** L at the middle of pixel row `y` of a plane `rows` tall (the top row is near white) */
export const rowL = (y: number, rows: number) => 1 - (y + 0.5) / rows;

export type Edges = { srgb: Float64Array; p3: Float64Array };

/** Both gamut edges, one chroma per pixel row of the plane. */
export function gamutEdges(h: number, rows: number): Edges {
  const srgb = new Float64Array(rows);
  const p3 = new Float64Array(rows);
  for (let y = 0; y < rows; y++) {
    srgb[y] = maxChroma(rowL(y, rows), h, 'srgb');
    p3[y] = maxChroma(rowL(y, rows), h, 'p3');
  }
  return { srgb, p3 };
}

/**
 * RGBA pixels of the plane at hue `h`, chroma 0..`cmax` across `w` columns. sRGB colours are
 * opaque; colours only P3 can show are clipped and dimmed; colours outside P3 stay clear.
 */
export function planePixels(h: number, w: number, rows: number, cmax: number, edges: Edges): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(w * rows * 4);
  const cos = Math.cos((h * Math.PI) / 180);
  const sin = Math.sin((h * Math.PI) / 180);
  for (let y = 0; y < rows; y++) {
    const l = rowL(y, rows);
    for (let x = 0; x < w; x++) {
      const c = ((x + 0.5) / w) * cmax;
      if (c > edges.p3[y]) break;
      const { r, g, b } = convertOklabToRgb({ l, a: c * cos, b: c * sin });
      const i = (y * w + x) * 4;
      px[i] = r * 255; // the clamped array clips a P3 colour to sRGB
      px[i + 1] = g * 255;
      px[i + 2] = b * 255;
      px[i + 3] = c <= edges.srgb[y] ? 255 : DIM;
    }
  }
  return px;
}

/** Round a chroma up to the next plane axis step. */
export const axisCeil = (c: number, step = 0.05) => Math.ceil(c / step - 1e-9) * step;

/**
 * The plane's chroma axis at this hue: P3's widest point rounded up to a 0.05 step, so every hue
 * fills the plane, capped at the C field's 0.4. It depends on the hue only, so it never moves
 * during a plane drag.
 */
export function planeAxis(h: number): number {
  let widest = 0;
  for (let i = 1; i < 64; i++) widest = Math.max(widest, maxChroma(i / 64, h, 'p3'));
  return Math.min(0.4, axisCeil(widest));
}

const keepHue = (o: Oklch, hue: number): Oklch => (o[1] < GREY ? [o[0], o[1], hue] : o);

/**
 * The same colour as far as a picker can tell: the same hex, and for a grey the same stored hue,
 * which the hex can't show (so an undone hue drag on a grey reads as a change).
 */
export function sameColour(a: Oklch, b: Oklch): boolean {
  if (toHex(a) !== toHex(b)) return false;
  return (a[1] >= GREY && b[1] >= GREY) || Math.abs(((a[2] - b[2] + 540) % 360) - 180) < 0.5;
}

/** A hex to OKLCH; a grey keeps `hue`, so the plane doesn't jump to red. */
export const fromHex = (hex: string, hue: number): Oklch => keepHue(hexToOklch(hex), hue);

export { rgb255 } from './index.ts';

export const fromRgb255 = ([r, g, b]: Rgb255, hue: number): Oklch =>
  keepHue(toOklch({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 }, hue), hue);

/** The inverse of `cmykEstimate`'s naive formula (0-100 each), through sRGB. */
export function fromCmyk([c, m, y, k]: Cmyk, hue: number): Oklch {
  const ink = (v: number) => (1 - v / 100) * (1 - k / 100);
  return keepHue(toOklch({ mode: 'rgb', r: ink(c), g: ink(m), b: ink(y) }, hue), hue);
}

// ── HSB and HSL: the Square, Wheel and Sliders styles work in sRGB ──

const toRgb = converter('rgb');
const toHsv = converter('hsv');
const toHsl = converter('hsl');

/** the sRGB colour the hex shows (gamut mapped), unrounded, so typed and dragged values stay put */
function shown(o: Oklch): Rgb {
  const [l, c, h] = toSrgbGamut(o);
  return clampRgb(toRgb({ mode: 'oklch', l, c, h }));
}

/**
 * The OKLCH hue a near-grey of this HSB hue leans to. Near grey the mapping runs once round the
 * circle as the HSB hue does (the pure colours' OKLCH hues fold back near blue), so it inverts.
 */
const leanHue = (h: number) => toOklch({ mode: 'hsv', h, s: 0.01, v: 1 })[2];
const RED = leanHue(0);
/** an OKLCH hue as a turn from red's lean, 0..360 */
const fromRed = (h: number) => (((h - RED) % 360) + 360) % 360;

/**
 * The HSB hue a grey shows. A grey has no HSB hue of its own: this is the one its stored OKLCH hue
 * stands for, so a grey made on the square opens where it was made.
 */
export function hsbHue(okHue: number): number {
  // a hue of exactly 0 was never chosen (a hex or imported grey carries no hue): it opens at red, as elsewhere
  if (okHue === 0) return 0;
  const want = fromRed(okHue);
  let lo = 0;
  let hi = 360;
  for (let i = 0; i < 32; i++) {
    const m = (lo + hi) / 2;
    if (fromRed(leanHue(m)) < want) lo = m;
    else hi = m;
  }
  return ((lo + hi) / 2) % 360;
}

/** a grey from HSB or HSL keeps the OKLCH hue its HSB hue stands for */
const fromSrgbModel = (c: Parameters<typeof toOklch>[0], hue: number): Oklch => keepHue(toOklch(c), leanHue(hue));
/** below this spread of the channels (0-1) the sRGB hue and saturation are float noise */
const FLAT = 1e-6;

/** HSV or HSL of what the screen shows; a grey takes the hue its OKLCH hue stands for, and no saturation */
function srgbModel(o: Oklch, read: (rgb: Rgb) => [number | undefined, number, number]): [number, number, number] {
  const rgb = shown(o);
  const [h, s, third] = read(rgb);
  const flat = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) < FLAT;
  return [h === undefined || flat || o[1] < GREY ? hsbHue(o[2]) : h, flat ? 0 : s * 100, third * 100];
}

/** HSB of what the screen shows; a colour outside sRGB reads as its clipped colour. */
export const hsbOf = (o: Oklch): Hsb =>
  srgbModel(o, (c) => {
    const { h, s, v } = toHsv(c);
    return [h, s, v];
  });

export const fromHsb = ([h, s, b]: Hsb): Oklch => fromSrgbModel({ mode: 'hsv', h, s: s / 100, v: b / 100 }, h);

/** HSL of what the screen shows; a colour outside sRGB reads as its clipped colour. */
export const hslOf = (o: Oklch): Hsl =>
  srgbModel(o, (c) => {
    const { h, s, l } = toHsl(c);
    return [h, s, l];
  });

export const fromHsl = ([h, s, l]: Hsl): Oklch => fromSrgbModel({ mode: 'hsl', h, s: s / 100, l: l / 100 }, h);
