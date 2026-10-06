// What a new palette is started from: the scene's light (presets, and reading the one the ramps share),
// the subjects a single ramp can be made for, and the limited sets of bases. All taste, all editable:
// they are starting points, none of them a rule. Pure (no DOM), so it is unit tested.
import type { Oklch } from '../../../shared/color/index.ts';
import { DAYLIGHT } from '../../../shared/palette/ramp.ts';
import { fitChroma, wrapHue } from '../../../shared/palette/space.ts';
import type { MaterialId, RampSpec } from '../../../shared/types.ts';
import { baseOf, looseOf, type IllustrationDoc } from './doc.ts';

export type LightPair = { light: Oklch; shadow: Oklch };
export type LightPreset = LightPair & { id: string; label: string };

/** the scene lights: the colour the lit side leans to, and the colour its shadow does (warm light, cool shadow; or the other way round indoors) */
export const LIGHTS: LightPreset[] = [
  { id: 'daylight', label: 'Daylight', ...DAYLIGHT },
  { id: 'golden', label: 'Golden hour', light: [0.94, 0.1, 72], shadow: [0.4, 0.09, 290] },
  { id: 'overcast', label: 'Overcast', light: [0.92, 0.012, 240], shadow: [0.45, 0.02, 260] },
  { id: 'moon', label: 'Moonlight', light: [0.82, 0.05, 250], shadow: [0.25, 0.07, 285] },
  { id: 'interior', label: 'Warm interior', light: [0.95, 0.09, 68], shadow: [0.35, 0.07, 20] },
  { id: 'studio', label: 'Studio neutral', light: [0.97, 0.005, 90], shadow: [0.35, 0.01, 270] },
];

const near = (a: Oklch, b: Oklch) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const sameLight = (a: LightPair, b: LightPair) => near(a.light, b.light) && near(a.shadow, b.shadow);
export const presetOf = (p: LightPair): LightPreset | null => LIGHTS.find((x) => sameLight(x, p)) ?? null;

/** The light row's reading of the palette: the pair the ramps share (or, with none, the one the next is born with), and what it is. */
export function sceneLight(d: IllustrationDoc, selectedRamp?: string): { pair: LightPair; preset: LightPreset | null; mixed: boolean } {
  const [first, ...rest] = d.ramps;
  if (!first) {
    const pair = d.scene ?? DAYLIGHT;
    return { pair, preset: presetOf(pair), mixed: false };
  }
  const mixed = rest.some((r) => !sameLight(r, first));
  // while they disagree, the swatches are the selected ramp's: what Edit opens
  const shown: Pick<RampSpec, 'light' | 'shadow'> = mixed ? (d.ramps.find((r) => r.id === selectedRamp) ?? d.ramps.at(-1)!) : first;
  const pair = { light: shown.light, shadow: shown.shadow };
  return { pair, preset: mixed ? null : presetOf(pair), mixed };
}

// ── subjects: one ramp, named and made of its material ─────────────────────────────────────────

export type Subject = { id: string; label: string; base: Oklch; material: MaterialId };

export const SUBJECTS: Subject[] = [
  { id: 'skin', label: 'Skin', base: [0.74, 0.075, 55], material: 'skin' },
  { id: 'hair', label: 'Hair', base: [0.36, 0.06, 50], material: 'fur' },
  { id: 'foliage', label: 'Foliage', base: [0.6, 0.12, 140], material: 'foliage' },
  { id: 'sky', label: 'Sky', base: [0.78, 0.08, 235], material: 'paper' },
  { id: 'cloth', label: 'Cloth', base: [0.55, 0.09, 250], material: 'cloth' },
  { id: 'metal', label: 'Metal', base: [0.62, 0.02, 260], material: 'metal' },
  { id: 'stone', label: 'Stone', base: [0.58, 0.03, 70], material: 'stone' },
  { id: 'wood', label: 'Wood', base: [0.5, 0.08, 60], material: 'wood' },
  { id: 'water', label: 'Water', base: [0.6, 0.09, 220], material: 'water' },
];

// ── limited sets: a few bases that sit apart in value ───────────────────────────────────────────

export type LimitedSet = {
  id: string;
  label: string;
  /** one line: the rule it follows */
  rule: string;
  /** false: its colours are fixed, whatever hue is asked for */
  usesHue: boolean;
  /** 3 to 5 bases, lightest first, `hue` the one the set is built around */
  make(hue: number): Oklch[];
};

const on = (...cs: Oklch[]): Oklch[] => cs.map((c) => fitChroma([c[0], c[1], wrapHue(c[2])]));

export const SETS: LimitedSet[] = [
  { id: 'triad', label: 'Atmospheric triad', rule: 'A pale glow, a muted opposite and one deep dark: three values, three moods.', usesHue: true, make: (h) => on([0.84, 0.07, h], [0.6, 0.06, h + 150], [0.34, 0.06, h + 235]) },
  { id: 'pair', label: 'Complementary pair', rule: 'A colour and its opposite, one light and one dark.', usesHue: true, make: (h) => on([0.76, 0.12, h], [0.44, 0.1, h + 180]) },
  { id: 'analogous', label: 'Analogous', rule: 'Four neighbours on the wheel, stepping from light to dark.', usesHue: true, make: (h) => on([0.82, 0.09, h - 36], [0.67, 0.12, h - 12], [0.52, 0.12, h + 12], [0.38, 0.09, h + 36]) },
  { id: 'earth', label: 'Earth four', rule: 'Ochre, sienna, umber and a blue-black: a limited earth palette.', usesHue: false, make: () => on([0.78, 0.1, 90], [0.6, 0.13, 50], [0.42, 0.07, 60], [0.28, 0.03, 250]) },
];

// ── a Library palette's colours ──────────────────────────────────────────────────────────────────

/** a palette holds this many ramps; a source that would pass it is cut short and says so */
export const MAX_RAMPS = 24;

export type Candidate = { oklch: Oklch; name: string | null; material?: MaterialId };

/**
 * A palette's colours as bases for new ramps: each ramp's base with its name and material, then the
 * colours in no ramp, in the order the palette holds them; at most `room` of them, `total` of them there.
 */
export function paletteBases(from: IllustrationDoc, room: number): { list: Candidate[]; total: number } {
  const ramps = from.ramps.map((r): Candidate => {
    const b = baseOf(from, r.id);
    return { oklch: b?.oklch ?? r.base, name: b?.name.trim() || r.name?.trim() || null, material: r.material };
  });
  const loose = looseOf(from).map((w): Candidate => ({ oklch: w.oklch, name: w.name.trim() || null }));
  const all = [...ramps, ...loose];
  return { list: all.slice(0, Math.max(0, room)), total: all.length };
}
