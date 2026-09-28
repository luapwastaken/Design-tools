// The Design tool's document and view state (plan: Document and view).
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import { autoName } from '../../../shared/palette/names.ts';
import type { Swatch } from '../../../shared/types.ts';

export type DesignDoc = { swatches: Swatch[]; notes: string };

export type BuildTab = 'harmony' | 'generate' | 'image' | 'logo' | 'gradient' | 'paste';
export type ExportFormat = 'ase' | 'aco' | 'gpl' | 'css' | 'tailwind' | 'procreate' | 'json' | 'svg' | 'png';

/** Never in history: saved with the workspace through shell.setView (spec §7.1). */
export type DesignView = {
  /** swatch ids; the first is the active one (inspector) */
  selected: string[];
  surround: 'grey' | 'ground' | 'plain';
  /** short = Hex + L C H; full adds RGB and ≈CMYK rows */
  chipData: 'short' | 'full';
  lower: 'checks' | 'context';
  print: boolean;
  cvd: Cvd;
  build: BuildTab;
  picker: 'oklch' | 'rgb' | 'cmyk';
  /** Value and Hue lock: picker drags keep L or H; typed values still change them (spec §5) */
  lockL: boolean;
  lockH: boolean;
  /** Value check: flag pairs closer than this, in L × 100 */
  flagL: number;
  /** Colour vision check: flag pairs closer than this ΔE */
  flagE: number;
  inspector: number;
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

export const newSwatch = (oklch: Oklch, name = '', role: string | null = null): Swatch => ({
  id: crypto.randomUUID(),
  name,
  role,
  oklch,
  type: 'process',
});

// autoName searches the whole name list with CIEDE2000; chips ask on every render (keyed by the
// numbers themselves: a hex key would gamut-map the colour on every call)
const names = new Map<string, string>();

/** Blank names show the nearest colour name. */
export function displayName(w: Pick<Swatch, 'name' | 'oklch'>): string {
  if (w.name.trim()) return w.name;
  const key = w.oklch.join(' ');
  let n = names.get(key);
  if (n === undefined) {
    if (names.size > 4096) names.clear(); // a long drag of an unnamed swatch asks for a new colour every frame
    names.set(key, (n = autoName(w.oklch)));
  }
  return n;
}

/** What export and the checks' sentences call each swatch: blank names filled in. */
export const named = (list: Swatch[]): Swatch[] => list.map((w) => (w.name.trim() ? w : { ...w, name: displayName(w) }));

export const mapSwatch = (d: DesignDoc, id: string, fn: (w: Swatch) => Swatch): DesignDoc => ({
  ...d,
  swatches: d.swatches.map((w) => (w.id === id ? fn(w) : w)),
});

/**
 * New colours; an edited colour is no longer the imported one, so its original values go
 * (Swatch.source). A "change" to the same colour changes nothing, so the imported values stay.
 */
export const recolour = (d: DesignDoc, changes: Record<string, Oklch>): DesignDoc => ({
  ...d,
  swatches: d.swatches.map((w) => {
    const next = changes[w.id];
    if (!next || next.every((v, i) => v === w.oklch[i])) return w;
    const { source: _, ...rest } = w;
    return { ...rest, oklch: next };
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

/** "Iron", "Iron and Moss", "Iron, Moss and Sky" */
export function listNames(list: string[]): string {
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
