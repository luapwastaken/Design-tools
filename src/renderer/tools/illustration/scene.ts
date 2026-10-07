// What a new palette is started from: the scene's light (presets, and reading the one the ramps share),
// the subjects a single ramp can be made for, and the limited sets of bases. All taste, all editable:
// they are starting points, none of them a rule. Pure (no DOM), so it is unit tested.
import type { Oklch } from '../../../shared/color/index.ts';
import { DAYLIGHT } from '../../../shared/palette/ramp.ts';
import { fitChroma, wrapHue } from '../../../shared/palette/space.ts';
import type { MaterialId, RampSpec } from '../../../shared/types.ts';
import { baseOf, looseOf, MAX_RAMPS, type IllustrationDoc } from './doc.ts';

export type LightPair = { light: Oklch; shadow: Oklch };
export type LightPreset = LightPair & { id: string; label: string };

/**
 * The scene lights: the colour the lit side leans to, and the colour its shadow does (warm light, cool
 * shadow out of doors; the other way round indoors). Each pair sits clear of the others in hue or in
 * how dark it goes, so choosing one visibly moves the ramps (test/illustration-scene.test.ts).
 */
export const LIGHTS: LightPreset[] = [
  { id: 'daylight', label: 'Daylight', ...DAYLIGHT },
  { id: 'golden', label: 'Golden hour', light: [0.87, 0.09, 65], shadow: [0.36, 0.105, 333] },
  { id: 'dusk', label: 'Dusk', light: [0.675, 0.16, 1.5], shadow: [0.306, 0.121, 292] },
  { id: 'twilight', label: 'Twilight', light: [0.64, 0.07, 300], shadow: [0.287, 0.065, 250] },
  { id: 'moon', label: 'Moonlight', light: [0.777, 0.065, 215], shadow: [0.25, 0.067, 261] },
  { id: 'overcast', label: 'Overcast', light: [0.84, 0.028, 233], shadow: [0.48, 0.039, 240] },
  { id: 'interior', label: 'Warm interior', light: [0.91, 0.09, 95], shadow: [0.37, 0.083, 27] },
  { id: 'studio', label: 'Studio neutral', light: [0.978, 0.008, 90], shadow: [0.293, 0.006, 270] },
];

const near = (a: Oklch, b: Oklch) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const sameLight = (a: LightPair, b: LightPair) => near(a.light, b.light) && near(a.shadow, b.shadow);
/** a colour typed as hex lands within a hex step of the preset's: close in lightness and chroma, and in hue where it has one */
const nearly = (a: Oklch, b: Oklch) => {
  const turn = Math.abs(((a[2] - b[2] + 540) % 360) - 180);
  return Math.abs(a[0] - b[0]) < 0.006 && Math.abs(a[1] - b[1]) < 0.006 && (Math.min(a[1], b[1]) < 0.012 || turn < 2);
};
/** the preset a pair is: its exact values, or the same colours typed as hex */
export const presetOf = (p: LightPair): LightPreset | null => LIGHTS.find((x) => nearly(x.light, p.light) && nearly(x.shadow, p.shadow)) ?? null;

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
  // skin and hair come in a few tones, each born with the subject's material
  { id: 'skin-light', label: 'Skin light', base: [0.86, 0.05, 60], material: 'skin' },
  { id: 'skin', label: 'Skin medium', base: [0.74, 0.075, 55], material: 'skin' },
  { id: 'skin-deep', label: 'Skin deep', base: [0.45, 0.07, 48], material: 'skin' },
  { id: 'hair-blonde', label: 'Hair blonde', base: [0.78, 0.09, 85], material: 'fur' },
  { id: 'hair', label: 'Hair brown', base: [0.36, 0.06, 50], material: 'fur' },
  { id: 'hair-black', label: 'Hair black', base: [0.2, 0.015, 60], material: 'fur' },
  { id: 'hair-red', label: 'Hair red', base: [0.5, 0.14, 40], material: 'fur' },
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

export { MAX_RAMPS };

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
