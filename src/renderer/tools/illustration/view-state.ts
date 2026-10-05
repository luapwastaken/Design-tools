// View state (foundation spec §7.1: never in history) and the small bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import { customPigment, PIGMENTS, type CustomPigment } from '../../../shared/paint/pigments.ts';
import { shell } from '../../shell/core/index.ts';
import { EXPORT_FORMATS, type ExportFormat } from '../common/ExportPalette.tsx';
import { createStore } from '../common/store.ts';
import type { Surround } from '../common/surround.ts';

const ID = 'illustration';

export type IllustrationView = {
  /** the selected step or loose swatch (swatch id); null: the first ramp's base */
  selected: string | null;
  /** the mode (doc bar, Alt+1-4): one workspace, four views of the palette */
  tab: 'ramps' | 'light' | 'check' | 'paint';
  /** Ramps: what the board prints under each swatch */
  show: 'hex' | 'name' | 'off';
  /** Ramps and Light: the lens the swatches are seen through (G toggles greyscale) */
  proof: 'off' | Cvd | 'grey';
  surround: Surround;
  inspector: number;
  format: ExportFormat;
  /** Value check: flag pairs closer than this, in L × 100 */
  flagL: number;
  /** Colour vision check: flag pairs closer than this ΔE */
  flagE: number;
  cvd: Cvd;
  /** Recipes: for the selected colour, or one for every ramp's base */
  recipesFor: 'selected' | 'bases';
  maxPaints: 1 | 2 | 3;
  /** ids of the paints you own (the 14 and your own); recipes and the canvas tray use only these */
  owned: string[];
  /** paints you added by colour and name */
  custom: CustomPigment[];
  /** the lit preview's own settings (LitPreview owns their shape) */
  preview: Record<string, unknown>;
  /** the paint canvas's own settings (PaintCanvas owns their shape) */
  canvas: Record<string, unknown>;
  /** the painting kept for each palette: item id → its PNG workspace asset url (dt://asset/illustration/<sha256>.png) */
  paintings: Record<string, string>;
};

export const DEFAULT_VIEW: IllustrationView = {
  selected: null,
  tab: 'ramps',
  show: 'hex',
  proof: 'off',
  surround: 'grey',
  inspector: 380,
  format: 'ase',
  // lower than Design's 6 and 10: a painting's bases often sit close in value (skin and cloth mid-tones),
  // and its steps pack twenty colours or more
  flagL: 3,
  flagE: 6,
  cvd: 'deutan',
  recipesFor: 'selected',
  maxPaints: 3,
  owned: PIGMENTS.map((p) => p.id),
  custom: [],
  preview: {},
  canvas: {},
  paintings: {},
};

const ENUMS: Partial<Record<keyof IllustrationView, readonly unknown[]>> = {
  tab: ['ramps', 'light', 'check', 'paint'],
  show: ['hex', 'name', 'off'],
  proof: ['off', 'grey', 'protan', 'deutan', 'tritan', 'achromat'],
  surround: ['grey', 'ground', 'plain'],
  format: EXPORT_FORMATS,
  cvd: ['protan', 'deutan', 'tritan', 'achromat'],
  recipesFor: ['selected', 'bases'],
  maxPaints: [1, 2, 3],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isOklch = (v: unknown): v is Oklch => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** a part's own settings (the lit preview's, the canvas's) over its defaults: only keys it has, with its types */
export const shaped = <T extends object>(raw: unknown, def: T): T => ({
  ...def,
  ...Object.fromEntries(Object.entries(isObj(raw) ? raw : {}).filter(([k, x]) => k in def && typeof x === typeof def[k as keyof T] && (typeof x !== 'number' || Number.isFinite(x)))),
});

/** your own paints, rebuilt from what a saved workspace holds; anything odd is left out */
const customOf = (raw: unknown): CustomPigment[] =>
  Array.isArray(raw) ? raw.filter((p) => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string' && isOklch(p.oklch)).map((p) => customPigment(p.name as string, p.oklch as Oklch, p.id as string)) : [];

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): IllustrationView {
  const saved = isObj(raw) ? raw : {};
  // before the UX pass the switch was `lower` (Light | Paint), and the picker's mode lived here
  const r = 'tab' in saved || !('lower' in saved) ? saved : { ...saved, tab: saved.lower };
  const out: Record<string, unknown> = { ...DEFAULT_VIEW };
  for (const [key, def] of Object.entries(DEFAULT_VIEW) as [keyof IllustrationView, unknown][]) {
    const v = r[key];
    const ok =
      key === 'selected'
        ? v === null || typeof v === 'string'
        : Array.isArray(def)
          ? Array.isArray(v) && v.every((x) => typeof x === 'string')
          : isObj(def)
            ? isObj(v)
            : typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v)) && (!ENUMS[key] || ENUMS[key]!.includes(v));
    if (ok) out[key] = v;
  }
  out.custom = customOf(r.custom);
  out.paintings = Object.fromEntries(Object.entries(out.paintings as object).filter(([, h]) => typeof h === 'string'));
  return out as IllustrationView;
}

let current: IllustrationView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): IllustrationView => (current ??= sanitize(shell.view(ID)));

// a painting follows its palette: a rename or move takes it along, and a fork (an edit of a
// palette another tool holds, or a locked or missing one) starts with a copy of it
shell.onRelink(ID, (from, to, fork) => {
  const { paintings } = getView();
  if (!paintings[from]) return;
  const { [from]: url, ...rest } = paintings;
  patchView({ paintings: { ...(fork ? paintings : rest), [to]: url } });
});

export function patchView(patch: Partial<IllustrationView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): IllustrationView => useSyncExternalStore(subscribe, getView);

/** swatch ids a check row points at, lit in the ramps while hovered */
export const hot = createStore<string[]>([]);

/** hovering or focusing a check's row lights its swatches in the ramps above */
export const pointAt = (ids: string[]) => ({
  onPointerEnter: () => hot.set(ids),
  onPointerLeave: () => hot.set([]),
  onFocus: () => hot.set(ids),
  onBlur: () => hot.set([]),
});

/** the ramp whose Delete confirm is armed (its row turns into it) */
export const armed = createStore<string | null>(null);

/** the last ramp step clicked (or chosen with Enter or Space), even the one already selected: Paint loads it on the brush */
export const clicked = createStore<{ id: string; at: number } | null>(null);
