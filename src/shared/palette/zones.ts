// Light zones: the seven zones a painter reads on a form (highlight, light, halftone, core shadow,
// reflected light, cast shadow, rim), worked out from a local colour, a material and four named
// lights (key, fill, bounce, rim) in LINEAR light: surface colour times light colour, the "Corona
// rule". Pure maths, no DOM.
//
// Hard rule (the point of the tool): every shadow-family colour is darker in value (valueOf, the
// grey it becomes) than every light-family colour, by at least GAP. Where the physics would break it,
// the shadow colour is solved again at a lower value with holdValue (hue kept, chroma yields).
import type { Oklch } from '../color/index.ts';
import { displayRgb, toOklch } from '../color/index.ts';
import { holdValue, valueOf } from '../color/value.ts';
import type { MaterialId } from '../types.ts';
import { MATERIALS } from './ramp.ts';
import { fitChroma, wrapHue } from './space.ts';

export type Rgb = [number, number, number];

export const ZONES = ['highlight', 'light', 'halftone', 'core', 'reflected', 'cast', 'rim'] as const;
export type ZoneId = (typeof ZONES)[number];
/** the light family: the zones the key (or the rim) reaches */
export const LIT: readonly ZoneId[] = ['highlight', 'light', 'halftone', 'rim'];
/** the shadow family: the zones only the fill and the bounce reach */
export const SHADOWS: readonly ZoneId[] = ['core', 'reflected', 'cast'];

// ── the constants: taste, in one place, so they can be tuned without touching the maths ────────

/** every shadow stays at least this far below every light, in value (0..1) */
export const GAP = 0.02;
/** reflected light sits further under the lit zones than the others, so the two families read at a glance */
export const GAP_REFLECTED = 0.05;
/** a light-family colour never reads darker than this value, so there is always room under it for the shadows */
const LIT_FLOOR = 0.08;
/** how much of the fill reaches the core shadow (the surface turns away from the key, so the sky fills it only partly) and the cast shadow (the ground under the form sees the least); reflected light has no occlusion */
const OCC_CORE = 0.55;
const OCC_CAST = 0.3;
/** the share of the bounce strength that reaches the shadow side facing the ground */
const BOUNCE_K = 0.5;
/** cos of the angle at the Light zone and at the Halftone zone */
const COS_LIGHT = 0.85;
const COS_HALF = 0.35;
/** the chroma a believable light may have before the excess counts only EXCESS: a pink or violet "light" colour is mostly a mood, not a lamp */
const LAMP_CHROMA = 0.04;
const EXCESS = 0.4;
/** the lightness an emitter's colour is read at */
const LAMP_L = 0.85;
/** how far a subsurface material's Halftone and Core are enriched and turned toward red-orange (ramp.ts' glow) */
const WARM = 40;
const HUED = 0.02;
const FACING = [90, 180];
const GLOW_HALF = 0.7;
const GLOW_CORE = 1;
const GLOW_CHROMA = 0.3;
const GLOW_TURN = 0.35;
/** the exposure never divides by less than this, so a dim key with no fill does not blow up */
const MIN_EXPOSURE = 0.05;
/** a hair under the ceiling, so the hex a zone is shown as still keeps the gap */
const SETTLE = 0.002;

/** a warm ground tone: what the bounce picks up before it reaches the form */
export const GROUND: Oklch = [0.55, 0.07, 60];

/** [key, fill, bounce, rim] a light starts at when its preset names none (Daylight's) */
export const DEFAULT_STRENGTHS: readonly [number, number, number, number] = [1, 0.3, 0.25, 0.5];

/** the ranges the strengths run over (the sliders' ends; the tests use them) */
export const RANGE = {
  key: [0.1, 2],
  fill: [0, 1],
  bounce: [0, 1],
  rim: [0, 1.5],
} as const;

export type Lamp = { colour: Oklch; strength: number };
/** the key, the fill (the sky in the shadows), the rim (from behind) and the bounce: the key off a ground of this colour */
export type Rig = { key: Lamp; fill: Lamp; rim: Lamp; bounce: { ground: Oklch; strength: number } };

const num = (v: number, d: number) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** the sRGB colour as linear light, unrounded */
export function linearOf(o: Oklch): Rgb {
  const { r, g, b } = displayRgb(o);
  return [decode(r), decode(g), decode(b)];
}
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mul = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const add = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => add(scale(a, 1 - t), scale(b, t));
/** the colour at luminance 1, or white where it has none */
const unit = (c: Rgb): Rgb => (lum(c) > 1e-6 ? scale(c, 1 / lum(c)) : [1, 1, 1]);

/** linear light (any size) back to an OKLCH colour sRGB can show: L and hue exact, chroma gives way */
function fromLinear(c: Rgb): Oklch {
  return fitChroma(toOklch({ mode: 'lrgb', r: Math.max(0, c[0]), g: Math.max(0, c[1]), b: Math.max(0, c[2]) }));
}

/**
 * A light colour as an emitter: linear RGB at luminance 1, so strength alone sets how bright it is
 * and the colour only sets its tint. A preset colour too saturated to be a believable light (Dusk's
 * pink, Twilight's violet) is tempered toward white first: chroma above LAMP_CHROMA counts 40%.
 */
export function emitter(colour: Oklch): Rgb {
  const [, c, h] = colour;
  const tempered = c <= LAMP_CHROMA ? c : LAMP_CHROMA + (c - LAMP_CHROMA) * EXCESS;
  return unit(linearOf([LAMP_L, tempered, h]));
}

/** the bounce: the key's emitter times the ground's colour in linear light, at luminance 1, so a green lawn gives a green bounce */
export const bounceEmitter = (key: Oklch, ground: Oklch): Rgb => unit(mul(emitter(key), linearOf(fitChroma(ground))));

/**
 * The four lights of a scene: the key is the palette's light colour, the fill its shadow colour
 * (the sky in the shadows), the rim the key again from behind unless given, the bounce the key off
 * the ground. `strengths`: [key, fill, bounce, rim].
 */
export function rigOf(pair: { light: Oklch; shadow: Oklch }, strengths: readonly number[] = DEFAULT_STRENGTHS, o: { rim?: Oklch | null; ground?: Oklch } = {}): Rig {
  const [k, f, b, r] = strengths;
  return {
    key: { colour: [...pair.light], strength: k },
    fill: { colour: [...pair.shadow], strength: f },
    rim: { colour: [...(o.rim ?? pair.light)], strength: r },
    bounce: { ground: [...(o.ground ?? GROUND)], strength: b },
  };
}

/** a neutral rig: white lights over a neutral ground, for checks ("a white key makes Light the local colour") */
export const whiteRig = (key = 1, fill = 0.3, bounce = 0.25, rim = 0.5): Rig => ({
  key: { colour: [0.9, 0, 0], strength: key },
  fill: { colour: [0.9, 0, 0], strength: fill },
  rim: { colour: [0.9, 0, 0], strength: rim },
  bounce: { ground: [0.55, 0, 0], strength: bounce },
});

/** the hue turned `f` of the way toward `b`, the short way, fading out as `b` nears the opposite (ramp.ts' turn) */
function turn(a: number, b: number, f: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return wrapHue(a + d * f * (1 - smooth(FACING[0], FACING[1], Math.abs(d))));
}

/** subsurface light at the terminator: richer chroma and a hue turned toward red-orange, `w` of the material's `sub` */
function glow(o: Oklch, sub: number, w: number): Oklch {
  if (sub <= 0 || w <= 0) return o;
  const [l, c, h] = o;
  return fitChroma([l, c * (1 + GLOW_CHROMA * sub * w), c > HUED ? turn(h, WARM, GLOW_TURN * sub * w) : h]);
}

export type ZoneSet = Record<ZoneId, Oklch>;
export type Split = {
  /** darkest and lightest value in the light family */
  lit: [number, number];
  /** darkest and lightest value in the shadow family */
  shadow: [number, number];
  /** darkest light minus lightest shadow */
  gap: number;
};
export type ZoneResult = { zones: ZoneSet; /** the zones the value rule had to move */ held: ZoneId[]; split: Split };

const vals = (z: ZoneSet, ids: readonly ZoneId[]) => ids.map((id) => valueOf(z[id]));

export function splitOf(z: ZoneSet): Split {
  const l = vals(z, LIT);
  const s = vals(z, SHADOWS);
  const lit: [number, number] = [Math.min(...l), Math.max(...l)];
  const shadow: [number, number] = [Math.min(...s), Math.max(...s)];
  return { lit, shadow, gap: lit[0] - shadow[1] };
}

/**
 * The zones of `local` (an OKLCH colour) of `material` under `rig`, all in linear light.
 *
 * Exposure: a camera would set it, so it is set the same way: scaled so the Light zone of a white
 * surface under neutral lights is white (1 / (key x cos + fill)). Light therefore reads as the local
 * colour under a neutral key whatever the strengths, and strengths change the balance, not the
 * overall brightness.
 *
 *   Light      = local x (key x cos 0.85 + fill)
 *   Halftone   = local x (key x cos 0.35 + fill)
 *   Core       = local x fill x 0.55          (the fill, partly blocked)
 *   Reflected  = local x (fill + bounce x 0.5), kept GAP_REFLECTED (0.05) under the lit zones
 *   Cast       = local x fill x 0.3
 *   Rim        = local x (rim + fill), never darker than the Halftone it sits beside
 *   Highlight  = Light moved toward the key by the material's pull, and up by its light value,
 *                both scaled by the share of Light that is key
 * Subsurface materials then enrich and warm the Halftone and Core. Last, the value rule.
 */
export function zonesOf(local: Oklch, material: MaterialId, rig: Rig): ZoneResult {
  const mat = MATERIALS.find((m) => m.id === material) ?? MATERIALS[0];
  const loc = linearOf(fitChroma(local)); // an out-of-gamut local is fitted first
  // strengths: non-finite falls back to a default, then clamped to the slider range
  const K = clamp(num(rig.key.strength, DEFAULT_STRENGTHS[0]), RANGE.key[0], RANGE.key[1]);
  const F = clamp(num(rig.fill.strength, DEFAULT_STRENGTHS[1]), RANGE.fill[0], RANGE.fill[1]);
  const B = clamp(num(rig.bounce.strength, DEFAULT_STRENGTHS[2]), RANGE.bounce[0], RANGE.bounce[1]);
  const R = clamp(num(rig.rim.strength, DEFAULT_STRENGTHS[3]), RANGE.rim[0], RANGE.rim[1]);
  const key = emitter(rig.key.colour);
  const fill = emitter(rig.fill.colour);
  const bounce = bounceEmitter(rig.key.colour, rig.bounce.ground);
  const rim = emitter(rig.rim.colour);

  const E = 1 / Math.max(MIN_EXPOSURE, K * COS_LIGHT + F);
  const fillE = scale(fill, F * E);
  const lightLin = mul(loc, add(scale(key, K * COS_LIGHT * E), fillE));
  const halfLin = mul(loc, add(scale(key, K * COS_HALF * E), fillE));
  const coreLin = mul(loc, scale(fillE, OCC_CORE));
  const reflLin = mul(loc, add(fillE, scale(bounce, B * BOUNCE_K * E)));
  const castLin = mul(loc, scale(fillE, OCC_CAST));
  let rimLin = mul(loc, add(scale(rim, R * E), fillE));
  const yHalf = lum(halfLin);
  const yRim = lum(rimLin);
  if (yRim < yHalf && yRim > 1e-9) rimLin = scale(rimLin, yHalf / yRim);
  else if (yRim <= 1e-9) rimLin = halfLin;

  const keyShare = K * COS_LIGHT * E; // 0..1: how much of Light is key
  const towardKey = lerp(lightLin, key, mat.light.pull * Math.min(1, keyShare));
  const yL = lum(lightLin);
  const yTarget = yL + Math.max(0, 1 - yL) * mat.light.value * Math.min(1, keyShare);
  const yT = lum(towardKey);
  const hiLin = yT > 1e-9 ? scale(towardKey, yTarget / yT) : scale(key, yTarget);

  const zones: ZoneSet = {
    highlight: fromLinear(hiLin),
    light: fromLinear(lightLin),
    halftone: glow(fromLinear(halfLin), mat.sub, GLOW_HALF),
    core: glow(fromLinear(coreLin), mat.sub, GLOW_CORE),
    reflected: fromLinear(reflLin),
    cast: fromLinear(castLin),
    rim: fromLinear(rimLin),
  };

  // the value rule
  const held: ZoneId[] = [];
  for (const id of LIT) {
    if (valueOf(zones[id]) < LIT_FLOOR) zones[id] = holdValue(LIT_FLOOR, zones[id][1], zones[id][2]);
  }
  const litMin = Math.min(...vals(zones, LIT));
  for (const id of SHADOWS) {
    const ceiling = litMin - (id === 'reflected' ? GAP_REFLECTED : GAP);
    if (valueOf(zones[id]) > ceiling) {
      zones[id] = holdValue(ceiling - SETTLE, zones[id][1], zones[id][2]);
      held.push(id);
    }
  }
  // the cast shadow is the deepest: never lighter than the core
  const vc = valueOf(zones.core);
  if (valueOf(zones.cast) > vc) {
    zones.cast = holdValue(vc, zones.cast[1], zones.cast[2]);
    if (!held.includes('cast')) held.push('cast');
  }
  return { zones, held, split: splitOf(zones) };
}
