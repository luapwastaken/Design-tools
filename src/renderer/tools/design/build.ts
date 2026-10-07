// Build's proposal makers that work from the palette itself (spec §3).
import type { RoleColours } from '../../../shared/palette/brand.ts';
import { generate, PRESETS } from '../../../shared/palette/generate.ts';
import { gradientStops } from '../../../shared/palette/gradient.ts';
import { harmony, type HarmonyKind } from '../../../shared/palette/harmony.ts';
import type { Role } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { displayName, listNames, type DesignView } from './doc.ts';
import { propose, proposalsFrom } from './proposals.ts';
import { getView } from './view-state.ts';

export const HARMONIES: { kind: HarmonyKind; label: string }[] = [
  { kind: 'complementary', label: 'Complementary' },
  { kind: 'analogous', label: 'Analogous' },
  { kind: 'triad', label: 'Triad' },
  { kind: 'split', label: 'Split complementary' },
  { kind: 'tetrad', label: 'Tetrad' },
];

/** `withBase`: the base is not in the palette yet (a typed colour), so it is proposed with the rest */
export function runHarmony(base: Pick<Swatch, 'name' | 'oklch'>, kind: HarmonyKind, withBase = false): void {
  const label = HARMONIES.find((x) => x.kind === kind)!.label;
  propose('harmony', `${label} of ${displayName(base)}`, [...(withBase ? [base.oklch] : []), ...harmony(base.oklch, kind)]);
}

/**
 * `v.count` new colours around the palette's own: its swatches go in as locked slots, so the
 * lightness spread leaves room for them (and a style with no hues of its own follows theirs). A
 * reroll keeps the locked ghosts in their slots.
 */
export function runGenerate(palette: Swatch[], v: DesignView = getView()): void {
  const prev = proposalsFrom('generate')?.items ?? [];
  const locked = Array.from({ length: v.count }, (_, i) => (prev[i]?.locked ? prev[i].oklch : null));
  const own = palette.map((w) => w.oklch);
  // the hues it follows: every colour's, or only the selected one's
  const lead = v.suggestFrom === 'selected' ? palette.find((w) => w.id === v.selected[0]) : undefined;
  const made = generate({ seed: v.seed, count: own.length + v.count, preset: v.suggestStyle, locked: [...own, ...locked], hues: lead && [lead.oklch] }).slice(own.length);
  const preset = PRESETS.find((p) => p.id === v.suggestStyle)?.label ?? 'Palette';
  propose('generate', `${preset} · seed ${v.seed}`, made, [], locked.map(Boolean));
}

/** the jobs the palette lacks, derived round its own colours, each proposed for its role (Keep gives it) */
export function runComplete(missing: Role[], colours: RoleColours): void {
  propose('complete', `${listNames(missing)} to complete the palette`, missing.map((r) => colours[r]), [], [], missing.map((role) => ({ role })));
}

export function runGradient(a: Swatch, b: Swatch, v: DesignView = getView()): void {
  propose('gradient', `${displayName(a)} to ${displayName(b)}`, gradientStops(a.oklch, b.oklch, v.stops, v.space));
}
