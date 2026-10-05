// The Design tool's document and view state (plan: Document and view).
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import type { PalettePayload, RampSpec, Swatch } from '../../../shared/types.ts';
import type { ExportFormat } from '../common/ExportPalette.tsx';

import { displayName, named } from '../common/names.ts';

export { displayName, listNames, named, plural } from '../common/names.ts';

/** `ramps`: Illustration's ramp settings, kept so they go back into the file unchanged */
export type DesignDoc = { swatches: Swatch[]; notes: string; ramps?: RampSpec[] };

export type BuildMethod = 'harmony' | 'generate' | 'image' | 'logo' | 'gradient' | 'paste';
/** the tabs under the palette and picker; the active one is saved in the view */
export type DesignTab = 'contrast' | 'check' | 'preview' | 'tints';
/** the view filter over the artboard and the In use page; never written to the document */
export type Simulate = 'normal' | Cvd | 'greyscale';
export type CheckId = 'contrast' | 'value' | 'vision' | 'print';

/** Never in history: saved with the workspace through shell.setView (spec §7.1). */
export type DesignView = {
  /** swatch ids; the first is the active one (inspector) */
  selected: string[];
  tab: DesignTab;
  /** the Colour vision card's chosen simulation */
  cvd: Cvd;
  /** the view filter on the palette row and the Preview tab */
  sim: Simulate;
  /** swatch ids pinned with L: a re-roll keeps them, Delete leaves them */
  locked: string[];
  /** the Check palette tab's Print list shows the reference-inks table */
  inks: boolean;
  /** Value and Hue lock: the OKLCH picker's drags keep L or H; typed values still change them (spec §5) */
  lockL: boolean;
  lockH: boolean;
  /** Value check: flag pairs closer than this, in L × 100 */
  flagL: number;
  /** Colour vision check: flag pairs closer than this ΔE */
  flagE: number;
  format: ExportFormat;
  preset: string;
  count: number;
  seed: number;
  /** Image: how many colours to pull */
  k: number;
  stops: number;
  space: 'oklch' | 'oklab';
};

export const emptyDoc = (): DesignDoc => ({ swatches: [], notes: '' });

/** each swatch's name as the palette shows it: blank ones filled in, an Illustration ramp step by its ramp ("Cloth shadow") */
export const namesOf = (d: DesignDoc): Map<string, string> => new Map(named(d.swatches, d.ramps).map((w) => [w.id, w.name]));
export const nameIn = (d: DesignDoc, w: Swatch): string => (w.name.trim() ? w.name : (namesOf(d).get(w.id) ?? displayName(w)));

// a hand-edited or imported file may leave these out
const tidy = (w: Swatch): Swatch => ({ ...w, role: w.role ?? null, type: w.type ?? 'process' });

/** The palette file's contents. An Illustration palette's ramps and each swatch's group, step and edited go back as they came. */
export const toPayload = (d: DesignDoc): Pick<PalettePayload, 'swatches' | 'notes' | 'ramps'> => ({ swatches: d.swatches, notes: d.notes, ...(d.ramps && { ramps: d.ramps }) });

export function fromPayload(p: Pick<PalettePayload, 'swatches' | 'notes' | 'ramps'>): DesignDoc {
  return { swatches: p.swatches.map(tidy), notes: p.notes ?? '', ...(p.ramps && { ramps: p.ramps }) };
}

export const newSwatch = (oklch: Oklch, name = '', role: string | null = null): Swatch => ({
  id: crypto.randomUUID(),
  name,
  role,
  oklch,
  type: 'process',
});

export const mapSwatch = (d: DesignDoc, id: string, fn: (w: Swatch) => Swatch): DesignDoc => ({
  ...d,
  swatches: d.swatches.map((w) => (w.id === id ? fn(w) : w)),
});

/**
 * New colours; an edited colour is no longer the imported one, so its original values go
 * (Swatch.source). A "change" to the same colour changes nothing, so the imported values stay.
 * A step of an Illustration ramp becomes a hand-edited one, which regenerating the ramp leaves alone.
 */
export const recolour = (d: DesignDoc, changes: Record<string, Oklch>): DesignDoc => ({
  ...d,
  swatches: d.swatches.map((w) => {
    const next = changes[w.id];
    if (!next || next.every((v, i) => v === w.oklch[i])) return w;
    const { source: _, ...rest } = w;
    return { ...rest, oklch: next, ...(w.group !== undefined && { edited: true }) };
  }),
});

/** after `afterId` (the end when null or unknown) */
export function insertAfter(d: DesignDoc, afterId: string | null, add: Swatch[]): DesignDoc {
  const at = d.swatches.findIndex((w) => w.id === afterId);
  const i = at < 0 ? d.swatches.length : at + 1;
  return { ...d, swatches: [...d.swatches.slice(0, i), ...add, ...d.swatches.slice(i)] };
}

export const removeIds = (d: DesignDoc, ids: string[]): DesignDoc => ({ ...d, swatches: d.swatches.filter((w) => !ids.includes(w.id)) });

/** move `ids` (kept in palette order) to sit before the swatch at `index` of the current list */
export function moveIds(d: DesignDoc, ids: string[], index: number): DesignDoc {
  const moving = d.swatches.filter((w) => ids.includes(w.id));
  const before = d.swatches.slice(0, index).filter((w) => !ids.includes(w.id));
  const after = d.swatches.slice(index).filter((w) => !ids.includes(w.id));
  return { ...d, swatches: [...before, ...moving, ...after] };
}
