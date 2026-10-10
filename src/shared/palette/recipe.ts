// Layer recipe: the blend layers that shade a set of flat colours the way a digital illustrator does it
// (Multiply for shadow, Add or Screen for light, Overlay for mood, an Add rim), each with an exact colour
// and opacity to type into Krita, Clip Studio or Procreate. Pure, so it is unit tested. The flats are the
// palette's ramp bases and the targets are each ramp's own steps; everything below is the solving.
//
// All blending is per channel on 0..1 values, then mixed by opacity: out = B + (f(B, L) - B) * a.
// By default the channels are the gamma-encoded sRGB values (what an 8-bit sRGB document in Krita,
// Clip Studio or Procreate blends); `space: 'linear'` blends in linear light instead, so the difference
// can be seen. Every layer's result is rounded to 8 bits, as an 8-bit document does.
import { hexToOklch, parseHex, type Oklch } from '../color/index.ts';
import { valueOf } from '../color/value.ts';
import type { MaterialId, RampSpec } from '../types.ts';
import { generateRamp } from './ramp.ts';
import { toOklab } from './space.ts';

export type Rgb = [number, number, number];
export type Oklab = [number, number, number];
export type Space = 'srgb' | 'linear';
export type Mode = 'multiply' | 'screen' | 'add' | 'overlay';
export type LightPair = { light: Oklch; shadow: Oklch };

export const MODE_NAME: Record<Mode, string> = { multiply: 'Multiply', screen: 'Screen', add: 'Add (Linear Dodge)', overlay: 'Overlay' };

/**
 * A flat is "visibly off" its target past this OKLab distance. One just-noticeable difference in
 * OKLab is about 0.02, and two flats side by side start to read as different colours at about
 * two and a half of those, so 0.05 is where a person would say "that is not the colour I wanted".
 */
export const OFF = 0.05;
/** under this the fit reads as "close": about a just-noticeable difference and a half */
export const CLOSE = 0.03;
/** a flat that matters most counts this many times over in the solve */
export const STAR_WEIGHT = 3;

// ── colour plumbing ───────────────────────────────────────────────────────────────────────────

export const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const fromLinear = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float64Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

export const hexRgb = (hex: string): Rgb => {
  const h = parseHex(hex);
  if (!h) throw new TypeError(`Not a hex colour: "${hex}"`);
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
};
export const rgbHex = (c: ArrayLike<number>): string => '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/** OKLab of gamma-encoded sRGB (0..1 per channel) */
export function srgbToOklab(r: number, g: number, b: number): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** gamma-encoded sRGB (0..1, may fall outside it) of an OKLCH colour */
export function oklchToSrgb(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

const inGamut = (c: Rgb): boolean => c.every((v) => v >= -0.0005 && v <= 1.0005);
const dist = (a: Oklab, b: Oklab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const hexOf = (c: Oklch): string => rgbHex(oklchToSrgb(c[0], c[1], c[2]).map((v) => clamp(Math.round(v * 255), 0, 255)));

// ── blending ──────────────────────────────────────────────────────────────────────────────────

/** one channel, B (below) and L (the layer's colour), both 0..1 */
export function blendChannel(mode: Mode, b: number, l: number): number {
  switch (mode) {
    case 'multiply':
      return b * l;
    case 'screen':
      return 1 - (1 - b) * (1 - l);
    case 'add':
      return Math.min(1, b + l);
    case 'overlay':
      return b < 0.5 ? 2 * b * l : 1 - 2 * (1 - b) * (1 - l);
  }
}

/** B shaded by a layer at opacity `a` (0..1), unrounded, channels 0..1 gamma-encoded */
export function blendRgb(mode: Mode, B: Rgb, L: Rgb, a: number, space: Space = 'srgb'): Rgb {
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const b = space === 'srgb' ? B[i] : toLinear(B[i]);
    const l = space === 'srgb' ? L[i] : toLinear(L[i]);
    const v = b + (blendChannel(mode, b, l) - b) * a;
    out[i] = space === 'srgb' ? v : fromLinear(v);
  }
  return out;
}

/**
 * Composites one layer onto pixel `i` of `buf` (RGB(A) bytes, 4 per pixel when `stride` is 4),
 * rounding to 8 bits as an 8-bit document does. `cov` (0..1) is how much of the pixel the layer's
 * shape covers. The one place the blend happens: the preview, the tests and the solver's
 * final numbers all go through it.
 */
export function compositeAt(buf: { [k: number]: number }, i: number, L: Rgb, mode: Mode, pct: number, space: Space = 'srgb', cov = 1): void {
  const a = (pct / 100) * cov;
  for (let c = 0; c < 3; c++) {
    const bv = buf[i + c];
    const b = space === 'srgb' ? bv / 255 : LIN[bv];
    const l = space === 'srgb' ? L[c] / 255 : LIN[L[c]];
    const v = b + (blendChannel(mode, b, l) - b) * a;
    buf[i + c] = clamp(Math.round((space === 'srgb' ? v : fromLinear(v)) * 255), 0, 255);
  }
}

/** one 8-bit colour under one layer */
export function composite8(base: Rgb, L: Rgb, mode: Mode, pct: number, space: Space = 'srgb', cov = 1): Rgb {
  const px = [base[0], base[1], base[2]];
  compositeAt(px, 0, L, mode, pct, space, cov);
  return [px[0], px[1], px[2]];
}

// ── solving one layer ─────────────────────────────────────────────────────────────────────────

export type Item = { id: string; base: Rgb; target: Oklab; w: number };
export type Solved = { mode: Mode; hex: string; pct: number; cost: number; dist: Record<string, number>; worst: { id: string; dist: number } };

type Search = { lMin: number; aMin: number };
const SHADOW_SEARCH: Search = { lMin: 0.25, aMin: 0.3 };
// The light layers are Add or Screen. In Add, colour and opacity trade off exactly (what lands is colour times
// opacity), so an unguided search picks a near-black colour at 80%, which is invisible as a layer. The light
// search starts at a mid colour and leans toward a low opacity, so the layer is a visible colour.
const LIGHT_SEARCH: Search = { lMin: 0.45, aMin: 0.2 };

/** weighted mean OKLab distance of the flats under (m, a): the number the search minimises */
function costOf(mode: Mode, items: Item[], space: Space, m: Rgb, a: number): number {
  let sum = 0;
  let wsum = 0;
  for (const it of items) {
    const o = blendRgb(mode, [it.base[0] / 255, it.base[1] / 255, it.base[2] / 255], m, a, space);
    sum += it.w * dist(srgbToOklab(clamp(o[0], 0, 1), clamp(o[1], 0, 1), clamp(o[2], 0, 1)), it.target);
    wsum += it.w;
  }
  return sum / wsum;
}

/**
 * Many colour and opacity pairs fit about equally (a deep colour at 30% or a lighter one at 80%).
 * The search leans toward this opacity, so the answer is the plain-looking one a person would
 * choose; the reported distances do not include the lean.
 */
const TYPICAL_OPACITY = 0.8;
const LIGHT_OPACITY = 0.3;
const LEAN = 0.02;
const lean = (a: number, mode: Mode = 'multiply'): number => LEAN * Math.abs(a - (mode === 'multiply' ? TYPICAL_OPACITY : LIGHT_OPACITY));

const FIT_STEPS = 14;
/** (L, C, h) with the most chroma sRGB shows at that L and h, up to C */
function fitted(L: number, C: number, h: number): Rgb | null {
  let c = C;
  for (let i = 0; i < FIT_STEPS; i++, c *= 0.88) {
    const rgb = oklchToSrgb(L, c, h);
    if (inGamut(rgb)) return rgb;
  }
  return null;
}

/**
 * The colour and opacity of one layer of `mode` that bring `items` closest to their targets. A
 * coarse grid over OKLCH (L from lMin, six chroma steps, 24 hues) and opacity, then a pattern
 * search around the best cell, then 8-bit polish: the answer is a hex and a whole percent, and
 * those exact numbers are what the distances are measured with. No randomness, so the same flats
 * always give the same layer.
 */
export function solveLayer(mode: Mode, items: Item[], space: Space = 'srgb', search: Search = mode === 'multiply' ? SHADOW_SEARCH : LIGHT_SEARCH): Solved {
  const lSteps = 10;
  const opac = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((a) => Math.max(a, search.aMin));
  let best = { p: [1, 0, 0, 1], cost: Infinity };
  // the grid's colours depend on the lightness alone, so each is worked out once and tried at every opacity
  for (let i = 0; i < lSteps; i++) {
    const L = search.lMin + ((1 - search.lMin) * i) / (lSteps - 1);
    const cands: { rgb: Rgb; p: number[] }[] = [];
    const grey = oklchToSrgb(L, 0, 0);
    if (inGamut(grey)) cands.push({ rgb: grey.map((v) => clamp(v, 0, 1)) as Rgb, p: [L, 0, 0] });
    for (const C of [0.03, 0.06, 0.1, 0.15, 0.2]) {
      for (let k = 0; k < 24; k++) {
        const h = k * 15;
        const rgb = fitted(L, C, h);
        if (!rgb) continue;
        const c: Rgb = [clamp(rgb[0], 0, 1), clamp(rgb[1], 0, 1), clamp(rgb[2], 0, 1)];
        // keep the fitted chroma, so the refine starts from a colour that is in gamut
        const f = srgbToOklab(c[0], c[1], c[2]);
        cands.push({ rgb: c, p: [L, Math.hypot(f[1], f[2]), h] });
      }
    }
    for (const a of opac) {
      for (const cand of cands) {
        const cost = costOf(mode, items, space, cand.rgb, a) + lean(a, mode);
        if (cost < best.cost) best = { p: [...cand.p, a], cost };
      }
    }
  }

  // pattern search in (L, C, h, a): try each way, keep what helps, halve the steps when nothing does
  let { p, cost } = best;
  let step = [0.06, 0.03, 12, 0.08];
  for (let it = 0; it < 40 && step[0] > 0.0005; it++) {
    let moved = false;
    for (let d = 0; d < 4; d++) {
      for (const s of [1, -1]) {
        const q = [...p];
        q[d] += s * step[d];
        q[0] = clamp(q[0], 0, 1);
        q[1] = Math.max(0, q[1]);
        q[3] = clamp(q[3], search.aMin, 1);
        const rgb = oklchToSrgb(q[0], q[1], q[2]);
        if (!inGamut(rgb)) continue;
        const c = costOf(mode, items, space, rgb.map((v) => clamp(v, 0, 1)) as Rgb, q[3]) + lean(q[3], mode);
        if (c < cost - 1e-9) {
          p = q;
          cost = c;
          moved = true;
        }
      }
    }
    if (!moved) step = step.map((v) => v / 2);
  }

  // what you can type: a hex and a whole percent, polished one 8-bit step at a time
  let rgb8 = oklchToSrgb(p[0], p[1], p[2]).map((v) => clamp(Math.round(v * 255), 0, 255)) as Rgb;
  let pct = clamp(Math.round(p[3] * 100), Math.round(search.aMin * 100), 100);
  const at = (c: Rgb, q: number) => costOf(mode, items, space, [c[0] / 255, c[1] / 255, c[2] / 255], q / 100) + lean(q / 100, mode);
  let cur = at(rgb8, pct);
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let d = 0; d < 4; d++) {
      for (const s of [1, -1]) {
        const c: Rgb = [...rgb8];
        let q = pct;
        if (d < 3) c[d] = clamp(c[d] + s, 0, 255);
        else q = clamp(q + s, Math.round(search.aMin * 100), 100);
        const v = at(c, q);
        if (v < cur - 1e-12) {
          rgb8 = c;
          pct = q;
          cur = v;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const per: Record<string, number> = {};
  let worst = { id: '', dist: -1 };
  let sum = 0;
  let wsum = 0;
  for (const it of items) {
    const out = composite8(it.base, rgb8, mode, pct, space);
    const d = dist(srgbToOklab(out[0] / 255, out[1] / 255, out[2] / 255), it.target);
    per[it.id] = d;
    if (d > worst.dist) worst = { id: it.id, dist: d };
    sum += it.w * d;
    wsum += it.w;
  }
  return { mode, hex: rgbHex(rgb8), pct, cost: sum / wsum, dist: per, worst };
}

// ── the targets ───────────────────────────────────────────────────────────────────────────────

/** what a flat should land on: its ramp's shadow, its light and its rim (the lightest step) */
export type Targets = { shadow: Oklch; light: Oklch; rim: Oklch };

/**
 * The targets of a ramp, read off its own steps as they are, so a hand-edited step is honoured: the first
 * darker step is the shadow, the first lighter step the light, the lightest the rim. A ramp with no step
 * on one side takes that side from `generateRamp`, and where the spec makes none either (a base at white
 * or black has room on one side only) the base stands in.
 */
export function targetsFrom(spec: RampSpec, steps: { step: number; oklch: Oklch }[]): Targets {
  type Step = { step: number; oklch: Oklch };
  const inner = (list: Step[], dark: boolean): Step | undefined => list.filter((s) => (dark ? s.step > 0 : s.step < 0)).sort((a, b) => (dark ? a.step - b.step : b.step - a.step))[0];
  const lightest = (list: Step[]): Step | undefined => list.filter((s) => s.step < 0).sort((a, b) => a.step - b.step)[0];
  let made: Step[] | undefined;
  const side = <T>(read: (list: Step[]) => T | undefined): T | undefined => read(steps) ?? read((made ??= generateRamp(spec)));
  return {
    shadow: side((l) => inner(l, true))?.oklch ?? spec.base,
    light: side((l) => inner(l, false))?.oklch ?? spec.base,
    rim: side(lightest)?.oklch ?? spec.base,
  };
}

// ── the recipe ────────────────────────────────────────────────────────────────────────────────

export type FlatIn = {
  id: string;
  name: string;
  hex: string;
  material: MaterialId;
  targets: Targets;
  /** "matters most": weighs more in the solve */
  star: boolean;
  /** the backdrop (a wall, a sky), not part of the character: it gets the Cast shadow, not the Shadow */
  background?: boolean;
  /**
   * How much of the picture is in shadow on this flat, 0..1, when something measures it. Only the second
   * Shadow reads it (a flat with next to none in shadow never earns one); the solve itself weighs flats
   * equally. Absent: it counts as plenty.
   */
  share?: number;
};

export type Recipe = {
  space: Space;
  lightMode: 'add' | 'screen';
  /** Multiply over the character flats only (clipped to the character) */
  shadow: Solved;
  /** a second Multiply on top, only on the character flats the first one leaves muddy or off */
  shadow2: (Solved & { clip: string[] }) | null;
  /** Multiply on the background flats only; null with no background */
  cast: Solved | null;
  light: Solved;
  /** every flat's colour in shadow and in light under the layers above, 8-bit */
  shaded: Record<string, { shadow: string; light: string; shadowDist: number; lightDist: number }>;
  /** the worst flat once every shadow layer is on, and once the light layer is on */
  shadowAll: { id: string; dist: number };
  lightAll: { id: string; dist: number };
};

const weightOf = (f: FlatIn): number => (f.star ? STAR_WEIGHT : 1);
const oklabOf = (c: Oklch): Oklab => toOklab(c);

/**
 * A flat with less of the picture than this in shadow never earns the second Shadow: too little of it
 * is in shadow to see, so a layer spent on it is wasted (the demo's sample Shirt sat at 0.0006 of the
 * canvas under a collar; the smallest flat that does matter, Skin, at 0.018).
 */
export const MIN_SHADOW_SHARE = 0.002;
const enough = (f: FlatIn): boolean => (f.share ?? 1) >= MIN_SHADOW_SHARE;

/** Solves for one or more flats; with none there is nothing to fit and the caller shows its empty state. */
export function solveRecipe(flats: FlatIn[], opts: { space?: Space; lightMode?: 'add' | 'screen' } = {}): Recipe {
  if (!flats.length) throw new RangeError('A recipe needs at least one flat.');
  const space = opts.space ?? 'srgb';
  const lightMode = opts.lightMode ?? 'add';

  // The Shadow belongs to the character and the Cast shadow to the backdrop, as in a real file: if the
  // backdrop weighed in, the Multiply would be tuned to it and the character would go muddy. With
  // nothing but background flats, they stand in as the character.
  const bgs = flats.filter((f) => f.background);
  const chars = bgs.length === flats.length ? flats : flats.filter((f) => !f.background);
  const itemOf = (f: FlatIn, target: Oklch): Item => ({ id: f.id, base: hexRgb(f.hex), target: oklabOf(target), w: weightOf(f) });
  const shadowItems = chars.map((f) => itemOf(f, f.targets.shadow));
  const shadow = solveLayer('multiply', shadowItems, space);
  const cast = chars === flats || !bgs.length ? null : solveLayer('multiply', bgs.map((f) => itemOf(f, f.targets.shadow)), space);

  // One layer cannot always fit every character flat. The second goes first to flats the muddy check flags
  // under the first (the starred ones first), then to the ones still further than OFF from their target
  // (furthest first), at most two, skipping flats with too little in shadow to see.
  let shadow2: Recipe['shadow2'] = null;
  const m1 = hexRgb(shadow.hex);
  const seen = chars.filter(enough);
  const muddy1 = seen.filter((f) => muddyCheck(f, shadeFlat(f.hex, [{ ...shadow, on: true }], space), f.targets.shadow, 'shadow'));
  const byStar = (a: FlatIn, b: FlatIn) => Number(b.star) - Number(a.star);
  const far = seen.filter((f) => shadow.dist[f.id] > OFF).sort((a, b) => shadow.dist[b.id] - shadow.dist[a.id]);
  const picked = [...new Set([...muddy1.sort(byStar), ...far])].slice(0, 2);
  if (picked.length && picked.length < chars.length) {
    const ids = picked.map((f) => f.id);
    const second = shadowItems.filter((it) => ids.includes(it.id)).map((it) => ({ ...it, base: composite8(it.base, m1, 'multiply', shadow.pct, space) }));
    const s = solveLayer('multiply', second, space);
    const before = Math.max(...ids.map((id) => shadow.dist[id]));
    const clears = muddy1.some((f) => ids.includes(f.id) && !muddyCheck(f, shadeFlat(f.hex, [{ ...shadow, on: true }, { ...s, on: true }], space), f.targets.shadow, 'shadow'));
    // keep it if it helps the worst of them by 15%, or clears a muddy flag
    if (s.worst.dist < before * 0.85 || clears) shadow2 = { ...s, clip: ids };
  }

  // the light falls on the character: the backdrop has no light layer of its own
  const light = solveLayer(lightMode, chars.map((f) => itemOf(f, f.targets.light)), space);

  const shaded: Recipe['shaded'] = {};
  for (const f of flats) {
    const sh = shadeFlat(f.hex, shadowStack(f, { shadow, shadow2, cast }), space);
    const li = shadeFlat(f.hex, onCast(f, { cast }) ? [] : [{ ...light, on: true }], space);
    shaded[f.id] = { shadow: sh, light: li, shadowDist: dist(toLabHex(sh), oklabOf(f.targets.shadow)), lightDist: dist(toLabHex(li), oklabOf(f.targets.light)) };
  }
  const worstOf = (key: 'shadowDist' | 'lightDist') => {
    let w = { id: '', dist: -1 };
    for (const f of chars) if (enough(f) && shaded[f.id][key] > w.dist) w = { id: f.id, dist: shaded[f.id][key] };
    return w;
  };
  return { space, lightMode, shadow, shadow2, cast, light, shaded, shadowAll: worstOf('shadowDist'), lightAll: worstOf('lightDist') };
}

const toLabHex = (hex: string): Oklab => {
  const [r, g, b] = hexRgb(hex);
  return srgbToOklab(r / 255, g / 255, b / 255);
};

type Layer = { mode: Mode; hex: string; pct: number; on: boolean };

/** a flat's colour under layers applied in order, bottom first, at full coverage */
export function shadeFlat(hex: string, layers: Layer[], space: Space = 'srgb'): string {
  let px: Rgb = hexRgb(hex);
  for (const l of layers) if (l.on) px = composite8(px, hexRgb(l.hex), l.mode, l.pct, space);
  return rgbHex(px);
}

/** how well the worst flat fits, in words: "close", "near" or "off on Hair" */
export function fitWord(worstDist: number, worstName: string): string {
  return worstDist < CLOSE ? 'close' : worstDist < OFF ? `near, a little off on ${worstName}` : `off on ${worstName}`;
}

// ── muddy check ───────────────────────────────────────────────────────────────────────────────

/** a flat whose shaded chroma is under this share of its target's has lost most of its colour */
export const MUD_RATIO = 0.6;
/** a hue turn past this many degrees reads as a different colour, not a deeper one (about two ramp steps of hue shift) */
export const MUD_HUE = 25;
/** skin with less chroma than this reads as grey-brown (a pale grey-beige sits near 0.03), unless it already matches its own target: a grey flat shaded to a grey target is not muddy because of the layers */
export const SKIN_FLOOR = 0.035;
/** a target with less chroma than this cannot lose colour worth warning about */
const HUED = 0.03;
/** the hue test only judges flats with a clear hue: under this a few degrees of drift is not a different colour */
const HUE_MIN_CHROMA = 0.05;

const HUE_WORDS: [number, string][] = [[15, 'red'], [40, 'orange'], [70, 'gold'], [100, 'yellow-green'], [150, 'green'], [190, 'teal'], [230, 'blue'], [270, 'indigo'], [300, 'violet'], [340, 'magenta'], [361, 'red']];
export const hueWord = (h: number): string => HUE_WORDS.find(([max]) => ((h % 360) + 360) % 360 < max)![1];
const turnOf = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

export type Warning = { id: string; name: string; zone: 'shadow' | 'light'; kind: 'colour' | 'skin' | 'hue'; text: string };

/**
 * Does the shaded flat go muddy against its target? Three ways: it keeps under 60% of the target's
 * chroma (greyed out), it is skin and falls under a chroma floor, or its hue turns more than 25
 * degrees without gaining colour (toward brown or grey). Value statements use Rec. 709 `valueOf`.
 */
export function muddyCheck(flat: Pick<FlatIn, 'id' | 'name' | 'material'>, shadedHex: string, target: Oklch, zone: 'shadow' | 'light'): Warning | null {
  const s = hexToOklch(shadedHex);
  const where = zone === 'shadow' ? 'in shadow' : 'in the light';
  const val = `Its grey value is ${Math.round(valueOf(s) * 100)}% where the ramp has ${Math.round(valueOf(target) * 100)}%.`;
  const warn = (kind: Warning['kind'], text: string): Warning => ({ id: flat.id, name: flat.name, zone, kind, text: `${text} ${val}` });
  const warm = s[2] >= 20 && s[2] <= 100;
  if (target[1] >= HUED && s[1] / target[1] < MUD_RATIO) {
    return warn('colour', `${flat.name} goes ${warm ? 'grey-brown' : 'grey'} ${where}: it loses ${Math.round((1 - s[1] / target[1]) * 100)}% of its colour.`);
  }
  if (flat.material === 'skin' && s[1] < SKIN_FLOOR && s[1] < target[1] * 0.9) return warn('skin', `${flat.name} goes grey-brown ${where}: it has almost no colour left.`);
  if (target[1] >= HUE_MIN_CHROMA && s[1] >= HUED / 2 && turnOf(s[2], target[2]) > MUD_HUE && s[1] <= target[1]) {
    const [from, to] = [hueWord(target[2]), hueWord(s[2])];
    const turn = from === to ? `drifts ${Math.round(turnOf(s[2], target[2]))} degrees off its ${from}` : `shifts from ${from} to ${to}`;
    const keeps = target[1] > 0 ? Math.round(Math.min(1, s[1] / target[1]) * 100) : 100;
    return { id: flat.id, name: flat.name, zone, kind: 'hue', text: `${flat.name} ${turn} ${where} and keeps ${keeps}% of the ramp's colour.` };
  }
  return null;
}

/** which of the solved layers are shown: the warnings follow the eyes */
export type Eyes = { shadow: boolean; shadow2: boolean; cast: boolean; light: boolean };
export const ALL_ON: Eyes = { shadow: true, shadow2: true, cast: true, light: true };

/** whether a flat sits under the Cast shadow: a background flat, when there is a character for the Shadow to belong to */
const onCast = (f: Pick<FlatIn, 'background'>, r: Pick<Recipe, 'cast'>): boolean => !!f.background && !!r.cast;

/** the layers that land on a flat in shadow, bottom first, as the eyes have them (the second Shadow only counts while the first is on) */
export function shadowStack(f: Pick<FlatIn, 'id' | 'background'>, r: Pick<Recipe, 'shadow' | 'shadow2' | 'cast'>, eyes: Eyes = ALL_ON): Layer[] {
  if (onCast(f, r)) return eyes.cast ? [{ ...r.cast!, on: true }] : [];
  const second = r.shadow2 && r.shadow2.clip.includes(f.id) && eyes.shadow2 && eyes.shadow ? [{ ...r.shadow2, on: true }] : [];
  return [...(eyes.shadow ? [{ ...r.shadow, on: true }] : []), ...second];
}

/** the flats that go muddy under the layers as shown, in shadow and in the light; a background flat has no light on it */
export function muddyAll(flats: FlatIn[], r: Recipe, eyes: Eyes = ALL_ON): (Warning & { shaded: string; target: string })[] {
  const out: (Warning & { shaded: string; target: string })[] = [];
  for (const f of flats) {
    for (const zone of ['shadow', 'light'] as const) {
      const stack = zone === 'shadow' ? shadowStack(f, r, eyes) : !onCast(f, r) && eyes.light ? [{ ...r.light, on: true }] : [];
      if (!stack.length) continue;
      const shaded = shadeFlat(f.hex, stack, r.space);
      const w = muddyCheck(f, shaded, f.targets[zone], zone);
      if (w) out.push({ ...w, shaded, target: hexOf(f.targets[zone]) });
    }
  }
  return out;
}

// ── mood and rim, and the recipe as text ──────────────────────────────────────────────────────

/** the rim: Add, in the light's colour (rounded to the hex you would type) */
export const rimColour = (pair: LightPair): string => hexOf(pair.light);
/** the mood: Overlay, in the light's shadow colour */
export const moodColour = (pair: LightPair): string => hexOf(pair.shadow);
/** a target or palette colour as the hex you would type */
export const typedHex = hexOf;

export type ListedLayer = { name: string; mode: Mode; hex: string; pct: number; on: boolean; note?: string };

/** the layers as plain text, top of the stack first, ready for a notes page */
export function recipeText(layers: ListedLayer[], header: string): string {
  return [header, ...layers.filter((l) => l.on).map((l) => `${l.name}: ${MODE_NAME[l.mode]} ${l.hex} at ${l.pct}%${l.note ? ', ' + l.note : ''}`)].join('\n');
}

/** reads a line of `recipeText` back: what a person typing it into Krita would use */
export function parseRecipeLine(line: string): { name: string; mode: Mode; hex: string; pct: number } | null {
  const m = /^([^:]+): (Multiply|Screen|Add \(Linear Dodge\)|Overlay) (#[0-9A-Fa-f]{6}) at (\d+)%/.exec(line);
  if (!m) return null;
  const mode = (Object.keys(MODE_NAME) as Mode[]).find((k) => MODE_NAME[k] === m[2])!;
  return { name: m[1], mode, hex: m[3].toUpperCase(), pct: Number(m[4]) };
}
