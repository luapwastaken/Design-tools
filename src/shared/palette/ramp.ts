// Ramps (spec 2026-09-29 §3.1): a base colour developed into steps from highlight to deep shadow,
// under a light colour and a shadow colour. Lightness follows its own plan and only ever falls
// from highlight to deep shadow, so value never breaks; the colours, the material and the
// intensity steer hue and chroma, and how far the plan reaches.
import type { Oklch } from '../color/index.ts';
import { holdValue, valueOf } from '../color/value.ts';
import type { MaterialId, RampSpec, Swatch } from '../types.ts';
import { fitChroma, fromOklab, toOklab, wrapHue } from './space.ts';

/**
 * One side of a ramp, at its far end. `hue`: the share of the way the hue turns toward the light
 * (or shadow) colour's. `chroma`: times the base's. `value`: the share of the lightness headroom
 * used. `pull`: the share of the way the colour moves toward the light (or shadow) colour in OKLab.
 */
type Side = { hue: number; chroma: number; value: number; pull: number };

export type Material = {
  id: MaterialId;
  label: string;
  describe: string;
  /** `sharp` above 1 saves the light for the last steps: a crisp highlight */
  light: Side & { sharp: number };
  shadow: Side;
  /** subsurface scattering: a warmer, richer, lighter terminator */
  sub: number;
};

const side = (hue: number, chroma: number, value: number, pull: number): Side => ({ hue, chroma, value, pull });
const material = (id: MaterialId, label: string, describe: string, light: Side, sharp: number, shadow: Side, sub: number): Material => ({
  id,
  label,
  describe,
  light: { ...light, sharp },
  shadow,
  sub,
});

// material(id, label, describe, light side, its sharpness, shadow side, subsurface); side(hue, chroma, value, pull)
export const MATERIALS: Material[] = [
  material('skin', 'Skin', 'Warm glow under the skin: shadows flush red, the light stays soft.', side(0.3, 0.85, 0.55, 0.2), 1.2, side(0.2, 1.1, 0.45, 0.15), 0.7),
  material('cloth', 'Cloth', 'Soft matte weave: gently cool, greyer shadows and a diffuse light.', side(0.25, 0.85, 0.5, 0.1), 1, side(0.25, 0.7, 0.5, 0.25), 0.1),
  material('velvet', 'Velvet', 'Deep nap: cool, dull shadows and a bright sheen at the edge.', side(0.15, 0.7, 0.6, 0.3), 1.8, side(0.45, 0.55, 0.7, 0.35), 0.15),
  material('metal', 'Metal', 'Rich, dark body; the highlight jumps to the light colour.', side(0.3, 0.45, 0.9, 0.7), 2.2, side(0.15, 1.2, 0.75, 0.1), 0),
  material('plastic', 'Plastic', 'Even body colour with a crisp, pale highlight.', side(0.2, 0.5, 0.8, 0.55), 2, side(0.2, 0.95, 0.5, 0.15), 0),
  material('glass', 'Glass', 'Clear and cool, with a brilliant highlight in the light colour.', side(0.2, 0.35, 0.9, 0.75), 2.4, side(0.35, 0.9, 0.5, 0.3), 0.2),
  material('water', 'Water', 'A cool cast with bright, pale highlights.', side(0.25, 0.4, 0.85, 0.6), 2, side(0.35, 0.95, 0.5, 0.35), 0.3),
  material('foliage', 'Foliage', 'Thin and translucent: glowing warm lights, cool shadows.', side(0.45, 1.05, 0.55, 0.15), 1, side(0.3, 0.95, 0.5, 0.25), 0.8),
  material('stone', 'Stone', 'Rough and matte: dull, cool shadows and little shine.', side(0.2, 0.6, 0.45, 0.1), 0.9, side(0.25, 0.5, 0.5, 0.3), 0),
  material('wood', 'Wood', 'Warm, rich shadows and a soft satin light.', side(0.3, 0.9, 0.5, 0.15), 1.3, side(0.15, 1.1, 0.5, 0.15), 0.2),
  material('paper', 'Paper', 'Flat and pale: soft light and gentle, cool shadows.', side(0.15, 0.8, 0.5, 0.1), 0.8, side(0.25, 0.75, 0.4, 0.2), 0.3),
  material('fur', 'Fur', 'A soft sheen over deep, soft shadows.', side(0.25, 0.8, 0.5, 0.2), 1.5, side(0.25, 0.8, 0.55, 0.2), 0.3),
];

/** how much further each intensity pushes the material's numbers */
const INTENSITY = {
  grounded: { hue: 1, chroma: 1, value: 1, pull: 1 },
  expressive: { hue: 1.8, chroma: 1.3, value: 1.1, pull: 1.25 },
  extreme: { hue: 3, chroma: 1.7, value: 1.2, pull: 1.5 },
};
const STOPS = [INTENSITY.grounded, INTENSITY.expressive, INTENSITY.extreme];

/** where each intensity sits on the Push scale, which runs 0 to 2 */
export const PUSH_AT: Record<RampSpec['intensity'], number> = { grounded: 0, expressive: 1, extreme: 2 };

/** the Push the ramp has: its own, or its intensity's */
export const pushOf = (spec: Pick<RampSpec, 'intensity' | 'push'>): number => (typeof spec.push === 'number' && Number.isFinite(spec.push) ? Math.min(2, Math.max(0, spec.push)) : (PUSH_AT[spec.intensity] ?? 0));

/** the intensity a Push is nearest to */
export const intensityAt = (push: number): RampSpec['intensity'] => (push < 0.5 ? 'grounded' : push < 1.5 ? 'expressive' : 'extreme');

/** the intensity table, read between its stops at `push` */
function pushed(spec: RampSpec): typeof INTENSITY.grounded {
  if (typeof spec.push !== 'number' || !Number.isFinite(spec.push)) return INTENSITY[spec.intensity] ?? INTENSITY.grounded;
  const p = Math.min(2, Math.max(0, spec.push));
  const i = Math.min(1, Math.floor(p));
  const f = p - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return { hue: a.hue + (b.hue - a.hue) * f, chroma: a.chroma + (b.chroma - a.chroma) * f, value: a.value + (b.value - a.value) * f, pull: a.pull + (b.pull - a.pull) * f };
}

/** a non-hero ramp's steps lose this share of their chroma, so the hero reads first */
const QUIET = 0.15;
/** subsurface light turns toward this hue: red-orange, the colour light picks up inside skin or a leaf */
const WARM = 40;
/** a light or shadow colour with less chroma than this has no hue to turn toward */
const HUED = 0.04;
/** the deepest shadow keeps at least this share of the base's lightness */
const FLOOR = 0.04;
/** steps on one side sit at least this far apart in L on average; a side without the room hands its steps to the other */
const MIN_STEP = 0.02;
/** a hue turn fades out as the light (or shadow) colour's hue nears the opposite of the step's: there the short way round flips */
const FACING = [90, 180];

/** the light and shadow colours a ramp is born with: warm light, cool shadow (Illustration's Daylight preset) */
export const DAYLIGHT: { light: Oklch; shadow: Oklch } = { light: [0.95, 0.05, 85], shadow: [0.4, 0.08, 275] };

/**
 * A new ramp's settings: a warm light, a cool shadow, cloth, five steps, or the light, shadow,
 * intensity and steps of `like` (the ramp it joins, so one scene keeps one light). `hueShift` and
 * `chromaCurve` run -1..1.
 */
export const newRamp = (base: Oklch, id: string = crypto.randomUUID(), like?: RampSpec | null): RampSpec => ({
  id,
  base,
  light: [...(like?.light ?? DAYLIGHT.light)],
  shadow: [...(like?.shadow ?? DAYLIGHT.shadow)],
  material: 'cloth',
  intensity: like?.intensity ?? 'grounded',
  ...(like?.push !== undefined && { push: like.push }),
  steps: like?.steps ?? 5,
  hueShift: 0,
  chromaCurve: 0,
  hero: false,
});

export const quietFor = (spec: RampSpec, heroPresent: boolean): number => (heroPresent && !spec.hero ? QUIET : 0);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** the short way round, `f` of the way from `a` to `b`, fading out as `b` nears the opposite of `a` */
function turn(a: number, b: number, f: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return wrapHue(a + d * f * (1 - smooth(FACING[0], FACING[1], Math.abs(d))));
}

/**
 * The ramp, lightest first: steps -n..+m around the base (step 0, returned as it is), with the odd
 * step of an even count on the shadow side, and every step on the one side there is room for when
 * the base is near white or black. `heroQuiet` (from `quietFor`) lowers the chroma of the generated
 * steps. Lightness strictly falls step to step, and so does value: where the hue turn and the
 * shadow pull would let a step read as light as its neighbour (saturated blues near black), that
 * step is solved again at a value just clear of it, keeping its hue and as much chroma as fits.
 */
export function generateRamp(spec: RampSpec, heroQuiet = 0): { step: number; oklch: Oklch }[] {
  const count = clamp(Math.round(spec.steps), 3, 9);
  const mat = MATERIALS.find((x) => x.id === spec.material) ?? MATERIALS[0];
  const k = pushed(spec);
  const [L0, C0, h0] = spec.base;

  const top = L0 + (1 - L0) * Math.min(0.95, mat.light.value * k.value);
  const bottom = L0 * (1 - (1 - FLOOR) * Math.min(0.95, mat.shadow.value * k.value * (1 - 0.3 * mat.sub)));
  const room = (span: number) => Math.floor(span / MIN_STEP + 1e-9);
  const lights = clamp(Math.floor((count - 1) / 2), count - 1 - room(L0 - bottom), room(top - L0));
  const darks = count - 1 - lights;
  const gamma = 3 ** clamp(spec.chromaCurve, -1, 1);
  const hueGain = 1 + clamp(spec.hueShift, -1, 1);

  const make = (step: number): Oklch => {
    const lit = step < 0;
    const t = lit ? -step / lights : step / darks;
    const s = lit ? mat.light : mat.shadow;
    const towards = lit ? spec.light : spec.shadow;
    // subsurface glows at the terminator and fades out by the deepest shadow, which is all shadow colour
    const glow = lit ? 0 : mat.sub * (1 - t);

    const L = lit ? L0 + (top - L0) * t ** mat.light.sharp : L0 - (L0 - bottom) * t;
    const hued = Math.min(1, towards[1] / HUED);
    let h = turn(h0, towards[2], clamp(s.hue * k.hue * hueGain * hued, 0, 1) * t * (1 - 0.5 * glow));
    h = turn(h, WARM, 0.35 * glow);
    const end = C0 * s.chroma * k.chroma;
    const c = (C0 + (end - C0) * t ** gamma) * (1 + 0.3 * glow);

    const [, a, b] = toOklab([L, c, h]);
    const [, ta, tb] = toOklab(towards);
    const pull = Math.min(0.95, s.pull * k.pull) * (lit ? t ** mat.light.sharp : t);
    // quieted after the gamut fit, so a step at the edge of sRGB still steps back behind the hero
    const [, fit, hue] = fitChroma(fromOklab([L, a + (ta - a) * pull, b + (tb - b) * pull], h));
    return [L, fit * (1 - heroQuiet), hue];
  };

  const out = Array.from({ length: count }, (_, i) => i - lights).map((step): { step: number; oklch: Oklch } => ({ step, oklch: step === 0 ? [...spec.base] : make(step) }));
  // value falls strictly outward from the base: highlight side up, shadow side down
  const fixed = out.map((w) => ({ ...w }));
  const clear = (at: number, from: number, dir: 1 | -1) => {
    const [, c, h] = fixed[at].oklch;
    const v = valueOf(fixed[from].oklch);
    if (dir * (valueOf(fixed[at].oklch) - v) <= -VALUE_STEP) return;
    fixed[at].oklch = holdValue(clamp(v - dir * VALUE_STEP, 0, 1), c, h);
  };
  for (let i = lights - 1; i >= 0; i--) clear(i, i + 1, -1);
  for (let i = lights + 1; i < fixed.length; i++) clear(i, i - 1, 1);
  // at the very ends of the scale there is no room left to part two steps: then lightness alone keeps the order
  return fixed.every((w, i) => !i || w.oklch[0] < fixed[i - 1].oklch[0]) ? fixed : out;
}

/** the least value a step must fall below its inner neighbour: past 8-bit rounding, so two hexes never read the same grey */
const VALUE_STEP = 0.006;

/**
 * The ramp `groupId` rebuilt from its settings: hand-edited steps stay as they are (even past the
 * ends of a shorter ramp), the rest take the new colours (keeping their ids), steps the new count
 * adds are new swatches, and unedited steps it drops go. A base made again takes the ramp's name.
 * The ramp keeps its place among the other swatches.
 */
export function regenerate(doc: { swatches: Swatch[]; ramps: RampSpec[] }, groupId: string): Swatch[] {
  const spec = doc.ramps.find((r) => r.id === groupId);
  if (!spec) return doc.swatches;
  const old = new Map(doc.swatches.filter((w) => w.group === groupId).map((w) => [w.step, w]));
  const made = generateRamp(spec, quietFor(spec, doc.ramps.some((r) => r.hero)));
  const fresh = made.map(({ step, oklch }): Swatch => {
    const w = old.get(step);
    if (!w) return { id: crypto.randomUUID(), name: step === 0 ? (spec.name ?? '') : '', role: null, oklch, type: 'process', group: groupId, step };
    if (w.edited || oklch.every((v, i) => v === w.oklch[i])) return w;
    const { source: _, ...rest } = w; // an imported colour's original values no longer apply
    return { ...rest, oklch };
  });
  const past = [...old.values()].filter((w) => w.edited && !made.some((m) => m.step === w.step));
  const steps = past.length ? [...fresh, ...past].sort((a, b) => a.step! - b.step!) : fresh;
  const at = doc.swatches.findIndex((w) => w.group === groupId);
  const rest = doc.swatches.filter((w) => w.group !== groupId);
  const i = at < 0 ? rest.length : doc.swatches.slice(0, at).filter((w) => w.group !== groupId).length;
  return [...rest.slice(0, i), ...steps, ...rest.slice(i)];
}
