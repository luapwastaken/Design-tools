// What the paint canvas can load a brush with (plan unit C): the owned pigments, any palette
// colour, and the mixing well's mix. Plus its settings as view state (never in history).
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import { colourOf, mixCurves, paintOf } from '../../../shared/paint/km.ts';
import type { Pigment } from '../../../shared/paint/pigments.ts';
import type { Swatch } from '../../../shared/types.ts';
import type { Loaded, Medium } from './paint-sim.ts';

export type PaintTool = 'paint' | 'smudge' | 'pick';
export type WellPart = { id: string; parts: number };

/** The canvas's view state: the integrator keeps it in the tool's view, sanitised with `paintSettings`. */
export type PaintSettings = {
  tool: PaintTool;
  medium: Medium;
  /** brush diameter, canvas pixels */
  size: number;
  /** percent: paint held, or the smudge's strength */
  load: number;
  /** the brush's paint: a pigment id, `swatch:<id>`, or 'well' */
  paint: string;
  well: WellPart[];
};

export const SIZE = { min: 2, max: 200 };
export const LOAD = { min: 5, max: 100 };
export const WELL_MAX = 4;
export const PARTS_MAX = 9;

export const DEFAULT_PAINT: PaintSettings = { tool: 'paint', medium: 'wet', size: 40, load: 70, paint: 'ultra', well: [] };

const TOOLS: readonly string[] = ['paint', 'smudge', 'pick'];
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** a saved view, field by field; anything odd falls back to the default */
export function paintSettings(raw: unknown): PaintSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const well = Array.isArray(r.well)
    ? r.well
        .filter((p): p is WellPart => typeof p?.id === 'string' && typeof p?.parts === 'number')
        .slice(0, WELL_MAX)
        .map((p) => ({ id: p.id, parts: num(p.parts, 1, PARTS_MAX, 1) }))
    : [];
  return {
    tool: TOOLS.includes(r.tool as string) ? (r.tool as PaintTool) : DEFAULT_PAINT.tool,
    medium: r.medium === 'dry' ? 'dry' : 'wet',
    size: num(r.size, SIZE.min, SIZE.max, DEFAULT_PAINT.size),
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

export const loadedOf = (p: Pigment): Loaded => ({ paint: paintOf(p), opacity: p.opacity, granulation: p.granulation });

/** the well's paints mixed by parts (km.ts); its traits the parts' average. Null when empty. */
export function wellMix(well: WellPart[], sources: Source[]): { loaded: Loaded; oklch: Oklch } | null {
  const parts = well.flatMap((w) => {
    const s = sources.find((x) => x.id === w.id);
    return s ? [{ pigment: s.pigment, parts: w.parts }] : [];
  });
  const total = parts.reduce((t, p) => t + p.parts, 0);
  if (!total) return null;
  const paint = mixCurves(parts.map((p) => ({ paint: paintOf(p.pigment), amount: p.parts })));
  const avg = (k: 'opacity' | 'granulation') => parts.reduce((t, p) => t + p.pigment[k] * p.parts, 0) / total;
  return { loaded: { paint, opacity: avg('opacity'), granulation: avg('granulation') }, oklch: colourOf(paint) };
}

/** add one part of a paint (a new paint joins at 1 part); null when the well is full */
export function addToWell(well: WellPart[], id: string): WellPart[] | null {
  if (well.some((w) => w.id === id)) return well.map((w) => (w.id === id ? { ...w, parts: Math.min(PARTS_MAX, w.parts + 1) } : w));
  return well.length < WELL_MAX ? [...well, { id, parts: 1 }] : null;
}
