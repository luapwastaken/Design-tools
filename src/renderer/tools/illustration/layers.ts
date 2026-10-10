// What the Layers tab shows, apart from how it is drawn: the flats and targets the palette's ramps make,
// which ramp each part of the bust shows, the view state's own part (sanitised on load), the words of the
// layer panel, and the preview's compositing. Pure (the picture is drawn into arrays it is handed), so it is
// unit tested. The maths is shared/palette/recipe.ts.
import { toHex } from '../../../shared/color/index.ts';
import {
  CLOSE,
  compositeAt,
  fitWord,
  hexRgb,
  MODE_NAME,
  moodColour,
  OFF,
  rimColour,
  shadeFlat,
  shadowStack,
  targetsFrom,
  type Eyes,
  type FlatIn,
  type Mode,
  type Recipe,
  type Rgb,
  type Solved,
  type Space,
} from '../../../shared/palette/recipe.ts';
import type { MaterialId, RampSpec } from '../../../shared/types.ts';
import type { Bust, PartId } from './bust.ts';
import { PART_IDS } from './bust.ts';
import { baseOf, rampName, stepsOf, type IllustrationDoc } from './doc.ts';
import type { LightPair } from './scene.ts';

// ── the parts of the bust ───────────────────────────────────────────────────────────────────────

/** `likes`: the materials a ramp for this part usually has, best first */
export const PARTS: { id: PartId; label: string; likes: MaterialId[] }[] = [
  { id: 'skin', label: 'Skin', likes: ['skin'] },
  { id: 'hair', label: 'Hair', likes: ['fur'] },
  { id: 'top', label: 'Top', likes: ['cloth'] },
  { id: 'under', label: 'Under-top', likes: ['cloth'] },
  { id: 'bg', label: 'Background', likes: ['paper', 'water', 'foliage', 'stone', 'wood'] },
];

/**
 * The ramp each part shows when nothing was chosen. First each part takes an unused ramp of a material it likes
 * (skin to Skin, hair to the fur ramp); then the parts still without one take the unused ramps in palette order;
 * with fewer ramps than parts, a part takes a ramp of its material even if another part has it, else the palette
 * in order round again. With no ramps, no part has one.
 */
export function defaultParts(ramps: Pick<RampSpec, 'id' | 'material'>[]): Record<PartId, string | null> {
  const out = Object.fromEntries(PARTS.map((p) => [p.id, null])) as Record<PartId, string | null>;
  const taken = new Set<string>();
  const give = (part: (typeof PARTS)[number], r: Pick<RampSpec, 'id'> | undefined) => {
    if (!r) return;
    out[part.id] = r.id;
    taken.add(r.id);
  };
  const free = () => ramps.filter((r) => !taken.has(r.id));
  // a part's materials are in the order it likes them
  const liked = (p: (typeof PARTS)[number], list: typeof ramps) => p.likes.flatMap((m) => list.filter((r) => r.material === m))[0];
  for (const p of PARTS) give(p, liked(p, free()));
  for (const p of PARTS) if (!out[p.id]) give(p, free()[0]);
  PARTS.forEach((p, n) => {
    if (!out[p.id] && ramps.length) out[p.id] = (liked(p, ramps) ?? ramps[n % ramps.length]).id;
  });
  return out;
}

/** the ramp each part shows: the one chosen, if the palette still has it, else the default */
export function partRamps(d: IllustrationDoc, chosen: Record<string, string>): Record<PartId, string | null> {
  const def = defaultParts(d.ramps);
  return Object.fromEntries(PART_IDS.map((p) => [p, d.ramps.some((r) => r.id === chosen[p]) ? chosen[p] : def[p]])) as Record<PartId, string | null>;
}

// ── the view state ──────────────────────────────────────────────────────────────────────────────

export type LayersView = {
  layerShow: 'flats' | 'recipe' | 'target';
  /** ramp ids left out of the recipe, made the background, and starred (the rest are in, in the character, and plain) */
  layerOut: string[];
  layerBg: string[];
  layerStar: string[];
  /** part id → ramp id, for the parts the user chose a ramp for */
  layerParts: Record<string, string>;
  layerLight: 'add' | 'screen';
  layerSpace: Space;
  /** Rim and Mood: opacity in whole percent, and whether each is on */
  layerRim: number;
  layerRimOn: boolean;
  layerMood: number;
  layerMoodOn: boolean;
};

export const DEFAULT_LAYERS: LayersView = {
  layerShow: 'recipe',
  layerOut: [],
  layerBg: [],
  layerStar: [],
  layerParts: {},
  // Screen first: Add can blow bright flats out; the switch is on the Light row
  layerLight: 'screen',
  layerSpace: 'srgb',
  layerRim: 35,
  layerRimOn: true,
  layerMood: 15,
  layerMoodOn: false,
};

export const LAYER_ENUMS = {
  layerShow: ['flats', 'recipe', 'target'],
  layerLight: ['add', 'screen'],
  layerSpace: ['srgb', 'linear'],
} as const;

/** whole percent, 0 to 100; anything else is the default */
export const cleanPct = (raw: unknown, def: number): number => (typeof raw === 'number' && Number.isFinite(raw) ? Math.round(Math.min(100, Math.max(0, raw))) : def);

const strings = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string'))] : []);

/** the Layers part of a saved view, field by field: odd values fall back, lists keep their strings once, the part choices keep real parts */
export function cleanLayers(raw: Record<string, unknown>, out: Record<string, unknown>): void {
  out.layerRim = cleanPct(raw.layerRim, DEFAULT_LAYERS.layerRim);
  out.layerMood = cleanPct(raw.layerMood, DEFAULT_LAYERS.layerMood);
  for (const k of ['layerOut', 'layerBg', 'layerStar'] as const) out[k] = strings(raw[k]);
  const parts = typeof raw.layerParts === 'object' && raw.layerParts !== null && !Array.isArray(raw.layerParts) ? (raw.layerParts as Record<string, unknown>) : {};
  out.layerParts = Object.fromEntries(PART_IDS.filter((p) => typeof parts[p] === 'string').map((p) => [p, parts[p]]));
}

// ── the flats ───────────────────────────────────────────────────────────────────────────────────

/** one ramp as a flat: its base colour, and its own steps as the targets */
export function flatOf(d: IllustrationDoc, r: RampSpec, v: Pick<LayersView, 'layerBg' | 'layerStar'>): FlatIn {
  const base = baseOf(d, r.id)?.oklch ?? r.base;
  return {
    id: r.id,
    name: rampName(d, r),
    hex: toHex(base).toUpperCase(),
    material: r.material,
    star: v.layerStar.includes(r.id),
    background: v.layerBg.includes(r.id),
    targets: targetsFrom({ ...r, base }, stepsOf(d, r.id).map((w) => ({ step: w.step ?? 0, oklch: w.oklch }))),
  };
}

/** every ramp as a flat, in palette order: the picture shows them all, the recipe only those that are in it */
export const allFlats = (d: IllustrationDoc, v: Pick<LayersView, 'layerBg' | 'layerStar'>): FlatIn[] => d.ramps.map((r) => flatOf(d, r, v));

/** the flats the recipe is solved for: the ramps not left out */
export const recipeFlats = (flats: FlatIn[], v: Pick<LayersView, 'layerOut'>): FlatIn[] => flats.filter((f) => !v.layerOut.includes(f.id));

// ── the layers ──────────────────────────────────────────────────────────────────────────────────

export type LayerKey = 'rim' | 'mood' | 'light' | 'shadow2' | 'shadow' | 'cast';

/** a layer as the panel and the text list it */
export type Row = {
  key: LayerKey;
  name: string;
  mode: Mode;
  hex: string;
  pct: number;
  on: boolean;
  /** where it lands, in words: also the end of its line in the recipe text */
  note: string;
  /** fit in words, and how it reads */
  fit: string;
  tone: 'good' | 'bad' | null;
};

const fitTone = (dist: number): Row['tone'] => (dist < CLOSE ? 'good' : dist >= OFF ? 'bad' : null);

/**
 * The layers, top of the stack first: Rim and Mood from the palette's light and the view, then the solved ones
 * that exist. `names` turns a flat id into its name.
 */
export function rowsOf(r: Recipe, flats: FlatIn[], pair: LightPair, v: Pick<LayersView, 'layerRim' | 'layerRimOn' | 'layerMood' | 'layerMoodOn'>, eyes: Eyes): Row[] {
  const name = (id: string) => flats.find((f) => f.id === id)?.name ?? '';
  const solved = (key: LayerKey, label: string, s: Solved, on: boolean, note: string, fit?: string, tone?: Row['tone']): Row => ({
    key,
    name: label,
    mode: s.mode,
    hex: s.hex,
    pct: s.pct,
    on,
    note,
    fit: fit ?? fitWord(s.worst.dist, name(s.worst.id)),
    tone: tone === undefined ? fitTone(s.worst.dist) : tone,
  });
  const rows: Row[] = [
    { key: 'rim', name: 'Rim', mode: 'add', hex: rimColour(pair), pct: v.layerRim, on: v.layerRimOn, note: 'over the character', fit: 'set by you', tone: null },
    { key: 'mood', name: 'Mood', mode: 'overlay', hex: moodColour(pair), pct: v.layerMood, on: v.layerMoodOn, note: 'over the whole picture', fit: 'set by you', tone: null },
    solved('light', 'Light', r.light, eyes.light, 'over the character'),
  ];
  const above = r.shadow2 ? `; the layer above adjusts ${r.shadow2.clip.map(name).join(' and ')}` : '';
  if (r.shadow2) {
    const f = r.shadow2;
    rows.push(solved('shadow2', 'Shadow 2', f, eyes.shadow2 && eyes.shadow, `clipped to: ${f.clip.map(name).join(', ')}`, eyes.shadow ? `${fitWord(f.worst.dist, name(f.worst.id))}, Shadow under it` : 'needs the Shadow under it'));
  }
  const sw = fitWord(r.shadow.worst.dist, name(r.shadow.worst.id));
  rows.push(solved('shadow', 'Shadow', r.shadow, eyes.shadow, 'clipped to the character', `${sw}${above}`, r.shadow2 ? null : fitTone(r.shadow.worst.dist)));
  if (r.cast) rows.push(solved('cast', 'Cast shadow', r.cast, eyes.cast, 'on the background'));
  return rows;
}

/** how every layer lands together, in words, for the line under the stack */
export function allTogether(r: Recipe, flats: FlatIn[]): { label: string; fit: string; tone: Row['tone'] }[] {
  const name = (id: string) => flats.find((f) => f.id === id)?.name ?? '';
  return [
    { label: 'Shadow, all layers together', fit: fitWord(r.shadowAll.dist, name(r.shadowAll.id)), tone: fitTone(r.shadowAll.dist) },
    { label: 'Light', fit: fitWord(r.lightAll.dist, name(r.lightAll.id)), tone: fitTone(r.lightAll.dist) },
  ];
}

/** the plain hint under the stack: why there is a second Shadow or not, what the Cast shadow is for, where the light falls short */
export function hintOf(r: Recipe, flats: FlatIn[]): string {
  const name = (id: string) => flats.find((f) => f.id === id)?.name ?? '';
  const names = r.shadow2 ? r.shadow2.clip.map(name).join(' and ') : '';
  const bg = flats.filter((f) => f.background).map((f) => f.name).join(' and ');
  const shadow = r.shadow2
    ? r.shadowAll.dist < OFF
      ? `One Multiply cannot fit every character flat: ${names} would go muddy or stay visibly off. The second Shadow, clipped to ${r.shadow2.clip.length > 1 ? 'them' : 'it'}, brings them close.`
      : `One Multiply cannot fit every character flat. A second Shadow clipped to ${names} helps, but ${name(r.shadowAll.id)} stays a little off even with it.`
    : 'One Multiply fits every character flat well enough, so there is no second shadow layer.';
  const cast = r.cast ? ` The Cast shadow is solved for ${bg} alone, so the Shadow is not tuned to it.` : '';
  const weak = r.lightAll.dist >= OFF ? ` ${r.lightMode === 'add' ? 'Add' : 'Screen'} lifts every flat by a similar amount, so the light is a weak match on ${name(r.lightAll.id)}.` : '';
  return shadow + cast + weak;
}

/** the layer names for the Add colours to the palette proposals: "Shadow · Multiply 80%" */
export const proposalName = (row: Pick<Row, 'name' | 'mode' | 'pct'>): string => `${row.name} · ${MODE_NAME[row.mode].replace(' (Linear Dodge)', '')} ${row.pct}%`;

// ── the picture ─────────────────────────────────────────────────────────────────────────────────

/** `mask`: where the layer lands (null: the whole picture); `clip`: the parts it is clipped to */
type Step = { rgb: Rgb; mode: Mode; pct: number; mask: Float32Array | null; clip?: Float32Array };

/** The recipe laid over the flats in `px`, bottom first: the Cast shadow, the Shadow, the second Shadow, the Light, the Mood, the Rim. */
export function paintRecipe(bust: Bust, px: Uint8ClampedArray, rows: Row[], clips: { character: Float32Array; background: Float32Array; second: Float32Array | null }, space: Space): void {
  const by = Object.fromEntries(rows.map((r) => [r.key, r])) as Partial<Record<LayerKey, Row>>;
  const steps: (Step | null)[] = [
    by.cast?.on ? { ...stepOf(by.cast), mask: bust.shadow, clip: clips.background } : null,
    by.shadow?.on ? { ...stepOf(by.shadow), mask: bust.shadow, clip: clips.character } : null,
    by.shadow2?.on && clips.second ? { ...stepOf(by.shadow2), mask: bust.shadow, clip: clips.second } : null,
    by.light?.on ? { ...stepOf(by.light), mask: bust.light, clip: clips.character } : null,
    by.mood?.on ? { ...stepOf(by.mood), mask: null } : null,
    by.rim?.on ? { ...stepOf(by.rim), mask: bust.rim } : null,
  ];
  for (const s of steps) {
    if (!s) continue;
    for (let p = 0; p < bust.part.length; p++) {
      const c = (s.mask ? s.mask[p] : 1) * (s.clip ? s.clip[p] : 1);
      if (c > 0) compositeAt(px, p * 4, s.rgb, s.mode, s.pct, space, c);
    }
  }
}
const stepOf = (r: Row) => ({ rgb: hexRgb(r.hex), mode: r.mode, pct: r.pct });

/** The ramps' own shadow, light and rim steps painted through the same shapes, to see what the recipe is aiming at. `targets[part]`: [shadow, light, rim] as 8-bit colours. */
export function paintTargets(bust: Bust, px: Uint8ClampedArray, targets: Record<PartId, [Rgb, Rgb, Rgb] | null>): void {
  const mix = (p: number, cov: number, rgb: Rgb) => {
    if (cov > 0) for (let c = 0; c < 3; c++) px[p * 4 + c] = Math.round(px[p * 4 + c] + (rgb[c] - px[p * 4 + c]) * cov);
  };
  for (let p = 0; p < bust.part.length; p++) {
    const t = targets[PART_IDS[bust.part[p]]];
    if (!t) continue;
    mix(p, bust.shadow[p], t[0]);
    mix(p, bust.light[p], t[1]);
    mix(p, bust.rim[p], t[2]);
  }
}

/** a flat's shadow stack as the rows show it, for the table of what each flat becomes in the other space */
export function shadowIn(f: FlatIn, r: Recipe, eyes: Eyes, space: Space): string {
  return shadeFlat(f.hex, shadowStack(f, r, eyes), space);
}
