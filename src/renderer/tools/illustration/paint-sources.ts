// What the paint canvas can load a brush with: the owned pigments, any palette colour, and the
// mixing well's mix. Plus its settings as view state (never in history).
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import { colourOf, mixCurves, paintOf } from '../../../shared/paint/km.ts';
import type { Pigment } from '../../../shared/paint/pigments.ts';
import type { Recipe } from '../../../shared/paint/recipe.ts';
import type { Swatch } from '../../../shared/types.ts';
import type { BrushKind, Loaded, Medium } from './paint/types.ts';

export type PaintTool = 'paint' | 'smudge' | 'pick';
export type WellPart = { id: string; parts: number };

/** The canvas's view state: the integrator keeps it in the tool's view, sanitised with `paintSettings`. */
export type PaintSettings = {
  tool: PaintTool;
  medium: Medium;
  /** the brush each medium last had: it follows the medium */
  brushes: Record<Medium, BrushKind>;
  /** brush diameter, painting px (the 2048 painting) */
  size: number;
  /** percent: paint held, or the smudge's strength */
  load: number;
  /** the brush's paint: a pigment id, `swatch:<id>`, or 'well' */
  paint: string;
  well: WellPart[];
};

export const SIZE = { min: 2, max: 400 };
export const LOAD = { min: 5, max: 100 };
export const WELL_MAX = 4;
/** recipes put white in at up to 128 parts, and any recipe fits the well */
export const PARTS_MAX = 128;

/** what to do when nothing is on the brush: `emptyTray`, nothing owned to load at all */
export const loadHint = (emptyTray: boolean): string => (emptyTray ? 'Tick a paint you own to load the brush' : 'Click a paint in the tray to load the brush');

export const BRUSHES: { value: BrushKind; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'flat', label: 'Flat' },
  { value: 'dry', label: 'Dry brush' },
];

export const DEFAULT_PAINT: PaintSettings = { tool: 'paint', medium: 'wet', brushes: { wet: 'round', dry: 'flat' }, size: 80, load: 70, paint: 'ultra', well: [] };

const TOOLS: readonly string[] = ['paint', 'smudge', 'pick'];
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const brush = (v: unknown, fallback: BrushKind): BrushKind => (BRUSHES.some((b) => b.value === v) ? (v as BrushKind) : fallback);

/** a saved view, field by field; anything odd falls back to the default */
export function paintSettings(raw: unknown): PaintSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const well = Array.isArray(r.well)
    ? r.well
        .filter((p): p is WellPart => typeof p?.id === 'string' && typeof p?.parts === 'number')
        .slice(0, WELL_MAX)
        .map((p) => ({ id: p.id, parts: num(p.parts, 1, PARTS_MAX, 1) }))
    : [];
  const b = (typeof r.brushes === 'object' && r.brushes !== null ? r.brushes : {}) as Record<string, unknown>;
  // settings from before the 2048 painting have no brushes: their sizes were on a painting half as wide
  const size = 'brushes' in r || typeof r.size !== 'number' ? r.size : r.size * 2;
  return {
    tool: TOOLS.includes(r.tool as string) ? (r.tool as PaintTool) : DEFAULT_PAINT.tool,
    medium: r.medium === 'dry' ? 'dry' : 'wet',
    brushes: { wet: brush(b.wet, DEFAULT_PAINT.brushes.wet), dry: brush(b.dry, DEFAULT_PAINT.brushes.dry) },
    size: num(size, SIZE.min, SIZE.max, DEFAULT_PAINT.size),
    load: num(r.load, LOAD.min, LOAD.max, DEFAULT_PAINT.load),
    paint: typeof r.paint === 'string' ? r.paint : DEFAULT_PAINT.paint,
    well,
  };
}

/** A paint in the tray: a pigment as bought, or a palette colour with middling traits (`set`: its ramp, as the tray groups them). */
export type Source = { id: string; name: string; pigment: Pigment; swatch: boolean; set?: PaletteSet };

/** the palette's colours come in sets (a ramp each, then the loose ones), named as the tool names them */
export type PaletteSet = { key: string; name: string; swatches: Swatch[] };

export function sourcesOf(pigments: Pigment[], sets: PaletteSet[]): Source[] {
  return [
    ...pigments.map((pigment) => ({ id: pigment.id, name: pigment.name, pigment, swatch: false })),
    ...sets.flatMap((set) =>
      set.swatches.map((w) => {
        const name = w.name.trim() || toHex(w.oklch).toUpperCase();
        return {
          id: `swatch:${w.id}`,
          name,
          pigment: { id: `swatch:${w.id}`, name, oklch: w.oklch, tint: 1, opacity: 0.6, granulation: 0, staining: 0.4 },
          swatch: true,
          set,
        };
      }),
    ),
  ];
}

/** `swatch`: a palette colour, which the engine lays harder (its paint is weak beside a tube's) so it reads as itself */
export const loadedOf = (p: Pigment, swatch = false): Loaded => ({ paint: paintOf(p), opacity: p.opacity, granulation: p.granulation, staining: p.staining, ...(swatch && { swatch }) });

/** the well's paints mixed by parts (km.ts); its traits the parts' average. Null when empty. */
export function wellMix(well: WellPart[], sources: Source[]): { loaded: Loaded; oklch: Oklch } | null {
  const parts = well.flatMap((w) => {
    const s = sources.find((x) => x.id === w.id);
    return s ? [{ pigment: s.pigment, swatch: s.swatch, parts: w.parts }] : [];
  });
  const total = parts.reduce((t, p) => t + p.parts, 0);
  if (!total) return null;
  const paint = mixCurves(parts.map((p) => ({ paint: paintOf(p.pigment), amount: p.parts })));
  const avg = (k: 'opacity' | 'granulation' | 'staining') => parts.reduce((t, p) => t + p.pigment[k] * p.parts, 0) / total;
  // a well of palette colours alone is laid as they are; one tube in it and the mix is the tube's to weigh
  const swatch = parts.every((p) => p.swatch);
  return { loaded: { paint, opacity: avg('opacity'), granulation: avg('granulation'), staining: avg('staining'), ...(swatch && { swatch }) }, oklch: colourOf(paint) };
}

/** add one part of a paint (a new paint joins at 1 part); null when the well is full */
export function addToWell(well: WellPart[], id: string): WellPart[] | null {
  if (well.some((w) => w.id === id)) return well.map((w) => (w.id === id ? { ...w, parts: Math.min(PARTS_MAX, w.parts + 1) } : w));
  return well.length < WELL_MAX ? [...well, { id, parts: 1 }] : null;
}

/** a recipe's paints by their parts, as the well holds them */
export const wellFromRecipe = (r: Recipe): WellPart[] => r.parts.slice(0, WELL_MAX).map((p) => ({ id: p.pigment.id, parts: Math.min(PARTS_MAX, Math.max(1, Math.round(p.parts))) }));

/** the paint that takes over from `id` when it leaves the tray: the next one still there, else the one before; null when the tray is empty */
export function neighbourOf(prevIds: readonly string[], nextIds: readonly string[], id: string): string | null {
  const still = new Set(nextIds);
  const at = prevIds.indexOf(id);
  if (at < 0) return nextIds[0] ?? null;
  return prevIds.slice(at + 1).find((x) => still.has(x)) ?? prevIds.slice(0, at).findLast((x) => still.has(x)) ?? nextIds[0] ?? null;
}
