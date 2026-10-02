// Post FX's curated effects (spec §3, §5 q1): the list, the groups the add menu shows, and the
// settings every layer is checked against. Pure; the GPU side is stack.ts (import it from there).
//
// ── Contract ──
// - A layer's params hold each effect's settings as shown (15 for 15 %, px at the image's full
//   resolution, a choice as its option's index, a colour as OKLCH). valuesOf() puts any set back in
//   range, and fills what's missing with the defaults.
// - A layer's opacity is 0 to 1; its blend is one of BLENDS.
// - `moving` effects take the loop's phase t and repeat exactly at t = 1; `videoOnly` ones need a
//   video's frames and are skipped on a still.
import type { Oklch } from '../../../../shared/color/index.ts';
import { blendIndex, BLENDS } from './composite.ts';
import { bloom, chromatic, lens, lightLeak, vignette } from './light.ts';
import { defaultsFor, isValue, valuesFor } from './params.ts';
import { crt, glitch, grain, pixelStretch, vhs } from './retro.ts';
import { edge, kuwahara, posterize } from './stylise.ts';
import { gaussian, tiltShift } from './blur.ts';
import { duotone, gradientMap, grade } from './colour.ts';
import { kaleidoscope, twirl, wave } from './distort.ts';
import { datamosh } from './video.ts';
import { EFFECT_IDS, type Effect, type EffectId, type Group, type ParamValue } from './types.ts';

export type { Blend, ColourParam, Ctx, Effect, EffectId, Group, NumberParam, Param, ParamValue, ChoiceParam, ToggleParam } from './types.ts';
export type EffectInfo = Effect;
export { BLENDS, blendIndex, isValue, EFFECT_IDS };

/** in the add menu's order */
export const EFFECTS: readonly Effect[] = [
  grade, gradientMap, duotone,
  bloom, vignette, chromatic, lightLeak, lens,
  grain, crt, vhs, glitch, pixelStretch,
  posterize, edge, kuwahara,
  gaussian, tiltShift,
  wave, twirl, kaleidoscope,
  datamosh,
];

export const GROUPS: readonly { id: Group; label: string }[] = [
  { id: 'colour', label: 'Colour' },
  { id: 'light', label: 'Light and lens' },
  { id: 'retro', label: 'Texture and retro' },
  { id: 'stylise', label: 'Stylise' },
  { id: 'blur', label: 'Blur' },
  { id: 'distort', label: 'Distort' },
  { id: 'video', label: 'Video only' },
];

const BY_ID = new Map<string, Effect>(EFFECTS.map((e) => [e.id, e]));

export const effectOf = (id: string): Effect | undefined => BY_ID.get(id);
export const isEffectId = (id: unknown): id is EffectId => typeof id === 'string' && (EFFECT_IDS as readonly string[]).includes(id);

export function defaultsOf(id: EffectId): Record<string, ParamValue> {
  const fx = effectOf(id);
  if (!fx) throw new Error(`There's no effect called “${id}”.`);
  return defaultsFor(fx.params);
}

/** every setting of the effect, from `params` where it holds a good value, in range */
export function valuesOf(id: EffectId, params: Readonly<Record<string, unknown>>): Record<string, ParamValue> {
  const fx = effectOf(id);
  if (!fx) throw new Error(`There's no effect called “${id}”.`);
  return valuesFor(fx.params, params);
}

/**
 * A palette's colours for the effect's colour settings that take one (a gradient map's three, a
 * duotone's two, an edge's line and fill): each from its place between the palette's darkest and
 * lightest. Empty when the effect takes none or the palette is empty.
 */
export function fromPalette(id: EffectId, colours: readonly Oklch[]): Record<string, Oklch> {
  const byLight = [...colours].sort((a, b) => a[0] - b[0]);
  const out: Record<string, Oklch> = {};
  if (!byLight.length) return out;
  for (const p of effectOf(id)?.params ?? []) {
    if (p.kind === 'colour' && p.tone !== undefined) out[p.key] = [...byLight[Math.round(p.tone * (byLight.length - 1))]];
  }
  return out;
}
