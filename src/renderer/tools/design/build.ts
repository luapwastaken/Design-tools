// Build's proposal makers that work from the palette itself (spec §3).
import { generate, PRESETS } from '../../../shared/palette/generate.ts';
import { gradientStops } from '../../../shared/palette/gradient.ts';
import { harmony, type HarmonyKind } from '../../../shared/palette/harmony.ts';
import type { Swatch } from '../../../shared/types.ts';
import { displayName, type DesignView } from './doc.ts';
import { propose, proposalsFrom } from './proposals.ts';
import { getView } from './view-state.ts';

export const HARMONIES: { kind: HarmonyKind; label: string }[] = [
  { kind: 'complementary', label: 'Complementary' },
  { kind: 'analogous', label: 'Analogous' },
  { kind: 'triad', label: 'Triad' },
  { kind: 'split', label: 'Split complementary' },
  { kind: 'tetrad', label: 'Tetrad' },
];

export function runHarmony(base: Swatch, kind: HarmonyKind): void {
  const label = HARMONIES.find((x) => x.kind === kind)!.label;
  propose('harmony', `${label} of ${displayName(base)}`, harmony(base.oklch, kind));
}

/**
 * `v.count` new colours around the palette's own: its swatches go in as locked slots, so the
 * lightness spread leaves room for them (and a preset with no hues of its own follows theirs). A
 * reroll keeps the locked ghosts in their slots.
 */
export function runGenerate(palette: Swatch[], v: DesignView = getView()): void {
  const prev = proposalsFrom('generate')?.items ?? [];
  const locked = Array.from({ length: v.count }, (_, i) => (prev[i]?.locked ? prev[i].oklch : null));
  const own = palette.map((w) => w.oklch);
  const made = generate({ seed: v.seed, count: own.length + v.count, preset: v.preset, locked: [...own, ...locked] }).slice(own.length);
  const preset = PRESETS.find((p) => p.id === v.preset)?.label ?? 'Palette';
  propose('generate', `${preset} · seed ${v.seed}`, made, [], locked.map(Boolean));
}

export function runGradient(a: Swatch, b: Swatch, v: DesignView = getView()): void {
  propose('gradient', `${displayName(a)} to ${displayName(b)}`, gradientStops(a.oklch, b.oklch, v.stops, v.space));
}
